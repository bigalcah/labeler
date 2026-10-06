## MODIFIED Requirements

### Requirement: Evidencia GitHub local

El sistema SHALL mostrar localmente, sin llamadas externas, la evidencia priorizada para comprender el retrabajo: revisiones con explicación escrita y `CHANGES_REQUESTED` distinguido, comentarios de PR y comentarios inline separados. Cada sección SHALL mostrar una vista previa acotada, el conteo capturado y divulgación progresiva por lotes; MUST NOT desplegar todos los registros capturados de una sola vez. Cuando una sección haya capturado registros pero ningún elemento sobreviva al filtro de presentación, SHALL mostrar un estado explícito dentro de la sección que indique que no hay contenido desplegable y cuántos eventos se capturaron, sin fabricar entradas ni placeholders por registro. Los archivos modificados MUST NOT presentarse como sección de evidencia del participante; el listado completo de archivos, el diff y los detalles profundos SHALL ofrecerse mediante enlace explícito a GitHub. Timeline y Commits MUST NOT presentarse como secciones de evidencia participante. El snapshot completo SHALL permanecer almacenado.

#### Scenario: Inspección de retrabajo
- **WHEN** el PR contiene revisiones `CHANGES_REQUESTED` o comentarios inline
- **THEN** el participante puede inspeccionarlos desde la tarjeta antes de clasificar

#### Scenario: Vista previa acotada
- **WHEN** una sección captura más registros que el tamaño de vista previa
- **THEN** la tarjeta muestra el primer lote con el conteo capturado y cada expansión revela el lote siguiente, sin volcar todos los registros a la vez

#### Scenario: Sección capturada sin contenido desplegable
- **WHEN** una sección capturó registros pero ninguno sobrevive al filtro de presentación, por ejemplo revisiones sin explicación escrita
- **THEN** al desplegar la sección aparece un estado explícito con el conteo capturado y la indicación de que no hay explicaciones escritas, sin entradas inventadas, y el enlace a GitHub permanece

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
