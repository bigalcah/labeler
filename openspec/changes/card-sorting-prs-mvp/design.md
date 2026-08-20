## Context

La aplicación actual es un monolito Node.js/Express con EJS, PostgreSQL y rutas basadas en archivos. El runtime legacy usa `instance`, `label`, `review` y `discard`; el MVP usa `reviewer`, `pr_cards`, categorías privadas y clasificaciones. El CSV real tiene 69 columnas, 300 registros lógicos, campos multilinea y JSON incrustado, por lo que no puede cargarse con el loader legacy.

El objetivo es un estudio local reproducible. No se implementan GitHub API activa, invitaciones, exportación ni taxonomía final. `reviewer` se conserva como tabla de identidad temporal y `/login` como selector local; ninguno constituye autenticación.

## Goals / Non-Goals

**Goals:**

- Validar el CSV completo antes de cualquier escritura y exigir exactamente 300 `source_card_id` únicos.
- Persistir una configuración JSON y una membresía canónica de estudio para los mismos 300 PR por participante.
- Arrancar de forma determinista en una base limpia o existente, preservando datos y fallando ante conflictos.
- Ejecutar un bootstrap one-shot después de la salud de la base y antes de la readiness web.
- Renderizar tarjetas locales, mantener categorías y respuestas privadas, y permitir exactamente una clasificación por PR y participante.
- Mantener un contrato sustituible por GitHub sin activar GitHub en el MVP.

**Non-Goals:**

- Consultar GitHub desde la aplicación o el navegador.
- Implementar invitaciones, autenticación administrativa, exportación, normalización, acuerdo o adjudicación.
- Eliminar objetos legacy o cargar sus labels, instances, reviews o fixtures en el bootstrap.

## Decisions

### 1. Configuración y precedencia

La configuración del estudio se lee como JSON con esta forma mínima:

```json
{
  "studyKey": "pr-card-sorting-2026",
  "expectedCardCount": 300,
  "participants": ["participant-a", "participant-b", "participant-c"]
}
```

`expectedCardCount` debe ser 300 para este MVP y `participants` debe contener identificadores únicos. Si existe un estudio activo para `studyKey`, su configuración y membresía persistidas son autoritativas: una configuración local distinta no elimina ni reemplaza participantes o tarjetas y el drift falla. Una configuración explícita solo crea un estudio nuevo. Si no hay configuración explícita, se usa un fallback local de tres participantes. No se reimporta ni se borra silenciosamente para corregir drift.

### 2. Bootstrap one-shot y ownership

Las migraciones crean únicamente la estructura. Después de que PostgreSQL esté saludable, un proceso `labeling-bootstrap` ejecuta una vez antes de que el servicio web anuncie readiness:

1. Lee y valida el JSON y todo el CSV sin escribir.
2. Obtiene el checksum de la fuente y valida encabezado, JSON, campos requeridos, unicidad y exactamente 300 IDs.
3. En una transacción, crea o reutiliza el estudio y sus reviewers; persiste `study_participant` con orden estable.
4. Crea o reutiliza `pr_cards` por `source_card_id` solo si el contenido y checksum coinciden.
5. Crea la membresía canónica `study_card` para el estudio y cada tarjeta.
6. Marca el bootstrap listo y confirma la transacción.

Un fallo hace rollback de toda la transacción, no borra datos previos y deja el servicio no listo. Las categorías y clasificaciones son siempre creadas por el usuario, nunca por el bootstrap.

### 3. Modelo mínimo nuevo junto al esquema legado

```text
study
study_participant
study_card
pr_cards
reviewer (identidad temporal existente)
participant_categories
pr_classifications
```

#### `study`

