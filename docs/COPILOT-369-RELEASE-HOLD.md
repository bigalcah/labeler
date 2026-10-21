# Copilot 369: release HOLD

La implementación v2 del pipeline y del contrato de release existe localmente en la rama de trabajo y sigue bajo
verificación. Esta excepción de congelación aprobada solo acota qué tres archivos del pipeline pueden cambiar; no es una
aprobación de producción, no acredita gates remotos y no levanta el HOLD.

## Excepción exacta de congelación

La línea base es `b409233`: los siete workflows y `deployment/docker-compose.release.yml` tienen sus hashes históricos
registrados en [`deployment/ci-pipeline-fingerprints.json`](../deployment/ci-pipeline-fingerprints.json). La excepción de
este cambio permite únicamente estos tres paths, con sus hashes anterior y actual fijados en ese manifiesto:

- `.github/workflows/release.yml`: `a5652aa72e65d49cafad76e807eddb1d801ee5ec6aad331e3e9b676e4dacb20b` -> `3f56829b4da5cd8dc923c973aa45886b05e6c57fd221c83400f93d6c8e41d9be`
- `.github/workflows/shared-validation.yml`: `18cbb8b5d4092cb16a7d962d269c23c9a2a03d1b974ee8e2dcaa86b1fc92035e` -> `6088383a4a0e82730f02829dd4a57af5e76411d9a0ecdb64b0896bd8dd6f4e86`
- `deployment/docker-compose.release.yml`: `e29073914a704bdaeef3845efadc1e8e1b802efba56b10f09e373daf19798a96` -> `fb6316592ff713692b9dd9ad9fc79df396c9f68ff3d277de6269717dc05e715d`

Los otros cinco workflows permanecen idénticos a `b409233`. `.github/CODEOWNERS` no existía en esa línea base; permanece
sin cambios en el estado actual y su fingerprint fijado es
`9c527527fdbb6da9f60bd6aaa6ca8cc7f2542f6c4604f3339ab92f60a1c40787`. La excepción no autoriza otros paths, patrones
wildcard, cambios de CODEOWNERS ni actualización automática de hashes.

Antes de cualquier merge a `master`, ejecutar literalmente y conservar la salida:

```bash
git diff --name-only origin/master...develop -- .github/workflows deployment/docker-compose.release.yml
```

Cualquier salida bloquea un merge ordinario. Solo el merge dedicado con aprobación explícita del usuario, revisión de
owner y paths/hashes exactamente iguales a la excepción auditada puede continuar; no se silencia el comando ni se
generaliza la excepción. La política no cambia la exigencia de revisión asignada por CODEOWNERS.

## HOLD operativo

El HOLD continúa hasta que se completen y revisen por separado todos los requisitos operativos aplicables:

- gates locales y CI remoto satisfactorios para el candidato exacto; una prueba unitaria local no acredita CI remoto;
- evidencia administrativa de branch protection, revisión de owner, freeze test requerido y pausa efectiva del
  environment `production`; el YAML local no demuestra que la configuración remota los aplique;
- adopción y verificación del launcher v2 en el host, y drenaje/exclusión verificables de operaciones v1 antes del primer
  uso del consumidor;
- elegibilidad real y lectura de solo lectura del estado de base de datos, junto con backup externo verificable y restore
  aislado satisfactorio cuando corresponda;
- aprobación explícita del operador para la operación concreta y, si aplica, autorización de mantenimiento/cutover;
- verificación del candidato desplegado, sus digests, runtime y smoke test antes de considerar cualquier cierre.

Los resultados de tests, imágenes locales, fixtures sintéticas o artefactos de planificación no demuestran protección
administrativa, adopción del host, estado de una base real, backup/restore ni despliegue público. Este cambio no realiza
esas operaciones, no afirma que exista evidencia remota o de producción y no autoriza publicación ni despliegue.

## Fuentes de tarjetas preservadas

La fuente Copilot 369 es `plans/copilot-369-cards.csv`, SHA-256
`fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb`. El CSV histórico de 300 conserva SHA-256
`4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef`; no se intercambian sus nombres, huellas ni
significado para hacer pasar un gate.
