## Context

`AGENTS.md` declara que la aplicación ejecutable sigue siendo el etiquetador legacy y que el estudio no está implementado. Al mismo tiempo, el worktree contiene rutas, scripts, migraciones, pruebas, Compose y tareas OpenSpec para partes del estudio y del enriquecimiento GitHub. La documentación debe separar existencia estática, verificación ejecutada, comportamiento objetivo y superficies legacy.

## Goals / Non-Goals

**Goals:**

- Aplicar una política uniforme de estado a toda afirmación material.
- Dar a cada documento una responsabilidad y fuente de verdad concreta.
- Hacer comprobables comandos, rutas, variables, servicios, migraciones, enlaces y evidencias.
- Mantener los runbooks de deployment como procedimientos canónicos.
- Permitir que el apply termine sin ejecutar ni alterar infraestructura.

**Non-Goals:**

- No implementar, corregir ni retirar comportamiento runtime.
- No cambiar dependencias, configuración, SQL, fixtures, bases, volúmenes o Compose.
- No completar tareas de otros cambios OpenSpec.
- No ejecutar `npm run minify`, Docker o PostgreSQL durante este apply.

## Decisions

### Política de estado

- `VERIFIED`: respaldado por evidencia identificable del worktree actual; la documentación cita fuente, comando, resultado, fecha, alcance y entorno.
- `IMPLEMENTED-UNVERIFIED`: existe código, configuración, migración, ruta o prueba relacionada, pero no existe evidencia aprobada del comportamiento completo.
- `PLANNED`: aparece solo en proposal, spec, design, tarea pendiente o documentación objetivo.
- `LEGACY`: pertenece al etiquetador genérico anterior, esté presente, aislado o retirado.

Una casilla `[x]`, prueba existente o migración presente no demuestra por sí sola `VERIFIED`. Si las fuentes discrepan, se documenta la discrepancia. La aplicación declarada en `AGENTS.md` es `LEGACY`; archivos actuales del estudio y migraciones son `IMPLEMENTED-UNVERIFIED` salvo hechos estáticos; tareas pendientes son `PLANNED`; existencia de archivos y rutas puede ser `VERIFIED` con alcance estático; Docker/PostgreSQL permanece `IMPLEMENTED-UNVERIFIED` sin evidencia aprobada.

### Precedencia de fuentes

El worktree verifica existencia; `AGENTS.md` gobierna proceso y baseline; OpenSpec describe objetivo y tareas, no evidencia runtime; `package.json` gobierna scripts; Compose gobierna servicios/variables/puertos/volúmenes; los runbooks de `deployment/` son canónicos; `README.md` es índice. `plans/` y `.omo/drafts/` solo son históricos.

### Allowlist y responsabilidades

El apply puede crear o reemplazar exactamente `docs/ARCHITECTURE.md`, `docs/STUDY-WORKFLOW.md`, `docs/DEVELOPMENT.md`, `docs/OPERATIONS.md`, `docs/TROUBLESHOOTING.md`, `docs/MAINTENANCE.md`, `docs/JAVASCRIPT-API.md`, `CONTRIBUTING.md` y `SECURITY.md`. Puede modificar `README.md` solo para navegación/estado/credenciales y `deployment/GITHUB-ENRICHMENT.md` solo para el perfil neutral `default` y placeholders. No copia `deployment/ROLLBACK.md`.

- `ARCHITECTURE`: módulos, rutas, EJS, PostgreSQL, Socket.io y fronteras legacy/prepare/runtime.
- `STUDY-WORKFLOW`: CSV, 300 tarjetas, participantes, privacidad, clasificación, descarte y enriquecimiento.
- `DEVELOPMENT`: instalación, cwd, scripts reales, lint y pruebas.
- `OPERATIONS`: índice y precondiciones que enlaza los runbooks.
- `TROUBLESHOOTING`: cwd, `.env`, configuración de perfiles de credenciales GitHub, readiness, `PGDATA`, migraciones, servicios y logs.
- `MAINTENANCE`: fuentes, drift, evidencia y actualización de estados.
- `JAVASCRIPT-API`: referencia de funciones exportadas, handlers de rutas, clases, métodos públicos y funciones con efectos importantes.
- `CONTRIBUTING`: estilo, OpenSpec, ramas, revisión y commits.
- `SECURITY`: trust boundaries, secretos, datos privados y limitaciones de autenticación/autorización/CSRF.

### Referencia de funciones JavaScript

`docs/JAVASCRIPT-API.md` documentará, sin modificar los archivos `.js`, todos los símbolos que formen parte de una interfaz reutilizable o de un flujo operativo importante en `util/**/*.js`, `scripts/**/*.js` y `routes/**/*.js`: funciones exportadas, handlers de rutas, clases y métodos públicos, además de funciones internas que coordinen transacciones, migraciones, llamadas GitHub, persistencia, proyección o validación. `index.js` se describirá como pipeline de arranque en `ARCHITECTURE`, no como una API de callbacks anónimos.

