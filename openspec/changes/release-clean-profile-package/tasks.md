## 1. Contratos de regresión

- [x] 1.1 Añadir tests que verifiquen el wiring multiestudio de la composición empaquetada - expect descriptor, configuraciones y manifests solo en el preparador
- [x] 1.2 Añadir tests que verifiquen el origen de composición del workflow y el rechazo fail-closed del launcher - expect paquete de tres archivos sin mounts `plans/`

## 2. Composición y workflow de release

- [x] 2.1 Crear la composición autónoma de producción con los cinco inputs externos y `STUDY_PROFILES_INPUT` - expect preparación ordenada de 300 y 30 tarjetas
- [x] 2.2 Empaquetar la composición release-only como `docker-compose.yml` sin cambiar el allowlist ni el uso de `--no-build` - expect release portable sin checkout

## 3. Validación y documentación

- [x] 3.1 Exigir en el preflight los targets y variables multiestudio, manteniendo la separación de runtime - expect fallo antes de backup ante wiring incompleto
- [x] 3.2 Documentar los cinco archivos externos y ejecutar tests focalizados, lint y OpenSpec estricto - expect evidencia local reproducible
