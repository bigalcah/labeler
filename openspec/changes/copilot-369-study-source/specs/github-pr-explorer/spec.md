# Explorador de PR de Copilot 369

## MODIFIED Requirements

### Requirement: Tarjeta de Pull Request

El sistema SHALL conservar la tarjeta y las secciones actuales de identidad, metadatos, evidencia CSV
y snapshot local. Presentará los metadatos disponibles de título, repositorio, número, estado, autor,
fechas, URL y lenguaje informado para el repositorio; no inferirá lenguaje del diff. Los campos
opcionales ausentes de tarjetas primarias nuevas se omiten, no se sustituyen por placeholders ni
valores fabricados. La presentación existente del estudio de validación de 30 SHALL permanecer sin
cambios. No se SHALL añadir métricas ni paneles de commits, timeline o JSON completo.

#### Scenario: Tarjeta completa

- **WHEN** el participante abre una tarjeta primaria con metadatos disponibles
- **THEN** ve esos datos en las secciones actuales y los campos ausentes se omiten sin valor inventado

#### Scenario: Campos ausentes

- **WHEN** un campo no existe en el CSV
- **THEN** la tarjeta omite el campo ausente sin mostrar un placeholder ni un valor fabricado

#### Scenario: Presentación de tarjeta histórica

- **WHEN** el participante abre una tarjeta del estudio de validación de 30
- **THEN** su representación existente permanece sin cambios

#### Scenario: Lenguaje no informado

- **WHEN** la fuente no informa el lenguaje del repositorio
- **THEN** no se infiere a partir del diff

### Requirement: Evidencia del CSV

El sistema SHALL presentar el cuerpo y la evidencia seleccionada del CSV únicamente cuando existan.
Las secciones actuales de reviews, comentarios del PR y comentarios inline SHALL poder mostrar
conversaciones locales incluidas en el CSV, sin requerir un run GitHub promovido ni realizar una nueva
solicitud de red. Las cadenas de usuario y sus tiempos SHALL mostrarse normalizados de forma legible y
atribuible a su fuente. Una colección `[]` válida SHALL conservarse como colección vacía y
distinguirse de un dato ausente; datos ausentes en tarjetas primarias se omiten y JSON malformado hace
fallar la importación. No se SHALL fabricar disponibilidad, sustituir `evidence_text` por una razón
ni añadir paneles de commits, timeline o JSON completo. La representación de tarjetas del estudio de
30 SHALL permanecer sin cambios.

#### Scenario: Evidencia multilinea

- **WHEN** el CSV contiene cuerpo, evidencia, reviews o comentarios con saltos de línea, Markdown o JSON incrustado
- **THEN** se conserva la estructura y se muestra texto y tiempo legibles en las secciones actuales, sin
  truncar silenciosamente, requerir snapshot GitHub promovido ni acceso de red

#### Scenario: Conversación ausente o vacía

- **WHEN** una conversación opcional no está presente o contiene una colección `[]` válida
- **THEN** la interfaz omite lo ausente y conserva el estado vacío válido sin inventar registros ni disponibilidad

#### Scenario: JSON de conversación malformado

- **WHEN** el CSV contiene JSON de conversación malformado
- **THEN** la importación falla y la tarjeta no muestra una conversación o disponibilidad fabricada

#### Scenario: Evidencia seleccionada fiel a la fuente

- **WHEN** la fila contiene `evidence_text` o una razón sin evidencia seleccionada
- **THEN** se muestra solo `evidence_text` existente y nunca se sustituye por la razón

#### Scenario: Tarjeta del estudio de validación

- **WHEN** se presenta evidencia de una tarjeta del estudio de 30
- **THEN** su contenido, disponibilidad y representación existentes permanecen sin cambios

#### Scenario: Promoción de una fuente histórica

- **WHEN** la primaria activa de 369 conserva una promoción GitHub cuyo checksum corresponde al CSV anterior de 300
- **THEN** la tarjeta usa la evidencia de su fuente activa y no atribuye a esa muestra el run o snapshot histórico;
  la promoción se conserva y el estudio de 30 sigue mostrando su evidencia existente

### Requirement: Referencia externa opcional

El sistema SHALL mostrar el enlace externo de la tarjeta cuando exista una URL válida, pero la
clasificación MUST poder completarse desde los datos locales sin abrir GitHub.

#### Scenario: Sin conexión externa

- **WHEN** GitHub no está disponible o la tarjeta no tiene enlace externo
- **THEN** el participante puede leer la tarjeta local y clasificarla igualmente

### Requirement: Renderizado seguro

El sistema MUST presentar el contenido de origen mediante el comportamiento seguro de texto o
Markdown existente, sin ejecutar HTML, scripts ni handlers suministrados por la fuente.

#### Scenario: Contenido no confiable

- **WHEN** el cuerpo, evidencia o comentario contiene etiquetas HTML o JavaScript
- **THEN** se presenta de forma segura sin ejecutar código ni handlers

### Requirement: Acceso desde el clasificador

El sistema SHALL mantener el acceso y la navegación actuales entre la tarjeta, la clasificación y las
tarjetas anterior/siguiente, sin perder la tarjeta actual ni el progreso.

#### Scenario: Inspección antes de clasificar

- **WHEN** el participante expande la evidencia y regresa al formulario de clasificación
- **THEN** conserva la tarjeta actual y su progreso, y puede seleccionar una categoría
