## MODIFIED Requirements

### Requirement: Categorías privadas por participante

El sistema SHALL permitir crear, renombrar y reutilizar categorías planas asociadas al participante y al `study_id` derivados de la sesión, sin compartirlas con otros participantes ni con el otro estudio. Solo una clasificación en estado `CLASSIFIED` puede tener exactamente una categoría privada.

#### Scenario: Categorías similares
- **WHEN** dos participantes crean `Missing tests` y `Falta de pruebas`, o la misma persona las crea en estudios distintos
- **THEN** el sistema conserva categorías independientes por participante y estudio, y cada una solo aparece en su contexto autorizado

### Requirement: Cola común de tarjetas

El sistema SHALL leer desde `study_card` las mismas `expectedCardCount` PR para cada participante del estudio actual, donde el conteo persistido solo puede ser 30 o 300, y excluir de su cola los PR que el participante derivado de la sesión ya haya clasificado o descartado.

#### Scenario: Tres participantes
- **WHEN** `javier`, `diego` y `pablo` comienzan el estudio actual
- **THEN** cada uno puede recorrer las mismas 300 tarjetas de forma independiente

#### Scenario: Tres participantes en 30
- **WHEN** `javier-30`, `diego-30` y `pablo-30` comienzan el estudio de validación
- **THEN** cada uno puede recorrer las mismas 30 tarjetas de forma independiente, sin recibir tarjetas del estudio actual

#### Scenario: Descarte privado en la cola
- **WHEN** el participante A descarta un PR en uno de los estudios
- **THEN** el PR deja de estar pendiente para A, permanece disponible para B en ese mismo estudio y los conteos de A no aparecen para B ni para el otro estudio

### Requirement: Guardado y progreso

El sistema MUST guardar cada clasificación o descarte y actualizar el progreso de forma atómica, y SHALL mantener `classified + discarded + pending = expectedCardCount` para el participante actual, usando el conteo persistido de su estudio.

#### Scenario: Reanudación
- **WHEN** un participante cierra la aplicación después de clasificar o descartar parte de la muestra
- **THEN** al volver conserva sus categorías, respuestas, descartes y número de tarjetas completadas dentro de su estudio

#### Scenario: Finalización por estudio
- **WHEN** el participante termina todas las tarjetas de un estudio de 30 o 300
- **THEN** su progreso queda en `classified + discarded = expectedCardCount` y la cola queda vacía sin afectar al otro estudio

### Requirement: Aislamiento del flujo local

El flujo de clasificación MUST operar sin selector de participantes ni selector de estudio. Las categorías, cola, tarjetas, clasificaciones, descartes, observaciones, progreso y mutaciones SHALL ser privadas y derivadas del contexto de sesión validado, incluyendo el `study_id` persistido en la cuenta y sesión.

#### Scenario: Sesiones independientes
- **WHEN** dos participantes autenticados consultan o modifican el mismo estudio
- **THEN** cada uno carga únicamente sus categorías, sus PR pendientes, sus clasificaciones, sus descartes, sus observaciones y su progreso, sin afectar al otro

#### Scenario: Aislamiento entre estudios
- **WHEN** una persona usa la cuenta actual o la cuenta de validación
- **THEN** la aplicación muestra solo la membresía, las tarjetas y los resultados del `study_id` persistido en esa cuenta

#### Scenario: Cambio de participante
- **WHEN** un cliente intenta cambiar de participante o estudio mediante un selector, un sufijo de username o un identificador enviado en la solicitud
- **THEN** el sistema rechaza o ignora el valor y conserva exclusivamente la identidad y el `study_id` derivados de la sesión validada

## ADDED Requirements

### Requirement: Contexto de sesión autoritativo

Toda ruta protegida y toda mutación del estudio SHALL derivar el participante y el estudio exclusivamente de una sesión de servidor validada. El sistema MUST ignorar y no usar identificadores de participante o estudio recibidos en la URL, query string, formulario o cabeceras del cliente, y MUST rechazar el acceso si la sesión no está autenticada, ha expirado o no es válida. El username SHALL ser solo una credencial de búsqueda y nunca un selector de estudio.

#### Scenario: Acceso sin sesión
- **WHEN** un cliente solicita una cola, categorías, tarjetas, clasificaciones, progreso u observaciones sin una sesión autenticada válida
- **THEN** el sistema deniega la operación y no revela datos ni escribe cambios

#### Scenario: Identificador de otro participante
- **WHEN** un cliente autenticado incluye en la URL, query string, formulario o cabeceras el identificador de otro participante o estudio
- **THEN** el sistema usa únicamente el contexto de la sesión, deniega cualquier intento de acceder o mutar datos ajenos y no realiza ninguna mutación

#### Scenario: URL antigua con participante
- **WHEN** un cliente solicita una ruta antigua que selecciona al participante mediante la URL
- **THEN** el sistema deniega la solicitud o la trata como una ruta no protegida inexistente, sin cargar ni modificar datos de ningún participante

### Requirement: Protección CSRF y origen

Toda acción que cree, renombre, actualice o elimine categorías, clasificaciones, descartes u observaciones MUST exigir un token CSRF sincronizador válido, asociado a la sesión autenticada, y un origen permitido. El sistema MUST validar ambos controles antes de iniciar cualquier mutación.

