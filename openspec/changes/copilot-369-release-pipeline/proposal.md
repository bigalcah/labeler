# Pipeline de release Copilot 369

## Why

El pipeline de release todavía identifica el CSV histórico de 300 tarjetas, mientras el estudio aprobado requiere un
paquete reproducible para los perfiles de 369 y 30 tarjetas. Mantener el despliegue en HOLD hasta alinear validación,
manifiesto y preparación evita publicar una muestra o una recuperación incompatibles.

## What Changes

- Definir un paquete de release estricto y versionado que identifique las dos fuentes del estudio, sus sidecars y la
  compatibilidad de esquema y datos; rechazar entradas ambiguas o incompletas.
- Adaptar la validación compartida y el release para probar ambos perfiles con autenticación E2E acotada al estudio,
  verificar checksums y preservación de fixtures sintéticos, y producir evidencia de readiness. Los ensayos de cutover
  y decisiones usarán únicamente bases descartables; el release ordinario no ejecutará el cutover ni alterará el estado
  protegido de validación de 30.
- Actualizar el launcher y el entrypoint de preparación para validar el contrato nuevo, distinguir estudios existentes
  antes de migrar y conservar estado durable de compatibilidad previo a escrituras. Un fallo tardío o interrupción
  bloqueará una recuperación incompatible aunque `current` todavía señale el release anterior.
- Mantener el paquete de tres archivos y los secretos VPS fuera del artefacto; separar el cutover manual de 300 tarjetas
  del release ordinario. La preparación no cambia decisiones históricas ni elimina datos.
- Precisar el backup previo mediante un contrato externo de backup PostgreSQL completo y restore aislado, y la recuperación
  mediante recibos locales versionados, transiciones explícitas, reserva monotónica de generación y publicación reconciliable.
- Añadir una operación de mantenimiento externa, explícita y protegida para normalizar una base ya retirada cuyo catálogo
  no coincide físicamente con 014. La operación planificada agregará la FK canónica y retirará únicamente tres índices
  redundantes, sin modificar los datos ni las migraciones 001–014, y sin ejecutarse durante prepare ordinario.
- Reforzar la adopción del consumidor en host con exclusión de pushes y drenaje verificable de operaciones v1 antes del
  inventario de solo lectura; la ventana se mantiene hasta el primer candidato v2 validado.
- **BREAKING:** versionar el manifiesto externo consumido por el launcher, con adopción previa del consumidor y lectura
  estricta del historial anterior; productor, consumidor y pruebas de contrato migrarán de forma coordinada. No añadir
  dependencias ni rediseñar frameworks.
- El alcance futuro incluye `shared-validation.yml`, `release.yml`, `docker-compose.release.yml`, escritor del manifiesto,
  launcher, harness y gates de pruebas CI/E2E, sus contratos y fingerprints, documentación operativa y una actualización
  acotada de `AGENTS.md`. Los otros cinco workflows y los SHA pins existentes de los workflows afectados permanecen sin
  cambios, al igual que la frontera de secretos y la protección de master. La excepción de congelación exigirá
  aprobación explícita y evidencia auditable; no se elude el diff de control.
- Reconciliar las decisiones con `vps-cicd-deployment`, `release-clean-profile-package` y
  `freeze-master-cicd-pipeline`, sin editar esos cambios ni asumir que sus artefactos están sincronizados.
- La propuesta autoriza solo planificación. No levanta el HOLD: publicación en master y despliegue quedan sujetos a un
  apply futuro aprobado y a las evidencias y gates operativos explícitos.

## Capabilities

### New Capabilities

- `release-study-bundle`: manifiesto estricto y versionado para fuentes y sidecars del estudio, compatibilidad de
  esquema y datos, recuperación segura y adopción en host.
- `copilot-369-pipeline`: CI para perfiles 369 y 30, E2E autenticado y limitado por estudio, excepción controlada a la
  congelación, gates de master y evidencia de readiness.

### Modified Capabilities

- Ninguna. Las especificaciones principales actuales describen cuatro capacidades científicas; no se inventa una
  capacidad modificada ausente. Las capacidades de despliegue y congelación se documentarán como nuevas y se
  reconciliarán con los cambios no archivados indicados arriba.

## Impact

- Afecta los dos workflows señalados, compose de release, generador del manifiesto, launcher VPS y sus verificadores de
  solo lectura/estado, `scripts/prepare-study-deployment.sh`, `scripts/run-quality-gates.js`,
  `scripts/test-study-deployment.sh`, pruebas CI/integración/E2E y de congelación, y documentación y política acotadas
  durante un apply posterior.
- El apply posterior deberá añadir una migración externa 015 y su pin independiente en el contrato interno de
  normalización, validación readonly de elegibilidad/recuperación, una acción local de mantenimiento con alcance
  exclusivo de normalización y cobertura de regresión. 015 no se incorpora al conjunto gestionado automático 001–014;
  no añade claves al manifiesto, verbos SSH, workflows, dependencias ni archivos al paquete.
- La verificación futura debe cubrir ambos insumos y checksums, la preservación de fixtures sintéticos, una simulación
  realista en Linux equivalente a CI y los fallos de preparación/smoke tardíos con recuperación. La readiness de
  producción requiere evidencia explícita de backup verificable, adopción del launcher en host y elegibilidad del
  cutover por operador; una prueba local no sustituye esas evidencias.
- El manifiesto cambia de forma incompatible, por lo que el launcher y cualquier paquete previo deben tratarse mediante
  compatibilidad y adopción documentadas, sin asumir una disposición exacta de campos antes del diseño. El paquete sigue
  conteniendo solo tres archivos; credenciales, configuración y datos persistentes permanecen externos.
