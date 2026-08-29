# Plan: adaptación de `labeler` para card sorting de Pull Requests

**Estado:** borrador para validación funcional  
**Objetivo:** adaptar `labeler` para clasificar Pull Requests entre varios participantes y construir una taxonomía jerárquica.

## 1. Resumen ejecutivo

El proyecto actual es una aplicación web SSR basada en Node.js, Express, EJS y PostgreSQL. Permite cargar instancias JSON, asignarlas a revisores, aplicar etiquetas planas, detectar desacuerdos y exportar los resultados.

La adaptación propuesta reutiliza ese flujo para tratar cada instancia como un Pull Request y cada etiqueta como una categoría taxonómica. Los cambios principales son:

1. Mantener la carga inicial de PRs desde CSV/TSV.
2. Mostrar cada PR como datos estructurados, con posibilidad de añadir un enlace a GitHub o integrar datos obtenidos desde GitHub posteriormente.
3. Cambiar las etiquetas planas por categorías jerárquicas mediante `parent_id`.
4. Permitir una sola categoría por PR y participante.
5. Hacer configurable el número de participantes requeridos por PR.
6. Implementar tres fases: clasificación individual, acuerdo/fusión y taxonomía final.
7. Mantener la taxonomía emergente y soportar opcionalmente una taxonomía semilla.

El mecanismo exacto de consenso, el formato final de los PR y el uso de categorías predefinidas quedan pendientes de decisión.

## 2. Decisiones actuales y pendientes

| Tema | Estado | Decisión o alternativa |
|---|---|---|
| Origen de los PRs | Fijo | Se cargan desde CSV/TSV, reutilizando `scripts/init-data.sh`. |
| Datos mostrados | Pendiente | JSON crudo del CSV, tarjeta estructurada, enlace a GitHub o integración con GitHub API. |
| Participantes por PR | Fijo/configurable | Inicialmente 2, pero debe configurarse sin modificar el código. |
| Taxonomía | Parcialmente fijo | Emergente por defecto; carga de semillas opcional. |
| Consenso | Pendiente | Votación, mediador, discusión o combinación de opciones. |
| Fases | Fijo | Individual → acuerdo/fusión → taxonomía final. |
| Estructura | Fijo | Jerárquica, con categorías y subcategorías. |
| Categorías por PR | Fijo | Exactamente una categoría por participante y PR. |
| Descartar PR | Pendiente | Mantener como “no clasificable/ruido” o eliminar del flujo. |

## 3. Modelo de datos propuesto

### 3.1 Instancias como Pull Requests

Mantener la tabla `instance` como contenedor de PRs:

- `id`: identificador interno.
- `category`: conservar temporalmente como grupo de origen, repositorio o proyecto. No debe confundirse con la categoría taxonómica.
- `data`: JSON con la información del PR.

Formato mínimo recomendado para `data`:

```json
{
  "repository": "organizacion/proyecto",
  "number": 123,
  "title": "Título del Pull Request",
  "body": "Descripción",
  "author": "usuario",
  "url": "https://github.com/organizacion/proyecto/pull/123",
  "created_at": "2025-01-01T00:00:00Z",
  "merged_at": null,
  "files_changed": 3,
  "additions": 40,
  "deletions": 12
}
```

El esquema final debe confirmarse antes de implementar la importación.

### 3.2 Categorías jerárquicas

Evolucionar la tabla `label` para representar categorías:

```sql
parent_id INTEGER NULL REFERENCES label(id) ON DELETE RESTRICT
```

Recomendaciones:

- Renombrar conceptualmente `label` a categoría, aunque inicialmente puede conservarse el nombre físico para reducir la regresión.
- Crear un índice sobre `parent_id`.
- Garantizar nombres únicos dentro de un mismo nivel.
- Mantener una restricción de nombres únicos para las categorías raíz.
- Añadir `is_seed BOOLEAN NOT NULL DEFAULT false` para distinguir categorías cargadas previamente.
- Añadir `created_at` o reutilizar `added_at` para auditoría.
- Impedir ciclos antes de cambiar `parent_id`.

La jerarquía debe consultarse con una CTE recursiva que devuelva `id`, `name`, `parent_id`, `depth` y una ruta completa.

### 3.3 Una categoría por revisión

La tabla actual `instance_review_label` permite una relación N:M. Para cumplir el requisito de una sola categoría:

- Añadir `category_id INTEGER NOT NULL REFERENCES label(id)` a `instance_review`.
- Eliminar la relación N:M después de migrar o reinicializar la base de datos.
- Cambiar el formulario de selección múltiple por un selector simple.
- Validar que la categoría existe y que pertenece a la taxonomía activa.

Si se conservan datos antiguos, no existe una migración automática inequívoca cuando una revisión tiene varias etiquetas. Para este proyecto se recomienda iniciar una base de datos limpia o realizar una migración manual.

