# Mantenimiento

## Estados y fuentes

- `VERIFIED`: existencia estática o ejecución aprobada con comando, resultado, fecha, alcance y entorno.
- `IMPLEMENTED-UNVERIFIED`: existe implementación sin evidencia runtime externa o histórica completa.
- `PLANNED`: solo aparece en OpenSpec, tareas pendientes o documentación objetivo.
- `PENDING-EVIDENCE`: el comportamiento está implementado, pero falta una evidencia de cierre concreta.
- `LEGACY`: pertenece al etiquetador genérico anterior.

Precedencia: worktree para existencia, `AGENTS.md` para proceso/baseline, OpenSpec para objetivo, `package.json` para
scripts, Compose para servicios y runbooks para operación. README es índice; `plans/` es histórico.

## Registro inicial

El worktree estaba sucio antes de este apply. Registra rama, `HEAD`, staging, paths modificados y untracked antes de
editar; los cambios ajenos no se atribuyen ni se revierten. La allowlist contiene README, CONTRIBUTING, SECURITY, siete
documentos `docs/` y `deployment/GITHUB-ENRICHMENT.md`; `deployment/ROLLBACK.md` solo se consulta.

## Ledger JavaScript

`JAVASCRIPT-API.md` debe tener una fila por módulo y por export, handler, clase/método, callable de factory, entrypoint
y coordinador relevante. Toda exclusión requiere razón. Repítelo cuando cambien `routes/**/*.js`, `scripts/**/*.js` o
`util/**/*.js`; no añadas JSDoc para completar la documentación.

## Contrato multiestudio

La preparación conserva exactamente dos perfiles, en este orden: `pr-card-sorting-local` con 300
tarjetas y usernames `javier`, `diego`, `pablo`; después `pr-card-sorting-validation-30` con 30
tarjetas y usernames `javier-30`, `diego-30`, `pablo-30`. Ambos perfiles comparten las claves
visibles de participantes, pero sus cuentas, sesiones, categorías, decisiones, descartes,
observaciones y progreso quedan ligados a su propio `study_id`.

La cuenta y la sesión son la autoridad de `study_id`. No existe selector de participante o estudio,
no se aceptan conteos arbitrarios ni hay UI administrativa. La exportación es offline y solo para
operadores, sin HTTP ni ruta `/export`; requiere `--study-key` y produce sus archivos fuera del
repositorio. El enriquecimiento GitHub es opcional y prepare-only. La captura live sigue pendiente.

## Cierre estático

```bash
npm run validate:study-profiles
npm run docs:study-check -- --root .
npm run lint:md
npx --no-install markdownlint "docs/**/*.md" "deployment/GITHUB-ENRICHMENT.md"
openspec validate "card-sorting-prs-mvp" --strict
```

`docs:study-check` valida los documentos requeridos, enlaces, perfiles, comandos y el marcador
JSON de `docs/STUDY-WORKFLOW.md`. `prepare:study-profiles` procesa los perfiles después del
preflight, primero 300 y luego 30. `export:study` se ejecuta offline con un `study_key` explícito y
solo tras finalizar todos los participantes.

Docker/PostgreSQL solo puede marcarse `VERIFIED` con evidencia de un entorno desechable aprobado; de otro modo registra
`IMPLEMENTED-UNVERIFIED`. La implementación central y el E2E hostil aislado de los dos perfiles
están completados. Siguen pendientes backup y restore externos, E2E hostil histórico, E2E en VPS o
entorno público, cierre documental histórico y captura live de GitHub.
