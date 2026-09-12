## Context

La aplicación es un monolito Node.js/Express con EJS, PostgreSQL y rutas basadas en archivos. El estudio actual `pr-card-sorting-local` ya representa una muestra ordenada de 300 PR, con cuentas, decisiones, categorías y enriquecimiento que deben conservarse. El CSV canónico tiene 300 registros lógicos, 69 columnas, texto multilínea y JSON incrustado, por lo que la fixture de validación debe generarse con el proveedor CSV y no con el loader legacy.

El cambio añade un estudio de validación de 30 tarjetas, seleccionado de forma determinista desde ese CSV con seis tarjetas por cada agente `Copilot`, `Devin`, `OpenAI_Codex`, `Cursor` y `Claude_Code`. Ambos estudios deben poder permanecer en `READY` en la misma base. La secuencia de preparación debe validar todos los perfiles antes de escribir, procesar primero el perfil actual de 300 y después el de validación de 30, y no permitir readiness de la aplicación o Caddy hasta que ambos terminen correctamente.

La identidad del participante no puede depender de un selector, un sufijo interpretado, un parámetro del navegador o una cabecera confiada. Las mismas claves visibles `javier`, `diego` y `pablo` usarán `javier`, `diego`, `pablo` en el estudio actual y `javier-30`, `diego-30`, `pablo-30` en el estudio de validación. La cuenta y la sesión persistirán el `study_id` autoritativo.

La secuencia de migraciones gestionadas termina en `010_study_scoped_participant_categories`. La coexistencia se resuelve con una migración posterior, sin modificar migraciones históricas ni destruir datos.

## Goals / Non-Goals

**Goals:**

- Admitir únicamente los perfiles de cardinalidad 30 y 300 y rechazar cualquier otro conteo.
- Preservar la clave, checksum, membresía ordenada, decisiones, categorías, cuentas, versiones de credenciales y enriquecimiento promovido del estudio actual de 300.
- Crear una fixture reproducible de 30 tarjetas desde el CSV canónico, con seis tarjetas por agente requerido y el mismo orden para los tres participantes.
- Permitir dos estudios distintos en estado `READY` en una única base PostgreSQL, con preparación secuencial y gate de readiness.
- Validar configuración, CSV, manifests, checksums, mapeos de login y opciones de enriquecimiento antes de la primera escritura de cualquier perfil.
- Mantener categorías, decisiones, descartes, observaciones y progreso privados, derivados de la sesión y protegidos por CSRF y `Origin`.
- Ejecutar enriquecimiento GitHub opcional, preparado por estudio y gobernado por el conteo persistido, sin captura live durante la clasificación.
- Generar un paquete operator-only offline con resultados completos, categorías, nombres, observaciones, motivos de descarte, URLs, procedencia, pseudónimos y checksums.
- Mantener la aplicación detrás de Caddy en 80 y 443 y dejar la aplicación y PostgreSQL en la red interna.

**Non-Goals:**

- Conteos arbitrarios, estado `ACTIVE`, un selector de estudio para participantes, parser de sufijos de username, rediseño de identidades globales o UI administrativa en runtime.
- Captura live de GitHub, llamadas GitHub desde la aplicación o el navegador, webhooks, workers permanentes o exposición de tokens.
- Exportación HTTP, exportación desde el navegador, JSONL legacy, payloads GitHub crudos, sesiones, hashes, secretos o datos de throttling en el paquete exportado.
- Taxonomía jerárquica, normalización, acuerdo, adjudicación, Excel como formato canónico, invitaciones, autorregistro, MFA, OIDC o recuperación por correo.
- Trabajo de VPS, automatización de release o captura live pendiente de otros cambios. Este documento no completa las tareas históricas 9.5, 10.2, 10.3 ni 10.4.
- Eliminación automática de objetos legacy, `down -v`, rollback destructivo o reescritura del estudio actual.

## Decisions

### 1. Perfiles y fixture determinista

La configuración de cada perfil conserva esta forma, con `expectedCardCount` limitado a 30 o 300:

