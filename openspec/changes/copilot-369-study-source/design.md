## Context

La propuesta define el cambio de la fuente primaria de 300 a 369 PR de Copilot, con una única muestra primaria activa.
Este diseño especifica la transición y la adaptación de la fuente a la tarjeta existente; para el motivo y el alcance
funcional, véase `proposal.md`.

El bootstrap ordinario en `util/study-bootstrap.js` bloquea el cambio de checksum de un estudio existente y no
reescribe su membresía. Esas guardas son parte del contrato de seguridad y no se relajarán para permitir una sustitución
silenciosa.
La migración `011_multi_study_cardinality.sql` actualmente acepta 30 y 300 tarjetas. La proyección existente construye
`card_v2` con campos, fechas, evidencia CSV, secciones de snapshot y procedencia. La vista
`views/partials/instance/data.ejs` presenta los metadatos de la tarjeta, el texto y las secciones de reviews y
comentarios; este cambio conserva esa superficie.

El CSV completo de 85 columnas está fuera del repositorio en
`/home/javier/Descargas/practica2/muestras_def/muestra_copilot.csv`, con SHA-256
`fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb`. Contiene solo los 369 PR seleccionados en orden
Copilot. Los 37 PR de reserva están en el archivo separado `reserva_copilot.csv` y no se importan. El archivo de 30
tarjetas y su manifest constituyen una fuente de validación protegida. El archivo
`plans/merged_after_rework_cards_seed_20260510.csv` conserva la procedencia de validación de la muestra anterior de
300 y no se sustituirá.

La canalización de publicación está congelada: los siete workflows de `.github/workflows/` y
`deployment/docker-compose.release.yml` deben permanecer idénticos a la línea base `b409233`. La validación compartida y
el workflow de release aún esperan 300 tarjetas y usan el CSV anterior. Por ello, añadir la fuente correcta y un perfil
de 369 no basta para publicar con seguridad.

## Goals / Non-Goals

**Goals:**

- Sustituir en el mismo estudio primario la membresía ordenada de 300 tarjetas por la muestra canónica de 369,
  preservando `study_id`, usuarios, roles, hashes de contraseña, versiones de credenciales, identidades de participantes
  y memberships de participantes.
- Exigir intención explícita del operador, checksums antiguo y nuevo exactos, membresía esperada y preflight integral
  antes de una transición transaccional.
- Dejar intactos el estudio de validación de 30 y sus cuentas, datos persistidos, memberships, decisiones, categorías,
  enriquecimiento, CSV, fixture y manifest.
- Convertir los registros disponibles del CSV completo a la forma de tarjeta existente, con valores y procedencia
  veraces, sin inventar datos ausentes ni mostrar métricas, commits o timeline nuevos.
- Conservar los flujos existentes de categorías, definición, observaciones, navegación, descarte privado y
  comparación/exportación, adaptando únicamente lo imprescindible para la cardinalidad de 369.
- Validar cambios y rollback en una base aislada. No operar ahora contra la base de datos real.

**Non-Goals:**

- Mantener el estudio primario de 300 en paralelo con el de 369, crear tareas para las 37 reservas o volver a muestrear
  el conjunto de 30.
- Alterar los datos o artefactos protegidos de validación, modificar workflows congelados, publicar una imagen o
  desplegar el cambio.
- Rediseñar la tarjeta, añadir paneles de actividad o introducir un modo de compatibilidad que acepte silenciosamente
  la entrada primaria de 300.
- Convertir los snapshots históricos en una captura live de GitHub o promoverlos como si provinieran de una ejecución
  nueva.

## Decisions

### Fuente canónica y empaquetado

