## Context

La aplicación actual es un monolito Node.js/Express con EJS, PostgreSQL y rutas basadas en archivos. El runtime usa `instance.data` JSON, labels globales y revisiones multietiqueta. El CSV real tiene 69 columnas, 300 registros lógicos, campos multilinea y JSON incrustado, por lo que no puede cargarse con `scripts/init-data.sh`.

El objetivo inmediato es una demostración funcional con datos locales. No se implementan todavía GitHub API activa, invitaciones, exportación ni taxonomía final. Las decisiones completas permanecen en los artefactos posteriores del cambio y no deben adelantarse en este MVP.

## Goals / Non-Goals

**Goals:**

- Importar los 300 PR desde el CSV sin perder campos multilinea ni JSON.
- Guardar una representación local de cada tarjeta y mostrar el campo `language` del CSV.
- Renderizar una tarjeta visual útil para clasificar, con evidencia disponible en el CSV.
- Preparar una interfaz de datos sustituible por un proveedor GitHub futuro.
- Permitir que tres participantes configurables clasifiquen los mismos 300 PR.
- Mantener categorías y respuestas privadas por participante.
- Guardar una única categoría por PR y participante, observación opcional y progreso.

**Non-Goals:**

- Consultar GitHub desde la aplicación durante la demostración.
- Reproducir todas las pestañas de GitHub mediante datos API.
- Calcular lenguajes desde archivos modificados; por ahora se muestra `language` del CSV.
- Implementar invitaciones, autenticación administrativa o protección VPS.
- Implementar exportación, normalización, taxonomía jerárquica, acuerdo o adjudicación.
- Mantener compatibilidad funcional con el flujo legado de labels globales.

## Decisions

### 1. Importación CSV local con proveedor intercambiable

El importador leerá el CSV de investigación mediante un parser RFC 4180/streaming y transformará cada fila a un contrato común `PullRequestCard`. El contrato tendrá campos de resumen, evidencia, métricas disponibles, lenguaje y origen.

```text
CSV provider  ─┐
               ├──> PullRequestCard ───> PostgreSQL ───> EJS
GitHub provider┘          (futuro)
```

La fuente GitHub se dejará como interfaz o módulo futuro, pero no se realizarán solicitudes de red en este MVP.

La categoría de origen del CSV no se mostrará como categoría de clasificación. Los metadatos metodológicos como `population_case_type`, `agent`, `task_confidence` y `evidence_quality_score` se conservarán en el payload de origen, pero no se expondrán al participante por defecto.

### 2. Modelo mínimo nuevo junto al esquema legado

Para reducir el riesgo del avance, se añadirán tablas específicas sin intentar convertir todo el esquema antiguo:

```text
pr_cards
participants (o reviewer existente durante la transición)
participant_categories
pr_classifications
```

#### `pr_cards`

