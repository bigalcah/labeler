# Seguridad

El selector de reviewer no autentica identidades. Actualmente no existen sesiones, autorización ni protección CSRF.
El aislamiento por `study_id` y `participant_id` es lógico y no una frontera contra clientes maliciosos.

El navegador y las rutas no deben llamar a GitHub. Tokens GitHub pertenecen solo a `labeling-study-prepare`. PostgreSQL
contiene decisiones privadas y snapshots normalizados, nunca tokens ni bodies crudos. CSV es autoridad de identidad,
muestra, ordinal y checksum. Categorías, clasificaciones, descartes y progreso se filtran por estudio/participante.

Usa placeholders `<...>` en documentación. Nunca commitees `.env`, tokens, claves privadas, passwords reales, payloads
GitHub, dumps o logs sin revisar. GitHub exige routing `owner/name` exacto y permisos read-only.

Labels globales, Socket.io realtime, conflictos destructivos, exportaciones JSONL y fixtures antiguos son `LEGACY`; no
deben reintroducirse. La ausencia de autenticación, autorización y CSRF es una limitación conocida, no un control.
