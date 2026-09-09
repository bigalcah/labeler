# Seguridad

Las cuentas locales usan sesiones opacas almacenadas en PostgreSQL. Las rutas protegidas derivan el estudio y participante
solo de la sesión validada; el navegador no puede elegirlos mediante parámetros, formularios o cabeceras.

Todas las mutaciones requieren un token synchronizer CSRF asociado a la sesión y un `Origin` permitido. El token se
compara con timing-safe, rota al regenerar la sesión y nunca se coloca en URLs ni logs. El login usa un contexto CSRF
anónimo independiente, con expiración, antes de autenticar.

Las vistas usan una CSP estricta sin `unsafe-inline` ni `unsafe-eval`; el comportamiento de navegador vive en assets
estáticos del mismo origen.

El navegador y las rutas no deben llamar a GitHub. Tokens GitHub pertenecen solo a `labeling-study-prepare`. PostgreSQL
contiene decisiones privadas y snapshots normalizados, nunca tokens ni bodies crudos. CSV es autoridad de identidad,
muestra, ordinal y checksum. Categorías, clasificaciones, descartes y progreso se filtran por estudio/participante.

Usa placeholders `<...>` en documentación. Nunca commitees `.env`, tokens, claves privadas, passwords reales, payloads
GitHub, dumps o logs sin revisar. GitHub exige routing `owner/name` exacto y permisos read-only.

Labels globales, Socket.io realtime, conflictos destructivos, exportaciones JSONL y fixtures antiguos son `LEGACY`; no
deben reintroducirse. La ausencia de autenticación, autorización y CSRF es una limitación conocida, no un control.

## Retiro y preservación de datos

El retiro legacy es una operación sensible porque puede afectar datos históricos y dependencias del MVP. En modo `clean`,
la detección de objetos legacy debe fallar cerrada y no debe ejecutar limpieza automática. En modo `existing`, cualquier
retiro permitido requiere backup externo verificable, manifiesto, checksum, identidad de base y confirmación explícita
del operador antes de escribir.

`reviewer` no es una credencial ni un control de autenticación. Se conserva mientras lo referencien membresías, cuentas,
categorías, clasificaciones u otros datos del MVP. La retirada final de objetos legacy restantes pertenece a cambios
posteriores, con inventario de consumidores, lista de objetos autorizados y rollback hacia una base separada o aprobada.
