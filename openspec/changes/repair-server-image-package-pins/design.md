## Context

Ver `proposal.md` — Why. El estado actual relevante para el diseño:

- `deployment/server/Dockerfile` tiene dos stages (`build` y runtime) sobre `node:22.13.1-alpine` y ocho paquetes APK: cuatro con restricción de serie (`gettext=~0.22.5`, `moreutils=~0.69`, `curl=~8.14`, `jq=~1.7`) y cuatro con revisión exacta (`build-base=0.5-r3`, `python3=3.12.14-r0`, `openssl=3.3.7-r1`, `postgresql17-client=17.11-r0`).
- Los pins exactos se introdujeron para mantener reproducible el gate de Hadolint (commit `8dfcf74`). Las revisiones exactas ya se rompieron antes en `openssl` (commit `21aa56b`) y ahora en `python3` y `openssl`, porque Alpine publica revisiones nuevas y retira las anteriores.
- El pipeline está congelado por huellas SHA-256 (`.github/workflows/**` y `deployment/docker-compose.release.yml`); `deployment/server/Dockerfile` no está en ese conjunto, pero el cambio exige igualmente su propio cambio OpenSpec aprobado.
- Pruebas que leen el Dockerfile: `test/deployment-hardening.test.js` exige `openssl(?:[=~][^\s]*)?`, `test/deployment-retirement.test.js` exige `postgresql\d*-client`, ambas compatibles con `=~`.
- Verificación local contra la imagen base real: `apk add --simulate` resuelve `python3=~3.12`, `openssl=~3.3`, `build-base=~0.5`, `postgresql17-client=~17.11`; Hadolint v2.12.0 sobre la versión parcheada devuelve 0.

## Goals / Non-Goals

**Goals:**

- Restaurar la resolución determinista de paquetes del Dockerfile del servidor contra la base fijada.
- Evitar recurrencia: ninguna restricción debe depender de una revisión `-rN` que Alpine pueda retirar.
- Mantener el gate de Hadolint limpio (DL3018 exige versión fijada explícita).

**Non-Goals:**

- No actualizar la imagen base `node:22.13.1-alpine` ni otros Dockerfiles.
- No modificar el pipeline congelado ni sus huellas.
- No estabilizar el flake del arnés Chromium (cambio separado).

## Decisions

**Decisión 1: usar restricciones de serie (`=~<serie>`) en lugar de revisiones exactas.**

- Rationale: Alpine mantiene la compatibilidad dentro de una serie menor; las revisiones `-rN` son transitorias. `=~3.12` o `=~3.3` resuelven tanto la revisión vigente (verificado localmente) como futuras revisiones de la misma serie.
- Alternativas consideradas:
    - *Actualizar a las revisiones exactas vigentes* (`python3=3.12.15-r0`, `openssl=3.3.7-r2`): pospone el problema; cualquier parche upstream vuelve a romper el release. Descartada.
    - *Quitar la versión* (`python3` a secas): Hadolint DL3018 falla y se pierde reproducibilidad. Descartada.
    - *Fijar la base por digest*: no evita el problema de los paquetes y añade rigidez de mantenimiento. Descartada por alcance.

**Decisión 2: convertir los cuatro pins exactos, no solo los dos rotos.**

- Rationale: `build-base=0.5-r3` y `postgresql17-client=17.11-r0` tienen la misma exposición; convertirlos ahora evita un tercer incidente. Ambos resuelven con `=~` contra la base actual.
- Alternativa considerada: cambio mínimo a dos paquetes. Descartada por el objetivo explícito de evitar recurrencia.

**Decisión 3: mantener el conjunto de paquetes y la base sin cambios.**

- Rationale: el contrato de la imagen (OpenSSL para backups, cliente PostgreSQL, python3/build-base para `npm ci`) permanece; el cambio es solo de restricción de versión.

## Risks / Trade-offs

- [Una serie menor podría romper compatibilidad con la base] → La base está fijada por tag (`node:22.13.1-alpine`); actualizarla es un cambio explícito que revisará también los guiones de serie.
- [Alpine podría retirar la serie completa] → Improbable dentro de la vida del tag base; cualquier movimiento exige revisar el Dockerfile y queda cubierto por las pruebas de contrato y el gate de lint.
- [Deriva silenciosa del contenido instalado entre builds] → Trade-off aceptado a cambio de resolver; las revisiones `-rN` ya no pueden fijarse de forma estable.
- [El flake de Chromium puede abortar el release de nuevo] → Reintentar el fallo transitorio sin tocar el pipeline; su estabilización pertenece a un cambio separado.

## Migration Plan

1. Editar `deployment/server/Dockerfile` y ejecutar la simulación `apk add` y Hadolint localmente.
2. Commit en `feature/repair-server-image-package-pins`, merge a `develop` y push.
3. Merge dedicado `develop` → `master` (con auditoría de congelamiento vacía) y push; el pipeline reconstruye la imagen y continúa el release.
4. Rollback: revertir el commit del Dockerfile; al ser un cambio de restricciones sin estado persistente, no hay migración de datos.
