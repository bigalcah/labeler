## MODIFIED Requirements

### Requirement: Estudio local configurable

El sistema SHALL aceptar una configuración JSON con `studyKey`, `expectedCardCount` y `participants`. `expectedCardCount` SHALL ser exactamente 30 o 300. Si no existe configuración explícita, SHALL usar el perfil actual de 300 tarjetas con los participantes `javier`, `diego` y `pablo`. Un estudio persistido y su configuración SHALL ser autoritativos; una configuración explícita solo crea un estudio nuevo y cualquier drift falla sin borrar participantes, tarjetas o resultados.

#### Scenario: Configuración por defecto
- **WHEN** se inicia un estudio nuevo sin configuración explícita
- **THEN** se persisten `javier`, `diego` y `pablo`, se exige el conteo 300 y se conserva la identidad del estudio actual

#### Scenario: Configuración de validación
- **WHEN** se prepara el perfil de validación con `studyKey` propio y `expectedCardCount` igual a 30
- **THEN** se crea un estudio distinto con los mismos participantes visibles y se rechazan conteos distintos de 30 o 300

#### Scenario: Dos estudios listos
- **WHEN** existen perfiles compatibles para el estudio actual de 300 y el estudio de validación de 30
- **THEN** ambos pueden permanecer en estado `READY` simultáneamente en la misma base y sus `study_key` son distintos

#### Scenario: Estudio existente
- **WHEN** existe un estudio persistido y la configuración local difiere de su configuración o membresía
- **THEN** la configuración persistida sigue siendo autoritativa y la preparación falla por drift sin eliminar datos

### Requirement: Misma muestra para cada participante

El sistema MUST persistir `study_card` como membresía canónica y asociar las mismas `expectedCardCount` tarjetas a cada participante activo del estudio, donde `expectedCardCount` solo puede ser 30 o 300. Las colas no SHALL usar copias distintas por participante.

#### Scenario: Cobertura completa
- **WHEN** los tres participantes recorren las colas del estudio actual
- **THEN** cada uno recibe las mismas 300 PR en el mismo orden hasta clasificar o descartar cada una

#### Scenario: Cobertura completa de 30
- **WHEN** los tres participantes recorren las colas del estudio de validación
- **THEN** cada uno recibe las mismas 30 PR en el mismo orden hasta clasificar o descartar cada una

### Requirement: Preparación para fuente GitHub

El CSV SHALL ser la única fuente de selección de cada muestra. El sistema SHALL conservar el origen, el snapshot, el checksum y la membresía ordenada de cada tarjeta. Un enriquecimiento GitHub opcional SHALL ejecutarse solo durante la preparación del estudio seleccionado, usar su `expectedCardCount` persistido y no realizar solicitudes desde el runtime de clasificación, la aplicación web o el navegador.

#### Scenario: Origen CSV
- **WHEN** un perfil de 30 o 300 tarjetas se crea desde su CSV validado
- **THEN** cada tarjeta registra `CSV` como fuente, conserva la procedencia y queda disponible para un proveedor futuro sin cambiar el flujo del estudio

#### Scenario: Enriquecimiento opcional por estudio
- **WHEN** el operador habilita el enriquecimiento para un perfil preparado
- **THEN** el proceso usa únicamente el `study_id`, el checksum, la membresía y el conteo persistidos de ese estudio, y solo puede promover evidencia completa para 30 o 300 tarjetas

#### Scenario: Perfil CSV sin enriquecimiento
- **WHEN** el perfil declara enriquecimiento deshabilitado
- **THEN** la preparación funciona sin credenciales GitHub, no crea una captura live y no inicia un run promovido

## ADDED Requirements

### Requirement: Cuentas locales provisionadas antes de readiness pública

Cada participante configurado SHALL recibir, durante la preparación controlada y después de crear o reutilizar su fila `study_participant`, exactamente una cuenta local vinculada a esa membresía. La provisión SHALL consumir un manifiesto exacto suministrado por el operador mediante un archivo secreto de solo lectura o descriptor, nunca mediante argumentos o logs. La clave visible del participante SHALL conservarse como `javier`, `diego` o `pablo`, mientras que el username de login del estudio actual SHALL ser respectivamente `javier`, `diego`, `pablo` y el del estudio de validación SHALL ser `javier-30`, `diego-30`, `pablo-30`. Una cuenta existente compatible SHALL conservar su hash y `credential_version`; la preparación no SHALL actuar como reset. La cuenta SHALL guardar únicamente un hash Argon2id, su estado habilitado y `credential_version`; nunca una contraseña en texto plano ni una contraseña en `reviewer`. La unicidad de `normalized_username` SHALL ser global entre estudios, con una comprobación de duplicados antes de crear el índice. No SHALL existir registro público, recuperación por correo, MFA, OIDC, JWT, autenticación por cabeceras ni UI administrativa.

