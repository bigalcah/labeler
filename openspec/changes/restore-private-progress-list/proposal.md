## Why

La pantalla de progreso necesita volver a ofrecer una vista navegable de todas las tarjetas asignadas sin recuperar la superficie legacy ni permitir que el navegador elija la identidad del estudio. El contrato de `card-sorting-prs-mvp` ya establece que el `study_id` y el `participant_id` proceden de una sesión de servidor validada y que las categorías, clasificaciones, descartes y observaciones son privadas.

La bienvenida anónima de Home también necesita una corrección visual acotada. Debe quedar centrada horizontal y verticalmente sin cambiar la Home autenticada ni introducir CSS propio.

## What Changes

- Definir una lista paginada y privada en `GET /progress`, con `page=1`, `limit=20`, límite máximo de `100` y páginas fuera de rango que responden `200` con un estado vacío.
- Derivar siempre `study_id` y `participant_id` del contexto de sesión validado, ordenar por `study_card.ordinal` y mostrar únicamente el estado privado del participante actual.
- Mostrar un resumen privado con todas las categorías actuales del participante en el estudio de sesión, incluso las que tengan cero usos, el conteo de PRs `CLASSIFIED` por categoría sobre todo el estudio asignado y las tarjetas agrupadas bajo su categoría en orden ascendente de `study_card.ordinal`. Cada tarjeta del resumen enlaza canónicamente a `/queue/:id`; el resumen no depende de la página ni del límite de la lista paginada de todas las tarjetas, tampoco en una página fuera de rango.
- Renderizar enlaces canónicos `/queue/:id`, controles de paginación accesibles y los estados `PENDING`, `CLASSIFIED` y `DISCARDED`, sin selectores ni parámetros de identidad.
- Centrar la bienvenida anónima de Home con utilidades Bootstrap existentes y conservar explícitamente la estructura, identidad, enlaces y geometría de Home autenticada.
- Añadir regresiones HTTP y de navegador para privacidad, resumen por categoría incluyendo categorías sin uso, independencia de paginación, agrupación única, enlaces canónicos, normalización, orden, páginas vacías, ausencia de `/instances` y geometría anónima.

## Capabilities

### New Capabilities

- `private-progress-list`: Lista paginada de tarjetas asignadas, estado privado y resumen completo agrupado por categorías dentro de `/progress`.
- `anonymous-home-centering`: Centrado Bootstrap-only de la bienvenida anónima sin alterar Home autenticada.

## Impact

- La implementación posterior afectará al repositorio de lectura del estudio, su servicio, la ruta y la vista de `/progress`, además de sus regresiones HTTP y de navegador.
- La implementación posterior afectará únicamente la rama anónima de `views/index.ejs` y su regresión visual; el contrato de Home autenticada permanece vigente.
- No se cambiarán `schema`, migraciones SQL, dependencias, configuración ni hojas CSS. No se restaurarán `/instances`, selectores de participante o estudio, resúmenes globales ni exportación web.
- Esta tarea solo crea el contrato OpenSpec y la evidencia de baseline. No incluye cambios de producto, pruebas de runtime ni evidencia inventada de ejecución.
