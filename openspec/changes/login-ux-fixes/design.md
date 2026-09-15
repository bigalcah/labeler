## Context

La aplicación usa Express con rutas definidas por archivos, vistas EJS y Bootstrap, y el middleware de sesión se ejecuta antes de las rutas. Actualmente `views/login.ejs` incluye siempre `partials/header`, conserva el footer, apila el aviso sobre el formulario y usa `d-grid d-lg-block` para la acción principal. El header compartido emite la marca y navegación SEART, además de los accesos a `/queue` y `/progress` y, cuando hay contexto de sesión, el formulario de `/logout`. La ruta POST ya crea la sesión autenticada y redirige a `/queue`; la ruta `/queue` resuelve la primera tarjeta pendiente o la vista de finalización.

## Goals / Non-Goals

**Goals:**

- Hacer que la respuesta anónima de `/login` no incluya el header compartido ni navegación privada, manteniendo el footer.
- Colocar una única card centrada en el área principal disponible entre el inicio del contenido y el footer.
- Mantener el aviso por encima del formulario y conseguir que username, password y Start! compartan el mismo ancho renderizado en 375, 768 y 1280 píxeles.
- Preservar controles, accesibilidad, CSRF, cookies, límites de autenticación y redirección existentes.
- Verificar el estado anónimo, los errores, el flujo autenticado completo y los tres viewport solicitados.

**Non-Goals:**

- Rediseñar la pantalla inicial pública o convertir `/` en una ruta autenticada.
- Cambiar cookies, expiración, validación CSRF, consultas de sesión, estados de respuesta o el esquema de base de datos.
- Modificar el header compartido para las vistas privadas o el flujo de clasificación.
- Añadir CSS, dependencias de frontend, otro sistema de layout o una navegación alternativa para `/login`.

## Decisions

### Usar un shell público propio para `/login`

La plantilla de login no incluirá el header compartido. Así la respuesta anónima no puede emitir la navegación SEART ni accesos a `/queue`, `/progress` o `/logout`; las vistas privadas seguirán reutilizando el header sin cambios. El footer permanecerá en el shell de página.

La alternativa de ocultar enlaces del header mediante CSS o JavaScript se descarta porque seguiría emitiendo contenido privado y dependería del estado visual del navegador.

### Mantener el aviso fuera de la fila de controles

El contenedor exterior del login apilará el aviso y la card, mientras que la rejilla Bootstrap del formulario seguirá gobernando la alineación de username, password y envío. El aviso permanecerá en el flujo accesible del documento y por encima del formulario.

La alternativa de posicionar el aviso con CSS absoluto se descarta porque obligaría a reservar espacio de forma frágil y podría cambiar el orden accesible.

### Centrar una card con Bootstrap existente

El área `main` ocupará el espacio disponible del body flex entre el contenido y el footer, y usará únicamente clases Bootstrap existentes para centrar horizontal y verticalmente la card. La card tendrá un ancho responsive limitado por la rejilla Bootstrap, sin estilos inline, hoja nueva ni dependencia adicional.

Dentro de la card, el input-group de username, el input de password y el contenedor de la acción usarán la misma columna de contenido. Se eliminará el cambio de `d-grid` a `d-lg-block`, de modo que Start! conserve el ancho completo de esa columna en 375, 768 y 1280 píxeles.

La alternativa de fijar anchos con CSS propio se descarta porque duplica las utilidades Bootstrap y puede divergir de los breakpoints existentes.

### Redirigir directamente a `/queue`

El POST autenticado dirigirá a `/queue`, que ya centraliza la selección de la primera tarjeta pendiente y la vista de finalización. Así se conserva una sola decisión sobre el estado de la cola y se reutiliza el contexto de sesión que alimenta el header.

La alternativa de hacer que `/` detecte sesiones se descarta porque ampliaría el comportamiento de la pantalla pública y dejaría la navegación posterior duplicada entre la raíz y la cola.

### Preservar la semántica del formulario y la autenticación

El cambio se limitará al shell y al layout visual de `views/login.ejs`. Se conservarán los avisos de credenciales inválidas y CSRF expirado, la relación `aria-describedby`, la acción y método del formulario, el token oculto `csrf_token`, las etiquetas, `autocomplete="on"`, `autocomplete="username"` y `autocomplete="current-password"`. La ruta conservará la validación CSRF previa, la creación y limpieza de cookies de sesión, los estados de credenciales inválidas y rate limiting, y la redirección válida a `/queue`.

La vista privada seguirá asignando el participante desde el contexto de sesión y el header compartido mostrará su nombre y el cierre de sesión; esos controles no se moverán al login público.

### Verificación failing-first y por superficie

Primero se añadirán y ejecutarán pruebas que fallen contra la plantilla actual: una prueba HTTP comprobará el shell anónimo y una prueba de navegador medirá la card y los tres anchos renderizados. Las pruebas también comprobarán alertas, CSRF, labels, autocomplete y el flujo completo de login, cookie y `/queue`. Después se implementará la plantilla y se repetirá la suite. No se requiere migración ni dependencia nueva.

## Risks / Trade-offs

- [Una cookie de sesión no llega al siguiente request] -> Mantener intacta la configuración de sesión y verificar el flujo completo siguiendo la redirección, no solo el código de estado del POST.
- [El texto del error ocupa demasiado espacio en una ventana estrecha] -> Mantener el aviso en el flujo normal y comprobar que envuelve verticalmente sin empujar los controles en horizontal.
- [Un cambio de breakpoint altera el ancho de Start!] -> Medir los tres elementos con un navegador en 375, 768 y 1280 píxeles.
- [La aplicación desplegada no contiene la versión corregida] -> Publicar el cambio con el procedimiento habitual y confirmar la versión antes de la prueba manual.

## Migration Plan

No hay migración de datos ni cambios de configuración. Añadir primero las regresiones failing-first, implementar la plantilla, ejecutar la calidad local y seguir el workflow de release existente. Verificar la página pública y un login autenticado en producción; si fuera necesario revertir, restaurar la imagen o commit anterior de la aplicación sin tocar PostgreSQL.

## Open Questions

Ninguna. La card centrada, el shell sin header compartido y la igualdad de anchos en los tres viewport son decisiones aprobadas para esta revisión.
