# Copilot 369: release HOLD

El cambio `copilot-369-study-source` autoriza implementacion y verificacion aisladas.
No autoriza publicar la primaria de 369 con el contrato de release actual.

## Contratos incompatibles

- `.github/workflows/shared-validation.yml` genera una configuracion primaria con
  `expectedCardCount: 300`.
- `.github/workflows/release.yml` calcula la huella de
  `plans/merged_after_rework_cards_seed_20260510.csv`, no de la fuente de 369.
- `deployment/docker-compose.release.yml` conserva el contrato de release congelado.
- Empaquetar ambos CSV no cambia cual de ellos identifica el manifiesto de release.

La fuente de producto nueva es `plans/copilot-369-cards.csv`, con SHA-256
`fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb`.
El CSV historico de 300 conserva su SHA-256
`4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef`.
No deben intercambiarse sus nombres, huellas ni significado para hacer pasar CI.

## Gate obligatorio

La integracion con CI, el merge que publique en `master` y el despliegue de 369
permanecen en **HOLD** hasta disponer de un cambio OpenSpec dedicado, revisado y
aprobado explicitamente, que haga compatibles validacion, fuente, cardinalidad,
manifiesto y esquema. Su implementacion requiere su propio `/opsx-apply`.

Los siete workflows y `deployment/docker-compose.release.yml` deben permanecer
byte por byte iguales a `b409233` durante este cambio. No se modifican los
fingerprints ni se elude `test/ci-pipeline-freeze.test.js`.

Antes de cualquier merge a `master`, ejecutar literalmente:

```bash
git diff --name-only origin/master...develop -- .github/workflows deployment/docker-compose.release.yml
```

Debe producir salida vacia. Cualquier ruta detiene el merge; una salida vacia no
resuelve por si sola la incompatibilidad del contrato de datos descrita arriba.

## Limites de la evidencia

Las pruebas usan PostgreSQL descartable y credenciales sinteticas. Una imagen
local, un cutover de fixture o una prueba de navegador no demuestran elegibilidad
de una base real, respaldo verificable, restore ni despliegue publico.

No se han inspeccionado ni utilizado contrasenas reales. Este cambio no ejecuta
el cutover contra la base real, no prepara un manifiesto de release alternativo y
no ofrece una via de despliegue que evite los gates. La autorizacion general para
commits y merges no sustituye la aprobacion dedicada de la canalizacion.
