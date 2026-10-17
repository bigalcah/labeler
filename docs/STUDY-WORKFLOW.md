# Flujo del estudio

## Estado documental

La implementación central del flujo multiestudio está completada. También está completado el E2E
hostil aislado de los dos perfiles de esta ola. `VERIFIED` se reserva para hechos estáticos o
ejecuciones con evidencia conservada. `IMPLEMENTED-UNVERIFIED` indica que existe código, pero no
hay evidencia runtime suficiente para declarar un entorno aprobado. `PLANNED` indica una capacidad
fuera del MVP y `LEGACY` identifica el etiquetador anterior.

La evidencia externa que falta permanece explícitamente pendiente: backup y restore, E2E hostil
histórico, E2E en VPS o entorno público, cierre documental histórico y captura live de GitHub.

<!-- study-documentation-contract:
{
    "schemaVersion": 1,
    "supportedCardCounts": [30, 300],
    "profiles": [
        {
            "studyKey": "pr-card-sorting-local",
            "expectedCardCount": 300,
            "participants": ["javier", "diego", "pablo"],
            "loginUsernames": {"javier": "javier", "diego": "diego", "pablo": "pablo"}
        },
        {
            "studyKey": "pr-card-sorting-validation-30",
            "expectedCardCount": 30,
            "participants": ["javier", "diego", "pablo"],
            "loginUsernames": {"javier": "javier-30", "diego": "diego-30", "pablo": "pablo-30"}
        }
    ],
    "preparationOrder": ["pr-card-sorting-local", "pr-card-sorting-validation-30"],
    "studyIdAuthority": "account-session",
    "participantSelector": "unavailable",
    "studySelector": "unavailable",
    "enrichment": {"mode": "optional-prepare-only", "liveCapture": "pending"},
    "export": {
        "access": "authenticated-session",
        "http": "available",
        "statusPath": "/export",
        "downloadMethod": "POST",
        "downloadPath": "/export/download"
    },
    "adminUi": "unavailable",
    "evidence": {
        "backupRestore": "pending",
        "historicalE2E": "pending",
        "vpsPublicE2E": "pending",
        "documentationClosure": "pending"
    },
    "commands": ["validate:study-profiles", "prepare:study-profiles", "docs:study-check"]
}
-->

## Perfiles, CSV y muestra

La preparación admite únicamente estos perfiles ordenados:

| Orden | `study_key` | Conteo | Usernames |
| --- | --- | ---: | --- |
| 1 | `pr-card-sorting-local` | 300 | `javier`, `diego`, `pablo` |
| 2 | `pr-card-sorting-validation-30` | 30 | `javier-30`, `diego-30`, `pablo-30` |

El CSV de cada perfil es la autoridad de selección e identidad. El CSV canónico fija las 300
tarjetas y la fixture de validación selecciona 30 de forma determinista desde esa fuente. Cada
archivo debe conservar `source_card_id` únicos, ordinal, checksum, contenido canónico, baseline
`pr_cards` y lenguaje. `study_card` conserva una sola pertenencia y orden comunes por estudio;
no se crean copias por participante.

El parser admite campos multilinea y JSON incrustado. Un conteo distinto de 30 o 300, IDs
duplicados, drift canónico o una fixture que no corresponda con la fuente debe bloquear la
preparación sin sobrescribir tarjetas, decisiones o membresía.

## Preparación secuencial

El preflight valida todos los descriptores, CSV, manifests, checksums, conteos, claves de estudio,
participantes, usernames y opciones de enriquecimiento antes de iniciar cualquier escritura. Después
procesa `pr-card-sorting-local` con 300 tarjetas y, solo tras completar esa transacción, procesa
`pr-card-sorting-validation-30` con 30. Cada perfil puede quedar en `READY`, y la aplicación y
Caddy solo avanzan cuando las dos fases y las cuentas están confirmadas.

Los comandos principales son:

```bash
npm run validate:study-profiles
npm run prepare:study-profiles
npm run docs:study-check -- --root .
```

`validate:study-profiles` exige `STUDY_PROFILES_INPUT` y devuelve un resultado no válido si falta
un archivo montado, cambia un checksum, aparece un conteo no admitido o no coincide el mapeo de
login. `prepare:study-profiles` repite esa validación y ejecuta el orden 300, luego 30. Un fallo
del segundo perfil no borra ni reescribe el primero y mantiene la publicación no lista.

`clean` falla ante objetos legacy y no los elimina automáticamente. `existing` exige confirmación
explícita y backup externo verificable antes de la retirada protegida. No uses `down -v` como
rollback y no restaures sobre producción. Los detalles están en
[`deployment/ROLLBACK.md`](../deployment/ROLLBACK.md).

## Participantes y categorías

La configuración usa `studyKey`, `expectedCardCount` y participantes únicos. El fallback del
perfil actual contiene tres participantes y exige 300 tarjetas. El perfil de validación contiene
los mismos participantes visibles y exige 30. Cada participante comparte las mismas tarjetas del
perfil, pero sus categorías, clasificaciones, descartes, observaciones y progreso se filtran por
`study_id` y `participant_id` derivados de la sesión.

Las categorías son planas, privadas y propiedad de un participante. Solo una clasificación `CLASSIFIED` referencia
exactamente una categoría. La taxonomía final jerárquica es `PLANNED` y no debe confundirse con estas categorías.

