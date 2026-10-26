# Mejora 27 — Google Calendar (diseño e implementación)

## Alcance aprobado
- Sincronizar automáticamente movimientos de gasto pendientes con vencimiento a un calendario secundario privado `Mis Finanzas · Pagos`.
- Cada ocurrencia de una recurrencia es un evento independiente; marcar una como pagada elimina **solo ese evento**, no los futuros.
- Modificar fecha, concepto o valor actualiza solo el evento de la ocurrencia; desmarcar como pagada recrea el evento.
- Cada evento incluye concepto, importe COP, fecha y URL a Mis Finanzas con ID opaco del movimiento; el enlace abre su ficha cuando está disponible localmente, o solicita sincronizar Drive si falta.
- Recordatorios configurables (p. ej. 7, 3, 1 días y día de vencimiento); Google Calendar admite como máximo cinco overrides por evento. No se garantiza entrega puntual ni apertura directa de la app al tocar la notificación.
- Funcionamiento offline-first: cola de cambios pendiente; sincronizar Calendar solo cuando hay internet y autorización vigente. No modificar el flujo actual de Drive ni los datos financieros existentes.

## Decisiones técnicas
1. Reutilizar el OAuth Web Client ID ya configurado; pedir scope incremental `https://www.googleapis.com/auth/calendar.app.created` **separado** del scope `drive.appdata`.
2. Crear y almacenar el ID del calendario secundario; identificarlo además con metadatos verificables para recuperación entre dispositivos. No tocar el calendario principal.
3. Reconciliar eventos por `extendedProperties.private` con ID de movimiento y versión; no usar un evento de Google recurrente para representar toda la serie.
4. Reconciliación bidispositivo segura: mantener un solo evento por ID, obtener inventario de Calendar paginado antes de insertar, y reconciliar las eliminaciones solo contra los eventos propiedad de Mis Finanzas. Controlar respuestas 401/403/429, reintentos y operaciones parciales.
5. Evitar bucles por eventos de guardado y evitar copiar IDs de eventos a la base financiera si no son necesarios. La sincronización de Calendar no debe marcar movimientos como pagados ni cambiar su importe.
6. Enlaces directos deben validar identificador y abrir detalle sin ejecutar operaciones de escritura; contemplar caché PWA y la ausencia temporal de un movimiento hasta que Drive sincronice.
7. La primera activación requiere consentimiento explícito para Google Calendar; una vez concedido, la creación de eventos es automática. Debe poder desconectarse y deshabilitarse sin afectar Drive.
8. Para recurrencias generadas al pagar, no prometer eventos futuros que aún no existen en la base; decidir y probar si se generan anticipadamente sin alterar la semántica de las recurrencias.

## Criterios de aceptación
- Crear pendiente => 1 evento; repetir sincronización => 0 duplicados.
- Marcar una ocurrencia pagada => elimina solo su evento; futuras ocurrencias permanecen.
- Revertir a pendiente => se recrea el evento una vez.
- Editar monto, fecha o título => actualización del evento existente.
- Borrar movimiento => evento eliminado.
- Sin internet => finanzas funcionan; al reconectar se aplican cambios en Calendar.
- Dos dispositivos => no duplicados ni borrados ajenos; Drive conserva su resolución de conflictos.
- Revocar permiso => aviso claro, sin borrar datos locales ni romper Drive.
- Calendar no se sincroniza antes de que la usuaria autorice el acceso.
- Probar navegación al ID desde Android y escritorio; fallback cuando el ID no está disponible.

## Estado
- Google Calendar API habilitada en el proyecto Google Cloud «Mis Finanzas».
- Scope `calendar.app.created` añadido a la pantalla de consentimiento.
- Rama de trabajo `feature/mejora-27-google-calendar` creada. **Implementación funcional aún pendiente**.
- No fusionar con `main` ni desplegar hasta pasar pruebas y recibir aprobación explícita.
