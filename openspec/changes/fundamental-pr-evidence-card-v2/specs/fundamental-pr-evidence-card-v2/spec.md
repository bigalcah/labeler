## Purpose

Proporcionar evidencia GitHub local, reproducible y segura para que los participantes identifiquen señales de retrabajo en cada Pull Request sin depender de la red durante la clasificación.

## ADDED Requirements

### Requirement: Contrato de evidencia fundamental
El sistema SHALL exponer una proyección `CardV2` con identidad CSV, campos resueltos, métricas, secciones de evidencia y metadatos del snapshot. Cada campo SHALL declarar `value`, `availability` y `provenance`; cada sección SHALL declarar estado, conteos capturados/reportados y razón de truncamiento cuando corresponda.

#### Scenario: Snapshot completo
- **WHEN** una tarjeta tiene un snapshot GitHub promovido con metadata, reviews, comentarios y archivos
- **THEN** la proyección entrega esos datos con procedencia GitHub y estado `PRESENT` o `COMPLETE`

#### Scenario: Campo ausente legítimamente
- **WHEN** GitHub devuelve un valor nulo o un endpoint completo sin resultados
- **THEN** el campo se representa como `EMPTY` y nunca como un valor inventado

### Requirement: Recuperación semánticamente compatible
El sistema SHALL recuperar desde GitHub metadata del PR, autor, estado, fechas, commits, archivos modificados, adiciones, eliminaciones, revisiones, comentarios de PR y comentarios inline. `dataset_language` SHALL permanecer exclusivamente informado por el CSV; no se podrá completar desde estadísticas actuales del repositorio.

#### Scenario: Métricas de cambios faltantes
- **WHEN** el CSV no contiene `file_count` o `total_changes` y el metadata GitHub está completo
- **THEN** la proyección calcula `changed_file_count`, `additions`, `deletions` y `total_changes = additions + deletions` con procedencia GitHub/DERIVED

#### Scenario: Revisión con cambios solicitados
- **WHEN** una revisión tiene estado `CHANGES_REQUESTED` aunque su cuerpo sea nulo
- **THEN** se conserva como evento de revisión y se muestra que no tiene explicación escrita

### Requirement: Separación de evidencia y baseline
El sistema MUST conservar el CSV como autoridad de muestra, identidad, ordinal, contenido y checksum. La evidencia textual CSV y los arrays GitHub SHALL permanecer en namespaces separados; no se concatenarán ni deduplicarán implícitamente.

#### Scenario: Preservación del baseline
- **WHEN** se construye una tarjeta v2 enriquecida
- **THEN** `source_card_id`, repositorio, número, ordinal, payload y checksum CSV coinciden con el baseline anterior

#### Scenario: Campo superpuesto
- **WHEN** un campo GitHub no nulo proviene de metadata completa
- **THEN** puede ser el valor resuelto visible, pero la procedencia identifica fuente, run, endpoint y estado sin borrar el valor CSV

### Requirement: Estados explícitos de disponibilidad
El sistema SHALL distinguir `PRESENT`, `EMPTY`, `UNAVAILABLE` y `TRUNCATED` para campos y secciones. Un dato no disponible o truncado nunca se representará como cero, vacío completo o éxito silencioso.

#### Scenario: Endpoint no disponible
- **WHEN** un endpoint opcional responde `404` o `410`
- **THEN** la sección queda `UNAVAILABLE`, la tarjeta sigue siendo inspeccionable y se informa el estado

#### Scenario: Límite de GitHub
- **WHEN** la captura alcanza el límite documentado de commits, archivos o patch
- **THEN** la sección queda `TRUNCATED` con cantidad capturada y razón visible

### Requirement: Snapshot reproducible y aislamiento
Todos los participantes SHALL recibir el mismo snapshot GitHub promovido y la misma versión de `CardV2`. El payload participante MUST excluir tokens, correos, payloads crudos, categorías, observaciones y progreso de otros participantes.

#### Scenario: Clasificación offline
- **WHEN** un participante abre una tarjeta v2
- **THEN** el navegador usa únicamente evidencia persistida localmente y puede clasificar sin solicitar GitHub

#### Scenario: Aislamiento participante
- **WHEN** se renderiza una tarjeta para un participante
- **THEN** la respuesta no contiene decisiones, categorías, observaciones ni progreso de otra persona

