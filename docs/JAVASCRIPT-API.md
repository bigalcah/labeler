# API JavaScript

## Alcance y estado

La existencia y ubicación de símbolos es `VERIFIED` estáticamente; el funcionamiento que depende de
PostgreSQL, sesiones o servicios externos es `IMPLEMENTED-UNVERIFIED` hasta conservar evidencia
aprobada. La implementación central del flujo multiestudio y su E2E hostil aislado están
completados. Esta referencia cubre `util/**/*.js`, `scripts/**/*.js` y `routes/**/*.js`.

Cada fila representa un módulo y sus símbolos relevantes. Una entrada completa incluye ubicación, parámetros, retorno,
errores, efectos secundarios, dependencias y estado. Callbacks triviales, closures locales y helpers obvios sin
consumidores externos se excluyen con razón explícita.

El contexto de estudio no entra como parámetro del participante desde una ruta web. La cuenta y la
sesión validada aportan el `study_id`, la membresía y el participante. La preparación admite solo
300 y 30 tarjetas, en ese orden. La exportación se invoca offline por un operador y el
enriquecimiento GitHub es opcional y prepare-only.

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
| `util/study-bootstrap.js` | `StudyBootstrapConflictError`; `assertBootstrapCards`; `assertStudySchemaReady`; `bootstrapStudy`; `findOrCreateStudy`; `assertMembership`; `persistParticipants`; `persistStudyCards`; crea o reutiliza estudio, membresía y cuentas para 30 o 300 | callbacks SQL triviales | IMPLEMENTED-UNVERIFIED |
| `util/study-card-projection.js` | `projectEnrichedCard(card, enrichmentInput)` | provenance/payload helpers | IMPLEMENTED-UNVERIFIED |
| `util/study-config.js` | `DEFAULT_STUDY_CONFIG`; `EXPECTED_CARD_COUNT`; `SUPPORTED_EXPECTED_CARD_COUNTS`; `StudyConfigError`; `parseStudyConfig`; `readStudyConfig`; `resolveAuthoritativeStudyConfig` | `validateIdentifier` interno | IMPLEMENTED-UNVERIFIED |
| `util/study-profiles-input.js` | `DEFAULT_PROFILE_ROOTS`; `StudyProfilesInputError`; `readStudyProfilesInput`; contratos de los perfiles 300 y 30 | validación de rutas montadas y mapeos internos | IMPLEMENTED-UNVERIFIED |
| `util/login-authentication.js` | `authenticateLogin` | normalización, límites y dummy verify internos | IMPLEMENTED-UNVERIFIED |
| `util/session-middleware.js` | `createSessionMiddleware`; `createSessionId`; `readSessionCookie`; `setSessionCookie`; `destroySession`; `clearSessionCookie` | firma y consultas internas de sesión | IMPLEMENTED-UNVERIFIED |
| `util/csrf.js` | `ensureLoginCsrfContext`; `validateLoginCsrfToken`; `validateSessionCsrfToken`; `isAllowedOrigin`; `readCsrfToken`; `clearLoginCsrfCookie` | generación y lectura interna de tokens | IMPLEMENTED-UNVERIFIED |
| `util/study-service.js` | `createStudyService`; coordinadores de lectura y mutación por contexto de sesión | composición de repositorios | IMPLEMENTED-UNVERIFIED |
| `util/study-read-repository.js` | `findFirstPendingCard`; `findNextPendingCard`; `loadParticipantCategories`; `loadStudyCard`; `loadStudyProgress` | SQL de lectura interno | IMPLEMENTED-UNVERIFIED |
| `util/study-write-repository.js` | `createParticipantCategory`; `createStudyClassification`; `createStudyDiscard`; `findParticipantCategory`; `loadLockedCardState`; `lockParticipantCategory`; `lockStudyCard`; `updateParticipantCategory`; `updateStudyClassification` | SQL de escritura interno | IMPLEMENTED-UNVERIFIED |
| `util/study-github-enrichment.js` | `NORMALIZER_VERSION`; `assertCardSources`; `assertEndpointResults`; `enrichStudyWithGithub`; `loadStudyCardSources`; `persistCardEnrichment` | mappers de páginas triviales | IMPLEMENTED-UNVERIFIED |
| `util/study-export-input.js` | `StudyExportInputError`; `resolveStudyExportInputs` | parser de opciones y comprobación de destino | IMPLEMENTED-UNVERIFIED |
| `util/study-export.js` | `StudyExportError`; `createStudyExport` | consultas de lectura y publicación atómica internas | IMPLEMENTED-UNVERIFIED |
| `util/study-export-format.js` | `StudyExportError`; `assertSafeExportData`; `buildStudyExportPackage` | serialización CSV, checksums y pseudónimos HMAC internos | IMPLEMENTED-UNVERIFIED |
| `util/study-mutation.js` | `assertParticipantCategory`; `lockStudyCard`; `normalizeDiscardReason`; `normalizeRemarks`; `parseExpectedRevision`; `readLockedCardState` | ninguna | IMPLEMENTED-UNVERIFIED |
| `util/study-runtime.js` | `StudyRuntimeError`; `addCardDates`; `findFirstPendingCard`; `findNextPendingCard`; `isUuid`; `loadParticipantCategories`; `loadStudyCard`; `loadStudyProgress`; `respondWithStudyRuntimeError`; `resolveReadyStudy`; `resolveStudyParticipant` | `cardSelect` y parsing internos | IMPLEMENTED-UNVERIFIED |
| `util/study-schema.js` | `assertLedgerState`; `knownExternalMigrationIds`; `managedMigrations`; `parseThrough`; `runStudyMigrations`; `readLedger` | advisory-lock key interna | IMPLEMENTED-UNVERIFIED |
| `util/transaction.js` | `withTransaction` | callbacks de transacción | IMPLEMENTED-UNVERIFIED |
| `scripts/backup-legacy-labeler.js` | entrypoint `main`/argumentos de backup legacy | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `scripts/bootstrap-study.js` | entrypoint `main`/argumentos de bootstrap | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `scripts/enrich-study.js` | entrypoint `main`/argumentos de enriquecimiento | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `scripts/validate-study-profiles.js` | entrypoint de validación de `STUDY_PROFILES_INPUT` | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `scripts/prepare-study-profiles.js` | entrypoint de preparación secuencial, primero 300 y después 30 | callbacks de proceso hijo | IMPLEMENTED-UNVERIFIED |
| `scripts/export-study.js` | entrypoint de exportación offline con `--study-key` y `--output` | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `scripts/check-study-documentation.js` | entrypoint `checkDocumentation`; valida documentos, enlaces, contrato y comandos | helpers de parsing internos | VERIFIED (static) |
| `scripts/import-pr-csv.js` | entrypoint y `persistCardsTransaction` | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `scripts/migrate-study-schema.js` | entrypoint y argumentos `--through` | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `scripts/retire-legacy-labeler.js` | entrypoint y routing de acciones | callbacks triviales | IMPLEMENTED-UNVERIFIED |
| `routes/index.js` | handler `get` de portada | callbacks del router | IMPLEMENTED-UNVERIFIED |
| `routes/[...catchall].js` | handler `get` de fallback | callbacks del router | IMPLEMENTED-UNVERIFIED |
| `routes/login/index.js` | handlers `get` y `post`; crea contexto CSRF y autentica por username/contraseña | parsing local | IMPLEMENTED-UNVERIFIED |
| `routes/logout/index.js` | handler `post`; destruye sesión y limpia cookie | parsing local | IMPLEMENTED-UNVERIFIED |
| `routes/categories/index.js` | handler `post`; crea categoría plana en el contexto de sesión | `normalize` local | IMPLEMENTED-UNVERIFIED |
| `routes/categories/[id]/index.js` | handler `post`; renombra categoría propia | `normalize` local | IMPLEMENTED-UNVERIFIED |
| `routes/queue/index.js` | handler `get`; carga cola y progreso desde la sesión | navegación local | IMPLEMENTED-UNVERIFIED |
| `routes/queue/[id]/index.js` | handler `get`; carga tarjeta y estado privado desde la sesión | navegación local | IMPLEMENTED-UNVERIFIED |
| `routes/queue/[id]/classify/index.js` | handler `post`; reexport `isUuid`; clasifica con categoría y revisión | `continuationPath` local | IMPLEMENTED-UNVERIFIED |
| `routes/queue/[id]/discard/index.js` | handler `post`; descarta con motivo y revisión | `continuationPath` local | IMPLEMENTED-UNVERIFIED |
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
| `readStudyProfilesInput(input, roots)` | descriptor montado de perfiles y raíces aprobadas | perfiles ordenados 300 y 30 | `StudyProfilesInputError` | valida rutas, checksums, conteos, participantes y usernames antes de escribir | IMPLEMENTED-UNVERIFIED |
| `authenticateLogin(options)` | username, contraseña, IP y pool PostgreSQL | resultado autenticado o fallo genérico | límite de login, credencial inválida o error SQL | dummy verify y crea sesión asociada al `study_id` de la cuenta | IMPLEMENTED-UNVERIFIED |
| `createSessionMiddleware(options)` | pool, cookie firmada y política temporal | contexto de sesión o ausencia | errores del store se tratan como no autenticado | recarga cuenta, membresía, `study_id`, expiración y CSRF | IMPLEMENTED-UNVERIFIED |
| `createStudyExport(options)` | pool, `studyKey`, destino externo y secreto HMAC | manifest de exportación | `StudyExportError` o error SQL | transacción `REPEATABLE READ READ ONLY`; publica tres archivos offline | IMPLEMENTED-UNVERIFIED |
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
| `bootstrapStudy(options)` | pool, configuración, tarjetas, checksum y manifest de credenciales | estudio `READY` | `StudyBootstrapConflictError` o error SQL | crea/reutiliza participantes, tarjetas, membresía y cuentas en una transacción | IMPLEMENTED-UNVERIFIED |
| `findOrCreateStudy(client, config, sourceChecksum)` | cliente, configuración y checksum | estudio | error SQL o drift | consulta o crea el estudio por `studyKey` | IMPLEMENTED-UNVERIFIED |
| `persistParticipants(options)` | cliente, `studyId`, participantes y permiso de creación | membresías persistidas | conflicto o error SQL | inserta/reutiliza reviewers en el estudio | IMPLEMENTED-UNVERIFIED |
| `persistStudyCards(options)` | cliente, estudio, tarjetas y permiso de creación | tarjetas vinculadas | conflicto o error SQL | persiste una membresía ordenada por estudio | IMPLEMENTED-UNVERIFIED |
| `enrichStudyWithGithub(pool, config)` | pool y configuración de enriquecimiento | ejecución finalizada | configuración, HTTP, validación o persistencia | coordina cliente GitHub, normalización y snapshots para 30 o 300 | IMPLEMENTED-UNVERIFIED |
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
| `get` en `routes/login/index.js` | request HTTP | vista de login con contexto CSRF | error de consulta/renderizado | prepara el contexto de login sin enumerar cuentas | IMPLEMENTED-UNVERIFIED |
| `post` en `routes/login/index.js` | username, contraseña y CSRF | redirección o error HTTP | credencial inválida, límite o error SQL | autentica y crea sesión con `study_id` de la cuenta | IMPLEMENTED-UNVERIFIED |
| `post` en `routes/logout/index.js` | sesión y CSRF | redirección o error HTTP | sesión inválida o error SQL | destruye sesión y limpia cookie | IMPLEMENTED-UNVERIFIED |
| `post` en `routes/categories/index.js` | nombre de categoría y CSRF | redirección | categoría inválida o error SQL | guarda categoría plana privada del contexto de sesión | IMPLEMENTED-UNVERIFIED |
| `post` en `routes/categories/[id]/index.js` | ID, nombre y CSRF | redirección | categoría ajena o inválida | renombra una categoría propia | IMPLEMENTED-UNVERIFIED |
| `get` en `routes/queue/index.js` | sesión validada | vista de cola | estudio no listo o error SQL | carga progreso y siguiente tarjeta privada | IMPLEMENTED-UNVERIFIED |
| `get` en `routes/queue/[id]/index.js` | ID de tarjeta y sesión | vista de tarjeta | tarjeta no disponible o error SQL | carga estado privado y acciones | IMPLEMENTED-UNVERIFIED |
| `post` en `routes/queue/[id]/classify/index.js` | categoría, remarks, revisión y CSRF | redirección | revisión obsoleta o entrada inválida | clasifica una tarjeta dentro del contexto de sesión | IMPLEMENTED-UNVERIFIED |
| `post` en `routes/queue/[id]/discard/index.js` | razón, remarks, revisión y CSRF | redirección | revisión obsoleta o razón inválida | descarta una tarjeta dentro del contexto de sesión | IMPLEMENTED-UNVERIFIED |
| `get` en `routes/progress/index.js` | contexto de participante | progreso renderizado | estudio no listo o error SQL | calcula progreso privado | IMPLEMENTED-UNVERIFIED |

