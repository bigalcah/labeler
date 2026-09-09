# Arquitectura

## Alcance y estados

Este documento describe el worktree actual mediante cuatro estados:

- **VERIFIED**: comprobado estáticamente en archivos, rutas o configuración; no significa que el runtime funcione.
- **IMPLEMENTED-UNVERIFIED**: existe código relacionado, pero no hay evidencia runtime aprobada.
- **PLANNED**: definido solo por OpenSpec, planes o tareas pendientes.
- **LEGACY**: pertenece al etiquetador genérico anterior.

`AGENTS.md` declara que la aplicación ejecutable sigue siendo legacy y que el estudio no está implementado. El worktree
contiene, no obstante, rutas, migraciones, scripts y documentación del estudio. Por tanto, las superficies del estudio
son `IMPLEMENTED-UNVERIFIED` salvo cuando se indique explícitamente evidencia estática. En este cambio no se ejecutaron
Docker, PostgreSQL, migraciones, bootstrap, GitHub ni flujos HTTP.

## Aplicación web

**VERIFIED, alcance estático:** `index.js` crea Express, carga `dotenv`, sirve `public/`, renderiza EJS, parsea JSON y
formularios, añade paginación y `res.locals`, sanea Markdown, minifica HTML/JavaScript inline, comprime respuestas,
expone actuator bajo `/actuator`, carga `routes/` mediante `express-file-routing`, registra logs rotativos y maneja
errores. El puerto del proceso es `3000`; Compose publica `7755:3000`.

No existe bundler ni compilación EJS separada: las vistas se renderizan en runtime y consumen parciales, JavaScript
inline y dependencias CDN. La tarjeta se centraliza en `views/partials/instance/data.ejs`.

**IMPLEMENTED-UNVERIFIED:** la existencia de middleware y vistas no prueba que el servidor arranque o responda.

## Rutas filesystem

**VERIFIED, alcance estático:** `app.use("/", await router())` carga rutas desde `routes/`; `[name]` y `[id]` son
parámetros. Las superficies actuales incluyen:

- `/`, `/login`, `/instances`, `/instances/:id` y `/progress`.
- `/:name/queue`, `/:name/queue/:id`, `/:name/categories`.
- `/:name/queue/:id/classify` y `/:name/queue/:id/discard`.
- `/actuator/health` y el fallback de error 404.

Las rutas existen estáticamente, pero su registro, códigos HTTP y renderizado son `IMPLEMENTED-UNVERIFIED`. Los nombres
`/instances` conservan vocabulario histórico, aunque sus consultas actuales usan tarjetas PR y membresía del estudio.

## Persistencia y migraciones

`util/pg-pool.js` exporta el pool PostgreSQL compartido y las rutas ejecutan SQL directamente, sin ORM. El baseline usa
`pr_cards`; la muestra y orden usan `study_card`; la privacidad usa `study_participant`, `participant_category`,
`pr_classification` y `pr_discard`. GitHub añade runs, páginas, snapshots y promoción sin mutar `pr_cards` ni
`study_card`.

Las migraciones gestionadas son `001_study_foundation`, `003_private_pr_discard` y `004_github_pr_api_enrichment`.
`002_retire_legacy_labeler` es externa al runner común. El ledger es `labeler_migration`. Los SQL históricos bajo
`schema/01_...` a `06_...` son **LEGACY**.

**IMPLEMENTED-UNVERIFIED:** no se verificó una base real, su ledger, restricciones o transacciones.

## Retiro escalonado de `reviewer` y objetos legacy

**PLANNED, contrato operativo:** el retiro legacy es posterior, explícito y por etapas. El MVP convive con objetos
legacy mientras existan consumidores, datos por preservar o dependencias estructurales. No hay eliminación automática en
este cambio.

Las fases son:

1. Aislar el flujo nuevo con `study`, `study_participant`, `study_card`, `pr_cards`, cuentas, sesiones, categorías y
   clasificaciones privadas, sin sembrar fixtures legacy.
2. Inventariar rutas, vistas, scripts, exports, SQL, funciones, vistas PostgreSQL y claves foráneas que todavía consumen
   objetos legacy.
3. En modo `clean`, fallar ante cualquier objeto legacy inventariado. Esta ruta solo acepta una base sin legacy y no
   ejecuta `DROP`, `DELETE` ni limpieza automática.
4. En modo `existing`, exigir backup externo verificable, manifiesto con checksum, identidad de base y confirmación
   explícita antes de cualquier retiro permitido.
5. Retirar solo consumidores y objetos autorizados por inventario. `reviewer` se conserva mientras existan referencias
   desde membresías, cuentas, categorías, clasificaciones u otras tablas del MVP.
6. Considerar la eliminación final de objetos restantes solo en cambios posteriores, después de demostrar ausencia de
   consumidores y de referencias, con rollback documentado hacia una base separada o aprobada.

Los criterios mínimos para avanzar entre fases son inventario completo, backup legible y verificable, confirmación
operativa, allowlist de objetos autorizados, rollback probado fuera del volumen de producción y evidencia de que las
clasificaciones, cuentas, tarjetas y membresías existentes se preservan.

## Prepare y runtime

**VERIFIED, alcance estático:** Compose define `labeling-database`, `labeling-study-prepare` y `labeling-server`, la
red `labeling-network`, el volumen `labeling-data` y el puerto `7755:3000`. El preparador recibe el CSV y secretos
GitHub; el servidor recibe configuración PostgreSQL y depende de la finalización exitosa del preparador.

El flujo previsto es: PostgreSQL saludable → migraciones/guardas → validación CSV → bootstrap → `READY` → enriquecimiento
opcional → servidor. La ejecución real es `IMPLEMENTED-UNVERIFIED`. PostgreSQL solo ejecuta init scripts cuando
`PGDATA` está vacío; borrar el volumen no es rollback.

## Socket.io y legacy

**VERIFIED, alcance estático:** el `package.json` actual no declara Socket.io y `index.js` no crea un servidor Socket.io.
La difusión de labels globales descrita por `AGENTS.md` es **LEGACY** y no debe reaparecer en el estudio.

También son **LEGACY** los labels globales, conflictos destructivos, fixtures antiguos y exportaciones JSONL del
etiquetador anterior. Son **PLANNED** la taxonomía final jerárquica, acuerdo/adjudicación, exportación CSV/TSV
reproducible, autenticación real, sesiones, autorización, CSRF, webhooks y workers GitHub permanentes.

## Fuentes

`AGENTS.md`, `index.js`, `package.json`, `routes/`, `views/`, `util/`, `schema/migrations/`,
`deployment/docker-compose.yml`, `scripts/prepare-study-deployment.sh` y los cambios OpenSpec activos son las fuentes
de este resumen. Cuando discrepan, se conserva la discrepancia y se aplica la precedencia definida en `design.md`.
