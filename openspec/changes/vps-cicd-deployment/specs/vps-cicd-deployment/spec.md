## Purpose

Esta capacidad permite convertir cada push a `master` en una release reproducible y verificable de producción,
desplegada automáticamente en la VPS sin exponer secretos ni tratar la base de datos persistente como un artefacto
descartable.

## ADDED Requirements

### Requirement: Master pushes produce gated production releases

El sistema SHALL iniciar un intento de release por cada push a `master` y SHALL ejecutar todos los gates de calidad,
integración y E2E requeridos antes de publicar imágenes o contactar la VPS. Un gate fallido SHALL detener el release sin
modificar el runtime de producción.

#### Scenario: Stable master push passes validation

- **WHEN** un commit llega a `master` y todos los gates obligatorios terminan correctamente
- **THEN** el sistema publica el artefacto de esa revisión y habilita exclusivamente su despliegue en producción

#### Scenario: Required gate fails

- **WHEN** cualquier gate obligatorio devuelve un código distinto de cero
- **THEN** el sistema marca el release como fallido y no publica imágenes ni ejecuta comandos de despliegue en la VPS

#### Scenario: Non-production branch changes

- **WHEN** un commit llega a `develop` o a otra rama que no sea `master`
- **THEN** el sistema no inicia un despliegue de producción

### Requirement: Releases are reproducible and immutable

Cada release SHALL incluir las imágenes de servidor y base de datos construidas desde el mismo commit, referencias
inmutables por commit y digest, y el CSV canónico de 300 tarjetas asociado a esa revisión. El despliegue SHALL usar los
digests registrados y SHALL rechazar referencias mutables o ausentes.

#### Scenario: Release artifact is published

- **WHEN** termina correctamente la construcción del commit de `master`
- **THEN** el registro contiene las imágenes requeridas y el metadato de release relaciona cada imagen y el CSV con el
  commit exacto

#### Scenario: Mutable image reference is supplied

- **WHEN** un release intenta desplegar una etiqueta mutable, una imagen `latest` o una imagen sin digest registrado
- **THEN** la operación falla antes de recrear servicios

#### Scenario: VPS has no source checkout

- **WHEN** la VPS recibe un release válido sin un checkout del repositorio
- **THEN** el preparador puede leer el CSV canónico desde el artefacto de release y no depende de archivos del workspace
  del runner

### Requirement: Production secrets and persistent state remain on the VPS

El sistema SHALL mantener en la VPS el archivo de configuración de producción, los secretos de PostgreSQL, sesión,
cuentas y backups, además de los volúmenes persistentes. GitHub Actions SHALL recibir únicamente las credenciales
mínimas necesarias para el canal de despliegue y SHALL evitar imprimir secretos, tokens o valores de configuración
privada.

#### Scenario: Release is deployed

- **WHEN** el job de producción conecta con la VPS
- **THEN** solo usa una identidad de despliegue restringida y el runtime conserva los archivos de secretos y el volumen
  `labeling-data` existentes

#### Scenario: Application secret is requested by the workflow

- **WHEN** el workflow necesita una contraseña de aplicación, clave de sesión, manifiesto de cuentas o clave de backup
- **THEN** la operación falla o delega la lectura al entorno protegido de la VPS sin copiar ese secreto al repositorio ni
  a los logs de Actions

### Requirement: Deployment applies changes in a fail-closed order

La operación remota SHALL adquirir exclusión mutua, validar el release y la configuración de Compose, comprobar que las
imágenes estén disponibles, ejecutar el backup requerido antes de cualquier migración, y respetar el orden PostgreSQL
saludable → preparación exitosa → servidor saludable → borde HTTPS. Producción SHALL usar imágenes ya construidas y no
deberá reconstruir desde el código fuente.

#### Scenario: Preflight or backup fails

- **WHEN** la configuración, la descarga de imágenes, el lock o el backup previo falla antes de reemplazar el servidor
- **THEN** el release queda fallido, se conservan la versión activa y los datos persistentes, y no se ejecutan
  migraciones nuevas

#### Scenario: Preparation fails

- **WHEN** la validación, migración, guardia legacy, bootstrap o enriquecimiento del preparador falla
- **THEN** el servidor nuevo no se declara listo, el release queda fallido con evidencia diagnóstica y la operación no
  borra el volumen ni continúa hacia el tráfico público

#### Scenario: Release passes runtime verification

- **WHEN** PostgreSQL, el preparador, el servidor y Caddy cumplen sus health checks y una petición HTTPS externa a
  `/login` devuelve éxito
- **THEN** el sistema marca el digest como release activo y conserva la referencia anterior para recuperación

### Requirement: Failures and rollback preserve explicit database boundaries

El sistema SHALL diferenciar rollback de imagen de restauración de datos. Podrá restaurar automáticamente una imagen
anterior solo cuando el release declare compatibilidad con el esquema existente; SHALL NOT revertir migraciones ni usar
`down -v` automáticamente. Una recuperación escribible de PostgreSQL SHALL usar el backup verificado y el procedimiento
de restauración en un destino separado o aprobado.

#### Scenario: Application smoke check fails after replacement

- **WHEN** la nueva imagen no supera el health check o el smoke test después de reemplazar el servidor
- **THEN** el release queda fallido, conserva logs y metadatos, y solo intenta volver a la imagen anterior si la
  compatibilidad de esquema está declarada

#### Scenario: Database schema is incompatible

- **WHEN** una versión anterior no puede operar de forma segura con el esquema ya migrado
- **THEN** el sistema no ejecuta un rollback escribible automático y remite a la restauración verificada en un destino
  separado

#### Scenario: Concurrent master releases overlap

- **WHEN** dos releases de `master` intentan desplegarse simultáneamente
- **THEN** un lock de producción serializa la operación y una release antigua no puede sobrescribir el metadato de una
  release posterior ya activa
