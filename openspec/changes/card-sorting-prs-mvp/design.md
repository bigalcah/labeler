## Context

La aplicación es un monolito Node.js/Express con EJS, PostgreSQL y rutas basadas en archivos. El flujo legacy usa `instance`, `label`, `review` y `discard`; el MVP usa un estudio, tarjetas de PR, categorías privadas y clasificaciones. El CSV de la muestra contiene exactamente 300 PR lógicos, 69 columnas, texto multilínea y JSON incrustado, por lo que no puede procesarse con el loader legacy.

El MVP se desplegará en un VPS público. La identidad del participante no puede depender de un selector, de un parámetro recibido del navegador ni de una cabecera confiada. Cada participante tendrá una cuenta local preprovisionada y la aplicación derivará la identidad únicamente de una sesión válida del servidor.

## Goals / Non-Goals

**Goals:**

- Validar el CSV completo antes de escribir y exigir exactamente 300 `source_card_id` únicos.
- Persistir la configuración del estudio y una membresía canónica con los mismos 300 PR para cada participante.
- Arrancar de forma determinista en una base limpia o existente, preservando datos y fallando ante conflictos.
- Ejecutar un bootstrap one-shot después de la salud de PostgreSQL y antes de la readiness web.
- Usar cuentas locales preprovisionadas con contraseñas Argon2id, sesiones opacas almacenadas en PostgreSQL, identidad derivada solo de la sesión y revocación explícita.
- Proteger todas las mutaciones con token CSRF synchronizer y validación de `Origin`.
- Renderizar tarjetas locales, mantener categorías y respuestas privadas y permitir exactamente una clasificación por PR y participante.
- Mantener el contrato sustituible por GitHub sin activar GitHub durante la clasificación.
- Publicar el servicio solo detrás de Caddy en los puertos 80 y 443, con aplicación y PostgreSQL en la red interna.

**Non-Goals:**

- Autorregistro, MFA, OIDC, JWT, autenticación por cabeceras, UI administrativa, recuperación por correo o webhooks.
- Consultar GitHub desde la aplicación o el navegador durante el estudio. El enriquecimiento de snapshots ocurre fuera del flujo interactivo y permanece offline.
- Invitaciones, exportación, normalización, acuerdo, adjudicación o taxonomía jerárquica durante esta fase. Las categorías del participante son planas.
- Eliminar objetos legacy automáticamente o implementar un rollback destructivo.

## Decisions

### 1. Configuración y muestra

La configuración mínima es:

```json
{
  "studyKey": "pr-card-sorting-2026",
  "expectedCardCount": 300,
  "participants": ["participant-a", "participant-b", "participant-c"]
}
```

`expectedCardCount` debe ser 300 y `participants` debe contener identificadores únicos. Si existe un estudio activo para `studyKey`, su configuración y membresía persistidas son autoritativas. Una configuración distinta produce drift y falla, no reemplaza participantes ni tarjetas. Una configuración explícita solo crea un estudio nuevo.

El CSV es la única fuente de selección de la muestra. Se valida entero, incluyendo encabezado, campos requeridos, JSON, texto multilínea, checksum y unicidad. El estudio usa los mismos 300 `study_card` para todos los participantes. La futura fuente GitHub debe producir el mismo contrato de tarjeta, pero no realiza solicitudes de red desde el runtime de clasificación.

### 2. Bootstrap y preservación

Las migraciones crean únicamente estructura. Con PostgreSQL saludable y antes de iniciar la aplicación o Caddy, la preparación valida sin escribir el modo, la configuración, el CSV completo y un manifiesto exacto de cuentas suministrado por el operador mediante un archivo secreto montado de solo lectura o un descriptor; ninguna contraseña ni hash se acepta por argumento ni se registra. En una única transacción crea o reutiliza el estudio, las tarjetas, `study_card` y `study_participant`; después, cuando ya existe la membresía referenciada, inserta únicamente las `participant_account` ausentes, valida exactamente una cuenta habilitada con hash Argon2id válido por participante configurado, marca el estudio `READY` y confirma. Las cuentas existentes compatibles, incluidos `password_hash` y `credential_version`, se preservan y solo pueden cambiar mediante el procedimiento separado de reset. Cualquier fallo revierte todas las escrituras del intento, conserva el estado previo y deja el despliegue no listo. Una tarjeta existente con contenido o checksum diferente es un conflicto fatal. No se sobrescriben tarjetas clasificadas.

En modo `clean`, la preparación falla si detecta objetos legacy y nunca los elimina. En modo `existing`, solo se permite la retirada explícita y escalonada tras un respaldo externo verificable y la confirmación operativa requerida. Un fallo hace rollback de la transacción, conserva datos previos y deja el servicio no listo.

