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
const event=(t,minutes=DEFAULT_REMINDERS)=>{const v=normalize(t);return {id:eventId(v.id),status:'confirmed',summary:v.title+' — '+new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v.amount),description:'Pago pendiente en Mis Finanzas\n'+link(v.id),start:{date:v.date},end:{date:nextDay(v.date)},transparency:'transparent',extendedProperties:{private:{source:OWNER,movementId:v.id}},reminders:{useDefault:false,overrides:minutes.map(n=>({method:'popup',minutes:n}))}}};
const reminderSet=r=>JSON.stringify((r?.overrides||[]).map(x=>[x.method,x.minutes]).sort((a,b)=>a[1]-b[1]));
const same=(a,b)=>a.status===b.status&&a.summary===b.summary&&a.description===b.description&&a.start?.date===b.start.date&&a.end?.date===b.end.date&&a.transparency===b.transparency&&a.extendedProperties?.private?.source===b.extendedProperties.private.source&&a.extendedProperties?.private?.movementId===b.extendedProperties.private.movementId&&a.reminders?.useDefault===b.reminders.useDefault&&reminderSet(a.reminders)===reminderSet(b.reminders);
function create({clientId,readTransactions,loadState=()=>({}),saveState=()=>{},onStatus=()=>{},allowConditionalMutations=false}){
 if(!clientId||typeof readTransactions!=='function')throw Error('Falta la configuración de Calendar');
 const prepared=value=>{const next=value&&typeof value==='object'?value:{};
  next.enabled=next.enabled===true;next.creationPending=next.creationPending===true;
  if(!remindersValid(next.reminders))next.reminders=DEFAULT_REMINDERS.slice();
  for(const key of ['ops','createIds','reviewIds'])if(!next[key]||typeof next[key]!=='object'||Array.isArray(next[key]))next[key]={};
  return next};
 let state=prepared(loadState()),token='',expiry=0,running=null,authorizing=null;
 const refresh=()=>{state=prepared(loadState()||state);return state};
 const status=m=>{try{onStatus(m)}catch{}},persist=()=>{state=prepared(saveState(state)||state)},path=id=>'/calendars/'+encodeURIComponent(id);
 async function request(route,method='GET',body,etag){
  if(!token||Date.now()>=expiry){token='';throw Error('Calendar requiere autorización');}
  const response=await fetch(ROOT+route,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},body:body?JSON.stringify(body):undefined});
  if(response.status===401){token='';expiry=0;}
  if(!response.ok){const error=new Error('Google Calendar HTTP '+response.status);error.status=response.status;throw error;}
  return response.status===204?null:response.json();
 }
 function authorize(){if(authorizing)return authorizing;refresh();authorizing=new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timeout);if(error)reject(error);else resolve()};
  const timeout=setTimeout(()=>finish(Error('La autorización de Calendar no respondió; vuelve a intentarlo')),45000);
  try{
   if(!global.google?.accounts?.oauth2)throw Error('Google Identity Services no está disponible');
   const authClient=global.google.accounts.oauth2.initTokenClient({client_id:clientId,scope:SCOPE,
    error_callback:e=>finish(Error('No se pudo abrir Calendar: '+(e?.type||e?.message||'ventana bloqueada'))),
    callback:r=>{if(settled)return;if(r.error||!r.access_token)return finish(Error(r.error||'No se autorizó Calendar'));
     token=r.access_token;expiry=Date.now()+(Number(r.expires_in)||3500)*1000;finish()}});
   authClient.requestAccessToken({prompt:token?'':'consent'});
  }catch(e){finish(e)}
 });return authorizing.finally(()=>{authorizing=null})}
 async function getCalendar(){
  refresh();
  if(state.calendarId){
   try{const found=await request(path(state.calendarId));if(found.description===MARKER&&found.summary===NAME)return state.calendarId;
    throw Error('El calendario guardado ya no pertenece a Mis Finanzas');
   }catch(e){if(e.status===404)throw Error('No se encontró el calendario guardado; no se creará otro automáticamente');throw e}
  }
  if(state.creationPending)throw Error('La creación anterior no confirmó su ID; localiza el calendario y vincúlalo manualmente');
  throw Error('No hay un calendario vinculado; créalo o vincula su ID explícitamente');
 }
 async function createCalendar(){
  refresh();
  if(state.calendarId)return getCalendar();
  if(state.creationPending)throw Error('La creación anterior no confirmó su ID; localiza el calendario y vincúlalo manualmente');
  state.creationPending=true;persist();
  let created;
  try{created=await request('/calendars','POST',{summary:NAME,timeZone:'America/Bogota',description:MARKER})}
  catch(e){if(e.status&&e.status<500){state.creationPending=false;persist()}throw e}
  if(!created?.id)throw Error('No se confirmó la creación del calendario');
  state.calendarId=created.id;state.creationPending=false;state.bootstrap=true;persist();
  const checked=await request(path(created.id));
  if(checked.summary!==NAME||checked.description!==MARKER)throw Error('No se verificó el calendario creado');
  refresh();state.enabled=true;persist();
  return created.id;
 }
 async function attachCalendar(id){
  id=String(id||'').trim();if(!id||id.length>1024)throw Error('Indica un ID de calendario válido');
  const found=await request(path(id));
  if(found.id!==id||found.summary!==NAME||found.description!==MARKER)throw Error('El calendario indicado no pertenece a Mis Finanzas');
  refresh();state.calendarId=id;state.creationPending=false;state.bootstrap=false;state.enabled=true;persist();return id;
 }
 function enable(){refresh();if(!state.calendarId)throw Error('Crea o vincula un calendario antes de habilitar la integración');state.enabled=true;persist()}
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
  refresh();id=String(id);
  if(state.createIds[id]){persist();return}
  if(eligible(before)){
   if(!state.ops[id])state.ops[id]={base:normalize(before),reminders:oldReminders.slice()};
   state.ops[id].desired=eligible(after)?normalize(after):null;persist();
  }else if(eligible(after))noteCreate(id);
 }
 function noteCreate(id){refresh();state.createIds[String(id)]=true;persist()}
 function noteReplacement(){refresh();for(const id of [...Object.keys(state.ops),...Object.keys(state.createIds)])state.reviewIds[id]=true;persist()}
 function setReminders(minutes,transactions){
  if(!remindersValid(minutes))throw Error('Elige hasta cinco recordatorios entre 0 y 40320 minutos');
  refresh();
  for(const t of transactions.filter(eligible))noteChange(t.id,t,t,state.reminders);
  state.reminders=minutes.slice();persist();
 }
 async function reconcile(){
  refresh();
  if(state.calendarConflict)return {conflicts:1,pending:false,created:0,updated:0,removed:0};
  if(!state.enabled)return {skipped:'disabled'};
  if(!token||Date.now()>=expiry)return {skipped:'authorization'};
  if(global.navigator?.onLine===false)return {skipped:'offline'};
  if(running)return running;
  running=(async()=>{
   const transactions=readTransactions();if(!Array.isArray(transactions))throw Error('Los movimientos no están disponibles');
   const calendarId=await getCalendar(),remote=await listEvents(calendarId);
   const known=new Map(transactions.filter(t=>t&&t.id).map(t=>[String(t.id),t]));
   const byMovement=new Map();let conflicts=0,created=0,updated=0,removed=0,pending=false;
   for(const item of remote){const id=item.extendedProperties?.private?.movementId;
    if(!id||byMovement.has(id)){conflicts++;continue;}byMovement.set(id,item);
   }
   for(const [id,t] of known){
    refresh();
    if(!state.enabled){pending=true;break}
    const old=byMovement.get(id),reminders=state.reminders.slice(),desired=eligible(t)?event(t,reminders):null,op=state.ops[id];
    const latest=()=>readTransactions().find(x=>x&&String(x.id)===id);
    const latestDesired=()=>{const value=latest();return eligible(value)?normalize(value):null};
    const sent=desired?normalize(t):null;
    if(state.reviewIds[id]){conflicts++;continue}
    if(JSON.stringify(latestDesired())!==JSON.stringify(sent)){pending=true;continue}
    if(old&&old.id!==eventId(id)){conflicts++;continue;}
    if(old&&remote.filter(x=>x.extendedProperties?.private?.movementId===id).length!==1){conflicts++;continue;}
    if(old&&desired&&same(old,desired)){
     refresh();
     if(JSON.stringify(latestDesired())!==JSON.stringify(sent)||JSON.stringify(state.reminders)!==JSON.stringify(reminders)||JSON.stringify(state.ops[id])!==JSON.stringify(op)){pending=true;continue}
     if(op||state.createIds[id]){delete state.ops[id];delete state.createIds[id];persist();}continue;
    }
    if(old){
     const matchesIntent=op&&JSON.stringify(op.desired)===JSON.stringify(desired?normalize(t):null);
     if(!matchesIntent||!op.base||!old.etag||!same(old,event(op.base,op.reminders))){conflicts++;continue;}
     if(!allowConditionalMutations){conflicts++;continue;}
     const sentOp=JSON.stringify(op);
     if(desired){try{await request(path(calendarId)+'/events/'+encodeURIComponent(old.id),'PATCH',
      {status:desired.status,summary:desired.summary,description:desired.description,start:desired.start,end:desired.end,transparency:desired.transparency,extendedProperties:desired.extendedProperties,reminders:desired.reminders},old.etag);
      }catch(e){if(e.status===412){conflicts++;continue}throw e}
      const checked=await request(path(calendarId)+'/events/'+encodeURIComponent(old.id));
      if(!same(checked,desired))throw Error('No se verificó la actualización del evento');updated++;
     }else{try{await request(path(calendarId)+'/events/'+encodeURIComponent(old.id),'DELETE',undefined,old.etag);
      }catch(e){if(e.status===412){conflicts++;continue}throw e}
      let checked;
      try{checked=await request(path(calendarId)+'/events/'+encodeURIComponent(old.id))}catch(e){if(e.status!==404)throw e}
      if(checked&&(checked.id!==old.id||checked.status!=='cancelled'))throw Error('No se verificó la eliminación del evento');
      removed++;
     }
     refresh();
     const current=state.ops[id],now=latestDesired();
     if(state.reviewIds[id]){conflicts++;continue}
     if(JSON.stringify(now)!==JSON.stringify(sent)||JSON.stringify(current)!==sentOp){
      if(desired){
       if(current&&JSON.stringify(current.base)!==JSON.stringify(op.base))state.reviewIds[id]=true;
       else state.ops[id]={base:normalize(t),reminders,desired:now};
      }else if(now){delete state.ops[id];state.createIds[id]=true}
      else if(current&&JSON.stringify(current)!==sentOp)state.reviewIds[id]=true;
      else delete state.ops[id];
      pending=true;
     }else{delete state.ops[id];delete state.createIds[id]}
     persist();continue;
    }
    if(!desired){if(op||state.createIds[id]){delete state.ops[id];delete state.createIds[id];persist();}continue;}
    if((op&&!state.createIds[id])||(!state.bootstrap&&!state.createIds[id])){conflicts++;continue;}
    let duplicate=false;
    try{await request(path(calendarId)+'/events','POST',desired);}catch(e){if(e.status!==409)throw e;duplicate=true}
    let checked;
    try{checked=await request(path(calendarId)+'/events/'+encodeURIComponent(desired.id))}catch(e){if(e.status===404){pending=true;conflicts++;continue}throw e}
    if(checked.status==='cancelled'){
     if(!duplicate||!allowConditionalMutations||!checked.etag){pending=true;conflicts++;continue}
     try{await request(path(calendarId)+'/events/'+encodeURIComponent(desired.id),'PATCH',
      {status:desired.status,summary:desired.summary,description:desired.description,start:desired.start,end:desired.end,transparency:desired.transparency,extendedProperties:desired.extendedProperties,reminders:desired.reminders},checked.etag);
     }catch(e){if(e.status===412){pending=true;conflicts++;continue}throw e}
     try{checked=await request(path(calendarId)+'/events/'+encodeURIComponent(desired.id))}catch(e){if(e.status===404){pending=true;conflicts++;continue}throw e}
    }
    if(!same(checked,desired)){pending=true;conflicts++;continue}created++;
    refresh();
    const now=latestDesired();
    if(JSON.stringify(now)!==JSON.stringify(sent)||JSON.stringify(state.reminders)!==JSON.stringify(reminders)){
     state.ops[id]={base:normalize(t),reminders,desired:now};pending=true;
    }
    delete state.createIds[id];persist();
   }
   if(state.bootstrap){state.bootstrap=false;persist();}
   status(conflicts?'Calendar requiere revisión: '+conflicts+' conflictos':pending?'Calendar tiene cambios pendientes':'Calendar sincronizado');
   return {created,updated,removed,conflicts,pending};
  })();
  try{return await running}catch(e){status('Calendar pendiente: '+e.message);throw e}finally{running=null}
 }
 return {authorize,createCalendar,reconcile,attachCalendar,enable,noteChange,noteCreate,noteReplacement,refreshState:refresh,setReminders,disable(){refresh();state.enabled=false;token='';expiry=0;persist();status('Calendar desconectado')},get enabled(){return state.enabled},get authorized(){return !!token&&Date.now()<expiry},get calendarId(){return state.calendarId||''},get creationPending(){return !!state.creationPending},get reminders(){return state.reminders.slice()},get scope(){return SCOPE}};
}
global.MisFinanzasCalendar={create,eligible,event,eventId,remindersValid};
})(window);
