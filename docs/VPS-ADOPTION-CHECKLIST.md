# Checklist de adopción de la VPS

Este checklist prepara una VPS existente para recibir releases automáticas. No provisiona el
sistema operativo, Docker, DNS, TLS, usuarios ni secretos. Los valores externos son parámetros de
instalación y deben permanecer fuera de Git.

La adopción no se considera completa por tener archivos o scripts presentes. Cada casilla necesita
una evidencia con fecha, entorno, alcance y resultado. En el estado actual siguen pendientes la
ejecución externa de backup y restore, la prueba pública en VPS y la captura live de GitHub.

## Ficha de instalación

Rellena esta ficha en un registro operativo privado. No guardes contraseñas, tokens, claves
privadas, manifests de cuentas ni claves de cifrado.

```text
Repositorio: <owner>/<repository>
Hostname público: <public-hostname>
Host SSH: <vps-host>
Usuario SSH: <vps-user>
Directorio de releases: <release-root>
Archivo .env externo: <absolute-path-to-production-env>
Archivo known_hosts: <absolute-path-to-known-hosts>
Comando de backup externo: <absolute-path-to-backup-command>
URL pública del smoke test: https://<public-hostname>
Paquete GHCR de servidor: ghcr.io/<owner>/<server-image>
Paquete GHCR de base de datos: ghcr.io/<owner>/<database-image>
Directorio de backups: <absolute-external-backup-directory>
Archivo de clave de cifrado: <absolute-external-backup-key-file>
Release actualmente activa: <current-release-id>
SHA actualmente activo: <current-commit-sha>
Digest de servidor actualmente activo: <server-digest>
Digest de base actualmente activo: <database-digest>
Checksum del CSV actualmente activo: <csv-sha256>
```

## 1. Usuario SSH restringido

- [ ] Crear una cuenta dedicada para releases. No reutilizar una cuenta personal ni `root`.
- [ ] Instalar una única clave pública de despliegue en `authorized_keys` y conservar la huella
      privada solo en el gestor protegido de GitHub.
- [ ] Configurar una orden forzada hacia el wrapper de ingreso autorizado, con una ruta absoluta
      definida por el operador. El usuario no debe obtener un shell interactivo.
- [ ] Permitir únicamente las órdenes `deploy <release-id>` y `rollback`. El wrapper debe traducir
      esas órdenes a `deployment/deploy-vps.sh deploy <release-id>` y
      `deployment/deploy-vps.sh rollback` sin aceptar un ID para rollback.
- [ ] Desactivar para esa clave el reenvío de agente, puertos, X11 y el pseudo-terminal. Una forma
de referencia es usar la opción `restrict` junto con `command="<absolute-ingress-wrapper>"`.
- [ ] Permitir al usuario únicamente las operaciones de Docker y filesystem que necesita el
      launcher. No conceder sudo general ni acceso a otras aplicaciones.
- [ ] Confirmar que el launcher rechaza comandos SSH distintos de los previstos y que no acepta
      secretos como argumentos.

Ejemplo de forma, con valores ficticios que deben sustituirse durante la instalación:

```text
command="<absolute-ingress-wrapper>",restrict ssh-ed25519 <public-key> labeler-release
```

No copies esta línea con la clave de ejemplo. La política efectiva debe revisarse en el host y
conservarse como evidencia de adopción.

## 2. `known_hosts` y entorno `production`

- [ ] Obtener la clave de host de `<vps-host>` por un canal independiente y registrar su huella.
- [ ] Escribir la entrada verificada en el archivo `known_hosts` usado por el workflow. No usar
      `ssh-keyscan` sin verificar su resultado.
- [ ] Configurar el entorno protegido `production` de GitHub con los secrets `VPS_HOST`,
      `VPS_USER`, `VPS_KNOWN_HOSTS` y `VPS_SSH_PRIVATE_KEY`.
- [ ] Limitar el entorno `production` al workflow de release y a `master`.
- [ ] Mantener la protección de `master` con los gates obligatorios de calidad, integración y E2E.
- [ ] Comprobar que una ejecución desde `develop` o una pull request no puede contactar la VPS.
- [ ] Comprobar que la clave SSH y `known_hosts` no aparecen en logs, artefactos ni mensajes de
      error.

El nombre exacto de la secret que contiene la clave privada lo fija el workflow. No añadas al
entorno de GitHub contraseñas de la aplicación, claves de sesión, manifests de cuentas, claves de
backup ni el token de GHCR.

