# Mejora 21A.2: preparacion de validacion con Drive real

## Estado y limite de seguridad

**No se ejecutaron pruebas contra Google Drive real.** No hay una aplicacion OAuth aislada, tokens ni autorizacion especifica para este experimento en el entorno. No se usara la conexion actual de Mis Finanzas. Esta rama solo agrega un adaptador experimental, un diario local separado y pruebas HTTP simuladas. `index.html`, la sincronizacion v1 y los datos locales/remotos siguen intactos. La fusion automatica y Mejora 21B permanecen bloqueadas.

Esta PR se apoya en la [auditoria de la PR #9](https://github.com/rochisara-byte/mis-finanzas/pull/9), el [prototipo de la PR #10](https://github.com/rochisara-byte/mis-finanzas/pull/10) y `docs/mejora-21a-protocolo-drive.md`. La PR #10 aun no forma parte de `main`; esta rama depende de ella y su PR debe apuntar a esa rama para no mezclar diffs.

## Investigacion de API v3

| Operacion | Uso experimental | Condicion que aun requiere Drive real |
| --- | --- | --- |
| [`files.create`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create) | Alta multipart de un archivo JSON inmutable en `appDataFolder`; lectura por ID inmediatamente despues. | Confirmar durabilidad, lectura tras respuesta perdida y comportamiento ante corte durante la subida. Un POST ambiguo puede dejar un archivo creado, por lo que el ID logico del commit debe ser estable. |
| [`files.list`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list) | Filtrar `spaces=appDataFolder` y nombre experimental; recorrer `nextPageToken`, rechazar `incompleteSearch`. | Medir retraso de visibilidad y efectos de altas entre paginas. La documentacion advierte que los resultados esperados pueden variar si se agregan archivos durante la paginacion. |
| [`files.get`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get) | Leer `alt=media` solo para IDs obtenidos de `create`, `list` o `changes.list`, y verificar el hash del commit. | Confirmar contenido identico tras crear y despues de cerrar/reabrir clientes; probar errores transitorios. |
| [`changes.getStartPageToken`](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/getStartPageToken) / [`changes.list`](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list) | Obtener token **antes** del listado, paginar los cambios con `spaces=appDataFolder`, `restrictToMyDrive=false` y no avanzar el cursor hasta `newStartPageToken`. | Verificar que un alta oculta temporalmente al listado aparezca en el feed; medir latencia y metadatos disponibles. Un cambio sin metadatos se trata como ambiguo y detiene el avance. |

No se encontro ni se probo una precondicion atomica utilizable para el `PATCH` del archivo v1. El adaptador no implementa `PATCH` ni `DELETE`. El feed de cambios ayuda a recuperar altas ocurridas **despues** del token inicial, pero no certifica que un archivo anterior a ese token y omitido por el listado haya sido descubierto. Tampoco prueba ausencia de escrituras posteriores al token final. Por eso `discoverWithChanges()` devuelve `observado-hasta-token-sin-garantia-global`, nunca `Al dia`.

## Componentes nuevos

- `prototype/drive-21a2-adapter.js`: adaptador HTTP inyectable; exige opt-in, token en memoria y namespace `mf21a2-` unico. No obtiene tokens, no inicia OAuth y no posee ejecutable de red automatico. Solo usa `POST files.create` y `GET` de listados, cambios y contenido. No incluye el token en URLs, errores ni salidas.
- `prototype/drive-21a2-journal.js`: checkpoint experimental en un directorio **fuera** del repositorio, archivo temporal con permisos `0600`, `fsync` y renombrado. Rechaza claves que parecen credenciales. No guarda ni lee `localStorage`. El llamador debe guardar el checkpoint antes de transmitir; un corte antes de guardarlo deja un movimiento solo en memoria.
- `tests/drive-21a2-adapter.test.js`: API de Google simulada a nivel HTTP y dos clientes independientes. Los importes y cuentas son inventados. El mock verifica que no se envian `PATCH`/`DELETE` ni se lee por ID un archivo fuera del namespace.

La opcion `approvedTestEnvironment: true` es una afirmacion **del operador**, no una prueba criptografica de la identidad del cliente OAuth o de la cuenta Google. El adaptador no debe usarse con un token de produccion. No hay runner para Drive real precisamente para impedir una ejecucion accidental con la configuracion actual.

## Preparacion de una prueba real futura (no ejecutada)

1. Obtener autorizacion explicita para un **proyecto Google Cloud/OAuth nuevo**, una cuenta Google de prueba separada y dos sesiones/clientes de prueba. Habilitar Drive API v3 y conceder solo `https://www.googleapis.com/auth/drive.appdata` al proyecto de prueba. No reutilizar el client ID, cuenta, tokens o configuracion de Mis Finanzas publicada.
2. Confirmar manualmente la identidad del proyecto, la cuenta y el alcance del token antes de usarlo. La libreria no verifica automaticamente el `audience` del access token. Si esa comprobacion no esta disponible, no ejecutar el experimento. Usar tokens de corta vida solo en memoria de los dos procesos; nunca ponerlos en comandos con argumentos visibles, archivos, trazas ni Git.
3. Elegir un namespace aleatorio `mf21a2-` seguido de 16 a 32 caracteres alfanumericos minusculos; documentar ese valor fuera del repositorio. Usar **el mismo** namespace y aplicacion de prueba en ambos clientes. Confirmar que no existan archivos con ese prefijo antes de la primera escritura. La consulta de archivos filtra por nombre; `get` solo acepta IDs devueltos dentro del experimento.
4. Preparar un directorio de diario por cliente fuera del repositorio, con permisos privados y sin datos reales. Los procesos deben cargar el checkpoint al abrir, guardar tras cada `stage()` **antes** de intentar `create`, y volver a guardar tras confirmar lectura/listado. La prueba de reinicio debe terminar el proceso entre la escritura y su respuesta, luego reabrir con el mismo diario.
5. Capturar un token de cambios antes de crear el lote. Iniciar dos procesos independientes, crear un movimiento ficticio distinto en cada uno, forzar subidas simultaneas, listados con pagina pequena y recuperacion por `changes.list`. Repetir con ambos offline, respuesta perdida, interrupcion, reintento y reinicio. Comparar IDs logicos y hashes en ambos clientes y hacer lecturas repetidas a intervalos definidos; anotar tiempos de visibilidad sin inferir garantia global a partir de la mera repeticion.
6. No borrar archivos de prueba automaticamente. Antes de cualquier limpieza futura, registrar IDs/hashes y aprobar por separado un procedimiento que verifique namespace, cuenta, proyecto y respaldo. No tocar archivos v1 ni respaldos de Mis Finanzas.

El paso 2 y la autorizacion especifica faltan hoy. No se crearon recursos Google, no se solicitaron credenciales y no se hicieron llamadas a `appDataFolder` real.

## Resultados

Ejecutar desde la raiz: `node --test tests/drive-21a2-adapter.test.js tests/drive-21a-prototype.test.js tests/drive-sync.test.js tests/recurrence.test.js`.

**Pruebas simuladas superadas:** 8 casos nuevos de HTTP/adaptador/diario, 16 del protocolo inmutable de la PR #10, 33 de Drive v1 y 10 de recurrencias. Cubren altas simultaneas, offline, reintento con archivos fisicos duplicados pero un solo movimiento logico, reinicio con diario, paginacion de listados y cambios, alta omitida por el listado recuperada desde el feed, archivo parcial, fallo de autenticacion, commit eliminado y rechazo de lecturas fuera del namespace. El diario corrupto o con credenciales se rechaza.

**Pruebas reales ejecutadas:** ninguna. **Pendientes:** todas las mediciones de durabilidad, retraso de visibilidad, consistencia de paginacion, `changes.list`, respuestas ambiguas y reinicio contra Google Drive real. No se puede afirmar que la simulacion demuestre seguridad ante concurrencia real.

## Coexistencia con clientes v1 y recomendacion

El archivo `mis-finanzas-sync-v1.json` y sus respaldos quedan intactos. Una futura migracion debe comparar copias v1 completas y compatibles, preservar ajustes locales, solicitar decision ante divergencias y guardar un genesis verificable sin borrar la version anterior. El hash base v1 no es un ancestro completo. Un cliente v1 puede seguir escribiendo el archivo principal despues de crear el genesis experimental; eso es una rama externa no representada por commits. Mientras no exista deteccion fiable y una politica aprobada para ella, no se puede afirmar convergencia ni mostrar `Drive · Al dia` en el protocolo nuevo. Tampoco se deben fusionar por defecto cuentas, listas, presupuestos, metas, deudas o recurrencias antiguas.

**Recomendacion:** mantener 21B bloqueada. El registro inmutable es una candidata prometedora bajo las premisas simuladas, pero falta validar el comportamiento real de Drive, persistencia del diario, cobertura de todas las entidades y convivencia v1. Si no se puede demostrar una vista completa o una recuperacion segura, conservar la resolucion manual de conflictos existente.