```text
id UUID PK
source_card_id TEXT UNIQUE
source_pr_id TEXT NULL
repository TEXT
pr_number INTEGER NULL
body TEXT NULL
author TEXT NULL
language TEXT NULL
state TEXT NULL
merged BOOLEAN NULL
html_url TEXT NULL
created_at TEXT NULL
closed_at TEXT NULL
merged_at TEXT NULL
summary JSONB
evidence JSONB
raw_payload JSONB
source_type TEXT DEFAULT 'CSV'
source_checksum TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

`summary` y `evidence` permiten renderizar la tarjeta sin volver a interpretar las 69 columnas en cada ruta. `raw_payload` conserva la fila completa para depuración y fases futuras.

#### `participant_categories`

```text
id UUID PK
participant_id INTEGER FK reviewer(id)
raw_name TEXT
normalized_name TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
UNIQUE(participant_id, normalized_name)
```

Durante esta fase las categorías son planas y no se emiten por Socket.io.

#### `pr_classifications`

```text
id UUID PK
pr_card_id UUID FK pr_cards(id)
participant_id INTEGER FK reviewer(id)
category_id UUID FK participant_categories(id)
remarks TEXT NULL
classified_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
UNIQUE(pr_card_id, participant_id)
```

Una restricción o validación transaccional debe comprobar que `category_id.participant_id` coincide con `participant_id`.

El selector de `/login` seguirá usando `reviewer` temporalmente. Más adelante se sustituirá por participantes de estudio y enlaces privados sin cambiar las categorías ni clasificaciones conceptuales.

### 3. Tarjeta visual desde el contrato local

`views/partials/instance/data.ejs` se reemplazará o dejará como wrapper de un partial de PR. La tarjeta mostrará:

- repositorio y número;
- título;
- estado y fechas disponibles;
- autor según la política actual del MVP;
- `language` del CSV;
- resumen y cuerpo;
- métricas del CSV;
- evidencia seleccionada y JSON adicional bajo demanda;
- enlace externo opcional a `html_url`.

No se renderizará un iframe ni se consultará GitHub desde el navegador. La estructura de datos usará nombres de secciones que también puedan producirse por el futuro proveedor GitHub.

### 4. Clasificación temporal compatible con el flujo existente

La pantalla conservará la selección local de participante, pero el formulario nuevo usará categorías asociadas al participante actual. La cola servirá la siguiente `pr_card` no clasificada por ese participante y permitirá avanzar hasta completar las 300 tarjetas.

El flujo nuevo no usará `label`, `instance_review_label` ni los conflictos destructivos del sistema legado. El esquema antiguo puede permanecer para los fixtures actuales mientras las nuevas rutas usan las tablas de PR.

### 5. GitHub preparado, no activo

El contrato `PullRequestCard` y el campo `source_type` deben permitir posteriormente:

- importar el detalle del PR;
- añadir commits, archivos, reviews, comentarios, diff y timeline;
- crear snapshots.

Esta fase no añade credenciales GitHub, worker ni llamadas API. La interfaz de proveedor se documentará y se probará con el CSV como implementación disponible.

## Risks / Trade-offs

- [El CSV contiene JSON y texto multilínea] → Usar parser CSV real, no `\COPY` heredado ni split por líneas.
- [La tarjeta no tiene toda la navegación de GitHub] → Mostrar toda la evidencia disponible en el CSV y conservar secciones compatibles con una futura fuente API.
- [El campo `language` es el lenguaje del dataset, no necesariamente el lenguaje exacto de archivos del PR] → Etiquetarlo como lenguaje informado por la fuente; posponer el cálculo por archivos.
- [El selector de participantes no es seguro para VPS] → Mantenerlo solo para demostración local y documentarlo como deuda explícita.
- [La implementación parcial puede convivir con labels legacy] → Separar tablas y rutas nuevas; no reutilizar consultas destructivas.
- [300 tarjetas pueden ser pesadas] → Renderizar resumen y evidencia bajo demanda dentro de la tarjeta, conservando el payload en PostgreSQL.

## Migration Plan

1. Crear tablas nuevas para tarjetas, categorías privadas y clasificaciones.
2. Importar el CSV real en una base limpia o entorno aislado.
3. Verificar conteo de 300 tarjetas y una muestra de campos multilínea/JSON.
4. Activar la vista de tarjeta y el clasificador con participantes existentes.
5. Probar tres participantes y comprobar que todos reciben 300 tarjetas sin compartir categorías.
6. Mantener el flujo legacy disponible para los fixtures mientras se valida el avance.
7. En una fase posterior, añadir proveedor GitHub y snapshots sin cambiar el contrato de tarjeta.

Rollback: detener el nuevo flujo y conservar las tablas legacy; las tablas nuevas pueden eliminarse únicamente en una base de desarrollo, nunca junto con datos que ya deban preservarse.

## Open Questions

- La duración y seguridad de invitaciones se decidirán cuando se implemente `participant-access` completo.
- El formato de exportación y la inclusión de snapshots se decidirán cuando se implemente `study-export`.
- El algoritmo de acuerdo y la estructura jerárquica se decidirán cuando se implemente `taxonomy-normalization` y `agreement-analysis`.
