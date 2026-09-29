## Purpose

Define el pipeline CI/CD canónico de `master` como inmutable: restaura el baseline previo al incidente `b63951f`, impide que merges de producto lo alteren y exige un proceso dedicado y aprobado para cualquier modificación futura.

## ADDED Requirements

### Requirement: Baseline canónico restaurado y compartido

`.github/workflows/**` y `deployment/docker-compose.release.yml` SHALL ser byte a byte idénticos al baseline `b409233` en `develop` y en `master`, de modo que ambos branches compartan un único pipeline canónico. La restauración SHALL revertir el cambio importado en `shared-validation.yml` y SHALL alinear `release.yml` y el compose de release en `develop`.

#### Scenario: Reversión del cambio importado
- **WHEN** se compara `.github/workflows/shared-validation.yml` con `b409233`
- **THEN** no existe ninguna diferencia y la propagación de estado de teardown introducida por `c639c6a` ya no está presente

#### Scenario: Convergencia de release.yml y su compose
- **WHEN** se comparan `.github/workflows/release.yml` y `deployment/docker-compose.release.yml` con `b409233`
- **THEN** ambos archivos coinciden byte a byte en `develop` y `master`

### Requirement: Inmutabilidad ante merges de producto

Ningún merge de producto hacia `master` SHALL modificar, añadir, renombrar o eliminar archivos del pipeline. La auditoría previa al merge SHALL comparar el rango completo del merge contra las rutas del pipeline y SHALL detener la integración si aparece cualquier diferencia que no provenga de un cambio dedicado aprobado.

#### Scenario: Merge con deriva detenido
- **WHEN** el diff del merge contiene cualquier archivo de `.github/workflows/**` o `deployment/docker-compose.release.yml` que no corresponde a un cambio dedicado aprobado
- **THEN** el merge no se ejecuta y la deriva se reporta

#### Scenario: Cambio dedicado aprobado
- **WHEN** un cambio dedicado aprobado actualiza workflow, baseline de huellas y pruebas de contrato en el mismo cambio
- **THEN** ese merge es el único autorizado a contener diferencias del pipeline

### Requirement: Detección automática de deriva

Una prueba automatizada SHALL verificar la huella SHA-256 de cada archivo congelado y el conjunto exacto de workflows, y SHALL fallar ante cualquier modificación, adición, renombrado o eliminación. El mensaje de fallo SHALL indicar que se requiere un cambio dedicado aprobado.

#### Scenario: Pipeline intacto
- **WHEN** se ejecuta la suite unitaria sobre el baseline congelado
- **THEN** la prueba de huellas pasa

#### Scenario: Byte alterado detectado
- **WHEN** cualquier archivo congelado cambia aunque sea un byte
- **THEN** la prueba falla con el mensaje de proceso dedicado

#### Scenario: Conjunto de workflows alterado
- **WHEN** se añade, renombra o elimina un workflow
- **THEN** la prueba falla

### Requirement: Rutas del pipeline con revisión de propietario

El repositorio SHALL declarar las rutas del pipeline en `CODEOWNERS`, y la documentación SHALL registrar que la eficacia plena exige que la protección de rama del repositorio requiera la revisión del propietario y el resultado de la prueba de congelamiento.

#### Scenario: PR que toca el pipeline
- **WHEN** una propuesta de cambio modifica una ruta del pipeline
- **THEN** se solicita la revisión del propietario declarado y la prueba de congelamiento bloquea el avance hasta el proceso dedicado

### Requirement: Regla absoluta para agentes

`AGENTS.md` SHALL declarar el pipeline de CI/CD de `master` como intocable por ningún motivo y SHALL incluir el comando de auditoría obligatorio antes de cualquier merge a `master`.

#### Scenario: Agente prepara un merge a master
- **WHEN** un agente trabaja en un merge hacia `master`
- **THEN** ejecuta la auditoría de rutas del pipeline y se detiene si hay deriva

#### Scenario: Intento directo de modificar el pipeline
- **WHEN** una tarea solicita alterar un workflow fuera del proceso dedicado
- **THEN** la regla lo prohíbe y exige el cambio dedicado aprobado