Se hará preflight del archivo original de 85 columnas y se verificará su SHA-256 esperado antes de convertirlo. El
archivo contiene exactamente 369 PR únicos en el orden Copilot; no contiene las 37 reservas, que están en
el archivo separado `reserva_copilot.csv` y se excluyen del import. Se conservarán byte por byte
`plans/merged_after_rework_cards_seed_20260510.csv` (SHA-256
`4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef`), `plans/validation-30-cards.csv` (SHA-256
`1607cfe84cb687a2cc7b4c56d3e0abf106b1a1044810d7390663ef1d691b63ab`) y el manifest protegido de 30 (SHA-256
`5049b9357468ce98bd4f83057ea3e59178a5d03793f97800252d7e3e87e7dc1a`). No se reescriben ni regeneran el dataset,
fixture o manifest de 30.

La entrada operativa del nuevo perfil será un archivo separado, `plans/copilot-369-cards.csv`, con un sidecar
determinista de procedencia derivado del manifest original. El Dockerfile podrá incluirlo en
`data/copilot-369-cards.csv` junto a las fuentes actuales. El perfil autorizado de configuración seleccionará
explícitamente la primaria 369 y
mantendrá la validación existente de 30. El archivo original fuera del repositorio se usa como entrada de preparación y
evidencia, no como dependencia en tiempo de ejecución. La muestra antigua de 300 no será fallback para la primaria.

Se descarta usar la revisión de 35 columnas como única entrada: omite autor, fecha de cierre y lenguaje presentes
en el CSV completo, sin aportar conversaciones distintas. Conservar las 85 columnas no amplía la información visible.

### Adaptación a la tarjeta actual

Un normalizador explícito leerá las 85 columnas con su formato requerido, comprobará conteo, unicidad, orden y
checksum, y mapeará solo campos cuya semántica corresponda al modelo existente. El resultado alimentará la
representación de tarjeta actual y sus secciones `card_v2`; no se añadirá un modelo de presentación paralelo. El mapeo de
identidad/metadatos es: `pr_id` como cadena decimal exacta (sin conversión numérica que pierda precisión) a
`source_card_id` y `source_pr_id`; `repository_full_name` a `repository`; `number` a `pr_number`, validado contra el
número de PR de `html_url`; `title`, `body`, `user` (cadena) y `state` a título, cuerpo, autor y estado;
`repository_language` a `language`; y `created_at`, `closed_at`, `merged_at` a sus fechas respectivas. `merged` se
deriva como verdadero cuando `merged_at` está presente, y en otro caso solo se asigna falso si el estado de origen
permite afirmarlo; en caso contrario se omite. URLs y números deben concordar y pasar validación antes de persistir.

Los 33 campos compartidos entre la muestra raíz de 369 y el archivo de revisión de 35 se interpretan según su
significado, no solo por coincidencia de nombre. `human_comment_count` y `human_feedback_count` existen únicamente en la
revisión de 35, no en el CSV raíz de 369; no se usan para producir valores. `repository_language` se asigna al lenguaje
actual con procedencia del CSV, sin presentarlo como un lenguaje distinto. El lenguaje está disponible en 366 de 369
PR; para los tres ausentes se omite el valor y se informa al operador. `evidence_text` no existe en el origen: se omite
y se informa como campo ausente, sin atribuirle una razón no demostrada.

Para conversaciones, `reviews_json`, `pr_comments_json` e `inline_comments_json` se normalizan respectivamente a las
secciones actuales de reviews, comentarios de PR y comentarios inline de `card_v2`. Los autores en cadena se adaptan a
la forma de usuario segura que espera la proyección; se conservan estado/evento, texto, URL y timestamps de origen
válidos (`submitted_at` para reviews, `created_at` para comentarios y eventos, `event_at` solo si el esquema de ese
evento lo define). La procedencia identifica CSV o snapshot congelado, nunca un `run_id` ficticio de GitHub.
`commits_json` puede conservarse internamente, pero no se proyecta como panel visible. El contenido se renderiza con el
mecanismo `renderSafeMarkdown` existente.

