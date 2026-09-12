# Runbook de validación multiestudio

Este runbook describe la preparación documental de los dos perfiles aprobados. El estado operativo sigue
`IMPLEMENTED-UNVERIFIED`: no sustituye evidencia de ejecución de infraestructura, HTTP o VPS.

## Perfiles aprobados

Solo se admiten `expectedCardCount` 300 y 30. El estudio actual conserva la muestra completa y el estudio de validación
usa una muestra determinista derivada del mismo CSV canónico.

| `studyKey` | `expectedCardCount` | Claves visibles | Usernames de login |
| --- | ---: | --- | --- |
| `pr-card-sorting-local` | 300 | `javier`, `diego`, `pablo` | `javier`, `diego`, `pablo` |
| `pr-card-sorting-validation-30` | 30 | `javier`, `diego`, `pablo` | `javier-30`, `diego-30`, `pablo-30` |

Los usernames son distintos para permitir la coexistencia, pero el sistema no interpreta `-30`. La clave visible del
participante y el username son campos diferentes.

## Descriptor

`STUDY_PROFILES_INPUT` apunta a un JSON externo con esta forma exacta:

```json
{
  "profiles": [
    {
      "config": "/run/config/studies/current.json",
      "csv": "/labeling/plans/merged_after_rework_cards_seed_20260510.csv",
      "accountManifest": "/run/secrets/studies/current.json",
      "enrichmentEnabled": false
    },
    {
      "config": "/run/config/studies/validation-30.json",
      "csv": "/labeling/plans/validation-30-cards.csv",
      "accountManifest": "/run/secrets/studies/validation-30.json",
      "enrichmentEnabled": false
    }
  ]
}
```

Cada archivo de configuración declara `studyKey`, `expectedCardCount`, `participants` y `loginUsernames`. El primer
perfil debe ser el de 300 y el segundo el de 30. Los manifests de cuentas son secretos externos de solo lectura y no se
montan en `labeling-server`.

Antes de escribir, el preflight valida todos los perfiles, rutas montadas, conteos, claves únicas, participantes,
usernames, CSV, checksums y manifests. Una entrada extra, ausente o fuera de su raíz aprobada bloquea toda la preparación.

## Selección CSV

El CSV es la autoridad de la muestra, el orden, los `source_card_id`, el contenido canónico y el checksum. La muestra de
300 usa el CSV canónico completo. La fixture de 30 se genera desde ese CSV, sin GitHub ni aleatoriedad de runtime, con seis
tarjetas de cada agente `Copilot`, `Devin`, `OpenAI_Codex`, `Cursor` y `Claude_Code`. El selector conserva las columnas
de origen y falla si cambia el checksum aprobado, falta un agente o aparecen IDs duplicados.

Un perfil no puede declarar 10, 301 ni cualquier otro conteo. Una reejecución solo reutiliza filas canónicamente idénticas;
un cambio de contenido o checksum falla sin sobrescribir tarjetas ni resultados.

## Orden de preparación

1. Esperar PostgreSQL saludable.
2. Validar todos los descriptores, CSV, manifests, checksums, conteos y asignaciones antes de la primera escritura.
3. Aplicar las migraciones aditivas y validar el modo `clean` o `existing`.
4. Preparar transaccionalmente `pr-card-sorting-local`, con 300 tarjetas.
5. Preparar transaccionalmente `pr-card-sorting-validation-30`, con 30 tarjetas.
6. Crear o reutilizar la membresía y provisionar una cuenta habilitada por participante y estudio.
7. Confirmar ambos estudios como `READY`, comprobar la readiness interna y arrancar después el servidor y Caddy.

Si falla el segundo perfil, no se borra ni reescribe el estudio actual de 300, pero el despliegue completo permanece no
listo. La preparación normal no usa el modo `existing` para añadir el segundo estudio.

## Enriquecimiento opcional

Con `enrichmentEnabled=false`, el perfil es CSV-only: no necesita token GitHub, no crea un run promovido y no captura datos
live. Si se habilita, solo `labeling-study-prepare` recibe el token fine-grained de solo lectura y carga el `study_id`,
checksum, membresía y cardinalidad persistidos. La cobertura debe ser exactamente 30 o 300 según el estudio. El servidor
web, el navegador y la clasificación nunca llaman a GitHub.

Consulta [`deployment/GITHUB-ENRICHMENT.md`](../deployment/GITHUB-ENRICHMENT.md) para aliases, estados, pausas y reruns.

## Preservación y aislamiento

Dos estudios distintos pueden permanecer `READY` en la misma base. Cada cuenta persistida aporta el `study_id` a la sesión;
no existe selector de estudio ni selector de participante. Las rutas ignoran o rechazan identificadores de estudio o
participante enviados por URL, query, formulario o cabecera.

Los tres participantes reciben la misma membresía dentro de su estudio. Sus categorías, clasificaciones, descartes,
observaciones y progreso son privados. El mismo PR puede tener decisiones independientes en los dos estudios. La
repetición compatible conserva cuentas, hashes, versiones, tarjetas, membresías y resultados.

## Funciones no soportadas

- Conteos arbitrarios, estudios `ACTIVE` o muestras creadas por participante.
- Selector de estudio, selector de participante o interpretación de sufijos de username.
- UI administrativa, autorregistro, invitaciones, MFA, OIDC o recuperación por correo.
- Captura GitHub live, llamadas GitHub desde runtime, webhooks o workers permanentes.
- Exportación HTTP, descarga desde el navegador, `/export` o JSONL legacy.
- Taxonomía jerárquica, normalización, acuerdo y adjudicación.

La exportación aprobada es operator-only y offline. Su procedimiento está en [`EXPORT-RUNBOOK.md`](EXPORT-RUNBOOK.md).
Las fronteras de backup y restore, E2E histórico, E2E público en VPS, cierre documental y captura live siguen pendientes.
