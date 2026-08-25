# Flujo del estudio

## Estado documental

El baseline operativo declarado por `AGENTS.md` es **LEGACY**. Las superficies del estudio presentes en el worktree son
**IMPLEMENTED-UNVERIFIED**: existe código, pero no se ejecutó infraestructura ni HTTP durante este cambio.
`PLANNED` se reserva para capacidades que solo aparecen en OpenSpec o tareas pendientes. `VERIFIED` se limita a hechos
estáticos con fuente identificable.

## CSV y muestra

El CSV montado en `labeling-study-prepare` es la autoridad de selección e identidad. Debe fijar exactamente 300
`source_card_id` únicos, ordinal, checksum, contenido canónico, baseline `pr_cards` y el lenguaje. `study_card` conserva
la pertenencia y orden comunes; no se crean copias de la muestra por participante.

El parser admite campos multilinea y JSON incrustado. Un conteo distinto, IDs duplicados o drift canónico debe bloquear
el bootstrap sin sobrescribir tarjetas, decisiones o membresía existentes.

## Preparación

La secuencia prevista es: esperar PostgreSQL saludable, validar `clean` o `existing`, aplicar migraciones, leer y validar
CSV, crear/reutilizar estudio y participantes, persistir las 300 membresías, marcar `READY` y ejecutar enriquecimiento
GitHub opcional. Solo después puede arrancar el servidor. Un error debe impedir el arranque o revertir la transacción.

`clean` falla ante objetos legacy y no los elimina automáticamente. `existing` exige confirmación explícita y backup
externo verificable antes de la retirada protegida. La aplicación real de ambos caminos es `IMPLEMENTED-UNVERIFIED`.

## Participantes y categorías

La configuración usa `studyKey`, `expectedCardCount=300` y participantes únicos; el fallback contiene tres
participantes. Cada participante comparte las mismas 300 tarjetas, pero sus categorías, clasificaciones, descartes,
observaciones y progreso se filtran por `study_id` y `participant_id`.

Las categorías son planas, privadas y propiedad de un participante. Solo una clasificación `CLASSIFIED` referencia
exactamente una categoría. La taxonomía final jerárquica es `PLANNED` y no debe confundirse con estas categorías.

Seleccionar un reviewer no autentica: no hay sesión, autorización ni CSRF. El aislamiento es lógico y no una frontera
de seguridad.

## Estados privados

- `PENDING`: no existe decisión del participante.
- `CLASSIFIED`: existe una clasificación privada con una categoría del mismo participante; admite observaciones y
  revisión optimista.
- `DISCARDED`: existe un descarte privado con motivo opcional; no elimina `pr_cards` ni `study_card`.

Las transiciones son `PENDING -> CLASSIFIED` o `PENDING -> DISCARDED`. Una tarjeta descartada no puede clasificarse y
una clasificada no puede descartarse. El replay del descarte solo es válido si el motivo coincide. Otros participantes
pueden decidir la misma tarjeta independientemente.

El progreso cumple `classified + discarded + pending = total`, con total esperado 300 por participante. No hay labels
globales, multiselección compartida ni difusión Socket.io.

## Enriquecimiento GitHub

GitHub no selecciona la muestra ni cambia identidad, ordinal, checksum CSV, `pr_cards` o `study_card`. El proceso
prepare-only puede capturar metadata, commits, files, reviews y comentarios; timeline y diff son opcionales. Los bodies
crudos y tokens no deben persistirse.

Solo un run completo, del mismo estudio y checksum, con 300 snapshots y sin decisiones previas puede promocionarse. El
staging incompleto no es visible. La proyección parte del CSV, puede usar valores GitHub no nulos de endpoints completos,
mantiene `language` del CSV y separa evidencia/procedencia. Las rutas y plantillas nunca llaman a GitHub.

El procedimiento canónico está en [`deployment/GITHUB-ENRICHMENT.md`](../deployment/GITHUB-ENRICHMENT.md); el rollback,
en [`deployment/ROLLBACK.md`](../deployment/ROLLBACK.md).

## Fuera de alcance

Son **LEGACY** los labels globales, conflictos, resolución destructiva, fixtures antiguos, Socket.io y exportaciones
JSONL del etiquetador genérico. Son **PLANNED** la exportación CSV/TSV reproducible, taxonomía final, acuerdo,
adjudicación, autenticación, sesiones, autorización, CSRF, webhooks y workers permanentes.

## Fuentes

`AGENTS.md`, `util/csv-pr-provider.js`, `util/study-config.js`, `util/study-bootstrap.js`, `util/study-runtime.js`,
`util/study-mutation.js`, `routes/`, `schema/migrations/`, las vistas de revisión, Compose y los cambios OpenSpec
activos. La evidencia runtime no se infiere de la existencia de estos archivos.
