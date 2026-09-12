## Why

El despliegue estable todavía depende de ejecutar manualmente `docker compose up --build` en la VPS, lo que mezcla la
construcción con el entorno de producción y no deja una versión reproducible para recuperar. Cada push a `master` ya
representa una versión estable, por lo que debe atravesar los mismos gates y llegar automáticamente a la VPS sin
transportar secretos ni poner en riesgo el volumen PostgreSQL.

## What Changes

- Añadir un flujo de release activado por cada `push` a `master`, bloqueado por los gates de calidad, integración y E2E.
- Construir las imágenes de servidor y base de datos en runners administrados por GitHub y publicarlas en GHCR con
  referencias inmutables por commit y digest.
- Hacer que el artefacto de release contenga también el CSV canónico de 300 tarjetas, evitando depender de un checkout
  de código en la VPS.
- Parametrizar Compose para consumir las imágenes y el artefacto de la versión seleccionada sin reconstruir en
  producción.
- Desplegar mediante un usuario SSH restringido y una operación remota idempotente que valide configuración, adquiera
  un lock, ejecute el backup previo requerido, espere la preparación y verifique la aplicación por HTTPS.
- Conservar en la VPS el `.env`, los secretos externos, los volúmenes persistentes y las versiones anteriores; no
  copiar credenciales de la aplicación a GitHub Actions.
- Documentar criterios de éxito, evidencia del release, concurrencia, fallos y límites entre rollback de imagen y
  restauración de base de datos.
- Mantener la validación de pull requests y no instalar un runner autoalojado en la VPS de producción.

## Capabilities

### New Capabilities

- `vps-cicd-deployment`: automatización fail-closed de releases desde `master` hacia una VPS mediante imágenes
  inmutables, despliegue remoto controlado, verificación operativa y rollback seguro.

### Modified Capabilities

Ninguna. Las capacidades del estudio y del etiquetado no cambian sus requisitos funcionales.

## Impact

- Afecta `.github/workflows/`, `deployment/docker-compose.yml`, los Dockerfiles y nuevos scripts/runbooks de release.
- Añade el uso de GHCR, un entorno protegido de GitHub y una cuenta SSH de despliegue con permisos mínimos.
- Requiere configuración persistente externa en la VPS para registry, secretos, backups, locks y metadatos de releases.
- No cambia rutas HTTP públicas ni el esquema funcional del estudio, pero coordina el punto existente de migraciones y
  bootstrap antes de iniciar el servidor.
