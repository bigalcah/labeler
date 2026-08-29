## Why

El CSV puede identificar los 300 PRs, pero deja incompletos campos fundamentales para entender por qué una contribución requirió retrabajo: métricas de cambios, decisiones de revisión, comentarios inline y algunos cuerpos. La nueva versión de tarjetas necesita una evidencia local, reproducible y suficientemente explicativa sin convertir el CSV en mutable ni depender de GitHub durante la clasificación.

## What Changes

- Recuperar desde snapshots autenticados de GitHub únicamente los campos faltantes o semánticamente compatibles: metadatos del PR, métricas de commits/cambios, archivos modificados, revisiones, comentarios de PR y comentarios inline.
- Conservar separados el baseline CSV y la evidencia GitHub; nunca sobrescribir la muestra, identidad, ordinales, checksums ni decisiones privadas.
- Introducir una proyección `CardV2` con disponibilidad (`PRESENT`, `EMPTY`, `UNAVAILABLE`, `TRUNCATED`) y procedencia por campo y sección.
- Mostrar en la tarjeta título, intención, autor, estado, fechas, métricas, archivos, revisiones y comentarios, priorizando la evidencia de `CHANGES_REQUESTED` sin ocultar otros estados.
- Paginar localmente las secciones voluminosas, mantener el diff completo y los detalles profundos como acción explícita hacia GitHub.
- Evitar que la tarjeta participante exponga payloads crudos, secretos, categorías, observaciones o progreso de otros participantes.
- Instrumentar exclusivamente las nuevas capturas offline con un ledger versionado y append-only de eventos de intentos API, pausas y reanudaciones. El ledger permitirá demostrar qué respuestas se observaron, qué decisión de retry se tomó y si la cobertura telemétrica del run es completa, sin incorporarse al snapshot, `CardV2`, rutas web ni HTML participante.
- **BREAKING**: separar visual y semánticamente “Muestra: CSV” de “Evidencia: snapshot GitHub” y retirar la exposición del payload CSV completo en la vista v2.

## Capabilities

### New Capabilities

- `fundamental-pr-evidence-card-v2`: contrato de recuperación, procedencia y presentación de la evidencia fundamental para clasificar retrabajo.

### Modified Capabilities

- `github-pr-ingestion`: amplía el contrato de enriquecimiento aditivo y fija qué campos pueden recuperarse, su precedencia y sus estados de disponibilidad.
- `github-pr-explorer`: cambia la proyección y presentación de la tarjeta para consumir evidencia persistida localmente, sin llamadas GitHub desde el cliente.
- `study-management`: exige compatibilidad con el run promovido, preservación del baseline y aislamiento de la información privada al servir `CardV2`.

## Impact

- Afecta `util/github-pr-normalizer.js`, `util/github-pr-client.js`, `util/study-card-projection.js`, la persistencia de snapshots y la vista `views/partials/instance/data.ejs`.
- Requiere pruebas de contrato, proyección, renderizado, privacidad, cobertura de 300 tarjetas y estados de error/rate limit.
- Requiere una migración aditiva para el ledger y un marcador nullable de versión telemétrica en cada run. Los runs existentes conservarán `NULL`, no se retrocompletarán y no quedarán invalidados como evidencia de contenido por esa ausencia.
- El run completado `57e7fe7e-b503-4285-a734-dba40c9d2b42` deberá declarar `telemetry_status = NOT_INSTRUMENTED`, `event_count = 0` y conteos 403/429 desconocidos (`null`): esto demuestra ausencia de telemetría persistida, no ausencia de respuestas durante su ejecución.