Para la nueva primaria, la vista no muestra los datos crudos de 85 columnas. Solo presenta los metadatos actuales de la
tarjeta, cuerpo y evidencia CSV seleccionada cuando existe, más las tres secciones de conversación existentes cuando
puedan normalizarse con fidelidad. Se omiten métricas nuevas, commits y timeline. Una colección JSON evaluada como `[]`
conserva el comportamiento actual de colección vacía. Un campo opcional ausente se omite y se informa al operador con
campo, PR, motivo comprobable, conteo y procedencia. JSON malformado o que no cumple el esquema requerido rechaza el
conjunto completo antes de toda escritura; no se degrada a omisión. No se crean valores o explicaciones ficticios. La
representación y renderizado existentes de las 30 tarjetas permanecen sin cambios.

La tarjeta conserva procedencia explícita de CSV o snapshot congelado. Los snapshots históricos, si se usan para la
presentación, se etiquetan como snapshots congelados sin asignarles un nuevo `run_id`, checksum o estado de captura
live. Sin un snapshot aplicable, los valores del CSV siguen siendo baseline. La fuente no crea ni requiere nuevos campos
SHA o `event_key`.

### Transición protegida en sitio

El cutover se implementa como una operación one-shot dedicada, no como una excepción global al bootstrap ordinario.
Requiere confirmación explícita del operador, checksum antiguo y nuevo exactos, clave e ID de estudio esperados,
configuración antigua exacta, membresía ordenada actual de 300 y membresía objetivo de 369. El preflight valida el CSV
completo, identidad/orden de las tarjetas, esquema y dependencias. Confirma cero clasificaciones, cero descartes y cero
filas primarias en `github_enrichment_run`, `github_run_page`, `github_enrichment_run_card`,
`study_enrichment_promotion` y cualquier otra referencia histórica dependiente del estudio. Si una tabla, referencia o
versión de esquema es desconocida, o existe cualquier referencia histórica, la transición se bloquea antes de mutar
datos y requiere una decisión explícita fuera de este cambio. No se separan promociones ni se actualiza, elimina o
mueve ningún run, mapping, página, promoción o snapshot.

La aplicación, la preparación y los escritores de enriquecimiento se detienen y quedan en mantenimiento antes de
comenzar. En una única transacción se toman locks advisory, de fila de estudio y de membresía/tabla suficientes para
cubrir todas las rutas de escritura; se vuelven a comprobar las precondiciones bajo esos locks. El lock advisory del
bootstrap ordinario no garantiza por sí solo que los escritores queden serializados. Solo después de confirmar la
configuración y membresía antigua exactas, cero clasificaciones/descartes y ausencia de toda referencia histórica
primaria se actualizan fuente/configuración/conteo y se reemplazan las filas `study_card` de la primaria por las 369
membresías ordenadas. Una carrera, una dependencia no reconocida o una discrepancia aborta toda la transacción.

No se usa `TRUNCATE`, `DROP CASCADE`, borrado global, movimiento de referencias, desactivación de triggers
ni `down -v`. No se actualiza, elimina ni reasigna ninguna cuenta, membresía de participante, clasificación, descarte, fila
`pr_card` preexistente, run, mapping, página, promoción o snapshot. Una `pr_card` preexistente solo puede reutilizarse
si es compatible sin actualizarla ni rellenar/backfillear su checksum; cualquier discrepancia, checksum nulo que exija
backfill o dependencia histórica bloquea el cutover. Los snapshots compartidos que dependan solo de `pr_card` pueden
permanecer intactos. Se verifica el estado persistido completo antes del commit.

La migración `004_github_pr_api_enrichment.sql` vincula `github_run_page` y `github_enrichment_run_card` a
`study_card`; protege los hijos terminales y prohíbe actualizar/eliminar promociones y eliminar runs. Por tanto no hay
una estrategia de detach/archive en este cambio. El preflight exige que la primaria no tenga filas en ninguna de esas
tablas ni otra referencia histórica dependiente. Si existen, el cutover se bloquea íntegramente y queda fuera de
alcance cualquier resolución que requiera alterar o mover esas referencias. No se toca ninguna fila ni promoción del
estudio de 30.

