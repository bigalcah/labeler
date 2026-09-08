# Mantenimiento

## Estados y fuentes

- `VERIFIED`: existencia estática o ejecución aprobada con comando, resultado, fecha, alcance y entorno.
- `IMPLEMENTED-UNVERIFIED`: existe implementación sin evidencia runtime completa.
- `PLANNED`: solo aparece en OpenSpec, tareas pendientes o documentación objetivo.
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

## Cierre estático

```bash
npm run lint:md
npx --no-install markdownlint "docs/**/*.md" "deployment/GITHUB-ENRICHMENT.md"
openspec validate "complete-project-documentation" --strict
```

Docker/PostgreSQL solo puede marcarse `VERIFIED` con evidencia de un entorno desechable aprobado; de otro modo registra
`IMPLEMENTED-UNVERIFIED`.
