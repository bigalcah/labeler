# Paquete de release y recuperación del estudio

## Purpose

Fijar el contrato externo del paquete de release v2 para los estudios 369 y 30, su adopción segura por el launcher del
host y las garantías observables de compatibilidad, preparación y recuperación. La especificación limita qué fuente,
estado persistente y aplicación pueden combinarse; no autoriza publicación ni cutover real.

## ADDED Requirements

### Requirement: Despliegue delegado sin backup obligatorio

La revisión aprobada del 21 de octubre de 2026 SHALL sustituir los prerrequisitos históricos de backup,
restore aislado y mantenimiento manual por candidato en el modo automático. Una política externa
root-owned, fijada al consumidor, repositorio y base, SHALL delegar las operaciones conocidas al deploy
existente. SHALL registrar automation.backupRequired=false y backupRef=null sin fabricar recibos.
SHALL conservar volumen, pins, locks, journal, cuentas y estudio de 30. El modo manual conserva sus
requisitos y los estados interrumpidos, parciales o desconocidos SHALL seguir bloqueando.

#### Scenario: Primera release y release sucesiva

- **WHEN** deploy recibe política válida y candidato verificado sobre un origen histórico elegible o pareja exacta
- **THEN** completa los pasos transaccionales existentes o verifica readonly la pareja, sin backup/restore obligatorio
- **THEN** conserva las filas de validación y el volumen persistente

#### Scenario: Política inválida o estado interrumpido

- **WHEN** divergen permisos, fingerprint, repositorio o base, o el journal está pending/unknown
- **THEN** bloquea antes de nuevas mutaciones y no publica éxito ni repite SQL

### Requirement: El manifiesto entrante SHALL cumplir el contrato estricto v2

Un paquete entrante SHALL declarar `schemaVersion` igual a `2` y SHALL conservar los campos de identidad `releaseId`,
`generation`, `commit`, `images`, `workflow` y `createdAt` del contrato anterior, con su significado y validación
estricta. SHALL reemplazar el campo singular `csv` por `dataBundle` y añadir `dataCompatibility`. `images` SHALL
contener exactamente `server` y `database`. El manifiesto SHALL rechazar claves desconocidas, campos omitidos, tipos no
admitidos, valores fuera de formato y combinaciones inconsistentes. El contrato de gates y publicación de CI corresponde
a `copilot-369-pipeline`.

#### Scenario: Manifiesto v2 completo

- **WHEN** el launcher recibe un manifiesto con identidad válida, imágenes por digest y los contratos completos de datos
  y compatibilidad
- **THEN** acepta únicamente la forma v2, verifica las relaciones entre release, commit, generación, perfiles y
  capacidades declaradas, y no interpreta campos v1 como alias

#### Scenario: Versión, campo o valor desconocido

- **WHEN** el manifiesto entrante declara otra versión, una clave desconocida, una clave ausente o un valor con tipo o
  formato no admitido
- **THEN** la validación falla antes de instalar o activar el release, cambiar compatibilidad durable o escribir
  PostgreSQL; solo permite staging temporal y diagnóstico acotado del rechazo

#### Scenario: Identidad e imágenes inconsistentes

- **WHEN** `releaseId`, `generation`, `commit` o la referencia inmutable de una imagen no concuerdan
- **THEN** el paquete se rechaza y la evidencia identifica el contrato inválido sin cambiar el estado activo

### Requirement: `dataBundle` SHALL fijar exactamente dos perfiles canónicos y ordenados

`dataBundle.profiles` SHALL ser una lista ordenada con exactamente dos perfiles. Primero SHALL identificar el estudio
`pr-card-sorting-local`, la fuente primaria Copilot, el CSV `/labeling/data/copilot-369-cards.csv`, su sidecar
`/labeling/data/copilot-369-cards.manifest.json` y un conteo exacto de 369. Segundo SHALL identificar
`pr-card-sorting-validation-30`, el CSV `/labeling/data/validation-30-cards.csv`, su sidecar
`/labeling/data/validation-30-cards.manifest.json` y un conteo exacto de 30. No se aceptan rutas alternativas, perfiles
adicionales, perfiles omitidos, fuentes intercambiadas ni reordenamientos.

#### Scenario: Perfil canónico completo

- **WHEN** el manifiesto enumera primero la fuente Copilot de 369 y después la fuente de validación de 30 con rutas y
  conteos exactos
- **THEN** satisface la identidad estructural de la pareja obligatoria, sin aceptar solo el primer perfil

#### Scenario: Fuente, orden o cardinalidad distintos

- **WHEN** un perfil usa otra ruta, sidecar, estudio o conteo, o la lista omite, duplica, añade o intercambia perfiles
- **THEN** se rechaza el bundle sin fallback a la fuente histórica de 300

### Requirement: Las fuentes y sidecars SHALL estar vinculados a la imagen inmutable

El commit raíz del manifiesto SHALL vincular los SHA-256 independientes de cada CSV y sidecar. Los cuatro archivos SHALL
estar presentes en la imagen de servidor inmutable cuyos digests se declaran en el manifiesto, en las rutas exactas
aprobadas. El launcher SHALL comprobar el digest real de la imagen, la correspondencia de commit y cada checksum
declarado antes de permitir preparación. Los valores canónicos SHALL ser: CSV 369
`fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb`; sidecar 369
`1837bc7a8cbd366349c8bc207cc236a0dec9d0b04f7f63325ee525884faf3f3a`; CSV 30
`1607cfe84cb687a2cc7b4c56d3e0abf106b1a1044810d7390663ef1d691b63ab`; sidecar 30
`5049b9357468ce98bd4f83057ea3e59178a5d03793f97800252d7e3e87e7dc1a`.

