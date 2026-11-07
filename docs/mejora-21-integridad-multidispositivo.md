# Mejora 21: integridad de la sincronizacion multidispositivo

## Estado y decision

**Bloqueada para implementacion automatica.** Esta rama solo documenta la auditoria. No cambia la aplicacion, el almacenamiento, los datos ni el protocolo de Google Drive. La condicion de parada de la solicitud aplica: con el protocolo actual no se puede demostrar que dos dispositivos que escriben al mismo tiempo conserven ambos cambios. Una fusion automatica sobre este protocolo prometeria una seguridad que no ofrece.

## Modelo y operaciones auditadas

La aplicacion persiste un unico objeto bajo `mis-finanzas-offline-v1`. `persist()` guarda el objeto completo, incrementa una revision global local y actualiza `updatedAt`; no conserva un historial ni versiones por entidad. `version: 1` contiene `device`, `revision`, `updatedAt`, `accounts`, `lists`, `categories`, `transactions`, `budgets`, `goals`, `debts` y `settings`. La exportacion/importacion JSON y la sincronizacion manual heredada pueden sustituir instantaneas completas.

| Entidad | Identidad, cambios y relaciones | Riesgo para la fusion |
| --- | --- | --- |
| Movimientos | `id`; alta, edicion, cambio de estado, aplazamiento, duplicado con nuevo ID y borrado logico (`deleted`). `account`, `toAccount` y `list` referencian otras entidades. `linkKind`/`linkId` conectan pagos con metas o deudas. | `created` no es una version de edicion. Igual ID con contenido diferente requiere ancestro; ausencia no demuestra borrado. Las transferencias necesitan cuentas validas. |
| Recurrencias | Relaciones explicitas `recurrenceParentId`, `recurrenceRootId`, `generatedNextId`, `generatedFrom`; el siguiente movimiento obtiene ID propio. | Un hijo omitido o una relacion divergente puede duplicar cuotas. Nunca deducir relaciones por fecha, importe o titulo. |
| Cuentas | `id`; alta y edicion de nombre/saldo inicial. | Cambiar saldo inicial afecta calculos. Un movimiento de otra copia puede referir una cuenta no presente. |
| Listas | `id`; alta, renombrado y borrado fisico que limpia referencias `list` en movimientos. | Esos cambios abarcan varias entidades; reintroducir la lista o sus referencias revierte un borrado. |
| Categorias | Cadenas e iconos en `settings.categoryIcons`; renombrar modifica movimientos y presupuestos; borrar exige que no queden referencias activas. | Una union de cadenas no conserva un renombrado ni sus referencias. |
| Presupuestos | `id` en registros nuevos, `category`, `amount`; alta/edicion y borrado fisico. Se aceptan formatos antiguos incompletos. | No todos los registros antiguos tienen identidad estable; una categoria renombrada cambia la clave semantica. |
| Metas y deudas | `id`; metas se crean y eliminan; deudas se crean, editan y eliminan. Movimientos de pago usan `linkKind`/`linkId`. | El borrado fisico deja referencias historicas potencialmente huerfanas; unir arreglos puede resucitar registros. |
| Ajustes | Configuracion local, incluida la de conexion; `snapshot()` excluye secretos de sincronizacion y `applyRemote()` conserva los ajustes locales. | No convertir ajustes por dispositivo en campos compartidos ni sobrescribirlos durante una descarga. |

Los identificadores nuevos provienen de `uid()` (UUID cuando esta disponible, con alternativa local). Su presencia permite distinguir altas independientes, **no** resolver por si sola ediciones, bajas ni colisiones de ID. Las referencias y las reglas financieras de transferencias, recurrencias y pagos forman parte de la integridad del conjunto.

## Protocolo actual de Drive y bloqueo

El archivo principal `mis-finanzas-sync-v1.json` reside en `appDataFolder`. La seleccion remota ordena por `modifiedTime` y rechaza una copia mas reciente corrupta o ambigua. `normalizeRemote()` acepta `version: 1` y algunos archivos antiguos incompletos. La base local `mis-finanzas-google-drive-base-v1` guarda un **hash** de la instantanea sincronizada (sin `settings`), no el contenido de un ancestro comun. La revision y fecha del objeto son locales; no establecen causalidad entre dispositivos.

