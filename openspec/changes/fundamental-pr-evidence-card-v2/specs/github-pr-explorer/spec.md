## MODIFIED Requirements

### Requirement: Tarjeta de Pull Request
El sistema SHALL mostrar repositorio, número, título, estado/merged, autor, lenguaje informado por el CSV, fechas, URL y métricas disponibles. La versión v2 SHALL separar las etiquetas de muestra CSV y evidencia del snapshot GitHub.

#### Scenario: Tarjeta fundamental
- **WHEN** el participante abre un PR con snapshot compatible
- **THEN** identifica intención, autor, estado, fechas, commits, archivos, adiciones, eliminaciones, revisiones, solicitudes de cambio, comentarios de PR e inline comments

#### Scenario: Campos ausentes
- **WHEN** un campo o sección no está disponible, vacío o truncado
- **THEN** la tarjeta muestra el estado explícito y no lo presenta como cero o contenido completo

#### Scenario: Tarjeta completa
- **WHEN** el participante abre un PR con título, URL, lenguaje y métricas
- **THEN** puede identificar el PR y revisar esos datos sin leer el JSON crudo

### Requirement: Evidencia del CSV
El sistema SHALL mostrar cuerpo, resumen y evidencia textual CSV en secciones expandibles, pero MUST NOT exponer el payload CSV crudo completo a participantes de la tarjeta v2.

#### Scenario: Separación de fuentes
- **WHEN** existe evidencia CSV y evidencia GitHub para un mismo concepto
- **THEN** ambas se muestran en secciones o etiquetas distinguibles sin concatenación implícita

#### Scenario: Evidencia multilinea
- **WHEN** el cuerpo o la evidencia contiene saltos de línea, Markdown o JSON incrustado
- **THEN** la tarjeta conserva su estructura y permite inspeccionarla sin truncar silenciosamente el contenido

### Requirement: Evidencia GitHub local
El sistema SHALL mostrar localmente, sin llamadas externas, descripción y hechos principales; archivos modificados inicialmente colapsados y paginados; revisiones cronológicas con explicación escrita y `CHANGES_REQUESTED` distinguido; y comentarios de PR separados de comentarios inline. Timeline y Commits MUST NOT presentarse como secciones de evidencia participante. El diff completo y detalles profundos se ofrecerán mediante enlace explícito a GitHub.

#### Scenario: Inspección de retrabajo
- **WHEN** el PR contiene revisiones `CHANGES_REQUESTED` o comentarios inline
- **THEN** el participante puede inspeccionarlos desde la tarjeta antes de clasificar

#### Scenario: Revisión sin explicación escrita
- **WHEN** una revisión no tiene cuerpo de texto
- **THEN** la tarjeta no muestra una entrada ni un placeholder de explicación ausente
- **AND** la métrica de eventos de revisión conserva el evento capturado

#### Scenario: Actividad técnica de bajo valor
- **WHEN** el snapshot contiene eventos Timeline o Commits
- **THEN** la tarjeta no los presenta como secciones de evidencia participante

#### Scenario: Sin conexión externa
- **WHEN** GitHub no está disponible
- **THEN** la evidencia persistida permanece legible y la clasificación puede completarse

### Requirement: Alineación consistente de metadatos de evidencia
El sistema SHALL presentar los encabezados expandibles de evidencia CSV y GitHub con columnas visuales estables para el título, la etiqueta de fuente o disponibilidad y el control de expansión. La posición de la etiqueta MUST NOT depender de la longitud del título ni del texto `Available`, `Truncated`, `Empty` o `Unavailable`.

#### Scenario: Comparación vertical en escritorio
- **WHEN** se muestran consecutivamente secciones con títulos y estados de distinta longitud
- **THEN** los bordes finales de sus etiquetas comparten la misma coordenada horizontal
- **AND** los controles de expansión ocupan una columna separada y uniforme

#### Scenario: Encabezado responsive
- **WHEN** la tarjeta se renderiza a 375, 768 o 1280 píxeles de ancho
- **THEN** el título puede envolver sin solaparse con la etiqueta ni con el control de expansión
- **AND** la etiqueta permanece alineada al final de su columna

### Requirement: Renderizado seguro
El sistema MUST escapar texto de CSV y GitHub, permitir únicamente URLs externas seguras y no ejecutar HTML, scripts, handlers, tokens ni objetos crudos contenidos en los snapshots.

#### Scenario: Contenido no confiable
- **WHEN** el cuerpo o comentario contiene HTML o JavaScript
- **THEN** se muestra como texto seguro sin ejecutar código

#### Scenario: Privacidad de tarjeta
- **WHEN** se renderiza el HTML participante
- **THEN** no contiene payload crudo, email, secreto, categoría privada, observación ni progreso de otro participante
