# Diseño de release Copilot 369

## Context

Ver `proposal.md - Why` para la motivación y `specs/release-study-bundle/spec.md` y
`specs/copilot-369-pipeline/spec.md` para los requisitos observables.

El sistema ejecutable y el launcher existentes consumen un manifiesto v1 de un solo CSV.
`scripts/create-release-manifest.js` fija `/labeling/data/pr-cards.csv`;
`deployment/deploy-vps.sh` comprueba claves exactas v1, el digest de ambas imágenes, salud de
PostgreSQL, backup, preparación y smoke test, y publica `current`/`previous` al final. Sin embargo,
su estado durable existente `active-schema-version` no demuestra la identidad de datos ni el estado
efectivo tras una interrupción.

La composición de release monta descriptor, configuraciones y manifests externos solo en
`labeling-study-prepare`; incluye `build` para uso de desarrollo pero el launcher de producción
fuerza `--no-build`. Caddy niega `/actuator` externamente y reenvía el resto a la aplicación. El
healthcheck del servidor es interno y no sustituye el smoke test público.

La preparación actual en `scripts/prepare-study-deployment.sh` ejecuta validación y luego puede
migrar antes de que `util/study-preparation.js` distinga una pareja existente exacta. El coordinador
de perfiles comprueba contenido y evita reprovisión cuando los dos estudios son exactos, pero solo
después de entrar al flujo que puede migrar. Por tanto el cambio requiere una preclasificación de
solo lectura en el entrypoint, no solo una llamada directa al coordinador existente.

Las fuentes canónicas verificadas en el checkout son:

- `plans/copilot-369-cards.csv`: SHA-256 `fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb`.
- `plans/copilot-369-cards.manifest.json`: SHA-256 `1837bc7a8cbd366349c8bc207cc236a0dec9d0b04f7f63325ee525884faf3f3a`.
- `plans/validation-30-cards.csv`: SHA-256 `1607cfe84cb687a2cc7b4c56d3e0abf106b1a1044810d7390663ef1d691b63ab`.
- `plans/validation-30-cards.manifest.json`: SHA-256 `5049b9357468ce98bd4f83057ea3e59178a5d03793f97800252d7e3e87e7dc1a`.

Los tokens son independientes: el esquema físico canónico producido por las migraciones gestionadas
001–014 es `study-schema-3`; la identidad de bundle de datos es `copilot369-v1`. Una normalización
protegida posterior al retiro puede alinear un catálogo retirado con el esquema canónico 014, sin
cambiar estos tokens ni convertir 015 en migración gestionada. El soporte mutuo de esos
tokens no prueba el estado efectivo de una base ni vuelve compatible con Copilot 369 una aplicación
antigua que solo conocía esquema 2.

## Goals / Non-Goals

**Goals:**

- Hacer que productor, paquete, imágenes y launcher compartan un contrato v2 exacto y verificable
  sin ambigüedad entre fuente de tarjetas, sidecar, esquema y bundle de datos.
- Registrar antes de cualquier posible escritura el estado pendiente de la base concreta y exigir reconciliación de solo
  lectura después de interrupciones.
- Separar validación de una pareja 369/30 existente, creación en base vacía y cutover manual de la primaria histórica.
- Coordinar gates de calidad, CI autenticado y entorno protegido con una secuencia operativa no
  cíclica para adoptar el launcher antes del primer push.
- Limitar la excepción de congelación a dos workflows y el compose de release, conservando fingerprints, revisión de
  owner y auditoría explícita.

**Non-Goals:**

- Ejecutar cutover 300→369 automáticamente, modificar decisiones históricas o cambiar las
  capacidades científicas principales.
- Provisionar PostgreSQL o infraestructura en la VPS, crear backups inexistentes, restaurar sobre
  el volumen productivo o afirmar que se probó la producción.
- Añadir comandos SSH, verbs de publicación alternativos, workflows nuevos, dependencias de
  aplicación o cuarto archivo de paquete.
- Levantar HOLD, aprobar el primer release, autorizar operaciones en host real o garantizar riesgo cero.

## Decisions

### 1. Contrato v2 estricto y de forma cerrada

El nuevo escritor, validador de host y pruebas usan JSON UTF-8 con solo estas claves raíz,
exactamente: `schemaVersion`, `releaseId`, `generation`, `commit`, `images`, `dataBundle`,
`schemaCompatibility`, `dataCompatibility`, `workflow`, `createdAt`. No se conservan alias v1 ni
claves desconocidas. `schemaVersion` es el entero `2`; `releaseId` sigue
`<generation>-<attempt>-<commit>` como en v1 aunque `attempt` solo esté codificado en el ID;
`generation` es entero no negativo; commit es 40 caracteres hexadecimales minúsculos; ambas
imágenes son referencias `:sha-<commit>@sha256:<64 hex>` y deben referir el mismo commit; workflow
y fecha conservan formato v1.

La forma completa es:

```json
{
  "schemaVersion": 2,
  "releaseId": "<generation>-<attempt>-<40-hex-commit>",
  "generation": 0,
  "commit": "<40-hex-commit>",
  "images": {
    "server": "ghcr.io/<owner>/<image>:sha-<40-hex-commit>@sha256:<64-hex>",
    "database": "ghcr.io/<owner>/<image>:sha-<40-hex-commit>@sha256:<64-hex>"
  },
  "dataBundle": {
    "profiles": [
      {
        "studyKey": "pr-card-sorting-local",
        "expectedCardCount": 369,
        "csv": {
          "path": "/labeling/data/copilot-369-cards.csv",
          "sha256": "fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb"
        },
        "manifest": {
          "path": "/labeling/data/copilot-369-cards.manifest.json",
          "sha256": "1837bc7a8cbd366349c8bc207cc236a0dec9d0b04f7f63325ee525884faf3f3a"
        }
      },
      {
        "studyKey": "pr-card-sorting-validation-30",
        "expectedCardCount": 30,
        "csv": {
          "path": "/labeling/data/validation-30-cards.csv",
          "sha256": "1607cfe84cb687a2cc7b4c56d3e0abf106b1a1044810d7390663ef1d691b63ab"
        },
        "manifest": {
          "path": "/labeling/data/validation-30-cards.manifest.json",
          "sha256": "5049b9357468ce98bd4f83057ea3e59178a5d03793f97800252d7e3e87e7dc1a"
        }
      }
    ]
  },
  "schemaCompatibility": {
    "produces": "study-schema-3",
    "applicationSupports": ["study-schema-3"]
  },
  "dataCompatibility": {
    "produces": "copilot369-v1",
    "applicationSupports": ["copilot369-v1"]
  },
  "workflow": "release/<run-id>/<attempt>",
  "createdAt": "<UTC-YYYY-MM-DDTHH:MM:SSZ>"
}
```

Las validaciones de valores conservan límites acotados: generación y attempt son enteros seguros
dentro del límite histórico del launcher; `releaseId` debe descomponerse exactamente en generación,
attempt y commit sin ceros iniciales ambiguos. `createdAt` debe ser una marca UTC real, no solo una
cadena con forma de fecha. `workflow` conserva la expresión permitida existente y no admite nombres
de secretos.

