## Estado

Las casillas reflejan trabajo verificado en la implementación actual, no solo decisiones documentadas. Las afirmaciones previas sobre importación manual, fixtures legacy e importación incondicional no se consideran completadas para este diseño.

## 1. Preparación y estructura

- [x] 1.1 Definir el contrato `PullRequestCard` y separar campos visibles de metadatos metodológicos.
- [x] 1.2 Seleccionar un parser CSV robusto y añadir únicamente las dependencias necesarias para el MVP.
- [x] 1.3 Crear la interfaz de proveedor de tarjetas y dejar el proveedor GitHub como implementación futura no activa.
- [x] 1.4 Crear un comando reproducible de importación CSV y documentar su ejecución local.
- [x] 1.5 Añadir migraciones para `study`, `study_participant` y `study_card` sin sembrar `label` o `instance` legacy.
- [x] 1.6 Añadir restricciones e índices para membresía, IDs fuente y clasificación única junto a las restricciones ya existentes.
- [ ] 1.7 Documentar el retiro escalonado de `reviewer` y de los objetos legacy, sin eliminarlos.

## 2. Configuración y bootstrap

- [x] 2.1 Leer configuración JSON con `studyKey`, `expectedCardCount` y `participants`, usando fallback local de tres.
- [x] 2.2 Implementar precedencia: estudio activo persistido, configuración explícita para estudio nuevo y fallback local; fallar ante drift sin borrar.
- [ ] 2.3 Implementar bootstrap one-shot después de salud de base y antes de readiness web.
- [x] 2.4 Reutilizar o crear reviewers y persistir `study_participant` con orden estable.
- [x] 2.5 Crear `study_card` para exactamente las mismas 300 tarjetas de cada participante.
- [x] 2.6 Hacer rollback atómico ante cualquier fallo y no ejecutar eliminación automática.

## 3. Importación CSV conflict-safe

- [x] 3.1 Leer el encabezado y los registros lógicos del CSV, soportando campos multilinea, comillas escapadas y JSON incrustado.
- [x] 3.2 Convertir cada fila a `PullRequestCard`, conservando el payload original y distinguiendo valores vacíos.
- [x] 3.3 Extraer repositorio, número de PR, título, cuerpo, estado, autor, URL, lenguaje y fechas disponibles.
- [x] 3.4 Preparar secciones de resumen, evidencia y métricas desde las columnas del CSV sin exponer metadatos metodológicos por defecto.
- [x] 3.5 Validar el archivo completo antes de escribir: campos requeridos, JSON, IDs únicos, checksum y conteo exacto de 300.
- [x] 3.6 Mantener importación local idempotente por `card_id` y registrar errores por fila sin duplicar tarjetas.
- [x] 3.7 Reutilizar solo filas canónicamente idénticas y fallar ante un `source_card_id` cambiado; no sobrescribir datos clasificados.
- [x] 3.8 Ejecutar la importación local y verificar exactamente 300 tarjetas sin duplicados.
- [ ] 3.9 Ejecutar y verificar el bootstrap real en volumen limpio y existente, incluyendo preservación de clasificaciones.

## 4. Tarjetas y clasificador

- [x] 4.1 Renderizar la tarjeta PR con título, repositorio, número, estado, autor, lenguaje del CSV, fechas, cuerpo y métricas.
- [x] 4.2 Mostrar evidencia seleccionada, comentarios y JSON original bajo demanda sin ejecutar HTML no confiable.
- [x] 4.3 Mostrar enlace externo a GitHub como referencia opcional, sin iframe ni consulta desde el navegador.
- [ ] 4.4 Añadir estados vacíos explícitos para campos ausentes y tarjetas con evidencia incompleta.
- [x] 4.5 Mantener temporalmente `/login` como selector local y cargar el progreso del participante seleccionado.
- [x] 4.6 Crear y listar categorías planas únicamente para el participante seleccionado.
- [ ] 4.7 Permitir renombrar una categoría propia sin exponer ni modificar categorías de otro participante.
- [x] 4.8 Guardar una sola clasificación por PR y participante con observación opcional, de forma transaccional y reanudable.
- [ ] 4.9 Entregar la cola desde `study_card`, aislar categorías, conteos y respuestas, y recuperar progreso por membresía.
- [ ] 4.10 Verificar tres participantes con categorías similares, clasificación del mismo PR y aislamiento completo.

## 5. GitHub posterior y verificación

- [x] 5.1 Documentar el contrato que deberá implementar el proveedor GitHub para completar las mismas secciones de tarjeta.
- [x] 5.2 Mantener `source_type` y campos de procedencia para distinguir CSV de futura API.
- [x] 5.3 No añadir todavía tokens, webhooks, worker de API ni llamadas de red durante la clasificación.
- [ ] 5.4 Añadir fixtures de proveedor que demuestren que una tarjeta futura puede incorporar commits, archivos, diff y timeline sin cambiar la vista.
- [x] 5.5 Ejecutar lint JavaScript focalizado y corregir errores introducidos.
- [ ] 5.6 Verificar build, readiness, bootstrap y flujo selector → tarjeta → categoría → siguiente tarjeta.
- [ ] 5.7 Verificar que cada participante recibe exactamente 300 tarjetas y no ve datos ajenos.
- [ ] 5.8 Construir y levantar Docker con una base limpia y un volumen existente, verificando importación, reinicio y conflictos.
- [x] 5.9 Documentar en README cómo importar el CSV y cómo ejecutar la demostración local.
- [x] 5.10 Dejar registradas como fases posteriores exportación, invitaciones, API GitHub, lenguajes por archivos, taxonomía y acuerdo.
