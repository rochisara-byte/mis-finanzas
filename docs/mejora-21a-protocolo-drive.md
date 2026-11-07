# Mejora 21A: ensayo de protocolo multidispositivo en Google Drive

## Decision

**21B sigue bloqueada.** El prototipo demuestra propiedades de un modelo simulado, no garantias extremo a extremo de Google Drive. No se ha cambiado `index.html`, OAuth, `localStorage`, `appDataFolder` ni la aplicacion publicada. No se ha activado fusion automatica. El documento de la [auditoria de la PR #9](https://github.com/rochisara-byte/mis-finanzas/pull/9) describe la carrera de la copia principal v1.

## Investigacion de Drive API v3

- [`files.update`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update) documenta `PATCH` para actualizar un archivo. En esa referencia no se documenta una precondicion atomica de contenido equivalente a compare-and-swap. La [comparacion v2/v3](https://developers.google.com/workspace/drive/api/guides/v2-to-v3-reference) marca `Files.etag` y `files.list etag` como no disponibles en v3. El campo `version`/la fecha de modificacion pueden informar de cambios, pero **leerlos y despues hacer `PATCH` no es una operacion atomica**. No se probo `If-Match` con dos clientes reales; no se afirma que Google rechace siempre esa cabecera, solo que aqui no hay una garantia documentada y verificada para basar la seguridad en ella.
- [`files.create`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create) y [`appDataFolder`](https://developers.google.com/workspace/drive/api/guides/appdata) permiten crear archivos nuevos en el espacio privado de la aplicacion, usando el scope actual. Esta es la base de la alternativa inmutable, **sin modificar el archivo principal v1**.
- [`files.list`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list) exige paginar hasta agotar `nextPageToken`, admite `incompleteSearch` y advierte que cambios durante la paginacion pueden alterar los resultados esperados. Un listado exitoso no demuestra por si solo que ninguna escritura concurrente sea todavia invisible. La API de [`changes.list`](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list) acepta `spaces=appDataFolder`, `nextPageToken` y `newStartPageToken`; es una via a evaluar para recuperar cambios, pero este prototipo no la utiliza ni prueba sus garantias de observacion.

**Conclusion tecnica:** no usar `PATCH` del archivo unico para una fusion automatica. Un historial de commits inmutables elimina esa sobrescritura especifica **si** las altas se almacenan de forma durable, se pueden descubrir todas y nunca se borran. Esas premisas faltan por comprobar con Drive real.

## Prototipo aislado

`prototype/drive-21a.js` es un modulo Node que no carga la aplicacion. `tests/drive-21a-prototype.test.js` aporta un `FakeDrive` en memoria; no efectua llamadas a Google ni usa credenciales. Todos los importes e identificadores de pruebas son ficticios.

Cada archivo simulado guarda un commit con `protocol`, ID logico, raiz v1, padres causales y una operacion sobre un movimiento por ID; se adjunta SHA-256 del contenido canonico. La creacion es de solo adicion. Un reintento puede crear dos archivos fisicos, pero ambos tienen el mismo commit logico y contenido; la lectura los deduplica. El cliente conserva un diario de commits pendientes y puede exportar/restaurar un `checkpoint` en memoria. El llamador futuro tendria que persistir ese diario **antes** de transmitir: el prototipo no escribe en almacenamiento del navegador.

```text
               genesis v1 verificado (inmutable)
                         /          \
       dispositivo A: alta A      dispositivo B: alta B
                         \          /
              descubrimiento de ambas ramas
                  vista A + B, sin PATCH
```

`scan()` recorre todas las paginas recibidas y lee cada archivo. Rechaza archivos corruptos, IDs logicos con contenidos diferentes, paginas declaradas incompletas y padres ausentes. `resolve()` verifica ancestros, precondicion del registro y referencias a cuentas; aplica altas independientes, detecta edicion contra edicion y borrado contra edicion como conflictos. Una transferencia a una cuenta inexistente se rechaza. El borrado es un commit persistente, no la ausencia de un registro en una instantanea. Las recurrencias se identifican solo por IDs explicitos, nunca por fecha/importe/titulo. **No se implementa resolucion de conflictos** ni validacion completa del grafo de recurrencia.

Tras crear un commit, el cliente lo vuelve a leer y valida. Luego descubre el historial. El resultado sin conflicto se llama deliberadamente `locally-verified-only`, no `Al dia`: la simulacion permite ocultar temporalmente un archivo nuevo en un listado y demuestra que el cliente no puede saber que falta. Un fallo conserva el diario local y no sustituye la copia v1.

## Migracion propuesta desde `version: 1`

1. Exportar una copia de seguridad local y localizar/verificar el archivo v1 y sus respaldos existentes; no borrar ninguno. La migracion necesita autorizacion de producto antes de tocar datos reales.
2. Comparar una instantanea financiera **normalizada y completa** de ambos lados. Excluir metadatos por dispositivo y secretos (`device`, revisiones locales, ajustes OAuth), pero definir y probar exhaustivamente que campos son locales y cuales compartidos. El prototipo es mas estricto: `prepareGenesis()` exige igualdad del objeto v1 completo y rechaza colecciones ausentes o secretos; sirve de puerta de seguridad, **no** de migrador de produccion. Dos dispositivos v1 normales pueden diferir en `device` aun con las mismas finanzas.
3. Si hay divergencia, base de hash antigua, campos ambiguos o referencias antiguas incompletas, detener y pedir decision explicita. Nunca construir un ancestro ficticio ni deducir bajas de una coleccion vacia. Conservar `mis-finanzas-offline-v1`, `mis-finanzas-google-drive-base-v1`, `mis-finanzas-sync-v1.json` y respaldos sin mutarlos.
4. Solo con una base completa y verificada crear un genesis inmutable y registrar su identificador de forma durable. Dos intentos equivalentes pueden generar archivos fisicos duplicados; deben compartir el mismo ID logico/contenido. No iniciar nuevas escrituras automaticas hasta comprobar descubrimiento, recuperacion y convivencia con clientes v1.
5. Un cliente antiguo que siga escribiendo el archivo principal puede divergir del nuevo historial. Definir un periodo de transicion, deteccion de esas escrituras y bloqueo del estado `Al dia` o resolucion explicita. No se puede asumir que todos los dispositivos se actualicen al mismo tiempo.

## Resultados reproducibles

Ejecutar `node --test tests/drive-21a-prototype.test.js` desde la raiz. Pasan 16 casos simulados:

| Escenario | Resultado del modelo |
| --- | --- |
| Dos altas simultaneas conectadas y dos altas offline | Ambas ramas aparecen sin duplicar movimientos al descubrir todos los archivos. |
| Reintento tras respuesta perdida y reinicio con diario restaurado | Archivos fisicos repetidos; un solo commit logico y movimiento. |
| Lectura posterior fallida, red, autorizacion y listado fallidos | No se confirma sincronizacion; diario local conservado. |
| Dos ediciones simultaneas, borrado contra edicion y colision de ID | Conflicto explicito; sin eleccion silenciosa. Ediciones causalmente ordenadas si se aplican. |
| Transferencia y recurrencias con atributos iguales | Referencias a cuentas validadas; IDs distintos de recurrencia no se colapsan. |
| Paginacion, archivo corrupto/parcial y padre ausente | Operacion detenida, sin aplicar un historial incompleto. |
| Copias v1 iguales, divergentes e incompletas | Solo las completas e iguales producen genesis experimental. |
| Commit temporalmente invisible | La vista puede ser incompleta; nunca se declara `Al dia`. Al aparecer, converge. |

Las suites de regresion existentes de Drive y recurrencias tambien deben ejecutarse para comprobar que la rama no altera el sistema actual. El test simula fallos de autenticacion, pero **no prueba Google Identity Services ni el OAuth real**.

## Garantias del modelo y limites

**Demostrado solo en la simulacion:** si cada `create` produce un archivo durable y eventualmente descubrible, no hay `PATCH` ni borrado de commits, todos los padres son legibles y el diario pendiente persiste, las altas de IDs diferentes no se pisan. Un mismo ID con cambios incompatibles causa conflicto. El hash detecta corrupcion accidental, no proporciona autenticacion contra un actor con acceso al mismo `appDataFolder`.

**No demostrado en Drive real:** atomicidad/visibilidad de `files.create` ante fallos de red, retardo del listado, consistencia entre paginas, recuperacion de `changes.list`, retencion de archivos y cuotas, latencia/costo de leer todos los commits, autorizacion entre sesiones, escrituras de clientes v1 y durabilidad del diario local. Un listado que omita un commit recien creado puede producir una vista temporalmente incompleta; no existe en el prototipo un certificado de que la vista incluye todas las escrituras hasta un instante global. Una copia local/del navegador perdida antes de subir su commit no puede ser recuperada por Drive.

**Alcance deliberadamente incompleto:** solo operaciones sobre movimientos y cuentas fijas del genesis. Faltan cambios por entidad en cuentas, listas, presupuestos, metas, deudas, categorias, ajustes compartibles, links de pagos, tombstones generales, validacion de recurrencias completa y reglas de resolucion. El prototipo no debe conectarse a `index.html` ni utilizarse con datos financieros reales.

## Recomendacion para 21B

Continuar con la arquitectura inmutable **como candidata**, no como solucion aprobada. Antes de implementarla en la aplicacion: (1) ensayo controlado con cuenta/archivos ficticios en `appDataFolder` aislado, incluyendo dos clientes y fallos de conexion; (2) protocolo de descubrimiento con `changes.list` y un criterio verificable de hasta donde se han observado cambios, o mantener siempre un estado prudente; (3) diario durable con recuperacion tras cierre; (4) migracion v1 reversible y convivencia con clientes anteriores; (5) motor de fusion de tres vias para todas las entidades y sus referencias; (6) limites operativos y estrategia de compactacion que no borre respaldos ni commits sin prueba y autorizacion. Si cualquiera de estas garantias falla, mantener el conflicto manual actual y 21B bloqueada.
