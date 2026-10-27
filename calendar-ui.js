/* Optional Calendar controls. OAuth stays separate from Drive. */
(function(){
'use strict';
const DB='mis-finanzas-offline-v1',PREF='mis-finanzas-calendar-v1';
const CLIENT='977076702377-qfvfg50kiajoc50s65kuf88m3i7gqkd6.apps.googleusercontent.com';
const read=()=>{const raw=localStorage.getItem(DB);if(raw===null)return [];const value=JSON.parse(raw);if(!Array.isArray(value?.transactions))throw Error('Los movimientos locales no están disponibles');return value.transactions};
const prefs=()=>{try{return JSON.parse(localStorage.getItem(PREF))||{}}catch{return {}}};
const save=value=>localStorage.setItem(PREF,JSON.stringify(value));
const engine=window.MisFinanzasCalendar?.create({clientId:CLIENT,readTransactions:read,loadState:prefs,saveState:save,onStatus:message=>status(message)});
if(!engine)return;
const button=document.createElement('button');button.type='button';button.id='calendarConnectButton';button.className='iconbtn';
button.textContent='▦';button.title='Google Calendar';button.setAttribute('aria-label','Google Calendar');
const dialog=document.createElement('dialog');dialog.id='calendarSettings';
dialog.innerHTML='<h2>Recordatorios de Google Calendar</h2><p>Los gastos pendientes pueden aparecer en un calendario privado. Google Calendar mostrará el concepto y el valor.</p><p id="calendarStatus" role="status" aria-live="polite"></p><fieldset><legend>Recordatorios</legend>'+[[20160,'14 días'],[10080,'7 días'],[4320,'3 días'],[1440,'1 día'],[0,'El mismo día']].map(([n,label])=>'<label><input type="checkbox" data-minutes="'+n+'"> '+label+'</label>').join('')+'</fieldset><div class="calendar-actions"><button type="button" id="calendarEnable">Conectar</button><button type="button" id="calendarSync">Sincronizar ahora</button><button type="button" id="calendarDisable">Desconectar</button><button type="button" id="calendarClose">Cerrar</button></div><button type="button" id="calendarDrive" hidden>Abrir Google Drive</button><p class="calendar-note">Calendar solicita un permiso separado de Drive. Tras recargar, puede ser necesario conectar otra vez.</p>';
const style=document.createElement('style');style.textContent='#calendarSettings{border:1px solid var(--line,#e5e2de);border-radius:16px;max-width:min(420px,calc(100vw - 24px));width:100%;padding:20px;background:var(--paper,#fffaf2);color:var(--ink,#343044);box-shadow:0 15px 48px #182b4933}#calendarSettings::backdrop{background:#201b2380}#calendarSettings h2{font-size:18px;margin:0 0 10px}#calendarSettings p{font-size:13px;line-height:1.5}#calendarSettings fieldset{border:0;padding:8px 0}#calendarSettings legend{font-size:13px;font-weight:700}#calendarSettings label{display:block;font-size:13px;padding:5px 0}#calendarSettings input{accent-color:var(--pink,#ef8fb1)}.calendar-actions{display:flex;flex-wrap:wrap;gap:8px}#calendarSettings button{font:inherit;font-size:12px;border:1px solid var(--line,#e5e2de);border-radius:8px;padding:9px;background:#fff;color:inherit}.calendar-note{color:var(--sub,#777)}#calendarConnectButton{font-size:20px}@media(max-width:390px){#calendarSettings{padding:16px}}';
document.head.append(style);document.querySelector('.top-actions').append(button);document.body.append(dialog);
const status=message=>{dialog.querySelector('#calendarStatus').textContent=message};
const renderReminders=()=>{for(const box of dialog.querySelectorAll('[data-minutes]'))box.checked=engine.reminders.includes(Number(box.dataset.minutes))};
const setAttention=message=>{status(message);dialog.querySelector('#calendarDrive').hidden=true};
let timer=0,previous=new Map(read().filter(t=>t?.id).map(t=>[String(t.id),t]));
const sync=async()=>{if(!engine.enabled)return;if(!engine.authorized){setAttention('Calendar requiere conexión. Pulsa Conectar.');return}
 try{status('Sincronizando Calendar…');const result=await engine.reconcile();
  if(result.skipped==='offline'){setAttention('Sin internet. Los cambios de Calendar siguen pendientes.');return}
  status(result.conflicts?'Revisión necesaria: '+result.conflicts+' movimientos no se modificaron.':'Al día: '+result.created+' creados, '+result.updated+' actualizados, '+result.removed+' eliminados.');
 }catch(e){setAttention('Calendar pendiente: '+e.message)}};
const schedule=()=>{if(timer||!engine.enabled)return;timer=setTimeout(()=>{timer=0;sync()},1200)};
window.addEventListener('finanzas-local-save',()=>{try{const current=new Map(read().filter(t=>t?.id).map(t=>[String(t.id),t]));
 for(const [id,now] of current){const old=previous.get(id);if(!old)engine.noteCreate(id);else if(JSON.stringify(old)!==JSON.stringify(now))engine.noteChange(id,old,now)}
 previous=current;schedule();
 }catch(e){setAttention('Calendar pendiente: '+e.message)}});
window.addEventListener('finanzas-drive-loaded',()=>{try{previous=new Map(read().filter(t=>t?.id).map(t=>[String(t.id),t]));tryOpenLink();schedule()}catch(e){setAttention(e.message)}});
window.addEventListener('storage',e=>{if(e.key===DB){try{previous=new Map(read().filter(t=>t?.id).map(t=>[String(t.id),t]));schedule()}catch(err){setAttention(err.message)}}});
window.addEventListener('online',schedule);
button.onclick=()=>{renderReminders();dialog.showModal()};
dialog.querySelector('#calendarClose').onclick=()=>dialog.close();
dialog.querySelector('#calendarEnable').onclick=async()=>{try{status('Esperando autorización…');await engine.authorize();await sync()}catch(e){setAttention('No se pudo conectar: '+e.message)}};
dialog.querySelector('#calendarSync').onclick=sync;
dialog.querySelector('#calendarDisable').onclick=()=>{engine.disable();setAttention('Desconectado. Los eventos existentes permanecen en Calendar.')};
dialog.querySelector('#calendarDrive').onclick=()=>{dialog.close();window.dispatchEvent(new Event('finanzas-open-drive-panel'))};
dialog.querySelector('fieldset').onchange=()=>{try{const minutes=[...dialog.querySelectorAll('[data-minutes]:checked')].map(x=>Number(x.dataset.minutes));engine.setReminders(minutes,read());schedule();status('Recordatorios pendientes de sincronización.')}catch(e){renderReminders();setAttention(e.message)}};
if(prefs().enabled)status('Conecta Calendar para renovar la autorización. Los cambios locales permanecen pendientes.');else status('Desconectado');
const movementId=new URLSearchParams(location.search).get('movimiento');
function tryOpenLink(){if(!movementId)return;let t;try{t=read().find(x=>String(x.id)===movementId&&!x.deleted)}catch{}
 if(t){dialog.close();window.dispatchEvent(new CustomEvent('finanzas-open-movement',{detail:movementId}));return}
 status('Este movimiento no está en este dispositivo. Sincroniza Google Drive y vuelve a abrirlo.');
 dialog.querySelector('#calendarDrive').hidden=false;if(!dialog.open)dialog.showModal();
}
if(movementId)queueMicrotask(tryOpenLink);
})();
