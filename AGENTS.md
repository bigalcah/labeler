# Guía del repositorio

## Fuente de verdad

- La aplicación ejecutable todavía es el etiquetador genérico legacy. El estudio de PR planificado **no está implementado**.
- Antes de trabajar en el producto, ejecuta `openspec status --change "card-sorting-prs-mvp" --json` y lee las rutas de
  artifacts devueltas.
- Antes de cambiar código de implementación, dependencias, rutas, vistas, configuración, fixtures o SQL, el cambio
  OpenSpec correspondiente DEBE tener `proposal.md`, specs completas, `design.md` y `tasks.md`. Se recomienda pasar
  `openspec validate "<change>" --strict` como comprobación técnica complementaria, pero esa comprobación no sustituye
  la revisión y aprobación explícita del usuario. No comiences la implementación sin la aprobación del usuario.
- Para el comportamiento objetivo, prioriza `openspec/changes/card-sorting-prs-mvp/` sobre los borradores antiguos de `plans/`.
- Decisiones fijas del MVP: muestra retrospectiva de 300 PRs; 3 participantes configurables por defecto; todos reciben
  los mismos 300 PRs y completan cada tarjeta no retirada; las categorías permanecen ocultas entre participantes; solo
  `CLASSIFIED` tiene exactamente una categoría plana privada; únicamente la taxonomía final normalizada es jerárquica;
  el CSV selecciona la muestra y la API de GitHub enriquece los snapshots; no hay webhooks en el MVP.
- `propose`/`update` de OpenSpec solo sirven para planificar. Los cambios de código deben comenzar únicamente mediante
  una solicitud explícita de apply.
- La implementación DEBE comenzar mediante `/opsx-apply <change>` después de recibir la aprobación explícita del usuario;
  nunca implementes primero para documentar o validar el plan de migración después.

## Comandos

Ejecuta desde la raíz del repositorio; las vistas EJS y `dotenv` dependen del directorio de trabajo.

```bash
npm ci
  npm run dev          # nodemon, desarrollo, http://localhost:3000
  npm run start        # modo producción
  npm run lint:js      # comprobación enfocada y fiable
```

Local Docker stack:

```bash
docker compose --env-file deployment/.env -f deployment/docker-compose.yml up --build -d
docker compose --env-file deployment/.env -f deployment/docker-compose.yml ps
curl http://localhost:7755/actuator/health
docker compose --env-file deployment/.env -f deployment/docker-compose.yml down
```

- `.env` files are ignored. The templates contain shell placeholders, not ready-to-use values; create concrete local
  files without committing credentials.
- `npm run lint` is currently misleading: `lint:css` repeats `stylelint` in its path arguments and
  `.stylelintrc.json` extends missing `stylelint-config-standard`.
- `npm run lint:md` checks only root `*.md`, including this file; it does not cover `plans/` or `openspec/`.
- `npm run minify` rewrites `public/css/*.css` in place. It is a build step, not a read-only verification command.
- There is no test script or automated test suite yet. Do not report tests as passing when only lint/build ran.

## Arquitectura de ejecución

- `index.js` es el punto de entrada: middleware de Express, SSR de EJS, actuator, minificación de respuestas, logs
  rotativos y Socket.io. Al iniciarlo se crea `logs/`.
- `routes/` usa `express-file-routing`: las rutas del sistema de archivos definen las URLs y los módulos exportan
  `get`, `post`, `del`, etc. Los nombres entre corchetes como `[id]` y `[target]` son parámetros de ruta.
- `util/pg-pool.js` es el pool compartido de PostgreSQL. Las rutas ejecutan SQL directamente; no hay ORM ni capa de servicios.
- `schema/01_...` a `06_...` se cargan en orden numérico: esquema, declaraciones, vistas y después implementaciones.
  La aplicación legacy no tiene ejecutor de migraciones.
- El frontend es EJS con JavaScript inline y dependencias CDN; no hay bundler. El renderizado de instancias está
  centralizado en `views/partials/instance/data.ejs`.
- Las exportaciones actuales transmiten JSONL desde vistas de PostgreSQL; no son el paquete reproducible CSV/TSV
  planificado para el estudio.

## Trampas de PostgreSQL y fixtures

- PostgreSQL ejecuta `/docker-entrypoint-initdb.d` solo cuando `PGDATA` está vacío. Los cambios de SQL o fixtures no
  afectan un volumen `labeling-data` existente. `down -v` lo elimina; el siguiente `up` vuelve a cargar esquema y
  fixtures, perdiendo los datos locales.
- Compose monta el CSV de investigación de 300 registros únicamente en el servicio one-shot de preparación del estudio.
- El servicio `labeling-study-prepare` espera PostgreSQL saludable, ejecuta la ruta protegida `clean` o `existing` y debe
  terminar correctamente antes de que arranque `labeling-server`.
- La ruta `existing` exige respaldo externo verificable y confirmación explícita antes de aplicar la migración de retiro;
  la ruta `clean` falla si detecta objetos legacy y nunca los elimina automáticamente.
- `COMPOSE_PROJECT_NAME` cambia el nombre del proyecto, pero los nombres explícitos de contenedores, volumen y red
  (`labeling-*`) aún impiden aislar stacks en paralelo. PostgreSQL solo es interno; la app se expone en el puerto 7755.

## Comportamiento legacy que no debe filtrarse al MVP

- “Login” solo enumera reviewers y confía en un `reviewer_id` enviado por el cliente; no hay sesiones, autorización ni
  protecciones CSRF.
- Los labels son globales, multiselección y se difunden mediante Socket.io. En el MVP, las categorías personales
  permanecen privadas; solo un resultado `CLASSIFIED` tiene exactamente una categoría plana.
- El SQL de candidatos/finalizados fija 2 reviews; la finalización del bucket fija 366.
- Las inserciones de labels de review no se esperan ni son transaccionales.
- La resolución de conflictos elimina o sobrescribe reviews/discards originales y materializa un resultado compartido.
  El MVP debe conservar los originales y almacenar por separado normalización, acuerdo y adjudicación.

## Estilo y flujo de trabajo

- JavaScript usa ESM con 4 espacios, comillas dobles, punto y coma y finales de línea Unix; ante nombres
  intencionalmente no usados, añade el prefijo `_`.
- SQL usa `snake_case`; conserva la separación entre definiciones e implementaciones al tocar SQL legacy.
- Git Flow está inicializado con `master`, `develop` y `feature/`. Usa ramas de feature basadas en `develop`.
- Los mensajes de commit deben ser Conventional Commits escritos en español y tener un cuerpo explicativo. Obtén
  aprobación explícita antes de cualquier commit o push.
- Nunca añadas marcas de agua, texto o enlaces de Sisyphus, trailers automáticos ni líneas `Co-authored-by`, salvo que
  el usuario lo solicite explícitamente para ese commit.
