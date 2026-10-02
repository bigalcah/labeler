## 1. Reparación de restricciones del Dockerfile

- [x] 1.1 `deployment/server/Dockerfile`: sustituir en el stage `build` `build-base=0.5-r3` por `build-base=~0.5` y `python3=3.12.14-r0` por `python3=~3.12`; conservar `gettext=~0.22.5` y `moreutils=~0.69` sin cambios.
- [x] 1.2 `deployment/server/Dockerfile`: sustituir en el stage runtime `openssl=3.3.7-r1` por `openssl=~3.3` y `postgresql17-client=17.11-r0` por `postgresql17-client=~17.11`; conservar `curl=~8.14` y `jq=~1.7` sin cambios.
- [x] 1.3 Verificar contra la base fijada que los cuatro paquetes resuelven: `docker run --rm node:22.13.1-alpine sh -c 'apk update --quiet && apk add --quiet --no-cache --simulate <specs>'` debe salir 0 para cada restricción.
- [x] 1.4 Ejecutar Hadolint v2.12.0 sobre `deployment/server/Dockerfile` con la invocación del pipeline y confirmar exit 0 sin DL3018.
- [x] 1.5 Ejecutar la construcción completa del stage de servidor (`docker build --file deployment/server/Dockerfile .`) y confirmar que ambos stages terminan.

## 2. Pruebas de contrato

- [x] 2.1 Ejecutar las pruebas que leen el Dockerfile (`node --test test/deployment-hardening.test.js test/deployment-retirement.test.js test/release-manifest.test.js`) y confirmar que pasan con las restricciones `=~`.
- [x] 2.2 Ejecutar `npm run lint:js` y la suite unitaria completa (`npm run test:unit`) para descartar regresiones del cambio.
- [x] 2.3 Ejecutar `openspec validate "repair-server-image-package-pins" --strict` y confirmar que el cambio es válido.

## 3. Integración y release

Evidencia local (2026-10-02): resolución APK y Hadolint v2.12.0 con exit 0;
imagen `labeler-pins-repair:local` construida y exportada; herramientas de runtime
ejecutadas como usuario `node`; ambos CSV presentes; 19/19 pruebas de contrato,
439/439 pruebas unitarias y `lint:js` correctos. La base exacta descrita en las
tareas corresponde a master: esta feature basada en develop tenía tres paquetes
sin versión y no declaraba OpenSSL. Se implementó el mismo estado final aprobado.
Workflows y Compose de release sin modificaciones. Integración y publicación
pendientes de autorización explícita.

- [ ] 3.1 Commit atómico en `feature/repair-server-image-package-pins` con Conventional Commit en español y cuerpo explicativo, tras aprobación explícita.
- [ ] 3.2 `git flow feature finish` hacia `develop`, push a `origin/develop` y verificar que develop queda con el Dockerfile reparado.
- [ ] 3.3 Preparar el merge dedicado `develop` → `master`, ejecutar la auditoría `git diff --name-only origin/master...develop -- .github/workflows deployment/docker-compose.release.yml` (debe imprimir nada) y obtener aprobación explícita antes de publicar.
- [ ] 3.4 Publicar `master` y observar el release: `quality` (unit, integración, E2E), `build`, `publish` y `deploy`; si el flake de Chromium aborta un intento, reintentar el job fallido sin tocar el pipeline y registrar la ocurrencia.
- [ ] 3.5 Confirmar el smoke test HTTPS del release y conservar la evidencia; después marcar las tareas 6.6 y 6.7 del cambio `anonymous-home-login-only` según el precedente del repo.
