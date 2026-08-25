# API JavaScript

## Alcance y estado

La existencia y ubicación de símbolos es `VERIFIED` estáticamente; su funcionamiento completo es
`IMPLEMENTED-UNVERIFIED`. Esta referencia cubre `util/**/*.js`, `scripts/**/*.js` y `routes/**/*.js`.

Cada fila representa un módulo y sus símbolos relevantes. Una entrada completa incluye ubicación, parámetros, retorno,
errores, efectos secundarios, dependencias y estado. Callbacks triviales, closures locales y helpers obvios sin
consumidores externos se excluyen con razón explícita.

## Ledger

| Módulo | Símbolos y contratos relevantes | Exclusiones explícitas | Estado |
| --- | --- | --- | --- |
| `util/csv-pr-provider.js` | `readPullRequestCards(filePath, options)`; lee, valida y hashea CSV | callbacks de parser y duplicados locales | IMPLEMENTED-UNVERIFIED |
| `util/github-pr-client.js` | `createGithubClient`; `fetchEndpoint`; `fetchPullRequest`; `ENDPOINTS`; `TERMINAL_STATES`; `parseLinkHeader`; `requestPage` | headers/retry/worker locales | IMPLEMENTED-UNVERIFIED |
| `util/github-pr-config.js` | `DEFAULT_GITHUB_CONFIG`; `GithubConfigError`; `normalizeRepository`; `readGithubConfig`; `resolveCredential`; `validateGithubConfig` | `assertInteger` y normalización interna de alias | IMPLEMENTED-UNVERIFIED |
| `util/github-pr-errors.js` | `GithubRequestError` | ninguna | IMPLEMENTED-UNVERIFIED |
| `util/github-pr-manifest.js` | `buildRunManifest`; `buildSnapshotManifest`; `canonicalize`; `checksum`; `checksumRaw`; `checksumRunManifest`; `checksumSnapshotManifest`; `isExactPageValidatorMatch` | mappers privados de páginas | IMPLEMENTED-UNVERIFIED |
| `util/github-pr-normalizer.js` | `normalizeResponse(endpoint, value)` | `pick` y `normalizeItem` internos | IMPLEMENTED-UNVERIFIED |
| `util/github-pr-persistence-validation.js` | `GithubPersistenceError`; `assertExactCards`; `assertStudyMapping`; `assertRunCards` | ninguna | IMPLEMENTED-UNVERIFIED |
| `util/github-pr-persistence.js` | `EXPECTED_CARD_COUNT`; `REQUIRED_ENDPOINTS`; `GithubPersistenceError`; `assertExactCards`; `createRunningRun`; `finalizeRun`; `markRunFailed`; `promoteRun`; `recordRunCard`; `stagePage`; `upsertSnapshot`; `assertNormalizedPage`; `loadRun`; `loadManifestRows`; `loadStudyCards`; `assertRequiredPages` | SQL helpers sin consumidor externo distinto de estos coordinadores | IMPLEMENTED-UNVERIFIED |
| `util/legacy-backup.js` | `LegacyBackupError`; `createLegacyBackup`; `resolveBackupInputs`; `runCommand`; `verifyLegacyBackup` | hashing, paths y streams internos | IMPLEMENTED-UNVERIFIED |
| `util/legacy-inventory.js` | `LegacyInventoryError`; `computeInventoryHash`; `readLegacyInventory`; `validateLegacyInventory` | canonicalización interna | IMPLEMENTED-UNVERIFIED |
| `util/legacy-retirement.js` | `LegacyRetirementError`; `assessRetirementState`; `checkRetirementReadiness`; `guardRetirementDatabase` | `inspectObjects` y `readMigrationState`, documentados dentro del flujo | IMPLEMENTED-UNVERIFIED |
| `util/pg-pool.js` | default `pg.Pool` | configuración de importación | IMPLEMENTED-UNVERIFIED |
| `util/http-status.js` | default `HTTPStatus` | ninguna | VERIFIED (static) |
| `util/pr-card-checksum.js` | `canonicalCardContent`; `computeCardChecksum` | `normalizeJson` interno | IMPLEMENTED-UNVERIFIED |
| `util/pr-card-persistence.js` | `CardContentConflictError`; `assertCompatibleCard`; `persistCards` | select/insert internos | IMPLEMENTED-UNVERIFIED |
| `util/pr-card.js` | `buildPullRequestCard` | parsers internos | IMPLEMENTED-UNVERIFIED |
| `util/safe-markdown.js` | `renderSafeMarkdown(value)` | opciones constantes del sanitizer | IMPLEMENTED-UNVERIFIED |
| `util/study-bootstrap.js` | `StudyBootstrapConflictError`; `assertBootstrapCards`; `assertStudySchemaReady`; `bootstrapStudy`; `findOrCreateStudy`; `assertMembership`; `persistParticipants`; `persistStudyCards` | callbacks SQL triviales | IMPLEMENTED-UNVERIFIED |
| `util/study-card-projection.js` | `projectEnrichedCard(card, enrichmentInput)` | provenance/payload helpers | IMPLEMENTED-UNVERIFIED |
| `util/study-config.js` | `DEFAULT_STUDY_CONFIG`; `EXPECTED_CARD_COUNT`; `StudyConfigError`; `parseStudyConfig`; `readStudyConfig`; `resolveAuthoritativeStudyConfig` | `validateIdentifier` interno | IMPLEMENTED-UNVERIFIED |
| `util/study-github-enrichment.js` | `NORMALIZER_VERSION`; `assertCardSources`; `assertEndpointResults`; `enrichStudyWithGithub`; `loadStudyCardSources`; `persistCardEnrichment` | mappers de páginas triviales | IMPLEMENTED-UNVERIFIED |
| `util/study-mutation.js` | `assertParticipantCategory`; `lockStudyCard`; `normalizeDiscardReason`; `normalizeRemarks`; `parseExpectedRevision`; `readLockedCardState` | ninguna | IMPLEMENTED-UNVERIFIED |
| `util/study-runtime.js` | `StudyRuntimeError`; `addCardDates`; `findFirstPendingCard`; `findNextPendingCard`; `isUuid`; `loadParticipantCategories`; `loadStudyCard`; `loadStudyProgress`; `respondWithStudyRuntimeError`; `resolveReadyStudy`; `resolveStudyParticipant` | `cardSelect` y parsing internos | IMPLEMENTED-UNVERIFIED |
| `util/study-schema.js` | `assertLedgerState`; `knownExternalMigrationIds`; `managedMigrations`; `parseThrough`; `runStudyMigrations`; `readLedger` | advisory-lock key interna | IMPLEMENTED-UNVERIFIED |
| `util/transaction.js` | `withTransaction` | callbacks de transacción | IMPLEMENTED-UNVERIFIED |
| `scripts/backup-legacy-labeler.js` | entrypoint `main`/argumentos de backup legacy | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `scripts/bootstrap-study.js` | entrypoint `main`/argumentos de bootstrap | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `scripts/enrich-study.js` | entrypoint `main`/argumentos de enriquecimiento | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `scripts/import-pr-csv.js` | entrypoint y `persistCardsTransaction` | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `scripts/migrate-study-schema.js` | entrypoint y argumentos `--through` | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `scripts/retire-legacy-labeler.js` | entrypoint y routing de acciones | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `routes/index.js` | handler `get` de portada | callbacks del router | IMPLEMENTED-UNVERIFIED |
| `routes/[...catchall].js` | handler `get` de fallback | callbacks del router | IMPLEMENTED-UNVERIFIED |
| `routes/login/index.js` | handlers `get` y `post` | parsing local | IMPLEMENTED-UNVERIFIED |
| `routes/[name]/categories/index.js` | handler `post` | `normalize` local | IMPLEMENTED-UNVERIFIED |
| `routes/[name]/queue/index.js` | handler `get` | navegación local | IMPLEMENTED-UNVERIFIED |
| `routes/[name]/queue/[id]/index.js` | handler `get` | navegación local | IMPLEMENTED-UNVERIFIED |
| `routes/[name]/queue/[id]/classify/index.js` | handler `post`; reexport `isUuid` | `continuationPath` local | IMPLEMENTED-UNVERIFIED |
| `routes/[name]/queue/[id]/discard/index.js` | handler `post` | `continuationPath` local | IMPLEMENTED-UNVERIFIED |
| `routes/instances/index.js` | handler `get` | paginación local | IMPLEMENTED-UNVERIFIED |
| `routes/instances/[id]/index.js` | handler `get` | parsing local | IMPLEMENTED-UNVERIFIED |
| `routes/progress/index.js` | handler `get` | `withPercentage` local | IMPLEMENTED-UNVERIFIED |
| `util/github-pr-client.js` | reexports `GithubRequestError`, `buildRunManifest`, `buildSnapshotManifest`, `canonicalize`, `checksum`, `checksumRunManifest`, `checksumSnapshotManifest`, `isExactPageValidatorMatch` | ninguna | IMPLEMENTED-UNVERIFIED |
| `util/github-pr-config.js` | callable público `resolveCredential(...).getToken()` | ninguna | IMPLEMENTED-UNVERIFIED |
| Error classes del ledger | constructores `(code/message/details)` y sus propiedades de error | ninguna | IMPLEMENTED-UNVERIFIED |

