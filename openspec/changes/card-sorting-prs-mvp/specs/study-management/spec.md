## Purpose

Gestionar un estudio local reproducible con configuración JSON, tres participantes por defecto, membresía persistida de las mismas 300 tarjetas y bootstrap seguro sin implementar todavía administración completa.

## ADDED Requirements

### Requirement: Configuración JSON y precedencia

El sistema SHALL aceptar una configuración JSON con `studyKey`, `expectedCardCount` igual a 300 y `participants`. Si no existe configuración explícita, SHALL usar un fallback local de tres participantes. Un estudio activo existente es autoritativo; una configuración explícita solo crea un estudio nuevo y cualquier drift falla sin borrar participantes o tarjetas.

#### Scenario: Configuración por defecto
- **WHEN** se inicia un estudio nuevo sin configuración explícita
- **THEN** se persisten tres participantes y se exige una muestra de 300 tarjetas

#### Scenario: Estudio existente
- **WHEN** existe un estudio activo con configuración persistida y la configuración local difiere
- **THEN** la configuración persistida sigue siendo autoritativa y el bootstrap falla por drift sin eliminar datos

### Requirement: Misma muestra para cada participante

El sistema MUST persistir `study_card` como membresía canónica y asociar las mismas 300 tarjetas a cada participante activo mediante el estudio, no mediante copias o colas distintas.

#### Scenario: Cobertura completa
- **WHEN** los tres participantes recorren sus colas
- **THEN** cada uno recibe cada PR una vez como pendiente hasta clasificarlo

### Requirement: Progreso independiente

El sistema SHALL mostrar el avance del participante actual sin mostrar categorías ni respuestas de los demás.

#### Scenario: Avance parcial
- **WHEN** un participante ha completado 25 tarjetas
- **THEN** ve 25 completadas y las restantes pendientes, sin revelar el avance de otra persona

### Requirement: Cuentas locales provisionadas antes de readiness pública

Cada participante configurado SHALL recibir, durante la preparación controlada y después de crear o reutilizar su fila `study_participant`, exactamente una cuenta local vinculada a esa membresía. La provisión SHALL consumir un manifiesto exacto suministrado por el operador mediante un archivo secreto de solo lectura o descriptor, nunca mediante argumentos o logs. Una cuenta existente compatible SHALL conservar su hash y `credential_version`; la preparación no SHALL actuar como reset. La cuenta SHALL guardar únicamente un hash Argon2id, su estado habilitado y `credential_version`; nunca una contraseña en texto plano ni una contraseña en `reviewer`. No SHALL existir registro público, recuperación por correo, MFA, OIDC, JWT, autenticación por cabeceras ni UI administrativa.

#### Scenario: Cuenta vinculada
- **WHEN** la transacción ya ha creado o reutilizado la membresía y procesa el manifiesto válido
- **THEN** inserta la cuenta ausente o conserva la cuenta compatible existente y valida exactamente una cuenta habilitada con hash Argon2id por participante

#### Scenario: Falta una cuenta
- **WHEN** el manifiesto falta, contiene participantes incompletos o extra, o existe una cuenta deshabilitada, duplicada o vinculada a otra membresía
- **THEN** la preparación revierte las escrituras del intento, preserva los datos previos y permanece no lista

### Requirement: Login y contexto derivado de sesión

El login SHALL aceptar únicamente username y contraseña y SHALL verificar contraseñas con Argon2id. Para username inexistente, contraseña inválida, cuenta deshabilitada o cuenta temporalmente limitada, SHALL devolver el mismo error genérico no enumerante y una respuesta acotada, ejecutando una verificación ficticia equivalente cuando no exista la cuenta. No SHALL revelar si una cuenta existe. Tras un login válido, la aplicación SHALL regenerar el identificador de sesión y derivar exclusivamente de la sesión validada el estudio, la membresía y el participante para todas las rutas protegidas; ningún valor enviado por el cliente SHALL elegir ese contexto.

#### Scenario: Login válido
- **WHEN** una cuenta habilitada presenta sus credenciales correctas
- **THEN** se crea una sesión válida asociada a esa cuenta y a su `study_participant`, y las rutas protegidas usan ese contexto

#### Scenario: Fallo de login no enumerante
- **WHEN** se presenta una credencial incorrecta, un username inexistente, una cuenta deshabilitada o una cuenta limitada
- **THEN** se devuelve el mismo fallo genérico sin indicar cuál condición ocurrió