`dataBundle.profiles` se valida como lista de exactamente dos objetos con forma exacta, en ese orden,
esas rutas, conteos y cuatro hashes fijados. No se acepta CSV de 300 como perfil ni fallback.
`schemaCompatibility` y `dataCompatibility` tienen únicamente `produces` y
`applicationSupports`; cada array contiene exactamente su token producido, sin soporte antiguo
inventado. Los hashes se verifican contra los archivos físicos incluidos en la imagen servidor. Los
cuatro se leen mediante `docker run --network none --read-only` antes de instalar el release o
escribir compatibilidad/PostgreSQL; staging y diagnóstico acotados sí están permitidos. El
manifiesto raíz y ambas imágenes atan esos archivos al commit y digests publicados.

Se elige contrato estricto y versionado en vez de ampliar v1 opcionalmente porque el contrato
previo codifica un único CSV y no puede expresar dos perfiles ni compatibilidad de datos. El
launcher conserva lectura v1 solo para inventario histórico y recuperación evaluada; jamás
reescribe un manifiesto v1 ni lo acepta como ingreso después de adoptar v2.

La validación tiene dos etapas: primero validar estructura, identidad, tipos y relaciones sin
efectos; después validar artefactos de imagen y archivos externos. Si cualquiera falla, se puede
conservar el stream recibido y evidencia diagnóstica acotada en staging, pero no instalar/promover
un directorio de release, avanzar `highest-generation`, alterar el journal durable de
compatibilidad ni ejecutar comandos que escriban PostgreSQL. Un rechazo por formato no debe
contaminar la identidad del próximo intento.

### 2. Tres archivos de paquete y frontera de datos externa

El tar.gz conserva exactamente `Caddyfile`, `docker-compose.yml` y `release-manifest.json`. No se
añade archivo para CSV, config, cuentas o secretos: los cuatro archivos de fuente viajan dentro de
la imagen servidor, enlazados por digest, y la configuración y manifests de cuentas permanecen
fuera del paquete en el host. Compose solo los monta en `labeling-study-prepare`; servidor y Caddy
no reciben los datos de cuenta ni la configuración de perfiles. Los mounts deben ser archivos
regulares existentes, con identidad comprobada y permisos de solo lectura, y su configuración
externa debe corresponder a los perfiles aprobados; comprobar solo que existe un target dentro del
contenedor no basta.

Se mantiene esta frontera por portabilidad sin checkout en VPS y para no transferir credenciales
por Actions. Se descarta ampliar allowlist: los archivos extra crearían copias sin control de
secretos o fuentes paralelas. Ningún secreto de runtime, token GHCR, configuración privada ni
backup se empaqueta o imprime.

### 3. Estado efectivo durable separado de punteros de release

El estado autoritativo del host será un documento versionado `state/database-compatibility.json`,
independiente de `current`, `previous`, `active-schema-version` y manifiestos de release. Su contrato
inicial contiene `formatVersion: 1`, `status` (`verified`, `pending` o `unknown`), `operationId`,
`releaseId`, `generation`, `target`, `databaseIdentity`, `effectiveSchema`, `effectiveDataBundle`,
`lastVerifiedAt`, `evidenceRef` y `origin`. Son exactamente 12 claves raíz. `origin` conserva la
observación readonly del estado previo al candidato como evidencia de contexto; no representa el
estado efectivo actual en `pending`/`unknown` ni autoriza una mutación. `target` y el registro identifican por separado esquema y bundle
objetivo/efectivo; valores efectivos no conocidos son `null`, nunca inferidos. `operationId`
distingue intento actual de toda evidencia previa. Registros `pending`/`unknown` mantienen el último
estado observado en campos de evidencia, pero no lo presentan como estado efectivo vigente.

En adopción previa al candidato, `releaseId` y `generation` son ambos `null`, exclusivamente para una operación única
`adoption-<UUID>`. Su `evidenceRef` usa `evidence/adoption/<operationId>/database-state`, independiente de cualquier
directorio de release. El registro acredita inventario, no autoriza mutaciones de candidato. Antes de esas mutaciones,
una nueva operación vincula releaseId y generación no nulos con el manifiesto, commit y digests verificados de la imagen
publicada y conserva la evidencia de adopción. No se inventa un ID futuro ni se toma el release histórico como candidato.

Forma ilustrativa (no agrega claves libres ni reemplaza la validación exacta del documento):

```json
{
  "formatVersion": 1,
  "status": "pending",
  "operationId": "<unique-operation-id>",
  "releaseId": "<candidate-release-id>",
  "generation": 0,
  "target": {
    "schema": "study-schema-3",
    "dataBundle": "copilot369-v1"
  },
  "databaseIdentity": "<host-database-identity>",
  "effectiveSchema": null,
  "effectiveDataBundle": null,
  "origin": {
    "schema": "<readonly-observed-prior-schema>",
    "dataBundle": "<readonly-observed-prior-data-bundle>"
  },
  "lastVerifiedAt": null,
  "evidenceRef": "evidence/<release-id>/<attempt>/database-state"
}
```

La observación `origin` es un registro readonly del estado previo y se conserva como evidencia de
procedencia. No cambia `effectiveSchema` ni `effectiveDataBundle`, no convierte una observación
anterior en estado efectivo de `pending`/`unknown` y no constituye autorización para escribir.
La decisión de adopción de planificación aprobada en esta conversación confirma `origin` como la
duodécima clave raíz; no aprueba producción, mutaciones ni levanta HOLD.

`verified` exige campos efectivos que coincidan con lecturas actuales de DB, identidad y evidencia,
validados según la fase. `normalization_verified` registra `study-schema-3` y los datos de origen
verificados independientemente, sin cambios. El destino final del release exige conjuntamente
`study-schema-3` y `copilot369-v1`; esa misma combinación puede observarse en `normalization_verified`
si el origen ya contiene Copilot, sin autorizar runtime ni publicación. `pending` se escribe antes de mutar y `unknown` representa
estado no reconciliado o imposible de demostrar. La fase de normalización no inicia servidor ni
publica. El parser rechaza claves/valores ambiguos; la
evidencia referenciada es redactada y no transporta credenciales ni payload sensible.

La observación inicial puede acreditar `effectiveDataBundle: "empty"` sobre una base sin datos de
estudio y esquema vacío o prefijo conocido, o `"legacy300-v1"` sobre la pareja histórica
íntegramente identificada. Son estados de origen para inventario y elegibilidad, no tokens de
soporte de una aplicación v2 ni autorización de rollback legacy. El esquema observado se registra
como `empty`, prefijo de migraciones conocido o contrato físico verificado según corresponda; no se
etiqueta como `study-schema-3` sin comprobar 014. Una base vacía verificada puede autorizar
inicialización, pero nunca arranque de aplicación antes de verificar el destino 369+30.

