# Ingesta y conservación de fuentes de PR

## MODIFIED Requirements

### Requirement: Importación robusta del CSV

El sistema SHALL aceptar como fuente primaria el CSV completo de 85 columnas, con exactamente
369 PR únicos de Copilot y SHA-256
`fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb`. Cada tarjeta nueva SHALL
conservar `source_pr_id` como identidad del PR y `source_card_id` como identidad de tarjeta; ambos
SHALL usar la misma cadena decimal exacta de `pr_id` para esta fuente nueva, sin alterar las identidades
históricas del estudio de 30. SHALL conservar la fila fuente, checksum y cronología JSON descriptiva, no causal. La validación
de todas las filas SHALL completarse antes de cualquier escritura. ID o URL requeridos ausentes y
JSON malformado SHALL hacer fallar toda la importación. Los campos opcionales ausentes se omiten y
se informan al operador. Los 37 PR de reserva, si existen en otra fuente, no pertenecen a este CSV
canónico y no SHALL cargarse ni usarse para reemplazar tarjetas.

#### Scenario: Importación de la muestra

- **WHEN** el operador presenta el CSV completo con checksum y 369 identidades únicas válidas
- **THEN** el sistema valida primero todo el archivo e importa 369 tarjetas en orden fuente,
  conservando cada `source_pr_id` decimal exacto como string y su procedencia

#### Scenario: Entrada inválida

- **WHEN** cualquier fila tiene ID o URL requeridos ausentes, JSON malformado, checksum incorrecto o identidad duplicada
- **THEN** la importación falla antes de escribir datos

#### Scenario: Fila inválida

- **WHEN** una fila tiene JSON inválido o carece de identificador o URL requeridos
- **THEN** se registra el error de esa fila y no se crea una tarjeta parcial; la importación completa falla antes de escribir

#### Scenario: Campo opcional ausente

- **WHEN** una fila válida carece de un campo opcional
- **THEN** el campo se omite y se informa al operador el PR afectado y el motivo, sin usar un valor sustituto

### Requirement: Importación idempotente

El sistema MUST reutilizar únicamente una tarjeta primaria cuya `source_pr_id`, fila fuente y checksum
coincidan con la fuente canónica validada; una coincidencia SHALL ser de solo lectura y MUST NOT
actualizarla. Cualquier divergencia, fuente distinta o imposibilidad de confirmar identidad SHALL
fallar sin upsert, backfill ni mutación de tarjetas compartidas protegidas o del estudio de validación
de 30.

#### Scenario: Reimportación

- **WHEN** se prepara de nuevo el mismo CSV canónico, con los mismos registros, orden y checksum
- **THEN** se reconocen las tarjetas existentes sin duplicarlas ni alterar ningún dato persistido

#### Scenario: Fuente o tarjeta divergente

- **WHEN** una tarjeta existente no coincide exactamente con `source_pr_id`, fila fuente o checksum esperados
- **THEN** la preparación falla cerrada y no actualiza, reemplaza ni completa la tarjeta

#### Scenario: Protección de tarjetas compartidas

- **WHEN** una tarjeta persistida también está referenciada por el estudio de validación de 30
- **THEN** la preparación primaria no la cambia, completa ni reprovisiona

### Requirement: Contrato de proveedor de tarjetas

El sistema SHALL conservar la identidad y procedencia de la fuente en cada tarjeta. `source_pr_id` se
preserva como string decimal exacto; para esta fuente `source_card_id` usa el mismo valor sin confundir
la función de ambos atributos. El campo de lenguaje
representa el valor de lenguaje del repositorio informado por la fuente y MUST NOT inferirse del diff.

#### Scenario: Proveedor CSV activo

- **WHEN** una fila válida se representa en una tarjeta primaria nueva
- **THEN** su `source_type` indica `CSV` y se conservan el mismo valor decimal exacto de `pr_id` para
  `source_pr_id` y `source_card_id`, el URL, el payload y el checksum de la fuente

#### Scenario: Proveedor GitHub futuro

- **WHEN** una futura fuente GitHub produce una tarjeta con el mismo contrato
- **THEN** el explorador puede consumirla sin cambiar la estructura de la vista; esto no activa
  solicitudes de red ni una función de captura GitHub

#### Scenario: Lenguaje informado ausente

- **WHEN** la fuente no proporciona lenguaje para un PR primario
- **THEN** el lenguaje se omite y se informa como dato opcional ausente, sin inferirlo del diff ni
  alterar tarjetas del estudio de 30

### Requirement: Lenguaje informado por la fuente

