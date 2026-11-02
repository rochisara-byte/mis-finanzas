# Mejora 32: diagnóstico de saldo real

## Alcance del indicador

`Saldo real` de Inicio usa `total()`: suma `accountBalance(id)` de todas las cuentas cuyo tipo no sea `credit`. No aplica filtros de búsqueda, período, lista ni cuenta. Cuentas muestra esos mismos saldos individuales y un `Saldo total` basado en `total()`.

Cada saldo parte de `opening`. Solo cuentan movimientos `done` no eliminados: ingreso suma en origen, gasto resta en origen, transferencia resta en origen y suma en destino. Pendientes, borrados lógicos y futuras ocurrencias recurrentes pendientes no alteran el saldo real. Un abono a meta o deuda es un gasto vinculado y resta una vez; no hay un segundo descuento por el vínculo.

## Diferencia reportada

La diferencia aritmética entre $584.651 y $576.295 es $8.356. No demuestra un defecto: el primer número corresponde a una cuenta bancaria, mientras que el segundo se observó en la tarjeta general. Efectivo u otras cuentas no crédito pueden explicar una diferencia positiva o negativa. Sin una copia de los registros no es posible identificar el origen concreto ni corresponde ajustar importes automáticamente.

Primero se debe comparar en **Cuentas** el saldo individual del banco y el saldo total con `Saldo real` de Inicio. Si el banco coincide con $584.651 pero el total es $576.295, revisar saldos de efectivo y otras cuentas no crédito. Si el banco no coincide, revisar su saldo inicial y movimientos realizados. No cambiar ni eliminar registros por una mera coincidencia de importe.

## Herramienta local de solo lectura

`tests/saldo-diagnostico.html` puede abrirse en el navegador junto con una copia JSON exportada. Seleccionar un archivo y luego una cuenta muestra saldo inicial, ingresos, gastos, transferencias entrantes y salientes, saldo reconstruido y suma de cuentas no crédito. Lista los movimientos que afectan la cuenta e indica grupos con atributos repetidos como **posibles** duplicados, nunca como prueba de que lo sean. La página no usa red, almacenamiento local ni Google Drive y no escribe en la copia. No se deben enviar copias con datos privados al repositorio.

## Riesgos y límites

- No se dispuso de los datos reales; el caso de $8.356 queda pendiente de revisión manual local.
- Los movimientos independientes con mismos fecha, importe y concepto no se deduplican automáticamente.
- No se cambió la lógica de cálculo. Si una copia revela un defecto, preparar una corrección financiera separada con pruebas y autorización antes de aplicarla a datos de usuario.

## Pruebas de esta rama

Superadas con datos ficticios: `mejora-32.test.js` a 375 y 1280 px (selector, formato, Historial, recurrencia, transferencia, abono, exportación e importación), `saldo-diagnostico.test.js`, `mejora-24.test.js`, `desktop-layout.test.js`, `mejoras-28-29.test.js`, `mejora-30.test.js`, `projection-preferences.test.js`, `drive-sync.test.js`, `recurrence.test.js`, `pwa-cache.test.js` y `pwa.test.js`.

No realizadas: comparación con la cuenta bancaria real ni prueba de Google Drive con datos reales. Las dos pruebas estáticas antiguas `mejora-24-integracion.test.js` y `mejora-24-reconciliacion.test.js` buscan textos que ya no están en `main`; la prueba financiera actual `mejora-24.test.js` sí pasó. La interfaz actual presenta importes monetarios redondeados a COP enteros mediante `money()`, aunque los decimales introducidos se guardan sin ese redondeo.
