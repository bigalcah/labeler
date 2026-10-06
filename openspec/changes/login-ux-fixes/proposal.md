## Why

La página pública de login hereda el header compartido aunque la persona todavía no tiene una sesión, por lo que expone navegación que pertenece al flujo privado. Además, su layout responsive deja que el botón Start! tenga un ancho distinto al de los controles del formulario en viewport grandes. La corrección debe conservar el comportamiento de autenticación ya aprobado, incluidos los avisos, CSRF, la redirección a la cola y el footer.

## What Changes

- Renderizar el `/login` anónimo sin el header compartido, la navegación SEART ni enlaces o acciones hacia `/queue`, `/progress` o `/logout`.
- Presentar el formulario dentro de una única card centrada en el área principal disponible, usando solamente el lenguaje visual y las utilidades Bootstrap existentes.
- Hacer que el botón Start! tenga el mismo ancho renderizado que el input-group de username y el input de password en viewport de 375, 768 y 1280 píxeles.
- Mantener los avisos de autenticación y CSRF, el token CSRF, las etiquetas, los atributos autocomplete, el footer y la semántica de autenticación existentes.
- Mantener la redirección de un login válido a `/queue`, junto con la identidad del participante y el cierre de sesión en las vistas privadas.
- Añadir pruebas de regresión failing-first para el shell público, el layout responsive, los estados de error y el flujo completo de login a `/queue`.

## Capabilities

### New Capabilities

- `login-flow`: Presentación estable de errores de autenticación y navegación del participante autenticado hacia sus tarjetas.

### Modified Capabilities

Ninguna. Las specs existentes no definen requisitos de autenticación o navegación de entrada.

## Impact

- Afecta la plantilla EJS del formulario y las pruebas HTTP y de navegador del login.
- Reutiliza la sesión ya creada y el flujo existente de `/queue`; la ruta POST conserva sus semánticas de autenticación y CSRF.
- No requiere cambios de base de datos, dependencias, hojas CSS, APIs externas ni del header compartido usado por las vistas privadas.
