# Copilot 369: tareas

Las secciones 0–6 registran la implementación inicial, incluido su rechazo de todo historial. No prueban que la
corrección autorizada el 21 de octubre de 2026 esté implementada. La sección 7 es el delta pendiente; mantiene el mismo
estudio y muestra objetivo. La configuración y ejecución real en VPS conservan sus gates operativos separados.

## 0. Preparación autorizada

- [x] 0.1 Antes de implementar, confirmar aprobación explícita y una rama feature basada en develop;
  preservar el trabajo local ajeno, incluida la exportación comparativa, sin moverlo ni descartarlo.

## 1. Fuentes y evidencia protegida

- [x] 1.1 `test/`: Crear fixture aislada de CSV 30/300, manifest y estado persistido; comparar fingerprints de
  cuentas, roles, hashes, versiones, IDs, memberships, `pr_card` compartidas, snapshots y timestamps, además
  de decisiones y descartes; probar preservación antes/después.
- [x] 1.2 `plans/copilot-369-cards.csv`: Generar copia byte por byte del CSV de 85 columnas y sidecar determinista;
  comprobar checksum fuente y manifiesto.
- [x] 1.3 `plans/`: Verificar que CSV histórico de 300, CSV/fixture y manifest de 30 mantienen bytes y checksum
  durante preparación.
- [x] 1.4 `deployment/server/Dockerfile`: Empaquetar la fuente 369 y su sidecar en rutas separadas; comprobar
  que la imagen conserva las fuentes protegidas y no depende del directorio externo de Descargas.

## 2. Validación y proyección de tarjetas

- [x] 2.1 Importador CSV: Validar checksum, cabecera 85 columnas, cardinalidad 369, unicidad, orden, IDs/URLs,
  número contra URL y JSON; entradas inválidas producen cero escrituras.
- [x] 2.2 Importador CSV: Mapear `pr_id` como cadena decimal idéntica a `source_card_id` y `source_pr_id`; probar
  las 369 identidades exactas.
- [x] 2.3 `card_v2`: Mapear user, repository_language, fechas, state y URL/número a campos actuales; probar
  valores y procedencia sin añadir paneles ni campos visibles.
- [x] 2.4 `card_v2`: Mapear reviews_json, pr_comments_json e inline_comments_json a secciones existentes;
  verificar autores, texto, eventos, URLs, timestamps y procedencia sin fabricar runs GitHub.
- [x] 2.5 Importador CSV: Distinguir JSON `[]` válido de ausente e inválido; JSON inválido aborta el lote y
  campos opcionales ausentes se omiten.
- [x] 2.6 Informe de importación: Reportar campo, PR, motivo, conteo y procedencia; omitir y reportar los 3
  lenguajes ausentes y `evidence_text` ausente en los 369.
- [x] 2.7 Vista de tarjeta: Mostrar solo campos actuales disponibles; probar omisiones, Markdown seguro, enlaces
  opcionales y uso sin GitHub, sin métricas, commits, timeline ni JSON completo.
- [x] 2.8 Vista de tarjeta: Comparar tarjetas históricas de 30 con fixture; contenido, disponibilidad y
  presentación permanecen idénticos.

## 3. Cardinalidad y preparación

- [x] 3.1 Migración nueva posterior a `013`: Admitir cardinalidades 30, 300 legacy y 369; no modificar
  migraciones `001` a `013` ni referencias históricas.
- [x] 3.2 Configuración de perfiles: Crear solo primario 369 y validación 30 en instalación nueva; comprobar
  descriptor, rutas y checksums exactos, reutilización del manifest de cuentas sin reset y rechazo de primaria
  300 o conteos no autorizados.
- [x] 3.3 Bootstrap/coordinador: Hacer la ruta existente de 30 estrictamente de lectura, sin bootstrap,
  provisionado, importación, enriquecimiento ni refresh.
- [x] 3.4 `test/`: Verificar que preparación/repetición de 30 no cambia datos, membresías, cuentas, snapshots,
  fixture, manifest, checksums ni timestamps.
- [x] 3.5 `test/`: Verificar que participantes reciben los mismos 369 PR en orden y 30 conserva sus 30 miembros
  y su orden.
- [x] 3.6 `test/`: Añadir regresión aislada del coordinador de preparación ordinaria sobre una primaria ya en
  369, primero sin decisiones y después con clasificaciones y descartes guardados; debe completar sin repetir
  el cutover ni invocar bootstrap, reprovisión, importación o enriquecimiento. Comparar fingerprints y timestamps
  antes/después para demostrar cero escrituras y conservación del progreso, credenciales y estudio de 30.

## 4. Cutover protegido en sitio

- [x] 4.1 Cutover primario: Exigir intención, ID/key, checksum/configuración y membresía antigua exactos, objetivo
  369 validado y cero decisiones, descartes o referencias históricas; discrepancias bloquean sin cambios.
  Historial o esquema desconocido también bloquea.
- [x] 4.2 Cutover primario: Exigir app, preparación y escritores de enriquecimiento detenidos; serializar con locks
  y revalidar precondiciones bajo locks.
- [x] 4.3 Cutover primario: Actualizar configuración y membresía en una transacción; preservar ID, cuentas,
  identidades, roles, hashes, versiones y membresías de participantes.
- [x] 4.4 Cutover primario: Reutilizar solo `pr_card` compatible sin cambios ni backfill; conflicto compartido o
  checksum nulo que exija backfill bloquea.
- [x] 4.5 Cutover primario: Prohibir detach, cascade, desactivar triggers y alterar historial; verificar rollback
  completo con error inyectado dentro de transacción.