### Requirement: Ledger versionado y append-only
Cada run creado con telemetría SHALL fijar `attempt_telemetry_version = 1`. Cada llamada HTTP real SHALL producir un evento `ATTEMPT_STARTED` confirmado antes de emitir la solicitud y un evento `ATTEMPT_FINISHED` posterior con el mismo `attempt_id`. Los eventos SHALL identificar run, estudio, ejecución, tarjeta, endpoint, página, fingerprint de solicitud e intento. El evento final SHALL registrar timestamp, duración, clasificación, estado HTTP nullable, código controlado de error, decisión, cuota normalizada, retry efectivo, espera programada y request ID sanitizado. El ledger MUST excluir URL, credencial, alias de credencial, token, headers completos, `Authorization`, query string, cuerpo, mensaje de error, payload normalizado y JSON arbitrario.

#### Scenario: Reentrega idempotente
- **WHEN** se intenta persistir otra vez el mismo `event_id` con contenido idéntico
- **THEN** no se crea una segunda fila
- **AND** si cualquier campo difiere se rechaza con `ATTEMPT_EVENT_CONFLICT`

#### Scenario: Fallo antes de completar el intento
- **WHEN** existe `ATTEMPT_STARTED` sin su `ATTEMPT_FINISHED`
- **THEN** el informe marca el run como telemetría `INCOMPLETE`
- **AND** un run instrumentado no puede completarse ni promocionarse

### Requirement: Clasificación HTTP y política de retry
`429` SHALL clasificarse siempre como `RATE_LIMIT`. Un `403` SHALL ser `RATE_LIMIT` únicamente si presenta `Retry-After`, cuota restante cero, una señal secundaria reconocida o el mensaje secundario documentado. Un `403` con solo `X-RateLimit-Reset` SHALL ser `TERMINAL_HTTP`. El tipo será `PRIMARY`, `SECONDARY` o `UNSPECIFIED`. `502`, `503`, `504`, timeout y transporte SHALL ser retryables; `401`, `403` no limitado y los demás 4xx SHALL ser terminales. `404` y `410` no se reintentarán y solo mapearán a `UNAVAILABLE` donde el contrato lo permita. Los hints del servidor no se multiplicarán exponencialmente; el backoff exponencial aplicará al fallback y errores transitorios.

#### Scenario: Hint de espera
- **WHEN** existe `Retry-After` válido en segundos o fecha HTTP
- **THEN** se normaliza a timestamp absoluto
- **AND** no se solicita antes del máximo seguro entre ese timestamp y el reset aplicable, con margen y jitter

#### Scenario: Sin hint válido
- **WHEN** una respuesta limitada no aporta un hint válido
- **THEN** se usa fallback de 60 segundos con backoff, margen y jitter
- **AND** el ledger registra `retry_source = FALLBACK_RATE_LIMIT`

### Requirement: Pausa, checkpoint y reanudación
Una respuesta limitada SHALL reintentarse solo mientras queden intentos y el retry efectivo no exceda el presupuesto. En caso contrario la ejecución SHALL persistir `PAUSE_COMMITTED`, páginas completas, checkpoint, cuota y `next_resume_at` en una única transacción y devolver `PAUSED`. `PAUSED` será un estado de control; el run persistido continuará `RUNNING`. Antes de `next_resume_at`, una invocación SHALL devolver `PAUSED` sin solicitudes ni eventos de intento. Después podrá registrar `RESUME_STARTED` y continuar el mismo run compatible. El checkpoint SHALL avanzar únicamente después de confirmar `github_enrichment_run_card`.

#### Scenario: Pausa por cuota
- **WHEN** el presupuesto no permite esperar al retry seguro
- **THEN** no se inicia otra solicitud
- **AND** no se finaliza, falla ni promociona el run

#### Scenario: Resume seguro
- **WHEN** llega `next_resume_at` para el mismo checksum, configuración, normalizador y versión telemétrica
- **THEN** se reanuda el mismo run sin repetir tarjetas confirmadas
- **AND** todo nuevo intento obtiene un `attempt_id` distinto

### Requirement: Cobertura y limitación histórica
El informe SHALL clasificar la telemetría como `COMPLETE`, `INCOMPLETE` o `NOT_INSTRUMENTED`. `COMPLETE` exige pares STARTED/FINISHED exactos, decisiones coherentes, pausas con checkpoint y reanudaciones no anteriores a `retry_at`. Un run con `attempt_telemetry_version IS NULL` SHALL ser `NOT_INSTRUMENTED`; sus conteos 403, 429 y rate limits SHALL ser `null`. La falta histórica de telemetría no invalidará por sí sola la cobertura del snapshot ni obligará a sustituir un run ya usado por participantes.

#### Scenario: Run histórico
- **WHEN** el run histórico tiene versión telemétrica nula y cero eventos
- **THEN** se informa `telemetry_status = NOT_INSTRUMENTED` y `event_count = 0`
- **AND** no se afirma ni que hubo ni que no hubo respuestas 403/429
