## Purpose

Construir la imagen del servidor de forma reproducible contra la base fijada, manteniendo paquetes Alpine declarados con restricciones de serie que resuelven aunque el repositorio upstream publique parches o retire revisiones exactas, sin romper el gate de lint de Dockerfiles.

## ADDED Requirements

### Requirement: Restricciones de serie para paquetes Alpine

El Dockerfile del servidor SHALL declarar cada paquete Alpine adicional con una restricción de serie menor (`=~<serie>`) compatible con la base fijada, y SHALL NOT fijar revisiones exactas (`=*-rN`) que el repositorio upstream pueda retirar.

#### Scenario: Resolución de paquetes durante el build

- **WHEN** se construye la imagen del servidor contra la base `node:22.13.1-alpine`
- **THEN** `apk` resuelve todos los paquetes declarados y cada stage termina con éxito

#### Scenario: Revisión upstream nueva dentro de la serie

- **WHEN** Alpine publica una revisión nueva dentro de la serie declarada (por ejemplo `python3 3.12.15-r0` u `openssl 3.3.7-r2`)
- **THEN** el build sigue resolviendo sin modificar el Dockerfile

#### Scenario: Revisión upstream exacta retirada

- **WHEN** Alpine retira una revisión exacta previamente fijada (por ejemplo `python3 3.12.14-r0`)
- **THEN** ninguna restricción del Dockerfile depende de esa revisión retirada y el build no falla por selección de paquetes

### Requirement: Base fijada y conjunto de paquetes preservados

La imagen del servidor SHALL mantener `node:22.13.1-alpine` como base en ambos stages, SHALL conservar los paquetes requeridos (`build-base`, `gettext`, `moreutils`, `python3`, `curl`, `jq`, `openssl`, `postgresql17-client`) y SHALL NOT introducir etiquetas mutables.

#### Scenario: Runtime conserva OpenSSL

- **WHEN** se inspecciona el stage runtime del Dockerfile
- **THEN** `openssl` está declarado con restricción de serie y utilizable por los backups cifrados

#### Scenario: Sin etiquetas mutables

- **WHEN** se inspecciona el Dockerfile
- **THEN** ambos stages usan la etiqueta fijada `node:22.13.1-alpine` y no `latest`

### Requirement: Gate de Hadolint limpio

El Dockerfile del servidor SHALL superar el lint de Dockerfiles del pipeline manteniendo cada paquete con versión fijada explícita.

#### Scenario: Lint de Dockerfiles

- **WHEN** el pipeline ejecuta Hadolint sobre `deployment/server/Dockerfile`
- **THEN** no se reporta la regla DL3018 de paquetes sin versión fijada
