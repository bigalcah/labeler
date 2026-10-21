# Checklist de adopción de la VPS

Este checklist prepara una VPS existente para recibir releases automáticas. No provisiona el
sistema operativo, Docker, DNS, TLS, usuarios ni secretos. Los valores externos son parámetros de
instalación y deben permanecer fuera de Git.

La adopción no se considera completa por tener archivos o scripts presentes. Cada casilla necesita
una evidencia con fecha, entorno, alcance y resultado. El despliegue permanece en **HOLD** mientras
estén pendientes la protección administrativa, revisión de owner, adopción real del host, backup y
restore externos y prueba pública en VPS. La captura live de GitHub también sigue pendiente.

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
Tipo de recibo de backup: `labeler-full-postgresql-backup` v1
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
- [ ] Permitir únicamente `SSH_ORIGINAL_COMMAND` con `deploy <release-id>` o `rollback`; no pasar
      órdenes en argumentos directos. El wrapper debe traducir la orden validada a la interfaz SSH
      autorizada sin aceptar un ID para rollback.
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

El estado sigue en **HOLD** mientras branch protection y revisión de owner no estén verificadas, el consumidor no esté
adoptado en el host y no existan evidencias reales de backup/restore externo y prueba pública en VPS. La documentación o
los fixtures no satisfacen esos gates.

## 3. GHCR con solo lectura

- [ ] Crear una credencial del host con permiso de lectura de los paquetes de servidor y base de
      datos, sin permiso de publicación o eliminación.
- [ ] Guardar el token fuera del repositorio, en un archivo protegido o en la configuración de
      credenciales de Docker de la VPS.
- [ ] Verificar que el usuario que ejecuta el launcher puede leer ambos paquetes sin recibir una
      credencial por argumento.
- [ ] Probar la descarga usando referencias completas por digest, nunca `latest`:

```bash
docker pull "ghcr.io/<owner>/<server-image>@sha256:<server-digest>"
docker pull "ghcr.io/<owner>/<database-image>@sha256:<database-digest>"
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
      entrada estándar con `SSH_ORIGINAL_COMMAND=deploy <release-id>`; el launcher debe extraer únicamente
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

La configuración completa y la adopción del consumidor v2 están definidas en
[`deployment/host/README.md`](../deployment/host/README.md). Los valores siguientes son un recordatorio de rutas, no una
configuración completa ni una autorización para adoptar el host.

- [ ] Crear `deployment/.env` en una ruta externa a `<release-root>` y al repositorio.
- [ ] Configurar las variables de host que consume el launcher fuera del paquete:

```dotenv
LABELER_DEPLOY_ROOT=/absolute/host/labeler
LABELER_ENV_FILE=/absolute/external/labeler/deployment.env
LABELER_BACKUP_COMMAND=/absolute/external/labeler/bin/full-backup-and-restore
LABELER_PUBLIC_BASE_URL=https://labeler.example
```

- [ ] Verificar que `LABELER_DEPLOY_ROOT`, `LABELER_ENV_FILE` y `LABELER_BACKUP_COMMAND` son
      rutas absolutas y que el archivo `.env` y el comando de backup quedan fuera de
      `LABELER_DEPLOY_ROOT`. El comando es una integración externa a aportar por el operador,
      root-owned y ejecutable; devuelve únicamente la ruta absoluta al recibo
      `labeler-full-postgresql-backup` v1, nunca `STUDY_BACKUP_VERIFIED`.
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

La frontera de backup del host está en
[`deployment/host/README.md#backup-boundary`](../deployment/host/README.md#backup-boundary). Exige backup PostgreSQL
custom full con hash del archivo, referencia de clave y retención; observación de identidad/origen con escritores
detenidos; globals y prerrequisitos; y restore aislado en sistema, endpoint y volumen distintos, con fingerprints de
esquema y datos iguales al origen observado. El recibo `labeler-full-postgresql-backup` v1 acredita ese contrato. El
ejecutable real es una integración externa no suministrada por el repositorio. `npm run backup:study` sigue disponible,
pero excluye tablas transitorias y no puede satisfacer independientemente el recibo full host ni el gate de base vacía o
solo 001. No inventes recibos ni resultados.

## 6. Backup y restore aislado

