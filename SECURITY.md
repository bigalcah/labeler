# Seguridad

La documentación de seguridad describe el contrato del MVP y está en estado `IMPLEMENTED-UNVERIFIED`. La existencia de
código o configuración no demuestra una ejecución aprobada de infraestructura, HTTP o VPS.

## Identidad de estudio y sesión

Las cuentas locales usan sesiones opacas almacenadas en PostgreSQL. La cuenta persistida está vinculada a una membresía
y a un `study_id`. Después del login, la sesión validada conserva ese `study_id` y el participante autorizado. Las rutas
protegidas derivan ambos valores de la sesión, no del navegador.

El username es una credencial de búsqueda, nunca un selector de estudio. El login actual usa `javier`, `diego` y `pablo`;
el perfil de validación usa `javier-30`, `diego-30` y `pablo-30`. El sufijo no se interpreta. No hay selector de estudio,
selector de participante, parámetros confiados, cabeceras de identidad ni UI administrativa.

Todas las mutaciones requieren un token synchronizer CSRF asociado a la sesión y un `Origin` permitido. El token se
compara con timing-safe, rota al regenerar la sesión y nunca se coloca en URLs ni logs. El login usa un contexto CSRF
anónimo independiente, con expiración, antes de autenticar.

Las vistas usan una CSP estricta sin `unsafe-inline` ni `unsafe-eval`; el comportamiento de navegador vive en assets
estáticos del mismo origen. La exposición prevista usa Caddy como único borde público en 80 y 443.

## Datos, fuentes y exportación

El CSV es autoridad de identidad, muestra, ordinal y checksum. Solo se admiten muestras persistidas de 30 o 300 tarjetas.
La selección de 30 es determinista y procede del CSV canónico. Categorías, clasificaciones, descartes, observaciones y
progreso se filtran por `study_id` y participante. Cada participante recibe la misma membresía del estudio, pero sus
decisiones permanecen privadas.

El navegador y las rutas no deben llamar a GitHub. Los tokens GitHub pertenecen solo a `labeling-study-prepare` y el
enriquecimiento es opcional y prepare-only. PostgreSQL contiene decisiones privadas y snapshots normalizados, nunca tokens
ni bodies crudos. No hay captura live durante la clasificación.

La exportación es operator-only y offline. No existe `/export`, descarga desde el navegador ni otra ruta HTTP de exportación.
El operador debe proporcionar un secreto HMAC externo y solo puede crear un paquete después de que todas las tarjetas de
todos los participantes tengan una decisión terminal. El paquete no incluye tokens, sesiones, hashes de credenciales,
secretos, datos de throttling ni payloads GitHub crudos.

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

## Evidencia pendiente

La aceptación real del backup cifrado y restore externo sigue pendiente. También siguen pendientes el E2E histórico de
aislamiento, el E2E público en VPS y el cierre documental formal. Esas fronteras no deben presentarse como verificadas en
esta documentación. La captura GitHub live sigue fuera de alcance y pendiente.