Una nueva migración posterior a `013` hará únicamente el cambio estructural de cardinalidad necesario, sin alterar
claves foráneas históricas. Puede admitir 30, 300 y 369 para que las filas legacy de primaria de 300 puedan
transicionarse; eso no autoriza crear un nuevo producto primario de 300. En una base nueva, solo se crean perfiles 369 y
30. En una base existente, la primaria de 300 se convierte únicamente por el cutover protegido. La migración global no
debe escribir filas de estudio ni mutar datos del estudio 30.

Se descarta crear otro estudio y reprovisionar cuentas porque rompería la continuidad de identidades solicitada.
También se descarta relajar el bootstrap o archivar/borrar historial para forzar la transición: ante dependencias
inesperadas se conserva el estado y se exige otra decisión explícita.

### Identidades, estado privado y cardinalidades dependientes

Se conserva `study_id`, las cuentas y el manifest vigente, sin regenerar/provisionar cuentas ni modificar usernames,
roles, hashes, `credential_version`, identidades o membresías de participantes. No se agregan sufijos de username. Las
clasificaciones, descartes y referencias históricas existentes bloquean el cutover; nunca se borran o reasignan para
acomodar la nueva membresía.

La ruta que encuentra la validación existente de 30 es estrictamente de lectura: puede verificar su identidad y
comparar fingerprints, pero no invoca el bootstrap ordinario, `provisionParticipantAccounts`, importación,
enriquecimiento ni refresh, ya que incluso escrituras accesorias como actualizar `study.updated_at` violarían el
requisito de inmutabilidad. En una base nueva aislada sí se crean los perfiles 369 y 30 a partir de los fixtures
protegidos, y después se comprueba que el estado persistente de 30 no ha cambiado.

Los cálculos de avance, finalización y comparación/exportación que dependan de la cardinalidad adoptan 369 para la
primaria. Se conservan sus comprobaciones de elegibilidad, privacidad y gates actuales; no se restaura el exportador
offline. La validación de 30 conserva su cardinalidad y todos sus datos.

### Bloqueo de publicación

El empaquetado de la fuente no cambia los workflows congelados. Como `shared-validation.yml` exige actualmente 300
tarjetas y `release.yml` calcula el checksum de `plans/merged_after_rework_cards_seed_20260510.csv`, el gate de
publicación/producción para 369 queda bloqueado hasta que un cambio dedicado, aprobado, resuelva el contrato de forma
veraz y compatible con la congelación. Un descriptor externo separado no corrige por sí solo el manifiesto de release
que identifica el CSV antiguo.

No se falsea el manifest, no se aceptan arbitrariamente 300 tarjetas para hacer pasar CI y no se despliega por una vía
alternativa. El bloqueo y su prerequisito se registran como gate conocido, no como una decisión pendiente dentro de este
cambio. El cambio puede definir la fuente de producto y su verificación aislada; no autoriza merge de publicación,
manejo de secretos ni despliegue público de 369.

## Risks / Trade-offs

- El CSV de 85 columnas puede contener campos cuyo nombre coincida con el modelo pero cuya semántica difiera. El
  preflight y el mapeo explícito reducen el riesgo; ante ambigüedad o formato inválido, se rechaza la fuente en lugar de
  adivinar.
- La operación en sitio concentra riesgo porque conserva el mismo `study_id` y memberships de participantes. La
  intención explícita, el cese de escritores, la comprobación de cero decisiones y descartes, los locks y la transacción
  indivisible evitan una transición parcial; sin cualquiera de esas condiciones no se ejecuta.
- Los registros `pr_card` y de snapshot son compartidos o inmutables. Fallar ante contenido discordante puede impedir el
  cutover, pero es preferible a alterar evidencia o datos compartidos de la validación de 30.
