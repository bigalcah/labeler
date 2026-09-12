## Why

El MVP necesita conservar el estudio actual de 300 PR y permitir una validación reproducible de 30 PR sin mezclar participantes, tarjetas ni resultados. El flujo debe mantener la frontera entre preparación y clasificación, proteger el trabajo existente y producir un paquete offline completo cuando todos los participantes hayan terminado.

## What Changes

- Definir perfiles de estudio con `studyKey`, `expectedCardCount` y `participants`, admitiendo únicamente los conteos 30 y 300. El estudio actual conserva tres participantes y 300 tarjetas.
- Seleccionar de forma determinista una fixture de validación de 30 tarjetas desde el CSV canónico de 300, con seis tarjetas para cada agente `Copilot`, `Devin`, `OpenAI_Codex`, `Cursor` y `Claude_Code`.
- Persistir estudios, participantes y membresías con conteo esperado por estudio, permitiendo dos filas distintas en estado `READY` al mismo tiempo en una base PostgreSQL.
- Ejecutar una preparación secuencial y bloqueada para varios perfiles, después de validar todos sus insumos y antes de que la aplicación y Caddy puedan quedar listos.
- Mantener las claves visibles `javier`, `diego` y `pablo`; conservar los usernames actuales `javier`, `diego`, `pablo` y usar `javier-30`, `diego-30`, `pablo-30` para la validación. El estudio autorizado será siempre el `study_id` persistido en la cuenta y la sesión.
- Validar todo el CSV seleccionado antes de escribir y conservar checksum de fuente, membresía y filas sin sobrescribir tarjetas clasificadas.
- Permitir enriquecimiento GitHub opcional, por estudio y solo durante la preparación, usando el conteo persistido de 30 o 300. La selección no hará captura live ni llamadas desde el navegador.
- Mantener cuentas locales preprovisionadas con hashes Argon2id, sesiones opacas PostgreSQL, expiración, revocación, CSRF y categorías privadas. No habrá autorregistro ni MFA.
- Añadir una exportación offline solo para operadores, condicionada a la finalización de todos los participantes, con `results.csv`, `categories.csv` y `manifest.json` reproducibles y sin secretos ni payloads crudos.
- Publicar únicamente mediante Caddy en los puertos 80 y 443. La aplicación y PostgreSQL permanecerán en la red interna.
- Documentar la retirada escalonada del flujo legacy sin eliminar sus objetos en este cambio.

## Capabilities

### New Capabilities

- No existen capacidades completamente nuevas.

### Modified Capabilities

- `github-pr-ingestion`: validación completa, fixture determinista, importación conflict-safe y enriquecimiento opcional por estudio desde CSV.
- `github-pr-explorer`: visualización local de la tarjeta de PR y evidencia disponible en el CSV, sin llamadas del navegador.
- `study-management`: perfiles persistidos de 30 o 300 tarjetas, preparación secuencial, cuentas por estudio, sesiones autoritativas y gate de exportación.
- `private-open-card-sorting`: cola privada según el conteo persistido y exportación offline completa protegida por el gate de finalización.

## Impact

- Se añadirá una migración posterior a `010_study_scoped_participant_categories` para permitir únicamente 30 y 300, retirar la restricción de un solo `READY` y preservar el estudio actual y sus datos.
- El bootstrap será dueño de la carga de participantes, tarjetas y membresía. Una preparación de perfiles validará todos los insumos, procesará primero el perfil actual de 300 y después el de validación de 30, y no expondrá sus manifiestos al servidor web.
- El acceso usará cuentas locales preprovisionadas con usernames distintos por estudio, sesiones opacas server-side con expiración por inactividad de ocho horas y expiración absoluta de 24 horas, identidad derivada solo de sesiones validadas y CSRF para mutaciones.
- La muestra actual de 300 y la fixture de validación de 30 serán las únicas cardinalidades admitidas. Los tres participantes verán la misma membresía dentro de cada estudio y sus categorías, decisiones y descartes seguirán siendo privadas.
- El exportador operator-only leerá un estudio específico en modo offline y generará resultados, nombres de categorías, observaciones de clasificación, motivos de descarte, URLs, pseudónimos, procedencia y checksums. No añadirá una ruta HTTP ni restaurará el JSONL legacy.
- El retiro legacy será por etapas: primero aislar rutas y consultas nuevas, después migrar o retirar consumidores, y solo al final retirar objetos cuando no existan dependencias.
