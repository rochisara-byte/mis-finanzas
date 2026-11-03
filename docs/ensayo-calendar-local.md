# Ensayo de Google Calendar desde el navegador

Este procedimiento no instala programas ni ejecuta archivos descargados en Windows. Publica **solo una página de ensayo** en un sitio HTTPS temporal y separado. El paquete `tests/calendar-live-sandbox-site.zip` contiene únicamente `index.html`; no contiene la aplicación, movimientos, datos de Drive ni credenciales. La página usa la misma cuenta de Google que Mis Finanzas, pero crea un calendario temporal `Mis Finanzas ENSAYO ...` y un evento ficticio.

El sitio temporal tendrá una dirección pública: no compartas el enlace ni subas archivos distintos al ZIP indicado. No uses el dominio de la aplicación publicada (`rochisara-byte.github.io`), porque comparte origen y almacenamiento con Mis Finanzas. La página bloquea el ensayo en ese origen.

## Preparación

1. Abre la rama `feature/mejora-27-google-calendar` en GitHub. En `tests`, descarga **solo** `calendar-live-sandbox-site.zip` mediante **Download raw**. No abras ni ejecutes los antiguos archivos `.cmd` o `.ps1`; ya no forman parte de este método.
2. En el navegador, entra en [Netlify Drop](https://app.netlify.com/drop) e inicia sesión si lo solicita. Arrastra el ZIP a la zona de publicación. Netlify debe crear un sitio HTTPS cuya página principal diga **Ensayo aislado de Google Calendar**. Este sitio contiene solo la página del ZIP; **no** publiques el repositorio completo ni Mis Finanzas.
3. Copia el **origen** del sitio, por ejemplo `https://nombre-del-ensayo.netlify.app` (sin la barra final ni rutas). En Google Cloud Console, abre el proyecto OAuth de Mis Finanzas y el cliente web cuyo ID termina en `qfvfg50kiajoc50s65kuf88m3i7gqkd6.apps.googleusercontent.com`. Agrega ese origen exacto a **Orígenes autorizados de JavaScript**. No borres los orígenes que ya existen ni cambies las URL de redirección. Si no administras ese proyecto, detente y pide ayuda a quien lo administre.
4. Comprueba que Google Calendar API está habilitada y que tu cuenta habitual puede autorizar el cliente. Si la pantalla de consentimiento está en modo de prueba, la cuenta debe figurar como usuaria de prueba.

## Ejecutar y limpiar

1. Vuelve a la página HTTPS de ensayo. Pulsa **Conectar y empezar ensayo** y comprueba que la ventana de Google muestra tu cuenta y el permiso de Calendar. No aceptes un permiso o una aplicación que no reconozcas.
2. Espera el texto `RESULTADO`. `Ambas condiciones ETag superadas` indica que los dos intentos con ETag antiguo fueron rechazados en este ensayo. Cualquier otro resultado significa **no habilitar** ediciones ni eliminaciones automáticas en Mis Finanzas.
3. Pulsa **Eliminar calendario de ensayo** y espera `Calendario temporal eliminado`. No cierres la página antes de este paso.
4. Después de limpiar, quita el origen temporal de **Orígenes autorizados de JavaScript** y elimina el sitio temporal desde Netlify. Conserva los orígenes de Mis Finanzas.

Si se cierra la página antes de limpiar, ábrela otra vez en el **mismo sitio y perfil de navegador**. Recordará el ID temporal y bloqueará un segundo ensayo hasta limpiarlo. Si la limpieza falla, elimina únicamente el calendario cuyo nombre empiece por `Mis Finanzas ENSAYO ` desde la configuración de Google Calendar o solicita ayuda; no borres ningún otro calendario. El ensayo guarda en ese sitio solo el nombre, marcador e ID del calendario temporal. El token OAuth permanece en memoria y desaparece al cerrar la página.

No abras el ZIP con doble clic para iniciar la prueba: `file://` no es un origen OAuth válido. Tampoco basta abrir el HTML dentro de `github.com`, porque Google no autorizará esa página como sitio de ensayo. El sitio HTTPS separado y su origen autorizado son requisitos de Google OAuth.