#### Scenario: Token CSRF ausente o inválido
- **WHEN** una mutación llega sin token CSRF, con un token inválido o con un token perteneciente a otra sesión
- **THEN** el sistema deniega la operación y no crea, renombra, actualiza ni elimina categorías, clasificaciones, descartes u observaciones

#### Scenario: Origen ausente o no permitido
- **WHEN** una mutación llega sin origen válido o desde un origen no permitido
- **THEN** el sistema deniega la operación y no realiza ninguna mutación, aunque el token CSRF sea válido

#### Scenario: Sesión cruzada
- **WHEN** un cliente combina un token CSRF, cookies o contexto de sesión de participantes o estudios distintos
- **THEN** el sistema deniega la operación y no acepta ni persiste datos para ninguno de los contextos

### Requirement: Bootstrap no crea categorías, clasificaciones ni descartes

El bootstrap SHALL crear solo la estructura del estudio, participantes, tarjetas y membresía. Las categorías, clasificaciones y descartes MUST ser creados por acciones explícitas del participante y permanecer privados.

#### Scenario: Estudio recién preparado
- **WHEN** termina el bootstrap de las 30 o 300 tarjetas de un estudio
- **THEN** cada participante tiene exactamente `expectedCardCount` tarjetas pendientes y ningún catálogo, clasificación o descarte sembrado

### Requirement: Descarte privado con motivo opcional

El sistema MUST permitir un único descarte por participante y estudio con un motivo textual opcional y privado. Un motivo textual se recorta y se normaliza a `NULL` si queda vacío. Un valor no textual produce `422`. El estado solo puede pasar de `PENDING` a `DISCARDED`; no se permiten transiciones entre estados terminales. Un replay idéntico normalizado es idempotente y un replay con motivo diferente produce `409` sin modificar el descarte original.

#### Scenario: Descarte válido
- **WHEN** el participante confirma el descarte de una tarjeta pendiente con un motivo opcional
- **THEN** se guarda un único descarte privado, el motivo vacío se normaliza a `NULL` y la tarjeta deja de estar pendiente para ese participante y estudio

#### Scenario: Replay idéntico
- **WHEN** el participante repite el descarte con el mismo motivo normalizado
- **THEN** la operación responde `303`, no duplica el descarte y no incrementa de nuevo el progreso

#### Scenario: Replay con motivo diferente
- **WHEN** el participante repite el descarte con un motivo normalizado diferente
- **THEN** el sistema responde `409` y conserva el descarte original

#### Scenario: Transición terminal inválida
- **WHEN** el participante intenta clasificar una tarjeta descartada o descartar una tarjeta clasificada
- **THEN** el sistema responde `409` sin cambiar el estado terminal

### Requirement: Navegación direccionable derivada de sesión

El sistema SHALL exponer rutas canónicas direccionables para la cola y las tarjetas, sin identificadores de participante o estudio en path, query string ni formularios. La ruta resolverá el estudio, participante, tarjeta y estado exclusivamente desde la sesión validada y ordenará las tarjetas por `study_card.ordinal`.

#### Scenario: Acceso a la cola canónica
- **WHEN** un participante autenticado solicita la cola o una tarjeta mediante la ruta canónica
- **THEN** el sistema muestra únicamente su estado privado y rechaza o ignora cualquier identificador de participante o estudio suministrado por el cliente

#### Scenario: Navegación anterior y siguiente
- **WHEN** el participante pulsa anterior o siguiente
- **THEN** se abre la tarjeta vecina según `study_card.ordinal` sin escribir ningún estado y sin consultar datos de otro participante o estudio

#### Scenario: Continuación tras mutación
- **WHEN** el participante clasifica o descarta una tarjeta
- **THEN** la respuesta `303` conduce a la siguiente tarjeta pendiente por ordinal, con vuelta al primer pendiente o cola vacía `200` si no queda ninguna

### Requirement: Exportación offline privada y completa

El sistema SHALL ofrecer al operador una orden offline de solo lectura para un `study_key` explícito, sin ruta HTTP, descarga desde el navegador ni selector participante. Solo SHALL exportar después de que todos los participantes configurados hayan llevado todas sus tarjetas a estado terminal. El paquete SHALL incluir `results.csv`, `categories.csv` y `manifest.json` con nombres de categorías, clasificaciones, `classification_remarks`, motivos de descarte, orden de tarjetas, pseudónimos, timestamps y revisiones de decisión, `source_html_url`, `resolved_html_url`, procedencia, checksums, conteo esperado y evidencia de enriquecimiento. Los pseudónimos SHALL derivarse de un secreto HMAC externo con entradas acotadas al estudio. No SHALL exportar tokens, sesiones, hashes, secretos, datos de throttling ni payloads GitHub crudos.

#### Scenario: Exportación completa de 30
- **WHEN** los tres participantes terminan las 30 tarjetas del estudio de validación y el operador ejecuta la orden para su `study_key`
- **THEN** se generan los tres archivos con una fila por tarjeta y participante, todas las categorías incluso las no usadas, nombres y textos completos, URLs efectivas y checksums del manifiesto

#### Scenario: Exportación incompleta
- **WHEN** al menos una tarjeta queda pendiente para cualquier participante
- **THEN** la orden falla sin generar archivos ni modificar la base

#### Scenario: Campos prohibidos
- **WHEN** una exportación intenta incluir un token, secreto, sesión, hash de credencial o payload crudo
- **THEN** el proceso rechaza el campo y no publica ni escribe un paquete parcial
