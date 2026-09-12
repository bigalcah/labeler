# Solución de problemas

## Cwd y entorno

Ejecuta desde la raíz. `index.js` usa `./views`; `dotenv` busca `.env` desde el cwd. El template de deployment usa
placeholders y no contiene credenciales listas para usar. No compartas tokens, passwords, manifests ni payloads.
El flujo aprobado solo admite `pr-card-sorting-local` de 300 tarjetas y
`pr-card-sorting-validation-30` de 30. Para preparar una instalación nueva, sigue primero el
[`checklist de adopción de la VPS`](VPS-ADOPTION-CHECKLIST.md).

## La release de `master` no inicia

El release de producción solo se activa con un `push` a `master`. Comprueba que el cambio llegó
a esa rama y que el entorno protegido `production` está disponible. Un commit de `develop`, una
pull request o cualquier otra rama no debe conectar con la VPS.

Los gates de calidad, integración y E2E son una condición previa. Si uno falla, no esperes una
imagen publicada ni un intento SSH. Corrige el gate en el commit correspondiente y deja el runtime
activo sin cambios. No ejecutes manualmente el launcher para saltar esa condición.

## El paquete o el digest no pasa el preflight

La release debe contener exactamente `Caddyfile`, `docker-compose.yml` y
`release-manifest.json`, sin `.env` ni secretos. El manifiesto debe tener
`schemaVersion=1`, `releaseId`, `generation`, `commit`, las referencias completas
`images.server` y `images.database`, `csv.sha256` y el bloque
`schemaCompatibility`. `latest`, una etiqueta reutilizable o una referencia sin
`@sha256:<64 caracteres hexadecimales>` no es válida.

Si el preflight informa de un checksum, digest o archivo ausente, conserva el directorio de
evidencia y corrige el paquete en GitHub. En la VPS se puede inspeccionar la configuración sin
iniciar servicios:

```bash
docker compose --env-file /absolute/external/labeler.env \
  -f /absolute/external/labeler/releases/<release-id>/docker-compose.yml \
  config --format json
```

No cambies el manifiesto a mano ni reemplaces el digest por una etiqueta para hacer pasar el
preflight. La cuenta restringida recibe `release-package-<release-id>.tar.gz` por la entrada
estándar del canal que solicita `deploy <release-id>`; el launcher valida el stream antes de
instalarlo en `LABELER_DEPLOY_ROOT/releases/<release-id>`. Una release que no puede validar sus
imágenes no debe reemplazar `current`.

## SSH o GHCR no están disponibles

El workflow usa los secrets `VPS_HOST`, `VPS_USER`, `VPS_KNOWN_HOSTS` y
`VPS_SSH_PRIVATE_KEY` del entorno `production`. Un fallo de resolución, autenticación o huella conocida
debe detener el intento. Verifica el hostname, el usuario restringido y la huella por un canal
independiente. No desactives la comprobación de host y no copies una clave privada a la VPS dentro
del paquete.

El canal remoto transmite `release-package-<release-id>.tar.gz` por stdin y envía
`deploy <release-id>` por SSH.
La cuenta no debe ofrecer shell, PTY, reenvío de agente, puertos ni X11. El wrapper autorizado
rechaza cualquier orden distinta de `deploy <release-id>` o `rollback`; `rollback` no acepta un
identificador.

La VPS necesita una credencial de GHCR con permiso de lectura de paquetes. El token debe estar en
un archivo externo protegido o en la configuración de credenciales del host, nunca en GitHub
Actions, `.env` del repositorio, argumentos del launcher o logs. Comprueba el acceso con la imagen
y el digest del manifiesto, sin imprimir la credencial:

```bash
docker pull ghcr.io/<owner>/<server-image>@sha256:<server-digest>
docker pull ghcr.io/<owner>/<database-image>@sha256:<database-digest>
```

Si GHCR no responde o el digest no coincide, la release activa debe permanecer intacta. No uses
una imagen local no registrada como sustituto. El launcher requiere además
`LABELER_DEPLOY_ROOT`, `LABELER_ENV_FILE`, `LABELER_BACKUP_COMMAND` y
`LABELER_PUBLIC_BASE_URL` como rutas absolutas o URL HTTPS, según corresponda.

## Compose no arranca

La dependencia es `labeling-database` saludable, después `labeling-study-prepare` exitoso para los
dos perfiles y finalmente `labeling-server`. Caddy queda al frente después de la readiness interna.
El host publica `7755:3000` solo para el stack local.

```bash
docker compose --env-file deployment/.env \
  -f deployment/docker-compose.yml \
  -f deployment/docker-compose.clean.yml ps
docker compose --env-file deployment/.env \
  -f deployment/docker-compose.yml \
  -f deployment/docker-compose.clean.yml logs labeling-study-prepare
docker compose --env-file deployment/.env \
  -f deployment/docker-compose.yml \
  -f deployment/docker-compose.clean.yml logs labeling-server
```

No uses `down -v` como corrección o rollback.

## Hay un lock de despliegue

El lock de la VPS es la autoridad final de exclusión. El workflow también serializa los releases,
pero una ejecución atrasada puede llegar después de otra y debe ser rechazada por su generación.
El lock efectivo es `LABELER_DEPLOY_ROOT/locks/deploy.lock` y la generación persistida es
`LABELER_DEPLOY_ROOT/state/highest-generation`.
Comprueba primero si existe un launcher activo y conserva su evidencia. No borres el lock mientras
otro proceso pueda estar ejecutando el backup, la preparación o el smoke test. Si el proceso murió,
libera el lock solo mediante el procedimiento operativo de la VPS y registra la intervención.

