# Operaciones

La operación del estudio está documentada como `IMPLEMENTED-UNVERIFIED`. Hay código y contratos estáticos, pero no hay
evidencia aprobada de ejecución de infraestructura, HTTP o VPS. `AGENTS.md` mantiene el baseline ejecutable como
`LEGACY`; no presentes una tarea pendiente o un archivo existente como runtime verificado.

## Runbooks canónicos

- [`MULTI-STUDY-VALIDATION.md`](MULTI-STUDY-VALIDATION.md): perfiles, descriptor, orden de preparación y
  aislamiento.
- [`PARTICIPANT-GUIDE.md`](PARTICIPANT-GUIDE.md): usernames asignados, login y flujo privado del participante.
- [`EXPORT-RUNBOOK.md`](EXPORT-RUNBOOK.md): comparación CSV en navegador, autorización, privacidad y errores.
- [`deployment/GITHUB-ENRICHMENT.md`](../deployment/GITHUB-ENRICHMENT.md): aliases, permisos, conteos persistidos,
  estados, promoción y rerun.
- [`deployment/ROLLBACK.md`](../deployment/ROLLBACK.md): backup, rollback read-only y restauración separada.
- [`VPS-ADOPTION-CHECKLIST.md`](VPS-ADOPTION-CHECKLIST.md): preparación inicial de la VPS y activación del entorno
  protegido de release.

No dupliques esos procedimientos. Compose usa `labeling-database`, `labeling-study-prepare`, `labeling-server`, red
`labeling-network`, volumen `labeling-data` y el puerto interno `7755:3000`. La exposición pública prevista queda detrás
de Caddy en 80 y 443.

## Release automático de producción

El workflow configurado se activa con `push` a `master`. La publicación y despliegue permanecen en **HOLD** hasta acreditar
protecciones administrativas reales, revisión de owner, adopción del consumidor en host, backup y restore externos y
prueba pública en VPS. El workflow de release reutiliza los gates de
calidad, integración y E2E. No publica imágenes, no envía un paquete y no conecta con la VPS si
uno de esos gates falla. Los cambios de `develop` y de pull request siguen su validación propia y
no despliegan producción.

### Paquete y referencias inmutables

La release construye `labeling-server` y `labeling-database` desde el mismo commit. El workflow
publica ambas imágenes en GHCR con tags `GITHUB_SHA`, resuelve sus digests y crea un archivo
`release-package-<release-id>.tar.gz`. `<release-id>` tiene la forma
`<GITHUB_RUN_NUMBER>-<GITHUB_RUN_ATTEMPT>-<GITHUB_SHA>`.

El manifiesto inmutable v2 `release-manifest.json` que acepta el consumidor contiene exactamente estas claves raíz:

- `schemaVersion`, `releaseId`, `generation`, `commit`, `images`, `dataBundle`, `schemaCompatibility`,
  `dataCompatibility`, `workflow` y `createdAt`;
- `schemaVersion=2`, sin clave singular `csv`;
- `dataBundle.profiles` con 369 y después 30, cada uno con `csv` y `manifest` (`path` y `sha256`) fijados para los
  archivos canónicos definidos en `manifest.ARTIFACTS` del validador host v2;
- compatibilidad separada para ambos ejes, `study-schema-3` y `copilot369-v1`.

El tag derivado del SHA sirve para localizar la construcción, pero la referencia efectiva es el digest registrado en el
manifiesto. No uses `latest`, tags reutilizables ni una imagen sin digest. Los manifiestos v1 con muestra histórica 300
son readonly para inventario/cutover: no son ingreso nuevo, fallback ni rollback compatible sin ambos tokens efectivos.

El paquete transferido contiene exactamente `Caddyfile`, `docker-compose.yml` y
`release-manifest.json`. No incluye `.env`, contraseñas, tokens, claves, manifests privados de
cuentas ni archivos temporales del runner. La VPS no necesita un checkout del repositorio.

La imagen de servidor contiene estos cuatro artefactos canónicos del bundle, en este orden:
`/labeling/data/copilot-369-cards.csv`, `/labeling/data/copilot-369-cards.manifest.json`,
`/labeling/data/validation-30-cards.csv` y `/labeling/data/validation-30-cards.manifest.json`.
`STUDY_CSV_PATH` apunta al CSV primario `/labeling/data/copilot-369-cards.csv`. El preparador no
debe leer `plans/` ni un workspace del runner.

