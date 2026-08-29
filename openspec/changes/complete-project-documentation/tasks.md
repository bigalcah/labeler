## 1. Baseline y alcance

- [x] 1.1 Registrar el estado inicial del worktree y separar cambios preexistentes de cambios atribuibles al apply.
- [x] 1.2 Inventariar `AGENTS.md`, README, `package.json`, rutas, scripts, migraciones, Compose, runbooks y cambios OpenSpec activos.
- [x] 1.3 Crear la matriz `VERIFIED`, `IMPLEMENTED-UNVERIFIED`, `PLANNED` y `LEGACY`.
- [x] 1.4 Confirmar que la allowlist contiene solo las once rutas definidas en `design.md`.

## 2. Arquitectura y estudio

- [x] 2.1 Crear `docs/ARCHITECTURE.md` con matriz de estados, módulos, rutas y fronteras legacy/prepare/runtime.
- [x] 2.2 Crear `docs/STUDY-WORKFLOW.md` con CSV, 300 tarjetas, participantes, privacidad y estados de cada flujo.
- [x] 2.3 Marcar como `PLANNED` todo comportamiento respaldado únicamente por specs o tareas pendientes.
- [x] 2.4 Añadir equivalente textual completo inmediatamente después de cada diagrama Mermaid.

## 3. Desarrollo y mantenimiento

- [x] 3.1 Crear `docs/DEVELOPMENT.md` usando exclusivamente scripts actuales de `package.json`.
- [x] 3.2 Documentar que no existen `npm test`, `npm run build` ni compilación EJS separada.
- [x] 3.3 Documentar limitaciones de `lint:md`, `lint`, `test:study-concurrency` y comandos minify.
- [x] 3.4 Crear `docs/TROUBLESHOOTING.md` para cwd, `.env`, aliases, readiness, `PGDATA`, migraciones, servicios y logs.
- [x] 3.5 Crear `docs/MAINTENANCE.md` con fuentes, drift, evidencia y actualización de estados.
- [x] 3.6 Crear `docs/JAVASCRIPT-API.md` con un ledger de una fila por módulo coincidente y por cada export, handler de ruta, clase/método, callable público devuelto por factory exportada, entrypoint de script y coordinador interno relevante.
- [x] 3.7 Documentar cada entrada con módulo/ubicación, propósito, parámetros, retorno, errores, efectos secundarios, dependencias, estado y ejemplos seguros cuando aporten valor.
- [x] 3.8 Excluir callbacks triviales, closures locales y helpers obvios sin consumidores externos, explicándolos dentro del flujo que los utiliza.

## 4. Operación

- [x] 4.1 Crear `docs/OPERATIONS.md` como índice operativo sin duplicar runbooks.
- [x] 4.2 Corregir en `deployment/GITHUB-ENRICHMENT.md` el default inexistente y usar routing exacto `owner/name`.
- [x] 4.3 Sustituir el token de ejemplo por `GITHUB_TOKEN=<read-only-token-from-secret-store>`.
- [x] 4.4 Verificar que rollback, restauración y prohibiciones sobre `labeling-data` remiten a `deployment/ROLLBACK.md`.

## 5. Seguridad y contribución

- [x] 5.1 Crear `SECURITY.md` con trust boundaries, secretos, datos privados y superficies HTTP.
- [x] 5.2 Declarar que reviewer selection no es autenticación y que no hay sesiones, autorización ni CSRF.
- [x] 5.3 Crear `CONTRIBUTING.md` con estilo JavaScript/SQL, OpenSpec, ramas y commits en español.
- [x] 5.4 Prohibir cambios runtime dentro de cambios declarados como documentation-only.

## 6. README y navegación

- [x] 6.1 Reemplazar la contraseña de README por `<set-a-unique-local-password>`.
- [x] 6.2 Añadir estado resumido legacy/estudio sin presentar código como runtime verificado.
- [x] 6.3 Añadir enlaces relativos a los nueve documentos y ambos runbooks.

## 7. Validación estática

- [x] 7.1 Verificar que cada comando npm documentado existe y no recomendar scripts inexistentes.
- [x] 7.2 Verificar que cada archivo y ruta documentados existen o están marcados `PLANNED`/`LEGACY`.
- [x] 7.3 Verificar nombres de servicios, puerto, red y volumen contra ambos Compose.
- [x] 7.4 Verificar variables y consumidores contra `.env.template`, Compose y scripts sin copiar secretos locales.
- [x] 7.5 Verificar IDs, orden y ledger de migraciones contra `schema/migrations/` y `util/study-schema.js`.
- [x] 7.6 Verificar cero enlaces/anchors rotos y equivalencia entre Mermaid y texto.
- [x] 7.7 Ejecutar la búsqueda de secretos definida en `design.md` y exigir cero hallazgos.
- [x] 7.8 Ejecutar `npm run lint:md` y `npx --no-install markdownlint "docs/**/*.md" "deployment/GITHUB-ENRICHMENT.md"`.
- [x] 7.9 Comparar el ledger de `docs/JAVASCRIPT-API.md` con exports, handlers, clases/métodos, callables devueltos por factories, entrypoints de `scripts/**/*.js` y coordinadores relevantes de `util/**/*.js`; registrar cada exclusión justificadamente.

## 8. Evidencia y cierre

- [x] 8.1 Registrar Docker/PostgreSQL como no ejecutado y `IMPLEMENTED-UNVERIFIED` sin entorno desechable aprobado.
- [x] 8.2 Verificar que el apply no ejecutó Compose ni modificó bases, contenedores, redes o volúmenes.
- [x] 8.3 Comparar estado final con inicial y confirmar que no se alteraron cambios ajenos ni rutas fuera de allowlist.
- [x] 8.4 Ejecutar `openspec validate "complete-project-documentation" --strict` y registrar el resultado.