#### Scenario: Bundle e imagen coinciden

- **WHEN** los cuatro archivos existen en sus rutas aprobadas, sus checksums coinciden y el commit raíz concuerda con la
  imagen por digest
- **THEN** las fuentes son elegibles para validación del contenido y preparación posterior

#### Scenario: Fuente o sidecar alterado o ausente

- **WHEN** un archivo no está en la imagen, no coincide su checksum o no concuerda su commit
- **THEN** el release falla cerrado antes de cambios en PostgreSQL o punteros de publicación

#### Scenario: Hash declarado fabricado o regenerado

- **WHEN** un manifiesto intenta legitimar contenido distinto cambiando un hash o regenerando un sidecar no aprobado
- **THEN** la identidad aprobada no coincide y el paquete es rechazado

### Requirement: El contenido de datos SHALL corresponder a las identidades aprobadas

La validación del contenido SHALL comprobar tanto las filas como su identidad y orden frente a los sidecars aprobados.
La fuente primaria SHALL ser la selección ordenada aprobada de 369 PRs Copilot; el perfil de validación SHALL ser la
selección ordenada aprobada de 30 tarjetas. Los checksums, conteos o forma compatibles por sí solos no prueban
identidad. La muestra histórica de 300 SHALL permanecer exclusivamente como entrada de un cutover manual aprobado,
sin función de perfil primario, fallback o fuente entrante v2.

#### Scenario: Contenido y orden aprobados

- **WHEN** los CSV, sidecars, checksums, cantidades e identidades ordenadas coinciden con las selecciones aprobadas
- **THEN** cada perfil conserva su identidad diferenciada y puede continuar a evaluación de estado

#### Scenario: Contenido distinto con igual cardinalidad

- **WHEN** un CSV contiene igual número de filas pero distintas identidades u orden que el sidecar aprobado
- **THEN** la preparación no comienza y el resultado no se declara listo

#### Scenario: CSV histórico ofrecido como fuente ordinaria

- **WHEN** el archivo histórico de 300 se ofrece como perfil, primaria o sustituto de cualquier fuente del bundle
- **THEN** se rechaza sin importarlo, enriquecerlo ni cambiar de fuente automáticamente

### Requirement: La compatibilidad de esquema y datos SHALL declararse por separado

`schemaCompatibility` SHALL declarar el esquema objetivo `study-schema-3`, verificado hasta la migración 014
inclusive, y
`dataCompatibility` SHALL declarar `copilot369-v1`, vinculado a los perfiles exactos y su contenido aprobado. Cada
objeto tendrá exactamente `produces` y `applicationSupports`, con el token objetivo como único elemento de su array
de soporte. No SHALL declararse compatibilidad con la primaria de 300 como mecanismo de rollback. Compatibilidad de
esquema no sustituye compatibilidad de datos, ni viceversa. Estos identificadores declaran soporte del destino y no
prueban el estado actual de una base, cuya clasificación vacía, existente o histórica se valida por separado.

#### Scenario: Compatibilidad de ambos ejes

- **WHEN** manifiesto e imagen declaran y soportan `study-schema-3` y `copilot369-v1`
- **THEN** satisface la declaración necesaria para evaluar la base, pero aún exige verificar su estado real e
  identidades persistidas

#### Scenario: Un eje incompatible o ausente

- **WHEN** falta soporte de esquema o de datos, o aplicación y manifiesto declaran tokens distintos
- **THEN** release, preparación y recuperación quedan bloqueados antes de usar la base

#### Scenario: Aplicación antigua frente a datos Copilot

- **WHEN** una aplicación solo reconoce el estado de esquema pero no declara `copilot369-v1`
- **THEN** no es candidata a rollback escribible ni a servir datos del estudio Copilot

### Requirement: El launcher SHALL adoptarse y verificarse antes del primer uso v2

Antes de publicar el primer paquete v2 o hacer el primer push autorizado a `master`, el operador SHALL instalar y
verificar localmente en el host el launcher capaz de validar v2 y su estado durable. La adopción SHALL confirmar el
consumidor realmente instalado, su versión o huella y el resultado de una comprobación local inocua; una modificación
de código sin instalación efectiva no cuenta. El paquete de release SHALL conservar exactamente `Caddyfile`,
`docker-compose.yml` y `release-manifest.json`. El launcher adoptado, configuración, secretos, credenciales, backups y
estado durable SHALL permanecer fuera de esos tres archivos y bajo control del host.

#### Scenario: Launcher compatible adoptado

- **WHEN** el operador acredita que el launcher instalado en el host entiende v2 y pasa la comprobación local previa
- **THEN** la precondición de adopción queda registrada como satisfecha para considerar un primer publish v2

#### Scenario: Launcher antiguo, no verificado o falta de evidencia

- **WHEN** el host aún usa un consumidor v1 o no hay evidencia de instalación y comprobación local
- **THEN** el primer publish v2 queda bloqueado y el HOLD continúa

#### Scenario: Adopción con productor v1 activo o reintento posible

- **WHEN** se intenta adoptar mientras pueden entrar pushes ordinarios a master o hay operaciones v1
  queued, running, esperando aprobación, reintentables o en vuelo
- **THEN** no se adopta hasta excluir pushes, drenar o cancelar cada operación, confirmar estados
  terminales de CI y ausencia de despliegue bajo lock, e impedir reejecución e ingreso v1 durante la
  ventana
- **THEN** el inventario registra IDs y tiempos de inicio de contenedor/servicio, fingerprints
  persistentes y espías de comandos; la aplicación anterior puede seguir ejecutándose si no hay
  corte ni cambio de base
- **THEN** la ventana continúa hasta que el productor v2 dedicado autorice y valide el primer
  candidato; después todo ingreso v1 se rechaza