La Correccion 16 conserva un respaldo remoto independiente y verificado antes de reemplazar la copia principal en una resolucion manual. Se comprueba que las copias local y remota no hayan cambiado antes del `PATCH`, y se lee el resultado despues. Esas comprobaciones protegen muchos fallos, pero el `PATCH` del contenido es incondicional: no hay en el codigo una precondicion atomica de version remota demostrada. Tampoco basta comparar cantidades, marcas de tiempo o hashes de las dos puntas para reconstruir el ancestro.

Intercalado que pierde una alta independiente si se activase la fusion ingenuamente:

1. A y B leen el mismo remoto `R` y validan que no ha cambiado.
2. A prepara `R + movimiento_A`; B prepara `R + movimiento_B`.
3. Ambos respaldan `R` y vuelven a comprobar el remoto: sigue siendo `R`.
4. A escribe su copia; B escribe despues la suya con `PATCH`. El principal termina sin `movimiento_A`.
5. Los respaldos contienen `R`, no `movimiento_A`. Una lectura posterior puede confirmar la escritura de B; una lectura de A anterior a la escritura de B tambien puede haber confirmado la suya. Ninguna de ellas prueba persistencia frente a la escritura concurrente posterior.

El mismo riesgo existe al crear inicialmente el archivo si dos clientes no tienen un punto de serializacion. Releer justo antes de escribir solo acorta la ventana; no la elimina. La referencia de [Drive `files.update` v3](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update) describe la actualizacion de contenido, pero este proyecto no ha probado una operacion condicional atomica para ella. No se afirma que tal operacion sea imposible en cualquier infraestructura: **no se puede basar la seguridad de esta implementacion en una garantia no verificada**.

Ademas, con `version: 1` el hash de base no es reversible. Si dos instantaneas antiguas difieren, no hay manera general de saber si un elemento ausente fue eliminado, nunca existio o se perdio en una sustitucion previa. El borrado fisico de listas, presupuestos, metas y deudas carece de tombstones. La normalizacion de colecciones opcionales ausentes a vacias facilita leer copias antiguas, pero esa ausencia no puede interpretarse como una eliminacion verificable. Un cambio concurrente en una cuenta, un presupuesto o una categoria puede alterar los calculos aun cuando los movimientos conserven sus IDs.

## Arquitectura necesaria antes de habilitar la fusion

1. **Escritura sin perdida demostrable.** Evaluar y probar con dos clientes reales una precondicion atomica de actualizacion del archivo principal. Si Drive v3 no ofrece una garantia utilizable aqui, disenar un registro de commits inmutables en `appDataFolder` (archivos con ID propio, nunca sobrescritos), con descubrimiento exhaustivo de ramas, validacion y compactacion solo despues de probarla. La eleccion requiere pruebas de carreras, paginacion/listado y fallos parciales; no se supone que un archivo mas reciente sea el ganador. Conservar el archivo v1 y todos los respaldos.
2. **Ancestro verificable.** Guardar una instantanea base completa y su hash, asociada a una version/commit remoto comprobable. Un hash aislado no permite fusion de tres vias. Sin ancestro comun valido, detener la fusion y ofrecer resolucion explicita de copias.
3. **Cambios por entidad.** Para cada ID, comparar ancestro, local y remoto. Alta unilateral: incluirla una sola vez. Cambios identicos: incluirlos una vez. Edicion contra edicion distinta o borrado contra edicion: conflicto, sin eleccion por fecha. Registrar tombstones durables para las bajas y preservar sus IDs; no resucitar ausencias. Extender la comparacion a cuentas, listas, presupuestos, metas, deudas, categorias y ajustes compartibles. Mantener ajustes de dispositivo fuera de esa fusion.
4. **Integridad referencial.** Validar cuentas origen/destino, listas, categorias, pagos vinculados y el grafo explicito de recurrencias antes de confirmar. No fabricar relaciones de recurrencia por coincidencia de atributos. Un cambio de nombre/categoria que transforma otras entidades debe tratarse como operacion coordinada o conflicto. Ante IDs duplicados con contenido incompatible, detenerse.
5. **Migracion optativa y reversible.** Admitir lectura de `version: 1`. Crear la nueva base solo cuando ambas instantaneas coincidan exactamente tras la normalizacion segura y se haya verificado su copia completa, o cuando la usuaria resuelva explicitamente una divergencia. Nunca interpretar bases antiguas como ancestros completos, ni convertir silenciosamente ausencias antiguas en tombstones. Conservar claves actuales, archivo principal y respaldos sin limpiar `localStorage` o `appDataFolder`. La migracion debe coexistir con clientes v1: mientras alguno pueda seguir escribiendo el archivo antiguo, hay que detectar esa escritura y bloquear o revalidar la fusion.
6. **Confirmacion de sincronizacion.** Antes de cualquier reemplazo, crear y leer un respaldo verificable de la copia remota; comprobar de forma atomica que la version leida sigue vigente o escribir un commit inmutable. Ante cambio concurrente, releer y reevaluar desde el ancestro (reintentos acotados). Leer y validar la copia escrita y sus referencias; mostrar `Drive · Al día` solo tras comprobar que el estado confirmado incluye los cambios elegidos de ambos lados. Cualquier ambiguedad deja ambas copias intactas y el estado pendiente/conflicto.

