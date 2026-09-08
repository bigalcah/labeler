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
