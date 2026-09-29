## Context

La aplicación usa Express, rutas definidas por archivos, vistas EJS y PostgreSQL. El middleware de sesión valida la cuenta y deja un contexto de sesión disponible antes de las rutas protegidas. El contrato de `card-sorting-prs-mvp` exige que las operaciones privadas se acoten al `study_id` y `participant_id` persistidos en esa sesión, que las categorías sean planas y privadas y que la navegación canónica no incluya identidades en la URL. El contrato de `authenticated-home-login-layout` define la diferencia entre Home anónima y autenticada y debe conservarse.

La ruta actual de progreso conserva el resumen privado, pero el contrato de este cambio añade una lista de la membresía `study_card`. La lista debe permitir continuar hacia la tarjeta canónica sin recuperar `/instances` ni el selector local de participantes.

## Goals / Non-Goals

**Goals:**

- Leer y renderizar todas las tarjetas asignadas al participante autenticado por páginas estables de `study_card.ordinal`.
- Leer todas las categorías actuales del participante en el estudio de sesión, incluso las que tienen cero tarjetas clasificadas, y agrupar bajo cada categoría sus tarjetas `CLASSIFIED` en orden ascendente de `study_card.ordinal`.
- Mantener la lectura completa agrupada independiente de la consulta paginada de todas las tarjetas; incluirla sin cambios también en páginas válidas fuera de rango.
- Normalizar `page` y `limit` con valores predeterminados `1` y `20`, limitar `limit` a `100` y devolver una página vacía con `200` cuando el desplazamiento supera el total.
- Mantener privados el estado, la categoría, el motivo de descarte y el resumen del participante actual.
- Producir únicamente enlaces `/queue/:id` para tarjetas y enlaces de paginación con `page` y `limit`, sin identidad en parámetros.
- Centrar la bienvenida anónima con utilidades Bootstrap existentes y preservar sin cambios observables Home autenticada.
- Dejar una secuencia de implementación y verificación coherente con el plan aprobado.

**Non-Goals:**

- Restaurar `/instances`, `/instances/:id`, rutas con nombre de participante o selectores `participant`, `study` o `reviewer`.
- Aceptar `study_id`, `participant_id`, `reviewer_id` u otra identidad desde query string, path, formulario o cabeceras del cliente.
- Consultar o mostrar categorías, clasificaciones, descartes, observaciones, progreso o resúmenes globales de otro participante o estudio.
- Cambiar la cola, clasificación, descarte, login, logout, CSRF, esquema, migraciones, dependencias, configuración o API externa.
- Añadir JavaScript de paginación en cliente, CSS nuevo, llamadas GitHub, exportación web o una UI administrativa.

## Decisions

### Derivar la identidad exclusivamente de la sesión

La ruta protegida resolverá `study_id` y `participant_id` desde el contexto de sesión validado. El servicio pasará esos valores al repositorio como parámetros de alcance. Los valores de identidad presentes en query, path, body o cabeceras no tendrán autoridad: se ignorarán o se rechazarán de forma explícita, pero nunca cambiarán la consulta ni la vista.

Esta decisión sigue `private-open-card-sorting`, evita el acceso cruzado y hace imposible que un enlace o formulario seleccione otro estudio. Una sesión ausente, expirada o inválida conserva el comportamiento protegido existente y no revela datos.

### Normalizar antes de construir la consulta

`page` y `limit` serán enteros decimales positivos. Un valor ausente, vacío, no entero, no finito o no positivo usará el valor predeterminado correspondiente. Un `limit` válido mayor que `100` se reducirá a `100`. Un `page` válido que exceda el número de páginas se conservará en metadata y devolverá `200` con colección vacía.

El repositorio recibirá el offset y el límite ya normalizados como parámetros enlazados. La consulta devolverá metadata suficiente para el paginador, incluido el total de tarjetas asignadas y la página efectiva. No se interpolarán valores de petición en SQL.

### Orden y proyección privada

La lectura se basará en `study_card` del `study_id` de sesión y ordenará ascendentemente por `study_card.ordinal`. Cada fila incluirá el identificador de tarjeta, ordinal, título, URL canónica y el estado privado del `participant_id` actual. La consulta de estado se acotará también por estudio y participante.

`PENDING` no mostrará decisiones. `CLASSIFIED` mostrará como máximo la única categoría plana propia exigida por el MVP. `DISCARDED` mostrará solo el motivo opcional propio. El resumen existente seguirá siendo del participante actual y no se sustituirá por un resumen global de reviewers.

### Resumen completo agrupado, separado de la página

