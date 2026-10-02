## Why

El release de `master` quedó bloqueado de forma determinista: el gate de calidad no puede construir la imagen del servidor porque `deployment/server/Dockerfile` fija revisiones exactas de paquetes Alpine (`python3=3.12.14-r0`, `openssl=3.3.7-r1`, `build-base=0.5-r3`, `postgresql17-client=17.11-r0`) que el repositorio upstream ya retiró (hoy publica `python3 3.12.15-r0` y `openssl 3.3.7-r2`). El commit previo de `master` (`9c28e75`) usa el mismo Dockerfile y también fallaría hoy: la deriva es de Alpine, no del merge `f980816`. El pipeline, fail-closed, mantiene producción en el release anterior y ninguna publicación puede avanzar hasta que el build resuelva.

## What Changes

- `deployment/server/Dockerfile`: sustituir las fijaciones exactas de revisión (`=*-rN`) por restricciones de serie menor (`=~<serie>`) que `apk` resuelve ante parches y revisiones nuevas, y que Hadolint sigue aceptando como versiones fijadas:
    - stage `build`: `build-base=~0.5` (hoy `0.5-r3`), `python3=~3.12` (hoy `3.12.15-r0`).
    - stage runtime: `openssl=~3.3` (hoy `3.3.7-r2`), `postgresql17-client=~17.11` (hoy `17.11-r0`).
- Sin cambios en: base `node:22.13.1-alpine`, conjunto de paquetes requeridos, healthcheck, usuario `node`, pipeline congelado (`.github/workflows/**`, `deployment/docker-compose.release.yml`), Compose ni dependencias npm.
- Desbloquea el release de `master` para publicar `f980816` junto con esta reparación, reanudando las verificaciones pendientes del cambio `anonymous-home-login-only`.

## Capabilities

### New Capabilities

- `server-image-build`: construcción reproducible de la imagen del servidor con restricciones de paquetes Alpine que resuelven ante actualizaciones upstream dentro de la serie y que permanecen verdes en el gate de Hadolint.

### Modified Capabilities

<!-- Ninguna: no cambian requisitos de capabilities existentes. -->

## Impact

- Único archivo de producto afectado: `deployment/server/Dockerfile`.
- Gates afectados: `quality` (build del runtime efímero), `build` del release y lint de Dockerfiles (Hadolint DL3018); el pipeline congelado no se modifica.
- No cambia la aplicación, el esquema, las rutas, los secretos, las dependencias npm ni el comportamiento de despliegue.
- Riesgo residual: el flake conocido del arnés Chromium puede abortar un intento del gate unitario; se reintenta sin tocar el pipeline.
