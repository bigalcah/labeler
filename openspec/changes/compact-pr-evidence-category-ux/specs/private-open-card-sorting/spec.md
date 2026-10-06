## MODIFIED Requirements

### Requirement: Categorías privadas por participante

El sistema SHALL permitir crear, renombrar y reutilizar categorías planas asociadas al participante y al `study_id` derivados de la sesión, sin compartirlas con otros participantes ni con otro estudio. Cada categoría SHALL aceptar una definición textual opcional, privada y editable después de crearla; el texto se recorta y un valor no textual produce `422`; una definición vacía se normaliza a ausencia. La definición SHALL ser visible al identificar la categoría en la selección y en la gestión, sin exigir abrir un editor. Cada categoría SHALL recibir al crearse un color estable de una paleta categórica fija, conservado al renombrarla o reordenarla y reutilizado en cada superficie que identifique la categoría del participante, incluida la selección de la tarjeta y el resumen privado de progreso. La selección MUST distinguirse con al menos una señal visible adicional al color, como texto o marca, y el color MUST NOT ser el único medio para identificar o seleccionar una categoría. Solo una clasificación en estado `CLASSIFIED` puede tener exactamente una categoría privada. Las categorías y clasificaciones existentes SHALL conservar su validez sin definiciones inventadas.

#### Scenario: Categorías similares
- **WHEN** dos participantes crean `Missing tests` y `Falta de pruebas`, o la misma persona las crea en estudios distintos
- **THEN** el sistema conserva categorías independientes por participante y estudio, y cada una solo aparece en su contexto autorizado

#### Scenario: Definición opcional y privada
- **WHEN** el participante crea o edita una categoría con una definición, con una definición vacía o sin enviarla
- **THEN** el sistema guarda la definición recortada, normaliza la vacía a ausencia, no exige definición para crear y nunca la expone a otro participante o estudio

#### Scenario: Color estable entre superficies
- **WHEN** una categoría se reutiliza después de renombrarla, de reordenar la lista o de reabrir la sesión
- **THEN** conserva el mismo color en la selección, la gestión y el resumen de progreso

#### Scenario: Selección sin depender del color
- **WHEN** el participante selecciona una categoría
- **THEN** la fila seleccionada muestra una marca visible y texto además del color, y la selección sigue siendo reconocible sin depender del tono

#### Scenario: Paleta agotada
- **WHEN** el participante tiene más categorías que colores disponibles en la paleta
- **THEN** los colores pueden repetirse, la creación no se bloquea y el nombre y la definición siguen siendo la identificación autoritativa

#### Scenario: Compatibilidad con categorías existentes
- **WHEN** existen categorías y clasificaciones creadas antes de este cambio
- **THEN** siguen siendo válidas y utilizables, sin definición asignada ni reasignación de las existentes

#### Scenario: Definición conservada al renombrar
- **WHEN** el participante edita solo el nombre de una categoría y no envía el campo de definición
- **THEN** el sistema conserva la definición existente y no la borra

#### Scenario: Limpieza explícita de definición
- **WHEN** el participante vacía el área de texto de definición en la edición y guarda
- **THEN** el sistema normaliza la definición a ausencia

#### Scenario: Definición inválida
- **WHEN** la definición no es texto (número, arreglo, objeto o `null` explícito)
- **THEN** el sistema responde `422` y no persiste el cambio

#### Scenario: Límite de longitud de la definición
- **WHEN** la definición recortada mide 500 caracteres
- **THEN** el sistema la acepta; con 501 caracteres responde `422`

#### Scenario: Definición hostil
- **WHEN** la definición contiene marcado o script
- **THEN** el servidor y el cliente la muestran como texto escapado, sin ejecutar código ni romper la vista

#### Scenario: Selección requerida y operable por teclado
- **WHEN** el participante recorre las filas de categorías
- **THEN** puede mover la selección con las flechas, confirmar con espacio y ve el foco; sin selección no puede guardar la clasificación

#### Scenario: Estado seleccionado tras crear o editar
- **WHEN** el participante crea o edita una categoría y la selecciona
- **THEN** la fila muestra el check visible y el texto `Selected` además del color

#### Scenario: El botón de edición no selecciona
- **WHEN** el participante activa el botón de edición de una fila no seleccionada
- **THEN** se abre el editor sin cambiar la categoría seleccionada

### Requirement: Exportación offline privada y completa

El sistema SHALL ofrecer al operador una orden offline de solo lectura para un `study_key` explícito, sin ruta HTTP, descarga desde el navegador ni selector participante. Solo SHALL exportar después de que todos los participantes configurados hayan llevado todas sus tarjetas a estado terminal. El paquete SHALL incluir `results.csv`, `categories.csv` y `manifest.json` con nombres de categorías y sus definiciones opcionales, clasificaciones, `classification_remarks`, motivos de descarte, orden de tarjetas, pseudónimos, timestamps y revisiones de decisión, `source_html_url`, `resolved_html_url`, procedencia, checksums, conteo esperado y evidencia de enriquecimiento. Los pseudónimos SHALL derivarse de un secreto HMAC externo con entradas acotadas al estudio. No SHALL exportar tokens, sesiones, hashes, secretos, datos de throttling ni payloads GitHub crudos.

#### Scenario: Exportación completa de 30
- **WHEN** los tres participantes terminan las 30 tarjetas del estudio de validación y el operador ejecuta la orden para su `study_key`
- **THEN** se generan los tres archivos con una fila por tarjeta y participante, todas las categorías incluso las no usadas, nombres, definiciones vacías cuando no existan y textos completos, URLs efectivas y checksums del manifiesto

#### Scenario: Exportación incompleta
- **WHEN** al menos una tarjeta queda pendiente para cualquier participante
- **THEN** la orden falla sin generar archivos ni modificar la base

#### Scenario: Campos prohibidos
- **WHEN** una exportación intenta incluir un token, secreto, sesión, hash de credencial o payload crudo
- **THEN** el proceso rechaza el campo y no publica ni escribe un paquete parcial