- El ledger global de migraciones puede cambiar aunque los datos de 30 no cambien. Se requiere comparar fingerprints
  del estado persistente de 30 antes y después; no se presentará el cambio como aislamiento de esquema por estudio.
- El contrato de release congelado sigue referenciando la fuente de 300. Esto bloquea la publicación de 369 hasta
  contar con un cambio autorizado y una validación de contrato; cualquier afirmación de release aprobado sería
  engañosa.
- El mapeo limitado al contenido visible actual omite datos de la fuente completa que no tengan un campo o sección
  semánticamente equivalente. Esto conserva una interfaz fiel y evita inflar la tarjeta con métricas o actividad no
  solicitadas.

## Migration Plan

1. Preparar una base descartable aislada de toda base real. No operar ni presentar como inspeccionada una base de datos
   real. En la base aislada, capturar fingerprints de cuentas y del estado persistente de validación de 30, incluidos
   datos, memberships, decisiones, descartes, categorías, enriquecimiento, checksums del CSV/fixture/manifest y
   cualquier timestamp persistente de estudio. La actividad transitoria de sesión se excluye, pero identidades, roles,
   hashes y versiones de credenciales se comparan.
2. Validar primero los CSV, checksum, perfil y manifest antes de migraciones o escrituras. Añadir después de `013` solo
   el cambio estructural de cardinalidad necesario; dejar intactas las migraciones `001` a `013` y no alterar claves
   foráneas históricas.
3. Incorporar la fuente operativa separada `plans/copilot-369-cards.csv` y su sidecar determinista. Confirmar los hashes
   exactos y que el CSV/fixture/manifest de 30 y el CSV anterior de 300 permanezcan byte por byte iguales.
4. Validar en aislamiento parser, checksum, 369 filas, unicidad, orden Copilot, mapeo campo a campo, validación del
   número contra URL, conteos de disponibilidad y procedencia. Un `[]` válido queda vacío; opcionales ausentes se
   informan; JSON requerido malformado o con esquema inválido falla el lote antes de escritura. Verificar Markdown
   seguro y que la primaria nueva no muestre métricas, commits ni timeline.
5. Probar por separado una base nueva (crear solo perfiles 369 y 30) y una transición de primaria existente (300 a
   369). Antes de mutar, exigir intención, checksum/ID/config/membresía antigua exacta y objetivo validado, escritores
   de aplicación/preparación/enriquecimiento detenidos, locks, revalidación transaccional, cero decisiones/descartes y
   ausencia total de referencias históricas de enriquecimiento. Cada incumplimiento o dependencia desconocida debe
   abortar sin cambios. No llamar al bootstrap ordinario ni provisionar cuentas en el cutover.
6. Verificar la transición solo si el preflight histórico está vacío: mismo `study_id`, cuentas y memberships de
   participantes; 369 tarjetas en orden; ninguna fila `pr_card` preexistente actualizada, rellenada o con checksum
   backfilleado; fingerprints persistentes idénticos de 30, incluyendo sus timestamps. Verificar gates privados de
   comparación/exportación. Probar repetición con fuente 369 como lectura sin escrituras, incluido ningún cambio de
   timestamps de auditoría. No afirmar que el preflight histórico pasó en ninguna base real.
7. Antes del commit, todo error provoca rollback transaccional completo. Tras un cutover confirmado, recuperación
   requiere detener la aplicación y restaurar un backup verificado en un destino separado aprobado; no se hace
   downgrade destructivo, reset de credenciales ni restauración sobre el volumen con datos de 30.
8. Mantener bloqueados merge de release y despliegue público de la primaria 369 mientras la canalización congelada
   espere CSV/conteo de 300. Solo un cambio dedicado aprobado puede resolver ese gate; este diseño no modifica ni
   suplanta la canalización.