#### Scenario: Cuenta vinculada por estudio
- **WHEN** la transacción ya ha creado o reutilizado la membresía y procesa el manifiesto válido del estudio actual o de validación
- **THEN** inserta la cuenta ausente o conserva la cuenta compatible existente, y valida exactamente una cuenta habilitada con hash Argon2id por cada participante configurado y username asignado

#### Scenario: Usernames distintos con la misma persona visible
- **WHEN** `javier` inicia sesión en el estudio actual o `javier-30` inicia sesión en el estudio de validación
- **THEN** cada cuenta conserva la clave visible `javier`, pero crea una sesión asociada a un `study_id` distinto

#### Scenario: Duplicado de username normalizado
- **WHEN** el preflight encuentra usernames normalizados duplicados entre estudios antes de aplicar la unicidad global
- **THEN** la migración o preparación falla sin crear el índice ni mutar datos

#### Scenario: Falta una cuenta
- **WHEN** el manifiesto falta, contiene participantes incompletos o extra, o existe una cuenta deshabilitada, duplicada o vinculada a otra membresía
- **THEN** la preparación revierte las escrituras del intento, preserva los datos previos y permanece no lista

### Requirement: Login y contexto derivado de sesión

El login SHALL aceptar únicamente username y contraseña y SHALL verificar contraseñas con Argon2id. Para username inexistente, contraseña inválida, cuenta deshabilitada o cuenta temporalmente limitada, SHALL devolver el mismo error genérico no enumerante y una respuesta acotada, ejecutando una verificación ficticia equivalente cuando no exista la cuenta. No SHALL revelar si una cuenta existe. Tras un login válido, la aplicación SHALL regenerar el identificador de sesión y derivar exclusivamente de la cuenta y de la sesión validada el `study_id`, la membresía y el participante para todas las rutas protegidas; ningún valor enviado por el cliente ni ningún sufijo textual del username SHALL elegir ese contexto.

#### Scenario: Login válido
- **WHEN** una cuenta habilitada presenta sus credenciales correctas
- **THEN** se crea una sesión válida asociada a esa cuenta, su `study_participant` y su `study_id` persistido, y las rutas protegidas usan ese contexto

#### Scenario: Login actual y de validación
- **WHEN** se presentan credenciales válidas para `javier` o `javier-30`
- **THEN** la sesión usa el estudio persistido de la cuenta correspondiente y nunca calcula el estudio a partir del username

#### Scenario: Sufijo o contexto enviado por el cliente
- **WHEN** un cliente intenta escoger un estudio mediante un sufijo de username, URL, query string, formulario o cabecera
- **THEN** el sistema ignora o rechaza el valor y conserva exclusivamente el `study_id` de la sesión validada

#### Scenario: Fallo de login no enumerante
- **WHEN** se presenta una credencial incorrecta, un username inexistente, una cuenta deshabilitada o una cuenta limitada
- **THEN** se devuelve el mismo fallo genérico sin indicar cuál condición ocurrió

### Requirement: Sesiones opacas y revocación

Las sesiones SHALL ser opacas, almacenarse en PostgreSQL en `app_session` y asociarse a la cuenta, membresía, participante y `study_id` persistido, además de la versión de credenciales. La cookie SHALL contener solo el identificador firmado de sesión y usar `Secure`, `HttpOnly`, `SameSite=Lax` y `Path=/`, sin `Domain`. Cada solicitud protegida SHALL validar la cuenta, la membresía, `study_id`, `credential_version`, ocho horas de inactividad y 24 horas de expiración absoluta. Logout SHALL ser una mutación POST protegida por CSRF, destruir la sesión y limpiar la cookie. Incrementar `credential_version` SHALL revocar las sesiones asociadas.

#### Scenario: Sesión válida y expirada
- **WHEN** una solicitud usa una sesión válida, o una sesión supera ocho horas sin actividad o 24 horas desde su creación
- **THEN** la primera se autoriza con su contexto derivado y las últimas se tratan como no autenticadas

#### Scenario: Logout y cambio de credenciales
- **WHEN** el participante cierra sesión o un procedimiento operativo incrementa `credential_version`
- **THEN** la sesión queda destruida o revocada y sus solicitudes posteriores se rechazan como no autenticadas

### Requirement: Bootstrap y readiness

El sistema MUST ejecutar una preparación one-shot después de que PostgreSQL esté saludable y antes de iniciar la exposición pública. Una preparación con varios perfiles SHALL validar todos los descriptores, CSV, manifiestos, checksums, conteos admitidos, claves de estudio y asignaciones de login antes de cualquier escritura. Después SHALL procesar secuencialmente primero el perfil actual de 300 y después el perfil de validación de 30, crear o reutilizar sus tarjetas y membresías y, en cada transacción, provisionar las cuentas ausentes después de que exista `study_participant`. La readiness SHALL exigir el éxito de la preparación actual, la membresía completa según el `expectedCardCount` persistido y exactamente una cuenta habilitada con hash Argon2id válido por participante. La aplicación SHALL arrancar internamente solo después de confirmar todos los perfiles y Caddy SHALL publicarse solo después de su health satisfactorio.