El login usa únicamente username y contraseña contra una cuenta provisionada. La cuenta y la
sesión de servidor aportan el `study_id` y la membresía autoritativos. No se puede seleccionar el
participante o estudio mediante URL, query, formulario, cabecera o sufijo de username. Las
mutaciones requieren sesión válida, CSRF y `Origin` permitido.

## Estados privados

- `PENDING`: no existe decisión del participante.
- `CLASSIFIED`: existe una clasificación privada con una categoría del mismo participante; admite observaciones y
  revisión optimista.
- `DISCARDED`: existe un descarte privado con motivo opcional; no elimina `pr_cards` ni `study_card`.

Las transiciones son `PENDING -> CLASSIFIED` o `PENDING -> DISCARDED`. Una tarjeta descartada no puede clasificarse y
una clasificada no puede descartarse. El replay del descarte solo es válido si el motivo coincide. Otros participantes
pueden decidir la misma tarjeta independientemente.

El progreso cumple `classified + discarded + pending = total`, con total esperado 300 o 30 según
el `expectedCardCount` persistido. No hay labels globales, multiselección compartida ni difusión
Socket.io. El mismo PR puede tener decisiones independientes en cada participante y estudio.

## Enriquecimiento GitHub

GitHub no selecciona la muestra ni cambia identidad, ordinal, checksum CSV, `pr_cards` o `study_card`. El proceso
prepare-only puede capturar metadata, commits, files, reviews y comentarios; timeline y diff son opcionales. Los bodies
crudos y tokens no deben persistirse. La credencial solo está disponible para el operador durante
prepare. Las rutas de clasificación, la aplicación web y el navegador no llaman a GitHub.

Solo un run completo, del mismo estudio y checksum, con exactamente 30 o 300 snapshots según el
perfil persistido y sin decisiones previas puede promocionarse. El staging incompleto no es
visible. La proyección parte del CSV, puede usar valores GitHub no nulos de endpoints completos,
mantiene `language` del CSV y separa evidencia/procedencia.

Un perfil CSV-only no necesita token ni crea un run promovido. La captura live sigue pendiente y no
forma parte del runtime del participante.

El procedimiento canónico está en [`deployment/GITHUB-ENRICHMENT.md`](../deployment/GITHUB-ENRICHMENT.md); el rollback,
en [`deployment/ROLLBACK.md`](../deployment/ROLLBACK.md).

## Comparación CSV desde el navegador

Una persona autenticada abre `GET /export` para ver su estado actual. La página y la descarga
derivan el estudio y participante de la sesión; no aceptan selectores ni IDs de cliente. La vista
GET es de solo lectura y no requiere CSRF. La descarga usa `POST /export/download`, protegido por
validación de `Origin` y CSRF de la sesión, y vuelve a comprobar el gate en el servidor.

La descarga solo está disponible cuando quien la solicita y al menos otra persona del mismo
estudio tienen una decisión terminal (`CLASSIFIED` o `DISCARDED`) en cada una de las 30 o 300
tarjetas canónicas. Solo participantes completos aparecen en el archivo. Cada fila corresponde a
un PR, con `pr_id,pr_url` seguidos por tres columnas por participante incluido: categoría,
descripción y comentario. Los encabezados usan el ordinal estable de origen y no renumeran huecos;
dos participantes producen 8 columnas y tres producen 11.

El CSV se construye desde una única instantánea de solo lectura. Se genera completo antes de
publicar la descarga; no escribe datos del estudio ni contiene datos incompletos. Su salida es
UTF-8, delimitada por comas, con quoting RFC 4180 y CRLF. Los campos textuales que puedan
interpretarse como fórmulas reciben protección en la salida, sin cambiar los datos persistidos.
Los descartes se representan como `DESCARTADO` y dejan descripción y comentario vacíos.

Si falta la sesión, la respuesta es 401 y no se entrega archivo. Un `Origin`/CSRF inválido o un
gate no satisfecho produce 403; datos persistidos inconsistentes producen 409; un error interno
produce 500 sanitizado. Los errores no incluyen adjunto ni CSV. El cliente solo inicia una descarga
si recibe HTTP satisfactorio y `text/csv`; ante error ofrece reintento manual y nunca convierte
HTML en archivo.

El comando offline `export:study`, el paquete de tres archivos y su secreto HMAC exclusivo fueron
retirados. No hay comando alternativo de operador. Conserva backups operativos y archivos
históricos ya descargados sin modificarlos.

## Fuera de alcance

Son **LEGACY** los labels globales, conflictos, resolución destructiva, fixtures antiguos, Socket.io y exportaciones
JSONL del etiquetador genérico. Son **PLANNED** la taxonomía final jerárquica, normalización,
acuerdo, adjudicación, webhooks y workers permanentes. La captura live de GitHub no está implementada.

No se admiten conteos arbitrarios ni selección de participante o estudio desde la interfaz.

## Evidencia pendiente

La validación E2E hostil aislada de los dos estudios está completada. Siguen pendientes el backup y
restore externos verificables, el E2E hostil histórico, el E2E completo en VPS o entorno público y
el cierre documental histórico. La captura live de GitHub también permanece pendiente. No se debe
presentar ninguna de estas evidencias como ejecutada sin conservar su salida, fecha, entorno y
alcance.

## Fuentes

`AGENTS.md`, `util/csv-pr-provider.js`, `util/study-config.js`, `util/study-bootstrap.js`, `util/study-runtime.js`,
`util/study-mutation.js`, `routes/`, `schema/migrations/`, las vistas de revisión, Compose y los cambios OpenSpec
activos. La evidencia runtime no se infiere de la existencia de estos archivos.