## Perfiles y preparación

Si falla `validate:study-profiles`, revisa `STUDY_PROFILES_INPUT`, las raíces montadas, los
checksums, el conteo 30 o 300, los IDs únicos y el mapeo de usernames. La validación debe terminar
antes de cualquier escritura.

```bash
npm run validate:study-profiles
npm run prepare:study-profiles
```

La preparación procesa primero 300 y después 30. Un fallo del perfil de validación no borra ni
reescribe el estudio actual. `clean` falla ante objetos legacy y `existing` requiere backup externo
verificable y confirmación explícita. No introduzcas un tercer conteo ni un selector de estudio.

En una release automática, el orden es PostgreSQL saludable, backup exitoso, preparación completa,
servidor saludable, Caddy saludable y smoke test HTTPS. El comando configurado en
`LABELER_BACKUP_COMMAND` debe producir `STUDY_BACKUP_VERIFIED`; de lo contrario el backup falla
antes de la preparación y conserva `current`. Un error de migración, guardia legacy, bootstrap o
enriquecimiento impide publicar el servidor nuevo, no borra `labeling-data` y debe conservar los
logs del servicio `labeling-study-prepare`.

## PostgreSQL y migraciones

Los init scripts solo se ejecutan con `PGDATA` vacío. El runner gestiona `001` y `003` a `012`; `002` es externo. No
edites manualmente `labeler_migration`; revisa `deployment/ROLLBACK.md` ante drift o restauraciones.

## Sesión y privacidad

El `study_id` no se calcula desde el username ni se recibe del cliente. Se obtiene de la cuenta y
la sesión de servidor, que también determinan la membresía y el participante. No uses un username,
query, URL, formulario, cookie o cabecera para cambiar de estudio. Categorías, clasificaciones,
descartes, observaciones y progreso son privados por estudio y participante.

Si una solicitud protegida devuelve no autenticado, vuelve a iniciar sesión y comprueba expiración,
revocación y `credential_version`. Las mutaciones necesitan CSRF y `Origin` permitido. No existe
selector de participante, selector de estudio ni UI administrativa.

## GitHub

La configuración habilitada debe declarar exactamente un perfil `default` en
`GITHUB_CREDENTIAL_ALIASES`; las claves `owner/name` y los perfiles adicionales fallan
con `INVALID_PROFILE`. El perfil debe usar exactamente una fuente (`tokenEnv` o
`tokenFile`). `CREDENTIAL_NOT_FOUND` indica secreto ausente y
`INSUFFICIENT_PERMISSIONS` permisos read-only declarados insuficientes. La credencial
solo pertenece a prepare. El run debe usar el `study_id`, checksum, membresía y conteo persistidos
del estudio seleccionado, que puede ser 30 o 300. El camino CSV-only no necesita token. La captura
live de GitHub sigue pendiente. Consulta [`GITHUB-ENRICHMENT.md`](../deployment/GITHUB-ENRICHMENT.md)
sin imprimir el token.

## Exportación

La exportación no es una ruta web. No existe `/export`, descarga desde navegador ni exportación
administrativa. El operador debe proporcionar un secreto HMAC externo, `--study-key` explícito y
un destino nuevo. Si falta una decisión terminal, el estudio no está `READY` o el secreto falta,
`export:study` falla sin crear un paquete parcial.

```bash
npm run export:study -- \
  --study-key pr-card-sorting-validation-30 \
  --output /absolute/external/validation-30
```

## El health check o el smoke test falla

Después de un intento fallido, recoge primero la evidencia del release. Sustituye las rutas por el
directorio externo real y no incluyas el contenido de `.env` ni de los secretos:

```bash
docker compose --env-file "$LABELER_ENV_FILE" \
  -f "$LABELER_DEPLOY_ROOT/current/docker-compose.yml" ps
docker compose --env-file "$LABELER_ENV_FILE" \
  -f "$LABELER_DEPLOY_ROOT/current/docker-compose.yml" \
  logs --no-color labeling-study-prepare labeling-server labeling-caddy
curl --fail --silent --show-error \
  "$LABELER_PUBLIC_BASE_URL/login" > /dev/null
```

En local Caddy usa un certificado interno y la comprobación puede necesitar `curl --insecure`. En
producción no ocultes un error TLS con esa opción: verifica DNS, certificado y `APP_ORIGIN`. El
smoke test válido es una respuesta exitosa de `/login` a través del hostname público, no una
petición directa al puerto interno de Node.

Si el servidor nuevo falla después del reemplazo, el operador puede invocar `rollback` sin un
identificador para seleccionar `previous`, pero solo cuando su manifiesto declara compatibilidad
con el esquema guardado en `state/active-schema-version`. Si hubo una migración incompatible, no
vuelvas a una imagen anterior sobre la misma base, no reviertas SQL y no uses `down -v`. Sigue
[`deployment/ROLLBACK.md`](../deployment/ROLLBACK.md) para la ruta de solo lectura o la
restauración escribible en una base separada.

## Resultados engañosos

`lint` no equivale a runtime; `lint:md` no cubre `docs/`; `docs:study-check` valida el contrato y
los documentos requeridos; no existe `npm test` ni `npm run build`; minify modifica archivos.
Registra comando, salida, fecha, entorno y alcance.

El E2E hostil aislado de los dos estudios está completado. Permanecen pendientes la evidencia
externa de backup y restore, el E2E hostil histórico, el E2E completo en VPS o entorno público,
el cierre documental histórico y la captura live de GitHub. Los logs y manifiestos descritos en
este documento son requisitos de evidencia, no pruebas de que una VPS concreta ya se haya
desplegado.
