/* Calendar projects local pending expenses; it never writes financial data. */
(function(global){
'use strict';
const SCOPE='https://www.googleapis.com/auth/calendar.app.created';
const ROOT='https://www.googleapis.com/calendar/v3';
const NAME='Mis Finanzas · Pagos',OWNER='mis-finanzas-v27';
const MARKER='Calendario privado creado por Mis Finanzas ('+OWNER+').';
const DEFAULT_REMINDERS=[10080,4320,1440,0];
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const eligible=t=>t&&!t.deleted&&t.type==='expense'&&t.status==='pending'&&validDate(t.date)&&typeof t.id==='string'&&!!t.id;
const normalize=t=>({id:String(t.id),title:String(t.title||'Pago pendiente'),amount:Number(t.amount)||0,date:t.date});
const remindersValid=value=>Array.isArray(value)&&value.length<=5&&new Set(value).size===value.length&&value.every(n=>Number.isInteger(n)&&n>=0&&n<=40320);
const eventId=id=>{const hex=Array.from(new TextEncoder().encode(OWNER+':'+id),b=>b.toString(16).padStart(2,'0')).join('');if(hex.length+2>1024)throw Error('ID de movimiento demasiado largo para Calendar');return 'mf'+hex};
const nextDay=s=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)};
const link=id=>new URL('./?movimiento='+encodeURIComponent(id),global.location.href).href;
const event=(t,minutes=DEFAULT_REMINDERS)=>{const v=normalize(t);return {id:eventId(v.id),summary:v.title+' — '+new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v.amount),description:'Pago pendiente en Mis Finanzas\n'+link(v.id),start:{date:v.date},end:{date:nextDay(v.date)},transparency:'transparent',extendedProperties:{private:{source:OWNER,movementId:v.id}},reminders:{useDefault:false,overrides:minutes.map(n=>({method:'popup',minutes:n}))}}};
const reminderSet=r=>JSON.stringify((r?.overrides||[]).map(x=>[x.method,x.minutes]).sort((a,b)=>a[1]-b[1]));
const same=(a,b)=>a.summary===b.summary&&a.description===b.description&&a.start?.date===b.start.date&&a.end?.date===b.end.date&&a.reminders?.useDefault===b.reminders.useDefault&&reminderSet(a.reminders)===reminderSet(b.reminders);
function create({clientId,readTransactions,loadState=()=>({}),saveState=()=>{},onStatus=()=>{},allowConditionalMutations=false}){
 if(!clientId||typeof readTransactions!=='function')throw Error('Falta la configuración de Calendar');
 let state=loadState()||{},token='',expiry=0,running=null,authorizing=null;
 if(!remindersValid(state.reminders))state.reminders=DEFAULT_REMINDERS.slice();
 if(!state.ops||typeof state.ops!=='object'||Array.isArray(state.ops))state.ops={};
 if(!state.createIds||typeof state.createIds!=='object'||Array.isArray(state.createIds))state.createIds={};
 const status=m=>{try{onStatus(m)}catch{}},persist=()=>saveState(state),path=id=>'/calendars/'+encodeURIComponent(id);
 async function request(route,method='GET',body,etag){
  if(!token||Date.now()>=expiry){token='';throw Error('Calendar requiere autorización');}
  const response=await fetch(ROOT+route,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},body:body?JSON.stringify(body):undefined});
  if(response.status===401){token='';expiry=0;}
  if(!response.ok){const error=new Error('Google Calendar HTTP '+response.status);error.status=response.status;throw error;}
  return response.status===204?null:response.json();
 }
 function authorize(){if(authorizing)return authorizing;authorizing=new Promise((resolve,reject)=>{
  if(!global.google?.accounts?.oauth2)return reject(Error('Google Identity Services no está disponible'));
  const authClient=global.google.accounts.oauth2.initTokenClient({client_id:clientId,scope:SCOPE,callback:r=>{
   if(r.error||!r.access_token)return reject(Error(r.error||'No se autorizó Calendar'));
   token=r.access_token;expiry=Date.now()+(Number(r.expires_in)||3500)*1000;state.enabled=true;
   try{persist();resolve()}catch(e){token='';state.enabled=false;reject(e)}
  }});
  authClient.requestAccessToken({prompt:token?'':'consent'});
 });return authorizing.finally(()=>{authorizing=null})}
 async function getCalendar(){
  if(state.calendarId){
   try{const found=await request(path(state.calendarId));if(found.description===MARKER&&found.summary===NAME)return state.calendarId;
    throw Error('El calendario guardado ya no pertenece a Mis Finanzas');
   }catch(e){if(e.status!==404)throw e;state.calendarId='';persist();}
  }
  let pageToken='',seen=new Set(),found=[];
  do{
   const data=await request('/users/me/calendarList?'+new URLSearchParams({maxResults:'250',...(pageToken?{pageToken}:{})}));
   if(!Array.isArray(data.items))throw Error('Listado de calendarios incompleto');
   found.push(...data.items.filter(c=>c.summary===NAME&&c.description===MARKER&&c.accessRole==='owner'));
   pageToken=data.nextPageToken||'';
   if(pageToken&&seen.has(pageToken))throw Error('Paginación de calendarios inválida');seen.add(pageToken);
  }while(pageToken);
  if(found.length>1)throw Error('Hay varios calendarios de Mis Finanzas; se requiere revisión manual');
  if(found.length===1){state.calendarId=found[0].id;state.bootstrap=false;persist();return state.calendarId;}
  const created=await request('/calendars','POST',{summary:NAME,timeZone:'America/Bogota',description:MARKER});
  if(!created?.id)throw Error('No se confirmó la creación del calendario');
  const checked=await request(path(created.id));
  if(checked.summary!==NAME||checked.description!==MARKER)throw Error('No se verificó el calendario creado');
  state.calendarId=created.id;state.bootstrap=true;persist();return created.id;
 }
 async function listEvents(calendarId){
  const out=[],seen=new Set();let pageToken='';
  do{
   const data=await request(path(calendarId)+'/events?'+new URLSearchParams({maxResults:'2500',showDeleted:'false',...(pageToken?{pageToken}:{})}));
   if(!Array.isArray(data.items))throw Error('Listado de eventos incompleto');
   out.push(...data.items.filter(x=>x.extendedProperties?.private?.source===OWNER));
   pageToken=data.nextPageToken||'';
   if(pageToken&&seen.has(pageToken))throw Error('Paginación de eventos inválida');seen.add(pageToken);
  }while(pageToken);
  return out;
 }
 function noteChange(id,before,after,oldReminders=state.reminders){
  id=String(id);
  if(eligible(before)){
   if(!state.ops[id])state.ops[id]={base:normalize(before),reminders:oldReminders.slice()};
   state.ops[id].desired=eligible(after)?normalize(after):null;persist();
  }else if(eligible(after))noteCreate(id);
 }
 function noteCreate(id){state.createIds[String(id)]=true;persist()}
 function setReminders(minutes,transactions){
  if(!remindersValid(minutes))throw Error('Elige hasta cinco recordatorios entre 0 y 40320 minutos');
  for(const t of transactions.filter(eligible))noteChange(t.id,t,t,state.reminders);
  state.reminders=minutes.slice();persist();
 }
 async function reconcile(){
  if(!state.enabled)return {skipped:'disabled'};
  if(!token||Date.now()>=expiry)return {skipped:'authorization'};
  if(global.navigator?.onLine===false)return {skipped:'offline'};
  if(running)return running;
  running=(async()=>{
   const transactions=readTransactions();if(!Array.isArray(transactions))throw Error('Los movimientos no están disponibles');
   const calendarId=await getCalendar(),remote=await listEvents(calendarId);
   const known=new Map(transactions.filter(t=>t&&t.id).map(t=>[String(t.id),t]));
   const byMovement=new Map();let conflicts=0,created=0,updated=0,removed=0;
   for(const item of remote){const id=item.extendedProperties?.private?.movementId;
    if(!id||byMovement.has(id)){conflicts++;continue;}byMovement.set(id,item);
   }
   for(const [id,t] of known){
    const old=byMovement.get(id),desired=eligible(t)?event(t,state.reminders):null,op=state.ops[id];
    if(old&&old.id!==eventId(id)){conflicts++;continue;}
    if(old&&remote.filter(x=>x.extendedProperties?.private?.movementId===id).length!==1){conflicts++;continue;}
    if(old&&desired&&same(old,desired)){if(op||state.createIds[id]){delete state.ops[id];delete state.createIds[id];persist();}continue;}
    if(old){
     const matchesIntent=op&&JSON.stringify(op.desired)===JSON.stringify(desired?normalize(t):null);
     if(!matchesIntent||!op.base||!old.etag||!same(old,event(op.base,op.reminders))){if(op||desired)conflicts++;continue;}
     if(!allowConditionalMutations){conflicts++;continue;}
     if(desired){await request(path(calendarId)+'/events/'+encodeURIComponent(old.id),'PATCH',
      {summary:desired.summary,description:desired.description,start:desired.start,end:desired.end,reminders:desired.reminders},old.etag);
      const checked=await request(path(calendarId)+'/events/'+encodeURIComponent(old.id));
      if(!same(checked,desired))throw Error('No se verificó la actualización del evento');updated++;
     }else{await request(path(calendarId)+'/events/'+encodeURIComponent(old.id),'DELETE',undefined,old.etag);
      try{await request(path(calendarId)+'/events/'+encodeURIComponent(old.id));throw Error('No se verificó la eliminación del evento');}
      catch(e){if(e.status!==404)throw e;}removed++;
     }
     delete state.ops[id];delete state.createIds[id];persist();continue;
    }
    if(!desired){if(op||state.createIds[id]){delete state.ops[id];delete state.createIds[id];persist();}continue;}
    if(op||(!state.bootstrap&&!state.createIds[id])){conflicts++;continue;}
    try{await request(path(calendarId)+'/events','POST',desired);}catch(e){if(e.status!==409)throw e;}
    const checked=await request(path(calendarId)+'/events/'+encodeURIComponent(desired.id));
    if(!same(checked,desired))throw Error('El evento creado difiere de la copia local');created++;
    delete state.createIds[id];persist();
   }
   if(state.bootstrap){state.bootstrap=false;persist();}
   status(conflicts?'Calendar requiere revisión: '+conflicts+' conflictos':'Calendar sincronizado');
   return {created,updated,removed,conflicts};
  })();
  try{return await running}catch(e){status('Calendar pendiente: '+e.message);throw e}finally{running=null}
 }
 return {authorize,reconcile,noteChange,noteCreate,setReminders,disable(){state.enabled=false;token='';expiry=0;persist();status('Calendar desconectado')},get enabled(){return state.enabled},get authorized(){return !!token&&Date.now()<expiry},get reminders(){return state.reminders.slice()},get scope(){return SCOPE}};
}
global.MisFinanzasCalendar={create,eligible,event,eventId,remindersValid};
})(window);
