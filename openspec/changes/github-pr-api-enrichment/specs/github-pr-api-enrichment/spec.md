## Purpose

Capturar de forma autenticada y reproducible la evidencia GitHub necesaria para enriquecer las 300 tarjetas seleccionadas por CSV, manteniendo snapshots inmutables y decisiones privadas aisladas.

## ADDED Requirements

### Requirement: Credenciales y routing de mínimo privilegio
El enriquecimiento habilitado MUST usar una única credencial autenticada de solo lectura disponible únicamente para el proceso one-shot. La configuración SHALL declarar un único perfil neutral `default`; todos los repositorios normalizados `owner/name` de la muestra SHALL resolver ese perfil y MUST fallar antes de solicitar cualquier tarjeta si el perfil, su secreto o sus permisos no son válidos.

El perfil `default` MUST referenciar exactamente una fuente de secreto por variable de entorno o archivo montado. La validación MUST devolver códigos de error estables y sanitizados para perfil inválido, secreto ausente o permisos insuficientes, sin incluir valores de tokens ni headers. No habrá mapa de routing por repositorio ni soporte para múltiples tokens en este cambio. Las claves antiguas con formato `owner/repository`, perfiles adicionales o aliases ambiguos MUST fallar durante la validación de configuración.

El perfil `default` MUST proporcionar acceso read-only a metadata del repositorio, Pull Requests y contents; issues read-only será obligatorio cuando issue comments sea obligatorio y para intentar timeline. El sistema MAY persistir el nombre del perfil usado, pero MUST NOT persistir tokens, hashes de tokens ni headers `Authorization`.

#### Scenario: Repositorio correctamente enrutado
- **WHEN** una tarjeta identifica `owner/name` y su alias resuelve una credencial con permisos suficientes
- **THEN** todas sus páginas usan ese alias sin exponer el secreto al servidor web, navegador, HTML, fixtures o logs

#### Scenario: Token compartido por la muestra
- **WHEN** las tarjetas pertenecen a cualquiera de los repositorios de la muestra y el perfil `default` es válido
- **THEN** todas sus páginas usan la misma credencial read-only sin requerir un alias por repositorio

#### Scenario: Configuración de perfiles inconsistente
- **WHEN** falta el perfil `default`, se declara una clave `owner/repository`, se declara más de un perfil o la fuente del secreto es inválida
- **THEN** la configuración falla antes de realizar solicitudes GitHub

#### Scenario: Ruta o permiso insuficiente
- **WHEN** falta el alias, la credencial no existe o no permite leer un endpoint obligatorio
- **THEN** la tarjeta y el run terminan en fallo no promocionable con un código sanitizado

### Requirement: Completitud por endpoint
Para cada tarjeta, metadata de PR, commits, files, reviews, issue comments y review comments SHALL ser endpoints obligatorios. Timeline y diff completo SHALL ser opcionales. Un endpoint obligatorio solo estará completo después de recorrer todas sus páginas; cero resultados se registrará como `COMPLETE_EMPTY`.

Los estados terminales serán `COMPLETE`, `COMPLETE_EMPTY`, `UNAVAILABLE`, `TRUNCATED` y `FAILED`; `PARTIAL` solo podrá existir durante una ejecución y nunca será promocionable. `UNAVAILABLE` o `TRUNCATED` serán aceptables únicamente para endpoints opcionales o para campos documentadamente omitidos dentro de una respuesta completa. Autorización fallida, respuesta malformada, transporte agotado o paginación incompleta producirán `FAILED`.

#### Scenario: Evidencia obligatoria completa
- **WHEN** todos los endpoints obligatorios terminan todas sus páginas y los opcionales alcanzan un estado terminal permitido
- **THEN** la tarjeta puede formar parte de un run completado

#### Scenario: Página faltante
- **WHEN** cualquier página obligatoria falla o una cadena `Link` no se completa
- **THEN** el endpoint queda `FAILED`, la tarjeta no genera snapshot promocionable y el run global falla

#### Scenario: Diff truncado
- **WHEN** GitHub omite o limita el diff o un patch por tamaño
- **THEN** el snapshot registra `TRUNCATED`, conserva la evidencia disponible y nunca presenta el contenido como completo

### Requirement: Validadores y checksums por endpoint y página
El sistema MUST almacenar para cada endpoint y página un fingerprint de solicitud sin secretos, versión API, `Accept`, ordinal o cursor, ETag exacto cuando exista, estado HTTP, checksum de respuesta, checksum normalizado, conteo de elementos y referencia a la página siguiente.

Una solicitud condicional MAY reutilizar una página solo cuando un `304` corresponde al mismo repositorio, PR, endpoint, fingerprint, versión API, `Accept` y página de un run `COMPLETED`. La página reutilizada conserva sus checksums y referencia de paginación. Un `304` nunca autoriza reutilizar otros endpoints, páginas ni el snapshot compuesto.

