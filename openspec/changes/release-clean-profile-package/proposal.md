## Why

El paquete de release actual copia la composición base, que solo prepara el estudio de 300 tarjetas. La VPS ya puede
conservar los insumos externos del estudio de validación, pero el release no los conecta con `labeling-study-prepare`.
La corrección es necesaria antes de ejecutar la primera release automática.

## What Changes

- Añadir una composición autónoma para releases que incluya el flujo clean de los perfiles de 300 y 30 tarjetas.
- Montar el descriptor, configuraciones y manifests externos únicamente en `labeling-study-prepare`.
- Empaquetar esa composición con el nombre `docker-compose.yml` sin cambiar la lista allowlisted de tres archivos.
- Mantener el despliegue por digest, `--no-build`, el volumen persistente y el modo `existing` local separado.
- Añadir contratos de tests, validación del launcher y documentación de los archivos externos requeridos.

## Capabilities

### New Capabilities

- `release-clean-profile-package`: release reproducible que prepara los dos perfiles aprobados desde insumos externos de la VPS.

### Modified Capabilities

Ninguna.

## Impact

- Afecta el workflow de release, las composiciones Docker de producción y la validación del launcher.
- Añade una composición versionada de release y tests de contrato.
- Requiere en la VPS un descriptor, dos configuraciones y dos manifests de cuentas fuera del paquete y del checkout.
- No cambia rutas HTTP, el esquema funcional ni el volumen `labeling-data`.
