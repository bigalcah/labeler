# Operaciones

La operación del estudio está documentada como `IMPLEMENTED-UNVERIFIED`. Hay código y contratos estáticos, pero no hay
evidencia aprobada de ejecución de infraestructura, HTTP o VPS. `AGENTS.md` mantiene el baseline ejecutable como
`LEGACY`; no presentes una tarea pendiente o un archivo existente como runtime verificado.

## Runbooks canónicos

- [`MULTI-STUDY-VALIDATION.md`](MULTI-STUDY-VALIDATION.md): perfiles 300 y 30, descriptor, orden de preparación y
  aislamiento.
- [`PARTICIPANT-GUIDE.md`](PARTICIPANT-GUIDE.md): usernames asignados, login y flujo privado del participante.
- [`EXPORT-RUNBOOK.md`](EXPORT-RUNBOOK.md): exportación offline operator-only y sus gates.
- [`deployment/GITHUB-ENRICHMENT.md`](../deployment/GITHUB-ENRICHMENT.md): aliases, permisos, conteos persistidos,
  estados, promoción y rerun.
- [`deployment/ROLLBACK.md`](../deployment/ROLLBACK.md): backup, rollback read-only y restauración separada.

No dupliques esos procedimientos. Compose usa `labeling-database`, `labeling-study-prepare`, `labeling-server`, red
`labeling-network`, volumen `labeling-data` y el puerto interno `7755:3000`. La exposición pública prevista queda detrás
de Caddy en 80 y 443.

## Perfiles y orden de preparación

Solo existen dos perfiles aprobados. `pr-card-sorting-local` tiene `expectedCardCount=300` y usa las claves visibles
`javier`, `diego` y `pablo`, con usernames de login `javier`, `diego` y `pablo`. `pr-card-sorting-validation-30` tiene
`expectedCardCount=30` y conserva las mismas claves visibles, pero usa `javier-30`, `diego-30` y `pablo-30` para login.
No se admiten conteos arbitrarios.

El orden bloqueado es el siguiente:

1. Esperar PostgreSQL saludable.
2. Validar todos los descriptores, CSV, manifests, checksums, conteos, claves y usernames antes de escribir.
3. Preparar de forma transaccional `pr-card-sorting-local`, primero, y `pr-card-sorting-validation-30`, después.
4. Crear o reutilizar la membresía y provisionar las cuentas de cada estudio sin resetear credenciales compatibles.
5. Confirmar ambos estudios como `READY` y comprobar la readiness interna de la aplicación.
6. Permitir que Caddy publique solo después de esa readiness.

Un fallo del segundo perfil deja intacto el estudio de 300, pero mantiene la publicación no lista. Repetir una preparación
compatible conserva tarjetas, membresías, cuentas, categorías, decisiones, descartes y enriquecimiento existentes.

## Identidad y límites de superficie

El username solo busca una cuenta. La cuenta persistida y la sesión validada aportan el `study_id` y la identidad del
participante para cada ruta protegida. El navegador nunca elige el estudio por un selector, sufijo interpretado, URL,
query, formulario o cabecera. No hay selector de participante.

Las categorías son planas y privadas por participante y estudio. `CLASSIFIED` tiene exactamente una categoría; el
resultado `DISCARDED` conserva solo su motivo opcional. No hay UI administrativa, alta de cuentas ni una ruta HTTP de
exportación. `/export` no es una superficie disponible.

## Reglas de despliegue

El preparador debe terminar antes del servidor. `clean` no elimina objetos legacy; `existing` exige confirmación y backup
externo verificable. No borres `labeling-data`, no uses `down -v` como rollback y no restaures sobre producción.

La selección de cada muestra procede del CSV validado. La fixture de 30 se obtiene de forma determinista del CSV canónico,
con seis tarjetas por cada agente requerido. GitHub solo puede enriquecer snapshots desde `labeling-study-prepare`; no
selecciona la muestra y no hay captura live durante la clasificación.

## Exportación offline

La exportación es una operación local de operador, nunca una ruta web. El procedimiento completo está en
[`EXPORT-RUNBOOK.md`](EXPORT-RUNBOOK.md). En resumen, crea un secreto HMAC externo de al menos 32 bytes, selecciona un
directorio absoluto externo que todavía no exista y ejecuta:

```bash
export STUDY_EXPORT_HMAC_SECRET_FILE="$HOME/.config/labeler/secrets/export-hmac"
npm run export:study -- \
  --study-key pr-card-sorting-validation-30 \
  --output "$HOME/.config/labeler/exports/validation-30"
```

El comando solo publica `results.csv`, `categories.csv` y `manifest.json` si el estudio está `READY` y todas las tarjetas
de cada participante tienen una decisión terminal. Lee PostgreSQL en una transacción `REPEATABLE READ READ ONLY`, no
sobrescribe destinos y no imprime el secreto ni los datos exportados. Conserva el archivo HMAC para reproducir los mismos
pseudónimos en exportaciones posteriores del mismo estudio.

## Retiro legacy

El retiro operativo no es una limpieza automática. Es una secuencia cerrada y posterior al aislamiento del MVP.

1. Usa `clean` solo cuando el inventario no encuentre objetos legacy. Si los encuentra, el preparador debe fallar antes
   de escribir y antes de arrancar la web.
2. Usa `existing` solo con backup externo verificable, manifiesto, checksum, identidad de base y
   `LEGACY_RETIREMENT_CONFIRM=retire-legacy-labeler`.
3. Mantén `reviewer` mientras existan referencias desde `study_participant`, cuentas, categorías, clasificaciones u otros
   datos del MVP. No lo trates como fixture descartable.
4. Retira objetos legacy solo si el inventario confirma que no quedan consumidores runtime y si el objeto está autorizado
   por la migración protegida. No uses `DROP CASCADE` ni borrados manuales para hacer pasar el arranque.
5. Si falla cualquier verificación, conserva el estado previo, deja el servicio no listo y recupera solo desde un backup
   restaurado en una base separada o explícitamente aprobada.

## Evidencia pendiente

Estos runbooks no sustituyen evidencia de ejecución. Siguen pendientes la aceptación real de backup cifrado y restore
externos, el E2E histórico de aislamiento, el E2E público en VPS y el cierre documental formal. La captura GitHub live
también sigue pendiente y no debe describirse como implementada.
