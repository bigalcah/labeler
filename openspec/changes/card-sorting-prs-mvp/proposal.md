## Why

El MVP necesita una muestra histórica reproducible y una frontera clara entre la preparación del estudio y la clasificación. El CSV local contiene exactamente 300 PR lógicos, pero el flujo anterior dependía de una importación manual y de un `ON CONFLICT DO UPDATE` que podía cambiar una tarjeta ya clasificada. La base debe poder arrancar limpia o con datos existentes sin borrar trabajo ni declarar listo un estudio incompleto.

## What Changes

- Definir una configuración JSON de estudio con `studyKey`, `expectedCardCount` y `participants`; el valor predeterminado local es tres participantes.
- Persistir `study`, `study_participant` y `study_card` además de las tarjetas y clasificaciones del MVP.
- Ejecutar un bootstrap único después de la salud de PostgreSQL y antes de publicar la web: las migraciones crean estructura; el bootstrap prepara el estudio, participantes, tarjetas y membresía.
- Validar todo el CSV antes de escribir, exigir exactamente 300 `source_card_id` únicos y guardar checksum de la fuente y de sus filas.
- En una base limpia, crear participantes desde la configuración, importar `pr_cards` y asociar las mismas 300 tarjetas a cada participante mediante `study_card`.
- En una base existente, tratar el estudio activo y su configuración persistida como autoridad; una configuración explícita solo puede crear un estudio nuevo. El drift falla sin borrar silenciosamente datos.
- Fallar ante un cambio del contenido de un `source_card_id` existente, sin sobrescribir tarjetas o clasificaciones; nunca borrar automáticamente.
- Mantener `reviewer` como tabla de identidad temporal: el bootstrap reutiliza o crea reviewers y persiste su pertenencia al estudio. No sembrar labels ni instances legacy.
- Mantener categorías planas privadas y exactamente una clasificación por PR y participante. Las categorías y clasificaciones no se crean durante el bootstrap.
- Mantener GitHub inactivo: las tarjetas provienen solo del CSV local durante este MVP; el contrato de proveedor queda preparado para una fase posterior.
- Documentar la retirada escalonada del flujo legacy sin eliminar sus objetos en este cambio.

## Capabilities

### New Capabilities

- `github-pr-ingestion`: validación completa, importación conflict-safe y bootstrap de la muestra CSV.
- `github-pr-explorer`: visualización local de la tarjeta de PR y evidencia disponible en el CSV.
- `study-management`: configuración persistida, bootstrap, participantes y membresía de las 300 tarjetas.
- `private-open-card-sorting`: categorías planas privadas y una clasificación por PR y participante.

### Modified Capabilities

No existen capacidades OpenSpec previas que deban modificarse.

## Impact

- Se añadirán tablas de estudio y membresía junto al esquema legado; las migraciones solo crean estructura y no cargan fixtures legacy.
- El bootstrap será dueño de la carga de participantes, tarjetas y membresía. El servidor web no estará listo si el bootstrap falla o no deja el estudio listo.
- `/login` seguirá usando `reviewer` como identidad temporal local, no como autenticación ni frontera de seguridad.
- La fuente GitHub, webhooks, invitaciones, exportación, taxonomía jerárquica, normalización, acuerdo y adjudicación quedan fuera del MVP.
- El retiro legacy será por etapas: primero aislar rutas y consultas nuevas, después migrar/retirar consumidores, y solo al final retirar objetos cuando no existan dependencias.