## Contratos individuales prioritarios

Las filas siguientes detallan los símbolos que coordinan entradas externas, persistencia, enriquecimiento y navegación.
Los helpers locales sin consumidores externos permanecen excluidos en el ledger anterior con una razón explícita.

| Símbolo | Entrada | Retorno | Errores | Efectos y dependencias | Estado |
| --- | --- | --- | --- | --- | --- |
| `readPullRequestCards(filePath, options)` | ruta de CSV y opciones de importación | tarjetas normalizadas con checksum | error de lectura, CSV inválido o duplicado | lee el archivo y usa validación/hash de tarjetas | IMPLEMENTED-UNVERIFIED |
| `createGithubClient(config)` | configuración GitHub normalizada | cliente con operaciones de endpoint | `GithubRequestError` y errores de configuración | construye solicitudes autenticadas; usado por enriquecimiento | IMPLEMENTED-UNVERIFIED |
| `fetchEndpoint(client, endpoint, options)` | cliente, endpoint y paginación | página normalizada | errores HTTP, rate limit o payload inválido | realiza I/O HTTP contra GitHub | IMPLEMENTED-UNVERIFIED |
| `fetchPullRequest(client, repository, number)` | cliente, repositorio y número PR | snapshot de pull request | `GithubRequestError` | solicita datos de una PR | IMPLEMENTED-UNVERIFIED |
| `parseLinkHeader(value)` | header HTTP `Link` | enlaces de paginación | ninguna para header ausente; formato no reconocido se omite | función pura | VERIFIED (static) |
| `requestPage(client, endpoint, page)` | cliente, endpoint y página | resultado de página | errores HTTP y validación de respuesta | delega en el cliente GitHub | IMPLEMENTED-UNVERIFIED |
| `normalizeResponse(endpoint, value)` | endpoint y payload externo | objeto normalizado por endpoint | payload incompatible | función pura; alimenta persistencia | IMPLEMENTED-UNVERIFIED |
| `buildRunManifest(input)` | configuración de ejecución y páginas | manifiesto canónico de ejecución | datos requeridos ausentes | canoniza contenido y calcula checksum | IMPLEMENTED-UNVERIFIED |
| `buildSnapshotManifest(input)` | snapshots normalizados | manifiesto canónico de snapshots | snapshot incompleto | función pura; usa `canonicalize` y checksum | IMPLEMENTED-UNVERIFIED |
| `canonicalize(value)` | objeto serializable | representación canónica | tipos no serializables | función pura usada por checksums | VERIFIED (static) |
| `checksum(value)` | valor serializable | digest | error de serialización | función pura de integridad | VERIFIED (static) |
| `checksumRaw(value)` | bytes o texto | digest | entrada no soportada | función pura de integridad | VERIFIED (static) |
| `persistCards(cards, options)` | tarjetas y contexto de persistencia | resultado de persistencia | conflicto de contenido o error SQL | escribe tarjetas mediante pool/transacción | IMPLEMENTED-UNVERIFIED |
| `assertCompatibleCard(existing, incoming)` | tarjetas existente y entrante | `undefined` si son compatibles | `CardContentConflictError` | función de validación antes de insertar | VERIFIED (static) |
| `bootstrapStudy(pool, config)` | pool y configuración autoritativa | estudio inicializado | `StudyBootstrapConflictError` o error SQL | crea/reutiliza participantes y tarjetas; usa transacción | IMPLEMENTED-UNVERIFIED |
| `findOrCreateStudy(client, config)` | cliente y configuración | estudio | error SQL | consulta o crea la instancia del estudio | IMPLEMENTED-UNVERIFIED |
| `persistParticipants(client, participants)` | cliente y participantes | participantes persistidos | conflicto o error SQL | inserta/reutiliza reviewers | IMPLEMENTED-UNVERIFIED |
| `persistStudyCards(client, studyId, cards)` | cliente, estudio y tarjetas | tarjetas vinculadas | conflicto o error SQL | persiste membresía de estudio | IMPLEMENTED-UNVERIFIED |
| `enrichStudyWithGithub(pool, config)` | pool y configuración de enriquecimiento | ejecución finalizada | configuración, HTTP, validación o persistencia | coordina cliente GitHub, normalización y snapshots | IMPLEMENTED-UNVERIFIED |
| `loadStudyCardSources(client, studyId)` | cliente y estudio | fuentes de tarjetas | error SQL | lee el conjunto autorizado para enriquecer | IMPLEMENTED-UNVERIFIED |
| `persistCardEnrichment(client, cardId, enrichment)` | cliente, tarjeta y enriquecimiento | `undefined` | error de integridad o SQL | escribe snapshot/provenance | IMPLEMENTED-UNVERIFIED |
| `runStudyMigrations(pool, through)` | pool y migración opcional | IDs aplicados en orden | ledger desconocido, orden inválido o SQL | toma advisory lock y aplica SQL pendiente | IMPLEMENTED-UNVERIFIED |
| `readLedger(client)` | cliente PostgreSQL | IDs de migración ordenados | propaga errores salvo tabla ausente | consulta `labeler_migration` | IMPLEMENTED-UNVERIFIED |
| `assertLedgerState(ledgerIds)` | lista de IDs | `undefined` | error por ID desconocido u orden inválido | función pura de precondición de migraciones | VERIFIED (static) |
| `parseThrough(argumentsList)` | argumentos CLI | ID objetivo o `undefined` | argumentos repetidos, faltantes o inesperados | función pura usada por migración CLI | VERIFIED (static) |
| `withTransaction(pool, operation)` | pool y callback transaccional | resultado del callback | propaga error y revierte | controla BEGIN/COMMIT/ROLLBACK | IMPLEMENTED-UNVERIFIED |
| `main()` en `scripts/backup-legacy-labeler.js` | argumentos de backup | proceso completado | backup inválido o comando fallido | crea y verifica backup fuera del repositorio | IMPLEMENTED-UNVERIFIED |
| `main()` en `scripts/bootstrap-study.js` | configuración de estudio | proceso completado | configuración o bootstrap inválido | inicia bootstrap protegido | IMPLEMENTED-UNVERIFIED |
| `main()` en `scripts/enrich-study.js` | configuración GitHub y estudio | proceso completado | configuración, HTTP o persistencia | ejecuta enriquecimiento prepare-only | IMPLEMENTED-UNVERIFIED |
| `main()` en `scripts/import-pr-csv.js` | ruta CSV y salida opcional | proceso completado | CSV inválido o SQL | importa tarjetas mediante transacción | IMPLEMENTED-UNVERIFIED |
| `main()` en `scripts/migrate-study-schema.js` | `--through` opcional | proceso completado | argumentos o migración inválida | ejecuta migraciones con pool compartido | IMPLEMENTED-UNVERIFIED |
| `main()` en `scripts/retire-legacy-labeler.js` | acción y rutas de backup | proceso completado | confirmación, backup o inventario inválido | ejecuta retiro protegido, nunca implícito | IMPLEMENTED-UNVERIFIED |
| `get` en `routes/login/index.js` | request HTTP | vista de login | error de consulta/renderizado | lee participantes disponibles | IMPLEMENTED-UNVERIFIED |
| `post` en `routes/login/index.js` | `reviewer_id` enviado por cliente | redirección o error HTTP | participante inexistente o error SQL | comportamiento legacy; no es autenticación | LEGACY / IMPLEMENTED-UNVERIFIED |
| `post` en `routes/[name]/categories/index.js` | nombre, participante y categoría | redirección | participante/categoría inválidos | guarda categoría privada del participante | IMPLEMENTED-UNVERIFIED |
| `get` en `routes/[name]/queue/index.js` | nombre y participante | vista de cola | estudio no listo o error SQL | carga progreso y siguiente tarjeta | IMPLEMENTED-UNVERIFIED |
| `get` en `routes/[name]/queue/[id]/index.js` | nombre, participante y tarjeta | vista de tarjeta | tarjeta no disponible o error SQL | carga estado privado y acciones | IMPLEMENTED-UNVERIFIED |
| `post` en `routes/[name]/queue/[id]/classify/index.js` | categoría, remarks y revisión esperada | redirección | revisión obsoleta o entrada inválida | clasifica una tarjeta y actualiza revisión | IMPLEMENTED-UNVERIFIED |
| `post` en `routes/[name]/queue/[id]/discard/index.js` | razón, remarks y revisión esperada | redirección | revisión obsoleta o razón inválida | retira una tarjeta para ese participante | IMPLEMENTED-UNVERIFIED |
| `get` en `routes/instances/index.js` | paginación HTTP | lista renderizada | error SQL | enumera instancias legacy/estudio según ruta | LEGACY / IMPLEMENTED-UNVERIFIED |
| `get` en `routes/instances/[id]/index.js` | ID de instancia | vista renderizada | instancia inexistente o error SQL | carga detalle de instancia | LEGACY / IMPLEMENTED-UNVERIFIED |
| `get` en `routes/progress/index.js` | contexto de participante | progreso renderizado | estudio no listo o error SQL | calcula progreso privado | IMPLEMENTED-UNVERIFIED |

