# Arquitectura

## Alcance y estados

Este documento describe el worktree actual mediante estos estados:

- **VERIFIED**: comprobado estáticamente en archivos, rutas o configuración; no significa que el runtime funcione.
- **IMPLEMENTED-UNVERIFIED**: existe código relacionado, pero no hay evidencia runtime aprobada.
- **PLANNED**: definido solo por OpenSpec, planes o tareas pendientes.
- **PENDING-EVIDENCE**: implementación disponible, pero falta la evidencia operativa o histórica
  exigida para el cierre.
- **LEGACY**: pertenece al etiquetador genérico anterior.

La implementación central del estudio multiestudio está disponible. La validación E2E hostil aislada
de los dos perfiles también está completada. Las superficies que aún requieren evidencia externa o
histórica se marcan como `PENDING-EVIDENCE`; no se presentan como pruebas ejecutadas en VPS,
backup/restore o captura live de GitHub.

## Contrato multiestudio

Solo se admiten dos perfiles y ambos pueden permanecer en `READY` en la misma base:

| Orden | `study_key` | Tarjetas | Usernames de login |
| --- | --- | ---: | --- |
| 1 | `pr-card-sorting-local` | 300 | `javier`, `diego`, `pablo` |
| 2 | `pr-card-sorting-validation-30` | 30 | `javier-30`, `diego-30`, `pablo-30` |

La clave visible del participante sigue siendo `javier`, `diego` o `pablo`. El username solo
autentica y busca una cuenta. La cuenta y la sesión persisten el `study_id`, que es la única
autoridad para estudio, membresía y participante. No se interpreta `-30` y no existe selector de
participante ni selector de estudio para participantes. Tampoco se aceptan conteos arbitrarios ni
hay UI administrativa.

El CSV selecciona cada muestra y conserva su checksum, orden y procedencia. La muestra de 30 se
deriva de forma determinista del CSV canónico de 300. Cada participante recibe la misma membresía
del perfil, pero sus categorías, clasificaciones, descartes, observaciones y progreso se filtran
por el contexto privado de su sesión.

## Aplicación web

**VERIFIED, alcance estático:** `index.js` crea Express, carga `dotenv`, sirve `public/`, renderiza EJS, parsea JSON y
formularios, añade paginación y `res.locals`, sanea Markdown, minifica HTML/JavaScript inline, comprime respuestas,
expone actuator bajo `/actuator`, carga `routes/` mediante `express-file-routing`, registra logs rotativos y maneja
errores. El puerto del proceso es `3000`; Compose publica `7755:3000`.

No existe bundler ni compilación EJS separada: las vistas se renderizan en runtime y consumen parciales, JavaScript
inline y dependencias CDN. La tarjeta se centraliza en `views/partials/instance/data.ejs`.

**IMPLEMENTED-UNVERIFIED:** la existencia de middleware y vistas no prueba que el servidor arranque o responda.

## Rutas filesystem

**VERIFIED, alcance estático:** `app.use("/", await router())` carga rutas desde `routes/`; `[id]` es un parámetro
de tarjeta o categoría. Las superficies del estudio incluyen:

- `/`, `/login`, `/logout`, `/queue`, `/queue/:id` y `/progress`.
- `/categories` y `/categories/:id`.
- `/queue/:id/classify` y `/queue/:id/discard`.
- `/actuator/health` y el fallback de error 404.

Las rutas derivan estudio, participante, tarjeta y progreso de la sesión validada. No reciben nombres
de participante o estudio en path, query, formulario ni cabeceras. La existencia de las rutas es
`VERIFIED` estáticamente; sus códigos HTTP y renderizado son `IMPLEMENTED-UNVERIFIED`.

## Persistencia y migraciones

`util/pg-pool.js` exporta el pool PostgreSQL compartido y las rutas ejecutan SQL directamente, sin ORM. El baseline usa
`pr_cards`; la muestra y orden usan `study_card`; la privacidad usa `study_participant`, `participant_category`,
`pr_classification` y `pr_discard`. `participant_account` y `app_session` vinculan las credenciales y sesiones con el
`study_id`. GitHub añade runs, páginas, snapshots y promoción sin mutar `pr_cards` ni `study_card`.

