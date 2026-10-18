# Corrección 16: resolución de conflictos de Google Drive

Cuando los datos locales y el archivo principal de Drive difieren, la
sincronización queda pendiente hasta que la persona elige una de tres acciones:

- **Conservar datos de este dispositivo:** después de dos confirmaciones,
  crear un archivo independiente `mis-finanzas-respaldo-*.json` en
  `appDataFolder`, leerlo y comprobar que conserva exactamente la copia remota
  anterior. Volver a comprobar ambas versiones, actualizar el archivo
  principal y descargarlo para verificar que coincide con los datos locales.
- **Utilizar datos de Google Drive:** después de dos confirmaciones, comprobar
  de nuevo ambas versiones y reemplazar los datos locales. Los ajustes de
  este dispositivo permanecen locales.
- **Cancelar:** no escribir en el navegador ni en Drive; el conflicto sigue
  pendiente.

La sincronización en segundo plano no sustituye ninguna versión divergente,
aunque el hash de base corresponda a una de ellas. No se fusionan movimientos.
El nombre del archivo principal, el scope OAuth y las claves de almacenamiento
permanecen iguales. Los respaldos creados no se borran ni se seleccionan como
archivo principal.

## Riesgos residuales

- Drive no ofrece en este flujo una escritura condicional atómica entre la
  última lectura y el `PATCH`. Otro dispositivo podría modificar el archivo
  principal justo en esa ventana. La lectura posterior puede detectar una
  discrepancia, pero no puede deshacer automáticamente una escritura ya
  realizada. El respaldo remoto verificado queda disponible para recuperación.
- Si falla la verificación después de una subida, el estado del archivo
  principal puede ser incierto. La base local no se actualiza y el conflicto
  queda pendiente para revisión manual.
- Los respaldos de `appDataFolder` son privados y no aparecen en la carpeta
  habitual de Drive. Se conservan con nombre e identificador propios y pueden
  leerse mediante la API de Drive con el mismo acceso de la aplicación; la
  interfaz actual no ofrece un selector de restauración de respaldos.
- Un fallo al crear o leer el respaldo puede dejar un archivo de respaldo
  incompleto en Drive. Nunca se elimina automáticamente; el archivo principal
  no se reemplaza cuando el respaldo no pasa la verificación.
- La acción heredada «Reiniciar y verificar copia» sigue siendo manual, con
  confirmaciones separadas. No se usa para resolver conflictos.

## Verificación

`node tests/drive-sync.test.js` prueba el flujo con Drive simulado y datos
ficticios. `node tests/recurrence.test.js` cubre la regresión de la Corrección
14. No se prueba OAuth ni una cuenta real de Google Drive.
