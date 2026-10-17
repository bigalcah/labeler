## Why

Los participantes que terminan necesitan comparar en una sola tabla CSV las decisiones terminadas de su estudio,
sin exponer progreso ni datos de quienes aún no completan todas las tarjetas. La exportación debe estar disponible
solo cuando el solicitante y al menos otra persona hayan terminado todas las tarjetas del estudio.

## What Changes

- Añadir una descarga CSV de comparación, con una fila por PR y columnas para `pr_id`, `pr_url` y la categoría,
  descripción y comentario de cada participante completado; representar los descartes como `DESCARTADO`, dejando
  vacíos los otros campos, y también los textos opcionales ausentes.
- Incorporar una entrada de interfaz y estados para disponibilidad, espera y descarga; comprobar en el servidor
  la identidad autenticada, el estudio de la sesión y la finalización exacta de todas las tarjetas, 30 o 300 según
  el estudio.
- Excluir por completo del archivo las columnas, decisiones y el progreso de participantes sin completar.
  No añadir roles de administración ni selector de participantes o estudios.
- **BREAKING:** retirar el comando de operador `export:study` y el paquete compuesto por `results.csv`,
  `categories.csv` y `manifest.json`, incluida su dependencia de exportación HMAC. No ofrecer compatibilidad;
  los backups operativos y los archivos históricos ya descargados quedan fuera del cambio y se conservan.
- Sustituir únicamente el contrato antiguo de exportación del MVP en las especificaciones de este cambio.
  Las especificaciones principales son anteriores al MVP activo: preservar los artefactos históricos y no
  sincronizarlos automáticamente.
- Mantener intactos, byte por byte, los siete workflows de `.github/workflows/` y
  `deployment/docker-compose.release.yml`. No se esperan cambios de dependencias ni migraciones de base de datos.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `study-management`: autorización por sesión, umbral de dos participantes completos y estados de la descarga
  en la interfaz.
- `private-open-card-sorting`: CSV comparativo de participantes completos, excepción acotada de privacidad y
  retirada del exportador anterior.

## Impact

Afecta al exportador y sus dependencias en `util/study-export*.js`, al comando `scripts/export-study.js` y su
entrada de `package.json`, y a las rutas, vistas y JavaScript cliente de la nueva descarga. También requiere
actualizar la documentación y los validadores, pruebas y harnesses que describen o comprueban la exportación.
La privacidad de categorías y observaciones seguirá siendo la regla para todas las páginas; la única excepción
será la descarga autorizada, con las condiciones de finalización anteriores.
