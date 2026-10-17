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

La comparación CSV es una excepción acotada a la privacidad ordinaria. `GET /export` requiere
sesión, deriva participante y estudio de esa sesión y es de solo lectura; no requiere CSRF.
`POST /export/download` exige sesión, `Origin` permitido y CSRF válido, y vuelve a validar el gate.
La descarga solo se permite cuando el solicitante y al menos otra persona del mismo estudio han
completado todas las 30 o 300 tarjetas canónicas con exactamente una decisión terminal por tarjeta.
Solo se incluyen participantes completos; sus bloques conservan ordinales estables y no revelan
columnas ni datos de personas incompletas.

El servidor prepara el CSV entero desde una sola instantánea de solo lectura. Solo publica una
respuesta `text/csv` si la generación termina; no escribe datos del estudio. El CSV usa UTF-8,
RFC 4180 y CRLF. La protección contra fórmulas se aplica a los valores textuales de salida y no
modifica lo persistido. Las respuestas de error no contienen adjunto ni bytes CSV; los errores
internos son sanitizados. La página, los errores y el archivo son privados y no cacheables.

Se retiraron `export:study`, el paquete anterior de tres archivos y el secreto HMAC exclusivo del
exportador. No existe una alternativa de exportación de operador. Esta retirada no modifica
backups operativos ni archivos históricos ya descargados.

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
