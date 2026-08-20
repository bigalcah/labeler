## Why

El MVP de card sorting ya usa tarjetas `pr_cards`, categorias privadas por participante y clasificaciones persistentes. El flujo legacy de labels globales, conflictos y eventos Socket.IO mantiene rutas, vistas, tablas y dependencias que ya no representan el comportamiento objetivo y aumenta el riesgo de ejecutar dos modelos de datos en paralelo.

## What Changes

- Retirar el realtime de Socket.IO usado exclusivamente para sincronizar labels globales.
- Retirar las rutas y vistas dedicadas exclusivamente a labels globales, merge/rename legacy y resolucion de conflictos legacy.
- Retirar las tablas, funciones, procedimientos, vistas y tipos SQL que solo soportan `instance`, `label`, reviews, discards y conflictos legacy.
- Dejar de montar y cargar `label.txt`, `reviewer.txt` e `instance.tsv` como fixtures de inicializacion; los participantes y las tarjetas pertenecen al bootstrap del estudio MVP.
- Mantener `reviewer` mientras sea la identidad temporal referenciada por `study_participant`, `participant_category` y `pr_classification`.
- Mantener las rutas y vistas que el MVP reutiliza para explorar y clasificar `pr_cards`, aunque con nombres legacy, hasta que exista una sustitucion posterior.
- Respaldar o exportar los datos legacy antes de eliminar objetos persistentes; la migracion debe fallar si no puede preservar datos requeridos.
- **BREAKING**: dejaran de existir las APIs, pantallas y tablas legacy de labels globales, reviews/discards y resolucion de conflictos.

## Capabilities

### New Capabilities

- `legacy-labeler-retirement`: Retiro seguro del flujo legacy de labels, realtime, conflictos y datos de instancias.

### Modified Capabilities

No se modifican los contratos funcionales del clasificador MVP; el cambio elimina consumidores legacy y conserva las capacidades de `study-management` y `private-open-card-sorting`.

## Impact

- Se modificaran rutas Express, vistas EJS, `index.js`, dependencias npm, Docker y el conjunto de scripts SQL.
- Se añadira una migracion destructiva controlada despues de verificar respaldo y ausencia de consumidores legacy.
- El bootstrap MVP seguira siendo responsable de participantes, `pr_cards`, `study` y membresias; no se reintroduciran fixtures globales.
- Las tablas `reviewer`, `pr_cards`, `study`, `study_participant`, `study_card`, `participant_category` y `pr_classification` quedan fuera del retiro.
- El cambio no añade autenticacion, exportacion del estudio ni nuevas consultas a GitHub.
