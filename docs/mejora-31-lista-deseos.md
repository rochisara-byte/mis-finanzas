# Mejora 31: decisiones de integridad

## Modelo

- `wishes` es una coleccion opcional en las copias `version: 1`. Un deseo pendiente no participa en saldos, proyecciones, presupuestos ni metas.
- El deseo tiene un ID estable. El movimiento de compra guarda `wishId`; el estado de compra, fecha e importe real se derivan del unico movimiento de gasto no eliminado vinculado. Una compra pendiente sigue siendo planificada.
- La subcategoria es texto opcional: la aplicacion actual no tiene catalogo ni administracion de subcategorias. El presupuesto sigue dependiendo solo del nombre de la categoria.
- El vinculo opcional `goalId` del deseo no es un abono (`linkKind`/`linkId`) y nunca descuenta ahorros automaticamente.
- Eliminar un deseo es logico. Su movimiento financiero, si existe, permanece en el historial. Los datos antiguos sin `wishes` siguen siendo legibles sin migracion.

## Sincronizacion y limites

- Exportacion, importacion y Google Drive transportan la coleccion como parte de la copia completa. Se rechazan IDs de deseos repetidos y mas de un movimiento activo para el mismo deseo; no se deduplican registros financieros por nombre.
- La sincronizacion Drive v1 no fusiona cambios independientes. Dos dispositivos que compren el mismo deseo sin conexion producen un conflicto explicito entre copias completas; ninguna se reemplaza automaticamente. Resolver ese conflicto puede descartar cambios de una copia por decision del usuario. Una fusion multidispositivo requeriria otro protocolo y queda fuera de esta mejora.
- Los clientes antiguos pueden conservar campos desconocidos en una copia, pero no saben validar ni mostrar deseos. No se debe usar una copia antigua como prueba de que ambos dispositivos contienen los mismos cambios.

## Verificación

- Superadas: `tests/wishlist.test.js` a 375 y 1280 px; `mejora-24.test.js`, `mejoras-28-29.test.js`, `mejora-30.test.js`, `desktop-layout.test.js`, `projection-preferences.test.js`, `drive-sync.test.js`, `recurrence.test.js`, `pwa-cache.test.js` y `pwa.test.js`.
- Dos pruebas de integración antiguas de la Mejora 24 (`mejora-24-integracion.test.js` y `mejora-24-reconciliacion.test.js`) fallan porque buscan textos de Inicio ausentes ya en `main`. No son regresiones de esta rama; las pruebas financieras y de interfaz actuales sí pasan.
- No se probó una cuenta real de Google Drive ni se modificaron datos de usuarios. Las pruebas de Drive usan copias ficticias y API simulada.
- Capturas: `capturas-mejora-31/lista-375.png`, `lista-1280.png`, `compra-375.png` y `compra-1280.png`.
