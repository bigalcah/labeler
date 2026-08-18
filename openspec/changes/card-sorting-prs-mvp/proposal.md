## Why

Se necesita un avance demostrable para visualizar la muestra real de Pull Requests y ejecutar el clasificador antes de implementar la integración completa con GitHub y el análisis final. El MVP inmediato debe funcionar con el CSV local, presentar tarjetas comprensibles y conservar clasificaciones separadas por participante.

## What Changes

- Importar el CSV de investigación con sus 300 registros lógicos, campos multilínea, comillas y JSON incrustado.
- Convertir cada fila en una tarjeta local de Pull Request, conservando sus datos originales y el campo `language` del CSV.
- Renderizar una tarjeta EJS con título, repositorio, número, estado, autor, descripción, lenguaje, métricas disponibles, evidencia y URL de referencia.
- Permitir consultar dentro de la tarjeta la evidencia disponible en el CSV; no se consultará GitHub durante este MVP.
- Introducir una frontera de proveedor de datos para que GitHub REST API pueda enriquecer tarjetas en una fase posterior sin rediseñar la tarjeta.
- Mantener temporalmente el selector actual de participantes para desarrollo local y demostración; no se implementarán todavía invitaciones ni autenticación.
- Crear categorías planas privadas por participante y evitar que un participante vea categorías o clasificaciones de otro.
- Permitir una sola categoría por PR y participante, con observación opcional.
- Entregar los mismos 300 PR a los tres participantes configurables, con progreso y reanudación básica.
- Posponer exportación, invitaciones, administración completa, taxonomía jerárquica, normalización, acuerdo, adjudicación, métricas temporales y enriquecimiento activo desde GitHub.
- **BREAKING**: el flujo de demostración dejará de usar labels globales compartidos para clasificaciones nuevas.

## Capabilities

### New Capabilities

- `github-pr-ingestion`: Importación local del CSV y frontera preparada para una fuente GitHub posterior.
- `github-pr-explorer`: Visualización local de la tarjeta de PR y evidencia disponible en el CSV.
- `study-management`: Estudio local fijo con 300 tarjetas, tres participantes configurables y progreso.
- `private-open-card-sorting`: Categorías planas privadas y una clasificación por PR y participante.

### Modified Capabilities

No existen capacidades OpenSpec previas que deban modificarse.

## Impact

- Se añadirá un importador CSV robusto y una representación persistente de tarjetas PR.
- Se modificarán el esquema PostgreSQL, las rutas de cola/revisión y las vistas EJS para dejar de depender de labels globales en el flujo nuevo.
- Se conservará temporalmente `/login` como selector local de participantes; no es adecuado para una VPS sin protección adicional.
- Se mantendrán Express, EJS, PostgreSQL, Docker y JavaScript progresivo.
- La futura fuente GitHub deberá implementar la misma interfaz de datos que el importador CSV y generar snapshots equivalentes.
- Las capacidades de invitaciones, exportación y taxonomía final quedan fuera del avance inmediato y se retomarán en cambios posteriores.