Cada entrada incluirá módulo y ubicación, propósito, parámetros y tipos observables, retorno, errores, efectos secundarios, dependencias relevantes, estado documental y ejemplo solo cuando sea seguro y útil. La cobertura se verificará mediante un ledger en `docs/JAVASCRIPT-API.md`, con una fila por cada módulo coincidente y por cada export, handler de ruta, clase/método, callable público devuelto por una factory exportada, entrypoint de script de nivel superior y coordinador interno relevante. Cada fila debe estar documentada o incluir una razón explícita de exclusión. Callbacks triviales, closures locales y helpers obvios sin consumidores externos no tendrán una entrada individual; se explicarán dentro del flujo que los usa. No se exigirá JSDoc ni cambios de código.

### Contrato de comandos

Solo se documentan scripts existentes en `package.json`: `dev`, `start`, `lint`, `lint:js`, `lint:css`, `lint:md`, `minify`, `minify:css`, `backup:legacy`, `bootstrap:study`, `enrich:study`, `import:csv`, `migrate:study`, los tres `retire:legacy:*` y los cinco `test:*` existentes. Debe advertirse que no existen `npm test`, `npm run build` ni compilación EJS separada; `lint:md` solo cubre Markdown raíz; `lint` incluye una configuración CSS no fiable; `test:study-concurrency` ejecuta actualmente el mismo archivo que `test:study-http`; minify reescribe archivos.

### Runbooks y seguridad

`docs/OPERATIONS.md` enlaza `deployment/GITHUB-ENRICHMENT.md` y `deployment/ROLLBACK.md` sin copiar procedimientos. El ejemplo GitHub debe usar el perfil neutral único `default` y placeholders inequívocos:

```dotenv
GITHUB_ENRICHMENT_ENABLED=true
GITHUB_API_BASE=https://api.github.com
GITHUB_API_VERSION=2022-11-28
GITHUB_DEFAULT_ALIAS=default
GITHUB_CREDENTIAL_ALIASES={"default":{"tokenEnv":"GITHUB_TOKEN","permissions":["metadata","pulls","contents","issues"]}}
GITHUB_TOKEN=<read-only-token-from-secret-store>
```

No existe routing por repositorio ni se aceptan claves `owner/name`, perfiles adicionales, prefijos o comodines. El README usa `DATABASE_PASS=<set-a-unique-local-password>`. `SECURITY.md` declara que elegir reviewer no autentica identidades y que no existen sesiones, autorización ni CSRF; el aislamiento lógico no se presenta como frontera de seguridad.

### Diagramas y aceptación

Mermaid se limita a arquitectura, preparación y decisiones; cada diagrama tiene una sección equivalente en texto.

La aceptación exige: solo cambios atribuibles al apply dentro de la allowlist de once rutas; nueve documentos con nombres exactos; enlaces README válidos; estados inequívocos; scripts existentes; rutas actuales o `PLANNED`/`LEGACY`; servicios Compose exactos (`labeling-database`, `labeling-study-prepare`, `labeling-server`, `7755:3000`, `labeling-network`, `labeling-data`); variables y migraciones verificadas; enlaces y anchors válidos; Mermaid equivalente; cero secretos; Markdown lint; cobertura de funciones JavaScript según el ledger; y OpenSpec estricto. Docker/PostgreSQL solo es `VERIFIED` con evidencia aprobada de entorno desechable; de otro modo se registra como no ejecutado.

La búsqueda estática de secretos se ejecutará sobre las once rutas Markdown allowlisted y debe devolver cero hallazgos no-placeholder:

```bash
rg -n -P '(github_pat_[A-Za-z0-9_]{10,}|gh[pousr]_[A-Za-z0-9_]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|DATABASE_PASS=(?!<[^>]*>$)\S+|GITHUB_TOKEN=(?!<[^>]*>$)\S+)' README.md CONTRIBUTING.md SECURITY.md docs/*.md deployment/GITHUB-ENRICHMENT.md
```

Los placeholders aceptados comienzan con `<` y terminan con `>`; cualquier valor concreto, clave privada o token encontrado fuera de ese formato bloquea la validación.

## Risks / Trade-offs

- [La matriz envejece] → Revisarla ante cambios de rutas, scripts, migraciones o Compose.
- [Código presente se interpreta como verificado] → Exigir evidencia y conservar `IMPLEMENTED-UNVERIFIED`.
- [Runbooks divergen] → Enlazarlos sin duplicar procedimientos.
- [Placeholders se reutilizan] → Usar `<...>` y búsqueda de secretos.
- [Validación altera infraestructura] → Prohibir Docker/PostgreSQL durante este apply.

## Migration Plan

1. Registrar estado inicial y cambios preexistentes.
2. Crear los nueve documentos y aplicar la matriz de estado.
3. Actualizar README y el ejemplo GitHub autorizado.
4. Verificar comandos, rutas, servicios, variables, migraciones, enlaces y Mermaid.
5. Ejecutar lint Markdown y búsqueda de secretos sin modificar código o infraestructura.
6. Registrar Docker/PostgreSQL como no ejecutado salvo evidencia aprobada.
7. Verificar allowlist y ejecutar validación OpenSpec estricta.

Rollback documental: revertir solo Markdown atribuible a este cambio.

## Open Questions

Ninguna. Alcance, filenames, fuentes, estados, validaciones y evidencia quedan definidos.
