## 1. Restauración del pipeline canónico

- [x] 1.1 Restaurar `.github/workflows/shared-validation.yml` exactamente desde `b409233` (revierte el teardown importado de `c639c6a`).
- [x] 1.2 Alinear `.github/workflows/release.yml` a `b409233` y traer `deployment/docker-compose.release.yml` desde `b409233`; verificar que los siete workflows y el compose coinciden byte a byte.
- [x] 1.3 Reconciliar la prueba de teardown de `test/ci-workflow.test.js` con el comportamiento restaurado (docker `down` sin propagación de estado; el runtime no se elimina si `docker down` falla) y ejecutar `node --test test/ci-workflow.test.js`.

## 2. Congelamiento y reglas

- [x] 2.1 Añadir la regla absoluta a `AGENTS.md`: el pipeline CI/CD de `master` es intocable por ningún motivo, con el comando de auditoría obligatorio antes de cualquier merge y el proceso dedicado para cambios.
- [x] 2.2 Crear `.github/CODEOWNERS` con las rutas del pipeline (`.github/workflows/`, `deployment/docker-compose.release.yml`) y el propietario `@bigalcah`.
- [x] 2.3 Añadir `test/ci-pipeline-freeze.test.js` con las huellas SHA-256 de los siete workflows y del compose de release tomadas de `b409233`, más la verificación del conjunto exacto de archivos.
- [x] 2.4 Comprobar que la prueba de congelamiento falla ante una alteración temporal de un byte y vuelve a pasar al revertirla.

## 3. Verificación

- [x] 3.1 Ejecutar `npm run lint` y `node --test test/ci-workflow.test.js test/ci-pipeline-freeze.test.js`; después `npm run test:unit` completo y reconciliar cualquier prueba desalineada sin debilitar cobertura.
- [x] 3.2 Verificar `git diff b409233 -- .github/workflows deployment/docker-compose.release.yml` vacío, `git diff --check` limpio y `openspec validate "freeze-master-cicd-pipeline" --strict`.

## 4. Integración y release (requiere aprobación explícita aparte)

- [ ] 4.1 Crear los commits atómicos con Conventional Commits en español y cuerpo explicativo, solo tras aprobación explícita.
- [ ] 4.2 Ejecutar `git flow feature finish freeze-master-cicd-pipeline` hacia `develop` y verificar que `develop` queda idéntico al baseline en el pipeline.
- [ ] 4.3 Preparar el merge dedicado `develop` → `master`, auditar `git diff --name-only origin/master...develop -- .github/workflows deployment/docker-compose.release.yml` y obtener aprobación explícita antes de publicar.
- [ ] 4.4 Publicar `master` solo con aprobación explícita, observar el release de producción y no afirmar despliegue hasta el smoke test; registrar si el gate de Chromium vuelve a cancelar la ejecución.
