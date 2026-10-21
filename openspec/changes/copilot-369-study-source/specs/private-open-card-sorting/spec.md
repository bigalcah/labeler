# Clasificación privada de la muestra activa

## MODIFIED Requirements

### Requirement: Categorías privadas por participante

El sistema SHALL conservar el flujo actual para crear, renombrar y reutilizar categorías planas
privadas por participante y estudio, sin compartirlas con otras personas.

#### Scenario: Categorías similares

- **WHEN** dos participantes crean categorías con nombres similares o distintos
- **THEN** cada persona conserva su propia categoría privada y no puede ver ni modificar la de la otra

### Requirement: Una clasificación por PR y participante

El sistema MUST conservar como máximo una clasificación vigente por combinación de estudio, PR y participante.

#### Scenario: Clasificación normal

- **WHEN** el participante selecciona una categoría y guarda la tarjeta
- **THEN** se registra una clasificación terminal con exactamente una categoría plana y puede avanzar

#### Scenario: Corrección antes de terminar

- **WHEN** el participante vuelve a una tarjeta ya clasificada
- **THEN** puede actualizar su categoría y observación sin modificar la respuesta de otro participante

### Requirement: Clasificación con observación opcional

El sistema SHALL conservar el flujo actual de categoría, definición/descripción y observaciones
opcionales. MUST NOT exigir `event_key` ni campos SHA nuevos.

#### Scenario: Observación de causa

- **WHEN** el participante clasifica un PR e incluye una observación
- **THEN** la observación queda asociada a su clasificación privada

#### Scenario: Guardado sin observación

- **WHEN** el participante clasifica un PR sin observación
- **THEN** se guarda la clasificación sin exigir campos adicionales

### Requirement: Cola común de tarjetas

El sistema SHALL asignar los mismos 369 PR, en el mismo orden, a cada participante del estudio
primario y conservar las 30 tarjetas y el orden existente del estudio de validación. Cada participante
debe clasificar o descartar privadamente cada PR de su estudio; no se añaden tarjetas de reserva.

#### Scenario: Tres participantes

- **WHEN** tres participantes comienzan el estudio primario de 369 PR
- **THEN** cada uno puede recorrer las mismas 369 tarjetas en el mismo orden, de forma independiente

#### Scenario: Decisiones de validación

- **WHEN** un participante completa el estudio de validación existente
- **THEN** su flujo sigue cubriendo las mismas 30 tarjetas sin cambio de muestra

#### Scenario: Historial excluido de la cola activa

- **WHEN** la primaria activa de 369 conserva referencias históricas de su muestra de 300
- **THEN** esas referencias no añaden tarjetas, progreso, decisiones ni elegibilidad de exportación a la muestra activa

#### Scenario: Procedencia de una decisión posterior al cutover

- **WHEN** se guarda una decisión nueva en la primaria de 369 sin promoción de su fuente activa
- **THEN** no se vincula a un run de la fuente anterior ni a respuestas del estudio de 30

### Requirement: Guardado y progreso

El sistema MUST guardar cada decisión y su progreso de forma atómica y recuperar al regreso el avance
del participante en el mismo estudio.

#### Scenario: Reanudación

- **WHEN** el participante vuelve tras guardar algunas decisiones
- **THEN** recupera sus categorías, clasificaciones, descartes y progreso privados

### Requirement: Aislamiento del flujo local

El participante y el estudio SHALL derivarse de la identidad autenticada y su contexto de sesión; las
rutas MUST NOT permitir elegir ni consultar los datos privados de otra persona. Las categorías
permanecen privadas y una decisión `CLASSIFIED` tiene exactamente una categoría plana. Los descartes
siguen siendo privados y terminales conforme al flujo actual.

#### Scenario: Cambio de participante

- **WHEN** una solicitud intenta seleccionar un participante distinto del asociado a la sesión autenticada
- **THEN** se rechaza y solo se permiten consultas o cambios de los datos del estudio autorizado por la sesión

#### Scenario: Descarte privado

- **WHEN** una persona descarta una tarjeta
- **THEN** el descarte es privado, cuenta como su decisión terminal y no genera reemplazo
