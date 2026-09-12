# Runbook de exportación offline

La exportación es operator-only, local y de solo lectura. No existe ruta HTTP, descarga desde el navegador ni UI
administrativa para exportar. La operación está documentada como `IMPLEMENTED-UNVERIFIED`; ejecutar el comando no prueba
por sí solo la aceptación de infraestructura o de VPS.

## Requisitos

- Un estudio persistido con `study_key` explícito, estado `READY` y cardinalidad 30 o 300.
- Una decisión terminal, `CLASSIFIED` o `DISCARDED`, para cada tarjeta de cada participante configurado.
- Un secreto HMAC externo de al menos 32 bytes, fuera del repositorio, en un archivo con permisos `0400` o `0600`.
- Un directorio de salida absoluto, externo al repositorio y todavía inexistente.
- Acceso local al PostgreSQL del estudio y sus credenciales protegidas por archivos externos.

El secreto HMAC no se escribe en el comando, no se guarda en el repositorio y no se incluye en el paquete. Conserva el
mismo archivo para reproducir los pseudónimos del mismo estudio en exportaciones posteriores.

## Gate de decisión

Antes de publicar, el comando abre una transacción `REPEATABLE READ READ ONLY` y comprueba el `study_key` explícito. Debe
existir exactamente un estudio `READY`, con `expected_card_count` igual a 30 o 300. También comprueba que cada participante
configurado tiene una fila terminal para cada tarjeta.

Si falta una decisión, existe una tarjeta `PENDING`, la membresía no coincide, el enriquecimiento promovido está incompleto
o el estudio no está `READY`, la operación falla y no genera un paquete. No se modifica la base. El destino tampoco puede
existir antes de comenzar.

## Ejecución exacta

Define la ruta del secreto y ejecuta la orden desde la raíz del repositorio:

```bash
export STUDY_EXPORT_HMAC_SECRET_FILE="$HOME/.config/labeler/secrets/export-hmac"
npm run export:study -- \
  --study-key pr-card-sorting-validation-30 \
  --output "$HOME/.config/labeler/exports/validation-30"
```

Para el estudio actual sustituye únicamente `--study-key` y el nombre final de `--output`, por ejemplo
`pr-card-sorting-local` y `"$HOME/.config/labeler/exports/local-300"`. `--output` debe ser una ruta absoluta fuera del
repositorio. El comando no sobrescribe un destino existente.

La salida de éxito es `STUDY_EXPORT_PUBLISHED`. Un fallo produce `STUDY_EXPORT_FAILED`; revisa el estado del estudio y el
gate antes de reintentar con otro directorio vacío.

## Paquete publicado

El directorio de destino contiene exactamente:

- `results.csv`, con una fila por tarjeta y participante, orden, decisión, categoría y nombre, observaciones, motivo de
  descarte, timestamps, revisión, URLs de origen y efectivas, procedencia y checksums.
- `categories.csv`, con las categorías privadas y sus nombres, incluidas las que no se usaron en una decisión.
- `manifest.json`, con versión, estudio, cardinalidad, checksums de fuente, membresía y archivos de salida, totales de
  finalización y procedencia de enriquecimiento. Los pseudónimos se derivan del HMAC externo.

El paquete no contiene tokens, secretos, sesiones, hashes de credenciales, datos de throttling ni payloads GitHub crudos.
La publicación se hace de forma atómica desde un directorio temporal y no deja un paquete parcial ante un error.

## Frontera no HTTP

La exportación no se invoca mediante `/export`, `curl`, un formulario, una vista o un selector de participante. El servidor
web no expone la orden ni recibe el secreto HMAC. Solo el operador, fuera del flujo HTTP, ejecuta `npm run export:study`
con `--study-key` y `--output` explícitos.

La orden exporta un estudio cada vez. Para exportar ambos perfiles, completa y verifica cada gate por separado y usa dos
directorios externos distintos. No mezcles paquetes ni interpretes el username como autoridad del estudio.

## Evidencia pendiente

Este runbook conserva la frontera offline y el gate terminal, pero no afirma evidencia runtime de backup y restore cifrados,
E2E histórico, E2E público en VPS o cierre documental. La captura GitHub live sigue pendiente y no forma parte de la
exportación.