### Inventario complementario

| Símbolo | Módulo | Contrato resumido | Estado |
| --- | --- | --- | --- |
| `normalizeRepository` | `util/github-pr-config.js` | normaliza `owner/name`; lanza `GithubConfigError`; función pura | VERIFIED (static) |
| `validateGithubConfig` | `util/github-pr-config.js` | valida configuración GitHub; devuelve configuración; lanza `GithubConfigError` | VERIFIED (static) |
| `readGithubConfig` | `util/github-pr-config.js` | lee entorno y aliases; devuelve configuración; lanza error de configuración; no escribe | IMPLEMENTED-UNVERIFIED |
| `resolveCredential` | `util/github-pr-config.js` | resuelve token por repositorio; devuelve callable `getToken`; lanza error de configuración o secreto | IMPLEMENTED-UNVERIFIED |
| `assertExactCards` | `util/github-pr-persistence-validation.js` | valida exactamente 30 o 300 tarjetas según el estudio; devuelve `undefined`; lanza `GithubPersistenceError` | VERIFIED (static) |
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
| `resolveStudyParticipant` | `util/study-runtime.js` | resuelve la membresía del contexto de sesión; devuelve participante; lanza `StudyRuntimeError` o SQL | IMPLEMENTED-UNVERIFIED |
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
| `assertBootstrapCards` | `util/study-bootstrap.js` | exige el conteo persistido, solo 30 o 300; devuelve `undefined`; lanza `StudyBootstrapConflictError` | VERIFIED (static) |
| `assertStudySchemaReady` | `util/study-bootstrap.js` | verifica esquema de estudio; devuelve promesa; lanza error SQL/esquema | IMPLEMENTED-UNVERIFIED |
| `get` | `routes/index.js` | request sin parámetros; renderiza portada; error de renderizado; solo respuesta HTTP | IMPLEMENTED-UNVERIFIED |
| `get` | `routes/[...catchall].js` | request no resuelto; renderiza fallback/error; error de renderizado; solo respuesta HTTP | IMPLEMENTED-UNVERIFIED |

## Comandos y límites de la API

Los entrypoints de Wave 2 se ejecutan desde la raíz:

```bash
npm run validate:study-profiles
npm run prepare:study-profiles
npm run export:study -- --study-key <study-key> --output /absolute/external/directory
npm run docs:study-check -- --root .
```

La preparación valida y procesa primero 300 y después 30. La API web deriva siempre el contexto
de la cuenta y la sesión, sin selector de participante o estudio, sin conteos arbitrarios y sin UI
administrativa. La exportación no tiene endpoint HTTP ni ruta `/export`. El enriquecimiento GitHub
es opcional y prepare-only; la captura live permanece pendiente.

La implementación central y el E2E hostil aislado de los dos estudios están completados. Permanecen
pendientes la evidencia externa de backup y restore, el E2E hostil histórico, el E2E en VPS o
entorno público y el cierre documental histórico. Los estados `IMPLEMENTED-UNVERIFIED` del ledger
no deben reinterpretarse como pruebas de esos entornos.

## Regla de actualización

Repite el ledger cuando cambien exports, handlers, clases, métodos, factories, entrypoints o coordinadores. Toda nueva
exclusión debe explicar por qué no tiene consumidores externos. No añadas JSDoc ni cambies código para completar esta
referencia.