### Secuencia fail-closed

El consumidor v2 de host (`deployment/deploy-vps.sh`) usa una cuenta SSH dedicada y restringida. La
invocación forzada acepta únicamente `SSH_ORIGINAL_COMMAND` con `deploy <release-id>` o `rollback`,
no argumentos directos; el paquete llega por stdin. Los modos locales root-only usan
`deployment/release-host-control.py` y aceptan sus argumentos de control autorizados; no son una
interfaz SSH ni un bypass de la orden forzada. La configuración completa y la adopción están en
[`deployment/host/README.md`](../deployment/host/README.md). Una release publicada o un puntero no
prueban por sí solos el estado de la base.

La orden `rollback` no recibe identificador en SSH; opera bajo lock y exige journal `verified` frente a la base real, compatibilidad
de ambos ejes (`study-schema-3` y `copilot369-v1`) y verificación runtime/smoke. Los punteros publicados no prueban SQL;
v1 no es fallback seguro.

1. Adquirir el lock del host y rechazar una generación anterior a la release activa.
2. Validar el paquete allowlisted sin secretos, el manifiesto, las variables externas y
   `docker compose config --format json`.
3. Descargar las imágenes exactas con `docker compose pull` y comprobar su estado e identidad.
4. Para inicialización o mutación de mantenimiento autorizada, observar base y escritores detenidos y exigir que `LABELER_BACKUP_COMMAND`
   devuelva solo la ruta absoluta al recibo v1 `labeler-full-postgresql-backup`, verificado con backup custom completo,
   globals y prerrequisitos, retención, y restore aislado con fingerprints coincidentes.
5. Comprobar PostgreSQL saludable y ejecutar `labeling-study-prepare` de la release. La preparación valida o crea los
   perfiles 369 y después 30. Un origen v1/300 solo pasa por mantenimiento/cutover explícito, nunca por prepare ordinario.
6. Recrear servidor y Caddy con `up -d --no-build --wait`, y esperar sus health checks.
7. Ejecutar desde fuera del contenedor una petición HTTPS a `/login` contra
   `LABELER_PUBLIC_BASE_URL`.
8. Conservar manifiesto, configuración resuelta, pull, inspección de imágenes, backup, health
   checks, smoke test y logs. Solo tras el éxito actualizar `current` y conservar la versión
   anterior en `previous`.

Un fallo de preflight, descarga, lock o backup conserva la release activa y no ejecuta migraciones
nuevas. Un fallo del preparador impide continuar hacia el tráfico público, no borra
`labeling-data` y deja su evidencia diagnóstica. Un fallo posterior solo permite activar `previous`
con journal `verified` contra la base real y soporte de ambos ejes, `study-schema-3` y
`copilot369-v1`. Punteros y manifiestos publicados no prueban SQL; releases v1 no son fallback seguro.
El launcher no revierte migraciones y nunca usa `down -v`.

### Variables, layout y evidencia

El operador debe instalar un directorio externo de releases y un archivo `.env` externo. El launcher
requiere estas variables del host:

```dotenv
LABELER_DEPLOY_ROOT=/absolute/host/labeler
LABELER_ENV_FILE=/absolute/external/labeler/deployment.env
LABELER_BACKUP_COMMAND=/absolute/external/labeler/bin/full-backup-and-restore
LABELER_PUBLIC_BASE_URL=https://labeler.example
```

