## Why

El merge `feat(release): integrar progreso privado en master` (`b63951f`) arrastró a `master` un cambio de pipeline CI/CD que vivía en `develop` (`c639c6a`), sin cambio dedicado ni aprobación: 4 líneas de limpieza del runtime efímero en `shared-validation.yml`. La ejecución de producción 36630367671 se canceló y `master` quedó con un pipeline distinto al que tenía antes del merge (`b409233`).

Además, `develop` quedó desalineado del pipeline canónico de `master` (`release.yml` sin los hotfixes de despliegue y sin `deployment/docker-compose.release.yml`), de modo que futuros merges pueden reintroducir deriva en cualquier dirección. Hoy no existe ninguna regla, prueba ni revisión que lo impida.

## What Changes

- Restaurar el pipeline CI/CD canónico de `master` (`b409233`) byte a byte: revertir el cambio importado en `.github/workflows/shared-validation.yml`.
- Converger `develop` al mismo baseline: alinear `.github/workflows/release.yml` y traer `deployment/docker-compose.release.yml`, para que ambos branches compartan un único pipeline y ningún merge futuro pueda reintroducir deriva.
- Congelar el pipeline: ninguna modificación puede llegar a `master` por un merge de producto; toda alteración exige un cambio dedicado, explícitamente aprobado, que actualice el baseline y las pruebas a la vez.
- Añadir tres capas de protección: prueba de huellas SHA-256 del pipeline congelado, `CODEOWNERS` para las rutas del pipeline y una regla absoluta en `AGENTS.md` con auditoría de merge obligatoria.
- Reconciliar `test/ci-workflow.test.js` con el comportamiento restaurado del teardown del runtime efímero.

## Capabilities

### New Capabilities

- `cicd-pipeline-governance`: restauración, congelamiento y verificación del pipeline CI/CD canónico de `master` frente a merges de producto.

### Modified Capabilities

<!-- Ninguna: no cambian requisitos de capabilities existentes. -->

## Impact

- Archivos: `.github/workflows/**` (7 workflows), `deployment/docker-compose.release.yml`, `test/ci-workflow.test.js`, nueva prueba `test/ci-pipeline-freeze.test.js`, `AGENTS.md`, `.github/CODEOWNERS` y los artefactos de este cambio.
- No cambia la aplicación, el esquema, las dependencias ni el comportamiento de despliegue actual de `master`; sus archivos de despliegue permanecen intactos.
- `develop` pierde la propagación del error de teardown introducida por `c639c6a`; reincorporarla exigirá el proceso dedicado definido por este cambio.
- El push a `master` dispara el release de producción; la fragilidad conocida del arnés de Chromium queda fuera de alcance y se atiende en un cambio separado.