Cada reemplazo del registro se escribe a temporal en el mismo filesystem, se sincroniza el archivo,
se renombra atómicamente y se sincroniza el directorio padre. Si el host/filesystem no ofrece o no
permite comprobar esa durabilidad, el launcher rechaza cualquier mutación. Se registra `pending`
antes de `docker compose up` de base, cualquier migración, preparación o cutover manual que pueda
escribir; falla al guardar pending bloquea el comando. Inspección readonly solo registra la fase
correspondiente cuando valida su contrato cerrado: normalización es esquema 3 más bundle de origen
independientemente verificado; destino final es esquema 3 más Copilot 369+30. Estado no demostrado
queda `unknown`.

El lock `locks/deploy.lock` se mantiene exclusivo durante despliegue, rollback, reconciliación y
mantenimiento/cutover manual. Un helper local privilegiado ofrece modos `adopt`, `reconcile`,
`maintenance`, `finalize-publication` y `continue`; SSH conserva exclusivamente deploy/rollback.
El proceso host que posee el lock mantiene abierto el `flock` durante todo el paso y crea un archivo
de contexto root-owned en directorio runtime privado modo 0700, archivo modo 0440 con grupo mapeado
al GID del usuario no privilegiado de prepare. Solo root puede escribirlo y prepare puede leerlo. El launcher lo
monta de solo lectura únicamente en `labeling-study-prepare`; el entrypoint verifica recibo,
operación, candidato y binding de DB antes de aceptar el handoff. Variables de entorno, contexto
creado por cliente, PID o timestamp no dan admisión. Este límite protege frente a clientes no
confiables, no frente a root host. No se monta contexto en servidor/Caddy ni se agrega al paquete.
Reconcile observa DB, runtime y punteros y persiste evidencia/journal honesto, incluso `unknown`,
pero nunca escribe DB, reinicia servicios ni corrige punteros. Finalización y continuación requieren
observaciones y autorización frescas bajo el mismo lock.

El journal conserva exactamente estas 12 claves raíz: `formatVersion`, `status`, `operationId`,
`releaseId`, `generation`, `target`, `databaseIdentity`, `effectiveSchema`, `effectiveDataBundle`,
`lastVerifiedAt`, `evidenceRef` y `origin`. `evidenceRef` apunta a recibos host-only,
versionados y de esquema estricto, separados del paquete y del manifiesto. Cada recibo acepta
exactamente estas 12 claves raíz: `kind`, `version`, `operationId`, `candidate`,
`databaseIdentity`, `phase`, `predecessorEvidence`, `authorization`, `backupRef`, `origin`, `target`
y `publication`. Se rechazan claves omitidas, desconocidas o duplicadas; cada recibo tiene máximo
64 KiB y una cadena finita de fases por operación. En adopción `candidate` es null; en otra fase
contiene exactamente releaseId, generation, commit, digests de ambas imágenes y hashes de los tres
archivos del paquete. Las demás claves enlazan identidad completa de DB, evidencia previa,
autorización separada, backup, observaciones de origen/destino y expectativas de publicación. Las
fases son `adoption`, `backup_verified`, `reserved`, `pending`, `normalization_verified`, `cutover_verified`,
`runtime_verified`, `smoke_verified`, `publication_intent`, `publication_metadata`, `completed`,
`abandoned` y `unknown`. Primero se publica recibo inmutable con fsync de archivo y directorio; luego
el journal actualizado con su `evidenceRef` se publica durablemente. Un recibo no referenciado no
autoriza nada y la observación real de DB decide compatibilidad efectiva.

La transición permitida es: ausencia a adopción con ambos IDs nulos; origen verificado a reserva
del candidato exacto; pending propio a su siguiente paso declarado; pending sin propietario a
reconciliación readonly abandonada. El padre que retiene flock entrega al proceso prepare contexto
protegido con operación/candidato/DB; prepare no rechaza su pending cuando coincide ese handoff. Si
se pierde el lock, la operación queda abandonada: origen intacto probado requiere reautorización
explícita; destino exacto probado se verifica sin repetir escrituras de datos; parcial o no
demostrable queda `unknown`. Reconcile solo persiste evidencia/journal honesto. Cutover a destino
exacto se acepta únicamente contra baseline v1 registrado en `current` y `previous` y para el
candidato enlazado; es puente DB-ahead registrado, no inferencia posterior. El deploy posterior del
mismo candidato continúa sin repetir cutover, migración ni bootstrap. Runtime y smoke verificados
pasan a intención de publicación, actualización fija de metadatos y completion. Estado parcial,
desconocido o no demostrable no se repara automáticamente.

La admisión reserva primero durablemente el candidato VALIDATED, ligado a DB y a releaseId,
generation, commit, ambos digests y los tres hashes de paquete; después eleva `state/highest-generation`.
Crash entre pasos bloquea admisión hasta reconcile, que bajo lock solo puede fijar el floor exacto de
la reserva superviviente, nunca bajarlo. G menor al floor se rechaza; G igual solo puede
continuar la reserva exacta no consumida con autorización explícita y verificación fresca, nunca como
replay general. Candidato, intento, contenido o DB distinto con la misma G se rechaza. Completion
consume la reserva tras publicación coherente. Rollback compatible no reduce floor ni reabre una
reserva; reserva abandonada desconocida bloquea incluso generaciones mayores.

Antes de publicar se escribe `publication_intent` con el tuple exacto before/desired de
`previous`, `current`, `active-schema-version` y `deployment`, incluyendo ausencia explícita. Cada
reemplazo se sincroniza en archivo y directorio padre. La publicación escribe, bajo lock, en este
orden fijo: `previous`, `current`, `active-schema-version`, `deployment`; floor reservado ya durable
y completion journal/evidence siempre al final. Solo un prefijo válido de
esa secuencia puede considerarse para reconcile y requiere finalización explícita, runtime/smoke
frescos y autorización. Combinaciones desconocidas y conflictos entre completion, punteros y floor
bloquean. Un primer v2 incompatible con baseline v1 no permite rollback automático; puede dejar el
servicio no disponible hasta recovery autorizado del mismo candidato, compatible v2 o restore
separado aprobado.

El lock coordina comandos del host que cooperan con el launcher; no es una barrera para un DBA que
actúa por fuera del procedimiento. Por ello, antes de cualquier backup o cutover mutante se detienen
y verifican por separado todos los escritores, incluidas tareas manuales. La conciliación compara
versión física y huellas de filas/membresía/identidad; no basta con observar que no hay un proceso
de Compose activo.

La secuencia actual publica varios enlaces y estado en pasos separados, por lo que un crash puede
dejar punteros discordantes. Un puente DB-ahead se admite únicamente cuando recibos previos registran
baseline v1 exacto en ambos punteros, destino observado verificado y candidato no consumido enlazado.
Ese caso es continuación controlada del mismo candidato, no discrepancia genérica. Cualquier otra
divergencia, estado parcial, desconocido o evidencia malformada bloquea deploy y rollback hasta
reconciliación; no se reescribe historia ni se declara éxito sin finalización explícita.

Se descarta derivar compatibilidad de `current` o `active-schema-version`: son metadatos de publicación, no prueba de
resultado de SQL. Tampoco se usa como prueba una salida de proceso perdida o solo un manifiesto firmado.

### 4. Lectura v1 y adopción antes del primer paquete v2