#### Scenario: Paquete excede los tres archivos

- **WHEN** el archivo de release contiene entradas fuera de los tres nombres permitidos o duplica una entrada
- **THEN** se rechaza el paquete sin instalarlo ni alterar punteros

### Requirement: El inventario histórico SHALL ser de solo lectura y no migrarse en silencio

Los manifiestos v1 presentes en `current`, `previous` o el inventario de releases SHALL conservarse como historial de
solo lectura para inspección y recuperación compatible. El launcher no SHALL reescribirlos ni reinterpretarlos como
v2. Después de adoptar v2, un v1 SHALL ser rechazado como manifiesto entrante nuevo. La presencia de v1 no constituye
compatibilidad de aplicación con los datos v2 ni autorización para rollback hacia una base Copilot.

#### Scenario: Inventario v1 existente

- **WHEN** el host inspecciona releases históricas v1 durante adopción o recuperación
- **THEN** conserva sus bytes e identidad y las presenta como historial, sin convertirlas

#### Scenario: Reenvío de manifiesto v1

- **WHEN** se propone un manifiesto v1 como release entrante tras adopción v2
- **THEN** el launcher lo rechaza antes de instalarlo o publicar referencias

#### Scenario: Rollback v1 sin compatibilidad de datos

- **WHEN** una release v1 declara compatibilidad de esquema pero no la identidad de datos `copilot369-v1`
- **THEN** el launcher no inicia esa aplicación contra la base que contiene esos datos

### Requirement: Un estado durable SHALL representar por separado esquema y datos reales

El host SHALL mantener una fuente autoritativa durable del estado efectivo de la base que identifique
independientemente compatibilidad de esquema y compatibilidad de datos, y que no se derive solo de `current`,
`previous` ni de un manifiesto publicado. Antes de cualquier operación que pueda mutar PostgreSQL, incluidas la subida
de la base, migración, preparación y cutover manual, el estado SHALL pasar durablemente a `pending` con identidad de
operación y destino. Solo una verificación posterior de la base real puede registrarlo como `verified`; un estado no
demostrable SHALL ser `unknown`. Cambiar un enlace o publicar un manifiesto no equivale a persistir ni verificar estado
de datos. El registro conserva `origin` como observación readonly del estado previo, sin tratarlo como estado efectivo
actual en `pending`/`unknown` ni como autorización para mutar.

#### Scenario: Operación potencialmente mutante

- **WHEN** una release va a iniciar cualquier acción que pueda afectar la base
- **THEN** identidad, objetivo y estado `pending` son durables antes de la acción, y un fallo al persistirlos impide
  la mutación

#### Scenario: Verificación efectiva completa

- **WHEN** termina la operación y una lectura de la base confirma por separado esquema e identidad de datos objetivo
- **THEN** el estado puede registrarse como `verified` para esa identidad de operación y base

#### Scenario: Estado de publicación obsoleto

- **WHEN** `current`, `previous` o `active-schema-version` señalan un estado distinto de la base efectiva
- **THEN** la reconciliación usa la base real y no convierte el puntero o valor histórico en prueba de compatibilidad

#### Scenario: Reserva monotónica y admisión de candidato

- **WHEN** un candidato validado solicita reserva de generación
- **THEN** se fija primero una reserva durable enlazada a DB, releaseId, generación, commit, ambos
  digests y los tres hashes de paquete; después se eleva el floor monotónico
- **THEN** generación menor, misma generación con candidato/contenido/DB distinto y replay genérico
  se rechazan; igual generación solo continúa con autorización explícita de la reserva exacta no
  consumida y verificación fresca
- **THEN** la reserva se consume únicamente después de publicación coherente; rollback compatible
  no reduce floor ni reabre reserva y una reserva abandonada desconocida bloquea generaciones
  posteriores hasta reconciliación

#### Scenario: Operación propia y operación abandonada

- **WHEN** una operación pending solicita continuar su siguiente paso declarado bajo lock exclusivo,
  por propietario confiable y con contexto coincidente
- **THEN** se permite ese único paso sin que prepare rechace su propio pending; al perderse el
  propietario, pasa a abandono y exige reconciliación readonly y autorización explícita
- **THEN** PID, timestamp o token de entorno enviado por cliente no prueban propiedad ni autorizan transición

#### Scenario: Reconciliación de pending abandonado

- **WHEN** el helper reconcilia un pending cuyo proceso propietario ya no conserva el lock
- **THEN** observa DB, runtime y punteros y persiste recibo/journal honesto; origen intacto
  demostrado permite reautorización explícita, destino exacto demostrado evita repetir escrituras de
  datos, y resultado parcial o no demostrable queda `unknown`
- **THEN** reconciliar no escribe PostgreSQL, no reinicia servicios y no corrige punteros; PID o
  marca de tiempo no prueba propiedad

#### Scenario: Handoff confiable a prepare

- **WHEN** el launcher propietario del lock autoriza el siguiente paso de prepare
- **THEN** crea contexto root-owned bajo directorio runtime privado modo 0700, archivo modo 0440 con grupo mapeado al
  GID del usuario no privilegiado de prepare, legible por este y escribible solo por root, y lo monta de solo lectura
  únicamente en `labeling-study-prepare`
- **THEN** el entrypoint comprueba recibo, operación, candidato y binding de DB; contexto de cliente
  o standalone no admite mutación
- **THEN** el límite protege frente a clientes no confiables, no frente a root del host; no se
  monta en servidor/Caddy ni se añade al paquete

#### Scenario: Publicación interrumpida

- **WHEN** la publicación se interrumpe entre actualizaciones de metadatos
- **THEN** solo prefijos exactos del orden `previous`, `current`, `active-schema-version`,
  `deployment` pueden reconciliarse mediante observación fresca y finalización explícita bajo lock