El checksum del snapshot SHALL ser SHA-256 sobre un manifiesto canónico ordenado por endpoint y página, incluyendo estado, checksums normalizados y versión del normalizador. El checksum del run SHALL usar los 300 snapshots en orden `study_card.ordinal`.

#### Scenario: 304 de una página
- **WHEN** GitHub responde `304` para una página con baseline exacto en un run completado
- **THEN** solo esa página reutiliza payload normalizado, checksums y enlace siguiente del baseline y las demás páginas se validan independientemente

#### Scenario: 304 sin baseline compatible
- **WHEN** llega `304` sin una página exacta compatible
- **THEN** el endpoint falla por protocolo y no reutiliza un snapshot compuesto

### Requirement: Run inmutable y promoción atómica
Cada ejecución SHALL crear un `enrichment_run` ligado a un solo `study_id`, checksum CSV, versión de normalizador y fingerprint no secreto de configuración. Sus estados serán `RUNNING`, `COMPLETED` o `FAILED`; después de `COMPLETED` o `FAILED` el run, sus páginas, manifests y snapshots serán inmutables.

Un run solo podrá pasar a `COMPLETED` cuando las 300 membresías tengan snapshot promocionable y el manifest coincida con sus ordinales. La promoción del estudio será una inserción única y transaccional; no se expondrá ninguna página o snapshot de runs `RUNNING` o `FAILED`.

#### Scenario: Lote completo
- **WHEN** las 300 tarjetas cumplen completitud y persisten sus manifests
- **THEN** el run se completa y puede promocionarse en una sola transacción

#### Scenario: Fallo de una tarjeta
- **WHEN** una tarjeta no alcanza un estado promocionable
- **THEN** el run queda `FAILED`, no cambia la promoción vigente y ninguna evidencia parcial aparece en clasificación

#### Scenario: Captura equivalente
- **WHEN** el snapshot canónico coincide con uno ya persistido
- **THEN** el run referencia el snapshot existente por checksum sin duplicar su contenido normalizado

### Requirement: Presupuesto determinista de solicitudes
La concurrencia por defecto SHALL ser 4 y MUST permanecer entre 1 y 8. Cada solicitud tendrá timeout de 30 segundos y como máximo cuatro intentos totales. Solo serán reintentables timeouts, errores de transporte, `429`, `502`, `503`, `504` y `403` identificado por headers como rate limit.

El proceso SHALL respetar `Retry-After` o el reset informado únicamente dentro de un máximo acumulado de cinco minutos por página y treinta minutos por run. Si la espera requerida supera el presupuesto restante, la página fallará. `401`, autorización `403`, `404`, respuestas malformadas y errores de identidad serán terminales sin retry.

#### Scenario: Retry dentro del presupuesto
- **WHEN** una respuesta reintentable indica una espera dentro del presupuesto
- **THEN** el proceso espera, descuenta el presupuesto y no excede cuatro intentos

#### Scenario: Presupuesto agotado
- **WHEN** se agotan intentos o tiempo acumulado
- **THEN** la página y el run fallan de forma determinista sin loop ni promoción parcial

### Requirement: Retención de payload privado
El sistema MUST normalizar respuestas GitHub en memoria y MUST NOT persistir ni registrar bodies crudos de éxito o error. Persistirá únicamente el payload normalizado requerido por la tarjeta, checksums, ETags, estados, conteos y metadatos sanitizados. El `raw_payload` existente seguirá siendo exclusivamente la fila CSV.

El contenido GitHub normalizado, incluido contenido privado, se conservará de forma inmutable durante la vida del estudio y solo será legible mediante consultas del estudio promovido. Este cambio no implementará purga automática ni exposición JSON cruda.

#### Scenario: Respuesta privada
- **WHEN** GitHub devuelve contenido de un repositorio privado
- **THEN** el body crudo se descarta tras normalización y solo persiste la proyección normalizada autorizada

#### Scenario: Error con body sensible
- **WHEN** GitHub devuelve un error con texto o headers potencialmente sensibles
- **THEN** se conserva únicamente código, clasificación sanitizada y request ID no secreto

### Requirement: Aislamiento de baseline y decisiones
La captura MUST NOT insertar, actualizar ni borrar `pr_cards`, `study_card`, `participant_category`, `pr_classification` o `pr_discard`. Cada decisión SHALL referenciar el mismo `study_id`, una tarjeta de su membresía, un participante de ese estudio y el run promovido, o run nulo en modo CSV-only.

#### Scenario: Nueva captura posterior
- **WHEN** se completa otro run para una PR ya usada
- **THEN** el nuevo run queda versionado pero no cambia la evidencia, clasificación, descarte ni promoción del estudio existente
