# Rollback seguro

Este procedimiento aplica cuando ya existe al menos un descarte. La versión anterior
no conoce el estado privado nuevo y solo puede consultar la base mediante un rol sin
privilegios de escritura.

## Rollback de solo lectura

1. Detén el stack actual sin eliminar el volumen:

   ```bash
   docker compose --env-file deployment/.env -f deployment/docker-compose.yml down
   ```

2. Crea o verifica, fuera del flujo de despliegue, un rol `labeling_readonly` sin
   privilegios `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE`, `ALTER` ni `DROP`.
   Define su contraseña en `ROLLBACK_DATABASE_PASS` y, si procede, cambia el nombre
   mediante `ROLLBACK_DATABASE_USER`.

3. Selecciona la imagen anterior y arranca exclusivamente el launcher de rollback:

   ```bash
   ROLLBACK_SERVER_IMAGE=seart/labeling-server:<version-anterior> \
   docker compose --env-file deployment/.env \
     -f deployment/docker-compose.rollback-readonly.yml up --build -d
   ```

   Este archivo no incluye `labeling-study-prepare`, no ejecuta migraciones ni
   bootstrap, y configura PostgreSQL con `default_transaction_read_only=on`.

4. Comprueba el health check y usa la aplicación solo para lectura. No ejecutes
   formularios de clasificación o descarte contra esta base.

## Rollback escribible

Un rollback escribible **solo** está permitido restaurando un backup verificado,
creado antes del primer descarte, en otra base de datos aprobada. Detén el stack,
restaura el archivo y su manifiesto verificados en ese destino separado, valida su
identidad y checksum, y apunta allí una instalación aislada de la versión anterior.

Nunca restaures sobre `labeling-data`, nunca pruebes la restauración en producción,
nunca uses `down -v` como rollback y nunca conviertas el launcher de solo lectura en
una ruta de escritura sobre la base que contiene descartes.
