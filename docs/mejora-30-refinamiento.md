# Mejora 30: refinamiento visual

Esta rama parte del commit `a78c4ba` de `feature/mejoras-28-29` (PR #19). La PR de la Mejora 30 debe revisarse contra esa rama; integrarla directamente en `main` antes de la PR #19 duplicaría cambios pendientes de revisión.

La agrupación por mes es sólo de presentación. Los meses se separan por subsección (`late:` y `next:`), conservan el orden y cuentan movimientos existentes. Las expansiones de mes y fecha se guardan únicamente en memoria durante la sesión. No se transforma ni persiste ningún registro por agruparlo.

En Análisis se reubican en una franja los nodos existentes de Presupuestos, Metas y Deudas. Se conservan importes, barras, acciones y controles originales; no se crean indicadores financieros nuevos. Las barras existentes de presupuestos y metas comparten un gris azulado, sin cambiar su porcentaje.

Las capturas y pruebas usan sólo datos ficticios. No se ha probado una cuenta real de Drive ni dispositivos físicos. Las dos pruebas heredadas de la Mejora 24 que buscan textos ausentes ya en la rama base siguen sin ser pruebas válidas de esta interfaz.