### 3. Modelo de datos

El modelo nuevo se mantiene junto al esquema legacy:

```text
study
study_participant
study_card
pr_cards
participant_account
app_session
participant_category
pr_classification
pr_discard
```

`study` conserva `study_key`, configuración, checksum de fuente, cantidad esperada y estado de bootstrap. `study_participant` relaciona el estudio con el participante, su clave visible de configuración y su orden estable. `study_card` es la membresía canónica del estudio y garantiza una sola entrada por `source_card_id`.

`pr_cards` conserva la procedencia CSV, los campos normalizados para presentación, el resumen, la evidencia y el payload original. La tarjeta no se actualiza si su checksum cambia.

`participant_account` se vincula a una membresía de estudio. Guarda el nombre de usuario normalizado, un hash Argon2id, estado habilitado, `credential_version`, contadores y marcas temporales de límites. Nunca guarda contraseñas en texto plano ni añade contraseñas a `reviewer`.

`app_session` guarda en PostgreSQL el identificador opaco, la cuenta y membresía asociadas, la versión de credenciales, creación, última actividad y expiración. La cookie solo contiene el identificador firmado de sesión, con atributos Secure, HttpOnly, SameSite=Lax y Path=/, sin Domain.

Las categorías son planas, privadas y propiedad del participante autenticado. Una clasificación referencia una categoría propia y tiene unicidad `(pr_card_id, participant_id)`. `pr_discard` conserva como máximo un descarte privado por `(pr_card_id, participant_id)`, con motivo opcional. Cada tarjeta y participante deriva exactamente uno de los estados `PENDING`, `CLASSIFIED` o `DISCARDED`: solo se permiten `PENDING -> CLASSIFIED` y `PENDING -> DISCARDED`, sin transiciones entre estados terminales. El replay idéntico de un descarte es idempotente y un motivo diferente entra en conflicto. La cola y los conteos son privados por participante. No se difunden categorías, clasificaciones ni descartes por Socket.io.

### 4. Acceso y ciclo de sesión

Las cuentas se crean fuera de la interfaz mediante un procedimiento de provisión controlado. El hash usa Argon2id con parámetros ajustados al VPS. No existe registro público ni UI administrativa. Un reset operativo incrementa `credential_version` y revoca las sesiones asociadas.

El login acepta solo username y contraseña. Para cuentas inexistentes se ejecuta una verificación ficticia equivalente y se devuelve el mismo error genérico que para credenciales inválidas, cuentas deshabilitadas o cuentas temporalmente limitadas. Se aplican límites persistentes de fallos por cuenta y de intentos por IP, con respuesta acotada y sin revelar existencia de cuentas.

Al autenticarse se regenera el identificador de sesión y se guarda la nueva sesión en PostgreSQL. Cada solicitud protegida vuelve a validar cuenta, membresía, versión de credenciales, expiración por inactividad de ocho horas y expiración absoluta de 24 horas. Un fallo del store se trata como no autenticado. Logout es una mutación POST protegida por CSRF, destruye la sesión y limpia la cookie.

La identidad de dominio, `study_id` y `participant_id` se derivan exclusivamente de la sesión validada. Las rutas canónicas no incluyen identificadores de participante en path, query string ni formularios. Las rutas antiguas con nombre de participante no se conservan como compatibilidad silenciosa.

La navegación canónica usa rutas direccionables derivadas de la sesión, sin `:participant`, para la cola, la tarjeta actual y sus vecinos por `study_card.ordinal`. La cola excluye las tarjetas que el participante actual ya clasificó o descartó. Tras clasificar o descartar, la respuesta `303` conduce a la siguiente tarjeta pendiente, con vuelta al primer pendiente o una cola vacía `200` cuando no queda ninguna. El cambio histórico `navigate-pr-cards-private-discard` conserva evidencia útil de implementación para descarte, ordinales y estados, pero sus rutas `/:participant/queue` y `/:participant/queue/:cardId` quedan supersedidas por estas rutas canónicas derivadas de la sesión.

### 5. CSRF y mutaciones

Cada sesión recibe un token synchronizer aleatorio, almacenado server-side y rotado tras login. Las mutaciones POST, PUT, PATCH y DELETE requieren el token en formulario o cabecera, comparación segura y `Origin` válido contra `APP_ORIGIN`. La falta de token, un token de otra sesión o un origen inválido producen rechazo sin mutación. El token nunca aparece en URL ni logs.

### 6. Despliegue y operación VPS