La raíz de estado debe ser distinta de las entradas externas: `LABELER_DEPLOY_ROOT=/absolute/host/labeler`, mientras
`.env` y el ejecutable externo quedan bajo `/absolute/external/labeler/`. Las rutas de configuración y ejecutable son
entradas externas a la raíz de estado, conforme a
[`deployment/host/README.md`](../deployment/host/README.md); esta muestra no es configuración
completa. El ejecutable de backup es una integración externa a proveer por el operador,
root-owned, absoluto y ejecutable. Devuelve solo la ruta del recibo `labeler-full-postgresql-backup`, nunca
`STUDY_BACKUP_VERIFIED`. Consulta [`deployment/host/README.md#backup-boundary`](../deployment/host/README.md#backup-boundary).
No se admiten secretos inline.

La forma lógica del layout es:

```text
<release-root>/
  releases/<release-id>/       # paquete allowlisted
  evidence/<release-id>/<utc-attempt>/
  state/highest-generation
  state/active-schema-version
  state/deployment
  locks/deploy.lock
  current -> releases/<release-id>     # release que atiende producción
  previous -> releases/<release-id>    # release anterior conservada
```

La configuración completa del host está en [`deployment/host/README.md`](../deployment/host/README.md). La invocación SSH
forzada acepta solo `SSH_ORIGINAL_COMMAND`; no acepta argumentos directos para `deploy <release-id>`. Esta secuencia
documental no acredita adopción ni autorización de producción.

El lock efectivo es `locks/deploy.lock`; la generación más alta está en
`state/highest-generation` y el esquema activo en `state/active-schema-version`. No los sustituyas
por archivos del workspace temporal de GitHub. Cada directorio de evidencia debe permitir
reconstruir qué ocurrió, sin guardar secretos. Registra el release ID, SHA, generación, digests,
checksum del CSV, workflow, fecha UTC, release anterior, resultado de cada etapa y rutas de los
logs. Una salida ausente no es evidencia de éxito.

La configuración de `.env`, los secretos montados, la credencial read-only de GHCR, los backups y
el volumen `labeling-data` viven fuera de `<release-root>`. El launcher los referencia sin
copiarlos al paquete ni imprimir sus valores.

## Perfiles y orden de preparación

El backup standalone `npm run backup:study` conserva su uso local, pero excluye tablas transitorias y no genera el recibo
externo `labeler-full-postgresql-backup` exigido por el host v2; tampoco basta en una base vacía o con solo 001. La
integración full es externa y la aporta el operador. Se requiere backup/restore para inicialización mutante desde vacío,
cutover histórico y mutaciones reautorizadas; el par exacto 369/30 verificado readonly no requiere recibo de inicialización.
Consulta [`deployment/host/README.md#backup-boundary`](../deployment/host/README.md#backup-boundary).

En una base con el par exacto 369/30, prepare verifica readonly: no migra, reprovisiona, reimporta, refresca ni enriquece.
Solo una base elegible vacía puede inicializar ambos perfiles bajo el handoff confiable del host v2. La primaria histórica
300 se rechaza en prepare ordinario y queda pendiente de mantenimiento/cutover dedicado. El retiro legacy (`existing`) y
el enriquecimiento GitHub descritos más abajo son flujos legacy separados, no preparación Copilot ordinaria.

Solo existen dos perfiles aprobados. `pr-card-sorting-local` tiene `expectedCardCount=369` y usa las claves visibles
`javier`, `diego` y `pablo`, con usernames de login `javier`, `diego` y `pablo`. `pr-card-sorting-validation-30` tiene
`expectedCardCount=30` y conserva las mismas claves visibles, pero usa `javier-30`, `diego-30` y `pablo-30` para login.
No se admiten conteos arbitrarios.

Para la inicialización autorizada de una base vacía elegible, el orden es el siguiente; no se repite
este aprovisionamiento sobre una pareja existente exacta:

1. Esperar PostgreSQL saludable.
2. Validar todos los descriptores, CSV, manifests, checksums, conteos, claves y usernames antes de escribir.
3. Preparar de forma transaccional `pr-card-sorting-local` (369), primero, y `pr-card-sorting-validation-30` (30), después.
4. Crear o reutilizar la membresía y provisionar las cuentas de cada estudio sin resetear credenciales compatibles.
5. Confirmar ambos estudios como `READY` y comprobar la readiness interna de la aplicación.
6. Permitir que Caddy publique solo después de esa readiness.

Un fallo del segundo perfil deja intacto el estudio primario, pero mantiene la publicación no lista. Repetir una preparación
compatible conserva tarjetas, membresías, cuentas, categorías, decisiones, descartes y enriquecimiento existentes.

## Identidad y límites de superficie

El username solo busca una cuenta. La cuenta persistida y la sesión validada aportan el `study_id` y la identidad del
participante para cada ruta protegida. El navegador nunca elige el estudio por un selector, sufijo interpretado, URL,
query, formulario o cabecera. No hay selector de participante.

Las categorías son planas y privadas por participante y estudio. `CLASSIFIED` tiene exactamente una categoría; el
resultado `DISCARDED` conserva solo su motivo opcional. No hay UI administrativa ni alta de cuentas. La comparación CSV
está disponible en `GET /export` para estado y `POST /export/download` para descargar, protegida por sesión, `Origin` y
CSRF. Solo se incluyen el solicitante y otros participantes del mismo estudio que completaron todas las tarjetas.

## Reglas de despliegue

El preparador debe terminar antes del servidor. `clean` no elimina objetos legacy; `existing` exige confirmación y backup
externo verificable. No borres `labeling-data`, no uses `down -v` como rollback y no restaures sobre producción.

En una VPS de producción no ejecutes `docker compose up --build` desde un checkout. La release
debe llegar como paquete, descargar sus digests y usar el launcher autorizado con `--no-build` en
la fase de reemplazo. Los comandos manuales con `--build` que aparecen en el README son para
entornos locales o para la compatibilidad del flujo legacy, no para activar una release de
producción.

La selección de cada muestra procede del CSV validado. La fixture de 30 se obtiene de forma determinista del CSV canónico,
con seis tarjetas por cada agente requerido. GitHub solo puede enriquecer snapshots desde `labeling-study-prepare`; no
selecciona la muestra y no hay captura live durante la clasificación.

## Exportación comparativa

La vista `GET /export` requiere sesión, muestra el estado recalculado y es de solo lectura. El POST
same-origin `POST /export/download` requiere sesión, `Origin` permitido y CSRF, y revalida que el
solicitante y al menos otra persona del mismo estudio completaron exactamente las 30 o 369 tarjetas
canónicas. La salida proviene de una única instantánea de solo lectura y solo contiene bloques de
participantes completos.

El CSV incluye `pr_id,pr_url` y tres columnas por participante incluido, con ordinales persistidos
estables y sin renumerar huecos. Dos participantes producen 8 columnas; tres producen 11. Es UTF-8,
RFC 4180, con CRLF y protección de fórmulas en salida. No se escriben datos y no hay paquete parcial:
el servidor termina de construir el archivo antes de responder. Estados y errores se detallan en
[`EXPORT-RUNBOOK.md`](EXPORT-RUNBOOK.md).

El comando `export:study`, sus tres archivos y la dependencia HMAC exclusiva fueron retirados; no
hay alternativa de operador. Backups operativos y archivos históricos descargados permanecen
intactos.

## Retiro legacy

El retiro operativo no es una limpieza automática. Es una secuencia cerrada y posterior al aislamiento del MVP.

1. Usa `clean` solo cuando el inventario no encuentre objetos legacy. Si los encuentra, el preparador debe fallar antes
   de escribir y antes de arrancar la web.
2. Usa `existing` solo con backup externo verificable, manifiesto, checksum, identidad de base y
   `LEGACY_RETIREMENT_CONFIRM=retire-legacy-labeler`.
3. Mantén `reviewer` mientras existan referencias desde `study_participant`, cuentas, categorías, clasificaciones u otros
   datos del MVP. No lo trates como fixture descartable.
4. Retira objetos legacy solo si el inventario confirma que no quedan consumidores runtime y si el objeto está autorizado
   por la migración protegida. No uses `DROP CASCADE` ni borrados manuales para hacer pasar el arranque.
5. Si falla cualquier verificación, conserva el estado previo, deja el servicio no listo y recupera solo desde un backup
   restaurado en una base separada o explícitamente aprobada.

## Evidencia pendiente

Estos runbooks no sustituyen evidencia de ejecución. Siguen pendientes la aceptación real de backup cifrado y restore
externos, el E2E histórico de aislamiento, el E2E público en VPS y el cierre documental formal. La captura GitHub live
también sigue pendiente y no debe describirse como implementada. Hasta reunir resultados con fecha,
entorno, alcance y logs conservados, la release automática debe considerarse documentada pero no
aceptada operacionalmente.