La opcion de commits inmutables podria permitir colaboracion sin servidor externo, pero exige un protocolo completo de descubrimiento, identidad, causalidad, recuperacion y convivencia con el archivo v1. **No se ha validado esa opcion ni se ha seleccionado como implementacion.** Hasta entonces, el flujo manual de conflictos existente permanece tal cual.

## Pruebas requeridas para una implementacion futura

| Escenario | Criterio minimo |
| --- | --- |
| Alta en celular y lectura en computador | Un movimiento, mismo ID y referencias, en ambos tras reconectar. |
| Altas distintas offline | Ambas se conservan tras sincronizar en cualquier orden. |
| Reintentos/recarga | Mismos IDs y conteos; ninguna cuota recurrente extra. |
| Edicion simultanea del mismo movimiento | Conflicto explicito; ninguna edicion se descarta. |
| Borrado contra edicion | Conflicto o regla consentida; la baja no resucita sola. |
| Transferencias y pagos vinculados | Cuentas, metas/deudas, listas y grafo de recurrencia coherentes. |
| Recurrencias nuevas y antiguas ambiguas | Un solo siguiente por vinculo explicito; sin inferencias por atributos. |
| Dos escrituras concurrentes a Drive | Intercalados forzados antes/despues de la comprobacion, respaldo y escritura; ninguna alta desaparece. |
| Red, OAuth, respaldo y verificacion | Fallo seguro, estado no `Al día`, copias recuperables. |
| Migracion `version: 1` | Copias iguales migran sin cambios; divergentes o incompletas requieren decision y conservan originales. |
| Otras entidades y ajustes | Ediciones/bajas concurrentes de cuentas, listas, presupuestos, metas, deudas y categorias no se pisan; ajustes locales permanecen locales. |

**Pruebas superadas en esta rama:** suites existentes `tests/drive-sync.test.js` y `tests/recurrence.test.js` con datos ficticios. Cubren validacion, conflictos manuales, respaldo, comprobacion posterior, reconexion y proteccion de recurrencias. Los mensajes de error de los casos de fallo inyectado son esperados.

**Pruebas no realizadas:** todos los escenarios de fusion automatica de la tabla, ensayos de simultaneidad contra Drive real y validacion de un mecanismo atomico o registro inmutable. No hay codigo de Mejora 21 que someter a esas pruebas. La continuidad offline y la compatibilidad v1 del sistema actual quedan amparadas solo por sus pruebas existentes, no por un protocolo multidispositivo nuevo.

## Decision pendiente

Seleccionar y demostrar un mecanismo de escritura sin perdida bajo concurrencia y un plan de convivencia con clientes v1. Despues se puede implementar la fusion de tres vias y sus pruebas, en otra PR, sin alterar los calculos financieros ni los datos actuales. Hasta disponer de esa garantia, activar una union automatica de movimientos o un reemplazo basado en fecha/numero de registros violaria el requisito central de integridad.