## 3. GHCR con solo lectura

- [ ] Crear una credencial del host con permiso de lectura de los paquetes de servidor y base de
      datos, sin permiso de publicación o eliminación.
- [ ] Guardar el token fuera del repositorio, en un archivo protegido o en la configuración de
      credenciales de Docker de la VPS.
- [ ] Verificar que el usuario que ejecuta el launcher puede leer ambos paquetes sin recibir una
      credencial por argumento.
- [ ] Probar la descarga usando referencias completas por digest, nunca `latest`:

```bash
docker pull ghcr.io/<owner>/<server-image>@sha256:<server-digest>
docker pull ghcr.io/<owner>/<database-image>@sha256:<database-digest>
```

- [ ] Conservar como evidencia el resultado de las descargas y los digests, sin conservar el
      token en la salida.
- [ ] Confirmar que no hay un runner autoalojado en la VPS de producción. Las imágenes se
      construyen en runners administrados por GitHub.

El workflow publica una etiqueta derivada del SHA para trazabilidad, pero la referencia efectiva
debe ser el digest registrado en el manifiesto. Un digest ausente, truncado o diferente bloquea la
release antes de reemplazar servicios.

## 4. Ingreso del paquete, layout y lock

- [ ] Crear `<release-root>` fuera del checkout de cualquier usuario y con permisos mínimos.
- [ ] Configurar `LABELER_DEPLOY_ROOT=<release-root>` apuntando a un directorio regular existente.
- [ ] Configurar el ingreso remoto para transmitir `release-package-<release-id>.tar.gz` por la
      entrada estándar del canal OpenSSH `deploy <release-id>`; el launcher debe extraer únicamente
      `Caddyfile`, `docker-compose.yml` y `release-manifest.json` en `releases/<release-id>`.
- [ ] Crear los directorios persistentes. La forma lógica es:

```text
<release-root>/
  releases/<release-id>/       # solo los tres archivos allowlisted
  evidence/<release-id>/<utc-attempt>/
  state/highest-generation
  state/active-schema-version
  state/deployment
  locks/deploy.lock
  current -> releases/<release-id>     # release que atiende producción
  previous -> releases/<release-id>    # release anterior conservada
```

- [ ] Comprobar que `locks/deploy.lock` es exclusivo y que una ejecución antigua no puede
      sobrescribir una generación posterior almacenada en `state/highest-generation`.
- [ ] Comprobar que `state/active-schema-version` y `state/deployment` son archivos regulares y
      contienen el estado observado, no valores inventados.
- [ ] Comprobar que `current` y `previous` no apuntan al workspace temporal de GitHub.
- [ ] Conservar cada manifiesto, salida de configuración, estado de imágenes, health checks,
      smoke test y logs dentro de la evidencia no secreta del intento.
- [ ] Confirmar que un fallo no borra la release activa ni el volumen persistente.

No borres un lock activo para desbloquear una ejecución. Si el proceso murió, registra la revisión
del lock, la comprobación de procesos y la intervención del operador antes de liberarlo.

## 5. `.env` y secretos externos

- [ ] Crear `deployment/.env` en una ruta externa a `<release-root>` y al repositorio.
- [ ] Configurar las variables de host que consume el launcher fuera del paquete:

```dotenv
LABELER_DEPLOY_ROOT=/absolute/external/labeler
LABELER_ENV_FILE=/absolute/external/labeler/deployment.env
LABELER_BACKUP_COMMAND=/absolute/external/labeler/bin/backup-study
LABELER_PUBLIC_BASE_URL=https://<PUBLIC_HOSTNAME>
```

- [ ] Verificar que `LABELER_DEPLOY_ROOT`, `LABELER_ENV_FILE` y `LABELER_BACKUP_COMMAND` son
      rutas absolutas y que el archivo `.env` y el comando de backup quedan fuera de
      `LABELER_DEPLOY_ROOT`.
- [ ] Configurar `COMPOSE_PROJECT_NAME=labeling`, `DATABASE_NAME`, `DATABASE_USER`,
      `DATABASE_PORT`, `PUBLIC_HOSTNAME` y `APP_ORIGIN` con los valores reales del entorno.
- [ ] Configurar `STUDY_DATABASE_MODE` según el inventario aprobado. Usar `clean` solo cuando no
      queden objetos legacy y `existing` solo con backup verificable y confirmación explícita.
