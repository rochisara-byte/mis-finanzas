# Corrección 17.1: sin ventanas emergentes automáticas

> Nota histórica: esta decisión fue revertida para restaurar el intento
> automático de la Corrección 17. El texto siguiente describe la 17.1 mientras
> estuvo vigente; Google puede abrir una ventana con `prompt: 'none'`.

Google Identity Services puede abrir una ventana al llamar a
`requestAccessToken({prompt: 'none'})`. Por eso la aplicación ya no solicita
un token al cargar, refrescar, recuperar la red o volver a estar visible.
Tampoco se intenta renovar automáticamente un token caducado.

El token vigente continúa en memoria durante esa apertura de la página. Con
él, los guardados y eventos de red pueden ejecutar la sincronización existente
sin volver a autorizar. Tras refrescar, el token en memoria desaparece y el
indicador muestra «Drive · Requiere conexión»; los datos locales permanecen
disponibles. La usuaria debe pulsar manualmente «Conectar Google y sincronizar»
para permitir una nueva autorización. «Al día» solo aparece tras comprobar la
copia de Drive. El conflicto, respaldo y doble confirmación de la Corrección
16 no cambian.

No se guardan tokens en `localStorage`, no se modifica el scope OAuth ni las
claves de almacenamiento, y no se borra ni reemplaza ninguna copia por el
simple hecho de abrir la página.

## Verificación y limitaciones

- `node tests/drive-sync.test.js` comprueba con GIS y Drive simulados que
  inicio, recarga, `online`, visibilidad, guardado y temporizador no invocan
  `requestAccessToken()`. También cubre conexión manual, token vigente o
  caducado, autorización denegada y conflictos.
- `node tests/recurrence.test.js` verifica las regresiones financieras de la
  Corrección 14.
- No se prueba una cuenta OAuth real. Google puede mostrar su ventana al
  pulsar el botón manual; esta acción es deliberada y necesaria cuando no hay
  token reutilizable en memoria.
- Permanece la ventana de carrera de Drive documentada en la Corrección 16.
