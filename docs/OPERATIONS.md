# Operaciones

La operación del estudio está documentada como `IMPLEMENTED-UNVERIFIED`. Hay código y contratos estáticos, pero no hay
evidencia aprobada de ejecución de infraestructura, HTTP o VPS. `AGENTS.md` mantiene el baseline ejecutable como
`LEGACY`; no presentes una tarea pendiente o un archivo existente como runtime verificado.

## Runbooks canónicos

- [`MULTI-STUDY-VALIDATION.md`](MULTI-STUDY-VALIDATION.md): perfiles 300 y 30, descriptor, orden de preparación y
  aislamiento.
- [`PARTICIPANT-GUIDE.md`](PARTICIPANT-GUIDE.md): usernames asignados, login y flujo privado del participante.
- [`EXPORT-RUNBOOK.md`](EXPORT-RUNBOOK.md): exportación offline operator-only y sus gates.
- [`deployment/GITHUB-ENRICHMENT.md`](../deployment/GITHUB-ENRICHMENT.md): aliases, permisos, conteos persistidos,
  estados, promoción y rerun.
- [`deployment/ROLLBACK.md`](../deployment/ROLLBACK.md): backup, rollback read-only y restauración separada.
- [`VPS-ADOPTION-CHECKLIST.md`](VPS-ADOPTION-CHECKLIST.md): preparación inicial de la VPS y activación del entorno
  protegido de release.

No dupliques esos procedimientos. Compose usa `labeling-database`, `labeling-study-prepare`, `labeling-server`, red
`labeling-network`, volumen `labeling-data` y el puerto interno `7755:3000`. La exposición pública prevista queda detrás
de Caddy en 80 y 443.

## Release automático de producción

El único origen de producción es `push` a `master`. El workflow de release reutiliza los gates de
calidad, integración y E2E. No publica imágenes, no envía un paquete y no conecta con la VPS si
uno de esos gates falla. Los cambios de `develop` y de pull request siguen su validación propia y
no despliegan producción.

### Paquete y referencias inmutables

La release construye `labeling-server` y `labeling-database` desde el mismo commit. El workflow
publica ambas imágenes en GHCR con tags `GITHUB_SHA`, resuelve sus digests y crea un archivo
`release-package-<release-id>.tar.gz`. `<release-id>` tiene la forma
`<GITHUB_RUN_NUMBER>-<GITHUB_RUN_ATTEMPT>-<GITHUB_SHA>`.

El manifiesto inmutable `release-manifest.json` que acepta el launcher contiene:

- `schemaVersion=1`, `releaseId` y una `generation` entera;
- un `commit` de 40 caracteres hexadecimales;
- `images.server` y `images.database` como referencias completas con
  `@sha256:<64 caracteres hexadecimales>`;
- `csv.sha256` para el CSV canónico;
- `schemaCompatibility.produces` y `schemaCompatibility.applicationSupports`.

El tag derivado del SHA sirve para localizar la construcción, pero la referencia efectiva es el
digest registrado en el manifiesto. No uses `latest`, tags reutilizables ni una imagen sin digest.

El paquete transferido contiene exactamente `Caddyfile`, `docker-compose.yml` y
`release-manifest.json`. No incluye `.env`, contraseñas, tokens, claves, manifests privados de
cuentas ni archivos temporales del runner. La VPS no necesita un checkout del repositorio.

La imagen de servidor contiene el CSV canónico en `/labeling/data/pr-cards.csv` y Compose configura
`STUDY_CSV_PATH` con esa ruta. El preparador no debe leer `plans/` ni un workspace del runner.

### Secuencia fail-closed

El launcher de VPS (`deployment/deploy-vps.sh`) ejecuta la release con una cuenta SSH dedicada y
restringida. El canal OpenSSH transmite el paquete por su entrada estándar y solicita la orden
`deploy <release-id>`; el launcher valida y lo instala en
`LABELER_DEPLOY_ROOT/releases/<release-id>` sin aceptar comandos arbitrarios. La secuencia no debe
cambiarse ni saltarse:

```bash
/absolute/path/to/deployment/deploy-vps.sh deploy <release-id>
/absolute/path/to/deployment/deploy-vps.sh rollback
```

El comando `rollback` no recibe un identificador: selecciona `previous` bajo lock y solo puede
intercambiarlo con `current` tras verificar compatibilidad de esquema y el smoke test.

1. Adquirir el lock del host y rechazar una generación anterior a la release activa.
2. Validar el paquete allowlisted sin secretos, el manifiesto, las variables externas y
   `docker compose config --format json`.
3. Descargar las imágenes exactas con `docker compose pull` y comprobar su estado e identidad.
4. Ejecutar `LABELER_BACKUP_COMMAND` y exigir la línea exacta `STUDY_BACKUP_VERIFIED`.
5. Comprobar PostgreSQL saludable y ejecutar `labeling-study-prepare` de la release. La
   preparación conserva el orden multiestudio: primero 300 tarjetas y después 30.