#### Scenario: Preparación secuencial exitosa
- **WHEN** todos los perfiles y sus insumos son válidos y ambas fases de preparación finalizan correctamente
- **THEN** quedan dos filas `READY`, una de 300 y otra de 30, la aplicación puede quedar saludable y Caddy puede iniciar la exposición pública

#### Scenario: Preparación de un perfil
- **WHEN** se ejecuta la preparación con un único perfil compatible del contrato actual
- **THEN** conserva el comportamiento de `STUDY_CONFIG_INPUT`, prepara el conteo persistido de ese perfil y no requiere un selector de estudio participante

#### Scenario: Drift en el segundo perfil
- **WHEN** el perfil de validación tiene checksum, manifiesto, cuenta o conteo incorrecto después de validar el perfil actual
- **THEN** falla la preparación completa antes de readiness, no borra ni reescribe el estudio actual de 300 y no arranca la aplicación ni Caddy

#### Scenario: Bootstrap fallido
- **WHEN** falla cualquier validación, provisión, comprobación de drift o escritura
- **THEN** se revierte la transacción afectada, se conservan los datos previos y no arrancan la aplicación pública ni Caddy

### Requirement: Volumen existente y volumen limpio

El bootstrap SHALL funcionar tanto en un volumen limpio como en uno existente, preservando datos en ambos casos y sin sembrar labels o instances legacy. En ambos modos SHALL poder preparar el estudio actual de 300 y añadir el estudio de validación de 30 sin reimportación incondicional ni eliminación del estudio existente.

#### Scenario: Volumen existente
- **WHEN** el estudio actual ya tiene tarjetas, cuentas, clasificaciones, categorías, descartes o enriquecimiento promovido
- **THEN** se reutiliza el estado compatible, se conserva su fingerprint y se rechazan conflictos sin sobrescribirlo

#### Scenario: Segundo estudio en volumen existente
- **WHEN** la base contiene el estudio actual compatible y se añade el perfil de validación
- **THEN** se crea o reutiliza únicamente el estudio de validación de 30, sin modificar la membresía ni los resultados del estudio actual

### Requirement: Preservación y drift durante el bootstrap

El bootstrap SHALL validar cada CSV completo antes de escribir, exigir el `expectedCardCount` persistido de 30 o 300 y rechazar cualquier drift de configuración, membresía, cuenta o contenido/checksum de tarjeta. En modo `clean`, SHALL fallar ante objetos legacy sin eliminarlos. En modo `existing`, SHALL requerir la retirada explícita y escalonada con respaldo externo verificable y confirmación operativa. Ningún modo SHALL ejecutar inicialización destructiva ni sobrescribir clasificaciones, cuentas, categorías, descartes, tarjetas o enriquecimiento existente.

#### Scenario: Drift y preservación
- **WHEN** un estudio existente, su CSV, sus cuentas o sus tarjetas difieren de la configuración esperada, o el volumen contiene datos compatibles
- **THEN** un conflicto falla cerrado y conserva los datos previos; el estado compatible se reutiliza sin sobrescribirlo

#### Scenario: Conteo no admitido
- **WHEN** un perfil declara `expectedCardCount` distinto de 30 o 300
- **THEN** la validación falla antes de escribir y no crea ni modifica ninguna fila de estudio

### Requirement: Exportación offline y gate de finalización

El sistema SHALL permitir al operador ejecutar una exportación offline para un `study_key` explícito, en modo de solo lectura y sin ruta HTTP. La exportación SHALL rechazar un estudio desconocido, ambiguo o no `READY`, y SHALL exigir que cada participante configurado tenga todas las tarjetas de su estudio en estado terminal. El paquete SHALL contener `results.csv`, `categories.csv` y `manifest.json`, con checksums, conteo esperado, finalización por participante, procedencia y pseudónimos derivados de un secreto HMAC externo. No SHALL incluir sesiones, hashes de credenciales, tokens, payloads crudos ni datos de throttling.

#### Scenario: Exportación después de completar
- **WHEN** el operador selecciona un estudio `READY` y todos sus participantes han terminado sus 30 o 300 tarjetas
- **THEN** se genera el paquete offline con sus tres archivos, conteos de finalización y checksums reproducibles

#### Scenario: Exportación prematura
- **WHEN** falta una decisión terminal para cualquier participante o tarjeta
- **THEN** la exportación falla sin generar un paquete y no modifica la base

#### Scenario: Exportación web o con secreto ausente
- **WHEN** un cliente solicita `/export`, intenta exportar desde el navegador o el operador no proporciona el secreto HMAC externo
- **THEN** la ruta HTTP no existe o la orden falla sin revelar datos ni producir archivos parciales
