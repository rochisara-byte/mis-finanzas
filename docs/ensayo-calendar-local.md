# Ensayo local de Google Calendar (Windows)

Este ensayo usa la misma cuenta de Google que Mis Finanzas, pero **no carga la aplicación, sus movimientos ni Drive**. Crea un calendario temporal llamado `Mis Finanzas ENSAYO ...` con un evento ficticio y prueba si Google rechaza cambios con un ETag antiguo. Solo elimina ese calendario temporal tras verificar su identificador y marcador. No habilita todavía la sincronización automática en la aplicación.

## Preparación (una sola vez)

1. Descarga la rama `feature/mejora-27-google-calendar` del repositorio como ZIP desde GitHub y descomprímela en tu computador. No abras la versión publicada de Mis Finanzas para hacer el ensayo.
2. En Google Cloud Console, abre el proyecto OAuth de Mis Finanzas y busca el cliente web cuyo ID termina en `qfvfg50kiajoc50s65kuf88m3i7gqkd6.apps.googleusercontent.com`. En **Orígenes autorizados de JavaScript**, agrega exactamente `http://127.0.0.1:8768` si todavía no está. No agregues secretos al repositorio ni cambies la URL de redirección. Si no tienes acceso a esa configuración, detente y pide ayuda al propietario del proyecto.
3. Comprueba que Google Calendar API está habilitada y que tu misma cuenta puede autorizar este cliente OAuth. Si la pantalla de consentimiento está en modo de prueba, tu cuenta debe figurar como usuaria de prueba. No aceptes una pantalla que muestre una aplicación o un permiso que no reconozcas.

## Ejecutar

1. En la carpeta descargada, abre `tests` y haz doble clic en `abrir-ensayo-calendar.cmd`. Usa Windows PowerShell, incluido en Windows; no instala nada. Deja abierta la ventana negra mientras usas la página.
2. Se abrirá `http://127.0.0.1:8768/` en tu navegador. Si no abre, copia esa dirección en el navegador. Debe decir **Ensayo aislado de Google Calendar**, no la aplicación Mis Finanzas.
3. Pulsa **Conectar y empezar ensayo** y elige tu cuenta habitual de Google. La página creará un calendario nuevo llamado `Mis Finanzas ENSAYO ...`; no selecciona calendarios existentes.
4. Espera a ver `RESULTADO` en la página. `Ambas condiciones ETag superadas` significa que las dos precondiciones funcionaron en este ensayo; cualquier otro resultado significa **no habilitar** ediciones ni eliminaciones automáticas.
5. Pulsa **Eliminar calendario de ensayo**. Espera el mensaje `Calendario temporal eliminado` y comprueba, si quieres, que `Mis Finanzas ENSAYO ...` ya no aparece en Google Calendar. Luego cierra la ventana negra.

## Si se interrumpe

- No pulses **Conectar y empezar ensayo** otra vez mientras haya un ensayo pendiente. La página lo bloquea para evitar varios calendarios temporales.
- Si cerraste el navegador, vuelve a abrir el lanzador y la misma dirección **en el mismo perfil de navegador**. Pulsa **Eliminar calendario de ensayo**; Google puede pedir autorización de nuevo.
- Si falla la limpieza, anota solo el nombre `Mis Finanzas ENSAYO ...` y borra **ese calendario** desde la configuración de Google Calendar, o pide ayuda. No borres otros calendarios. No compartas capturas con tokens ni información privada.
- Si Google muestra `origin_mismatch` u origen no autorizado, revisa el paso 2 de preparación. No uses `file://` ni publiques la página en GitHub Pages para resolverlo.

La página guarda en el navegador únicamente el nombre, marcador e ID del calendario de ensayo para recuperarlo tras una recarga. El token de acceso permanece solo en memoria y desaparece al cerrar la página. Los resultados reales deben revisarse antes de levantar la compuerta de seguridad de la PR #18.