La casilla `ISOLATED_STUDY_RESTORE_VERIFIED` corresponde únicamente al test standalone del backup de estudio cuando se
realiza; no demuestra que el host full receipt sea válido. La aceptación full exige restaurar el archivo custom completo
en sistema, endpoint y volumen distintos, y verificar fingerprints de esquema y datos contra la observación de origen,
conforme a [`deployment/host/README.md#backup-boundary`](../deployment/host/README.md#backup-boundary).

- [ ] Aportar el ejecutable externo full de host antes de preparar o migrar. Usar archivos externos
      protegidos para passfile, archivo, globals, clave, manifiestos y evidencia de restore.
- [ ] Comprobar que el comando externo configurado en `LABELER_BACKUP_COMMAND` es ejecutable,
      absoluto, está fuera de `<release-root>` y no recibe contraseñas o claves inline.
- [ ] Comprobar que el ejecutable devuelve solo la ruta absoluta al recibo tipado
      `labeler-full-postgresql-backup` v1; el marcador obsoleto `STUDY_BACKUP_VERIFIED` no es válido.
- [ ] Verificar archivo custom full y hash, origen/identidad y observación readonly, writers detenidos,
      key reference, retención, globals y prerrequisitos con sus evidencias.
- [ ] Restaurar una copia en una base PostgreSQL aislada, con host, puerto, nombre y credenciales
      distintos de producción.
- [ ] La prueba standalone de estudio puede usar `STUDY_RESTORE_CONFIRM=isolated-restore` y registrar
      `ISOLATED_STUDY_RESTORE_VERIFIED`, si resulta válida. Es evidencia opcional de ese test local,
      no acredita por sí sola el recibo full del host.
- [ ] Comparar fingerprints de esquema y datos en el restore aislado con el origen capturado.
- [ ] Para el recibo full host, comprobar restore real con fingerprints de esquema/datos iguales y
      sistema, endpoint y volumen distintos del origen.
- [ ] Guardar la identidad no secreta del destino, la fecha, el alcance, la pareja de archivos y
      el resultado. No afirmar aceptación sin una ejecución real.
- [ ] Confirmar que nunca se usó `labeling-data`, la base productiva ni sus credenciales como
      destino de prueba.

El backup legacy previo al retiro de objetos es una obligación distinta. En modo `existing` exige
backup verificable y `LEGACY_RETIREMENT_CONFIRM=retire-legacy-labeler`; no lo sustituyas por el
backup operativo del estudio.

## 7. Adopción de la release actualmente activa

La adopción inventaría readonly el estado que ya existe; no exige un manifiesto v2 ni presupone 369/30. El consumidor
requiere el historial v1 previsto en esta etapa. No muta la base ni reescribe los bytes v1. Sigue
[`deployment/host/README.md`](../deployment/host/README.md); no publiques ni instales una v2 como
sustituto del proceso de adopción.

- [ ] No detener el stack ni borrar el volumen para registrar la versión existente.
- [ ] Identificar el directorio o paquete que corresponde a la versión activa y comprobar que no
      contiene secretos.
- [ ] Inventariar readonly la versión y el manifiesto activos, conservando su schemaVersion, bytes,
      identidad de release, SHA y digests; puede ser histórico v1/300. No exigir ni inventar v2.
- [ ] Confirmar que la configuración activa conserva los nombres `labeling-database`,
      `labeling-study-prepare`, `labeling-server`, `labeling-caddy`, la red `labeling-network` y
      el volumen `labeling-data`.
- [ ] Comprobar por lectura readonly de la base y journal qué estado efectivo representa el host.
      `current`, `previous` y manifiestos publicados no demuestran por sí solos el estado SQL.
- [ ] Registrar la identidad y observación readonly actual de la base, sin cambiar datos ni exigir
      estado 369/30 como requisito para inventariar la adopción.
- [ ] Tratar releases v1/300 exclusivamente como historial readonly o cutover dedicado. No permitir
      nuevo ingreso, fallback ni rollback compatible sin `study-schema-4` y `copilot369-v1` verificados.
- [ ] Instalar el consumidor y observador de schema-4, conservando journal, recibos, releases y floor;
      verificar su fingerprint aprobado antes de recibir el candidato.
- [ ] Obtener evidencia real de `history_schema_verified` tras mantenimiento 016 autorizado y backup/restore
      del origen. Conservar valores y xmin del historial cerrado y todos los datos de validación 30.
- [ ] Exigir autorización fresca y otro backup/restore del baseline post-016 antes de continuar al cutover.
      Una entrada de ledger, tablas presentes o pruebas locales no sustituyen esa observación real.
- [ ] Ejecutar un `docker compose config --quiet` con el `.env` externo y la composición del
      paquete, sin reconstruir ni reemplazar servicios.
- [ ] Conservar la salida de `docker compose ps`, la identidad de las imágenes y la evidencia de
      que el endpoint público `/login` responde, sin presentar esta inspección como un despliegue
      nuevo.

La adopción conserva los estudios, cuentas y decisiones realmente observados, incluida una primaria
histórica de 300 si existe; no prepara ni transforma datos. El objetivo 369/30 corresponde al candidato
posterior y a la operación autorizada que resulte elegible. Categorías, clasificaciones, descartes,
observaciones y progreso siguen privados por participante y `study_id`.

## 8. Primera release automática

El candidato esperado para una release v2 posterior a la adopción contiene los perfiles 369 y 30. Los cuatro artefactos
canónicos son `/labeling/data/copilot-369-cards.csv`, `/labeling/data/copilot-369-cards.manifest.json`,
`/labeling/data/validation-30-cards.csv` y `/labeling/data/validation-30-cards.manifest.json`. Esto describe el próximo
bundle de release, no la versión que deba existir durante el inventario de adopción.

- [ ] Confirmar que el workflow se activa solo con `push` a `master` y que encadena gates,
      construcción, publicación y despliegue de forma fail-closed.
- [ ] Confirmar que servidor y base se construyen desde el mismo commit y que el manifiesto
      contiene ambos digests y las rutas/checksums de CSV y manifest de los dos perfiles canónicos.
- [ ] Confirmar que `release-manifest.json` tiene `schemaVersion=2` y solo las claves raíz
      `schemaVersion releaseId generation commit images dataBundle schemaCompatibility dataCompatibility workflow createdAt`.
- [ ] Confirmar que `dataBundle.profiles` tiene exactamente 369 y luego 30; cada perfil fija `csv` y
      `manifest`, cada uno con `path` y `sha256`, según las cuatro entradas canónicas del manifiesto v2.
- [ ] Confirmar compatibilidad separada `study-schema-4` y `copilot369-v1`; la muestra v1/300 queda
      readonly para inventario/cutover y no es ingreso, fallback o rollback compatible.
- [ ] Confirmar que el paquete transferido contiene la composición y el `Caddyfile`, pero no
      `.env`, secretos, claves ni temporales del runner.
- [ ] Confirmar que la composición empaquetada procede de `deployment/docker-compose.release.yml`
      y monta el descriptor, las dos configuraciones y los dos manifests únicamente en
      `labeling-study-prepare`.
- [ ] Confirmar que el paquete contiene exactamente `Caddyfile`, `docker-compose.yml` y
      `release-manifest.json`, y que el ingreso remoto invoca `deploy <release-id>`.
- [ ] Confirmar que la VPS no necesita un checkout del repositorio y que producción usa
      `--no-build`.
- [ ] Confirmar que el launcher adquiere el lock, valida el paquete y descarga los digests antes
      de ejecutar `labeling-study-prepare`.
- [ ] Confirmar que el recibo full host y restore aislado verificados preceden al handoff mutante y
      que la preparación precede al
      servidor y a Caddy.
- [ ] Confirmar que `LABELER_PUBLIC_BASE_URL` coincide con `PUBLIC_HOSTNAME` y que el smoke test
      consulta `https://<public-hostname>/login` desde fuera del stack.
- [ ] Confirmar health checks de `labeling-database`, `labeling-server` y `labeling-caddy`.
- [ ] Confirmar que `current` solo se actualiza después del smoke test. `previous` no se considera
      fallback hasta verificar journal y compatibilidad de ambos tokens contra la base real.
- [ ] Registrar el manifiesto, el resultado de cada etapa, la salida de configuración, los
      health checks, el smoke test y los logs.

No uses la sección legacy de rollback read-only que detiene servicios como fallback del host v2. Una migración no se
revierte para hacer funcionar una imagen antigua. Si la release anterior no
declara compatibilidad con ambos ejes (`study-schema-4` y `copilot369-v1`) o el journal no está
`verified` contra la base observada, detén el flujo. Los punteros no prueban el estado SQL. Sigue
la restauración aislada de
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