- **THEN** combinación desconocida, evidencia contradictoria o conflicto entre completion y floor
  bloquea y nunca declara éxito automáticamente

#### Scenario: Origen intacto tras interrupción

- **WHEN** reconcile demuestra por observación fresca que un pending abandonado no modificó el origen vinculado
- **THEN** solo una autorización explícita bajo lock permite iniciar de nuevo ese paso; reconcile por sí mismo no lo inicia

#### Scenario: Destino exacto tras interrupción

- **WHEN** reconcile demuestra que la DB ya contiene exactamente el destino del candidato enlazado
- **THEN** registra estado verificado y permite continuar el mismo candidato sin repetir migración, bootstrap ni cutover

#### Scenario: Estado parcial o evidencia malformada

- **WHEN** DB, runtime, recibos o journal son parciales, desconocidos, malformados o contradictorios
- **THEN** se conserva `unknown`/bloqueo y ninguna operación corrige automáticamente la DB, runtime o punteros

### Requirement: La preparación existente SHALL validar todos los estudios antes de escribir

El entrypoint completo de preparación SHALL clasificar el estado antes de migrar, aprovisionar, importar, enriquecer o
alterar datos. En una base vacía elegible, podrá crear los perfiles 369 y 30 en ese orden. Si ambos estudios ya existen
con identidades y contenido aprobados, SHALL verificarlos en modo de solo lectura. Una pareja parcial, discrepancia de
contenido, esquema desconocido o preparación interrumpida no SHALL continuar como si la base estuviera vacía ni omitir
su preflight por llamar a un coordinador interno. La preparación ordinaria SHALL tener enriquecimiento deshabilitado.

#### Scenario: Base elegible vacía

- **WHEN** la base se confirma vacía y sus prerrequisitos de esquema y compatibilidad están aprobados
- **THEN** puede preparar primero 369 y después 30 como una sola operación coordinada

#### Scenario: Aprobación de inicialización desde origen vacío

- **WHEN** el operador acredita base vacía elegible, instancia saludable, backup y candidato compatible antes del deploy
- **THEN** puede aprobar su inicialización sin afirmar que el origen ya contiene 369+30
- **THEN** el launcher registra pending, prepara y verifica el destino antes de iniciar aplicación o Caddy

#### Scenario: Ambos estudios exactos existentes

- **WHEN** ambos perfiles existen con membresía, filas, orden y estado aprobados
- **THEN** el entrypoint los verifica sin invocar migraciones, bootstrap, reprovisión, reimportación, refresh ni
  enriquecimiento

#### Scenario: Release sucesivo con decisiones guardadas

- **WHEN** la pareja exacta ya contiene clasificaciones, descartes y versiones de credenciales posteriores a su
  creación
- **THEN** la preparación vuelve a ser de solo lectura y conserva progreso, cuentas, membresías, snapshots y
  timestamps persistentes

#### Scenario: Pareja parcial o drift

- **WHEN** existe solo un perfil o una identidad, checksum, membresía o contenido difiere
- **THEN** el entrypoint falla antes de escrituras y no completa ni reemplaza el estado faltante

#### Scenario: Fallo del preflight exterior

- **WHEN** se invoca el entrypoint con una base existente no evaluada o estado de esquema desconocido
- **THEN** ninguna migración, provisión, importación o enriquecimiento precede al rechazo

### Requirement: La normalización física posterior al retiro SHALL ser externa, explícita y separada de prepare

La migración externa 015 SHALL estar fijada independientemente por el contrato interno de normalización, no SHALL formar
parte de `managedMigrations` (que contiene exactamente 001–014) y no SHALL ejecutarse desde prepare ordinario. Los bytes,
SQL y pins físicos canónicos de 001–014, `study-schema-3`, el objetivo de datos `copilot369-v1`, los datos y sus
semánticas científicas SHALL permanecer inalterados. La aceptación del ledger SHALL ser común para todos sus consumidores,
incluidos `util/study-schema.js::assertLedgerState`, `runStudyMigrations`, readiness y el verificador dedicado de cutover.
Cuando existe la fila 015, todos SHALL exigir el prefijo completo y ordenado de migraciones gestionadas 001–014, con 002 solo en su
posición permitida cuando exista, seguido opcionalmente por `015_normalize_retired_study_schema` después de 014. SHALL
rechazar IDs desconocidos, huecos, duplicados y orden incorrecto. 015 nunca SHALL pertenecer a `managedMigrations` ni
ejecutarse automáticamente; su presencia válida no SHALL confundirse con ID desconocido ni bloquear inicialización o
continuación legítimas. No SHALL añadir claves de manifiesto, verbos SSH,
workflows, dependencias ni archivos al paquete.

Sin 015, cada consumidor SHALL conservar su contrato previo para prefijos gestionados conocidos: el migrador admite
ledger vacío o prefijo válido incompleto, readiness puede inventariarlos y el cutover exige el prefijo completo hasta 014.
Ningún prefijo incompleto SHALL declararse aplicación lista por esta regla ni bloquearse por exigir anticipadamente 015.

El linaje canónico de una base nueva puede omitir 002. En cambio, para que una base se clasifique como la fuente especial
de catálogo retirado elegible a normalización, el ledger SHALL probar `002_retire_legacy_labeler` en su posición
permitida; la forma física retirada por sí sola no demuestra el retiro.

