# Contribuir

Antes de cambiar código, revisa `AGENTS.md`, el estado OpenSpec y el worktree sucio. Un cambio documentation-only no
modifica runtime, dependencias, configuración ejecutable, SQL, bases, contenedores ni volúmenes.

JavaScript usa ESM, cuatro espacios, comillas dobles, punto y coma y prefijo `_` para nombres no usados. SQL usa
`snake_case` y conserva separación legacy entre definiciones e implementaciones.

Actualiza proposal/design/tasks coherentemente antes de cambios de comportamiento. Para documentación, actualiza la
matriz de estados y `JAVASCRIPT-API.md`. Ejecuta lint Markdown, enlaces, escaneo de secretos y validación OpenSpec; no
ejecutes minify como comprobación.

Trabaja en ramas feature basadas en `develop`. Los commits son Conventional Commits en español con cuerpo explicativo.
No incluyas secretos ni cambios ajenos. No hagas commit o push sin aprobación explícita.
