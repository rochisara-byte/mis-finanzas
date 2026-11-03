# Integracion de las Mejoras 31 y 33

Rama: `integration/mejoras-31-33`, creada desde `main` con la Mejora 32.

## Conflictos resueltos

- `index.html`: el formulario de movimientos usa la misma ruta `saveQuickMovement` para altas y ediciones, tanto desde Inicio como desde la compra de un deseo. Se conservan el parser colombiano de la Mejora 32, `wishId`, subcategoria, emoji y campos de recurrencia. Al abrir un importe decimal existente, se presenta con coma decimal para evitar reinterpretarlo como miles al guardarlo sin cambios.
- `index.html`: se combinaron los eventos y estilos de la Lista de deseos con el Historial agrupado por mes y fecha. No se altero la formula de saldos, presupuestos ni proyeccion.
- `sw.js`: `CACHE_VERSION = 16` y huella SHA-256 del shell final integrado. No se cambiaron las claves de almacenamiento ni la estrategia del service worker.
- La prueba de importacion de deseos espera a que termine la primera persistencia antes de iniciar la siguiente operacion; evita dos manejadores simultaneos del dialogo.

## Pruebas superadas

- `tests/integration-31-33.test.js` a 375 y 1280 px: importes 1.500, 15.000, 1.500.000 y 1.234,56; valores almacenados como numeros; saldos, transferencia y presupuesto; compra vinculada con estimado distinto del importe real; edicion sin duplicado; exportacion/importacion JSON; eliminacion y retorno del deseo a pendiente; recurrencia decimal y un unico hijo sin `wishId`.
- `tests/wishlist.test.js` y `tests/mejora-33.test.js` a 375 y 1280 px: filtros, compra, edicion, reversion, recarga, agrupacion, orden, expansion y carga de Historial.
- `tests/mejora-32.test.js`, `tests/mejora-24.test.js`, `tests/mejoras-28-29.test.js`, `tests/mejora-30.test.js`, `tests/desktop-layout.test.js`, `tests/projection-preferences.test.js`, `tests/saldo-diagnostico.test.js`, `tests/recurrence.test.js`, `tests/drive-sync.test.js`, `tests/pwa-cache.test.js` y `tests/pwa.test.js`.
- La prueba de Drive es simulada; verifica que deseos y vinculos sobreviven a la sincronizacion y que una compra vinculada duplicada se rechaza.
- `tests/pwa.test.js` verifico apertura offline, persistencia, actualizacion completa y recuperacion de instalacion interrumpida. Un primer intento fallo por una carrera del test al activar el nuevo worker; la repeticion completa paso.

## Capturas de la version integrada

- Lista de deseos: `docs/capturas-integracion-31-33/lista-375.png` y `lista-1280.png`.
- Compra vinculada: `compra-375.png` y `compra-1280.png` en el mismo directorio.
- Historial compacto y expandido: `historial-compacto-{375,1280}.png` y `historial-expandido-{375,1280}.png` en el mismo directorio.

## Limitaciones y riesgos residuales

- `tests/mejora-24-reconciliacion.test.js` y `tests/mejora-24-integracion.test.js` fallan porque buscan etiquetas de desglose que ya no existen en `main`; no son regresiones de esta integracion. Las pruebas funcionales de saldos y preferencias de proyeccion pasan.
- No se ejecuto una sincronizacion contra Google Drive real ni se usaron datos personales. Drive v1 sigue siendo una copia completa con resolucion explicita de conflictos, no una fusion automatica multidispositivo.
- Las capturas y pruebas usan exclusivamente registros ficticios. No se publico ni se fusiono la aplicacion.