6. Recrear servidor y Caddy con `up -d --no-build --wait`, y esperar sus health checks.
7. Ejecutar desde fuera del contenedor una petición HTTPS a `/login` contra
   `LABELER_PUBLIC_BASE_URL`.
8. Conservar manifiesto, configuración resuelta, pull, inspección de imágenes, backup, health
   checks, smoke test y logs. Solo tras el éxito actualizar `current` y conservar la versión
   anterior en `previous`.

Un fallo de preflight, descarga, lock o backup conserva la release activa y no ejecuta migraciones
nuevas. Un fallo del preparador impide continuar hacia el tráfico público, no borra
`labeling-data` y deja su evidencia diagnóstica. Un fallo posterior al reemplazo solo permite
activar `previous` si la release declara compatibilidad con el esquema existente. El launcher no
revierte migraciones y nunca usa `down -v`.

### Variables, layout y evidencia

El operador debe instalar un directorio externo de releases y un archivo `.env` externo. El launcher
requiere estas variables del host:

```dotenv
LABELER_DEPLOY_ROOT=/absolute/external/labeler
LABELER_ENV_FILE=/absolute/external/labeler/deployment.env
LABELER_BACKUP_COMMAND=/absolute/external/labeler/bin/backup-study
LABELER_PUBLIC_BASE_URL=https://<PUBLIC_HOSTNAME>
```

`LABELER_DEPLOY_ROOT`, `LABELER_ENV_FILE` y `LABELER_BACKUP_COMMAND` deben ser rutas absolutas.
El directorio de releases, el archivo `.env` y el comando de backup deben ser recursos regulares
del host, no enlaces simbólicos; la configuración y el backup deben permanecer fuera del directorio
de releases. El launcher rechaza `PGPASSWORD` y
`STUDY_BACKUP_ENCRYPTION_PASSPHRASE`; las contraseñas y claves solo se leen desde archivos externos.

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

Solo existen dos perfiles aprobados. `pr-card-sorting-local` tiene `expectedCardCount=300` y usa las claves visibles
`javier`, `diego` y `pablo`, con usernames de login `javier`, `diego` y `pablo`. `pr-card-sorting-validation-30` tiene
`expectedCardCount=30` y conserva las mismas claves visibles, pero usa `javier-30`, `diego-30` y `pablo-30` para login.
No se admiten conteos arbitrarios.

El orden bloqueado es el siguiente:

1. Esperar PostgreSQL saludable.
2. Validar todos los descriptores, CSV, manifests, checksums, conteos, claves y usernames antes de escribir.
3. Preparar de forma transaccional `pr-card-sorting-local`, primero, y `pr-card-sorting-validation-30`, después.
4. Crear o reutilizar la membresía y provisionar las cuentas de cada estudio sin resetear credenciales compatibles.
5. Confirmar ambos estudios como `READY` y comprobar la readiness interna de la aplicación.
6. Permitir que Caddy publique solo después de esa readiness.

Un fallo del segundo perfil deja intacto el estudio de 300, pero mantiene la publicación no lista. Repetir una preparación
compatible conserva tarjetas, membresías, cuentas, categorías, decisiones, descartes y enriquecimiento existentes.

## Identidad y límites de superficie

El username solo busca una cuenta. La cuenta persistida y la sesión validada aportan el `study_id` y la identidad del
participante para cada ruta protegida. El navegador nunca elige el estudio por un selector, sufijo interpretado, URL,
query, formulario o cabecera. No hay selector de participante.

Las categorías son planas y privadas por participante y estudio. `CLASSIFIED` tiene exactamente una categoría; el
resultado `DISCARDED` conserva solo su motivo opcional. No hay UI administrativa, alta de cuentas ni una ruta HTTP de
exportación. `/export` no es una superficie disponible.

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

## Exportación offline

La exportación es una operación local de operador, nunca una ruta web. El procedimiento completo está en
[`EXPORT-RUNBOOK.md`](EXPORT-RUNBOOK.md). En resumen, crea un secreto HMAC externo de al menos 32 bytes, selecciona un
directorio absoluto externo que todavía no exista y ejecuta:

```bash
export STUDY_EXPORT_HMAC_SECRET_FILE="$HOME/.config/labeler/secrets/export-hmac"
npm run export:study -- \
  --study-key pr-card-sorting-validation-30 \
  --output "$HOME/.config/labeler/exports/validation-30"
```

El comando solo publica `results.csv`, `categories.csv` y `manifest.json` si el estudio está `READY` y todas las tarjetas
de cada participante tienen una decisión terminal. Lee PostgreSQL en una transacción `REPEATABLE READ READ ONLY`, no
sobrescribe destinos y no imprime el secreto ni los datos exportados. Conserva el archivo HMAC para reproducir los mismos
pseudónimos en exportaciones posteriores del mismo estudio.

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
