/* Mejora 27 — interfaz opt-in; sin modificar la base financiera ni el flujo de Drive. */
(function(){
'use strict';
const DB='mis-finanzas-offline-v1', PREF='mis-finanzas-calendar-v1';
const CLIENT='977076702377-qfvfg50kiajoc50s65kuf88m3i7gqkd6.apps.googleusercontent.com';
const read=()=>{try{return JSON.parse(localStorage.getItem(DB))?.transactions||[]}catch{return []}};
const prefs=()=>{try{return JSON.parse(localStorage.getItem(PREF))||{}}catch{return {}}};
const save=x=>localStorage.setItem(PREF,JSON.stringify({...prefs(),...x}));
const btn=document.createElement('button');btn.type='button';btn.id='calendarConnectButton';btn.textContent='▦ Calendar';btn.title='Configurar recordatorios de Google Calendar';btn.style.cssText='position:fixed;right:16px;bottom:215px;z-index:6;background:#fff;color:#3567b5;border:1px solid #d8e4f6;border-radius:22px;padding:10px 13px;box-shadow:0 4px 14px #2445791c;font:600 12px Inter,system-ui,sans-serif;cursor:pointer';
const dialog=document.createElement('dialog');dialog.id='calendarSettings';dialog.style.cssText='border:1px solid #e2e8f0;border-radius:18px;max-width:min(420px,calc(100vw - 32px));width:100%;padding:22px;box-shadow:0 20px 60px #182b4933;color:#27252b';
dialog.innerHTML='<h2 style="margin:0 0 10px">Recordatorios de Google Calendar</h2><p style="line-height:1.5">Crea eventos para gastos pendientes con vencimiento. Cada pago recurrente se administra por separado. Google Calendar puede mostrar concepto y valor en las notificaciones.</p><p id="calendarStatus" role="status" style="font-size:13px;color:#526480">Desconectado</p><div style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" id="calendarEnable">Conectar y sincronizar</button><button type="button" id="calendarSync">Sincronizar ahora</button><button type="button" id="calendarDisable">Desconectar</button><button type="button" id="calendarClose">Cerrar</button></div><p style="font-size:12px;color:#64748b">La autorización se solicita únicamente al pulsar Conectar. Google Drive funciona por separado.</p>';
const status=msg=>{dialog.querySelector('#calendarStatus').textContent=msg};
const engine=window.MisFinanzasCalendar?.create({clientId:CLIENT,readTransactions:read,onStatus:status});
if(!engine)return;
const sync=async()=>{if(!engine.enabled)return;try{status('Sincronizando…');const r=await engine.reconcile();status('Al día: '+r.created+' creados, '+r.updated+' actualizados, '+r.removed+' eliminados.')}catch(e){status('Pendiente: '+e.message)}};
let queued=false;
const schedule=()=>{if(queued||!engine.enabled)return;queued=true;setTimeout(()=>{queued=false;sync()},1800)};
window.addEventListener('finanzas-local-save',schedule);
window.addEventListener('storage',e=>{if(e.key===DB)schedule()});
window.addEventListener('online',schedule);
btn.addEventListener('click',()=>dialog.showModal());
dialog.querySelector('#calendarClose').addEventListener('click',()=>dialog.close());
dialog.querySelector('#calendarEnable').addEventListener('click',async()=>{try{status('Esperando autorización…');await engine.authorize();save({enabled:true});await sync()}catch(e){status('No se pudo conectar: '+e.message)}});
dialog.querySelector('#calendarSync').addEventListener('click',sync);
dialog.querySelector('#calendarDisable').addEventListener('click',()=>{engine.disable();save({enabled:false});status('Desconectado. Los eventos ya creados permanecen en Calendar.')});
if(prefs().enabled)status('Vuelve a pulsar Conectar para renovar la autorización de Calendar.');
document.body.append(btn,dialog);
// Enlaces directos: abrir el movimiento existente sin modificar su estado.
const id=new URLSearchParams(location.search).get('movimiento');
if(id){setTimeout(()=>{const tx=read().find(t=>String(t.id)===id&&!t.deleted);if(!tx){alert('Este movimiento no está disponible en este dispositivo. Sincroniza Google Drive e inténtalo de nuevo.');return}const candidates=[...document.querySelectorAll('[data-id]')];const row=candidates.find(n=>n.dataset.id===id&&n.classList.contains('transaction'));if(row){row.scrollIntoView({block:'center'});row.style.outline='2px solid #3b82f6';const edit=row.querySelector('[data-action="edit"]');if(edit)edit.click();else row.click()}else{alert('El movimiento existe, pero no está visible con los filtros actuales. Búscalo en Mis Finanzas: '+tx.title)}},1100)}
})();
