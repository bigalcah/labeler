## Why

El proyecto se mantiene por una sola persona con apoyo de agentes, por lo que las automatizaciones de auto-revision de Dependabot y cierre de issues stale no aportan valor operativo. Ambas dependen de un secreto `API_TOKEN` con permisos de escritura que no es necesario para el producto ni para los controles de calidad.

## What Changes

- Eliminar el workflow que habilita auto-merge, aprueba y asigna revisores a pull requests de Dependabot.
- Eliminar el workflow programado que marca y cierra issues stale.
- Retirar la dependencia operativa de `secrets.API_TOKEN` de GitHub Actions.
- Conservar los workflows de calidad existentes: ESLint, Stylelint, Markdownlint y Hadolint.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

Ninguna. Este cambio solo retira automatización de mantenimiento y no altera requisitos del producto.

## Impact

- Se eliminan `.github/workflows/reviewer.yml` y `.github/workflows/stale.yml`.
- Ya no será necesario configurar ni rotar `API_TOKEN` para esos workflows.
- Dependabot seguirá pudiendo abrir pull requests, pero su revision, aprobacion, merge y asignacion quedaran bajo control manual.