La pareja Copilot exacta 369+30 en catálogo físico canónico de 014, con o sin decisiones válidas, SHALL conservar
elegibilidad de prepare ordinario readonly sin registrar 015. La misma pareja en catálogo canónico con la fila válida
015 también SHALL permitir esa lectura ordinaria. El catálogo retirado solo
SHALL admitirse como candidato de normalización si coincide exactamente con la evidencia fijada de la FK ausente, los
tres índices sobrantes y las diferencias de RI; esta designación no equivale a exactitud física, readiness ni hash
alternativo. `014_copilot_369_cardinality` podrá aparecer como designación observacional con huella de fuente exacta en el
contrato cerrado, pero no como token de compatibilidad de aplicación.

La elegibilidad de contenido SHALL reconocer de forma independiente solo base vacía, pareja histórica exacta 300+30 o
pareja Copilot exacta 369+30. SHALL preservar decisiones válidas existentes y rechazar filas desconocidas, parciales,
huérfanas o con drift antes de escribir. La condición de cero historial primario SHALL seguir perteneciendo únicamente
al cutover posterior. La normalización no SHALL convertir una base 300 en Copilot 369.

El mantenimiento SHALL exigir autorización externa explícita, writers detenidos, lock host, advisory lock de esquema y
locks de DB, identidad saludable comprobada, preflight y relectura de linaje/catálogo/huérfanos/pin 015, backup externo
completo con restore aislado verificable, candidato validado y reserva/floor/pending durables antes de SQL. La acción
local SHALL usar alcance exclusivo `normalize`; el campo `action` de la solicitud externa controlada por root y el recibo
`authorization.action` SHALL ser exactamente `maintenance-normalize`. La autorización de mantenimiento de cutover no
autoriza 015 y la autorización de normalización tampoco autoriza cutover. Son valores de campos existentes, sin nuevas claves
raíz; SSH SHALL conservar solo deploy/rollback. No
incluirá retiro automático, bootstrap, provisionamiento, enriquecimiento, cutover, prepare, runtime, reinicio ni
publicación.

La migración planeada se identifica como `schema/migrations/015_normalize_retired_study_schema.sql`; su pin es independiente
de los pins de 001–014 y no se crea ni ejecuta como parte de esta planificación. La transacción SHALL validar equivalencia
de índices canónicos y definiciones/dependencias de los tres índices exactos,
validar huérfanos y agregar la FK no diferible `participant_category_participant_id_fkey` de
`participant_category(participant_id)` a `reviewer(id)`. Solo SHALL eliminar `pr_classification_participant_id_updated_at_idx`,
`study_card_pr_card_id_idx` y `study_participant_reviewer_id_idx`. No SHALL usar CASCADE, borrar, reasignar ni rellenar
filas. Antes del commit SHALL comprobar que el catálogo RESULTANTE coincide con el contrato físico canónico 014; SHALL
preservar filas PREEXISTENTES, incluidos IDs, cuentas, credenciales, snapshots, decisiones, timestamps y filas PREVIAS
del ledger; SHALL insertar únicamente la nueva fila 015 en esa misma transacción.
Desde 014 canónica, la operación autorizada puede ser DDL no-op y añadir solo 015. En estado 015 ya válido, repetir es
readonly e idempotente, sin otra fila; estados intermedios desconocidos fallan sin reparación. Fingerprints de aplicación
y filas previas del ledger SHALL quedar iguales. El fingerprint total de DB admite exactamente la única fila nueva
esperada de 015 y no se declara idéntico.

Readiness, el verificador del ledger de cutover y los demás consumidores SHALL compartir aceptación acotada de 015 sin
relajar precondiciones científicas del cutover. Con ledger gestionado completo hasta 014, `runStudyMigrations` no SHALL
reaplicar migraciones, ejecutar 015 ni escribir ledger o datos de aplicación. La ruta ordinaria Copilot exacta 014/015
SHALL seguir readonly y evitar el migrador. Journal y recibos mantienen exactamente 12 claves raíz. `normalization_verified`
SHALL ser fase finita propia tras `reserved` y `pending`, con parada, target `study-schema-3` y datos observados
independientemente como `empty`, `legacy300-v1` o `copilot369-v1`. `origin` SHALL continuar inmutable; fase, target y
observación SHALL validarse con contratos cerrados. Reserva no consumida, floor y punteros permanecen sin cambio.

Cada origen admisible (vacío, histórico 300+30 y Copilot 369+30) SHALL detenerse en `normalization_verified`: sin
bootstrap, cutover, runtime, reinicio, publicación, cambio de punteros ni consumo de reserva. Una base Copilot que ya
tenga esquema, datos y tokens del release finales SHALL completar la fase y su autorización; no SHALL saltar a runtime
o publicación. Autorización ausente, expirada, de candidato distinto o limitada a normalización SHALL bloquear la fase
siguiente hasta una continuación separada, fresca y explícita.

`origin` SHALL preservar la observación pre-015, mientras que el baseline del paso siguiente SHALL ser el predecesor
verificado post-015. Backup, restore y handoff para una mutación posterior SHALL enlazarse a ese baseline; un backup
pre-015 SHALL rechazarse antes de SQL. Si ocurre un crash tras commit SQL y antes del recibo, reconcile readonly SHALL
registrar checkpoint solo con catálogo canónico y fila 015 exacta; no SHALL repetir 015 y SHALL detenerse hasta nueva
continuación. La forma física sola sin fila 015 no prueba commit; lo parcial o desconocido permanece bloqueado.

#### Scenario: Pareja Copilot canónica 014 sin fila 015

- **WHEN** la base tiene catálogo canónico 014 y exactamente el bundle Copilot 369+30 válido, con o sin decisiones
- **THEN** prepare/readiness ordinarios terminan en readonly, admiten el estado sin 015 y no registran ni ejecutan 015

#### Scenario: Primaria histórica retirada en flujo ordinario

