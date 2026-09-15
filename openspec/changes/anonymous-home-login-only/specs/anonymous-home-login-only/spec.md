## Purpose

Esta capability define una Home pública y limitada a la bienvenida y Login, sin exponer navegación ni acciones privadas antes de autenticar, y conserva la experiencia completa y la protección del estudio para participantes autenticados.

## ADDED Requirements

### Requirement: Home anónima limitada a bienvenida y Login

La Home SHALL mostrar a las personas anónimas únicamente una bienvenida explicativa y la acción Login. La bienvenida MUST explicar que este es un estudio de investigación para clasificar pull requests en categorías creadas por cada participante, que el trabajo es privado para cada participante y que Login es necesario para comenzar.

#### Scenario: Marcado de bienvenida para persona anónima

- **WHEN** una persona sin una sesión válida solicita Home
- **THEN** Home muestra la bienvenida con la explicación del estudio, la privacidad del trabajo por participante, el requisito de Login para comenzar y la acción Login

#### Scenario: Ausencia de navegación y acciones privadas para persona anónima

- **WHEN** una persona sin una sesión válida solicita Home
- **THEN** el marcado no contiene enlaces ni botones para Queue, tarjetas PR, tarjetas Pending, Progress, identidad de participante, cierre de sesión ni navegación privada contraíble

### Requirement: Home autenticada conserva navegación y acciones completas

La Home SHALL conservar para una persona con una sesión válida Home, PR cards y Queue, Progress, la identidad del participante, el cierre de sesión y las tarjetas de acciones existentes.

#### Scenario: Navegación y acciones de participante autenticado

- **WHEN** una persona con una sesión válida solicita Home
- **THEN** Home muestra Home, PR cards y Queue, Progress, la identidad asociada a la sesión, el cierre de sesión y las tarjetas de acciones existentes

#### Scenario: La sesión válida mantiene el acceso visual privado

- **WHEN** una persona con una sesión válida abre Home
- **THEN** la navegación privada y las acciones existentes permanecen disponibles en la misma experiencia autenticada, sin convertir Home en una bienvenida anónima

### Requirement: Solo una sesión válida habilita la Home autenticada

La Home SHALL determinar el estado autenticado exclusivamente mediante una sesión de servidor válida. Un identificador de participante suministrado por el cliente MUST NOT desbloquear la navegación, la identidad ni las acciones de la Home autenticada.

#### Scenario: Sesión ausente

- **WHEN** una persona solicita Home sin una sesión de servidor
- **THEN** Home se presenta como Home anónima limitada a bienvenida y Login, sin navegación, identidad ni acciones privadas

#### Scenario: Sesión inválida o expirada

- **WHEN** una persona solicita Home con una sesión inválida o expirada
- **THEN** Home se presenta como Home anónima limitada a bienvenida y Login, sin navegación, identidad ni acciones privadas

#### Scenario: Identidad suministrada por el cliente

- **WHEN** una persona sin una sesión válida solicita Home enviando una identidad de participante en parámetros, formulario o cabeceras
- **THEN** la identidad suministrada por el cliente no desbloquea la navegación, la identidad ni las acciones de la Home autenticada, y Home conserva únicamente la bienvenida y Login

### Requirement: Las rutas privadas conservan su protección de backend

Las rutas privadas del estudio SHALL continuar protegidas en backend con independencia de los enlaces y botones visibles en Home. La visibilidad limitada de Home MUST NOT conceder acceso directo a Queue, Progress ni a cualquier otra ruta privada.

#### Scenario: Acceso directo sin sesión a ruta privada

- **WHEN** una persona sin una sesión válida solicita directamente Queue, Progress u otra ruta privada del estudio
- **THEN** el backend rechaza o redirige la solicitud conforme al comportamiento de protección existente y no entrega el contenido privado

#### Scenario: Acceso directo con sesión inválida o expirada

- **WHEN** una persona solicita directamente una ruta privada del estudio con una sesión inválida o expirada
- **THEN** el backend conserva la protección existente y no entrega el contenido privado

#### Scenario: Contrato de Login y destinos sin cambios

- **WHEN** una persona anónima usa la acción Login de Home
- **THEN** la acción conserva el comportamiento y el destino de Login existentes, sin modificar el flujo de autenticación ni los destinos de las rutas
