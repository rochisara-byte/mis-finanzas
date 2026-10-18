# Corrección 17: reconexión de Google Drive

Al abrir o recargar la aplicación, se hace como máximo un intento de obtener
un token de Google Identity Services sin mostrar selección de cuenta ni
consentimiento (`prompt: 'none'`). Se espera a que GIS cargue y se limita la
espera por la respuesta de autorización. Si la página se abrió sin conexión o
en segundo plano, el intento espera al primer evento `online` o a que la
página vuelva a ser visible. No se hacen reintentos automáticos tras una
denegación, una interrupción o una caducidad.

Si Google entrega un token, la sincronización existente comprueba las copias.
Solo muestra «Al día» después de completar esa comprobación. Las versiones
divergentes conservan el conflicto pendiente y no se reemplazan sin elección
explícita. Los estados «Conectando», «Pendiente», «Conflicto pendiente» y
«Requiere conexión» distinguen el progreso y la intervención necesaria.
«Sin internet» sigue indicando que la aplicación funciona sin conexión.

El botón «Conectar Google y sincronizar» sigue siendo el camino manual cuando
Google requiere interacción. Ningún flujo interactivo se abre por sí solo.
El token permanece en memoria; no se añade al almacenamiento local ni cambia
el ID OAuth, el scope, las claves o el formato de las copias.

## Limitaciones

- Google puede rechazar `prompt: 'none'` por sesión caducada, permisos ausentes,
  restricciones del navegador o una decisión de seguridad. Una reconexión
  silenciosa no garantiza una sesión persistente; la persona deberá pulsar
  «Conectar Google».
- El intento silencioso depende de que GIS cargue y de la red. Un fallo no
  afecta los datos locales; tampoco se reintenta continuamente en esa apertura.
- La ventana de carrera de Drive entre la última lectura y una subida sigue
  siendo la documentada en la Corrección 16. Esta corrección no modifica ese
  mecanismo ni la resolución de conflictos.

## Verificación

`node tests/drive-sync.test.js` prueba el arranque, la recarga simulada,
autorización disponible, denegación, interrupción, caducidad, inicio sin red,
estados pendientes y conflicto con datos ficticios. También ejecuta las
regresiones de sincronización de las Correcciones 15 y 16.
`node tests/recurrence.test.js` cubre la regresión de la Corrección 14.
No se prueba una cuenta real de Google ni una sesión OAuth de producción.
