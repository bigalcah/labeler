## MODIFIED Requirements

### Requirement: Estudio local configurable
El sistema SHALL operar con exactamente un estudio `READY` para esta fase y tres participantes configurables: `javier`, `diego` y `pablo` por defecto.

#### Scenario: Configuración por defecto
- **WHEN** se inicia el estudio sin configuración explícita
- **THEN** se usa el estudio configurado, sus tres participantes y sus 300 tarjetas

#### Scenario: Estudio ambiguo
- **WHEN** no existe ningún estudio `READY` o existe más de uno
- **THEN** las rutas de estudio fallan explícitamente y no leen ni escriben tarjetas globales

### Requirement: Misma muestra para cada participante
El sistema MUST resolver las tarjetas mediante `study_card` del único estudio `READY` y asociar las mismas 300 tarjetas a cada participante activo.

#### Scenario: Cobertura completa
- **WHEN** los tres participantes recorren sus colas
- **THEN** cada uno recibe cada PR una vez como pendiente hasta clasificarlo o descartarlo

#### Scenario: Descarte aislado
- **WHEN** un participante descarta un PR
- **THEN** el PR sigue perteneciendo a `study_card` y permanece disponible para los demás

### Requirement: Progreso independiente
El sistema SHALL mostrar solo el progreso del participante actual con `classified + discarded + pending = 300`.

#### Scenario: Avance parcial
- **WHEN** un participante ha clasificado o descartado 25 tarjetas
- **THEN** ve sus conteos 25 completadas y 275 pendientes, sin revelar el avance de otra persona

## ADDED Requirements

### Requirement: Runner de migraciones versionadas
El runner SHALL gestionar únicamente `001_study_foundation` y `003_private_pr_discard`, en ese orden; SHALL reconocer `002_retire_legacy_labeler` como ID externo protegido ya aplicado, pero MUST NOT ejecutarlo. Cualquier otro ID del ledger MUST detener el runner antes de ejecutar migraciones pendientes. Cada migración gestionada controla su propia transacción y su propia fila de ledger; el runner no escribe el ledger.

#### Scenario: Base limpia
- **WHEN** el runner prepara una base limpia
- **THEN** deja registradas `001_study_foundation` y `003_private_pr_discard` antes del bootstrap

#### Scenario: Base existente retirada
- **WHEN** el runner prepara una base existente con `001` y `002` registradas
- **THEN** omite las ya aplicadas, ejecuta `003` y no repite la retirada legacy

#### Scenario: Repetición idempotente
- **WHEN** el runner se ejecuta dos veces con el mismo ledger
- **THEN** la segunda ejecución no repite SQL ni crea filas duplicadas

#### Scenario: ID desconocido
- **WHEN** el ledger contiene un ID distinto de `001`, `002` o `003`
- **THEN** el runner falla antes de ejecutar una migración gestionada pendiente

#### Scenario: Ejecución parcial
- **WHEN** se solicita `--through 001_study_foundation`
- **THEN** el runner aplica únicamente `001` y rechaza `002` como destino

### Requirement: Orden de preparación
El modo `clean` MUST ejecutar `clean-check`, el runner completo y luego bootstrap. El modo `existing` MUST verificar el backup, ejecutar el runner hasta `001`, ejecutar `002` protegido si falta, ejecutar el runner completo para `003` y finalmente bootstrap.

#### Scenario: Bootstrap incompleto
- **WHEN** faltan `001` o `003` en `labeler_migration`
- **THEN** bootstrap falla antes de cualquier escritura y no aplica migraciones

### Requirement: Rollback de solo lectura
Después de existir descartes, una versión anterior MUST arrancar únicamente mediante un launcher que omita el preparador, use un rol sin privilegios DML/DDL y tenga `default_transaction_read_only=on`; un rollback escribible requiere restaurar un backup pre-descarte en otra base aprobada.

#### Scenario: Rollback posterior al uso
- **WHEN** se intenta arrancar la versión anterior sobre una base con descartes
- **THEN** el procedimiento de rollback impide escrituras y permite únicamente consultas
