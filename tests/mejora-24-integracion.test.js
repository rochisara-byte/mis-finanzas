// Verifica la integración de los desplegables con el código real de index.html.
// Ejecutar: node tests/mejora-24-integracion.test.js
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const cases=[
 ['Detalles de Inicio', "${breakdown('Detalle de pagos pendientes"],
 ['Gastos realizados', "${breakdown('Mis gastos · realizados'"],
 ['Gastos pendientes', "${breakdown('Mis gastos · pendientes'"],
 ['Proyección por fecha', "${breakdown('Proyectado · pagos hasta '+until"],
 ['Ingresos esperados opcionales', "projection==='expected'?breakdown('Proyectado · ingresos esperados'"],
 ['Saldo real solo movimientos realizados', "effective=t=>t.status==='done'&&!t.deleted"],
 ['Pendientes con fecha de corte', "t.date&&t.date<=until"],
 ['Exclusión de eliminados', "!t.deleted&&t.status==='pending'"],
 ['Desplegables nativos', '<details class="finance-breakdown">'],
 ['Estilos del desglose', '.finance-breakdown-row']
];
for(const [name,fragment] of cases)assert.ok(html.includes(fragment),'Falta: '+name);
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);
assert.ok(scripts.length>=1,'Sin scripts inline');
for(const script of scripts)new Function(script);
console.log('Mejora 24: '+cases.length+' verificaciones de integración y '+scripts.length+' scripts válidos');