### 3.4 Número configurable de participantes

Eliminar los valores hardcodeados `2` de las vistas SQL. Usar una configuración como:

```env
REQUIRED_REVIEWS=2
```

La aplicación debe validar que sea un entero positivo. La función SQL `required_reviews()` debe centralizar el valor con un fallback seguro a `2`.

También debe revisarse el umbral actual de `366` por categoría. En card sorting probablemente debe deshabilitarse o convertirse en una configuración separada:

```env
BUCKET_THRESHOLD=2147483647
```

### 3.5 Fases y consenso

Añadir, si se confirma que las fases deben persistirse explícitamente:

#### `taxonomy_phase`

- `id`
- `name`: `individual`, `agreement` o `final`
- `started_at`
- `ended_at`
- `is_active`

#### `agreement_session`

- `id`
- `instance_id`
- `phase_id`
- `resolved_at`
- `final_category_id`
- `consensus_mechanism`

#### `agreement_vote`

- `id`
- `session_id`
- `reviewer_id`
- `category_id`
- `remarks`
- `voted_at`
- restricción única `(session_id, reviewer_id)`.

Si se opta exclusivamente por un mediador, `agreement_vote` puede simplificarse o posponerse.

## 4. Cambios SQL por archivo

### `schema/01_definitions_schema.sql`

- Añadir `parent_id`, `is_seed` y, si se requiere, información de fase a `label`.
- Añadir `category_id` a `instance_review`.
- Eliminar o dejar obsoleta `instance_review_label`.
- Añadir las tablas de fases y acuerdo si se adopta el modelo explícito.
- Añadir índices para `label.parent_id`, `instance_review.category_id` y los campos de búsqueda de acuerdo.
- Revisar el tipo `conflict`: el conflicto de etiquetas debe convertirse en conflicto de categorías.

### `schema/02_definitions_function.sql`

Añadir declaraciones para:

- `required_reviews()`.
- `category_tree()`.
- `category_ancestors(category_id)`.
- `category_descendants(category_id)`.
- Detalles de sesiones de acuerdo.
- Exportación de la taxonomía final.

### `schema/03_definitions_procedure.sql`

Declarar procedimientos para:

- Crear, renombrar, mover, fusionar y eliminar categorías.
- Registrar y resolver acuerdos.
- Resolver conflictos de categoría con una única categoría final.

### `schema/04_definitions_view.sql`

Modificar:

- `instance_review_candidate`: usar `required_reviews()`.
- `instance_review_finished`: usar el número configurable de revisiones.
- `instance_review_conflict_label`: comparar `category_id` en lugar de conjuntos de etiquetas.
- `instance_review_conflict`: exponer conflictos de categoría.
- `instance_review_finished_export`: exportar una categoría única y su ruta jerárquica.
- `instance_review_bucket`: aclarar si agrupa por origen o por categoría taxonómica.

Crear:

- Vista del árbol de categorías.
- Vista de PRs pendientes de acuerdo.
- Vista de la taxonomía final con conteos por categoría.

### `schema/05_implementations_function.sql`

- Cambiar `next_instance` para usar el umbral configurable.
- Cambiar `instance_review_details` para devolver `category_id` y `category_name`.
- Implementar consultas recursivas de ancestros y descendientes.
- Reescribir distribuciones para contar por categoría.
- Implementar consultas de sesiones de acuerdo y exportación final.

### `schema/06_implementations_procedure.sql`

- Adaptar `label_remove`, `label_rename` y `label_merge` a categorías jerárquicas, o crear procedimientos con nombres `category_*`.
- Validar ciclos al mover categorías.
- Decidir si una categoría con hijos puede fusionarse.
- Cambiar `conflict_resolution_review` para recibir un único `category_id`.
- Crear procedimientos de votación, resolución por mediador y cierre de sesión.
- Mantener o retirar los procedimientos de descarte según la decisión funcional.

## 5. Cambios en backend y rutas

### Rutas existentes a modificar

- `routes/[name]/queue/index.js`: cargar el árbol de categorías y el estado de la fase.
- `routes/instances/[id]/review/index.js`: recibir `category_id` y guardar una única categoría.
- `routes/labels/index.js`: convertir etiquetas en categorías y aceptar `parent_id`.
- `routes/labels/[id]/index.js`: mostrar jerarquía, descendientes y estadísticas.
- `routes/labels/rename/index.js`: aceptar contexto del padre.
- `routes/labels/merge/index.js`: fusionar categorías respetando hijos y referencias.
- `routes/conflicts/[id]/index.js`: mostrar una categoría propuesta por cada participante.
- `routes/conflicts/[id]/review/index.js`: resolver con una categoría única.
- `routes/progress/index.js`: añadir progreso por fase y categoría.
- `routes/export/[target]/index.js`: añadir exportación de categorías y taxonomía.