Las migraciones gestionadas cubren `001_study_foundation` y `003` a `012`, incluida la coexistencia de perfiles y la
unicidad global de usernames. `002_retire_legacy_labeler` es externa al runner común y solo se aplica mediante la ruta
de retiro protegida. El ledger es `labeler_migration`. Los SQL históricos bajo `schema/01_...` a `06_...` son
**LEGACY**.

**IMPLEMENTED-UNVERIFIED:** la estructura y el flujo están implementados, pero la evidencia externa de backup/restore y
la ejecución pública siguen pendientes.

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

## Acceso, privacidad y exportación

El login usa las cuentas provisionadas del perfil. Una sesión opaca en PostgreSQL conserva la cuenta,
la membresía y el `study_id` persistidos, además de la versión de credenciales, expiración y CSRF.
Las rutas protegidas recargan ese contexto y no aceptan identificadores de estudio o participante
desde el cliente. Logout es una mutación POST protegida por CSRF.

Cada participante recibe todas las tarjetas del perfil en el mismo orden. `CLASSIFIED` tiene
exactamente una categoría plana, privada y propia. `DISCARDED` conserva un motivo opcional y no
elimina `pr_cards` ni `study_card`. No se difunden categorías, decisiones, descartes ni progreso.

La exportación se ejecuta offline por un operador con `--study-key` explícito. Solo lee un estudio
`READY` completamente terminado y publica `results.csv`, `categories.csv` y `manifest.json` en
una ruta externa. El paquete usa pseudónimos HMAC y checksums, pero no contiene sesiones, hashes
de credenciales, tokens, secretos, throttling ni payloads crudos. No existe ruta HTTP `/export`.

## Prepare y runtime

**VERIFIED, alcance estático:** Compose define `labeling-database`, `labeling-study-prepare` y `labeling-server`, la
red `labeling-network`, el volumen `labeling-data` y el puerto `7755:3000`. El preparador recibe el descriptor, los CSV,
los manifests de cuentas y, si se activa, el secreto GitHub. El servidor recibe solo configuración PostgreSQL y depende
de la finalización exitosa de los dos perfiles.

El flujo es: PostgreSQL saludable, preflight de todos los perfiles, migraciones y guardas, bootstrap
transaccional de 300, bootstrap transaccional de 30, cuentas y validación de ambos estados `READY`,
enriquecimiento opcional durante prepare, servidor interno y, finalmente, Caddy. PostgreSQL solo
ejecuta init scripts cuando `PGDATA` está vacío; borrar el volumen no es rollback.

## Socket.io y legacy

**VERIFIED, alcance estático:** el `package.json` actual no declara Socket.io y `index.js` no crea un servidor Socket.io.
La difusión de labels globales descrita por `AGENTS.md` es **LEGACY** y no debe reaparecer en el estudio.

También son **LEGACY** los labels globales, conflictos destructivos, fixtures antiguos y exportaciones JSONL del
etiquetador anterior. Son **PLANNED** la taxonomía final jerárquica, normalización, acuerdo/adjudicación, webhooks y
workers GitHub permanentes. La captura live de GitHub permanece pendiente, aunque el enriquecimiento prepare-only ya
está implementado.

## Evidencia pendiente

El E2E hostil aislado de los dos perfiles está completado. Siguen pendientes el backup y restore
externos verificables, el E2E hostil histórico, el E2E completo en VPS o entorno público, el cierre
documental histórico y la captura live de GitHub. Estas pendientes no cambian el contrato
implementado ni deben presentarse como pruebas ejecutadas.

## Fuentes

`AGENTS.md`, `index.js`, `package.json`, `routes/`, `views/`, `util/`, `schema/migrations/`,
`deployment/docker-compose.yml`, `scripts/prepare-study-deployment.sh` y los cambios OpenSpec activos son las fuentes
de este resumen. Cuando discrepan, se conserva la discrepancia y se aplica la precedencia definida en `design.md`.