```json
{
  "studyKey": "pr-card-sorting-validation-30",
  "expectedCardCount": 30,
  "participants": ["javier", "diego", "pablo"],
  "loginUsernames": {
    "javier": "javier-30",
    "diego": "diego-30",
    "pablo": "pablo-30"
  },
  "enrichmentEnabled": false
}
```

El perfil actual conserva `pr-card-sorting-local`, `expectedCardCount` 300 y usernames `javier`, `diego` y `pablo`. La fixture de 30 se selecciona desde el CSV canónico, que debe conservar el checksum SHA-256 aprobado `4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef`, agrupando por los cinco agentes requeridos, ordenando dentro de cada grupo por SHA-256 de `agent`, un byte NUL y `card_id`, y tomando las primeras seis filas. La salida final usa el orden fijo de agentes y el orden hash de cada grupo. No se genera una muestra por participante ni se usa aleatoriedad de runtime.

### 2. Migración aditiva y coexistencia

La migración nueva se aplica después de `010_study_scoped_participant_categories`. Debe eliminar la restricción parcial que imponía un único `READY`, crear un índice de readiness no único y reemplazar el límite efectivo de 300 por `expected_card_count IN (30, 300)`. Debe conservar `PENDING` y `READY`, la unicidad de `study_key`, los checksums, la membresía y todos los resultados existentes. No se añade `ACTIVE`, no se editan migraciones históricas y no se crea un rollback destructivo.

La migración de usernames se ejecuta después de la migración de cardinalidad. Primero comprueba duplicados de `normalized_username` entre estudios y aborta sin mutar datos si encuentra alguno. Solo después crea la unicidad global. La provisión actual conserva usernames existentes compatibles y no actúa como reset.

### 3. Preparación secuencial y gate de publicación

`STUDY_PROFILES_INPUT` describe una lista ordenada de entradas `{config,csv,accountManifest,enrichmentEnabled}` bajo raíces montadas aprobadas. El preflight valida todas las entradas, el CSV, el manifiesto, el checksum, el conteo, la unicidad de `studyKey`, el mapeo exacto de participantes y usernames y las opciones de enriquecimiento antes de iniciar cualquier escritura.

El one-shot prepara primero el estudio de 300 y luego el de 30, creando o reutilizando cada estudio en una transacción propia. La aplicación depende del éxito completo del prepare y Caddy depende de la readiness interna de la aplicación. Un fallo del segundo perfil no borra ni reescribe el primero y evita que el servidor quede listo. El contrato de perfil único basado en `STUDY_CONFIG_INPUT` se conserva.

### 4. Identidad, cuentas y sesión

La clave visible del participante es independiente del username de login. La configuración define explícitamente `loginUsernames`, con fallback al mismo valor de la clave visible para el perfil actual. El sistema no interpreta `-30` ni ningún otro sufijo. El login busca una cuenta, y esa cuenta aporta el `study_id` persistido a la sesión. Las rutas nunca aceptan un estudio o participante desde cliente.

Se conservan Argon2id, sesiones opacas PostgreSQL, expiración idle de ocho horas, expiración absoluta de 24 horas, regeneración del identificador, revocación por `credential_version`, dummy verify, límites persistentes, errores genéricos, cookies Secure HttpOnly SameSite=Lax y CSRF synchronizer con `Origin` válido.

### 5. Enriquecimiento opcional por estudio

El enriquecimiento solo se activa desde la preparación operator-only y solo recibe el secreto de lectura en ese contexto. El proceso carga el `study_id`, el checksum, la membresía ordenada y `expectedCardCount` persistidos. Un perfil CSV-only no necesita token ni crea un run promovido. Un perfil habilitado exige cobertura completa exactamente de 30 o 300, según el estudio, antes de promover snapshots. No se cambia la semántica de pausa, reintento, cuota o autorización y no se afirma que la captura live esté implementada.

### 6. Flujo privado y exportación offline

La cola consulta `study_card` del contexto de sesión y calcula `classified + discarded + pending = expectedCardCount`. La misma tarjeta de origen puede recibir decisiones distintas en cada estudio. `CLASSIFIED` tiene exactamente una categoría privada; `DISCARDED` conserva un motivo opcional y no tiene clasificación. Las categorías, decisiones, descartes y observaciones no se difunden por Socket.io.

