## Purpose

Esta capability define una lista paginada de progreso para el participante autenticado. La lista reutiliza la membresía ordenada del estudio y expone solo el estado privado que corresponde a la sesión validada.

## ADDED Requirements

### Requirement: Contexto de sesión autoritativo para progreso

`GET /progress` MUST requerir una sesión de servidor válida y SHALL derivar exclusivamente de ella el `study_id` y el `participant_id` usados para el resumen, la consulta y el renderizado. Los identificadores recibidos en path, query string, formulario o cabeceras del cliente MUST ser ignorados o rechazados y MUST no cambiar el contexto autorizado. Una sesión ausente, inválida o expirada MUST conservar la respuesta protegida existente sin revelar datos.

#### Scenario: Progreso sin sesión

- **WHEN** un cliente solicita `/progress` sin una sesión autenticada válida
- **THEN** el sistema deniega o redirige según el contrato protegido existente, no devuelve tarjetas ni estado privado y no escribe cambios

#### Scenario: Parámetros de identidad hostiles

- **WHEN** un participante autenticado solicita `/progress?participant_id=otro&study_id=otro&reviewer_id=otro`
- **THEN** el sistema ignora o rechaza esos valores, conserva el `study_id` y `participant_id` de la sesión y no muestra datos ajenos

### Requirement: Paginación normalizada y estable

La ruta MUST aceptar `page` y `limit` como enteros decimales positivos. Los valores ausentes, vacíos, no enteros, no finitos o no positivos SHALL usar `page=1` y `limit=20`. Un `limit` válido mayor que `100` SHALL normalizarse a `100`. La respuesta MUST exponer los valores efectivos y metadata suficiente para construir navegación estable.

#### Scenario: Valores predeterminados

- **WHEN** un participante autenticado solicita `/progress` sin `page` ni `limit`
- **THEN** la respuesta `200` usa `page=1`, `limit=20` y devuelve la primera página en el orden ordinal

#### Scenario: Límite máximo

- **WHEN** un participante autenticado solicita `/progress?page=2&limit=1000`
- **THEN** la respuesta `200` usa `page=2`, `limit=100` y calcula el desplazamiento con ese límite normalizado

#### Scenario: Página fuera de rango

- **WHEN** un participante autenticado solicita una página válida cuyo desplazamiento supera el total de tarjetas
- **THEN** la respuesta `200` conserva la metadata de la página solicitada, devuelve una colección vacía y muestra un estado vacío accesible

### Requirement: Membresía ordenada y estados privados

La lectura MUST partir de `study_card` del estudio de sesión, devolver como máximo una fila por tarjeta asignada y ordenar ascendentemente por `study_card.ordinal`. Cada fila SHALL contener el identificador de la tarjeta, ordinal, título, URL canónica y el estado privado del participante actual. La lista SHALL incluir tarjetas `PENDING`, `CLASSIFIED` y `DISCARDED`, sin reemplazar la membresía por una lista de reviewers.

#### Scenario: Orden de todas las tarjetas asignadas

- **WHEN** un participante solicita varias páginas de progreso
- **THEN** las filas aparecen en orden ascendente de `study_card.ordinal`, sin saltos ni duplicados entre páginas y con el total de la membresía del estudio de sesión

#### Scenario: Estado terminal privado

- **WHEN** el participante actual tiene una tarjeta clasificada o descartada
- **THEN** la fila muestra únicamente su estado, su categoría plana propia si está `CLASSIFIED` o su motivo opcional propio si está `DISCARDED`

### Requirement: Resumen privado completo por categoría

`GET /progress` MUST mostrar, además de la lista paginada de todas las tarjetas, un resumen agrupado de las categorías actuales del participante autenticado en el estudio de sesión. El resumen MUST incluir cada categoría actual, incluso si no tiene tarjetas clasificadas, y MUST mostrar por categoría el conteo de tarjetas `CLASSIFIED` del participante en toda la membresía asignada del estudio, no solo en la página actual. Las tarjetas clasificadas MUST aparecer una sola vez bajo su categoría correspondiente y en orden ascendente de `study_card.ordinal`; cada tarjeta MUST enlazar a `/queue/:id` usando su identificador canónico. El resumen MUST ser independiente de `page` y `limit`, y permanecer completo cuando la página solicitada esté fuera de rango. El resumen MUST conservar el aislamiento simultáneo por `study_id` y `participant_id` de la sesión.

