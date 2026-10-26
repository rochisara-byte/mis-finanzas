# Mejora 24 — Mis gastos y Proyectado: totales y detalles desplegables

Estado: especificación aprobada; implementación pendiente. No fusionar sin revisión de la usuaria.

## Comportamiento
- Mostrar gastos realizados y pendientes por separado en "Mis gastos", con detalle expandible por movimiento (concepto, fecha, cuenta, categoría, valor y estado).
- Mostrar saldo real, gastos pendientes hasta fecha de corte, ingresos esperados opcionales y saldo proyectado, con detalle expandible de los movimientos incluidos.
- Reutilizar los cálculos existentes: `effective`, `total`, `due`, `future`, `projected`; no cambiar semántica de saldos.
- Los pendientes NO impactan el saldo real ni el presupuesto ejecutado hasta que se marquen realizados.
- El corte de fecha y modo conservador/esperado deben actualizar totales y detalles coherentemente.
- Excluir eliminados; no duplicar movimientos ni contar transferencias como gasto.
- Conservar identidad visual, componentes y experiencia responsive móvil/escritorio.

## Revisión técnica
- `index.html` define `summary()` para Inicio, y `render()` construye el panel de Análisis.
- Análisis ya muestra gastos realizados, pendientes y total previsto del mes, pero no su desglose.
- `due()` y `future()` filtran por fecha de corte; el detalle debe usar exactamente los mismos criterios.
- Listas usa `amountFor(tx)` sin filtrar estado; revisar coherencia sin alterar balances históricos inesperadamente.

## Pruebas mínimas
1. Gastos realizado y pendiente mismo mes: sumas y detalle correctos.
2. Pendiente posterior al corte: no entra en proyección.
3. Ingreso pendiente: solo se incluye en modo esperado.
4. Marcar pendiente como realizado: sale de pendientes, entra en realizados y actualiza saldo.
5. Movimiento eliminado: no se incluye.
6. Transferencia interna: no aparece como gasto.
7. Recurrentes: sin duplicaciones en vistas.
8. Android y Windows: desplegables, teclado, scroll y responsive.
9. Persistencia local y sincronización Drive: sin cambios de esquema, OAuth ni protocolo.
10. PWA: actualizar versión de caché solo cuando se modifique app shell; comprobar instalación offline.

No modificar producción ni fusionar PR automáticamente.