El consumidor del host debe instalarse y verificarse antes de permitir que un primer push confiable a
`master` publique v2. La ventana de adopción excluye temporalmente pushes ordinarios y re-runs del
productor v1: se drenan/cancelan ejecuciones queued, running, esperando aprobación, retryables o en
vuelo, se verifican estados terminales de CI y ausencia de deploy bajo lock, y se impide nuevo ingreso
v1 por control operativo verificable. No se agrega administración automática de ramas/environments.
Si exclusión o drenaje no se demuestra, no se adopta. El helper instala y verifica hash/versión,
  realiza inventario de releases, configuración e identidad/esquema DB estrictamente readonly, y puede
  escribir journal/recibos host-only. Registra IDs/tiempos de inicio de servicios y contenedores,
  fingerprints persistentes y resultados de espías de comandos para acreditar cero SQL/restart/prepare.
  La aplicación v1 puede seguir corriendo durante inventario inocuo sin cambio de base; escritores se
  detienen solo antes de backup/cutover mutante. La ventana continúa hasta primer candidato v2
autorizado y validado, luego se rechaza todo ingreso v1. Releases y manifiestos v1 quedan byte
intactos; su compatibilidad de esquema no implica `copilot369-v1`.

Antes del primer uso v2, las entradas siguen usando el contrato v1 histórico; tras adopción el
launcher acepta solo v2 como paquete nuevo. No hay periodo de interpretación heurística ni
conversión de manifiestos. El arranque de aplicación y el rollback requieren estado conocido y soporte de ambos tokens
efectivos. Esto no prohíbe una inicialización explícitamente autorizada desde origen vacío verificado ni el cutover
manual separado desde origen histórico elegible; esas operaciones solo permiten iniciar aplicación tras verificar el
destino 369+30. Una imagen legacy schema-2 nunca se trata como 369-compatible.

Se elige la adopción local previa porque el primer artefacto v2 podría alcanzar un host cuyo
launcher no entienda su manifiesto. No se crea ruta de publicación paralela para instalar el
consumidor: requiere una instalación host aprobada antes del push de release.

### 5. Clasificación de base antes de migraciones en el entrypoint completo

La rama de clasificación se ejecuta al principio de `scripts/prepare-study-deployment.sh`, antes
de invocar migrador, provisioning, importación, refresh o enriquecimiento. Un helper mínimo de
readiness de solo lectura, llamado por ese entrypoint, puede inspeccionar identidad de DB, esquema
físico, tablas/objetos conocidos, estados y pareja de perfiles; no implementa autorización
científica nueva ni altera las migraciones gestionadas 001–014. El catálogo retirado con la diferencia
exacta fijada para normalización se reconoce solo como elegible para esa operación, nunca como
aplicación lista, esquema exacto ni hash físico alternativo.

- **Vacía y elegible:** no hay objetos legacy incompatibles, estudios/datos ni esquema parcial
  desconocido; solo entonces sigue la ruta existente de creación ordenada 369 y 30 y migraciones
  aprobadas.
- **Pareja exacta existente:** esquema físico `study-schema-3` y ambos estudios, identidades,
  membresía, contenido y decisiones compatibles se validan en modo estrictamente readonly. Aun si
  existen decisiones guardadas, el entrypoint omite toda invocación de migración, bootstrap,
  aprovisionamiento, importación, refresh y enriquecimiento.
- **Primaria histórica de 300:** no se trata como bundle ordinario ni se prepara en flujo ordinario.
  Si además coincide el catálogo retirado exacto y el ledger prueba 002, puede ser elegible solo para
  la normalización protegida, que termina en `normalization_verified` y no hace cutover. La transición
  de datos a 369 sigue requiriendo el cutover manual existente, sin cambios a su lógica y con sus
  precondiciones; una release posterior verificará el par 369/30 readonly.
- **Parcial, drift, esquema desconocido u objeto legacy inesperado:** falla antes de mutaciones y no repara.
- **Pending interrumpido:** bloquea inicialmente; tras reconcile solo permite reautorizar origen intacto probado,
  verificar destino exacto sin repetir escrituras, o continuar/finalizar el mismo candidato en un prefijo de publicación
  expresamente registrado. Estado desconocido, malformado o parcial permanece bloqueado.

### Normalización protegida posterior al retiro

La migración externa `schema/migrations/015_normalize_retired_study_schema.sql` es mantenimiento
manual explícitamente autorizado, no pertenece a `managedMigrations`, que permanece exactamente en
001–014, y no se llama desde prepare ordinario. Su pin de fuente se fija independientemente en el
contrato interno de normalización. Se mantienen intactos
el SQL y los hashes físicos canónicos de 001–014, el objetivo `study-schema-3`, el bundle objetivo
`copilot369-v1`, los datos científicos, el cutover y la semántica de participantes, cuentas y
categorías privadas. No se agregan claves al manifiesto, verbos SSH, workflows, dependencias ni
entradas de paquete.

La aceptación del ledger es un contrato común y cerrado para todos sus consumidores, incluidos
`util/study-schema.js::assertLedgerState`, `runStudyMigrations`, readiness y el verificador dedicado
de cutover. Cuando existe la fila 015, todos exigen el prefijo completo y ordenado de migraciones gestionadas
001–014, con 002 solo en su posición permitida cuando exista, seguido opcionalmente por
`015_normalize_retired_study_schema` después de 014. Rechazan IDs desconocidos, huecos, duplicados y
orden incorrecto. La migración 015 tiene pin independiente, nunca pertenece a `managedMigrations` ni
se ejecuta automáticamente. Su presencia válida no se confunde con un ID desconocido ni bloquea la
inicialización o continuación legítimas.

Sin 015, cada consumidor conserva su contrato previo para los prefijos gestionados conocidos: el
migrador puede continuar desde un ledger vacío o un prefijo válido incompleto, readiness puede
inventariar esos orígenes y el cutover sigue exigiendo el prefijo completo hasta 014. La aceptación
acotada de 015 no convierte un prefijo incompleto en destino listo ni bloquea inicialización limpia.

La pareja Copilot exacta 369+30 en catálogo canónico 014, con o sin decisiones existentes, sigue
siendo elegible para prepare ordinario readonly sin registrar 015. La misma pareja en catálogo
canónico con una entrada 015 válida también permite esa lectura. Para reconocer el catálogo retirado,
además, se exige prueba de la fila de ledger de `002_retire_legacy_labeler`; no se infiere su retiro
por la forma del catálogo. Se rechaza 014 aislada y cualquier ID posterior distinto de la 015 fijada.
El catálogo retirado solo se reconoce si coincide exactamente con
la evidencia fijada, incluidos la FK ausente, los tres índices sobrantes y las diferencias de RI;
esa identidad es elegibilidad de normalización, no readiness, forma exacta ni hash físico alternativo.
`014_copilot_369_cardinality` puede designarse observacionalmente con huella exacta de fuente dentro
del contrato cerrado, pero no es un token adicional de compatibilidad de aplicación.

