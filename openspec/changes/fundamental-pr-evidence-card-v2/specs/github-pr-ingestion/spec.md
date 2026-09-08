## MODIFIED Requirements

### Requirement: Contrato de proveedor de tarjetas
El sistema SHALL construir una proyección de tarjeta desde el baseline CSV persistido. GitHub MAY aportar una sección aditiva `enrichment` desde el run promovido, pero MUST conservar `source_type = CSV`, `source_card_id`, repositorio, número, payload CSV, checksums y ordinal sin modificación. La sección aditiva SHALL incluir los campos de evidencia fundamental y sus estados de disponibilidad y procedencia.

#### Scenario: Importación CSV enriquecible
- **WHEN** una tarjeta se crea desde el CSV
- **THEN** conserva su contrato CSV y queda asociable a un snapshot GitHub posterior sin cambiar su identidad

#### Scenario: Proyección v2
- **WHEN** el estudio tiene un run promovido con cobertura compatible
- **THEN** el proveedor entrega baseline CSV, `CardV2` y procedencia por campo sin sustituir la identidad CSV

#### Scenario: Proveedor CSV activo
- **WHEN** una tarjeta se crea desde el CSV
- **THEN** conserva su contrato CSV, payload original y fuente `CSV` aunque posteriormente sea enriquecida

#### Scenario: Proveedor GitHub futuro
- **WHEN** una futura fuente GitHub produce una proyección con el mismo contrato
- **THEN** el explorador puede consumirla sin cambiar la estructura de la vista ni sustituir la identidad CSV

### Requirement: Fuente GitHub inactiva durante el MVP
El sistema MUST clasificar únicamente con datos persistidos y MUST NOT consultar GitHub desde el navegador, rutas web, plantillas o Socket.io. La preparación MAY ejecutar enriquecimiento offline cuando esté habilitado explícitamente; la importación y clasificación CSV-only MUST funcionar sin configuración ni credenciales GitHub.

#### Scenario: Clasificación sin red externa
- **WHEN** un participante abre o decide una tarjeta CSV-only o enriquecida
- **THEN** la aplicación usa exclusivamente el baseline y el snapshot promovido ya persistidos

### Requirement: Lenguaje informado por la fuente
El sistema SHALL conservar y mostrar el campo `language` del CSV, identificándolo como lenguaje informado por la fuente y sin calcular todavía una distribución por archivos. Un valor faltante SHALL permanecer no disponible aunque GitHub entregue lenguajes del repositorio.

#### Scenario: Lenguaje ausente
- **WHEN** una fila no contiene lenguaje
- **THEN** la tarjeta muestra dato no disponible y no inventa un valor desde GitHub

#### Scenario: Lenguaje disponible
- **WHEN** una fila contiene `language = Go`
- **THEN** la tarjeta muestra `Go` como lenguaje del dataset

### Requirement: Proyección aditiva y procedencia determinista
El sistema MUST construir la tarjeta leída sin modificar `pr_cards` ni `study_card`. Para campos superpuestos, título, cuerpo, autor, estado, merged, URL y fechas usarán el valor GitHub no nulo del run promovido y, en su ausencia, el valor CSV. Las métricas GitHub solo prevalecerán cuando su endpoint esté `COMPLETE` o `COMPLETE_EMPTY`. La evidencia CSV y GitHub MUST permanecer en namespaces separados y no se concatenará ni deduplicará implícitamente.

#### Scenario: Evidencia incompleta
- **WHEN** un campo GitHub es nulo o su endpoint no está completo
- **THEN** el valor CSV permanece visible y la proyección informa el estado GitHub sin inventar ni borrar evidencia

#### Scenario: Tarjeta omitida por identidad inexistente
- **WHEN** el repositorio o Pull Request responde `404` durante la captura
- **THEN** la proyección conserva el baseline CSV, informa GitHub como `UNAVAILABLE` y no muestra payload GitHub