```text
id UUID PK
study_key TEXT UNIQUE
config JSONB
source_checksum TEXT
expected_card_count INTEGER CHECK (expected_card_count = 300)
bootstrap_state TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

#### `study_participant`

```text
study_id UUID FK study(id)
reviewer_id INTEGER FK reviewer(id)
ordinal INTEGER
participant_key TEXT
created_at TIMESTAMPTZ
PRIMARY KEY(study_id, reviewer_id)
UNIQUE(study_id, participant_key)
```

#### `study_card`

```text
study_id UUID FK study(id)
pr_card_id UUID FK pr_cards(id)
source_card_id TEXT
ordinal INTEGER
source_checksum TEXT
PRIMARY KEY(study_id, pr_card_id)
UNIQUE(study_id, source_card_id)
```

`study_card` es la membresía canónica: no se deriva de la existencia global de `pr_cards` y no se modifica por cada participante.

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
summary JSONB
evidence JSONB
raw_payload JSONB
source_type TEXT DEFAULT 'CSV'
source_checksum TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

`summary` y `evidence` permiten renderizar la tarjeta sin volver a interpretar las 69 columnas en cada ruta. `raw_payload` conserva la fila completa. Un `source_card_id` existente con contenido o checksum diferente es un conflicto fatal: no se actualiza y no se sobrescribe una tarjeta clasificada.

`participant_categories` y `pr_classifications` mantienen la relación con `reviewer`; una clasificación debe referenciar una categoría del mismo participante y tiene unicidad `(pr_card_id, participant_id)`. Durante esta fase las categorías son planas, privadas y no se emiten por Socket.io. El bootstrap no las siembra.

### 4. Importación CSV local con proveedor intercambiable

El importador usa un parser RFC 4180/streaming y transforma cada fila a `PullRequestCard`, conservando resumen, evidencia, lenguaje, métricas, URL, procedencia y payload original. La fuente GitHub futura debe producir el mismo contrato, pero no realiza solicitudes de red en este MVP.

### 5. Tarjeta visual desde el contrato local

La tarjeta muestra repositorio, número, título, estado, fechas, autor, `language` del CSV, resumen, cuerpo, métricas, evidencia y `html_url` opcional. No se renderiza iframe ni se consulta GitHub desde el navegador.

### 6. Clasificación temporal compatible con el flujo existente

La pantalla conserva la selección local de participante, pero las consultas y mutaciones se limitan al reviewer activo y a su `study_participant`. La cola se basa en `study_card` y excluye solo sus clasificaciones. El flujo nuevo no usa `label`, `instance_review_label` ni conflictos destructivos.

## Readiness, rollback y legado

La readiness web depende de que el bootstrap termine en estado listo y de que el estudio tenga 300 `study_card` y la membresía configurada. En una base limpia, el bootstrap no monta ni siembra `label`, `instance`, `review` o fixtures legacy. En una base existente, preserva todos esos objetos y datos, y nunca elimina automáticamente filas.

La retirada legacy es escalonada: aislar consumidores, migrar rutas, verificar que no haya dependencias, y retirar objetos en un cambio posterior.

## Risks / Trade-offs

- El CSV contiene JSON y texto multilínea: usar parser CSV real, no split por líneas ni el loader legacy.
- Un volumen existente puede contener fixtures o clasificaciones: reutilizar lo compatible y fallar ante drift, sin reimportación incondicional.
- El selector de participantes no es seguro para VPS: mantenerlo solo para demostración local y documentarlo como deuda.
- El campo `language` es el lenguaje informado por la fuente, no un cálculo por archivos.

## Migration Plan

1. Crear estructura nueva mediante migraciones, sin cargar labels, instances ni reviewers desde fixtures legacy.
2. Ejecutar el bootstrap después de la salud de PostgreSQL y antes de la readiness web.
3. Validar el CSV completo y confirmar 300 tarjetas y 300 membresías por participante.
4. Activar el clasificador local con `reviewer` como identidad temporal.
5. Verificar reanudación, aislamiento y conflicto ante una fuente modificada.
6. Mantener legacy aislado y retirarlo por etapas en cambios posteriores.

Rollback: fallar o detener el bootstrap antes del commit y conservar todos los datos existentes. No hay eliminación automática; cualquier retiro de tablas legacy o nuevas requiere un cambio explícito y una base de desarrollo apropiada.