- [ ] Mantener `GITHUB_ENRICHMENT_ENABLED=false` salvo que exista una configuración aprobada. Si
      se habilita, limitar la credencial a `labeling-study-prepare`.
- [ ] Configurar `DATABASE_PASSWORD_HOST_PATH` y
      `DATABASE_PASSWORD_DATABASE_HOST_PATH` como rutas absolutas externas. Mantener la contraseña
      compatible con el volumen PostgreSQL existente.
- [ ] Configurar `SESSION_SECRET_CURRENT_HOST_PATH` y
      `SESSION_SECRET_PREVIOUS_HOST_PATH` como archivos externos protegidos.
- [ ] Configurar `STUDY_ACCOUNT_MANIFEST_HOST_PATH` y, para los dos perfiles, las rutas externas
      `STUDY_VALIDATION_ACCOUNT_MANIFEST_HOST_PATH`, `STUDY_PROFILES_INPUT_HOST_PATH`,
      `STUDY_CURRENT_CONFIG_HOST_PATH` y `STUDY_VALIDATION_CONFIG_HOST_PATH` que requiere el
      overlay `clean`.
- [ ] Mantener los manifests de cuentas con permiso `0400` y no montarlos en `labeling-server`.
- [ ] Mantener las credenciales de GitHub enrichment y las claves de backup fuera del paquete. Si
      enrichment está habilitado, su token solo debe llegar a `labeling-study-prepare`.
- [ ] Verificar que el archivo `.env` no aparece en el paquete, en los artefactos de GitHub ni en
      los logs.

Las variables de backup del host son externas y se describen en
[`deployment/ROLLBACK.md`](../deployment/ROLLBACK.md): `STUDY_BACKUP_ARCHIVE`,
`STUDY_BACKUP_MANIFEST`, `STUDY_BACKUP_ENCRYPTION_KEY_FILE` y
`STUDY_BACKUP_RETENTION_DAYS`. `LABELER_BACKUP_COMMAND` debe producir una línea exacta
`STUDY_BACKUP_VERIFIED`; si no la produce, el launcher no inicia la preparación. No pongas secretos
inline en el entorno ni esos valores privados en el manifiesto de release.

## 6. Backup y restore aislado

- [ ] Crear un backup de estudio antes de preparar o migrar una release. Usar archivos externos
      para el passfile, el archivo cifrado, el manifiesto y la clave de cifrado.
- [ ] Comprobar que el comando externo configurado en `LABELER_BACKUP_COMMAND` es ejecutable,
      absoluto, está fuera de `<release-root>` y no recibe contraseñas o claves inline.
- [ ] Exigir la confirmación literal `STUDY_BACKUP_VERIFIED` antes de permitir
      `labeling-study-prepare`.
- [ ] Verificar el archivo, manifiesto, checksum, identidad de la base y legibilidad del backup.
- [ ] Restaurar una copia en una base PostgreSQL aislada, con host, puerto, nombre y credenciales
      distintos de producción.
- [ ] Ejecutar la verificación con `STUDY_RESTORE_CONFIRM=isolated-restore` y conservar la salida
      `ISOLATED_STUDY_RESTORE_VERIFIED`, si la ejecución resulta válida.
- [ ] Comparar conteos y fingerprints de tarjetas, clasificaciones y credenciales en el destino
      aislado.
- [ ] Guardar la identidad no secreta del destino, la fecha, el alcance, la pareja de archivos y
      el resultado. No afirmar aceptación sin una ejecución real.
- [ ] Confirmar que nunca se usó `labeling-data`, la base productiva ni sus credenciales como
      destino de prueba.

El backup legacy previo al retiro de objetos es una obligación distinta. En modo `existing` exige
backup verificable y `LEGACY_RETIREMENT_CONFIRM=retire-legacy-labeler`; no lo sustituyas por el
backup operativo del estudio.

## 7. Adopción de la release actualmente activa

- [ ] No detener el stack ni borrar el volumen para registrar la versión existente.
- [ ] Identificar el directorio o paquete que corresponde a la versión activa y comprobar que no
      contiene secretos.
- [ ] Registrar el release ID, SHA del commit, digest completo de servidor y base, checksum del
      CSV, workflow de origen y fecha UTC.
