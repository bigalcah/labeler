## MODIFIED Requirements

### Requirement: Una clasificación por PR y participante
El sistema MUST derivar para cada `(pr_card_id, participant_id)` exactamente uno de los estados `PENDING`, `CLASSIFIED` o `DISCARDED`. Las únicas transiciones iniciales son `PENDING -> CLASSIFIED` y `PENDING -> DISCARDED`; ninguna mutación puede cambiar entre estados terminales.

La revisión efectiva de una tarjeta pendiente es `0`. La primera clasificación persiste revisión `1` y cada edición confirmada incrementa la revisión en uno.

#### Scenario: Clasificación normal
- **WHEN** el participante selecciona una categoría válida y guarda una tarjeta pendiente con `expected_revision=0`
- **THEN** el sistema registra revisión `1` y responde con `303` hacia la continuación pendiente

#### Scenario: Corrección antes de terminar
- **WHEN** el participante vuelve a una tarjeta clasificada y envía una revisión con la versión esperada
- **THEN** el sistema actualiza categoría y observación, incrementa la revisión y no modifica a otro participante

#### Scenario: Transición cruzada
- **WHEN** el participante intenta clasificar una tarjeta descartada o descartar una clasificada
- **THEN** el sistema responde `409` sin cambiar el estado

#### Scenario: Revisión obsoleta
- **WHEN** una clasificación usa una revisión distinta de la persistida
- **THEN** el sistema responde `409` y no modifica la clasificación

### Requirement: Cola común de tarjetas
El sistema SHALL asociar las mismas 300 tarjetas a cada participante y excluir de su cola pendiente las tarjetas que ese participante haya clasificado o descartado.

#### Scenario: Tres participantes
- **WHEN** tres participantes comienzan el estudio local
- **THEN** cada uno puede recorrer las 300 tarjetas de forma independiente y el descarte de uno no elimina la tarjeta de la cola de los otros

#### Scenario: Descarte aislado
- **WHEN** el participante A descarta un PR
- **THEN** sale de la cola pendiente de A y permanece pendiente o revisable para B

### Requirement: Guardado y progreso
El sistema MUST guardar clasificación o descarte atómicamente y SHALL calcular `classified + discarded + pending = 300` para el participante actual.

#### Scenario: Reanudación
- **WHEN** un participante cierra la aplicación después de clasificar o descartar parte de la muestra
- **THEN** al volver conserva sus categorías, respuestas, descartes y número de tarjetas completadas

#### Scenario: Conteos privados
- **WHEN** el participante consulta su progreso
- **THEN** ve sus tres conteos y no los de otro participante

### Requirement: Aislamiento del flujo local
Las rutas MUST resolver primero exactamente un estudio `READY` y limitar toda lectura y escritura mediante `study_participant` y `study_card`; cero o varios estudios `READY` producen `503`.

#### Scenario: Cambio de participante
- **WHEN** se selecciona otro participante en el entorno local
- **THEN** se carga únicamente su catálogo de categorías, sus PR pendientes, sus clasificaciones y sus descartes

#### Scenario: Participante fuera del estudio
- **WHEN** se solicita una ruta con un participante no miembro
- **THEN** responde `404` sin consultar ni modificar estados de otro participante

## ADDED Requirements

### Requirement: Navegación direccionable
El sistema SHALL exponer `GET /:participant/queue` y `GET /:participant/queue/:cardId` para las 300 tarjetas del estudio, ordenadas por `study_card.ordinal`, con estado pendiente, clasificado o descartado.

#### Scenario: Raíz de la cola
- **WHEN** el participante abre la raíz de la cola
- **THEN** se redirige a la primera pendiente o se muestra una cola vacía `200` si no queda ninguna

#### Scenario: Navegar anterior y siguiente
- **WHEN** el participante pulsa anterior o siguiente
- **THEN** se abre la tarjeta vecina según ordinal sin escribir ningún estado

#### Scenario: Extremos
- **WHEN** la tarjeta es la primera o última
- **THEN** el control sin destino queda deshabilitado y la respuesta sigue siendo `200`

#### Scenario: Continuar después de mutar
- **WHEN** el participante clasifica o descarta una tarjeta
- **THEN** la respuesta `303` conduce a la siguiente tarjeta pendiente por ordinal, con vuelta al primer pendiente si procede

### Requirement: Descarte privado con motivo opcional
El sistema MUST permitir un único descarte por participante con un motivo textual opcional y privado. Un string se recorta y se normaliza a `NULL` si queda vacío; un valor no textual produce `422`.

#### Scenario: Descarte válido
- **WHEN** el participante confirma el descarte de una tarjeta pendiente
- **THEN** se guarda un único descarte, el motivo vacío se normaliza a `NULL` y la tarjeta deja de estar pendiente para ese participante

#### Scenario: Descarte repetido
- **WHEN** el participante repite el mismo descarte con el mismo motivo normalizado
- **THEN** la operación es idempotente y responde `303` sin duplicar progreso

#### Scenario: Replay con motivo distinto
- **WHEN** el participante repite el descarte con un motivo normalizado distinto
- **THEN** responde `409` y conserva el descarte original

### Requirement: Primera mutación concurrente confirmada
Clasificación y descarte MUST abrir una transacción, bloquear mediante `SELECT ... FOR UPDATE` la misma fila `study_card` antes de leer sus estados y responder solo después de confirmar o revertir.

#### Scenario: Clasificación y descarte concurrentes
- **WHEN** dos transacciones mutan simultáneamente la misma tarjeta para el mismo participante
- **THEN** la primera que confirma establece el estado terminal y la segunda responde `409`

### Requirement: Errores HTTP de clasificación y descarte
Las rutas MUST responder `400` para UUID o revisión ausentes o mal formados, `404` para participante, tarjeta o categoría fuera del estudio, `409` para conflicto de estado, replay con motivo diferente o versión obsoleta, `422` para motivo inválido, `503` si no existe exactamente un estudio `READY` y `303` tras una mutación correcta o replay idéntico.

#### Scenario: Petición obsoleta
- **WHEN** una mutación usa una revisión distinta de la persistida
- **THEN** responde `409` y conserva el estado persistido
