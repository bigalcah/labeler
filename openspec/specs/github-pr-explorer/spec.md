# github-pr-explorer Specification

## Purpose

Presentar cada Pull Request del CSV como una tarjeta legible para que el participante pueda inspeccionar la información disponible antes de clasificarlo.

## Requirements

### Requirement: Tarjeta de Pull Request
El sistema SHALL mostrar repositorio, número, título, estado, autor, lenguaje informado por el CSV, fechas, URL y métricas disponibles.

#### Scenario: Tarjeta completa
- **WHEN** el participante abre un PR con título, URL, lenguaje y métricas
- **THEN** puede identificar el PR y revisar esos datos sin leer el JSON crudo

#### Scenario: Campos ausentes
- **WHEN** un campo no existe en el CSV
- **THEN** la tarjeta muestra un estado explícito de dato no disponible

### Requirement: Evidencia del CSV
El sistema SHALL mostrar el cuerpo, resumen, evidencia textual, comentarios y datos JSON disponibles en la fila, con secciones expandibles para no saturar la vista inicial.

#### Scenario: Evidencia multilinea
- **WHEN** el cuerpo o la evidencia contiene saltos de línea, Markdown o JSON incrustado
- **THEN** la tarjeta conserva su estructura y permite inspeccionarla sin truncar silenciosamente el contenido

### Requirement: Referencia externa opcional
El sistema SHALL mostrar un enlace opcional a `html_url`, pero la clasificación MUST poder completarse sin abrir GitHub.

#### Scenario: Sin conexión externa
- **WHEN** GitHub no está disponible
- **THEN** el participante puede leer la tarjeta local y clasificarla igualmente

### Requirement: Renderizado seguro
El sistema MUST escapar texto de la fuente y no ejecutar HTML, scripts o handlers contenidos en el CSV.

#### Scenario: Contenido no confiable
- **WHEN** el cuerpo o comentario contiene etiquetas HTML o JavaScript
- **THEN** se muestra como contenido seguro sin ejecutar código

### Requirement: Acceso desde el clasificador
El sistema SHALL permitir volver al formulario de clasificación desde la tarjeta sin perder el PR actual ni el progreso.

#### Scenario: Inspección antes de clasificar
- **WHEN** el participante expande la evidencia y regresa al formulario
- **THEN** conserva la tarjeta actual y puede seleccionar una categoría
