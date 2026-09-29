## Purpose

Esta capability define el ajuste visual de la bienvenida pública de Home. Solo el estado anónimo se centra con utilidades Bootstrap existentes. La Home autenticada conserva el contrato de sesión y su geometría actual.

## ADDED Requirements

### Requirement: Bienvenida anónima centrada con Bootstrap

Cuando `/` no tiene una sesión válida, la bienvenida SHALL ocupar el área principal disponible y SHALL quedar centrada horizontal y verticalmente mediante utilidades Bootstrap existentes. La solución MUST NOT añadir CSS personalizado, estilos inline, posiciones absolutas, media queries, JavaScript de layout ni dependencias nuevas.

#### Scenario: Home sin sesión en tres viewports

- **WHEN** una persona sin sesión válida abre Home en `375x800`, `768x800` y `1280x800`
- **THEN** el centro del contenido de bienvenida queda a no más de `2 CSS px` del centro del viewport en ambos ejes y no existe overflow horizontal

#### Scenario: Sesión inválida como estado anónimo

- **WHEN** una persona abre Home con una sesión ausente, inválida o expirada
- **THEN** Home usa la rama anónima centrada y no deriva identidad ni acciones privadas de datos enviados por el cliente

### Requirement: Home autenticada preservada

La corrección anónima MUST preservar la Home autenticada definida por `authenticated-home-login-layout`. Con una sesión válida, la página SHALL conservar el header compartido, la identidad del participante, el cierre de sesión, los accesos existentes, las tarjetas, el marcado y la geometría de los elementos autenticados.

#### Scenario: Home autenticada sin cambio visual

- **WHEN** un participante con sesión válida abre Home en `375x800`, `768x800` y `1280x800`
- **THEN** se conserva la estructura y la posición de `header`, la primera fila de marca y la rejilla autenticada con tolerancia de `0px` en `top`, `left`, `width` y `height`

#### Scenario: Identidad autenticada no sustituible

- **WHEN** una sesión válida solicita Home junto con parámetros, formulario o cabeceras que contienen otra identidad
- **THEN** Home conserva la identidad y los controles de la sesión validada, sin mostrar la identidad suministrada por el cliente ni cambiar la rama autenticada
