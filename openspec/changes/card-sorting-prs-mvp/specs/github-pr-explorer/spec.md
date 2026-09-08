## ADDED Requirements

### Requirement: Inspección dentro de la sesión del participante
El sistema MUST permitir inspeccionar una tarjeta únicamente dentro de una sesión autenticada y validada del participante. El PR actual y el contexto de progreso MUST derivarse de esa sesión, sin aceptar un participante seleccionado por el cliente ni parámetros de participante en la URL.

#### Scenario: Sesión ausente o no válida
- **WHEN** una persona intenta abrir la tarjeta sin una sesión autenticada y validada
- **THEN** el sistema no muestra la tarjeta ni el contexto de progreso y solicita autenticación

#### Scenario: Contexto derivado de la sesión
- **WHEN** un participante autenticado abre la tarjeta actual
- **THEN** el sistema muestra el PR actual y su progreso a partir de la sesión del participante, sin usar una identidad proporcionada por el cliente

#### Scenario: Privacidad entre participantes
- **WHEN** un participante inspecciona una tarjeta
- **THEN** no aparecen categorías, clasificaciones, observaciones ni progreso de otros participantes

### Requirement: Estado de ciclo de vida accesible

El sistema SHALL mostrar siempre el estado de ciclo de vida como texto visible y visualmente distinguible, sin depender únicamente del color. La presentación SHALL cubrir explícitamente `OPEN`, `CLOSED`, `MERGED` y `UNAVAILABLE`, y el texto normal SHALL cumplir contraste mínimo WCAG AA.

#### Scenario: Estados disponibles
- **WHEN** el participante abre tarjetas con estado `OPEN`, `CLOSED` o `MERGED`
- **THEN** cada tarjeta muestra literalmente su estado y una distinción visual adicional a la diferencia cromática

#### Scenario: Estado no disponible
- **WHEN** el estado de ciclo de vida no existe o no puede determinarse
- **THEN** la tarjeta muestra literalmente `UNAVAILABLE` con la misma información textual y contraste WCAG AA