El operador ejecuta un comando offline con `--study-key` explícito. En una transacción de solo lectura exige un estudio `READY`, todos los participantes configurados y todas las tarjetas terminales. Produce `results.csv`, `categories.csv` y `manifest.json`. Los CSV contienen orden de participante y tarjeta, pseudónimos, categoría y nombre, `classification_remarks`, `discard_reason`, timestamps y revisiones de decisión, además de URLs de origen y efectivas. El manifiesto contiene versión, estudio, checksums de fuente y membresía, conteo esperado, totales de finalización, checksums de salida, política HMAC y procedencia de enriquecimiento. El secreto HMAC vive fuera del repositorio y no se exporta.

### 7. Clean, existing y rollback

`clean` falla si detecta objetos legacy y nunca los elimina. `existing` conserva su ruta de retiro explícita, backup externo verificable y confirmación requerida. La preparación normal no usa `STUDY_DATABASE_MODE=existing` para añadir el segundo estudio. Un fallo revierte la transacción del perfil, conserva el fingerprint del estudio actual y deja el servicio no listo.

## Model

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

`study` conserva `study_key`, configuración, checksum de fuente, `expected_card_count` limitado a 30 o 300 y estado de bootstrap. Puede haber varias filas `READY`, pero `study_key` sigue siendo único. `study_participant` relaciona cada estudio con la clave visible del participante y su orden estable. `study_card` es la membresía canónica y garantiza una sola entrada por `source_card_id` dentro del estudio.

`pr_cards` conserva procedencia CSV, campos normalizados, resumen, evidencia y payload original para uso interno de la tarjeta. Ese payload no pertenece al export público y la tarjeta no se actualiza si cambia su checksum.

`participant_account` se vincula a una membresía de estudio. Guarda el username normalizado, que tiene unicidad global después del preflight, el hash Argon2id, estado habilitado, `credential_version`, contadores y marcas temporales de límites. Nunca guarda contraseñas en texto plano ni añade contraseñas a `reviewer`.

`app_session` guarda el identificador opaco, la cuenta y membresía asociadas, el `study_id` persistido, la versión de credenciales, creación, última actividad, expiración y CSRF. La cookie solo contiene el identificador firmado de sesión, con atributos Secure, HttpOnly, SameSite=Lax y Path=/, sin Domain.

Las categorías son planas, privadas y propiedad del participante autenticado en un estudio. Una clasificación referencia una categoría propia y tiene unicidad `(pr_card_id, participant_id)`. `pr_discard` conserva como máximo un descarte privado por `(pr_card_id, participant_id)`, con motivo opcional. Cada tarjeta y participante deriva exactamente uno de `PENDING`, `CLASSIFIED` o `DISCARDED`, sin transiciones entre estados terminales.

## Readiness, migration and rollback constraints

El orden operativo es: PostgreSQL saludable; validación completa de todos los perfiles; migraciones aditivas y gate de modo; preflight de duplicados de usernames; preparación transaccional del estudio actual de 300; preparación transaccional del estudio de validación de 30; provisión y validación de cuentas; confirmación de ambos estados `READY`; arranque y health interno de la aplicación; y únicamente entonces arranque público de Caddy.

La migración mantiene el monolito y añade gradualmente cardinalidades, coexistencia, acceso, autorización, CSRF y exportación offline. Primero se aísla el flujo nuevo de consumidores legacy, después se verifica la preservación en clean y existing y finalmente se retiran consumidores legacy en etapas posteriores. Las tablas legacy permanecen mientras existan dependencias.

El rollback solo puede detener el despliegue, volver a una versión de aplicación compatible y restaurar un respaldo verificado en un destino separado o expresamente aprobado. No se usa `down -v`, no se borra el volumen, no se eliminan filas automáticamente y no se restaura sobre el volumen de producción. Cualquier retirada de tablas requiere un cambio explícito posterior.

## Design rationale