#### Scenario: Categorías completas y conteos sobre todo el estudio

- **WHEN** un participante consulta `/progress` y tiene categorías actuales con distintas cantidades de tarjetas clasificadas, incluidas categorías sin tarjetas
- **THEN** la respuesta muestra todas sus categorías del estudio de sesión, el conteo de `CLASSIFIED` de cada una sobre todas las tarjetas asignadas y cero para las categorías sin uso

#### Scenario: Aislamiento entre participantes y estudios

- **WHEN** participantes distintos consultan progreso en el mismo estudio o un participante consulta otro estudio mediante parámetros de identidad hostiles
- **THEN** cada resumen contiene únicamente las categorías, conteos y tarjetas clasificadas del participante y estudio determinados por su sesión

#### Scenario: Resumen independiente de paginación

- **WHEN** el mismo participante solicita `/progress` con límites o páginas distintos, incluida una página válida fuera de rango
- **THEN** el resumen completo por categoría conserva las mismas categorías, conteos y tarjetas agrupadas, aunque la lista paginada de todas las tarjetas cambie o esté vacía

#### Scenario: Agrupación única, ordinal y enlace canónico

- **WHEN** una categoría contiene varias tarjetas `CLASSIFIED` del participante
- **THEN** cada tarjeta aparece exactamente una vez bajo su categoría, en orden ascendente de `study_card.ordinal`, y enlaza a `/queue/:id` sin identidad en la ruta ni en la query string

### Requirement: Aislamiento de decisiones y resumen

El resumen y cada proyección de estado MUST estar acotados simultáneamente al `study_id` y `participant_id` de la sesión. La respuesta MUST no consultar ni renderizar categorías, clasificaciones, descartes, motivos, observaciones, progreso o resúmenes globales de reviewers o de otro participante.

#### Scenario: Dos participantes del mismo estudio

- **WHEN** Alice y Bob solicitan `/progress` con sesiones independientes después de tomar decisiones distintas sobre la misma tarjeta
- **THEN** Alice ve solo su decisión y Bob ve solo la suya, mientras ambos conservan la misma membresía y orden de tarjetas

#### Scenario: Dos estudios

- **WHEN** una persona autenticada en un estudio solicita `/progress` y envía identificadores del otro estudio
- **THEN** el sistema conserva el estudio de la sesión y no devuelve tarjetas, categorías ni progreso del otro estudio

### Requirement: Navegación canónica de tarjetas

Cada tarjeta MUST enlazar a `/queue/:id` usando únicamente el identificador canónico de la tarjeta. Los enlaces de tarjeta y los controles de progreso MUST no incluir `study_id`, `participant_id`, `reviewer_id`, `study`, `participant`, `reviewer` ni otra identidad en path, query string o formulario.

#### Scenario: Abrir una tarjeta desde progreso

- **WHEN** un participante pulsa el enlace de una tarjeta en una página de `/progress`
- **THEN** el navegador solicita `/queue/:id`, la sesión determina el estudio y participante y la vista conserva únicamente el estado privado de esa sesión

#### Scenario: Cambiar de página

- **WHEN** un participante pulsa anterior, siguiente o una página numerada
- **THEN** el navegador solicita la ruta `/progress` con `page` y `limit` normalizados, sin añadir ninguna identidad de participante o estudio

### Requirement: Ausencia de superficie legacy

El cambio MUST mantener ausentes `/instances`, `/instances/:id`, las rutas con nombre de participante, los selectores de estudio o participante, la exportación web y los resúmenes globales. La implementación MUST NOT add CSS, dependencies, schema changes, SQL migrations or client-side pagination JavaScript.

#### Scenario: Ruta legacy ausente

- **WHEN** un cliente solicita `/instances` o `/instances/:id`
- **THEN** el sistema no registra ni restaura esa superficie y responde como ruta inexistente, sin cargar datos de ningún participante

#### Scenario: Selector legacy ausente

- **WHEN** un cliente envía `?participant=otro`, `?study=otro` o un formulario equivalente
- **THEN** el sistema no usa esos valores como autoridad y conserva el alcance de sesión o rechaza la solicitud sin filtrar ni mutar datos
