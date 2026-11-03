# Mejora 33: Historial mensual

## Alcance

Solo cambia la presentación de Historial. Agrupa los movimientos visibles por mes y fecha, ordenados de reciente a antiguo. Las claves internas siguen siendo `AAAA-MM-DD`; los encabezados usan nombres completos en español y `DD/MM/AAAA`. Los registros antiguos sin fecha válida se muestran bajo `Sin fecha`.

El estado de expansión vive en memoria. Al entrar, se abre el mes más reciente y su fecha más reciente. Los grupos nuevos que aparecen durante filtros, búsqueda o «Cargar más» comienzan contraídos. Los grupos que desaparecen temporalmente conservan su elección manual hasta salir de Historial. Los conteos corresponden a los movimientos filtrados y cargados, no al archivo completo cuando todavía quedan páginas por cargar.

No se modificaron claves de almacenamiento, movimientos, cálculos, recurrencias, importación/exportación ni sincronización con Drive. La versión del shell PWA pasa de 14 a 15.

## Verificación

- Superadas con datos ficticios: `mejora-33.test.js` a 375 y 1280 px; `mejora-32.test.js`, `saldo-diagnostico.test.js`, `mejora-24.test.js`, `mejoras-28-29.test.js`, `mejora-30.test.js`, `desktop-layout.test.js`, `projection-preferences.test.js`, `drive-sync.test.js`, `recurrence.test.js`, `pwa-cache.test.js` y `pwa.test.js`.
- Capturas: `capturas-mejora-33/historial-compacto-375.png`, `historial-compacto-1280.png`, `historial-expandido-375.png` y `historial-expandido-1280.png`.
- No se usaron datos reales ni una cuenta Google Drive real. Las pruebas de Drive fueron simuladas. Las dos pruebas estáticas antiguas de Mejora 24 no se ejecutaron porque buscan textos ausentes ya en `main`; `mejora-24.test.js` sí pasó.