### Inventario complementario

| Símbolo | Módulo | Contrato resumido | Estado |
| --- | --- | --- | --- |
| `normalizeRepository` | `util/github-pr-config.js` | normaliza `owner/name`; lanza `GithubConfigError`; función pura | VERIFIED (static) |
| `validateGithubConfig` | `util/github-pr-config.js` | valida configuración GitHub; devuelve configuración; lanza `GithubConfigError` | VERIFIED (static) |
| `readGithubConfig` | `util/github-pr-config.js` | lee entorno y aliases; devuelve configuración; lanza error de configuración; no escribe | IMPLEMENTED-UNVERIFIED |
| `resolveCredential` | `util/github-pr-config.js` | resuelve token por repositorio; devuelve callable `getToken`; lanza error de configuración o secreto | IMPLEMENTED-UNVERIFIED |
| `assertExactCards` | `util/github-pr-persistence-validation.js` | valida exactamente 300 tarjetas; devuelve `undefined`; lanza `GithubPersistenceError` | VERIFIED (static) |
| `assertStudyMapping` | `util/github-pr-persistence-validation.js` | valida correspondencia estudio/ejecución; devuelve `undefined`; lanza `GithubPersistenceError` | VERIFIED (static) |
| `assertRunCards` | `util/github-pr-persistence-validation.js` | valida tarjetas de ejecución; devuelve `undefined`; lanza `GithubPersistenceError` | VERIFIED (static) |
| `createRunningRun` | `util/github-pr-persistence.js` | crea ejecución `RUNNING`; devuelve fila/ID; lanza SQL; escribe en PostgreSQL | IMPLEMENTED-UNVERIFIED |
| `stagePage` | `util/github-pr-persistence.js` | persiste página normalizada; devuelve resultado; lanza SQL/integridad | IMPLEMENTED-UNVERIFIED |
| `upsertSnapshot` | `util/github-pr-persistence.js` | inserta o actualiza snapshot; devuelve resultado; lanza SQL/integridad | IMPLEMENTED-UNVERIFIED |
| `recordRunCard` | `util/github-pr-persistence.js` | asocia tarjeta con ejecución; devuelve resultado; lanza SQL | IMPLEMENTED-UNVERIFIED |
| `loadRun` | `util/github-pr-persistence.js` | carga ejecución por ID, opcionalmente bloqueada; devuelve fila; lanza SQL | IMPLEMENTED-UNVERIFIED |
| `loadManifestRows` | `util/github-pr-persistence.js` | carga filas de manifiesto; devuelve filas; lanza SQL | IMPLEMENTED-UNVERIFIED |
| `loadStudyCards` | `util/github-pr-persistence.js` | carga tarjetas del estudio; devuelve tarjetas; lanza SQL | IMPLEMENTED-UNVERIFIED |
| `assertRequiredPages` | `util/github-pr-persistence.js` | exige endpoints/páginas requeridos; devuelve `undefined`; lanza `GithubPersistenceError` | VERIFIED (static) |
| `finalizeRun` | `util/github-pr-persistence.js` | finaliza ejecución validada; devuelve resultado; lanza SQL/validación | IMPLEMENTED-UNVERIFIED |
| `markRunFailed` | `util/github-pr-persistence.js` | marca ejecución fallida dentro de transacción; devuelve resultado; lanza SQL | IMPLEMENTED-UNVERIFIED |
| `promoteRun` | `util/github-pr-persistence.js` | promueve ejecución completa; devuelve resultado; lanza SQL/validación | IMPLEMENTED-UNVERIFIED |
| `isUuid` | `util/study-runtime.js` | valida UUID; devuelve booleano; no tiene efectos secundarios | VERIFIED (static) |
| `resolveReadyStudy` | `util/study-runtime.js` | busca estudio listo; devuelve estudio; lanza `StudyRuntimeError` o SQL | IMPLEMENTED-UNVERIFIED |
| `resolveStudyParticipant` | `util/study-runtime.js` | resuelve participante por nombre; devuelve participante; lanza `StudyRuntimeError` o SQL | IMPLEMENTED-UNVERIFIED |
| `loadParticipantCategories` | `util/study-runtime.js` | carga categorías privadas; devuelve lista; lanza SQL | IMPLEMENTED-UNVERIFIED |
| `loadStudyProgress` | `util/study-runtime.js` | carga progreso por participante; devuelve métricas; lanza SQL | IMPLEMENTED-UNVERIFIED |
| `loadStudyCard` | `util/study-runtime.js` | carga tarjeta y estado privado; devuelve tarjeta; lanza SQL/`StudyRuntimeError` | IMPLEMENTED-UNVERIFIED |
| `findFirstPendingCard` | `util/study-runtime.js` | busca primera tarjeta pendiente; devuelve tarjeta o ausencia; lanza SQL | IMPLEMENTED-UNVERIFIED |
| `findNextPendingCard` | `util/study-runtime.js` | busca siguiente tarjeta desde ordinal; devuelve tarjeta o ausencia; lanza SQL | IMPLEMENTED-UNVERIFIED |
| `parseExpectedRevision` | `util/study-mutation.js` | valida revisión esperada; devuelve entero; lanza error de entrada | VERIFIED (static) |
| `normalizeDiscardReason` | `util/study-mutation.js` | normaliza razón de retiro; devuelve valor canónico; lanza error de entrada | VERIFIED (static) |
| `normalizeRemarks` | `util/study-mutation.js` | normaliza observaciones; devuelve texto o ausencia; función pura | VERIFIED (static) |
| `lockStudyCard` | `util/study-mutation.js` | bloquea tarjeta para mutación; devuelve estado; lanza SQL | IMPLEMENTED-UNVERIFIED |
| `readLockedCardState` | `util/study-mutation.js` | lee estado bloqueado; devuelve estado; lanza SQL | IMPLEMENTED-UNVERIFIED |
| `assertParticipantCategory` | `util/study-mutation.js` | verifica categoría privada; devuelve `undefined`; lanza error de autorización/SQL | IMPLEMENTED-UNVERIFIED |
| `computeInventoryHash` | `util/legacy-inventory.js` | calcula hash de inventario; devuelve digest; función pura | VERIFIED (static) |
| `readLegacyInventory` | `util/legacy-inventory.js` | lee inventario JSON; devuelve documento; lanza I/O/validación | IMPLEMENTED-UNVERIFIED |
| `validateLegacyInventory` | `util/legacy-inventory.js` | valida documento de inventario; devuelve `undefined`; lanza `LegacyInventoryError` | VERIFIED (static) |
| `assessRetirementState` | `util/legacy-retirement.js` | evalúa objetos y migración; devuelve diagnóstico; lanza `LegacyRetirementError` | VERIFIED (static) |
| `checkRetirementReadiness` | `util/legacy-retirement.js` | verifica backup/inventario/DB; devuelve diagnóstico; lanza `LegacyRetirementError` | IMPLEMENTED-UNVERIFIED |
| `guardRetirementDatabase` | `util/legacy-retirement.js` | bloquea retiro inseguro; devuelve `undefined`; lanza `LegacyRetirementError` | IMPLEMENTED-UNVERIFIED |
| `resolveBackupInputs` | `util/legacy-backup.js` | resuelve rutas externas; devuelve entradas de backup; lanza `LegacyBackupError` | VERIFIED (static) |
| `runCommand` | `util/legacy-backup.js` | ejecuta comando de backup; devuelve promesa de resultado; lanza error de proceso | IMPLEMENTED-UNVERIFIED |
| `verifyLegacyBackup` | `util/legacy-backup.js` | verifica archivo, manifest e identidad; devuelve diagnóstico; lanza `LegacyBackupError` | IMPLEMENTED-UNVERIFIED |
| `createLegacyBackup` | `util/legacy-backup.js` | crea dump y manifest externos; devuelve diagnóstico; lanza `LegacyBackupError` | IMPLEMENTED-UNVERIFIED |
| `canonicalCardContent` | `util/pr-card-checksum.js` | proyecta campos canónicos de tarjeta; devuelve objeto; función pura | VERIFIED (static) |
| `computeCardChecksum` | `util/pr-card-checksum.js` | calcula SHA-256 de tarjeta; devuelve digest; función pura | VERIFIED (static) |
| `buildPullRequestCard` | `util/pr-card.js` | convierte fila CSV en tarjeta; devuelve tarjeta; lanza error de parsing | VERIFIED (static) |
| `parseStudyConfig` | `util/study-config.js` | parsea configuración de estudio; devuelve configuración; lanza `StudyConfigError` | VERIFIED (static) |
| `readStudyConfig` | `util/study-config.js` | lee configuración desde entrada; devuelve configuración; lanza I/O/`StudyConfigError` | IMPLEMENTED-UNVERIFIED |
| `resolveAuthoritativeStudyConfig` | `util/study-config.js` | resuelve configuración solicitada frente a persistida; devuelve configuración; lanza conflicto | VERIFIED (static) |
| `assertBootstrapCards` | `util/study-bootstrap.js` | exige 300 tarjetas; devuelve `undefined`; lanza `StudyBootstrapConflictError` | VERIFIED (static) |
| `assertStudySchemaReady` | `util/study-bootstrap.js` | verifica esquema de estudio; devuelve promesa; lanza error SQL/esquema | IMPLEMENTED-UNVERIFIED |
| `get` | `routes/index.js` | request sin parámetros; renderiza portada; error de renderizado; solo respuesta HTTP | IMPLEMENTED-UNVERIFIED |
| `get` | `routes/[...catchall].js` | request no resuelto; renderiza fallback/error; error de renderizado; solo respuesta HTTP | IMPLEMENTED-UNVERIFIED |

## Regla de actualización

Repite el ledger cuando cambien exports, handlers, clases, métodos, factories, entrypoints o coordinadores. Toda nueva
exclusión debe explicar por qué no tiene consumidores externos. No añadas JSDoc ni cambies código para completar esta
referencia.