La elegibilidad de datos acepta únicamente base vacía, la pareja histórica exacta 300+30 o la pareja
Copilot exacta 369+30, cada una verificada por separado y sin modificar filas. Decisiones válidas
existentes no excluyen la normalización; datos desconocidos o parciales, huérfanos y drift fallan
cerrado. La exigencia de cero historial primario corresponde solo al cutover posterior, no a esta
normalización. La elegibilidad de origen y la readiness de aplicación son juicios distintos.

La operación requiere el wrapper local de mantenimiento con alcance exclusivo `normalize`. La
solicitud externa controlada por root usa su campo `action` y el recibo usa `authorization.action`, ambos con el
valor exacto `maintenance-normalize`; la autorización de mantenimiento de cutover no autoriza 015 y
la autorización de normalización tampoco autoriza cutover. Estos son campos existentes, no nuevas claves
raíz ni verbos SSH. La operación corre bajo flock host, advisory lock de esquema y locks de base,
con writers detenidos. Antes de SQL exige preflight y relectura de catálogo, linaje, huérfanos y pin
de fuente 015, identidad real de DB saludable, backup externo completo y restore aislado verificable,
y reserva de candidato validada con floor durable y pending durable.
No ejecuta retiro automático, bootstrap, provisionamiento, enriquecimiento, cutover histórico,
prepare, runtime, reinicio ni publicación.

En una transacción, primero valida equivalencia de los índices canónicos y definiciones/dependencias
exactas de los tres objetos permitidos; agrega y valida la FK no diferible
`participant_category_participant_id_fkey` sobre `participant_category(participant_id)` que
referencia `reviewer(id)`; elimina únicamente `pr_classification_participant_id_updated_at_idx`,
`study_card_pr_card_id_idx` y `study_participant_reviewer_id_idx`. No usa CASCADE, borra,
reasigna ni rellena filas. Antes del commit comprueba que el catálogo resultante coincide con el
contrato físico canónico 014 y que filas/IDs, cuentas, credenciales, snapshots, decisiones y timestamps
preexistentes permanecen sin cambios; añade atómicamente la fila
de ledger 015. Si el estado de origen ya es canónico 014, el DDL es explícitamente autorizado pero
no-op y solo puede añadir 015; si el estado conocido ya incluye 015, la repetición es readonly e
idempotente, sin nueva fila. Intermedios desconocidos no se reparan. Fingerprints de aplicación y
filas previas de ledger permanecen iguales; el fingerprint de toda la DB admite exactamente la nueva
fila esperada de 015 y, por ello, no se afirma idéntico.

Readiness, el verificador dedicado de cutover y todos los consumidores del ledger comparten la
aceptación acotada de 015 sin relajar las precondiciones científicas de cutover.
`runStudyMigrations` valida el mismo ledger antes de operar; con un prefijo gestionado completo hasta
014 no reaplica migraciones, no ejecuta 015 ni escribe ledger o datos de aplicación. La ruta ordinaria
Copilot exacta 014/015 permanece readonly y evita por completo el migrador. Reconcile readonly clasifica un preestado intacto
como pendiente de reautorización explícita; un catálogo normalizado más la fila 015 exacta puede
registrarse como `normalization_verified`; cualquier estado parcial, desconocido o malformado queda
bloqueado/unknown. La forma física por sí sola sin la fila 015 no demuestra commit interrumpido.

El journal y cada recibo conservan exactamente sus 12 claves raíz. `origin` permanece como
observación previa inmutable aprobada. `normalization_verified` es una fase finita propia, con
transición `reserved` → `pending` → `normalization_verified` y parada explícita. Para origen vacío,
histórica 300+30 y Copilot 369+30, cada resultado de esta fase detiene normalización: no inicia
bootstrap, cutover, runtime, reinicio, publicación ni cambio de punteros, y no consume la reserva.
La identidad Copilot ya exacta en esquema, datos y tokens de release tampoco omite la fase ni su
autorización. Una autorización ausente, expirada, de candidato distinto o limitada a normalización
no admite el siguiente paso; requiere una continuación separada, fresca y explícita. La fase registra
esquema real normalizado y bundle de datos verificado independientemente, que puede ser `empty`,
`legacy300-v1` o `copilot369-v1`; nunca supone que siempre sea Copilot. El target del paso es
`study-schema-3` más el bundle observado sin alterar, y cada combinación usa una validación cerrada
por fase. La reserva queda sin consumir, el floor no baja y los punteros de publicación no cambian.

Solo una continuación posterior, fresca y autorizada para el mismo candidato puede redirigir el
target al release existente (`study-schema-3`/`copilot369-v1`). Conserva `origin` inmutable y deriva
su baseline del recibo verificado inmediatamente anterior. Antes de la siguiente inicialización o
cutover se exige backup completo nuevo con restore aislado enlazado al baseline ya normalizado, no
al origen previo a 015. Vacío puede pasar a inicialización separadamente autorizada; 300 requiere
cutover existente con sus condiciones de cero historial; Copilot exacto continúa por verificación
readonly, sin migrador, y después por las fases runtime/smoke/publicación ya existentes. No se repite
015. Solo la publicación coherente ya definida consume la reserva. No se incorpora una nueva
secuencia de publicación. Una base histórica 300 con decisiones válidas puede normalizarse, pero el
cutover posterior sigue rechazado por su condición de cero historial primario.

La evidencia de origen permanece inmutable y anterior a 015. El baseline de cada paso posterior es el
predecesor verificado posterior a 015. Todo backup, restore o handoff que autorice una mutación
posterior debe enlazarse a ese baseline normalizado; un backup pre-015 no satisface el gate y se
rechaza antes de ejecutar SQL.

Si el proceso cae después del commit SQL y antes de publicar el recibo, reconcile puede registrar un
checkpoint readonly solo cuando observa el catálogo canónico y la fila exacta 015 del ledger. No
repite 015 y se detiene en `normalization_verified` hasta una continuación fresca. La forma física
canónica sin 015 no demuestra que el commit se registró; estado parcial o desconocido permanece
bloqueado.

El cambio de `scripts/prepare-study-deployment.sh` y helper de readiness modifica solo el
orden/orquestación y la lectura inicial. No cambia `schema/001..014`, semántica de corte,
decisiones de clasificación ni políticas científicas. Se descarta confiar solo en
`util/study-preparation.js`, porque su comprobación de pareja existente ocurre después de que el
shell actual pueda migrar.

### 6. Secuencia operativa no cíclica y gates de operador

La secuencia separa publicación de candidato y mutación real. Antes del primer push, la adopción
completa la exclusión/drenaje descritos en la sección 4, verifica consumidor e inventaría DB sin SQL
ni reinicios. PostgreSQL debe estar provisionado y saludable por separado. Para origen vacío o prefijo
conocido que vaya a cambiar, un backup completo custom y restore aislado preceden cualquier
restart/up, migración, bootstrap o prepare; el requisito de backup previo de `release-study-bundle`
define su recibo. La evidencia de backup del origen solo respalda ese origen: tras cutover esperado se enlaza
al mismo historial candidato, no se compara como snapshot del destino. Cambio inesperado invalida
el recibo. Una pareja exacta readonly mantiene sus gates ordinarios sin exigir backup genérico de
inicialización.

