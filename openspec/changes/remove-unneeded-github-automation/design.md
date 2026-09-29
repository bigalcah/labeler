## Context

Los workflows `reviewer.yml` y `stale.yml` son las unicas automatizaciones de mantenimiento que consumen `secrets.API_TOKEN`. Los workflows restantes solo ejecutan comprobaciones de calidad y no requieren secretos. Vease `proposal.md` para la motivacion.

## Goals / Non-Goals

**Goals:**

- Eliminar los dos workflows que ejecutan acciones de mantenimiento sin supervision.
- Eliminar la dependencia de configuracion de GitHub Actions sobre `API_TOKEN`.
- Preservar intactos los controles de calidad de pull requests.

**Non-Goals:**

- No sustituir las automatizaciones retiradas por otro bot, GitHub App o token.
- No cambiar Dependabot, reglas de proteccion de ramas, permisos de GitHub ni los workflows de calidad.
- No revocar automaticamente el secreto desde codigo; su eliminacion se realiza manualmente en la configuracion del repositorio despues de fusionar el cambio.

## Decisions

### Eliminar los workflows en lugar de deshabilitarlos

Los archivos se eliminaran para retirar los triggers programados y `pull_request_target`, eliminar toda referencia a `API_TOKEN` y evitar configuracion muerta. Mantenerlos deshabilitados conservaria codigo y permisos sin un caso de uso activo.

### Mantener la gestion de Dependabot e issues como proceso manual

Dependabot puede continuar creando pull requests; su revision y merge los decide el mantenedor. Los issues tampoco se cerraran automaticamente por inactividad. Esto coincide con la operacion individual actual y elimina acciones irreversibles no supervisadas.

### Retirar el secreto despues de fusionar

La eliminacion del secreto se pospone hasta que los workflows retirados ya no existan en la rama activa. Es una accion administrativa externa a Git que debe hacerse desde GitHub cuando el cambio este fusionado.

## Risks / Trade-offs

- [Pull requests de Dependabot acumulados] → El mantenedor los revisa y fusiona o cierra manualmente.
- [Issues inactivos permanecen abiertos] → Se gestionan manualmente cuando afecten al backlog.
- [El secreto `API_TOKEN` queda almacenado innecesariamente] → Eliminarlo manualmente en GitHub tras fusionar y verificar que no quedan referencias.

## Migration Plan

1. Fusionar el cambio que elimina los dos workflows.
2. Confirmar en la pestaña Actions que no se programan nuevas ejecuciones de stale ni se activan acciones de auto-revision.
3. Eliminar `API_TOKEN` de los secretos del repositorio si existe.

Para rollback, restaurar los archivos de workflow y volver a crear o restaurar el secreto con los permisos requeridos. No se requieren migraciones de datos ni cambios de despliegue.