- [x] 4.6 `test/`: Simular decisión concurrente durante preflight; demostrar bloqueo o serialización correcta,
  sin estado parcial ni decisión eludida.
- [x] 4.7 Cutover primario: Repetir sobre fuente 369 en modo lectura; demostrar cero escrituras, incluso en
  timestamps de auditoría.
- [x] 4.8 `test/`: Cubrir duplicado, malformación, agente/fuente errónea y drift de conteo; cada caso falla antes
  de escribir.

## 5. Flujo privado y exportación

- [x] 5.1 Clasificador y categorías: Verificar privacidad, definición, observaciones opcionales, edición,
  navegación y progreso actuales, sin campos `event_key` ni SHA nuevos.
- [x] 5.2 Clasificador: Verificar cola común de 369 para tres participantes y decisiones privadas sin reservas;
  30 conserva flujo y decisiones existentes.
- [x] 5.3 Credenciales: Probar hashes/roles/versiones y autenticación con secretos sintéticos clonados en fixture;
  no leer ni usar contraseñas reales.
- [x] 5.4 Comparación/exportación existente: Mantener elegibilidad, privacidad y formato; verificar 368 incompleto,
  369 completo y ausencia de exportador offline.

## 6. Verificación aislada y gate de publicación

- [x] 6.1 Pruebas aisladas: Ejecutar pruebas nuevas, por ejemplo `node --test test/copilot-369-*.test.js`;
  confirmar protecciones y rollback sin base real.
- [x] 6.2 Documentación de operación: Registrar fixtures, transiciones, verificaciones, omisiones y evidencia
  del operador; sin manejar secretos ni afirmar preflight real.
- [x] 6.3 Gate de publicación: Registrar que validación compartida exige 300 y release el CSV antiguo;
  bloquear CI, merge de release y producción.
- [x] 6.4 Verificación de congelación: Ejecutar `node --test test/ci-pipeline-freeze.test.js`; confirmar siete
  workflows y `deployment/docker-compose.release.yml` idénticos a `b409233`.
- [x] 6.5 Verificación local: Ejecutar `npm run lint:js`, markdownlint limitado a archivos tocados y
  `openspec validate "copilot-369-study-source" --strict`; no declarar tests inexistentes.
- [x] 6.6 QA manual aislado: Revisar en desktop y móvil omisiones, Markdown seguro, campos y presentación de 30;
  confirmar que no hay llamadas GitHub.
- [x] 6.7 Entrega: Mantener release HOLD hasta cambio dedicado aprobado; no tocar workflows/compose de release ni
  desplegar contra base real.

## 7. Corrección del cutover con historial GitHub conservado

- [x] 7.1 Reanudar mediante apply explícito de este cambio revisado y feature desde develop; preservar archivos ajenos
  y registrar el delta frente a la implementación inicial sin reutilizar sus checks como prueba de la corrección.
- [x] 7.2 Crear fixture PostgreSQL 17 desde el estado 013 con primaria 300 enriquecida, runs COMPLETED y FAILED con
  páginas parciales, y validación 30 con decisiones/descartes; capturar valores, identidades, timestamps y xmin protegidos.
- [x] 7.3 Añadir 016_preserve_study_card_history y sus contratos físicos/pins independientes sin editar 001–015:
  anclas permanentes, membresía por fuente, constraints e inmutabilidad; validar FKs antes de retirar las dos antiguas.
- [x] 7.4 Integrar la captura append-only de referencias durante inicialización/cutover y exigir pertenencia por fuente
  en nuevas páginas/mappings; conservar triggers terminales y rechazar runs RUNNING, orfandad y dependencias desconocidas.
- [x] 7.5 Corregir preflight y cutover para aceptar historial cerrado verificable, manteniendo cero decisiones/descartes,
  checksums y membresías exactos, locks y revalidación transaccional; preservar study_id, participantes y credenciales.
- [x] 7.6 Filtrar promociones/runs por la fuente activa en presentación, escritura de decisiones y exportación;
  probar que el historial 300 no contamina 369 y que la salida y decisiones de 30 no cambian.
- [x] 7.7 Actualizar productor, parsers, readiness, ledger y observador al contrato study-schema-4/copilot369-v1;
  preservar forma v2, cuatro hashes del bundle, doce claves de recibos/journal y lectura exacta de evidencia antigua.
- [ ] 7.8 Integrar 014/015 según origen físico real, checkpoint history_schema_verified tras 016 y continuación
  explícita bajo mantenimiento; exigir autorización fresca y backup/restore del baseline correcto, sin verbos SSH nuevos.
- [x] 7.9 Probar fallos y carreras antes/después de DDL y cutover, rollback íntegro, reconcile readonly, replay,
  continuación del candidato exacto y repetición sin escrituras; demostrar rechazo de una imagen schema-3 tras 016.
- [x] 7.10 Probar inicialización vacía autorizada y pareja schema-4 existente con decisiones; comparar preservación
  completa de historia primaria y estado original de 30, incluyendo xmin, y exactamente 369/30 miembros activos.
- [ ] 7.11 Corregir el checker documental aún fijado a 30/300, runbooks y pruebas de contrato sin modificar workflows,
  Compose release, fingerprints ni CODEOWNERS; ejecutar lint, freeze, suites completas y validación OpenSpec estricta.
- [ ] 7.12 Entregar la corrección para revisión con evidencia aislada y comandos de actualización del consumidor;
  instalación root, adopción, backup/restore y mantenimiento reales requieren ejecución y autorizaciones verificadas,
  y no se marcan completos por tests locales o por este plan.