Un push confiable a `master` inicia `quality` → `build` → `publish`; publica las imágenes y paquete
v2 inmutables del mismo commit. El job `deploy` usa un entorno `production` cuya aprobación humana
debe ser real y no eludible, y espera mientras el operador coteja ese `releaseId`, commit y digests.
La ruta depende del estado observado:

- **Histórica de 300:** el operador detiene todos los escritores y preparación concurrente, refresca
  backup y toma el lock. Si existe checkpoint `normalization_verified` para ese candidato, reutiliza
  exactamente la reserva no consumida y el floor existentes, y exige autorización fresca y
  backup/restore nuevos ligados al baseline normalizado antes de ejecutar solo el siguiente cutover
  autorizado; no vuelve a reservar ni elevar el floor. Sin checkpoint previo, `maintenance` valida
  el candidato, persiste su reserva y eleva durablemente `state/highest-generation` antes de
  `pending` y de cualquier mutación, incluidas 014/cutover. En ambos casos ejecuta el corte aprobado
  con la imagen candidata verificada, sin iniciar su app ni prepare ordinario. Revalida todas las
  precondiciones bajo locks; solo después de comprobar esquema 3 y bundle 369+30 registra `verified`
  y aprueba ese mismo deploy. El launcher confirma el par readonly sin repetir migración/bootstrap.
- **Pareja 369+30 exacta:** el operador acredita compatibilidad existente antes de aprobar; el
  launcher verifica el entrypoint readonly incluso con decisiones posteriores.
- **Vacía o prefijo conocido elegible:** el operador acredita instancia saludable, identidad y
  ausencia de datos/objetos incompatibles, backup/restauración aislada y autorización para el
  candidato. Puede aprobar sin
  fingir que ya existe 369+30; el launcher registra `pending`, aplica migraciones y crea ambos
  perfiles, y verifica el destino antes de iniciar app/Caddy. Un fallo parcial queda bloqueado, no se
  completa ni borra automáticamente.

Esta orden resuelve el ciclo: adopción y elegibilidad preliminar habilitan la publicación; el push
produce la imagen exacta; el gate protegido permite completar el cutover histórico antes de aprobar
su despliegue. La inicialización vacía conserva su ruta ordinaria después de aprobación, sin exigir
una conversión previa ficticia. No se agregan branches de publicación ni verbs SSH. Si la aprobación
humana, protección, review, owner o su disponibilidad no se pueden comprobar, HOLD persiste.

El rollback de aplicación solo puede usar una release v2 cuya aplicación soporte tanto el esquema
efectivo como `copilot369-v1`, con journal `verified`. Un fallo después de pending no habilita
rollback automático aunque `current` sea anterior. Si preparación parcial, crash o estado real no
se puede probar, queda `unknown`; no se infiere preestado a partir del SQL ni se restaura sobre el
volumen productivo. Recuperación escribible exige backup adecuado y restore separado aprobado.

Los gates comunes son adopción e inventario, CI del candidato, environment que retiene deploy y verificación de ese
candidato y backup. Después, el orden es condicional: origen histórico alcanza 369+30 verificado mediante cutover manual
antes de aprobar deploy; origen vacío se aprueba para inicialización y alcanza el destino durante prepare, siempre antes
de arrancar aplicación; pareja existente solo se valida readonly. Todos terminan con salud, smoke público y publicación
coherente. Un green de CI nunca omite la autorización ni convierte elegibilidad de origen en compatibilidad de destino.

### 7. CI reproducible y equivalente al borde productivo

Se adapta únicamente `shared-validation.yml` y `release.yml` y su compose de release autorizado. La validación comprueba
fuentes/sidecars, forma v2, hashes y vínculo commit/digest; genera seis cuentas sintéticas en dos manifests separados con
tres logins por perfil y ejecuta las fases en orden 369 y 30. Semillas, sesiones y consultas llevan `study_id` explícito
derivado de la cuenta autenticada, nunca inferido de `-30` ni del orden global de tarjetas. Las reservas se aíslan por
caso/propósito, salvo concurrencia deliberada y respuestas privadas de varios participantes al mismo PR. Sesiones,
cookies y CSRF se aíslan.

CI ejecuta la selección completa unitaria (`npm run test:unit`) y pruebas específicas de release, integración y E2E.
Las carreras de navegador quedan secuenciales y acotadas, sin retries que oculten fallo, exclusiones, skips ni selección
reducida. Pruebas de cutover y mutaciones usan bases sintéticas descartables; la ventana de fingerprint de los datos
protegidos 30 verifica antes/después sin escritura. Se comprueba además una release sucesiva con decisiones persistidas
y fingerprints invariantes.

El runtime usa contenedores, red, volumen, puertos loopback y directorio temporal únicos por ejecución; no reutiliza
volúmenes productivos ni manifiestos reales. Si cleanup no demuestra ausencia de recursos, el job no reporta éxito;
SIGKILL o cancelación que impida verificarlo queda no confirmado, con evidencia saneada retenida, no un marcador ficticio
`removed=true`.

La ruta de borde real se conserva en la fixture CI: Caddy devuelve `/login` 200 y `/actuator` y subrutas 404; health del
servidor se prueba por red interna y separado del E2E. No se acepta el atajo de consultar solo `/actuator/health` tras
exponer directamente el servidor. Para runner se permite TLS interno y override de puerto/bind loopback únicamente,
sin alterar la política Caddy ni rutas de producción. E2E autentica los seis logins, tres por perfil, y valida privacidad,
CSRF/Origin, cookies `Secure`, `HttpOnly`, `SameSite`, flujos completos y exportación privada con 368/369 pendiente y
369/369 completo. El fixture de validación conserva sus 30 tarjetas y decisiones/fingerprint en la ventana entre releases.

La comprobación de publicación prueba identidades de dos o tres participantes, que un participante con una decisión
pendiente no descarga y que la exportación completa contiene exclusivamente el estudio autenticado con su número de
filas y forma de columnas esperados. Después se ejecuta el siguiente release de prueba sobre estado sintético persistido
para demostrar que el fixture protegido no cambia y que la verificación de pareja es idempotente y de solo lectura.

Las etapas requeridas fallidas, omitidas, canceladas o sin prerrequisitos bloquean build, publish y deploy. No se usa
`always()` para ocultar estado ni `continue-on-error`; solo diagnóstico/cleanup puede correr siempre y no alterar
resultado. La versión de OpenSpec en CI se fija en 1.9.0 y ejecuta el siguiente comando, verificando primero esa versión
en runner limpio:

```bash
openspec validate --all --strict --no-interactive --json
```

Se validan specs activas/main sin hardcodear un directorio de cambio que deje de existir al archivarlo. Es una herramienta
de CI, no una dependencia de aplicación.

Se conserva `actions/checkout` y demás SHA pins actuales de los dos workflows; no se actualizan pins como parte colateral.
No se añaden workflows.

### 8. Excepción de congelación con límites verificables