La operación que obtiene la página de todas las tarjetas y la operación que obtiene el resumen agrupado tendrán alcances y propósitos independientes. La consulta del resumen partirá de las categorías actuales pertenecientes simultáneamente al `study_id` y `participant_id` de la sesión, para que las categorías sin clasificaciones también produzcan un grupo con conteo cero. Las tarjetas agrupadas se limitarán a decisiones `CLASSIFIED` de ese participante en esa membresía de estudio; cada una aparecerá en un único grupo y los grupos de tarjetas se ordenarán por `study_card.ordinal` ascendente.

El resumen abarcará toda la membresía asignada y no recibirá `page`, `limit` ni el resultado de la consulta de página como filtro. Por ello, páginas distintas y una página fuera de rango cambiarán únicamente la lista paginada: categorías, conteos y grupos completos permanecerán iguales. Los estudios tienen un límite conocido de 30 o 300 tarjetas, de modo que se acepta el coste de renderizar la lista agrupada completa aunque sea larga; no se paginará ni truncará ese resumen.

### Enlaces canónicos y estado vacío

Cada tarjeta enlazará exclusivamente a `/queue/:id`, sin `study`, `study_id`, `participant`, `participant_id`, `reviewer` ni otros identificadores de contexto. El paginador conservará `page` y `limit` normalizados, tendrá controles accesibles y marcará página activa, anterior y siguiente según metadata.

Una página sin filas, incluida una página fuera de rango, conservará el resumen y metadata de paginación y mostrará un estado vacío accesible. No redirigirá a otra página, no consultará otra identidad y no convertirá la ausencia de filas en un error de servidor.

### Centrado anónimo de Home

La rama anónima de Home usará únicamente utilidades Bootstrap ya disponibles para que el contenido de bienvenida ocupe el espacio principal disponible y se alinee horizontal y verticalmente. No se añadirán reglas CSS, estilos inline, posiciones absolutas, media queries ni dependencias.

La rama autenticada conservará su marcado, header, identidad, acciones privadas, tarjetas y dimensiones. La prueba de navegador comparará `header`, la fila de marca y la rejilla autenticada antes y después con tolerancia de `0px` en `top`, `left`, `width` y `height`.

### Verificación por superficie

Después de una solicitud explícita de apply, la implementación seguirá este orden: regresiones de repositorio, servicio y ruta; renderizado de lista y paginador; centrado anónimo; pruebas HTTP y de navegador; lint JavaScript; diagnóstico de archivos modificados; validación OpenSpec estricta y QA visual en `375`, `768` y `1280` píxeles. Esta tarea no ejecuta esas pruebas ni presenta sus resultados como evidencia.

## Risks / Trade-offs

- [Una consulta de estado puede filtrar datos ajenos] -> Aplicar predicados de `study_id` y `participant_id` tanto a la membresía como a las tablas privadas y cubrir Alice/Bob con pruebas de aislamiento.
- [El resumen puede omitir categorías sin uso o variar con la página] -> Partir de todas las categorías actuales de la sesión, contar sobre toda la membresía asignada y mantener la lectura agrupada separada de la consulta paginada, incluso fuera de rango.
- [El resumen agrupado puede ser largo] -> Aceptar la lista completa porque el tamaño de estudio está acotado a 30 o 300 tarjetas; conservar agrupación única y orden ordinal estable sin truncamiento ni paginación independiente.
- [La normalización puede producir enlaces inconsistentes] -> Construir toda la metadata y los enlaces desde los valores normalizados, incluidos los casos de límite y página vacía.
- [El centrado anónimo puede alterar Home autenticada] -> Limitar las utilidades al camino anónimo y comparar las cajas autenticadas con tolerancia de `0px`.
- [Un selector legacy puede reaparecer durante la corrección] -> Mantener una comprobación explícita de ausencia de `/instances` y de todos los parámetros de identidad.

## Migration Plan

No hay migración de datos ni cambio de esquema. Tras la aprobación explícita del contrato y mediante `/opsx-apply restore-private-progress-list`, se implementarán la lectura paginada, la lectura agrupada completa y sus pruebas; después la ruta y la vista, y finalmente el centrado anónimo y sus regresiones. El cambio reutilizará las tablas y clases existentes. Si fuera necesario revertirlo, se restaurará la versión anterior de la aplicación sin modificar PostgreSQL ni borrar evidencias.

## Open Questions

Ninguna. Los valores predeterminados, el máximo, el orden ordinal, la respuesta vacía, el alcance por sesión, el resumen agrupado completo independiente de paginación, los enlaces canónicos y la preservación de Home autenticada están fijados por el plan y por los contratos de privacidad existentes.
