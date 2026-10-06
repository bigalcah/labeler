## MODIFIED Requirements

### Requirement: Tarjeta de Pull Request

El sistema SHALL mostrar repositorio, número, título, estado/merged, autor, lenguaje informado por el CSV, fechas y URL. La tarjeta SHALL separar las etiquetas de muestra CSV y evidencia del snapshot GitHub. Las métricas de la proyección SHALL conservarse almacenadas, con su procedencia y disponibilidad, en la proyección CardV2 y el snapshot, disponibles para el análisis y la auditoría del operador; este cambio no añade métricas al paquete offline ni elimina o reordena sus columnas existentes (el paquete solo añade `category_definition` al final de `categories.csv`). Las métricas MUST NOT mostrarse como bloque de métricas de la tarjeta del participante ni como sustituto de la evidencia priorizada.

#### Scenario: Tarjeta fundamental
- **WHEN** el participante abre un PR con snapshot compatible
- **THEN** identifica repositorio, número, título, estado, autor, fechas, lenguaje y enlace, sin bloque de métricas ni listado de archivos

#### Scenario: Métricas almacenadas sin mostrarse
- **WHEN** la proyección CardV2 contiene métricas disponibles y la tarjeta del participante se renderiza
- **THEN** el HTML participante no contiene el bloque de métricas, la proyección CardV2 y el snapshot conservan esos valores con su procedencia y disponibilidad, y el paquete offline no incorpora métricas ni elimina o reordena sus columnas existentes (solo añade `category_definition` al final de `categories.csv`)

#### Scenario: Tarjeta completa
- **WHEN** el participante abre un PR con título, URL y lenguaje
- **THEN** puede identificar el PR y revisar los datos de la tarjeta sin leer el JSON crudo ni el bloque de métricas

#### Scenario: Campos ausentes
- **WHEN** un campo o sección no está disponible, vacío o truncado
- **THEN** la tarjeta muestra el estado explícito y no lo presenta como cero o contenido completo

### Requirement: Evidencia del CSV

El sistema SHALL mostrar en la tarjeta del participante la descripción y la evidencia seleccionada del CSV en secciones expandibles. El volcado de evidencia textual completa (`all_text`/All CSV evidence) y el payload CSV crudo MUST NOT mostrarse al participante. La evidencia CSV completa SHALL permanecer almacenada, sin mutar el baseline, y disponible para el análisis y la auditoría del operador; este cambio no añade su serialización al paquete offline.

#### Scenario: Evidencia priorizada
- **WHEN** la fila CSV contiene descripción, evidencia seleccionada y evidencia textual completa
- **THEN** la tarjeta muestra descripción y evidencia seleccionada como secciones expandibles y no presenta el volcado completo

#### Scenario: Evidencia multilinea
- **WHEN** el cuerpo o la evidencia contiene saltos de línea, Markdown o JSON incrustado
- **THEN** la tarjeta conserva su estructura y permite inspeccionarla sin truncar silenciosamente el contenido

#### Scenario: Separación de fuentes
- **WHEN** existe evidencia CSV y evidencia GitHub para un mismo concepto
- **THEN** ambas se muestran en secciones o etiquetas distinguibles sin concatenación implícita

### Requirement: Evidencia GitHub local

El sistema SHALL mostrar localmente, sin llamadas externas, la evidencia priorizada para comprender el retrabajo: revisiones con explicación escrita y `CHANGES_REQUESTED` distinguido, comentarios de PR y comentarios inline separados. Cada sección SHALL mostrar una vista previa acotada, el conteo capturado y divulgación progresiva por lotes; MUST NOT desplegar todos los registros capturados de una sola vez. Los archivos modificados MUST NOT presentarse como sección de evidencia del participante; el listado completo de archivos, el diff y los detalles profundos SHALL ofrecerse mediante enlace explícito a GitHub. Timeline y Commits MUST NOT presentarse como secciones de evidencia participante. El snapshot completo SHALL permanecer almacenado.

#### Scenario: Inspección de retrabajo
- **WHEN** el PR contiene revisiones `CHANGES_REQUESTED` o comentarios inline
- **THEN** el participante puede inspeccionarlos desde la tarjeta antes de clasificar

#### Scenario: Vista previa acotada
- **WHEN** una sección captura más registros que el tamaño de vista previa
- **THEN** la tarjeta muestra el primer lote con el conteo capturado y cada expansión revela el lote siguiente, sin volcar todos los registros a la vez

#### Scenario: Archivos fuera de la vista principal
- **WHEN** el snapshot contiene archivos modificados
- **THEN** la tarjeta no presenta una sección de archivos para el participante, conserva el enlace a GitHub y el snapshot permanece almacenado

#### Scenario: Revisión sin explicación escrita
- **WHEN** una revisión no tiene cuerpo de texto
- **THEN** la tarjeta no muestra una entrada ni un placeholder de explicación ausente
- **AND** el evento de revisión conserva su registro almacenado

#### Scenario: Actividad técnica de bajo valor
- **WHEN** el snapshot contiene eventos Timeline o Commits
- **THEN** la tarjeta no los presenta como secciones de evidencia participante

#### Scenario: Sin conexión externa
- **WHEN** GitHub no está disponible
- **THEN** la evidencia priorizada persistida permanece legible y la clasificación puede completarse
