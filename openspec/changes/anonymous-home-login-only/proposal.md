## Why

La pantalla Home anónima no debe exponer navegación ni acciones privadas antes de iniciar sesión. Este cambio separa ese contrato de visibilidad del cambio histórico `authenticated-home-login-layout`, que dejó visibles las tarjetas privadas para visitantes, y establece que la reversión es comportamiento observable.

## What Changes

- Mostrar a los visitantes anónimos únicamente la bienvenida y explicación del proyecto, junto con la acción Login, usando este párrafo canónico: `Labeling is a research study for classifying pull requests into categories created by each participant. Your work is private to you. Log in to begin reviewing PR cards and track your progress.`
- Mantener para las personas autenticadas la identidad derivada de la sesión, la navegación privada y las acciones existentes, incluido el cierre de sesión.
- Mantener `/queue` y `/progress` protegidas en backend, independientemente de lo que muestre Home.
- Conservar el lenguaje visual existente de Bootstrap y envolver exactamente `track your progress.` con `text-nowrap` para evitar la viuda de una palabra a 375px, sin CSS propio.
- Tratar `spec.md:9` como la fuente normativa sobre el significado de la bienvenida y como autoridad sobre cualquier texto exacto obsoleto que permanezca en artefactos históricos.
- Añadir o actualizar pruebas HTTP y de navegador para verificar los estados anónimo y autenticado, la visibilidad del header y Home, y el acceso protegido.

## Capabilities

### New Capabilities

- `anonymous-home-login-only`: Home anónima limitada a la bienvenida, explicación del proyecto y Login, con Home autenticada conservando su identidad, navegación y acciones privadas.

### Modified Capabilities

Ninguna. La nueva capability registra por separado el contrato de visibilidad que invierte el comportamiento documentado por `authenticated-home-login-layout`.

## Impact

- Afecta las vistas EJS del header y de Home, además de las pruebas HTTP y de navegador correspondientes.
- No cambia la semántica de sesiones, CSRF, base de datos, dependencias ni routing.
- Mantiene la identidad derivada de la sesión y las acciones privadas existentes para personas autenticadas; `/queue` y `/progress` continúan protegidas en backend.