- **WHEN** el catálogo retirado 014 se presenta al prepare/readiness ordinario, aunque el retiro legacy esté probado
- **THEN** se rechaza la aplicación ordinaria sin ejecutar 015; solo el inventario readonly o mantenimiento explícito de
  normalización puede evaluarlo

#### Scenario: Catálogo retirado exacto elegible

- **WHEN** la inspección coincide con el pin retirado fijado y el bundle es vacío, legacy300+30 exacto o Copilot369+30 exacto,
  sin huérfanos ni drift
- **THEN** solo una acción local de normalización explícitamente autorizada puede proceder tras los gates de backup,
  restore, lock, writers, candidato y pending; no se declara aplicación lista ni se ejecuta prepare ordinario

#### Scenario: Huérfano, dato desconocido o fuente 015 inválida

- **WHEN** hay referencias huérfanas, contenido parcial/desconocido, catálogo distinto, linaje incompleto o pin/fuente 015
  no coincidente
- **THEN** la operación falla antes de escrituras y no intenta reparar ni alterar los datos

#### Scenario: SQL transaccional y evidencia 015

- **WHEN** se ejecuta la normalización aprobada desde el catálogo retirado exacto
- **THEN** se agrega y valida la FK, se retiran solo los tres índices declarados y se inserta 015 atomicamente, sin CASCADE
  ni cambios en datos o hashes físicos 001–014
- **THEN** todo cambio o fila nueva no esperados revierte la transacción y bloquea el resultado

#### Scenario: 015 ya aplicada o crash ambiguo

- **WHEN** el estado tiene catálogo normalizado y fila 015 exacta, o la reconciliación encuentra solo parte de la evidencia
- **THEN** 015 exacta se confirma readonly sin reejecución; evidencia parcial queda blocked/unknown y la forma física sin
  fila ledger no se toma como prueba de commit

#### Scenario: Continuación tras normalización verificada

- **WHEN** una nueva acción autorizada retoma el mismo candidato después de `normalization_verified`
- **THEN** deriva baseline del recibo normalizado, exige backup/restore nuevo antes de inicialización o cutover, conserva
  `origin` y no repite 015; 300 sigue sujeto a precondiciones de cutover y Copilot exacto a verificación readonly

#### Scenario: Cada origen se detiene tras normalizar

- **WHEN** termina normalización para origen vacío, histórico 300+30 o Copilot 369+30, incluso si Copilot ya coincide con
  los tokens finales
- **THEN** solo se registra `normalization_verified`; no hay bootstrap, cutover, runtime, reinicio, publicación, cambio de
  punteros ni consumo de reserva

#### Scenario: Autorización no habilita continuación

- **WHEN** falta la autorización siguiente, expiró, identifica otro candidato o solo autoriza normalización
- **THEN** la fase posterior queda bloqueada hasta una continuación separada, fresca y explícita

#### Scenario: Backup pre-015 para una mutación posterior

- **WHEN** se ofrece un backup anterior a 015 para inicialización o cutover después de normalizar
- **THEN** se rechaza antes de SQL y se exige backup/restore enlazados al baseline verificado post-015

#### Scenario: Crash tras commit antes del recibo

- **WHEN** SQL confirmó 015 pero el proceso cayó antes de publicar recibo
- **THEN** reconcile solo registra checkpoint readonly al verificar catálogo canónico y ledger 015 exacto, no repite SQL y
  se detiene hasta continuación fresca; catálogo físico sin ledger no demuestra commit

#### Scenario: 300 normalizable con decisiones no cortable

- **WHEN** el origen histórico 300+30 contiene decisiones válidas al normalizar
- **THEN** la normalización puede ser válida, pero cutover sigue rechazado por la precondición existente de cero historial

### Requirement: El estado protegido de validación y la evidencia existente SHALL preservarse

La preparación SHALL conservar las 30 filas aprobadas, sus identidades, cuentas, versiones de credenciales, checksums,
snapshots y timestamps existentes. SHALL preservar también el estado persistente protegido de la primaria que no sea
objeto de un cutover aprobado. No se permite reset, borrado, backfill ni refresh como parte de un release ordinario.
Los ensayos autenticados que escriban datos SHALL usar fixtures sintéticos enteramente descartables, sin cuentas o
decisiones reales del estudio.

#### Scenario: Release ordinario con perfil 30 existente

- **WHEN** se valida o prepara un release sobre una base con perfil 30 aprobado
- **THEN** la evidencia comparable antes y después confirma que filas, identidades, cuentas, versiones, checksums,
  snapshots y timestamps no cambiaron

#### Scenario: Intento de refrescar o reconstruir validación

- **WHEN** una ruta ordinaria pretende regenerar credenciales, snapshots o filas del perfil 30
- **THEN** se bloquea antes de la escritura y se conserva el estado previo

#### Scenario: E2E mutante

- **WHEN** un ensayo realiza login, clasificación u otras escrituras autenticadas
- **THEN** todas las identidades y decisiones usadas pertenecen a fixtures descartables y no al estudio real

### Requirement: El cutover histórico 300 SHALL ser manual, separado y condicionado

La base que aún contiene la primaria histórica de 300 no SHALL ser migrada automáticamente por release ordinario. Su
transición a 369 requiere mantenimiento separado, aprobación explícita, backup externo verificable, aplicación,
preparación y escritores de enriquecimiento/esquema detenidos, identidades y checksums exactos de origen y destino y
cero clasificaciones, descartes o referencias históricas primarias dependientes. El preflight autoritativo vuelve a
verificar esquema, membresías e historial bajo sus locks antes de mutar. La verificación de un estado 369 exacto ya
existente SHALL ser de solo lectura, incluso con decisiones posteriores. Ningún release SHALL presentar un ensayo
sintético o la ejecución del cutover como autorización real.

#### Scenario: Cutover con todas las precondiciones

