# Mejora 19: estudio de conexión persistente de Google Drive

Consulta de fuentes: 17 de octubre de 2026. Este documento es una propuesta;
no autoriza un despliegue, un cambio de OAuth ni el uso de datos reales.

## Resumen y decisión recomendada

**No se puede prometer una conexión persistente segura usando únicamente el
GitHub Pages y el flujo actual.** Google Identity Services (GIS) entrega al
navegador un access token de duración limitada, no un refresh token. Pedir otro
token con `requestAccessToken()` puede abrir una ventana incluso con
`prompt: 'none'`, tal como ocurrió en producción. La Corrección 17.1 eliminó
esa solicitud automática. Guardar un refresh token en el navegador, un
repositorio o un archivo estático no es una alternativa aceptable. Google
recomienda el flujo de código con backend para el acceso sin presencia del
usuario. [Modelos de autorización de Google](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model),
[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

**Recomendación condicional:** mantener el frontend actual y estudiar un
backend-for-frontend (BFF) pequeño en Cloud Run, con flujo OAuth de código por
redirección iniciada solo con un clic, refresh token cifrado por usuario en
almacenamiento privado y cookie de sesión segura. El backend llamaría a Drive
por cuenta del usuario; el navegador no recibiría refresh tokens. No activar
este camino hasta validar dominio, costos, identidad y acceso al
`appDataFolder` existente. Si esas condiciones no se aprueban, conservar el
botón manual de la Corrección 17.1 es la opción más segura.

## Estado actual del repositorio

- `index.html` usa `google.accounts.oauth2.initTokenClient` y solicita
  `https://www.googleapis.com/auth/drive.appdata` solo tras una acción manual.
  `requestAccessToken({prompt:'select_account'})` entrega un access token que
  queda en memoria; al refrescar desaparece y se muestra «Requiere conexión».
- Los datos financieros permanecen en `mis-finanzas-offline-v1`. La base de
  comparación `mis-finanzas-google-drive-base-v1` no es una credencial ni
  prueba por sí sola la identidad del usuario.
- El cliente enumera `mis-finanzas-sync-v1.json` en `appDataFolder`, valida el
  archivo remoto, compara hashes y nunca descarga automáticamente versiones
  divergentes. La Corrección 16 exige elección explícita y doble confirmación;
  antes de sustituir Drive crea y verifica un respaldo independiente.
- La sincronización manual heredada y exportar/importar JSON son flujos
  separados. No deben usarse como almacén de tokens de Google.

## Alternativas

| Alternativa | Persistencia sin ventana automática | Costo orientativo | Complejidad y riesgo |
| --- | --- | --- | --- |
| Solo GitHub Pages y GIS actual | No. Tras cerrar o refrescar se requiere un clic, salvo un mecanismo nuevo que Google garantice y se pruebe. | Sin backend adicional; alojamiento sujeto al plan de GitHub. | Baja. No custodia secretos; mejor conservarla si la conexión persistente no compensa el riesgo. |
| Cloud Run + Firestore + Secret Manager (recomendada para estudio) | Sí, mientras sigan válidos la sesión propia y el refresh token; la primera autorización es manual. | Con tráfico pequeño puede quedar dentro de cuotas gratuitas, **no es un costo garantizado de cero**. Hay cargos potenciales de red, registros, almacenamiento, KMS, dominio y excesos. | Media-alta. Requiere operar identidad, sesiones, cifrado, OAuth, monitoreo e incidentes. |
| Cloudflare Workers + D1 + secretos | Sí, con la misma arquitectura de sesiones y tokens cifrados. | Workers Free tiene 100.000 solicitudes/día; Workers Paid parte de US$5/mes. D1 tiene límites gratuitos y cobros al superarlos. | Media-alta. Menor infraestructura visible, pero autenticación, cifrado y recuperación siguen siendo responsabilidad del proyecto. |
| Supabase Auth + Edge Functions + base privada | Sí, si una función custodia el token y verifica una sesión autenticada. | Free incluye 500.000 invocaciones de funciones/mes; Pro parte de US$25/mes. El plan Free puede pausarse por inactividad. | Media-alta. Auth y base administrados ayudan, pero hay otro proveedor y **no** se debe confundir con la sincronización manual Supabase ya existente. |

Fuentes de precios y límites: [Cloud Run](https://cloud.google.com/run/pricing)
(hasta 2 millones de solicitudes/mes en su cuota gratuita, sujeta a región y
modalidad), [Firestore](https://cloud.google.com/firestore/pricing),
[Secret Manager](https://cloud.google.com/secret-manager/pricing) (6 versiones
activas y 10.000 accesos/mes gratuitos),
[Cloud KMS](https://cloud.google.com/kms/pricing),
[Workers](https://developers.cloudflare.com/workers/platform/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/),
[Supabase Functions](https://supabase.com/docs/guides/functions/pricing) y
[Supabase](https://supabase.com/pricing). Los precios están en USD, pueden
cambiar y no incluyen impuestos, dominio ni horas de operación. Antes de
contratar: estimar uso real, fijar presupuesto y alertas, y confirmar si el
plan gratuito exige una cuenta de facturación.

## Flujo propuesto

```mermaid
sequenceDiagram
    actor U as Usuaria
    participant P as Mis Finanzas (navegador)
    participant B as BFF y sesión
    participant G as Google OAuth
    participant V as Almacén privado de tokens
    participant D as Drive appDataFolder
    U->>P: Pulsa «Conectar Google»
    P->>B: Inicia autorización por redirección
    B-->>P: URL de autorización con offline, state y PKCE
    P->>G: Navega a Google tras el clic
    G-->>B: Callback con código
    B->>G: Canjea código en servidor
    G-->>B: Access token y refresh token
    B->>V: Guarda refresh token cifrado por usuario
    B-->>P: Cookie de sesión HttpOnly; vuelve a la app
    P->>B: Consulta estado de sesión al recargar
    B-->>P: Conectada / requiere conexión (sin autorizar)
    P->>B: Solicita lectura de Drive con sesión
    B->>V: Lee token del usuario autorizado
    B->>G: Renueva access token si hace falta
    B->>D: Lee archivo principal y metadatos
    D-->>B: Archivo y metadatos
    B-->>P: Datos de Drive sin exponer tokens
    P->>P: Validación y conflicto de Correcciones 15/16
    U->>P: Elige y confirma una sustitución si hay conflicto
    P->>B: Solicitud de escritura autorizada
    B->>D: Respaldo y escritura según contrato probado
```

La consulta de sesión nunca inicia OAuth. Una sesión válida significa
**autenticada**, no «Drive al día»: este último estado solo se muestra tras
leer y verificar la copia. Al caducar o revocarse el permiso, la app mantiene
los datos locales, señala «Requiere conexión» y no intenta ventanas ni
reescrituras automáticas. El backend no debe sincronizar en segundo plano por
su cuenta. [Flujo de código de Google](https://developers.google.com/identity/protocols/oauth2/web-server).

## Controles de seguridad y compatibilidad

1. **Identidad y sesión.** El servidor verifica la identidad de Google (ID
   token, emisor, audiencia, firma y vencimiento) y vincula el refresh token al
   `sub` estable, nunca al correo ni a un identificador enviado por el
   navegador. Una cookie de sesión opaca, `Secure`, `HttpOnly`, `SameSite` y
   vida limitada se rota al iniciar sesión; debe existir cierre de sesión en
   este dispositivo, cierre de todas las sesiones y desconexión/revocación de
   Drive. Un refresh token **no** es una cookie de sesión.
   [Verificar ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token),
   [cookies seguras](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies).
2. **OAuth.** La autorización se inicia por clic, preferiblemente con
   redirección para evitar ventanas. Verificar `state` de un solo uso y PKCE,
   usar URI HTTPS exacta, `access_type=offline` y el scope actual
   `drive.appdata`; decidir por separado y con aprobación si se añaden scopes
   de identidad. El backend guarda el secreto del cliente en Secret Manager,
   nunca en Pages/GitHub. No forzar consentimiento en cada visita para no
   multiplicar refresh tokens. Si Google no devuelve un refresh token en un
   canje posterior, no borrar el que ya esté guardado ni asumir que la sesión
   es renovable. Manejar `invalid_grant`, expiración y revocación sin borrar
   datos. [Google OAuth server-side](https://developers.google.com/identity/protocols/oauth2/web-server),
   [buenas prácticas](https://developers.google.com/identity/protocols/oauth2/resources/best-practices).
3. **Custodia y acceso.** Cifrar refresh tokens por usuario antes de
   persistirlos (p. ej., cifrado por envoltura con KMS), restringir IAM al BFF,
   separar entornos, rotar claves y tener procedimiento de recuperación.
   Los registros no deben contener tokens, códigos, cookies ni contenido
   financiero. Limitar tamaño, tasa, origen y métodos de las solicitudes;
   usar CSRF para escrituras y comprobar la sesión en **cada** operación.
   [Secret Manager en Cloud Run](https://docs.cloud.google.com/run/docs/configuring/services/secrets).
4. **Dominio.** `github.io` y `run.app`/`workers.dev` son sitios distintos;
   depender de cookies de terceros con `SameSite=None` es frágil o puede ser
   bloqueado. Preferir Pages y API en subdominios del mismo dominio propio,
   con CORS limitado al origen exacto y cookies host-only, o servir frontend y
   API desde un solo origen. Probar Android y escritorio antes de decidir.
   [Cookies de terceros](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies),
   [dominios de Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
5. **Drive y datos.** El BFF no debe ser un proxy genérico para cualquier API
   de Google: permitir solo operaciones necesarias en `appDataFolder`, y
   autorizar siempre según la sesión. Mantener nombre de archivo, scope,
   selección determinista, validación remota, base local, respaldos y doble
   confirmación. No modificar las claves de almacenamiento ni las reglas
   financieras. Un service account del servidor no sustituye el permiso del
   usuario para su Drive personal. El backend tendría visibilidad de las
   copias financieras en tránsito: es un nuevo límite de confianza y debe
   contar con aceptación explícita.
   [Datos de aplicación de Drive](https://developers.google.com/workspace/drive/api/guides/appdata).

## Puertas de decisión y fases

1. **Producto y cuentas.** Aprobar si la mejora justifica un backend, quién
   administra facturación e incidentes, cuánto durará la sesión, si se dispone
   de dominio propio y qué cuenta Google podrá vincularse. Decidir si el
   backend puede procesar temporalmente copias financieras. Sin aprobación,
   mantener la Corrección 17.1.
2. **Prueba aislada de viabilidad.** Sin tocar datos reales, comprobar con
   archivos ficticios que un cliente OAuth de servidor del proyecto Google
   adecuado ve el mismo `appDataFolder`. Google indica que solo la aplicación
   creadora accede a esos datos; **no asumir** que cambiar de proyecto o
   cliente conservará el acceso. Verificar también cookies entre dominios,
   redirección móvil, costo estimado y estado de publicación OAuth. Si la
   pantalla externa sigue en «Testing», los refresh tokens de scopes como
   Drive pueden caducar a los siete días: no prometer persistencia antes de
   resolverlo. [Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata),
   [vigencia de refresh tokens](https://developers.google.com/identity/protocols/oauth2/).
3. **Backend y seguridad, sin escritura.** Implementar login, callback,
   sesiones, custodia cifrada, revocación y lectura limitada de Drive con
   pruebas de autorización cruzada, CSRF, caducidad y errores de red. Hacer
   auditoría de dependencias y revisión de amenazas. No importar ni migrar
   copias existentes.
4. **Integración detrás de una opción reversible.** Conservar el flujo GIS
   manual y agregar transporte BFF solo tras pruebas de contrato con datos
   ficticios. Revalidar en la app selección de archivos, hashes, conflictos,
   respaldo, verificaciones posteriores, offline, recarga y recurrencias.
   Las escrituras requieren el mismo consentimiento actual; no fusionar.
5. **Piloto y despliegue, solo con autorización posterior.** Respaldo JSON
   exportado por la persona, cuenta de prueba, métricas sin datos sensibles,
   presupuestos/alertas, revisión móvil y escritorio, plan de desactivación
   que vuelva al botón manual sin borrar tokens ni copias inadvertidamente.
   Migrar usuarios gradualmente; nunca sustituir el archivo remoto por
   ausencia de una sesión o de una base confiable.

## Riesgos pendientes

- La sesión del backend y el refresh token pueden caducar, ser revocados o
  quedar inutilizados por políticas de Google. «Persistente» no significa
  «permanente».
- XSS, robo de cookie, CSRF, una autorización cruzada o un operador con acceso
  excesivo al backend podrían exponer datos. Hacen falta controles y respuesta
  a incidentes, no solo un proveedor administrado.
- La transición podría no ver copias antiguas si cambia la identidad de la
  aplicación OAuth. Nunca crear una copia vacía ni sobrescribir por ese motivo.
- La carrera entre última lectura y subida descrita en la Corrección 16 sigue
  sin escritura condicional atómica; el backend no la resuelve por sí mismo.
- Costos, cuotas, tiempos de inactividad y políticas de Google/proveedores
  pueden cambiar. Revalidar antes de aprobar presupuesto o despliegue.

## Verificación de este estudio

Se revisaron `AGENTS.md`, el flujo OAuth/Drive de `index.html` y las notas de
las Correcciones 16 y 17.1; las afirmaciones externas se contrastaron con las
fuentes enlazadas. No se ejecutó OAuth real, no se desplegó infraestructura,
no se modificó código de aplicación y no se usaron datos financieros reales.
