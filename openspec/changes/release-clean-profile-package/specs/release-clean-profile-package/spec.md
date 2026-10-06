## Purpose

Esta capacidad garantiza que cada release de producción prepare los dos perfiles aprobados del estudio desde archivos
externos de la VPS, sin depender del checkout ni exponer manifests o secretos en el paquete.

## ADDED Requirements

### Requirement: Production release packages clean multi-study wiring

El paquete de producción SHALL contener una composición autónoma que active la preparación ordenada de los perfiles de
300 y 30 tarjetas mediante un descriptor externo. La composición SHALL montar las configuraciones y manifests solo en
`labeling-study-prepare` y SHALL NOT montar archivos desde `plans/`.

#### Scenario: Release package prepares both profiles

- **WHEN** la VPS ejecuta un paquete válido con sus cinco archivos externos de perfiles
- **THEN** `labeling-study-prepare` recibe `STUDY_PROFILES_INPUT` y prepara primero el perfil de 300 y después el de 30

#### Scenario: Profile inputs are not exposed to runtime services

- **WHEN** Compose renderiza la composición de producción
- **THEN** el servidor y Caddy no reciben mounts de configuraciones o manifests de perfiles

### Requirement: Release package remains portable and allowlisted

La composición empaquetada SHALL conservar rutas externas parametrizadas, nombres de red y volumen persistente, y el
archivo comprimido SHALL contener exactamente `Caddyfile`, `docker-compose.yml` y `release-manifest.json`.

#### Scenario: Package is received without a repository checkout

- **WHEN** el launcher instala el paquete en la VPS sin workspace del repositorio
- **THEN** Compose puede renderizarlo usando únicamente el `.env` y los archivos externos del host

#### Scenario: Unexpected package content is supplied

- **WHEN** el paquete contiene un archivo adicional, un mount `plans/` o una referencia de build productiva
- **THEN** la validación falla antes del backup, la preparación o el reemplazo del runtime

### Requirement: Production preparation retains fail-closed deployment order

La release SHALL conservar la descarga por digest, el backup verificado antes de la preparación y el arranque productivo
con `--no-build`, sin eliminar el volumen `labeling-data`.

#### Scenario: Preparation fails

- **WHEN** falta un archivo externo, falla la validación de perfiles o falla el bootstrap de cualquiera de los estudios
- **THEN** el launcher conserva la release activa y no declara la nueva release como `current`

#### Scenario: Valid preparation reaches runtime

- **WHEN** los perfiles quedan `READY` y las verificaciones de imágenes pasan
- **THEN** servidor y Caddy se inician sin build y el smoke test HTTPS puede completar la publicación de `current`