### Requirement: Sesiones opacas y revocación

Las sesiones SHALL ser opacas, almacenarse en PostgreSQL en `app_session` y asociarse a la cuenta, membresía y versión de credenciales. La cookie SHALL contener solo el identificador firmado de sesión y usar `Secure`, `HttpOnly`, `SameSite=Lax` y `Path=/`, sin `Domain`. Cada solicitud protegida SHALL validar la cuenta, la membresía, `credential_version`, ocho horas de inactividad y 24 horas de expiración absoluta. Logout SHALL ser una mutación POST protegida por CSRF, destruir la sesión y limpiar la cookie. Incrementar `credential_version` SHALL revocar las sesiones asociadas.

#### Scenario: Sesión válida y expirada
- **WHEN** una solicitud usa una sesión válida, o una sesión supera ocho horas sin actividad o 24 horas desde su creación
- **THEN** la primera se autoriza con su contexto derivado y las últimas se tratan como no autenticadas

#### Scenario: Logout y cambio de credenciales
- **WHEN** el participante cierra sesión o un procedimiento operativo incrementa `credential_version`
- **THEN** la sesión queda destruida o revocada y sus solicitudes posteriores se rechazan como no autenticadas

### Requirement: Bootstrap y readiness

El sistema MUST ejecutar una preparación one-shot después de que PostgreSQL esté saludable y antes de iniciar la exposición pública. Tras validar configuración, CSV y manifiesto sin escribir, SHALL crear o reutilizar estudio, tarjetas y membresías y, en la misma transacción, provisionar las cuentas ausentes después de que exista `study_participant`. La readiness SHALL exigir el éxito de la preparación actual, exactamente 300 tarjetas, membresía completa y exactamente una cuenta habilitada con hash Argon2id válido por participante. La aplicación SHALL arrancar internamente después del commit y Caddy SHALL publicarse solo después de su health satisfactorio.

#### Scenario: Bootstrap exitoso
- **WHEN** todas las validaciones y escrituras coordinadas finalizan correctamente
- **THEN** la transacción marca `READY` y confirma, la aplicación puede quedar saludable y Caddy puede iniciar la exposición pública

#### Scenario: Bootstrap fallido
- **WHEN** falla cualquier validación, provisión, comprobación de drift o escritura
- **THEN** se revierte la transacción completa, se conservan los datos previos y no arrancan la aplicación pública ni Caddy

### Requirement: Volumen existente y volumen limpio

El bootstrap SHALL funcionar tanto en un volumen limpio como en uno existente, preservando datos en ambos casos y sin sembrar labels o instances legacy. No SHALL ejecutar una reimportación incondicional.

#### Scenario: Volumen existente
- **WHEN** el estudio ya tiene tarjetas o clasificaciones
- **THEN** se reutiliza el estado compatible y se rechazan conflictos sin sobrescribirlo

### Requirement: Preparación para fuente GitHub

El CSV SHALL ser la única fuente de selección de la muestra. El sistema SHALL conservar el origen y snapshot de cada tarjeta y permitir que una futura importación GitHub sustituya el proveedor CSV sin cambiar el flujo del estudio. El runtime de clasificación SHALL usar snapshots locales y no realizar llamadas GitHub.

#### Scenario: Origen CSV
- **WHEN** el estudio se crea desde el CSV
- **THEN** cada tarjeta registra `CSV` como fuente y queda disponible para el proveedor futuro

### Requirement: Preservación y drift durante el bootstrap

El bootstrap SHALL validar el CSV completo antes de escribir, exigir exactamente 300 `source_card_id` únicos y rechazar cualquier drift de configuración, membresía, cuenta o contenido/checksum de tarjeta. En modo `clean`, SHALL fallar ante objetos legacy sin eliminarlos. En modo `existing`, SHALL requerir la retirada explícita y escalonada con respaldo externo verificable y confirmación operativa. Ningún modo SHALL ejecutar inicialización destructiva ni sobrescribir clasificaciones, cuentas o tarjetas existentes.

#### Scenario: Drift y preservación
- **WHEN** un estudio existente, su CSV, sus cuentas o sus tarjetas difieren de la configuración esperada, o el volumen contiene datos compatibles
- **THEN** un conflicto falla cerrado y conserva los datos previos; el estado compatible se reutiliza sin sobrescribirlo
