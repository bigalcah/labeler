## 1. Preparación del MVP

- [x] 1.1 Definir el contrato `PullRequestCard` y separar campos visibles de metadatos metodológicos.
- [x] 1.2 Seleccionar un parser CSV robusto y añadir únicamente las dependencias necesarias para el MVP.
- [x] 1.3 Crear la interfaz de proveedor de tarjetas y dejar el proveedor GitHub como implementación futura no activa.
- [x] 1.4 Crear un comando reproducible de importación CSV y documentar su ejecución local.

## 2. Persistencia de tarjetas y clasificaciones

- [x] 2.1 Crear tablas PostgreSQL para `pr_cards`, categorías privadas y clasificaciones.
- [x] 2.2 Añadir índices y restricciones de unicidad para `source_card_id`, categoría por participante y clasificación por PR/participante.
- [x] 2.3 Validar transaccionalmente que una categoría pertenece al participante que la utiliza.
- [x] 2.4 Crear carga de fixtures mínima y verificar creación del esquema en PostgreSQL limpio.

## 3. Importación del CSV real

- [x] 3.1 Leer el encabezado y los 300 registros lógicos del CSV, soportando campos multilinea, comillas escapadas y JSON incrustado.
- [x] 3.2 Convertir cada fila a `PullRequestCard`, conservando el payload original y distinguiendo valores vacíos.
- [x] 3.3 Extraer repositorio, número de PR, título, cuerpo, estado, autor, URL, lenguaje y fechas disponibles.
- [x] 3.4 Preparar secciones de resumen, evidencia y métricas desde las columnas del CSV sin exponer metadatos metodológicos por defecto.
- [x] 3.5 Hacer la importación idempotente por `card_id` y registrar errores por fila.
- [x] 3.6 Ejecutar la importación real y verificar exactamente 300 tarjetas sin duplicados.

## 4. Visualización de tarjetas PR

- [x] 4.1 Crear el partial EJS de tarjeta de PR y sustituir la visualización JSON genérica para el flujo nuevo.
- [x] 4.2 Mostrar título, repositorio, número, estado, autor, lenguaje del CSV, fechas, cuerpo y métricas disponibles.
- [x] 4.3 Mostrar evidencia seleccionada, comentarios y JSON original bajo demanda sin ejecutar HTML no confiable.
- [x] 4.4 Mostrar enlace externo a GitHub como referencia opcional, sin iframe ni consulta desde el navegador.
- [x] 4.5 Añadir estados vacíos para campos ausentes y tarjetas con evidencia incompleta.
- [x] 4.6 Verificar visualmente una muestra con cuerpos multilínea, Markdown, JSON incrustado y campos vacíos.

## 5. Clasificador local

- [x] 5.1 Mantener temporalmente `/login` como selector local de participantes y cargar su progreso.
- [x] 5.2 Crear y listar categorías planas únicamente para el participante seleccionado.
- [x] 5.3 Implementar advertencia de duplicados triviales sin fusionar automáticamente categorías diferentes.
- [x] 5.4 Cambiar el formulario a una sola categoría por PR y participante, con observación opcional.
- [x] 5.5 Implementar cola de tarjetas no clasificadas y entregar los mismos 300 PR a cada participante.
- [x] 5.6 Guardar clasificación y progreso de forma transaccional y reanudable.
- [x] 5.7 Impedir que las categorías, conteos o clasificaciones de otro participante aparezcan en la sesión actual.
- [x] 5.8 Añadir pantalla de progreso y estado de tarjeta pendiente/clasificada.
- [x] 5.9 Probar con tres participantes, incluyendo categorías con nombres similares y clasificación del mismo PR.

## 6. Preparación para GitHub posterior

- [x] 6.1 Documentar el contrato que deberá implementar el proveedor GitHub para completar las mismas secciones de tarjeta.
- [x] 6.2 Mantener `source_type` y campos de procedencia para distinguir CSV de futura API.
- [x] 6.3 Añadir fixtures de proveedor que demuestren que una tarjeta futura puede incorporar commits, archivos, diff y timeline sin cambiar la vista.
- [x] 6.4 No añadir todavía tokens, webhooks, worker de API ni llamadas de red durante la clasificación.

## 7. Verificación del avance

- [x] 7.1 Ejecutar lint JavaScript focalizado y corregir errores introducidos.
- [x] 7.2 Construir y levantar Docker con una base limpia y el dataset de demostración del MVP.
- [x] 7.3 Verificar que la aplicación responde y que el flujo selector → tarjeta → categoría → siguiente tarjeta funciona.
- [x] 7.4 Verificar que cada uno de tres participantes puede completar las 300 tarjetas sin compartir categorías.
- [x] 7.5 Documentar en README cómo importar el CSV y cómo ejecutar la demostración local.
- [x] 7.6 Dejar registradas como fases posteriores exportación, invitaciones, API GitHub, lenguajes por archivos, taxonomía y acuerdo.
