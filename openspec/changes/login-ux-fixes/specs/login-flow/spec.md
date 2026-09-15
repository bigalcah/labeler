## Purpose

Definir una entrada de login clara y estable para que los participantes puedan corregir errores sin perder la posición del formulario y comenzar directamente su recorrido privado de tarjetas.

## ADDED Requirements

### Requirement: Error de login con layout estable

El sistema SHALL mostrar los errores de autenticación o de expiración del formulario por encima del formulario de login, sin cambiar la posición horizontal de sus campos ni de su acción principal. La alerta SHALL conservar su rol accesible y su relación con el formulario.

#### Scenario: Credenciales inválidas

- **WHEN** una persona envía el formulario con un usuario o contraseña inválidos
- **THEN** la respuesta muestra un mensaje de error encima del formulario y los campos de usuario, contraseña y envío permanecen alineados como en el estado sin error

#### Scenario: Formulario CSRF expirado

- **WHEN** una persona envía un formulario de login cuyo token ya no es válido
- **THEN** la respuesta muestra el mensaje de expiración encima del formulario, conserva el mismo alineamiento horizontal de los controles y no intenta autenticar las credenciales

### Requirement: Shell público de login

Una solicitud anónima a `/login` SHALL renderizar el formulario sin el header compartido, la navegación SEART ni enlaces o acciones hacia `/queue`, `/progress` o `/logout`. La página SHALL conservar el footer.

#### Scenario: Persona anónima abre login

- **WHEN** una persona sin una sesión válida solicita `GET /login`
- **THEN** la respuesta es la página pública de login con su footer, no contiene un header compartido ni navegación SEART y no emite referencias a `/queue`, `/progress` o `/logout`

### Requirement: Card centrada y ancho responsive del formulario

La página pública SHALL presentar el formulario dentro de una única card centrada en el área principal disponible entre el contenido de la página y el footer, usando únicamente el lenguaje visual y las utilidades Bootstrap existentes. El input-group de username, el input de password y el botón Start! SHALL tener el mismo ancho renderizado.

#### Scenario: Login conserva una geometría común en los viewport aprobados

- **WHEN** un navegador renderiza `/login` con viewport de 375, 768 o 1280 píxeles de ancho
- **THEN** la card permanece centrada en el área principal disponible, no hay overflow horizontal y el ancho renderizado de Start! es igual al del input-group de username y al del input de password

### Requirement: Controles y semántica de autenticación preservados

El sistema SHALL conservar los avisos de autenticación y CSRF, el token oculto `csrf_token`, las etiquetas de username y password, los atributos `autocomplete` del formulario y sus campos, el footer y la semántica de autenticación existente. Un login válido SHALL crear la sesión y redirigir a `/queue`; las credenciales inválidas y los tokens CSRF inválidos SHALL conservar sus respuestas y no crear una sesión autenticada.

#### Scenario: Formulario público conserva sus controles

- **WHEN** una persona anónima abre `/login`
- **THEN** la respuesta contiene el formulario POST hacia `/login`, las etiquetas de Username y Password, `autocomplete="on"`, `autocomplete="username"`, `autocomplete="current-password"` y un campo oculto `csrf_token`

#### Scenario: Login válido conserva el flujo autenticado

- **WHEN** una persona envía credenciales válidas junto con un token CSRF válido
- **THEN** el sistema crea la sesión autenticada, limpia el contexto CSRF de login y redirige a `/queue`

#### Scenario: Fallos de autenticación conservan alertas y protección

- **WHEN** una persona envía credenciales inválidas o un token CSRF inválido o expirado
- **THEN** el sistema conserva la respuesta de fallo y su alerta correspondiente, no crea una sesión autenticada y mantiene la validación previa de CSRF

### Requirement: Login autenticado inicia la cola de tarjetas

El sistema MUST crear la sesión autenticada y dirigir el navegador al punto de entrada de la cola de tarjetas después de un login válido, en lugar de devolverlo a la pantalla inicial pública.

#### Scenario: Existen tarjetas pendientes

- **WHEN** una persona completa el login con credenciales válidas y tiene una tarjeta pendiente
- **THEN** el navegador sigue la redirección a la cola y llega a la primera tarjeta pendiente de esa persona

#### Scenario: No existen tarjetas pendientes

- **WHEN** una persona completa el login con credenciales válidas y ya no tiene tarjetas pendientes
- **THEN** el navegador sigue la redirección a la cola y recibe la vista de finalización con su progreso

### Requirement: Identidad del participante autenticado

El flujo privado de tarjetas SHALL mostrar en su área de navegación la identidad del participante autenticado y una acción para cerrar sesión, sin exponer esos controles en el formulario de login público.

#### Scenario: Participante entra al flujo privado

- **WHEN** una persona llega a la cola con una sesión válida
- **THEN** la navegación muestra su nombre de participante y el control de cierre de sesión en el extremo reservado para la identidad del usuario

#### Scenario: Visitante ve el formulario público

- **WHEN** una persona sin sesión válida abre el login
- **THEN** no se muestra una identidad de participante, una acción de cierre de sesión, el header compartido, la navegación SEART ni enlaces o acciones hacia `/queue` o `/progress`, y el footer permanece visible
