# Mejora 23 - PWA instalable

## Alcance

La aplicación se sirve desde `/mis-finanzas/` en GitHub Pages. El manifest usa rutas relativas a su propio archivo, por lo que `start_url`, `scope` e íconos resuelven bajo ese prefijo. El navegador registra `./sw.js` con el mismo alcance. La PWA requiere HTTPS en producción; `localhost` se usa únicamente para pruebas.

El service worker guarda solo el shell de la aplicación: la entrada, `index.html`, manifest e íconos. No lee ni escribe `localStorage` y no intercepta solicitudes de otro origen ni rutas fuera de esa lista. Las llamadas a Google Identity Services y Google Drive siguen pasando directamente por la red y conservan el flujo OAuth y la resolución de conflictos existentes.

## Actualizaciones

`CACHE_VERSION` en `sw.js` debe incrementarse cada vez que cambie el HTML, el manifest o cualquiera de los recursos precargados. `SHELL_DIGEST` fija la huella SHA-256 de esos archivos. La comprobación obligatoria `node tests/pwa-cache.test.js` (también ejecutada en la PR por GitHub Actions) falla si la huella no coincide o si cambia frente al worker anterior sin aumentar `CACHE_VERSION`. Para actualizar el shell, aumenta el número y calcula la nueva huella con el mismo orden y delimitadores que usa la prueba. La instalación de una versión nueva solo termina cuando todos esos recursos se han descargado. Si falla alguno, el worker anterior permanece activo y su shell sigue disponible sin conexión.

Una versión instalada espera a que se cierren las ventanas que usan la anterior. No se usa `skipWaiting` ni `clients.claim`, para evitar cambiar el código de una sesión financiera abierta. Al activarse, elimina solo cachés anteriores cuyo nombre empieza por `mis-finanzas-shell-v`; no elimina datos de usuario ni otros cachés. Una página controlada carga el HTML de su versión ya verificada y cambia a la nueva tras cerrar y abrir la aplicación.

La instalación o actualización nunca reinicia `mis-finanzas-offline-v1`. Aun así, `localStorage` depende del perfil del navegador: borrar manualmente los datos del sitio, usar navegación privada o cambiar de origen puede hacer que los datos locales no estén disponibles. Conviene conservar la exportación JSON.

## Verificación

`tests/pwa-cache.test.js` comprueba la huella y versión del shell, incluye una prueba negativa de cambio sin aumento de versión y verifica que el worker no responda a solicitudes OAuth ni Google Drive.

`tests/pwa.test.js` inicia un servidor HTTP local bajo `/mis-finanzas/` y utiliza un perfil temporal persistente de Chromium. Usa exclusivamente cuentas y movimientos ficticios y simula una autorización de Google denegada. Comprobó:

- Manifest, alcance, íconos PNG y ausencia de errores de instalabilidad en Chromium.
- Worker activo y caché limitado a seis recursos propios.
- Apertura, cuatro secciones, registro y persistencia tras cerrar y reabrir sin conexión.
- Actualización interrumpida por fallo de un recurso: la versión previa sigue abriendo sin conexión y conserva el movimiento.
- Actualización posterior completa: el nuevo shell se activa al cerrar la ventana, sin perder el movimiento.
- Reinicio completo de Chromium con el mismo perfil temporal en modo ventana de aplicación (`--app`): `display-mode: standalone` y movimiento disponible sin conexión.

Las capturas [móvil](screenshots/mejora-23/offline-mobile.png), [escritorio](screenshots/mejora-23/offline-desktop.png) y [ventana de aplicación simulada](screenshots/mejora-23/app-mode-mobile.png) corresponden a la app reabierta sin conexión con datos ficticios. No son capturas de una instalación nativa.

## Límites pendientes

No se realizó una instalación física ni una apertura desde el icono del sistema en Android o Windows; tampoco se probó OAuth con una cuenta real ni se desplegó GitHub Pages. El modo `--app` de Chromium simula una ventana independiente, pero no instala un acceso directo del sistema. El resultado de Chromium y las rutas simuladas son comprobaciones automatizadas equivalentes, no una garantía de comportamiento de todos los navegadores y dispositivos. Antes de publicar, se recomienda una prueba manual de instalación, lanzamiento y actualización en ambos sistemas con datos ficticios.
