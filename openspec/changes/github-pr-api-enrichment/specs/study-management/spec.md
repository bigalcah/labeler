## MODIFIED Requirements

### Requirement: Preparación para fuente GitHub
El sistema SHALL conservar el CSV y `study_card` como autoridad exclusiva de pertenencia, `source_card_id`, repositorio, número de PR, contenido CSV, checksums y ordinal. GitHub MAY añadir una captura inmutable a esas mismas tarjetas, pero MUST NOT sustituir el proveedor CSV, cambiar la muestra ni modificar el baseline persistido.

#### Scenario: Autoridad CSV preservada
- **WHEN** se completa un enriquecimiento GitHub para un estudio existente
- **THEN** sus 300 `study_card`, ordinales, `source_card_id`, contenido CSV y checksums permanecen exactamente iguales

#### Scenario: Promoción de un run completo
- **WHEN** un `enrichment_run` pertenece al mismo estudio y checksum CSV, contiene un resultado terminal válido para las 300 tarjetas y todavía no existe ninguna decisión participante
- **THEN** el sistema inserta una única promoción inmutable que fija ese run como evidencia del estudio

#### Scenario: Promoción rechazada
- **WHEN** el run está incompleto, pertenece a otro checksum CSV, el estudio ya tiene una promoción o existe una clasificación o descarte
- **THEN** la promoción falla sin modificar la promoción vigente, la muestra ni las decisiones existentes

#### Scenario: Decisión asociada a evidencia exacta
- **WHEN** un participante clasifica o descarta una tarjeta de un estudio enriquecido
- **THEN** la decisión conserva `study_id` y el identificador del único `enrichment_run` promovido que produjo la evidencia visible

#### Scenario: Estudio CSV-only
- **WHEN** un estudio no tiene promoción GitHub
- **THEN** la clasificación continúa con el baseline CSV y sus decisiones registran explícitamente que no existe `enrichment_run`

#### Scenario: Origen CSV
- **WHEN** el estudio se crea desde el CSV
- **THEN** cada tarjeta registra `CSV` como fuente y queda disponible para la proyección enriquecida futura
