# Mejora 27 - Google Calendar

## Funcionamiento

Calendar usa un token OAuth temporal en memoria con el scope `calendar.app.created`, separado de Google Drive. La usuaria debe pulsar **Conectar**; tras recargar o expirar la autorización debe hacerlo de nuevo. No se guarda el token en `localStorage`. El calendario secundario se reconoce por nombre, descripción marcada e ID verificado; nunca se usa el calendario principal ni uno que coincida solo por nombre. Si aparecen varios calendarios marcados, se detiene la sincronización.

Los gastos pendientes con fecha válida se representan como eventos individuales con ID determinista por movimiento. Se listan todas las páginas antes de reconciliar. La creación se verifica por lectura, y una respuesta perdida se resuelve buscando el mismo ID. La ficha del movimiento se abre por enlace aunque haya filtros activos; si no existe localmente, se ofrece abrir el panel de Drive. El enlace no cambia datos financieros.

La interfaz habilita ediciones y eliminaciones condicionales. Solo se intentan si existe una transición local observada, el evento remoto aún coincide con la base anterior y trae ETag. `PATCH` y `DELETE` envían `If-Match`; HTTP 412 deja el evento remoto intacto, conserva la operación local pendiente y señala un conflicto. No se reintenta la misma escritura a ciegas. La lectura posterior verifica las escrituras aceptadas.

El diario `mis-finanzas-calendar-v1` guarda solo autorización deseada, ID del calendario, recordatorios y cambios de Calendar pendientes. No modifica `mis-finanzas-offline-v1` ni la base remota de Drive. Los recordatorios aceptan hasta cinco valores únicos entre 0 y 40320 minutos. Se sincronizan automáticamente los cambios locales mientras el token sea válido; si no hay internet o autorización, quedan pendientes y se reintentan al reconectar o pulsar **Sincronizar ahora**.

## Regla conservadora multidispositivo

- Un evento no se elimina porque su movimiento falte en la copia local. Para borrar por pago o eliminación lógica se requiere una transición local observada y guardada, un evento remoto igual al anterior y su ETag. Una ocurrencia futura distinta conserva su evento.
- Si Drive trae un movimiento ya pagado pero Calendar aún conserva el evento y este dispositivo no observó la transición, se muestra conflicto. No se elimina el evento ni se informa una sincronización completa.
- Una edición se aplica solo si el evento sigue coincidiendo con la versión local anterior. Una respuesta distinta o un ETag cambiado deja el caso pendiente.
- En un calendario ya existente, un pendiente antiguo sin historial local de alta o reversión no genera automáticamente un evento ausente: podría haber sido pagado en otro dispositivo. El caso se informa como conflicto. Las altas locales observadas y las reversiones sí se pueden crear con ID determinista.
- La primera activación en un calendario recién creado incorpora los pendientes locales. Si otra copia estaba desactualizada, esa incorporación inicial puede requerir revisión humana. No se fusionan movimientos ni se decide qué dispositivo tiene razón.

## Verificación

- [Ensayo HTTPS aislado para Google Calendar real](ensayo-calendar-local.md): usa un calendario temporal y datos ficticios desde el navegador, en un sitio separado. No usa la aplicación ni Drive.
- **Evidencia comunicada por la usuaria, no ejecutada por Codex:** el ensayo aislado con su cuenta creó el calendario temporal y el evento ficticio. Una edición con ETag antiguo devolvió HTTP 412 y una eliminación con ETag antiguo devolvió HTTP 412; la página informó que ambas condiciones ETag se superaron. La usuaria confirmó que eliminó el calendario temporal, retiró el origen OAuth temporal de Google Cloud y eliminó el proyecto de Netlify. No se inspeccionaron directamente los registros de Google de ese ensayo.
- `node tests/calendar-sync.test.js`: creación, edición, pago, reversión, borrado lógico, ocurrencia futura, reintento, respuesta perdida, paginación, recordatorios, dos dispositivos, copia atrasada, conflicto, desconexión y HTTP 412 de `PATCH` y `DELETE` simulados.
- `CHROMIUM_PATH=/usr/bin/chromium node tests/calendar-ui.test.js`: enlace a ficha y opción de Drive para movimiento ausente a 375 y 1280 px con datos ficticios. Capturas en `docs/capturas-mejora-27/`.
- `CHROMIUM_PATH=/usr/bin/chromium node tests/calendar-app-bridge.test.js`: con Calendar simulado, formulario real, edición, pago, reversión, edición sin conexión, reconexión y recurrencias mensual y personalizada; verifica `If-Match` y vínculos financieros.
- Tras integrar `main` con las Mejoras 31-34 se ejecutaron también las pruebas de deseos, importes, historial, creación contextual, escritorio, saldos, proyección, recurrencias, Drive simulado, PWA y actualización de caché. El shell integrado usa `CACHE_VERSION = 18` y precarga ambos scripts de Calendar.
- Ejecutar además `tests/pwa-cache.test.js`, `tests/pwa.test.js`, `tests/drive-sync.test.js`, `tests/recurrence.test.js` y `tests/desktop-layout.test.js` antes de integrar.

## Límites y riesgos pendientes

El ensayo real comunicado verificó el rechazo de ETag antiguo en la página aislada, pero Codex no ejecutó pruebas contra Calendar real ni probó la aplicación integrada con dos dispositivos. Tampoco se verificó que `calendarList.list` muestre inmediatamente un calendario recién creado en otro dispositivo. Dos creaciones simultáneas podrían dejar calendarios duplicados; la app se detiene cuando detecta más de uno, pero no puede impedir la carrera anterior. El ETag protege el evento que se edita o elimina, no decide cuál copia financiera es correcta. Tampoco se garantiza la entrega puntual de avisos por Google ni la autorización persistente tras recargar. Antes de publicar, validar la PR integrada en un entorno aislado autorizado con dos dispositivos, retrasos de visibilidad, pagos recurrentes y cambios simultáneos. No usar datos financieros reales ni la configuración de Drive para ensayos destructivos.

La rama y la PR siguen en borrador. No fusionar ni desplegar sin autorización.
