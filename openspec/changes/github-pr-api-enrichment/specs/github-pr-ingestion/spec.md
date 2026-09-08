## MODIFIED Requirements

### Requirement: Contrato de proveedor de tarjetas
El sistema SHALL construir una proyección de tarjeta desde el baseline CSV persistido. GitHub MAY aportar una sección aditiva `enrichment` desde el run promovido, pero MUST conservar `source_type = CSV`, `source_card_id`, `source_pr_id`, repositorio, número, payload CSV, checksums y ordinal sin modificación.

#### Scenario: Proveedor CSV activo
- **WHEN** una tarjeta se crea desde el CSV
- **THEN** conserva su contrato CSV, payload original, checksums y procedencia aunque posteriormente sea enriquecida

#### Scenario: Proveedor GitHub futuro
- **WHEN** una futura fuente GitHub produce una proyección con el mismo contrato
- **THEN** el explorador puede consumirla sin cambiar la estructura de la vista ni sustituir la identidad CSV

#### Scenario: Proyección enriquecida
- **WHEN** el estudio tiene un run promovido con snapshot para la tarjeta
- **THEN** el explorador recibe el baseline CSV, la sección `enrichment` y la procedencia de cada campo sin crear otra identidad de tarjeta

### Requirement: Fuente GitHub inactiva durante el MVP
El sistema MUST clasificar únicamente con datos persistidos y MUST NOT consultar GitHub desde el navegador, rutas web, plantillas o Socket.io. La preparación MAY ejecutar enriquecimiento offline cuando esté habilitado explícitamente; la importación y clasificación CSV-only MUST funcionar sin configuración ni credenciales GitHub.

#### Scenario: Clasificación sin red externa
- **WHEN** un participante abre o decide una tarjeta CSV-only o enriquecida
- **THEN** la aplicación usa exclusivamente el baseline y el run promovido ya persistidos

#### Scenario: CSV sin enriquecimiento
- **WHEN** el modo GitHub está deshabilitado
- **THEN** el bootstrap prepara las 300 tarjetas sin resolver credenciales ni realizar solicitudes externas

### Requirement: Importación idempotente
El sistema MUST reutilizar una tarjeta existente únicamente cuando `source_card_id`, contenido canónico CSV y checksum coinciden. Un cambio para un ID persistido MUST fallar sin ejecutar `UPDATE`, borrado ni reemplazo; los snapshots GitHub se versionan separadamente y nunca participan en el checksum CSV.

#### Scenario: Reimportación
- **WHEN** se importa nuevamente el mismo CSV
- **THEN** se conservan una identidad, un payload CSV, los mismos checksums, ordinales, clasificaciones, descartes y snapshots

#### Scenario: Conflicto canónico
- **WHEN** cambia cualquier contenido canónico de una fila con `source_card_id` persistido
- **THEN** la importación falla antes de escribir y conserva íntegramente el estado anterior

## ADDED Requirements

### Requirement: Proyección aditiva y procedencia determinista
El sistema MUST construir la tarjeta leída sin modificar `pr_cards` ni `study_card`. Para campos superpuestos, título, cuerpo, autor, estado, merged, URL y fechas usarán el valor GitHub no nulo del run promovido y, en su ausencia, el valor CSV; `language` siempre conservará el valor CSV. Las métricas GitHub solo prevalecerán cuando su endpoint esté `COMPLETE` o `COMPLETE_EMPTY`. La evidencia CSV y GitHub MUST permanecer en namespaces separados y no se concatenará ni deduplicará implícitamente.

La proyección SHALL incluir `enrichment.run_id`, `enrichment.snapshot_checksum`, `enrichment.completeness`, `enrichment.evidence` y un mapa `provenance` por JSON Pointer con `source`, `run_id`, `endpoint` y `status`. Un valor nulo, `UNAVAILABLE`, `TRUNCATED`, `PARTIAL` o `FAILED` nunca sobrescribe un valor CSV disponible.

#### Scenario: Campo GitHub disponible
- **WHEN** el run promovido contiene un título GitHub no nulo procedente de metadata completa
- **THEN** el título resuelto usa GitHub y `provenance./title` identifica el run y endpoint exactos

#### Scenario: Evidencia GitHub ausente o incompleta
- **WHEN** un campo GitHub es nulo o su endpoint no está completo
- **THEN** el valor CSV permanece visible y la proyección informa el estado GitHub sin inventar ni borrar evidencia

#### Scenario: Tarjeta omitida por identidad inexistente
- **WHEN** el repositorio o Pull Request de una tarjeta responde `404` durante la captura
- **THEN** la proyección conserva el baseline CSV, informa GitHub como `UNAVAILABLE` y no muestra payload GitHub

#### Scenario: Preservación del baseline
- **WHEN** se construye cualquier proyección enriquecida
- **THEN** `raw_payload`, `source_checksum`, `content_checksum`, `source_card_id`, repositorio, número y ordinal coinciden byte o canónicamente con el baseline previo
