# Operaciones

La operación del estudio es `IMPLEMENTED-UNVERIFIED` sin evidencia de infraestructura aprobada. `AGENTS.md` mantiene
el baseline ejecutable como `LEGACY`; no presentes código o tareas completadas como runtime verificado.

## Runbooks canónicos

- [`deployment/GITHUB-ENRICHMENT.md`](../deployment/GITHUB-ENRICHMENT.md): aliases, permisos, captura, estados,
  promoción y rerun.
- [`deployment/ROLLBACK.md`](../deployment/ROLLBACK.md): backup pre-004, rollback read-only y restauración separada.

No dupliques esos procedimientos. Compose usa `labeling-database`, `labeling-study-prepare`, `labeling-server`, red
`labeling-network`, volumen `labeling-data` y puerto `7755:3000`.

## Reglas

El preparador debe terminar antes del servidor. `clean` no elimina objetos legacy; `existing` exige confirmación y
backup. No borres `labeling-data`, no uses `down -v` como rollback y no restaures sobre producción.

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
