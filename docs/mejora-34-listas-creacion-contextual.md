# Mejora 34: Listas y creación contextual

## Formularios auditados

| Formulario | Elementos administrables | Control contextual |
| --- | --- | --- |
| Movimiento nuevo y edición, también recurrente | Categoría, cuenta, cuenta destino, lista, meta/deuda vinculada, deseo | `+` junto al selector; el formulario y sus importes permanecen abiertos |
| Deseo nuevo y edición | Categoría, lista, meta de ahorro, cuenta prevista | `+` junto al selector |
| Presupuesto nuevo y edición | Categoría | `+` junto al selector |
| Abono a deuda o meta | Cuenta de origen | `+` junto al selector; no crea el abono al crear la cuenta |
| Cuenta, lista, meta y deuda independientes | Sus campos propios | No contienen selectores administrables relacionados |
| Configuración, búsqueda, filtros y preferencias | Opciones del sistema | Sin botón de creación |

La subcategoría existente es texto libre en movimientos y deseos. No existe una colección de subcategorías ni un campo de ícono por subcategoría en `version: 1`; se conserva así para evitar un cambio de esquema y una migración no autorizada. Tipo y estado de movimiento, tipo de deseo, repetición y tipo de cuenta son opciones fijas, no elementos nuevos.

## Comportamiento y datos

- Listas usa dos columnas desde 768 px (Mis listas a la izquierda y Listas inteligentes a la derecha). Lista de deseos queda debajo; en móvil se apilan. No se alteraron elementos ni acciones.
- El panel secundario se inserta dentro del formulario, sin abrir otra capa modal. Cancelar no modifica los datos ni el formulario principal.
- Se comprueban nombres vacíos y duplicados, tipo de cuenta, saldo inicial y valores positivos de metas, deudas y deseos. La categoría exige un ícono de la colección existente. Se usan las colecciones e identificadores actuales; no hay migración ni clave nueva.
- Cada creación se persiste y la opción recién creada se selecciona. Las otras entradas del formulario permanecen intactas. Crear una cuenta, meta, deuda o deseo no crea un movimiento financiero.
- La lógica de `saveQuickMovement`, recurrencias, saldos, presupuestos, importación/exportación y Drive no se modificó. El service worker pasa a caché 17 con la huella del shell final.

## Pruebas superadas

- `tests/mejora-34.test.js` a 375 y 1280 px: columnas/apilamiento, creación inmediata de categoría e ícono, lista, cuenta, meta, deuda y deseo; duplicados; cancelación; datos del formulario preservados; guardado y edición de movimiento con importe decimal; deseo editado; presupuesto; abono; recarga; exportación e importación JSON; ausencia de segundo modal y desbordamiento horizontal.
- Regresiones: `wishlist`, `integration-31-33`, `mejora-33`, `mejora-32`, `desktop-layout` a 320-1440 px, `mejora-30`, `mejoras-28-29`, `projection-preferences`, `mejora-24`, `saldo-diagnostico`, `recurrence`, `drive-sync` simulado, `pwa-cache` y `pwa`.
- Capturas con datos ficticios a 375 y 1280 px: `docs/capturas-mejora-34/listas-*.png`, `formulario-*.png` y `creacion-contextual-*.png`.

## Limitaciones

- No se ejecutó una sincronización con una cuenta real de Google Drive. Las pruebas de Drive usan datos ficticios y un adaptador simulado.
- La instalación PWA en dispositivos reales no se repitió; se verificaron shell, caché, transición de versión y apertura sin conexión mediante navegador automatizado.
- Las pruebas estáticas antiguas `mejora-24-integracion` y `mejora-24-reconciliacion` buscan textos ausentes ya en `main`; la prueba funcional vigente de cálculos pasó.