La única excepción propuesta entre rutas congeladas modifica `.github/workflows/shared-validation.yml`,
`.github/workflows/release.yml` y `deployment/docker-compose.release.yml`. Los otros cinco workflows quedan byte por byte
idénticos a baseline `b409233`; también permanece intacto `.github/CODEOWNERS`. Este mismo cambio de pipeline debe recibir
aprobación explícita de excepción, actualizar fingerprints SHA-256 y prueba de contrato con hashes calculados sobre los
cambios implementados, y preservar la revisión requerida de `@bigalcah`.

Antes de cualquier merge a `master` se ejecuta literalmente:

```bash
git diff --name-only origin/master...develop -- .github/workflows deployment/docker-compose.release.yml
```

Toda salida bloquea el merge ordinario. Para el merge dedicado aprobado, la salida no se silencia: debe coincidir
exactamente con el conjunto permitido y auditado, con aprobación de política, revisión de owner y fingerprints/contrato
presentes; cualquier ruta adicional bloquea. No se modifica CODEOWNERS ni se cambia branch protection mediante este
trabajo. El operador verifica que branch protection exija owner review y éxito de freeze-test y que el environment
`production` realmente pause el deploy; si eso no está disponible, no hay aprobación de release.

La regla general de `AGENTS.md` considera cualquier resultado no vacío como bloqueo, mientras que aquí se requiere una
excepción de tres rutas. La reconciliación futura debe ser un reemplazo de política acotado, aprobado expresamente,
preservando el comando literal como auditoría y comparando exactamente allowlist/hash revisados; no se añade excepción
wildcard ni se declara que el comando pase vacío cuando hay cambios autorizados. Ningún workflow restante ni
infraestructura administrativa se modifica.

Los fingerprints de los tres archivos permitidos se registran como baseline previo y nuevo digest obtenido durante
implementación, junto con la salida de test de contrato. Este diseño no inventa hashes futuros. La revisión de owner y
aprobación explícita de la excepción son prerrequisitos de integración, no algo que una prueba unitaria pueda simular.

### Alternativas consideradas

- Mantener manifiesto v1 y agregar un segundo CSV opcional: descartado porque el lector histórico no puede distinguir
  bundle, orden ni compatibilidad de datos.
- Inferir bundle/schema de `current` o `active-schema-version`: descartado porque punteros pueden quedar atrasados tras
  un fallo SQL o publicación parcial.
- Correr la migración 014 al iniciar cada release y dejar al bootstrap decidir: descartado porque una pareja válida puede
  contener decisiones y el entrypoint ya migró antes del check de solo lectura.
- Publicar otra rama/job o añadir un verbo SSH de cutover: descartado porque crea un segundo camino de producción y no
  resuelve la dependencia de adopción; el job protegido existente pausa el deploy del digest candidato.
- Relajar pruebas E2E para usar health interno o reintentos: descartado porque Caddy bloquea health externo
  deliberadamente y retries/skips ocultan fallos reales.
- Ampliar el paquete con config/CSV externa o credenciales: descartado por el contrato portable de tres entradas y la
  frontera de secretos en host.

## Risks / Trade-offs

- [Un fallo tras `pending` deja duda sobre SQL parcial] → bloquear arranque y rollback hasta reconciliación real readonly;
  sin estado demostrable conservar `unknown` y escalar a restore separado.
- [Estado de DB y punteros en varios archivos] → journal durable como autoridad, generación monotónica y bloqueo de toda
  combinación discordante hasta reconciliar.
- [Filesystem sin sincronización comprobable] → rechazar mutación, sin degradar silenciosamente a un `mv` no durable.
- [Launcher instalado sin verificación o soporte v2] → no autorizar primer push; guardar hash/versión y prueba inocua.
- [Configuración host apunta a otra cuenta/perfil] → comprobar identidad, checksum, archivo regular, permisos read-only
  y perfil aprobado de cada mount antes de tocar la base.
- [Base parcial confundida con vacía] → inventario y pareja completa antes de migración; parcial/drift/unknown falla.
- [Base no saludable o sin backup verificable] → no mutar; provisión y restore son operaciones externas aprobadas.
- [Aprobación GitHub no aplicada o candidato distinto] → HOLD; cotejar releaseId, commit y digests antes de aprobar.
- [Health accesible da falso E2E] → Caddy real con `/actuator` 404 externo; salud interna por separado.
- [Tests chocan por estado/IDs] → reservas por caso/estudio; compartir solo en concurrencia o privacidad deliberadas.
- [Limpieza interrumpida] → comprobar ausencia de recursos; sin recibo no hay éxito y se retiene diagnóstico saneado.
- [Excepción freeze fuera de alcance] → tres rutas exactas, cinco workflows intactos, hashes/contratos en el mismo cambio
  y aprobación de owner con auditoría literal.
- [Token de esquema divergente] → `study-schema-3` exacto en manifiesto, host, aplicación y pruebas.
- [Imagen anterior soporta esquema pero no datos] → exigir ambos ejes; schema-2/v1 no es fallback de datos.
- [Conexión de inspección con escritura] → usar rol de inspección con grants y transacción `READ ONLY` comprobados;
  sin esa evidencia no autorizar fase mutante.
- [Tests/contratos no ejecutados] → gates explícitos de suites, OpenSpec, integración, E2E y preservación; skipped o
  cancelled significa no satisfecho.
- [Cambio externo después de verificar DB] → escritores detenidos y relectura bajo lock antes de prepare; discrepancia
  invalida `verified` y exige reconciliación/`unknown`.
- [Volumen existente sin PostgreSQL respaldable] → detener antes de backup o migración; no inventar un backup válido.

## Migration Plan

1. Mantener HOLD. En una rama aprobada, completar contrato v2, escritor, validador y verificación de los cuatro archivos
   en imagen con sus tests; no tocar producción ni inventar fingerprints futuros.
2. Implementar journal durable, inspección/reconciliación readonly, lock existente y guardas de generación. Clasificar
   antes de migrar; conservar 014, el cutover manual y el paquete de tres archivos sin cambios de comportamiento.
   Añadir por separado 015 externa, su pin interno y el flujo explícito de normalización; nunca incluirla en migraciones
   automáticas ni invocarla desde prepare ordinario.
3. Implementar CI sintético y Caddy equivalente; ejecutar unidad completa, integración, E2E y release sucesivo. Fallo,
   skip, cancelación o cleanup no confirmado bloquea publicación.
4. Actualizar fingerprints y contrato en el mismo cambio. Entre rutas congeladas, solo cambian las tres aprobadas;
   cinco workflows siguen byte-idénticos a `b409233`. Preservar CODEOWNERS y SHA pins.
5. Antes del primer push a `master`, excluir pushes ordinarios y drenar/cancelar operaciones v1
   queued, running, esperando aprobación, retryables o en vuelo; confirmar CI terminal, ningún
   deploy bajo lock y bloquear reingreso/re-run. Si no se
   prueba, no adoptar. El helper instala consumidor, inventaría historial y DB readonly, escribe evidencia permitida sin
   SQL ni restart y mantiene la ventana hasta primer candidato v2 autorizado y validado. La app anterior puede seguir
   corriendo si no hay corte ni cambio de base.
   La adopción sin candidato usa IDs de release/generación null, no valores ficticios. Sin evidencia sigue HOLD.
