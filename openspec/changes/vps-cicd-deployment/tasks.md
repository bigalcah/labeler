## 1. Reutilizar los gates de CI

- [x] 1.1 Extraer los gates compartidos de `.github/workflows/pr-validation.yml` a un workflow reutilizable con `workflow_call`, conservando la cobertura actual de lint, unit, Compose efímero, integración, E2E y validación OpenSpec.
- [x] 1.2 Hacer que `.github/workflows/pr-validation.yml` invoque el workflow reutilizable y verificar que conserve el trigger `pull_request` sin filtros de paths.
- [x] 1.3 Añadir el workflow de release activado solo por `push` a `master`, encadenando validación, build, publicación y despliegue con dependencias fail-closed; esperar que `develop` no contacte producción.
- [x] 1.4 Configurar permisos mínimos, entorno `production`, `known_hosts` y concurrencia del workflow sin exponer secretos de aplicación ni permitir que una ejecución atrasada reemplace una release posterior.

## 2. Construir releases reproducibles

- [x] 2.1 Parametrizar `deployment/docker-compose.yml` para aceptar las imágenes de servidor y base de datos del release, conservar builds para CI/local y permitir producción con `--no-build` sin cambiar nombres, red ni volumen persistente.
- [x] 2.2 Actualizar `deployment/server/Dockerfile` y la configuración del preparador para incluir el CSV canónico en una ruta interna estable de la imagen y eliminar la dependencia productiva del checkout de `plans/`.
- [x] 2.3 Crear `scripts/create-release-manifest.js` y su script de `package.json` para calcular el checksum del CSV y emitir un manifiesto sin secretos con commit, imágenes, digests, workflow y fecha.
- [x] 2.4 Añadir al workflow de release la construcción de las imágenes de servidor y base de datos desde el mismo commit y su publicación en GHCR con tags SHA, sin usar `latest` como referencia efectiva.
- [x] 2.5 Publicar y transferir junto al manifiesto la composición de producción y el `Caddyfile`, y verificar que el paquete de release no contenga `.env`, credenciales, claves ni archivos temporales del runner.
- [x] 2.6 Añadir pruebas estáticas/unitarias para rechazar digests incompletos o referencias mutables y para demostrar que una release conserva el checksum del CSV y la correspondencia entre imágenes y commit.

## 3. Implementar el control de despliegue en la VPS

- [x] 3.1 Crear `deployment/deploy-vps.sh` con layout versionado `releases/<id>`, enlaces/estado `current` y `previous`, lock exclusivo y rechazo de generaciones antiguas.
- [x] 3.2 Implementar en el launcher el preflight de paquete, manifiesto, variables externas, `docker compose config` y disponibilidad de imágenes, fallando antes de reemplazar servicios ante cualquier error.
- [x] 3.3 Integrar el comando de backup de estudio aprobado en la VPS y exigir su éxito antes de ejecutar `labeling-study-prepare`, sin aceptar contraseñas o claves inline.
- [x] 3.4 Ejecutar la preparación del release por separado antes de reemplazar el servidor y respetar PostgreSQL saludable, migraciones, guardas legacy, bootstrap y enriquecimiento; no borrar el volumen ni continuar si falla.
- [x] 3.5 Recrear servidor y Caddy con imágenes exactas y `--no-build --wait`, verificar health checks y una petición HTTPS externa a `/login`, y escribir `current` solo después del éxito.
- [x] 3.6 Conservar manifiesto, salida de Compose, health checks, smoke test y logs de cada intento, incluyendo fallos de preflight, backup, preparación y runtime.
- [x] 3.7 Implementar la ruta de rollback de aplicación usando `previous` únicamente con compatibilidad de esquema declarada y mantener la restauración escribible PostgreSQL dentro de `deployment/ROLLBACK.md`.

## 4. Conectar GitHub Actions con la VPS

- [x] 4.1 Añadir al workflow de release el envío del paquete mediante OpenSSH a la cuenta de despliegue restringida y la invocación del launcher con un identificador de release, sin enviar secretos de aplicación ni el token de GHCR.
- [x] 4.2 Documentar y validar la configuración externa de la VPS: acceso de lectura al registry, `.env` de producción, secretos montados, rutas de backup, lock, permisos y directorios de releases.
- [x] 4.3 Añadir contratos de workflow y launcher que prueben que un fallo de gates, publicación, SSH, configuración o backup no detiene la release activa ni ejecuta migraciones nuevas.
- [x] 4.4 Añadir una verificación de que dos ejecuciones concurrentes se serializan y de que una release antigua no puede sobrescribir el estado de una posterior.

## 5. Operación, adopción y documentación

- [x] 5.1 Actualizar `README.md`, `docs/OPERATIONS.md`, `docs/TROUBLESHOOTING.md` y `deployment/ROLLBACK.md` con el flujo automático, límites de fallo, evidencia y rollback de imagen/base de datos.
- [x] 5.2 Documentar el checklist de adopción inicial: usuario SSH, `known_hosts`, GHCR read-only, entorno `production`, protección de `master`, backup/restore aislado y registro del digest actualmente activo.
- [x] 5.3 Verificar con el harness de despliegue y los gates existentes que el cambio conserva la preparación, persistencia, aislamiento, health checks y restricciones de no usar `down -v`.
- [x] 5.4 Ejecutar lint, pruebas unitarias, pruebas de contratos CI/CD, validación estricta de OpenSpec y revisión final del paquete para confirmar que todos los requisitos tienen evidencia.
