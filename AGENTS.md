# AGENTS.md - Mis Finanzas

## Alcance
- Trabajar exclusivamente en este repositorio.
- No reconstruir la aplicacion desde cero.
- Conservar el diseno visual aprobado salvo instruccion explicita.
- Modificar solo los archivos necesarios para la tarea solicitada.
- Trabajar en una rama independiente. No integrar cambios en `main`, no hacer push, no publicar ni crear releases sin autorizacion explicita.

## Datos y almacenamiento
- No cambiar la clave `mis-finanzas-offline-v1`.
- No borrar, reiniciar, migrar ni transformar datos de usuario sin aprobacion explicita.
- Antes de tocar persistencia, importacion, exportacion o sincronizacion, documentar el riesgo y preservar compatibilidad con datos existentes.
- Validar cualquier cambio contra datos antiguos o incompletos; nunca asumir que todos los campos existen.
- Conservar compatibilidad con registros antiguos y recurrencias existentes.
- No incluir datos financieros reales, secretos OAuth, claves privadas, tokens, contrasenas ni credenciales en pruebas, fixtures o archivos del repositorio.

## Sincronizacion
- No eliminar ni degradar la sincronizacion con Google Drive `appDataFolder`.
- No modificar scopes, nombre del archivo remoto ni claves de sincronizacion local sin aprobacion.
- Mantener la sincronizacion manual heredada mientras exista en la app, salvo decision explicita.
- Proteger los datos durante sincronizaciones entre dispositivos, especialmente cuando existan cambios sin conexion.
- Evitar sobrescrituras silenciosas. Ante conflictos, conservar una ruta clara para exportar JSON y elegir version de forma consciente.
- No cambiar la base de comparacion, hashes o identificadores de sincronizacion sin explicar el impacto en dispositivos ya conectados.

## Logica financiera
- `done` afecta saldo real; `pending` afecta proyeccion.
- Ingresos suman, gastos restan y transferencias mueven dinero entre cuentas.
- Las cuentas `credit` no forman parte del saldo total actual.
- Presupuestos dependen de categoria por nombre.
- Deudas y metas dependen de movimientos vinculados con `linkKind` y `linkId`.
- Recurrencias no deben duplicar ocurrencias ni romper recurrencias existentes.
- Exigir pruebas de regresion antes de cambiar calculos financieros, saldos, proyecciones, presupuestos, deudas, metas, transferencias o recurrencias.
- Las pruebas financieras deben cubrir al menos datos existentes, datos antiguos/incompletos, movimientos `done`, movimientos `pending`, transferencias y movimientos eliminados logicamente.

## Interfaz movil
- Mantener la experiencia movil actual.
- No reordenar grandes bloques CSS ni reescribir la UI sin necesidad.
- Evitar cambios que tapen movimientos, navegacion inferior, boton flotante o formularios con teclado movil.
- Verificar la experiencia movil despues de modificar formularios, navegacion, gestos tactiles, modales, hojas inferiores o controles principales.

## Pruebas y verificacion
- Diferenciar claramente en el reporte final:
  - pruebas superadas,
  - pruebas no realizadas,
  - limitaciones del entorno.
- Para cambios de logica financiera, ejecutar o crear pruebas de regresion enfocadas antes de considerar la tarea terminada.
- Para cambios visuales o moviles, verificar al menos un viewport movil y uno de escritorio cuando el entorno lo permita.
- Si una prueba no puede ejecutarse, explicar por que y que riesgo queda.

## Flujo de trabajo
- Revisar `index.html` antes de editar areas relacionadas con la app.
- Usar cambios pequenos, trazables y faciles de revisar.
- No tocar `index.html`, sincronizacion ni logica financiera cuando la tarea sea solo documental.
- Reportar claramente que se toco, que no se toco, que se probo y cualquier riesgo residual.
