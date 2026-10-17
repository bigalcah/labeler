## Why

La muestra primaria debe reflejar la fuente completa de 369 PR únicos de Copilot, conservando la procedencia
verificable y los datos útiles para clasificar. El estudio de 300 no tiene clasificaciones que migrar; la transición
debe conservar las identidades de participantes y proteger todos los datos existentes del estudio de testing de 30
tarjetas.

## What Changes

- **BREAKING:** sustituir la fuente y el contrato de cardinalidad del estudio primario: pasar de 300 a 369 tarjetas, sin
  mantener ambas muestras como estudios primarios coexistentes. La fuente canónica será el CSV completo de 85 columnas,
  con checksum SHA-256 `fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb`.
- Mantener una transición explícita y protegida para el estudio primario. No desactivar globalmente las guardas contra
  cambios de fuente o checksum ni sobrescribir clasificaciones existentes.
- Conservar las mismas identidades, roles, hashes de contraseña y versiones de credenciales. El estudio de 30 tarjetas y
  todos sus datos, cuentas, membresía, enriquecimiento, fixture y manifest permanecen sin cambios y no se regeneran.
- Mantener los campos, secciones y flujo actuales de la interfaz, sin rediseño, métricas adicionales ni paneles de
  commits o timeline. Si un dato no existe, omitir el elemento correspondiente e informar al operador de los motivos e
  identificadores afectados; no inventar valores.
- Conservar sin cambios el flujo de categoría, descripción y observaciones, sin exigir `event_key` ni campos SHA nuevos.
  Los descartes continúan siendo privados según el comportamiento actual: no se importan ni se activan los 37 PR de
  reserva.
- Preservar el trabajo y la funcionalidad existentes de exportación comparativa; ajustar únicamente lo necesario para
  la nueva cardinalidad, sin restaurar el exportador offline.
- Mantener los siete archivos de `.github/workflows/` y `deployment/docker-compose.release.yml` byte por byte idénticos.
  Cualquier ajuste de empaquetado de datos quedará fuera de esos archivos y no rediseñará la canalización.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `github-pr-ingestion`: fuente canónica de 369 PR únicos, verificación de checksum y transición protegida sin pérdida
  de decisiones.
- `github-pr-explorer`: presentación de datos disponibles de la fuente completa, con la interfaz actual y sin fabricar
  datos ausentes.
- `study-management`: cardinalidad primaria de 369 y transición explícita que conserva identidades y deja intacto el
  estudio de 30.
- `private-open-card-sorting`: clasificación y descartes privados preservados durante la transición; el estudio
  ampliado mantiene una decisión por tarjeta y participante.

## Impact

El alcance comprende la preparación y validación de la fuente primaria, su carga y proyección a la tarjeta existente, la
presentación de datos y la cardinalidad del estudio y su clasificación. El estudio de validación de 30 tarjetas y la
exportación comparativa existente quedan protegidos. No se cambian dependencias ni se modifica la canalización CI/CD
congelada.

La validación compartida congelada todavía configura 300 tarjetas y el release calcula la huella del CSV anterior. Este
cambio no autoriza eludir esos contratos: la integración con esa canalización y la publicación de 369 quedan bloqueadas
mientras no exista compatibilidad demostrada o un cambio de canalización dedicado y aprobado. La validación aislada del
producto no se presentará como evidencia de release.