El sistema SHALL conservar el lenguaje informado por la fuente como procedencia del repositorio, sin
inferirlo de archivos o diffs. Para una tarjeta primaria nueva, el lenguaje ausente SHALL omitirse y
constar en el informe del operador, no representarse como un placeholder de contenido. La
presentación existente de tarjetas del estudio de 30 MUST permanecer sin cambios.

#### Scenario: Lenguaje disponible

- **WHEN** la fuente de un PR primario informa un lenguaje de repositorio
- **THEN** la tarjeta conserva ese valor y su procedencia de fuente

#### Scenario: Lenguaje ausente

- **WHEN** la fuente de un PR primario no informa lenguaje
- **THEN** se omite el campo, se reporta la ausencia y no se infiere un valor del diff

#### Scenario: Lenguaje de tarjeta histórica

- **WHEN** se importa o consulta el lenguaje de una tarjeta del estudio de validación de 30
- **THEN** se conserva sin cambios su dato y representación existentes

### Requirement: Fuente GitHub inactiva durante el MVP

El CSV selecciona las 369 tarjetas y la importación SHALL funcionar sin credenciales GitHub. La
clasificación y navegación en navegador MUST NOT realizar solicitudes a GitHub. Los datos GitHub ya
persistidos podrán conservarse como snapshot, pero esta especificación no requiere captura,
enriquecimiento, refresco ni dependencia de una ejecución GitHub. Ningún registro de reserva SHALL
cambiar la muestra.

#### Scenario: Clasificación sin red externa

- **WHEN** una persona navega o clasifica una tarjeta sin credenciales GitHub ni conexión GitHub
- **THEN** el flujo utiliza los datos locales y completa la acción sin solicitudes a GitHub

#### Scenario: Muestra cerrada del CSV

- **WHEN** se prepara la fuente canónica
- **THEN** sus únicos miembros son los 369 PR ordenados del CSV, sin cargar ni reemplazar con PR de reserva

## ADDED Requirements

### Requirement: Conservación del enriquecimiento histórico durante el cutover

El sistema MUST conservar los registros GitHub históricos de la primaria, sus vínculos de estudio,
tarjeta, run y snapshot, y la membresía histórica que explica su procedencia. La sustitución de la
muestra activa MUST NOT borrar, mover, reasignar ni reescribir esos registros o sus timestamps.
Las referencias nuevas SHALL mantener integridad referencial validada; el historial no se conserva
solo en un dump externo ni mediante constraints desactivadas. La fuente de validación y sus filas
persistidas SHALL conservarse idénticas; los metadatos de referencia añadidos por una migración global
no autorizan mutaciones de esas filas.

#### Scenario: Historial cerrado conservado

- **WHEN** una primaria de 300 con runs cerrados válidos pasa por la transición autorizada
- **THEN** conserva runs, páginas, mappings, promociones, snapshots, telemetría y su membresía de procedencia,
  mientras solo las 369 tarjetas canónicas pertenecen a la muestra activa

#### Scenario: Página parcial de run fallido

- **WHEN** un run FAILED conserva páginas parciales íntegras y no tiene un mapping final
- **THEN** se conserva sin inventar su finalización o snapshot y se valida contra su muestra histórica

#### Scenario: Dependencia no demostrable

- **WHEN** una referencia histórica no pertenece a la muestra/checksum declarado o un run sigue RUNNING
- **THEN** se rechaza el mantenimiento sin mutaciones ni eliminación del registro que provocó el rechazo

### Requirement: Informe de disponibilidad de fuente

La preparación SHALL producir un informe de disponibilidad para los campos opcionales ausentes con
el nombre del campo, `source_pr_id` afectado cuando esté disponible, motivo, conteo y procedencia del
informe. Una colección vacía válida MUST distinguirse de datos ausentes; JSON malformado es un error
de importación, no una ausencia ni una lista vacía.

#### Scenario: Ausencias opcionales reportadas

- **WHEN** faltan campos opcionales en una o más filas válidas
- **THEN** el informe enumera campos, PR afectados, motivos, conteos y procedencia, y las tarjetas omiten esos campos

#### Scenario: Colección vacía válida

- **WHEN** un campo de conversación contiene una colección JSON vacía válida
- **THEN** se conserva como colección vacía y se distingue de campo ausente en el informe y la presentación

#### Scenario: JSON malformado

- **WHEN** un campo que debe contener JSON tiene sintaxis inválida
- **THEN** falla toda la importación antes de cualquier escritura y no se informa como ausencia opcional