### Rutas nuevas sugeridas

- `GET /categories/tree`: árbol de categorías en JSON.
- `POST /categories`: crear una categoría con `parent_id`.
- `PATCH /categories/:id`: renombrar o mover una categoría.
- `GET /agreement`: lista de PRs con desacuerdos.
- `GET /agreement/:id`: detalle del acuerdo.
- `POST /agreement/:id/vote`: registrar un voto.
- `POST /agreement/:id/resolve`: resolver por votación o mediador.
- `GET /taxonomy`: mostrar la taxonomía final.
- `GET /taxonomy/export`: exportar el árbol y sus estadísticas.
- `GET/POST /phases`: consultar y cambiar la fase activa, si se requiere administración explícita.

### Socket.io

Reutilizar el patrón actual para sincronizar:

- creación de categoría;
- renombrado;
- eliminación;
- movimiento dentro del árbol.

No es necesario sincronizar toda la clasificación si cada participante trabaja de forma independiente, pero sí conviene actualizar el árbol cuando una categoría cambia.

## 6. Cambios en frontend y vistas

### `views/review.ejs`

- Mostrar el PR de forma estructurada.
- Reemplazar el `<select multiple>` por un selector único.
- Representar la jerarquía mediante opciones indentadas o un árbol Bootstrap.
- Permitir crear una categoría hija desde el flujo de clasificación.
- Enviar `category_id` en lugar de `label_ids`.
- Mostrar claramente la fase actual.

### `views/conflict.ejs`

- Mostrar la categoría elegida por cada participante.
- Eliminar la lógica de intersección/diferencia de arrays.
- Permitir seleccionar una categoría final.
- Mostrar observaciones y votos del acuerdo.

### `views/partials/instance/data.ejs`

Implementar modos configurables:

- `raw`: JSON crudo, usando highlight.js.
- `card`: tarjeta con título, repositorio, autor, estadísticas, descripción y enlace.
- `both`: tarjeta más JSON técnico.

No se recomienda un `<iframe>` directo a GitHub porque GitHub puede bloquearlo mediante `X-Frame-Options` o políticas de contenido. Para una integración dinámica se debe utilizar GitHub API desde el backend, con token, control de rate limit y caché.

### Vistas de categorías

Adaptar `labels.ejs` y `label.ejs`, o crear `categories.ejs` y `category.ejs`, para:

- mostrar el árbol;
- crear categorías raíz e hijas;
- mover categorías;
- renombrar y fusionar;
- visualizar cantidad de PRs por nodo y descendientes.

### Vistas nuevas

- `agreement.ejs`.
- `agreement-session.ejs`.
- `taxonomy.ejs`.
- `phases.ejs`, si las fases se administran desde la aplicación.
- `views/partials/category-tree.ejs` para reutilizar el árbol en formularios y páginas.

## 7. Implementación de las fases

### Fase 1: clasificación individual

1. Cada participante entra con su identidad.
2. Recibe PRs pendientes de clasificación.
3. Puede crear categorías emergentes o seleccionar categorías existentes.
4. Asigna exactamente una categoría por PR.
5. El sistema registra la decisión y la observación opcional.
6. Cuando el PR alcanza `REQUIRED_REVIEWS`, se verifica si existe acuerdo.

La creación libre debe ser concurrente y debe evitar duplicados de categorías equivalentes tanto como sea posible.

### Fase 2: fusión y acuerdo

Para cada PR con categorías distintas:

1. Crear una sesión de acuerdo.
2. Mostrar el PR y todas las propuestas.
3. Permitir discusión mediante observaciones o comentarios.
4. Aplicar el mecanismo elegido: votación, mediador o consenso.
5. Registrar la categoría final y quién la determinó.
6. Marcar el PR como resuelto.

La fusión de la taxonomía debe ser independiente de la resolución de un PR: dos categorías pueden considerarse equivalentes y fusionarse aunque todavía existan PRs asociados.

### Fase 3: taxonomía final

Mostrar y exportar:

- árbol de categorías;
- ruta completa de cada categoría;
- número de PRs por categoría;
- participantes que propusieron cada categoría;
- categorías semilla frente a categorías emergentes;
- PRs representativos, si se conserva `is_interesting`.

## 8. Carga de datos

### PRs

Mantener `instance.csv` o `instance.tsv` con:

```text
grupo_de_origen<TAB>json_del_pull_request
```

El JSON debe ser válido y contener al menos identificador, título, repositorio, autor y URL.

### Participantes

Mantener `reviewer.txt`, una persona por línea. Más adelante se recomienda cambiar el nombre conceptual de `reviewer` a `participant` y agregar autenticación real si la aplicación se expone fuera de un entorno controlado.

### Taxonomía semilla

Opciones:

