## Why

El repositorio contiene una contradicción entre `AGENTS.md`, que identifica la aplicación ejecutable como legacy, y archivos, scripts y documentación que describen partes del estudio como implementadas. La documentación debe presentar esa diferencia de forma verificable, sin convertir código presente, tareas marcadas o planes OpenSpec en evidencia de ejecución.

## What Changes

- Adoptar una política común de estado documental: `VERIFIED`, `IMPLEMENTED-UNVERIFIED`, `PLANNED` y `LEGACY`.
- Crear exactamente:
  - `docs/ARCHITECTURE.md`
  - `docs/STUDY-WORKFLOW.md`
  - `docs/DEVELOPMENT.md`
  - `docs/OPERATIONS.md`
  - `docs/TROUBLESHOOTING.md`
  - `docs/MAINTENANCE.md`
  - `docs/JAVASCRIPT-API.md`
  - `CONTRIBUTING.md`
  - `SECURITY.md`
- Actualizar `README.md` como índice y retirar ejemplos de credenciales realistas.
- Mantener `deployment/GITHUB-ENRICHMENT.md` y `deployment/ROLLBACK.md` como runbooks canónicos, enlazándolos sin duplicar sus procedimientos.
- Corregir el ejemplo de alias GitHub inconsistente.
- Documentar solo comandos existentes y aclarar que no existen `npm test`, `npm run build` ni una compilación EJS separada.
- Documentar las limitaciones actuales: seleccionar un reviewer no es autenticación y no existen sesiones, autorización ni CSRF.
- Documentar funciones exportadas, handlers de rutas, clases y métodos públicos o con efectos importantes sin añadir comentarios al código fuente.
- Establecer aceptación verificable para comandos, rutas, servicios, variables, migraciones, enlaces, Mermaid, Markdown lint, secretos y evidencia Docker/PostgreSQL.
- Clasificar Docker/PostgreSQL como `IMPLEMENTED-UNVERIFIED` salvo evidencia aprobada de un entorno desechable.

## Capabilities

### New Capabilities

No aplica. El cambio produce documentación y no introduce comportamiento observable.

### Modified Capabilities

No aplica. Ningún requisito funcional o contrato runtime cambia.

El cambio conserva `skip_specs: true` en `.openspec.yaml`; una delta spec describiría comportamiento, pero este cambio solo documenta y clasifica comportamiento existente o planificado.

## Impact

La allowlist de escritura durante `/opsx-apply` queda limitada a:

- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- Los siete archivos `docs/*.md` indicados arriba
- `deployment/GITHUB-ENRICHMENT.md`, únicamente para corregir aliases y placeholders

`deployment/ROLLBACK.md` permanece como referencia canónica y no se modifica; cualquier enlace roto preexistente queda fuera de alcance.

El apply no modificará código, dependencias, `package.json`, lockfiles, rutas, vistas, SQL, migraciones, fixtures, configuración ejecutable, plantillas `.env`, bases, contenedores, redes, volúmenes ni cambios preexistentes fuera de la allowlist.