El `study_id` de la cuenta y la sesión evita que el navegador elija o falsifique el estudio y permite reutilizar participantes visibles sin mezclar resultados. Dos usernames distintos permiten la coexistencia sin convertir el sufijo en autoridad ni introducir un selector.

La selección desde el CSV canónico hace reproducible la muestra de 30 y evita que una llamada externa cambie el conjunto durante la participación. Los snapshots opcionales permiten enriquecer evidencia durante preparación sin romper la frontera offline. El gate secuencial impide publicar un estado parcial y las fingerprints protegen el estudio actual.

La exportación offline separa la salida operator-only de la superficie participante. Sus checksums y pseudónimos permiten reproducibilidad sin exponer secretos, sesiones ni payloads crudos. Caddy concentra TLS y los modos clean/existing y los respaldos verificables protegen el trabajo existente.

## Risks / Trade-offs

- Dos perfiles requieren validar todos los insumos antes de escribir. El preflight completo y la preparación secuencial evitan dejar un segundo estudio parcial.
- La fixture depende del checksum del CSV canónico. El selector falla cerrado ante cambios, agentes ausentes o IDs duplicados en vez de producir una muestra silenciosamente distinta.
- La unicidad global de usernames puede descubrir duplicados históricos. El preflight previo al índice aborta sin mutar filas y deja el conflicto para resolución operativa explícita.
- Las credenciales locales requieren provisión y reset por operador. No hay recuperación automática ni MFA en este MVP.
- Los límites por IP pueden afectar a participantes que compartan dirección de salida, por lo que deben ser observables y acotados sin revelar cuentas.
- La caducidad absoluta obliga a volver a iniciar sesión aunque haya actividad, a cambio de limitar la vida de una sesión comprometida.
- El CSV puede contener JSON o texto multilínea y debe procesarse con un parser RFC 4180 real.
- Una base existente puede contener fixtures o trabajo legacy. El drift, la falta de respaldo y los conflictos deben fallar cerrados.
- El paquete de exportación necesita un secreto HMAC externo y una salida fuera del repositorio para no mezclar pseudónimos con secretos o datos generados.
- La captura GitHub live y la automatización VPS siguen fuera de este cambio, aunque el contrato de preparación deja el enriquecimiento opcional listo para verificarse cuando corresponda.
- `language` es el valor informado por la fuente, no un cálculo derivado de archivos.

## Migration Plan

1. Verificar el CSV canónico y generar la fixture determinista de 30 con su manifiesto, sin modificar el CSV de 300.
2. Crear la migración posterior a `010_study_scoped_participant_categories` para permitir solo 30 y 300, eliminar la restricción de un único `READY` y preservar el estudio actual.
3. Prevalidar duplicados de usernames normalizados y aplicar después la unicidad global, preservando las cuentas actuales y sus versiones.
4. Añadir el descriptor de perfiles, validar todos sus insumos antes de escribir y preparar secuencialmente primero 300 y luego 30 en la misma base.
5. Persistir las cuentas con el mapeo actual `javier`, `diego`, `pablo` y el mapeo de validación `javier-30`, `diego-30`, `pablo-30`; derivar siempre el estudio desde la cuenta y la sesión.
6. Activar el enriquecimiento opcional por estudio usando el conteo persistido, sin llamadas desde navegador o servidor web y sin reclamar captura live.
7. Añadir el comando de exportación offline, el gate de finalización y los archivos `results.csv`, `categories.csv` y `manifest.json`, con checksums, pseudónimos y campos textuales completos.
8. Verificar el flujo privado de 30 con tres participantes, la exportación y la preservación por fingerprint del estudio de 300 antes y después.
9. Arrancar la aplicación en la red interna después de la preparación completa, validar readiness y solo entonces publicar Caddy en 80 y 443.
10. Mantener el flujo legacy aislado, las tareas históricas no terminadas y el rollback no destructivo. El trabajo VPS y la captura live quedan para sus cambios y tareas correspondientes.

Rollback: detener el bootstrap antes del commit ante cualquier error. Para un despliegue ya iniciado, volver a una versión compatible y restaurar el respaldo verificado en un destino separado. No hay rollback destructivo ni eliminación automática.
