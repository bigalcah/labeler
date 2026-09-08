## 1. Runner y persistencia privada

- [x] 1.1 Implementar el runner con catálogo gestionado `001,003`, ID externo conocido `002`, advisory lock de sesión, lectura del ledger, orden estricto y rechazo previo de IDs desconocidos.
- [x] 1.2 Crear `003_private_pr_discard.sql` con `pr_discard`, revisión de clasificación, índices, restricción de un único `READY` y registro transaccional sin replay.
- [x] 1.3 Integrar el runner en `migrate:study`, añadir `--through 001_study_foundation` y separar `002_retire_legacy_labeler` como operación protegida externa sin escritura del ledger por el runner.
- [x] 1.4 Añadir pruebas de orden, idempotencia, fallo transaccional, foreign keys y ledger en bases limpia, existente y ya retirada.

## 2. Cola y navegación

- [x] 2.1 Implementar el resolver del único estudio `READY` y exigir membresía `study_participant` en todas las lecturas y escrituras.
- [x] 2.2 Actualizar la cola para usar `study_card` y excluir clasificaciones/descartes solo del participante actual.
- [x] 2.3 Implementar `GET /:participant/queue/:cardId` con estado privado y vecinos por `study_card.ordinal`.
- [x] 2.4 Implementar continuación `303` hacia la siguiente pendiente, vuelta ordinal y cola vacía `200`.
- [x] 2.5 Añadir pruebas HTTP para primera tarjeta, tarjeta intermedia, última tarjeta, estados revisados y cola vacía.

## 3. Descarte y consistencia

- [x] 3.1 Implementar el endpoint de descarte privado con motivo opcional normalizado y estados HTTP `400/404/409/422/303`.
- [x] 3.2 Aplicar `PENDING -> CLASSIFIED|DISCARDED`, edición de clasificación y rechazo `409` de transiciones cruzadas.
- [x] 3.3 Bloquear la fila compartida antes de leer estados y usar revisión esperada para evitar mutaciones obsoletas.
- [x] 3.4 Actualizar progreso con `classified + discarded + pending = 300` por participante.
- [x] 3.5 Añadir pruebas de descarte repetido, concurrencia real, stale tab y visibilidad cruzada.

## 4. Interfaz de estudio

- [x] 4.1 Añadir controles anterior/siguiente para todas las tarjetas y estados deshabilitados en los extremos.
- [x] 4.2 Añadir acción de descarte con confirmación y feedback de éxito o conflicto.
- [x] 4.3 Mostrar el desglose privado de progreso y mantener ocultas respuestas, descartes y categorías ajenas.
- [x] 4.4 Verificar navegación por URL, continuación, descarte y reanudación mediante pruebas de la superficie web.

## 5. Verificación de despliegue

- [x] 5.1 Ejecutar bootstrap en una base limpia y verificar `001,003`, 300 tarjetas por participante y cero descartes iniciales.
- [x] 5.2 Ejecutar flujo existente con `001,002,003`, preservar clasificaciones y aceptar una base ya retirada sin repetir `002`.
- [x] 5.3 Verificar rollback: versión anterior solo lectura después de descartes y rollback escribible únicamente desde backup previo.
- [x] 5.4 Ejecutar lint, pruebas, build y comprobación de que ninguna ruta usa estado global legacy.

## 6. Contratos de verificación

- [x] 6.1 Cubrir `400/404/409/422/503/303`, replay idéntico y replay con motivo diferente en las pruebas HTTP.
- [x] 6.2 Añadir launcher `deployment/docker-compose.rollback-readonly.yml` y runbook `deployment/ROLLBACK.md` que omitan el preparador y configuren el rol read-only.
- [x] 6.3 Verificar que bootstrap exige `001` y `003` en el ledger antes de escribir y nunca aplica migraciones.
