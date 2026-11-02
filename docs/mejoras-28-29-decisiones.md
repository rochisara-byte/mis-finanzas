# Mejoras 28 y 29: decisiones de integridad

- El movimiento sigue siendo la fuente de verdad para importes reales y pendientes. No se crea una segunda tabla de movimientos ni se cambia la clave local.
- Una serie nueva conserva `recurrenceAmount` en sus ocurrencias. `recurrenceAmountReview` identifica un legado cuyo importe habitual no puede determinarse sin adivinar. `amountAdjusted` marca excepciones individuales. Estos campos son opcionales en copias `version: 1` y viajan en el JSON existente de Drive.
- Para un legado sin importe habitual, incluso si varias ocurrencias tienen el mismo importe, no se infiere un valor histórico: podría ser un pago ajustado. La interfaz solicita elegir el valor habitual antes de extender la serie. Ningún pago histórico se reescribe.
- No se vinculan recurrencias por coincidencia de título, fecha o importe. Se usan únicamente `recurrenceParentId`, `generatedNextId` y `recurrenceRootId` existentes.
- Cambiar el valor habitual afecta sólo pendientes futuros de la misma serie que no tengan `amountAdjusted`. El valor de una ocurrencia pagada nunca se reescribe. Deshacer un pago no borra el siguiente movimiento generado, pues podría contener cambios legítimos.
- Inicio aplica filtros de presentación a los movimientos existentes; Historial consulta la misma colección. Los saldos y proyecciones siguen usando los cálculos existentes, independientemente del período visible.
- Drive v1 conserva su resolución conservadora de conflictos. Estos campos no habilitan una fusión multidispositivo automática; dos dispositivos divergentes siguen requiriendo decisión explícita y respaldo.

## Migración y límites

- No hay migración al iniciar: abrir la app o descargar un respaldo no cambia registros. Al editar una recurrencia antigua sin `recurrenceAmount`, se exige introducir el valor habitual; sólo entonces se guarda el nuevo campo. Antes de esa revisión no se crea un siguiente vencimiento basado en un pago potencialmente excepcional.
- En movimientos completados antiguos sin `completedAt`, Inicio utiliza la fecha del movimiento para aproximar los últimos siete días. Historial conserva acceso a todos ellos.
- La sincronización de Drive sigue siendo v1 y no fusiona cambios concurrentes. Hay que resolver explícitamente un conflicto entre dispositivos; no se probó una cuenta real de Google Drive.
- Dos pruebas heredadas de la Mejora 24 (`mejora-24-integracion` y `mejora-24-reconciliacion`) contienen aserciones de texto que ya no están en `origin/main`; fallan también frente a la versión base y no prueban este cambio. Las pruebas financieras, de Drive, recurrencias, escritorio y PWA actuales sí se ejecutan por separado.
