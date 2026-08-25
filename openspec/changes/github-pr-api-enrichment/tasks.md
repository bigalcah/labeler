## 1. Baseline e aislamiento requerido

- [ ] 1.1 Añadir regresiones que prueben bootstrap/readiness, 300 `study_card`, checksum CSV y reimportación conflict-safe; no confiar en casillas incompletas del cambio MVP.
- [ ] 1.2 Añadir regresiones con tres participantes que prueben aislamiento de categorías, clasificaciones y descartes para la misma tarjeta.
- [ ] 1.3 Corregir cualquier fallo de 1.1 o 1.2 dentro de este cambio antes de integrar enriquecimiento.

## 2. Migración y ledger

- [ ] 2.1 Añadir `004_github_pr_api_enrichment` con runs, páginas, snapshots, manifests, promoción y relaciones de decisión.
- [ ] 2.2 Backfillear `study_id` de decisiones existentes como CSV-only y abortar ante pertenencia ausente o ambigua.
- [ ] 2.3 Añadir FKs compuestas de decisión a estudio, participante, tarjeta y run; impedir UPDATE/DELETE de promociones y runs terminales.
- [ ] 2.4 Registrar `004` después de `003` en el runner y verificar ledgers con y sin `002_retire_legacy_labeler`.
- [ ] 2.5 Verificar migración limpia, volumen existente, replay, fallo transaccional y esquema consumible por la imagen anterior en read-only.

## 3. Configuración y cliente GitHub

- [ ] 3.1 Implementar enablement explícito, aliases, routing exacto por repositorio, resolución de secretos y validación de permisos.
- [ ] 3.2 Garantizar que secretos solo llegan al proceso prepare y que logs, errores, fixtures y snapshots no contienen tokens.
- [ ] 3.3 Implementar timeout de 30 segundos, concurrencia 1-8, cuatro intentos y presupuestos de espera de cinco minutos por página y treinta por run.
- [ ] 3.4 Implementar los endpoints obligatorios y opcionales con clasificación terminal determinista.

## 4. Paginación, validators y normalización

- [ ] 4.1 Implementar paginación completa por `Link` para cada endpoint y registrar `COMPLETE_EMPTY` para listas vacías.
- [ ] 4.2 Persistir fingerprint, versión, `Accept`, ETag y checksums por página.
- [ ] 4.3 Implementar `304` solo contra la página exacta de un run completado y continuar con su `next`; rechazar baseline incompatible.
- [ ] 4.4 Añadir normalizadores deterministas y manifests canónicos por snapshot y run.
- [ ] 4.5 Descartar bodies crudos tras normalización y demostrar por prueba que no llegan a base, logs ni errores.
- [ ] 4.6 Cubrir cambios de página, cambios de paginación, ETags mixtos, respuesta sin ETag, diff truncado y respuesta malformada.

## 5. Orquestación y promoción

- [ ] 5.1 Crear el run para el checksum y las 300 membresías exactas del estudio.
- [ ] 5.2 Persistir staging invisible y marcar `FAILED` sin promoción ante cualquier endpoint obligatorio incompleto.
- [ ] 5.3 Reutilizar snapshots equivalentes por checksum sin duplicar contenido normalizado.
- [ ] 5.4 Completar y promover el run en transacción bajo lock solo con 300 snapshots y cero decisiones existentes.
- [ ] 5.5 Rechazar segunda promoción, promoción posterior a una decisión y run perteneciente a otro estudio o checksum.
- [ ] 5.6 Integrar migrate -> bootstrap -> enrich opcional -> server startup en el proceso prepare.

## 6. Proyección, decisiones y renderizado

- [ ] 6.1 Implementar la proyección aditiva sin actualizar `pr_cards` ni `study_card`, con precedencia y provenance por campo.
- [ ] 6.2 Añadir `study_id` y `enrichment_run_id` a las mutaciones de clasificación y descarte dentro de la misma transacción.
- [ ] 6.3 Verificar que todas las consultas de cola, progreso, tarjeta y decisión quedan limitadas al estudio y participante.
- [ ] 6.4 Renderizar secciones GitHub separadas y estados empty, unavailable y truncated sin mezclar evidencia CSV.
- [ ] 6.5 Probar sanitización de cuerpo, comentarios, reviews, timeline, nombres de archivo, diff y URLs GitHub.
- [ ] 6.6 Probar que navegador, rutas, plantillas y Socket.io no realizan solicitudes GitHub.

## 7. Operación y rollback

- [ ] 7.1 Documentar aliases, permisos mínimos, secret mounting, endpoints, presupuestos, estados, readiness y rerun.
- [ ] 7.2 Documentar que un estudio con decisiones no puede recibir una promoción posterior; el run capturado permanece inmutable pero no promocionado ni visible, y trasladar o reutilizar runs entre estudios queda fuera de alcance.
- [ ] 7.3 Actualizar el runbook para backup pre-004, rollback read-only con imagen anterior y restauración escribible en destino separado.
- [ ] 7.4 Ejecutar pruebas aisladas de base limpia, ledger `001,003`, ledger `001,002,003`, lote completo, fallo de tarjeta y preservación de decisiones.
- [ ] 7.5 Verificar la imagen anterior contra la base post-004 en read-only y verificar que cualquier intento de escritura falla.
- [ ] 7.6 Ejecutar lint focalizado, pruebas dirigidas, `openspec show` y validación estricta; registrar evidencia sin credenciales ni payloads privados reales.
