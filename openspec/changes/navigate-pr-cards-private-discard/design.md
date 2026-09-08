## Context

El MVP tiene un único estudio `READY`, una membresía común en `study_card`, categorías privadas en `participant_category` y una clasificación por `(pr_card_id, participant_id)`. El cambio añade un segundo estado terminal privado y requiere que el runtime deje de consultar `pr_cards` globalmente para usar la membresía del estudio.

## Goals / Non-Goals

**Goals:**

- Persistir descartes privados con una unicidad por PR y participante.
- Mantener un orden estable basado en `study_card.ordinal` para URLs de tarjeta y navegación siguiente/anterior.
- Hacer que clasificación, descarte y progreso se actualicen dentro de transacciones.
- Exponer solo el estado del participante seleccionado en cola, tarjeta y progreso.

**Non-Goals:**

- No retirar tarjetas de `pr_cards` o `study_card`.
- No compartir motivos, respuestas ni conteos privados.
- No añadir deshacer de descarte, exportación, realtime ni autenticación.
- No incorporar una dependencia frontend nueva; se mantiene EJS y JavaScript existente.

## Decisions

### 1. Tabla separada para el descarte

Se añadirá `pr_discard` con `pr_card_id`, `participant_id`, `reason TEXT NULL`, `discarded_at` y clave primaria compuesta `(pr_card_id, participant_id)`. `pr_classification` añadirá una revisión numérica para detectar formularios obsoletos.

Se consideraron un estado `discarded` dentro de `pr_classification` y una columna booleana en `study_card`; se descartan porque mezclan estados distintos o vuelven global una decisión que debe ser privada.

### 2. Runner versionado y baseline

`001_study_foundation.sql` permanece inmutable como baseline. Se añadirá `003_private_pr_discard.sql`, que requiere `001`, crea descarte, revisión, índices y la restricción de un único estudio `READY`, y registra su ledger sin `ON CONFLICT`. `002_retire_legacy_labeler` permanece fuera del runner porque es destructiva y requiere backup.

El runner usa un catálogo cerrado `managed: 001,003` y `knownExternal: 002`, un advisory lock de sesión y un único cliente PostgreSQL. Lee `labeler_migration`, ejecuta solo IDs gestionados ausentes en orden, no escribe el ledger directamente, rechaza IDs desconocidos antes de ejecutar y nunca ejecuta `002`. Cada archivo controla su propia transacción, rollback e inserción del ledger.

En `clean`, se verifica ausencia de objetos legacy, se ejecuta el runner completo y luego el bootstrap. En `existing`, se verifica backup, se ejecuta el runner baseline, se ejecuta la retirada protegida `002` si falta, se ejecuta el runner completo para `003` y luego el bootstrap. Una base ya retirada omite `002` tras validar su backup.

### 3. Exclusión y consistencia por transacción

La consulta de cola excluirá las tarjetas que tengan una fila en `pr_classification` o `pr_discard` para el participante. Cada mutación resolverá el único estudio `READY`, validará membresía, bloqueará la fila `study_card` con `FOR UPDATE` y leerá ambos estados después del bloqueo. La primera mutación confirmada gana; la incompatible devuelve `409` y el replay idéntico del descarte es idempotente.

No se añadirá `DROP` ni compatibilidad con tablas legacy; la migración nueva solo crea la estructura MVP faltante y sus índices.

### 4. Navegación por ordinal estable

`GET /:participant/queue/:cardId` navegará las 300 filas `study_card` en orden ordinal y mostrará el estado privado actual. La cola raíz redirigirá a la primera pendiente. Después de una mutación, `303` redirigirá a la siguiente pendiente por ordinal, con vuelta al primer pendiente; si no queda ninguna, mostrará una cola vacía `200`.

Se consideró navegar por un contador global de `pr_cards`, pero se descarta porque ignoraría la membresía canónica del estudio y produciría destinos distintos cuando cada participante tiene estados privados diferentes.

### 5. Presentación y progreso

La vista de revisión mostrará controles anterior/siguiente y una acción de descarte separada de la clasificación. El progreso mostrará `classified`, `discarded` y `pending`; todas las consultas se limitarán al miembro actual del único estudio `READY`.

## Risks / Trade-offs

- [Una clasificación y un descarte concurrentes pueden competir] → Bloquear la misma fila antes de leer ambos estados y usar revisión optimista; la primera mutación gana y la incompatible devuelve `409`.
- [El participante puede navegar a una tarjeta que deja de estar activa en otra pestaña] → Recalcular destinos y responder `409` o redirigir a la siguiente tarjeta disponible sin perder el estado confirmado.
- [La tabla nueva puede quedar fuera de una base existente] → Añadir migración versionada, guardia de bootstrap y pruebas de base limpia/existente.
- [El descarte puede reducir la cola sin reducir la muestra común] → Mantener `study_card` intacta y calcular el progreso con los dos estados privados.

## Migration Plan

1. Implementar el runner común y la migración `003`, sin cambiar `001` ni ejecutar `002` desde el runner.
2. Actualizar el flujo `clean`/`existing` para ejecutar `001 → 002 protegido → 003` cuando corresponda.
3. Actualizar las consultas de cola, progreso y navegación con el estudio y participante activos.
4. Añadir las rutas de descarte y destinos anterior/siguiente con validación transaccional y revisión esperada.
5. Actualizar la vista y probar clasificación, descarte, navegación y aislamiento en dos participantes.
6. Verificar bases limpias, existentes, ya retiradas, repetición idempotente y fallos transaccionales.

Rollback: antes de que existan descartes puede restaurarse la versión anterior siguiendo el backup aprobado. Después de existir descartes, el launcher anterior omitirá el preparador y usará un rol sin DML/DDL con `default_transaction_read_only=on`; un rollback escribible requiere restaurar un backup pre-descarte en otra base aprobada.

## Open Questions

No quedan decisiones abiertas que cambien el contrato; el descarte privado y la exclusión de la cola quedan fijados por la especificación.
