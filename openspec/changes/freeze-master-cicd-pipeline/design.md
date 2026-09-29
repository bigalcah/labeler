## Context

Ver `proposal.md - Why`. Estado relevante verificado:

- `master` actual (`b63951f`) difiere del baseline `b409233` solo en `shared-validation.yml` (4 líneas de teardown importadas de `develop` vía `c639c6a`).
- `develop` (`c0e95a1`) difiere del baseline en `shared-validation.yml` (mismo cambio) y en `release.yml` (sin los hotfixes `bbaa07b`, `6972937`, `77a7d4e`); además no contiene `deployment/docker-compose.release.yml`, creado solo en `master`.
- Ninguna prueba de `develop` depende de `deployment/docker-compose.release.yml`; la prueba de teardown de `test/ci-workflow.test.js` sí depende del comportamiento importado y debe reconciliarse.
- El repositorio usa Git Flow; los cambios a `master` llegan por merge desde `develop`. El push a `master` dispara el release de producción.

## Goals / Non-Goals

**Goals:**

- Un único pipeline canónico idéntico en `develop` y `master`, byte a byte igual a `b409233`.
- Deriva imposible de colar por un merge de producto: detección automática, revisión de propietario y regla de agentes.
- Proceso explícito y aprobado para modificar el pipeline en el futuro.

**Non-Goals:**

- No se toca la aplicación, el esquema, las dependencias ni los archivos de despliegue distintos del compose de release referenciado por el workflow.
- No se corrige aquí la fragilidad del arnés de Chromium ni se divide el lane de pruebas; eso va en un cambio separado.
- No se configura la protección de rama de GitHub desde el repositorio; se documenta como acción administrativa requerida.

## Decisions

### Baseline `b409233`

Es el último `master` verificado antes del incidente y la fuente de verdad del pipeline. Alternativa descartada: aceptar el cambio de teardown en `master`, que habría legitimado una importación no aprobada y dejado `develop` y `master` divergentes.

### Converger `develop` en lugar de revertir solo `master`

Un solo conjunto canónico evita conflictos y reimportaciones futuras, y permite que la prueba de huellas use un baseline único. Alternativa descartada: revertir solo `master`, que deja los branches divergentes y la puerta abierta a la próxima fuga.

### Huella SHA-256 en prueba unitaria

Detecta cualquier byte, adición o renombrado en CI y en local sin infraestructura adicional. Alternativa descartada: confiar solo en la regla de agentes, que no bloquea merges humanos.

### Auditoría de merge con comando explícito

`git diff --name-only <base>..<head> -- .github/workflows deployment/docker-compose.release.yml` debe estar vacío en merges de producto; el cambio dedicado es la única excepción documentada.

### Capas de protección y sus límites

`CODEOWNERS` solo es plenamente efectivo con protección de rama que exija revisión de propietario; se documenta esa configuración administrativa. Ninguna capa protege contra un administrador del repositorio: el objetivo es que la deriva accidental o no aprobada sea imposible sin una decisión explícita.

## Risks / Trade-offs

- [Se pierde la propagación del error de teardown en `develop`] → Reincorporarla exigirá el cambio dedicado; queda como decisión consciente y registrada.
- [`release.yml` y el compose de release entran a `develop` por primera vez] → Es el estado verificado de `master`; ninguna prueba de `develop` depende de la versión antigua.
- [La protección de rama no puede configurarse desde el repositorio] → Documentar la acción administrativa y confiar en prueba + `CODEOWNERS` + regla mientras tanto.
- [El push a `master` relanza el release de producción] → Aprobación explícita obligatoria; la fragilidad conocida del arnés de Chromium puede volver a cancelar la ejecución sin desplegar y no se promete despliegue.

## Migration Plan

1. Feature desde `develop` con restauración, convergencia, regla y pruebas.
2. `git flow feature finish` hacia `develop`; verificación completa.
3. Merge dedicado `develop` → `master` con auditoría de rutas del pipeline y aprobación explícita.
4. Push a `master` con aprobación explícita; observar el release sin afirmar despliegue hasta el smoke test.
5. Rollback: revertir el merge dedicado; el pipeline restaurado no cambia comportamiento de producción por sí mismo.
