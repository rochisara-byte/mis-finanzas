// Pruebas de regresión de los cálculos de la Mejora 24.
// Ejecutar: node tests/mejora-24.test.js
'use strict';
const assert = require('node:assert/strict');
const tx = [
 {id:'paid',type:'expense',status:'done',amount:150000,date:'2026-10-02',account:'cash'},
 {id:'internet',type:'expense',status:'pending',amount:90000,date:'2026-10-20',account:'cash'},
 {id:'energy',type:'expense',status:'pending',amount:120000,date:'2026-10-29',account:'cash'},
 {id:'future',type:'expense',status:'pending',amount:50000,date:'2026-11-05',account:'cash'},
 {id:'income',type:'income',status:'pending',amount:200000,date:'2026-10-25',account:'cash'},
 {id:'transfer',type:'transfer',status:'pending',amount:80000,date:'2026-10-21',account:'cash'},
 {id:'deleted',type:'expense',status:'pending',amount:1000000,date:'2026-10-22',account:'cash',deleted:true},
 {id:'undated',type:'expense',status:'pending',amount:9000,date:'',account:'cash'},
];
const cutoff='2026-10-31';
const pending=type=>tx.filter(t=>!t.deleted&&t.status==='pending'&&t.type===type&&t.date&&t.date<=cutoff);
const sum=a=>a.reduce((s,t)=>s+Number(t.amount||0),0);
const expenseMonth=()=>tx.filter(t=>!t.deleted&&t.type==='expense'&&t.date?.slice(0,7)==='2026-10');
assert.deepEqual(pending('expense').map(t=>t.id),['internet','energy']);
assert.equal(sum(pending('expense')),210000);
assert.equal(sum(pending('income')),200000);
assert.equal(sum(expenseMonth().filter(t=>t.status==='done')),150000);
assert.equal(sum(expenseMonth().filter(t=>t.status==='pending')),210000);
assert.equal(800000-sum(pending('expense')),590000);
assert.equal(800000-sum(pending('expense'))+sum(pending('income')),790000);
tx.find(t=>t.id==='internet').status='done';
assert.equal(sum(pending('expense')),120000);
assert.equal(sum(expenseMonth().filter(t=>t.status==='done')),240000);
assert.equal(sum(expenseMonth().filter(t=>t.status==='pending')),120000);
console.log('Mejora 24: 9 verificaciones de cálculos completadas');