- **WHEN** el operador autoriza mantenimiento y se verifican backup, identidades, membresías, fuente, destino, esquema
  e historial exigidos
- **THEN** la operación manual puede transicionar la primaria preservando el estado protegido y deja evidencia
  verificable

#### Scenario: Reintento sobre destino 369 exacto

- **WHEN** la base ya contiene exactamente el destino aprobado
- **THEN** la comprobación termina en solo lectura y no vuelve a escribir tarjetas o membresías

#### Scenario: Backup, mantenimiento o identidad ausentes

- **WHEN** falta una aprobación, backup verificable, parada de escritores o coincidencia exacta de origen/destino
- **THEN** el cutover se bloquea sin mutación y el estado permanece en HOLD o `pending` según el punto de interrupción

#### Scenario: Base parcial o con historial

- **WHEN** la base histórica contiene clasificación, descarte, decisión o estructura fuera de las precondiciones
  aprobadas
- **THEN** no se fuerza ni limpia automáticamente; requiere resolución operativa separada

### Requirement: La recuperación SHALL exigir estado conocido y compatibilidad de esquema y datos

Rollback automático, rollback explícito y arranque de una aplicación anterior SHALL requerir estado durable `verified`
para la base real y soporte de ambos tokens: esquema y datos. Si el estado está ausente, malformado, `pending`,
`unknown` o no coincide con la base, esas acciones SHALL fallar cerradas hasta reconciliar la base real mediante
comprobaciones de solo lectura. Un fallo tardío de preparación, runtime, smoke test o interrupción después de marcar
`pending` no autoriza arrancar una aplicación incompatible aunque `current` siga señalando la release anterior. Los
punteros de publicación no SHALL afirmar que los datos no cambiaron.

#### Scenario: Recuperación compatible

- **WHEN** el estado durable verifica esquema y datos reales y la aplicación anterior soporta ambos
- **THEN** puede evaluarse el rollback de imagen sin revertir ni borrar datos

#### Scenario: Estado no verificable

- **WHEN** falta el estado autoritativo, está malformado o indica `pending` o `unknown`
- **THEN** rollback y arranque de aplicación anterior quedan bloqueados hasta reconciliación de solo lectura

#### Scenario: Preparación o smoke falla tarde

- **WHEN** ocurre un fallo después de que una operación mutante marcó `pending`
- **THEN** no se activa automáticamente una imagen anterior incompatible y `current` no se interpreta como evidencia
  de base intacta

#### Scenario: Cutover exacto seguido por deploy del mismo candidato

- **WHEN** la observación real confirma el destino exacto del candidato y el origen coincide con el
  baseline v1 registrado en `current` y `previous`
- **THEN** se registra una transición DB-ahead autorizada solo para ese candidato; su deploy
  posterior es continuación, no replay, y omite cutover, migración y bootstrap

#### Scenario: Deploy ordinario sobre pareja exacta

- **WHEN** el origen es una pareja exacta y el candidato solo ejecuta verificación readonly
- **THEN** no se exige el recibo de backup de inicialización; se conservan los requisitos de backup
  propios del release ordinario aplicable

#### Scenario: Primera release v2 incompatible con baseline v1

- **WHEN** falla runtime o smoke y las imágenes anteriores no soportan simultáneamente ambos tokens efectivos
- **THEN** no se hace rollback automático a v1; el servicio puede permanecer no disponible hasta
  recuperación autorizada del mismo candidato, release v2 compatible o restore separado aprobado

#### Scenario: Manifiesto anterior sin token de datos

- **WHEN** el release anterior no declara soporte de `copilot369-v1`
- **THEN** se rechaza antes de iniciar su servidor contra la base Copilot

### Requirement: La restauración escribible SHALL usar destino separado aprobado

Una recuperación escribible de PostgreSQL SHALL requerir un backup verificable apropiado para el punto de recuperación
y una restauración a una base o destino separado aprobado. No SHALL restaurarse sobre el volumen productivo mediante
el launcher ni usarse `down -v`, inversión de migraciones o borrado de volumen como rollback. La recuperación conserva
referencias, evidencia y secretos externos bajo las fronteras del host. Ninguna ruta declara riesgo cero.

#### Scenario: Restore aislado verificado

- **WHEN** se selecciona un backup cuyo checksum, manifiesto e identidad se verifican y se restaura en un destino
  separado aprobado
- **THEN** la evidencia acredita únicamente ese destino y permite evaluar una aplicación compatible

#### Scenario: Intento de restauración in situ

- **WHEN** una recuperación intenta escribir sobre el volumen productivo, borrar el volumen o revertir migraciones
- **THEN** se rechaza sin iniciar la operación destructiva

#### Scenario: Evidencia de restore incompleta

- **WHEN** no se acredita backup, destino separado, checksum o verificación de identidad
- **THEN** la recuperación escribible permanece bloqueada y no se declara éxito

### Requirement: El backup previo SHALL verificarse antes de mutaciones desde origen vacío o prefijo conocido

Antes de reiniciar o subir servicios, migrar, bootstrap o preparar desde un origen vacío o con prefijo de migración
conocido que vaya a cambiar, SHALL existir un
backup externo PostgreSQL de base completa en formato custom y un restore aislado verificado. El origen SHALL ser una
instancia ya provisionada y saludable. El contrato SHALL ser independiente del esquema de aplicación y SHALL pasar por
el límite configurado `LABELER_BACKUP_COMMAND`; la salida `STUDY_BACKUP_VERIFIED` por sí sola no es evidencia. La
herramienta `npm run backup:study` no se SHALL ejecutar a ciegas para orígenes vacíos o prefijo 001 ni se SHALL migrar
para habilitarla. Captura y transferencia de control mutante requieren escritores detenidos; cualquier cambio desde la
captura invalida el recibo. Sin salud, identidad, backup o restore demostrables se falla cerrado. El recibo versionado,
tipado y externo SHALL enlazar cluster/system y OID/nombre de base, endpoint e identidad de volumen host; esquema/prefijo
observado; intervalo y versiones de herramienta/servidor; hash, ubicación, referencia de clave de cifrado y retención;
roles, extensiones y tablespaces necesarios, con globals protegidos o mapeo aprobado documentado; destino aislado,
resultado exacto de restore y verificación de esquema y datos. No SHALL contener secretos ni aparecer en logs públicos.