- [ ] Confirmar que el servidor activo usa el CSV canónico en
      `/labeling/data/pr-cards.csv`; la VPS no debe necesitar `plans/` ni un checkout del
      repositorio.
- [ ] Confirmar que la configuración activa conserva los nombres `labeling-database`,
      `labeling-study-prepare`, `labeling-server`, `labeling-caddy`, la red `labeling-network` y
      el volumen `labeling-data`.
- [ ] Comprobar que `current` representa esa versión y dejar `previous` vacío o con una versión
      anterior identificada, según el estado real del host.
- [ ] Ejecutar un `docker compose config --quiet` con el `.env` externo y la composición del
      paquete, sin reconstruir ni reemplazar servicios.
- [ ] Conservar la salida de `docker compose ps`, la identidad de las imágenes y la evidencia de
      que el endpoint público `/login` responde, sin presentar esta inspección como un despliegue
      nuevo.

La adopción debe mantener el contrato multiestudio existente: `pr-card-sorting-local` tiene 300
tarjetas, `pr-card-sorting-validation-30` tiene 30, la preparación ocurre en ese orden y los tres
participantes reciben la misma membresía dentro de cada estudio. Categorías, clasificaciones,
descartes, observaciones y progreso siguen privados por participante y `study_id`.

## 8. Primera release automática

- [ ] Confirmar que el workflow se activa solo con `push` a `master` y que encadena gates,
      construcción, publicación y despliegue de forma fail-closed.
- [ ] Confirmar que servidor y base se construyen desde el mismo commit y que el manifiesto
      contiene ambos digests y el checksum del CSV canónico.
- [ ] Confirmar que `release-manifest.json` contiene `schemaVersion=1`, `releaseId`,
      `generation`, `commit`, `images.server`, `images.database`, `csv.sha256` y
      `schemaCompatibility.produces` con `schemaCompatibility.applicationSupports`.
- [ ] Confirmar que el paquete transferido contiene la composición y el `Caddyfile`, pero no
      `.env`, secretos, claves ni temporales del runner.
- [ ] Confirmar que el paquete contiene exactamente `Caddyfile`, `docker-compose.yml` y
      `release-manifest.json`, y que el ingreso remoto invoca `deploy <release-id>`.
- [ ] Confirmar que la VPS no necesita un checkout del repositorio y que producción usa
      `--no-build`.
- [ ] Confirmar que el launcher adquiere el lock, valida el paquete y descarga los digests antes
      de ejecutar `labeling-study-prepare`.
- [ ] Confirmar que el backup exitoso precede a la preparación y que la preparación precede al
      servidor y a Caddy.
- [ ] Confirmar que `LABELER_PUBLIC_BASE_URL` coincide con `PUBLIC_HOSTNAME` y que el smoke test
      consulta `https://<public-hostname>/login` desde fuera del stack.
- [ ] Confirmar health checks de `labeling-database`, `labeling-server` y `labeling-caddy`.
- [ ] Confirmar que `current` solo se actualiza después del smoke test y que `previous` queda
      disponible para una recuperación compatible.
- [ ] Registrar el manifiesto, el resultado de cada etapa, la salida de configuración, los
      health checks, el smoke test y los logs.

Una migración no se revierte para hacer funcionar una imagen antigua. Si la release anterior no
declara compatibilidad con el esquema, detén el flujo y sigue la restauración aislada de
[`deployment/ROLLBACK.md`](../deployment/ROLLBACK.md).

## Registro de evidencia

Completa este registro solo con resultados observados. Mantén los archivos detallados fuera del
repositorio si contienen datos operativos.

```text
Release ID:
Generation:
Commit SHA:
Workflow y ejecución:
Fecha UTC:
Hostname y entorno:
Digest de servidor:
Digest de base de datos:
Checksum del CSV:
Esquema producido:
Esquemas soportados por la aplicación:
Release current antes:
Release previous antes:
Backup previo: PENDING / VERIFIED
Preparación: PENDING / PASS / FAIL
Health checks: PENDING / PASS / FAIL
Smoke HTTPS /login: PENDING / PASS / FAIL
Release current después:
Release previous después:
Esquema activo después:
Ruta de manifiesto y logs:
Resultado y alcance:
```

Hasta completar el registro con evidencia real, la adopción y la release automática permanecen
pendientes. No inventes hostnames, digests, fechas, resultados de backup, restauraciones ni
despliegues públicos.
