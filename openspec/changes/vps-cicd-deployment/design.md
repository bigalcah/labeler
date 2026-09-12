## Context

El workflow `.github/workflows/pr-validation.yml` ya ejecuta gates de lint, pruebas unitarias, un runtime Compose
efímero, integración y E2E, pero solo se activa para pull requests. `deployment/docker-compose.yml` construye localmente
las imágenes `seart/labeling-server:1.0.0` y `seart/labeling-database:1.0.0`; el preparador ejecuta guardas, migraciones,
bootstrap y enriquecimiento antes de que el servidor quede disponible. El CSV todavía se monta desde `plans/`, mientras
que la configuración, los secretos y el volumen PostgreSQL pertenecen al host.

La propuesta y la especificación definen el contrato de release. Este diseño elige un despliegue in-place controlado en
una única VPS, con una ventana breve de indisponibilidad posible durante el reemplazo del servidor. No promete alta
disponibilidad ni despliegue blue-green con una base compartida.

## Goals / Non-Goals

**Goals:**

- Mantener una única fuente de verdad para los gates de pull request y de producción.
- Construir una vez en GitHub, publicar imágenes reproducibles y ejecutar en la VPS por digest.
- Hacer que el release sea autónomo respecto de un checkout del repositorio en la VPS.
- Mantener secretos, persistencia, backup y decisiones de restauración dentro del límite operativo de la VPS.
- Fallar antes de reemplazar la aplicación cuando fallen preflight, descarga o backup.
- Hacer visible qué commit/digest está activo y cuál es el anterior.

**Non-Goals:**

- Desplegar `develop` o ramas de pull request en producción.
- Instalar un self-hosted runner en el host de producción.
- Provisionar automáticamente el sistema operativo, Docker, DNS, TLS, secretos o usuarios de la VPS.
- Revertir migraciones PostgreSQL o usar `down -v` como mecanismo automático de recuperación.
- Eliminar el flujo separado de retiro legacy ni decidir cuándo es seguro borrar datos.
- Ofrecer cero downtime, canary releases o una segunda base de datos en este cambio.

## Decisions

### Flujo de release reutilizable y activado por `master`

Se extraerán los gates compartidos a un workflow reutilizable invocable desde el workflow de pull request y desde el
workflow de release. El release se activará con `push` a `master` y encadenará los jobs `quality`, `build`, `publish` y
`deploy`; ningún job posterior podrá ejecutarse si falla su dependencia. `master` será el único origen de producción.

El entorno GitHub `production` limitará el workflow a `master` y almacenará solo `VPS_HOST`, `VPS_USER`, la clave SSH y
los hosts conocidos. No se requerirá una aprobación manual adicional por defecto: la protección de `master` y los gates
son la autorización de estabilidad acordada por el proyecto. El grupo de concurrencia del release evitará dos
despliegues activos, mientras que el host rechazará una release antigua que intente sobrescribir una más reciente.

Alternativas descartadas: duplicar todos los pasos en otro YAML, porque permitiría que PR y producción diverjan; disparar
con tags como fuente principal, porque el contrato del proyecto es que cada push a `master` ya es estable; y ejecutar un
runner persistente en la VPS, porque ampliaría al host el límite de confianza de cada workflow.

### Imágenes en GHCR y metadato de release

GitHub-hosted runners construirán las imágenes de servidor y base de datos con el contexto del commit validado. Las
imágenes se publicarán en GHCR con una etiqueta derivada del SHA para trazabilidad, pero el manifiesto de release
registrará y desplegará los digests completos. No se usará `latest` ni una etiqueta mutable como referencia efectiva.

El job de publicación generará un manifiesto sin secretos con el SHA, digests de ambas imágenes, checksum del CSV,
identificador de workflow y fecha de construcción. El manifiesto viajará junto con la configuración de Compose y Caddy
que necesita el host. Las acciones nuevas de terceros se fijarán a commits completos y los permisos del workflow se
limitarán a lectura de contenido y escritura de paquetes donde corresponda.

El registro tendrá credenciales de lectura configuradas externamente en la VPS. GitHub Actions no enviará el token de
GHCR ni credenciales de la aplicación como argumentos del comando remoto.

### CSV incluido en la imagen de servidor

El Dockerfile del servidor incluirá el CSV canónico en una ruta estable del runtime y Compose configurará
`STUDY_CSV_PATH` a esa ruta. El servicio de preparación usará el mismo digest de servidor que la aplicación, por lo que
validación, bootstrap y enriquecimiento quedan ligados al mismo input que fue construido y publicado.

Se descarta transferir el CSV desde el checkout del runner en cada despliegue: mantendría una dependencia de archivos
externos y permitiría que Compose ejecutara una combinación distinta de imagen y datos. El CSV no contendrá secretos; el
paquete del registro deberá conservar controles de acceso acordes con la visibilidad del repositorio.

### Compose de producción sin reconstrucción

Compose recibirá variables para las imágenes de servidor y base de datos y conservará `build` únicamente para los flujos
locales y de CI que lo necesiten. El despliegue de producción ejecutará `pull` y después `up --no-build`, usando un
directorio de release con Compose, Caddyfile y manifiesto. El `.env` de producción continuará fuera del directorio de
release y no se copiará desde GitHub.