6. Ejecutar audit literal sin ocultar salida; aprobar excepción exacta, owner y controles de rama/environment. Una ruta
   extra detiene el merge.
7. El push confiable ejecuta calidad, build y publicación del candidato v2. Deploy espera aprobación `production`;
   mientras espera no contacta el host ni muta su base desde CI.
8. Para ese candidato, seguir la sección 6: una base retirada elegible solo pasa por la acción local explícita de
   normalización, con backup/restore, reserva y pending frescos; termina en `normalization_verified` y se detiene. Una
   operación ya validada en checkpoint se omite, pero cualquier paso aún no ejecutado requiere autorización fresca y
   backup/restore nuevo ligado al baseline normalizado. En histórica de 300, sin checkpoint previo `maintenance` reserva
   bajo lock y eleva durablemente `state/highest-generation` antes de pending; después ejecuta 014/cutover manual. Con
   checkpoint previo reutiliza exactamente reserva/floor no consumidos y no los eleva otra vez; solo continúa al siguiente
   paso cutover autorizado con autorización y backup/restore frescos.
   El destino debe quedar verificado antes de aprobar deploy; pareja exacta se verifica readonly y vacía se acredita
   y autoriza para inicialización ordinaria.
    Parcial, drift, pending abandonado o unknown bloquea hasta reconciliación readonly; solo las transiciones previstas
    permiten reautorización del origen probado, continuación del candidato exacto o finalización explícita del prefijo
    válido de publicación. Malformado, parcial o no demostrable permanece bloqueado.
9. Tras aprobar, el launcher revalida candidato, imágenes, mounts y estado. Si maintenance ya reservó ese candidato,
   continúa únicamente la reserva exacta no consumida con autorización y observaciones frescas: no vuelve a reservar,
   no eleva otra vez el floor ni repite un paso ya verificado por su checkpoint. Un paso posterior aún no ejecutado,
   incluida inicialización/cutover, requiere autorización fresca y puede ejecutarse bajo sus precondiciones. Sin reserva previa, persiste una nueva reserva
   validada y después eleva durablemente el floor, antes de pending o cualquier mutación. Para origen vacío o prefijo
   conocido que vaya a cambiar, backup completo custom y restore aislado
   verificados preceden restart/up, migración, bootstrap o prepare. Captura conserva escritores detenidos hasta handoff;
   no se usa `backup:study` como atajo para vacío/001. Pareja exacta readonly conserva sus gates ordinarios sin exigir
   backup genérico de inicialización. En cutover esperado, el recibo de backup sigue ligado al origen y al mismo historial
   autorizado del candidato, no se compara falsamente con el destino; cambio inesperado lo invalida.
   Registra pending antes de posibles escrituras;
   para vacía migra/prepara, para pareja existente omite migraciones/bootstrap y verifica readonly. Solo tras comprobar
   esquema 3, bundle, orden y preservación registra verified e inicia runtime, salud y HTTPS `/login` sin build.
   Caddy conserva Actuator externo en 404.
10. Publicar bajo lock en orden fijo `previous`, `current`, `active-schema-version`, `deployment`, con completion final.
    Un crash bloquea hasta reconcile readonly. Solo un prefijo válido registrado en `publication_intent` permite
    finalización explícita bajo lock con evidencia y smoke/runtime frescos; combinación desconocida bloquea.
11. Rollback de imagen solo con DB verificada y ambos ejes compatibles. Sin ello, detener la imagen incompatible y usar
    restore verificado en destino separado aprobado. Nunca `down -v`, downgrade de migraciones ni restore in situ.
    El rollback transaccional del cutover ante error sigue siendo obligatorio; no equivale a un downgrade.

Las pruebas cubren origen vacío conocido, pareja exacta, 300 histórico elegible, parcial, drift, esquema desconocido,
pending anterior, journal ausente/malformado, adopción sin candidato, imagen sin soporte de datos, fallo tras prepare y
crash entre reemplazos de punteros/estado. Los casos bloqueados no permiten nuevas escrituras de DB ni convierten current
en autoridad. La evidencia queda pending/unknown hasta reconciliación.

La suite cubre campos omitidos/extra/duplicados, tipos, v1 entrante y perfiles duplicados o reordenados.
También cubre fuente 300, hash falso, sidecar ausente, rutas no aprobadas, commit/tag/digest incoherentes,
releaseId, compatibilidad, fecha imposible,
workflow inválido y secretos detectables. Cada rechazo admite staging/diagnóstico acotado, pero no instala ni promueve,
escribe compatibilidad o ejecuta escrituras de base.

## Evidencia y referencias de implementación

Las referencias corresponden al estado inspeccionado y deben revalidarse al implementar; no son pruebas del futuro código.

- Motivación y alcance: `openspec/changes/copilot-369-release-pipeline/proposal.md`, secciones Why/What Changes/Impact.
- Fuentes, compatibilidad, adopción, journal, preparación y recuperación: `specs/release-study-bundle/spec.md`.
  El token canónico de esquema es `study-schema-3` en todos los artefactos.
- Gates, seis logins, export, privacidad, preservación, cancelación y freeze: `specs/copilot-369-pipeline/spec.md`.
- Writer v1 y ruta CSV singular actual: `scripts/create-release-manifest.js:6-26,65-99,125-145`.
- Validación v1, ingreso, generación, compose, CSV, rollback y publicación: `deployment/deploy-vps.sh`, funciones
  `read_manifest`, `receive_release`, `preflight_compose`, `publish_deployment` y rutas de rollback.
- Orden que necesita guardia exterior: `scripts/prepare-study-deployment.sh:22-64`;
  verificador de pareja y parcial: `util/study-preparation.js:21-65`.
- Montajes, dependencias y salud: `deployment/docker-compose.release.yml:42-132`;
  borde Actuator 404: `deployment/Caddyfile:5-9`.
- Procedencia de fuentes: `plans/copilot-369-cards.manifest.json` y `plans/validation-30-cards.manifest.json`;
  los cuatro hashes de Context se verificaron contra los archivos físicos.
- Pipeline existente y SHA pins a conservar: `.github/workflows/shared-validation.yml:13-37,131-217` y `.github/workflows/release.yml:15-30,52-63,150-195`.
- Interfaz anterior: cambios `vps-cicd-deployment` y `release-clean-profile-package`, sus diseños;
  reconciliar la interfaz sin editar esos artefactos.
- Congelación: diseño/spec del cambio `freeze-master-cicd-pipeline` y `AGENTS.md:102-118`.
- Documentación operativa de HOLD y hashes históricos: `docs/COPILOT-369-RELEASE-HOLD.md:6-50`.
- Documentación oficial GitHub Actions: reglas de `jobs.needs` y environments. Verificar su aplicación efectiva,
  sin inferir protección administrativa del YAML:
  <https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs>
  y <https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>.
- CLI OpenSpec local observada: `1.9.0`; la versión existe en el registro npm. La validación global estricta pasó 26
  cambios/specs durante esta planificación. Es comprobación de sintaxis disponible, no evidencia de implementación ni
  autorización operativa. El runner limpio deberá instalar y verificar exactamente `@fission-ai/openspec@1.9.0`.