#### Scenario: Backup completo antes de mutación en origen vacío o 001

- **WHEN** se prepara candidato desde una base saludable realmente vacía o con prefijo conocido, incluido solo 001
- **THEN** recibo externo y restore aislado confirman identidad, volumen, esquema observado y
  destino antes de restart/up, migración, bootstrap o prepare
- **THEN** el marcador `STUDY_BACKUP_VERIFIED` sin recibo tipado y restauración comprobada se rechaza

#### Scenario: Pareja exacta en release readonly

- **WHEN** ambos estudios ya son exactos y la release solo verifica compatibilidad de lectura sin
  restart ni mutación
- **THEN** no se exige backup genérico de inicialización; siguen aplicando los gates de backup
  definidos para release y cutover

#### Scenario: Salud, identidad o restore no verificables

- **WHEN** falta salud del origen, binding de identidad, archivo/hash, prerrequisito de
  restauración o resultado de verificación aislada, o los escritores no permanecen detenidos hasta
  el handoff
- **THEN** no se reinician servicios ni se ejecuta mutación y el recibo no autoriza operaciones
  posteriores

#### Scenario: Recibo invalidado por cambio inesperado

- **WHEN** la base cambia de forma no prevista después del intervalo de captura y antes del handoff mutante
- **THEN** se exige nueva captura y verificación, sin reutilizar el recibo anterior

### Requirement: Los intentos interrumpidos y las decisiones del operador SHALL ser auditables

Cada decisión de adopción, elegibilidad, preparación, cutover, reconciliación y recuperación SHALL conservar identidad de
operación, estado de esquema y datos conocido, resultado y evidencia redactada. Durante adopción anterior al candidato,
`releaseId` y `generation` SHALL ser ambos `null`, con ID de adopción único y evidencia local independiente de un release.
Antes de cualquier mutación específica de candidato SHALL vincularse el registro al release, generación, commit y digest
verificados, sin inventar un ID futuro ni reutilizar la identidad histórica como si fuera la candidata. La evidencia
SHALL distinguir `pending`, `verified` y `unknown`. Una reanudación o repetición SHALL comprobar el estado real y no
deducir éxito de una salida perdida, un marcador aislado o la presencia de punteros. Los locks y generaciones SHALL
impedir que operaciones concurrentes o releases obsoletos publiquen sobre un estado más reciente. Los secretos,
contraseñas, tokens y contenido sensible no SHALL aparecer en manifiestos ni evidencia pública.

#### Scenario: Interrupción y reinicio

- **WHEN** el proceso se interrumpe antes o después de cualquier posible mutación y luego se reanuda
- **THEN** el operador puede determinar el último estado durable y la nueva ejecución repite preflight sin asumir que
  la anterior no escribió

#### Scenario: Adopción antes de publicar candidato

- **WHEN** se adopta el launcher sin que exista todavía un candidato publicado
- **THEN** releaseId y generation son null, con evidencia identificada por adopción y sin fabricar
  una release
- **THEN** no se permite mutación de candidato hasta vincular su identidad verificada

#### Scenario: Repetición después de decisión

- **WHEN** se repite una operación con una decisión previa registrada
- **THEN** se comprueba compatibilidad e identidad actuales antes de actuar y no se sobrescribe la decisión anterior

#### Scenario: Operaciones concurrentes o generación antigua

- **WHEN** dos operaciones compiten por estado o una generación obsoleta intenta publicar
- **THEN** solo la operación con autorización y generación vigente puede avanzar; la otra falla sin cambiar el estado
  vigente

#### Scenario: Evidencia expuesta

- **WHEN** el paquete, logs o recibos incluyen secretos o material sensible de cuentas
- **THEN** la evidencia se rechaza o redacta y no se publica como recibo admisible

### Requirement: La elegibilidad de release SHALL seguir en HOLD hasta evidencia operativa real

La existencia de esta especificación, una implementación futura, una prueba en fixtures o una validación local no
constituye adopción del launcher, autorización de cutover, backup verificable, restore probado ni readiness de
producción. El primer publish v2 SHALL permanecer bloqueado hasta verificar la adopción local del launcher y los gates
definidos por `copilot-369-pipeline`. El HOLD solo puede levantarse mediante revisión y autorización operativa
explícitas con evidencia correspondiente; este contrato no afirma que esas pruebas se hayan ejecutado ni que el riesgo
sea nulo.

#### Scenario: Artefactos de planificación o pruebas sintéticas

- **WHEN** solo existen especificaciones, código, resultados locales o ensayos con bases descartables
- **THEN** el release real permanece en HOLD y esos resultados no se presentan como evidencia de producción

#### Scenario: Adopción o gates pendientes

- **WHEN** no está verificada la adopción del launcher o falta un gate obligatorio
- **THEN** no se autoriza publish, push de release ni despliegue v2

#### Scenario: Evidencia operativa revisada

- **WHEN** adopción, gates, backup, estado de base y cualquier aprobación de cutover aplicable están verificados y
  revisados
- **THEN** puede evaluarse la autorización operativa por separado, sin que esta especificación la conceda
  automáticamente
