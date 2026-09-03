## Purpose

Permitir que participantes persistidos clasifiquen las mismas 300 tarjetas con categorías planas privadas y exactamente una clasificación por tarjeta y participante, sin que el bootstrap cree respuestas.

## ADDED Requirements

### Requirement: Contexto de sesión autoritativo

Toda ruta protegida y toda mutación del estudio SHALL derivar el participante y el estudio exclusivamente de una sesión de servidor validada. El sistema MUST ignorar y no usar identificadores de participante o estudio recibidos en la URL, query string, formulario o cabeceras del cliente, y MUST rechazar el acceso si la sesión no está autenticada, ha expirado o no es válida.

#### Scenario: Acceso sin sesión
- **WHEN** un cliente solicita una cola, categorías, tarjetas, clasificaciones, progreso u observaciones sin una sesión autenticada válida
- **THEN** el sistema deniega la operación y no revela datos ni escribe cambios

#### Scenario: Identificador de otro participante
- **WHEN** un cliente autenticado incluye en la URL, query string, formulario o cabeceras el identificador de otro participante o estudio
- **THEN** el sistema usa únicamente el contexto de la sesión, deniega cualquier intento de acceder o mutar datos ajenos y no realiza ninguna mutación

#### Scenario: URL antigua con participante
- **WHEN** un cliente solicita una ruta antigua que selecciona al participante mediante la URL
- **THEN** el sistema deniega la solicitud o la trata como una ruta no protegida inexistente, sin cargar ni modificar datos de ningún participante

### Requirement: Categorías privadas por participante

El sistema SHALL permitir crear, renombrar y reutilizar categorías planas asociadas al participante derivado de la sesión, sin compartirlas con otros participantes.

#### Scenario: Categorías similares
- **WHEN** dos participantes crean `Missing tests` y `Falta de pruebas`
- **THEN** el sistema conserva dos categorías independientes y cada una solo aparece a su creador

### Requirement: Una clasificación por PR y participante

El sistema MUST conservar como máximo una clasificación vigente para cada combinación de PR y participante.

#### Scenario: Clasificación normal
- **WHEN** el participante selecciona una categoría y guarda el PR
- **THEN** el sistema registra una sola categoría y permite avanzar a la siguiente tarjeta

#### Scenario: Corrección antes de terminar
- **WHEN** el participante vuelve a un PR ya clasificado
- **THEN** puede actualizar su categoría y observación sin modificar la respuesta de otro participante

### Requirement: Clasificación con observación opcional

El sistema SHALL permitir guardar una observación textual junto a la categoría, sin exigir todavía confianza ni resultados especiales.

#### Scenario: Observación de causa
- **WHEN** el participante clasifica un PR y escribe una observación
- **THEN** la observación queda asociada a su clasificación y permanece oculta para los demás participantes

### Requirement: Protección CSRF y origen

Toda acción que cree, renombre, actualice o elimine categorías, clasificaciones u observaciones MUST exigir un token CSRF sincronizador válido, asociado a la sesión autenticada, y un origen permitido. El sistema MUST validar ambos controles antes de iniciar cualquier mutación.

#### Scenario: Token CSRF ausente o inválido
- **WHEN** una mutación llega sin token CSRF, con un token inválido o con un token perteneciente a otra sesión
- **THEN** el sistema deniega la operación y no crea, renombra, actualiza ni elimina ningún dato

#### Scenario: Origen ausente o no permitido
- **WHEN** una mutación llega sin origen válido o desde un origen no permitido
- **THEN** el sistema deniega la operación y no realiza ninguna mutación, aunque el token CSRF sea válido

#### Scenario: Sesión cruzada
- **WHEN** un cliente combina un token CSRF, cookies o contexto de sesión de participantes distintos
- **THEN** el sistema deniega la operación y no acepta ni persiste datos para ninguno de los dos participantes

### Requirement: Cola común de tarjetas

El sistema SHALL leer los mismos 300 PR desde la membresía `study_card` para cada participante y excluir de su cola únicamente los PR que el participante derivado de la sesión ya haya clasificado.

#### Scenario: Tres participantes
- **WHEN** tres participantes comienzan el estudio local
- **THEN** cada uno puede recorrer las 300 tarjetas de forma independiente

### Requirement: Guardado y progreso

El sistema MUST guardar la clasificación y actualizar el progreso de forma atómica, y SHALL recuperar el avance cuando el participante vuelva a entrar.

#### Scenario: Reanudación
- **WHEN** un participante cierra la aplicación después de clasificar parte de la muestra
- **THEN** al volver conserva sus categorías, respuestas y número de tarjetas completadas

### Requirement: Bootstrap no crea categorías ni clasificaciones

El bootstrap SHALL crear solo la estructura del estudio, participantes, tarjetas y membresía. Las categorías y clasificaciones MUST ser creadas por acciones explícitas del participante y permanecer privadas.

#### Scenario: Estudio recién preparado
- **WHEN** termina el bootstrap de las 300 tarjetas
- **THEN** cada participante tiene 300 tarjetas pendientes y ningún catálogo o clasificación sembrado

### Requirement: Aislamiento del flujo local

El flujo de clasificación MUST operar sin selector de participantes. Las categorías, cola, tarjetas, clasificaciones, observaciones, progreso y mutaciones SHALL ser privadas y derivadas del contexto de sesión validado.

#### Scenario: Sesiones independientes
- **WHEN** dos participantes autenticados consultan o modifican el estudio
- **THEN** cada uno carga únicamente sus categorías, sus PR pendientes, sus clasificaciones, sus observaciones y su progreso, sin afectar al otro
