## MODIFIED Requirements

### Requirement: Tarjeta de Pull Request
El sistema SHALL mostrar repositorio, número, título, estado, autor, lenguaje informado por la fuente, fechas, URL y métricas disponibles, incluyendo los valores GitHub capturados cuando existan.

#### Scenario: Tarjeta completa
- **WHEN** el participante abre un PR con metadata CSV y captura GitHub disponible
- **THEN** puede identificar el PR y revisar los datos persistidos sin leer JSON crudo ni abrir GitHub

#### Scenario: Tarjeta CSV-only
- **WHEN** el estudio no tiene run promovido
- **THEN** la tarjeta muestra el baseline CSV y permite decidir sin red externa

#### Scenario: Tarjeta enriquecida
- **WHEN** existe un run promovido con snapshot para la tarjeta
- **THEN** la vista muestra los valores resueltos, etiqueta su procedencia y permite inspeccionar evidencia GitHub persistida

#### Scenario: Campos ausentes
- **WHEN** un campo no existe en CSV ni como valor completo GitHub
- **THEN** la tarjeta muestra `Not available` sin sustituirlo por cero, cadena vacía o dato inventado

### Requirement: Evidencia del CSV
El sistema SHALL conservar y mostrar la evidencia CSV existente y MAY mostrar commits, files, diff, reviews, issue comments, review comments y timeline bajo una sección GitHub separada. Cada sección GitHub SHALL distinguir `COMPLETE_EMPTY`, `UNAVAILABLE` y `TRUNCATED`; no mezclará arrays CSV y GitHub ni mostrará runs no promovidos.

#### Scenario: Evidencia enriquecida completa
- **WHEN** un endpoint del run promovido está completo
- **THEN** la sección muestra su contenido normalizado y procedencia exacta

#### Scenario: Evidencia multilinea
- **WHEN** el cuerpo o la evidencia contiene saltos de línea, Markdown o JSON incrustado
- **THEN** la tarjeta conserva su estructura y permite inspeccionarla sin truncar silenciosamente el contenido

#### Scenario: Evidencia truncada o no disponible
- **WHEN** un endpoint está `TRUNCATED` o `UNAVAILABLE`
- **THEN** la vista conserva la evidencia CSV y muestra el estado explícito sin afirmar completitud

### Requirement: Renderizado seguro
El sistema MUST escapar o sanitizar todo texto, Markdown, URL y JSON derivado tanto del CSV como de GitHub y MUST NOT ejecutar HTML, scripts, URLs activas no permitidas ni handlers contenidos en ninguna fuente.

#### Scenario: Contenido no confiable
- **WHEN** el cuerpo o comentario contiene etiquetas HTML o JavaScript
- **THEN** se muestra como contenido seguro sin ejecutar código

#### Scenario: Contenido GitHub no confiable
- **WHEN** cuerpo, comentario, review, nombre de archivo o timeline contiene HTML o JavaScript
- **THEN** se renderiza de forma segura con la misma política aplicada al CSV

### Requirement: Acceso desde el clasificador
El sistema SHALL permitir volver al formulario de clasificación desde la tarjeta sin perder el PR actual ni el progreso.

#### Scenario: Inspección antes de clasificar
- **WHEN** el participante expande la evidencia y regresa al formulario
- **THEN** conserva la tarjeta actual y puede seleccionar una categoría
