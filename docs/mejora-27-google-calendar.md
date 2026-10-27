# Mejora 27 - Google Calendar

## Funcionamiento

Calendar usa un token OAuth temporal en memoria con el scope `calendar.app.created`, separado de Google Drive. La usuaria debe pulsar **Conectar**; tras recargar o expirar la autorización debe hacerlo de nuevo. No se guarda el token en `localStorage`. El calendario secundario se reconoce por nombre, descripción marcada e ID verificado; nunca se usa el calendario principal ni uno que coincida solo por nombre. Si aparecen varios calendarios marcados, se detiene la sincronización.

Los gastos pendientes con fecha válida se representan como eventos individuales con ID determinista por movimiento. Se listan todas las páginas antes de reconciliar. La creación se verifica por lectura, y una respuesta perdida se resuelve buscando el mismo ID. La ficha del movimiento se abre por enlace aunque haya filtros activos; si no existe localmente, se ofrece abrir el panel de Drive. El enlace no cambia datos financieros.

**Compuerta de seguridad:** en la interfaz publicada por esta rama, las ediciones y eliminaciones remotas permanecen bloqueadas (`allowConditionalMutations: false`). El motor admite probarlas en simulación, pero no se habilitan con una cuenta real hasta verificar que Google Calendar cumple `If-Match` de forma atómica. Por tanto, el pago, edición o borrado puede quedar marcado como conflicto y conservar el evento anterior. Este es un límite deliberado, no una sincronización completa lista para producción.

El diario `mis-finanzas-calendar-v1` guarda solo autorización deseada, ID del calendario, recordatorios y cambios de Calendar pendientes. No modifica `mis-finanzas-offline-v1` ni la base remota de Drive. Los recordatorios aceptan hasta cinco valores únicos entre 0 y 40320 minutos. Se sincronizan automáticamente los cambios locales mientras el token sea válido; si no hay internet o autorización, quedan pendientes y se reintentan al reconectar o pulsar **Sincronizar ahora**.

## Regla conservadora multidispositivo

- Un evento no se elimina porque su movimiento falte en la copia local. Para borrar por pago o eliminación lógica se requiere una transición local observada y guardada, un evento remoto igual al anterior y su ETag. Una ocurrencia futura distinta conserva su evento.
- Una edición se aplica solo si el evento sigue coincidiendo con la versión local anterior. Una respuesta distinta o un ETag cambiado deja el caso pendiente.
- En un calendario ya existente, un pendiente antiguo sin historial local de alta o reversión no genera automáticamente un evento ausente: podría haber sido pagado en otro dispositivo. El caso se informa como conflicto. Las altas locales observadas y las reversiones sí se pueden crear con ID determinista.
- La primera activación en un calendario recién creado incorpora los pendientes locales. Si otra copia estaba desactualizada, esa incorporación inicial puede requerir revisión humana. No se fusionan movimientos ni se decide qué dispositivo tiene razón.

## Verificación

- [Ensayo local aislado para Google Calendar real](ensayo-calendar-local.md): usa un calendario temporal, datos ficticios y un lanzador Windows sin instalar programas. No usa la aplicación ni Drive.
- `node tests/calendar-sync.test.js`: creación, edición, pago, reversión, borrado lógico, ocurrencia futura, reintento, respuesta perdida, paginación, recordatorios, dos dispositivos, copia atrasada, conflicto y desconexión simulados.
- `CHROMIUM_PATH=/usr/bin/chromium node tests/calendar-ui.test.js`: enlace a ficha y opción de Drive para movimiento ausente en 390 y 1280 px con datos ficticios.
- Ejecutar además `tests/pwa-cache.test.js`, `tests/pwa.test.js`, `tests/drive-sync.test.js`, `tests/recurrence.test.js` y `tests/desktop-layout.test.js` antes de integrar.

## Límites y bloqueo para publicación

No se hicieron pruebas con credenciales ni calendarios reales. Las pruebas simuladas no demuestran que Google Calendar API acepte y haga cumplir `If-Match` de forma atómica en `PATCH` y `DELETE`, ni que `calendarList.list` muestre inmediatamente un calendario recién creado en otro dispositivo. Dos creaciones simultáneas podrían dejar calendarios duplicados; la app se detiene cuando detecta más de uno, pero no puede impedir la carrera anterior. Tampoco se garantiza la entrega puntual de avisos por Google ni la autorización persistente tras recargar. Antes de publicar, probar en una cuenta y proyecto de ensayo autorizados, con dos dispositivos, retrasos de visibilidad y ETags concurrentes. Si Google ignora las precondiciones, mantener bloqueadas las actualizaciones y eliminaciones automáticas y diseñar una alternativa segura.

La rama y la PR siguen en borrador. No fusionar ni desplegar sin autorización.
