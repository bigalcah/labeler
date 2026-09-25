## 1. Retirar workflows de mantenimiento

- [x] 1.1 Eliminar `.github/workflows/reviewer.yml` para retirar auto-merge, aprobacion y asignacion automatica de pull requests de Dependabot.
- [x] 1.2 Eliminar `.github/workflows/stale.yml` para detener la programacion diaria de marcado y cierre de issues stale.

## 2. Verificar y retirar el secreto sin uso

- [x] 2.1 Confirmar que los workflows restantes de calidad (`eslint.yml`, `stylelint.yml`, `markdownlint.yml` y `hadolint.yml`) permanecen y no referencian `API_TOKEN`.
- [x] 2.2 Revisar el diff para confirmar que solo se retiraron las dos automatizaciones de mantenimiento.
- [ ] 2.3 Eliminar manualmente el secreto de repositorio `API_TOKEN` en GitHub, si existe, despues de fusionar el cambio.
