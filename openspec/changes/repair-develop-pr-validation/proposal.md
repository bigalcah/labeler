## Why

El workflow compartido de `develop` falla al preparar las credenciales porque entrega contraseñas como líneas, mientras que el generador espera un arreglo JSON por entrada estándar. Las etapas posteriores aún no se han probado en la PR afectada, por lo que la reparación debe cubrir también las diferencias conocidas de runtime y exigir evidencia del gate completo antes de considerar válida la CI.

## What Changes

- Definir el contrato de preparación de credenciales temporales para CI como JSON por stdin, sin exponer contraseñas en argumentos ni logs.
- Alinear `localhost`, el origen de la aplicación y el nombre del certificado TLS local.
- Especificar propiedad y lectura de los archivos temporales montados por sus consumidores, así como la legibilidad del Caddyfile.
- Hacer que la categoría temporal de prueba pertenezca explícitamente al estudio y que la salida de `psql` usada como valor sea inequívoca.
- Crear y firmar la cookie de sesión dentro del contenedor del servidor con el secreto montado en ese contenedor.
- Hacer que la limpieza tolere una preparación incompleta sin ocultar errores ni dejar recursos temporales.
- Exigir los gates completos de lint, unit, OpenSpec, Compose, Dockerfiles, integración y E2E, sin omitir etapas ni introducir bypass.

## Capabilities

### New Capabilities

- `ci-validation`: Contrato de preparación segura del runtime efímero y ejecución fail-closed de todos los gates de validación compartida.

### Modified Capabilities

Ninguna. No cambian requisitos funcionales del producto ni el despliegue de release.

## Impact

- Afecta la especificación de `.github/workflows/shared-validation.yml` y sus comprobaciones de contrato existentes.
- Usa los contratos actuales del generador de credenciales, Compose, los secretos montados y las etapas de CI; no requiere nuevas dependencias ni cambios de producto.
- La propuesta no autoriza editar workflows o pruebas. La implementación requiere revisión y aprobación explícita de estos artefactos y debe iniciarse mediante `/opsx-apply repair-develop-pr-validation`.