1. No cargar semilla: card sorting completamente abierto.
2. Mantener `label.txt` con categorías raíz: fácil, pero no expresa jerarquía.
3. Usar rutas jerárquicas, por ejemplo:

```text
Tipo de cambio > Corrección > Error de validación
Tipo de cambio > Documentación
```

La opción 3 requiere un cargador que cree automáticamente los padres intermedios y marque las categorías con `is_seed = true`.

## 9. Puntos pendientes de decisión

### Visualización del PR

- **JSON crudo:** fácil de implementar, auditable y funciona offline; peor experiencia de clasificación.
- **Tarjeta estructurada:** mejor experiencia y no depende de GitHub en tiempo real; requiere acordar el esquema del CSV.
- **Enlace a GitHub:** permite consultar el PR original; depende de conectividad y puede sacar al participante de la aplicación.
- **GitHub API:** más dinámico; requiere token, caché, manejo de errores y límites de API.

Recomendación inicial: tarjeta estructurada + JSON crudo opcional + enlace externo.

### Taxonomía semilla

- Sin semilla reduce el sesgo de anclaje.
- Con semilla puede acelerar la clasificación y aprovechar el trabajo anterior.
- Una alternativa experimental es comparar grupos con y sin semilla y registrar `is_seed`.

### Consenso

- **Mayoría:** escalable, pero puede ocultar desacuerdos minoritarios.
- **Mediador:** simple y controlable, pero depende de una persona.
- **Discusión:** rica metodológicamente, pero requiere más desarrollo y coordinación.
- **Mayoría con mediador de desempate:** equilibrio recomendado para una primera versión.

### Descarte

Decidir si un PR puede ser “no clasificable”, duplicado o fuera de alcance. Si no se necesita, retirar el botón y las rutas de descarte para simplificar el modelo.

### Fusión de categorías con hijos

Opciones:

- impedir fusionar categorías con descendientes;
- mover automáticamente los hijos al destino;
- solicitar una reasignación manual.

Recomendación: impedir la fusión automática de nodos con hijos hasta definir una política explícita.

## 10. Orden recomendado de implementación

1. Confirmar formato del JSON de PR y significado de `category` como grupo de origen.
2. Confirmar si se conserva descarte.
3. Confirmar mecanismo de consenso y si las fases se persisten en BD.
4. Crear una rama de trabajo específica y respaldar la base actual.
5. Implementar categorías jerárquicas en el esquema.
6. Cambiar la revisión de N:M a una categoría única.
7. Parametrizar `REQUIRED_REVIEWS` y retirar el hardcode de `366`.
8. Actualizar funciones, procedimientos y vistas SQL.
9. Adaptar carga de categorías semilla y PRs.
10. Adaptar rutas de cola, revisión, conflictos y exportación.
11. Crear rutas y vistas de acuerdo.
12. Adaptar el renderizado de PR y el selector jerárquico.
13. Crear vista y exportación de taxonomía final.
14. Añadir sincronización WebSocket para cambios en categorías.
15. Probar con dos participantes y luego con más participantes.
16. Ejecutar pruebas de regresión, lint, build Docker y pruebas end-to-end.

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Sesgo por categorías semilla | Marcar `is_seed`, documentar el experimento y comparar resultados. |
| Ciclos en la jerarquía | Validar ancestros antes de mover una categoría. |
| Migración N:M a 1:1 | Usar una base limpia o migración manual documentada. |
| Desacuerdos con más participantes | Hacer configurable el umbral y definir reglas de mayoría. |
| Confusión entre `instance.category` y categoría taxonómica | Renombrar conceptualmente el campo a `source_group` en documentación y código nuevo. |
| PRs grandes o JSON pesado | Limitar campos, separar diffs o usar carga bajo demanda. |
| Dependencia de GitHub | Mantener los datos esenciales en el CSV y usar GitHub como complemento. |
| Ediciones concurrentes de categorías | Usar restricciones SQL, transacciones y eventos Socket.io. |
| Pérdida del historial por fusiones | Registrar alias, auditoría o tabla de cambios antes de borrar categorías. |
| Falta de autenticación | Añadir autenticación y roles antes de desplegar fuera de un entorno controlado. |

## 12. Criterios de aceptación iniciales

- Se pueden cargar PRs desde el CSV existente.
- Dos o más participantes pueden clasificar el mismo PR.
- Cada participante asigna exactamente una categoría.
- Las categorías pueden organizarse en varios niveles.
- El número mínimo de clasificaciones es configurable.
- El sistema identifica PRs con categorías discordantes.
- Existe un flujo explícito de acuerdo.
- Se puede consultar la taxonomía final como árbol.
- Se pueden exportar PR, categoría, ruta jerárquica y resultado del consenso.
- La clasificación funciona sin depender obligatoriamente de una conexión a GitHub.
