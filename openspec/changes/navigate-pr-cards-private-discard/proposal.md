## Why

La pantalla actual permite clasificar una tarjeta, pero no ofrece un flujo claro para recorrer la muestra ni una salida para los PR que un participante no desea clasificar. El estudio necesita navegación explícita y un descarte privado para que cada participante pueda avanzar sin alterar la cola ni las respuestas de los demás.

## What Changes

- Añadir URLs direccionables por tarjeta para navegar por las 300 tarjetas del estudio, incluyendo pendientes, clasificadas y descartadas.
- Hacer que la acción de continuar después de una mutación busque la siguiente tarjeta pendiente.
- Añadir el descarte privado de una tarjeta para el participante actual.
- Excluir de la cola personal las tarjetas descartadas por ese participante, sin retirarlas para los demás.
- Mantener la máquina de estados `PENDING -> CLASSIFIED|DISCARDED`; permitir editar una clasificación, rechazar transiciones entre estados terminales con `409` y hacer idempotente el descarte repetido.
- Mostrar `classified`, `discarded` y `pending`, con `classified + discarded + pending = 300` por participante.
- Conservar la privacidad de categorías, clasificaciones, descartes y conteos entre participantes.
- Serializar clasificación y descarte bloqueando la misma fila `study_card`; la primera mutación confirmada gana.

## Capabilities

### New Capabilities

No se introduce una capacidad independiente; el comportamiento pertenece al flujo existente de clasificación privada.

### Modified Capabilities

- `private-open-card-sorting`: cambia la cola personal para admitir navegación y descarte privado por participante.
- `study-management`: cambia el cálculo de pendientes y progreso para incluir el estado descartado sin modificar la muestra común.

## Impact

- Esquema PostgreSQL: migración `003_private_pr_discard` con almacenamiento por `(pr_card_id, participant_id)`, revisión optimista y restricciones de exclusión entre descarte y clasificación.
- Rutas Express y vistas EJS del flujo de cola, tarjeta, progreso y clasificación.
- Consultas de cola y conteos para aislar el estado por participante.
- Runner versionado: `001` como baseline inmutable, `003` como migración gestionada y `002` como retirada legacy protegida fuera del runner común.
- El runner gestionará únicamente `001` y `003`, reconocerá `002` como ID externo ya aplicado y rechazará IDs desconocidos sin escribir el ledger.
- El bootstrap exigirá los IDs `001` y `003`, pero no aplicará migraciones; el flujo existente ejecutará `001`, `002` protegido y `003` en ese orden.
- Rollback operativo: después del primer descarte, la versión anterior solo podrá abrirse con un launcher de solo lectura; cualquier rollback escribible usará otro destino restaurado desde un backup pre-descarte.
- Pruebas unitarias, de integración HTTP y de privacidad entre participantes.
- No se modifica la muestra de 300 PR, la taxonomía privada ni la eliminación legacy ya completada.
