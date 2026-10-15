# Corrección 15: sincronización segura con Google Drive

La sincronización usa el mismo archivo `mis-finanzas-sync-v1.json` en
`appDataFolder`, la misma autorización OAuth y las mismas claves locales.
No fusiona movimientos entre dispositivos.

## Selección y validación

- Se consultan todas las páginas de archivos con ese nombre. Se elige la copia
  más reciente por `modifiedTime`; el identificador ordena empates.
- Si la copia más reciente no se puede leer, está dañada o tiene una versión
  desconocida, se detiene la sincronización. No se recurre automáticamente a
  una copia anterior. Si dos archivos de la misma fecha contienen datos
  distintos, también se detiene. Ningún archivo se elimina durante la
  sincronización normal.
- Las cuentas y los movimientos deben existir y tener campos esenciales
  utilizables. Los identificadores repetidos y las colecciones presentes con
  formato incorrecto se rechazan. Las colecciones opcionales ausentes en
  copias antiguas se completan en memoria; las colecciones presentes pero
  dañadas nunca se sustituyen por listas vacías. Los movimientos antiguos sin
  `created` recuperan una fecha de creación derivada de su fecha registrada.

## Conflictos y copias locales

- Cuando ambas versiones cambiaron, la aplicación conserva el conflicto hasta
  que la persona elija. Usar Drive requiere dos confirmaciones y reemplaza
  los datos de este navegador. Cancelar conserva los datos locales y deja
  Drive intacto. Una reducción de colecciones remotas también requiere una
  elección explícita.
- Antes de aplicar una descarga o subir una copia se vuelven a comprobar las
  versiones. Después de subir se descarga el archivo para verificarlo. Si la
  copia local no se puede leer, no se sube nada.
- El hash de base sigue en `mis-finanzas-google-drive-base-v1`. Se reconocen
  hashes anteriores; los nuevos se calculan sobre los datos normalizados sin
  los ajustes de conexión propios del dispositivo. Así, recuperar una copia
  antigua sin ajustes no provoca conflictos repetidos. Las configuraciones
  locales de la sincronización manual se conservan al descargar de Drive.

## Límites

- Las copias anteriores permanecen en Drive. La aplicación usa la más reciente;
  no interpreta ni combina cambios que solo estén en las anteriores. Exportar
  JSON antes de resolver un conflicto sigue siendo recomendable.
- Los archivos antiguos que carecen de cuentas, movimientos o propiedades
  esenciales no se pueden recuperar con certeza y se rechazan. No se inventan
  importes, estados ni relaciones de recurrencia.
- La comprobación previa y la subida son dos solicitudes separadas a Drive.
  Un cambio remoto exactamente entre ambas todavía puede producir una carrera.
  La verificación posterior detecta discrepancias visibles, pero no recupera
  automáticamente una versión remota sobrescrita en esa ventana. Resolverlo
  por completo requeriría una operación condicional de Drive confirmada en
  producción o una estrategia de versiones acordada.
- La acción heredada de reinicio remoto sigue siendo manual y exige sus dos
  confirmaciones. No forma parte de la sincronización normal.