Caddy es el único borde público y publica 80 y 443, redirige HTTP a HTTPS y termina TLS antes de reenviar al servidor interno. La aplicación y PostgreSQL usan red interna y no publican 3000, 7755 ni 5432. Los endpoints operativos no se exponen externamente.

Los secretos se entregan mediante archivos montados con permisos mínimos. El entorno solo contiene configuración no secreta. El runtime usa imágenes fijadas, usuario no root, capacidades reducidas, filesystem de aplicación de solo lectura cuando sea compatible, límites de recursos, healthchecks internos, logs estructurados y redacción de contraseñas, cookies, CSRF y tokens. Los respaldos lógicos son externos, cifrados, con manifiesto y checksum, retención definida y restauración probada en una base aislada. Nunca se restaura sobre producción como parte del rollback.

## Readiness, migration and rollback constraints

La readiness pública exige el éxito de la ejecución de preparación actual, no solo un estado `READY` persistido anteriormente. El orden operativo es: PostgreSQL saludable; validación previa de modo, configuración, CSV y manifiesto; migraciones aditivas y gate de modo; transacción de estudio, tarjetas y membresías; provisión de cuentas ausentes; validación final y commit de `READY`; arranque y health interno de la aplicación; y, únicamente entonces, arranque público de Caddy.

La migración mantiene el monolito y añade gradualmente el modelo de estudio, acceso, autorización, CSRF y el borde Caddy. Primero se aísla el flujo nuevo de consumidores legacy, después se verifica la preservación en clean y existing, y finalmente se retiran consumidores legacy en etapas posteriores. Las tablas legacy permanecen mientras existan dependencias, incluidas las cuentas que referencien membresías existentes.

El rollback solo puede detener el despliegue, volver a una versión de aplicación compatible y restaurar un respaldo verificado en un destino separado o expresamente aprobado. No se usa `down -v`, no se borra el volumen, no se eliminan filas automáticamente y no se restaura sobre el volumen de producción. Cualquier retirada de tablas requiere un cambio explícito posterior.

## Design rationale

La sesión server-side evita que el navegador elija o falsifique la identidad y permite revocación inmediata por logout, expiración o cambio de credenciales. PostgreSQL mantiene la sesión junto al estado del estudio sin introducir un almacén adicional. Argon2id protege las credenciales provisionadas sin convertir `reviewer` en una tabla de autenticación.

El CSV como fuente de selección hace reproducible la muestra y evita que una llamada externa cambie el estudio durante la participación. Los snapshots offline permiten enriquecer evidencia sin romper esa frontera. Caddy concentra TLS y reduce la superficie pública, mientras que clean/existing y los respaldos verificables protegen el trabajo existente.

## Risks / Trade-offs

- Las credenciales locales requieren provisión y reset por operador. No hay recuperación automática ni MFA en este MVP.
- Los límites por IP pueden afectar a participantes que compartan dirección de salida, por lo que deben ser observables y acotados sin revelar cuentas.
- La caducidad absoluta obliga a volver a iniciar sesión aunque haya actividad, a cambio de limitar la vida de una sesión comprometida.
- El CSV puede contener JSON o texto multilínea y debe procesarse con un parser RFC 4180 real.
- Una base existente puede contener fixtures o trabajo legacy. El drift, la falta de respaldo y los conflictos deben fallar cerrados.
- `language` es el valor informado por la fuente, no un cálculo derivado de archivos.

## Migration Plan

1. Crear la estructura de estudio, cuentas y sesiones sin cargar fixtures legacy ni eliminar objetos existentes.
2. Validar completamente configuración, CSV y manifiesto antes de escribir y, dentro de una transacción, crear o reutilizar las 300 tarjetas y las membresías.
3. En esa misma transacción y después de crear o reutilizar `study_participant`, insertar solo las cuentas ausentes desde el manifiesto, preservar las existentes y validar el conjunto completo antes de marcar `READY`.
4. Activar login, sesiones PostgreSQL, expiraciones, revocación, rutas canónicas y CSRF.
5. Verificar aislamiento, reanudación, límites, conflicto de fuente y preservación en clean y existing.
6. Arrancar la aplicación en la red interna después del commit, validar su readiness y solo entonces publicar Caddy en 80 y 443, con secretos por archivo, hardening y respaldos externos.
7. Mantener el flujo legacy aislado y retirar sus consumidores por etapas en cambios posteriores.

Rollback: detener el bootstrap antes del commit ante cualquier error. Para un despliegue ya iniciado, volver a una versión compatible y restaurar el respaldo verificado en un destino separado. No hay rollback destructivo ni eliminación automática.