La configuración de release mantendrá los nombres, red y volumen actuales para no crear una segunda base accidentalmente.
El Caddyfile seguirá siendo público y no recibirá secretos; su imagen continuará fijada a una versión conocida y se
registrará con el resto de la composición.

### Control remoto y secuencia fail-closed

Un usuario SSH dedicado ejecutará únicamente el launcher de despliegue autorizado en la VPS. El launcher trabajará con
directorios versionados (`releases/<id>`, `current` y `previous`), un archivo de estado y un lock de host. El layout y las
rutas podrán instalarse una vez por el operador, pero la release no modificará permisos ni secretos de sistema.

La secuencia será:

1. Adquirir el lock y rechazar una release cuya generación sea anterior a la activa.
2. Copiar o activar el paquete sin secretos y validar el manifiesto, digests, variables y `docker compose config`.
3. Descargar las imágenes exactas y comprobar que sus digests coinciden con el manifiesto.
4. Ejecutar el comando de backup de estudio aprobado en la VPS con sus rutas y clave de cifrado externas.
5. Comprobar PostgreSQL saludable y ejecutar el `labeling-study-prepare` del nuevo release como paso previo al
   reemplazo de la aplicación.
6. Recrear el servidor y Caddy sin build, esperar sus health checks y probar el endpoint HTTPS público `/login`.
7. Escribir `previous` y `current` solo después del smoke test exitoso, conservar logs y liberar el lock.

Si falla una etapa previa al reemplazo, se conserva la versión activa. Si falla preparación, no se continúa hacia el
tráfico público. Si la migración ya cambió el esquema y falla la aplicación nueva, solo se podrá volver a una imagen
anterior cuando la release declare compatibilidad; de lo contrario el operador seguirá `deployment/ROLLBACK.md` con un
backup verificado y una restauración aislada.

### Secretos, permisos y concurrencia

Los secretos de PostgreSQL, sesión, cuentas, GitHub enrichment y cifrado de backup permanecerán como archivos externos
montados por Compose. El entorno `production` de GitHub tendrá únicamente el canal SSH y valores no sensibles de
destino. El launcher no aceptará contraseñas inline, no imprimirá el entorno completo y limpiará los paquetes temporales
que no deban conservarse.

El lock de VPS será la autoridad final de exclusión. El workflow también declarará concurrencia para evitar jobs de
producción simultáneos, pero el launcher conservará el número de release y rechazará que una ejecución atrasada
reemplace una release más nueva.

### Rollback y evidencia

Cada intento conservará el manifiesto, resultado de `config`, estado de imágenes, salida de health checks, smoke test y
logs de preparación. La recuperación de aplicación usará `previous` solo con compatibilidad de esquema explícita. La
recuperación escribible de datos seguirá siendo manual, con backup cifrado verificado y destino separado. El despliegue
nunca borrará el volumen persistente ni intentará una migración inversa.

## Risks / Trade-offs

- [Una migración puede dejar incompatible la imagen anterior] → Ejecutar backup antes de preparar, declarar compatibilidad
  por release y mantener restauración separada como única recuperación escribible.
- [El reemplazo in-place puede producir una breve indisponibilidad] → Mantener health checks, smoke test externo, lock y
  ventana operativa documentada; dejar blue-green fuera de este cambio.
- [GHCR o SSH pueden estar indisponibles] → Validar y descargar antes de reemplazar, conservar la release activa y
  registrar el fallo sin reintentos destructivos.
- [Una release atrasada podría sobrescribir una nueva] → Serializar en GitHub y en la VPS, comparar generaciones y
  rechazar metadatos antiguos.
- [El CSV incluido puede quedar desalineado con una imagen] → Construirlo desde el mismo commit, incluir su checksum en
  el manifiesto y consumirlo desde una ruta interna de la imagen.
- [Una clave SSH de despliegue compromete la VPS] → Usuario dedicado, `known_hosts` verificado, comando restringido,
  permisos mínimos y secretos de aplicación nunca entregados al workflow.

## Migration Plan

1. Preparar en la VPS Docker/Compose, usuario restringido, rutas externas de secretos y backups, credencial de lectura de
   GHCR, lock y directorios de releases; documentar los valores sin registrarlos en Git.
2. Ejecutar una adopción manual de la versión actualmente activa, registrar su digest y verificar un backup/restore
   aislado antes de habilitar el job automático.
3. Fusionar el cambio en `master`; el workflow debe pasar todos los gates, publicar las imágenes y ejecutar un primer
   despliegue controlado en el entorno `production`.
4. Confirmar en la VPS el estado `current`, el backup previo, los health checks, el smoke test y la preservación del
   volumen `labeling-data`.
5. Para rollback de aplicación, seleccionar la release anterior compatible y ejecutar el launcher de rollback documentado.
   Para incompatibilidad de esquema, detener el flujo y restaurar solo mediante el procedimiento de
   `deployment/ROLLBACK.md`.

## Open Questions

- Los nombres concretos del paquete GHCR, hostname, usuario SSH, rutas externas y retención de backups son parámetros de
  instalación; no cambian la arquitectura ni el contrato de esta capacidad.
