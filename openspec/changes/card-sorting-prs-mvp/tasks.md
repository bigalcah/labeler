## Estado

Las casillas reflejan trabajo verificado en la implementación actual, no solo decisiones documentadas. Las afirmaciones previas sobre importación manual, fixtures legacy e importación incondicional no se consideran completadas para este diseño.

## 1. Preparación y estructura

- [x] 1.1 Definir el contrato `PullRequestCard` y separar campos visibles de metadatos metodológicos.
- [x] 1.2 Seleccionar un parser CSV robusto y añadir únicamente las dependencias necesarias para el MVP.
- [x] 1.3 Crear la interfaz de proveedor de tarjetas y dejar el proveedor GitHub como implementación futura no activa.
- [x] 1.4 Crear un comando reproducible de importación CSV y documentar su ejecución local.
- [x] 1.5 Añadir migraciones para `study`, `study_participant` y `study_card` sin sembrar `label` o `instance` legacy.
- [x] 1.6 Añadir restricciones e índices para membresía, IDs fuente y clasificación única junto a las restricciones ya existentes.
- [x] 1.7 Documentar el retiro escalonado de `reviewer` y de los objetos legacy, sin eliminarlos.

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
- [x] 4.4 Añadir estados vacíos explícitos para campos ausentes y tarjetas con evidencia incompleta.
- [x] 4.5 Mantener temporalmente `/login` como selector local y cargar el progreso del participante seleccionado.
- [x] 4.6 Crear y listar categorías planas únicamente para el participante seleccionado.
- [x] 4.7 Permitir renombrar una categoría propia sin exponer ni modificar categorías de otro participante.
- [x] 4.8 Guardar una sola clasificación por PR y participante con observación opcional, de forma transaccional y reanudable.
- [ ] 4.9 Entregar la cola desde `study_card`, aislar categorías, conteos y respuestas, y recuperar progreso por membresía.
- [ ] 4.10 Verificar tres participantes con categorías similares, clasificación del mismo PR y aislamiento completo.

## 5. GitHub posterior y verificación

- [x] 5.1 Documentar el contrato que deberá implementar el proveedor GitHub para completar las mismas secciones de tarjeta.
- [x] 5.2 Mantener `source_type` y campos de procedencia para distinguir CSV de futura API.
- [x] 5.3 No añadir todavía tokens, webhooks, worker de API ni llamadas de red durante la clasificación.
- [x] 5.4 Añadir fixtures de proveedor que demuestren que una tarjeta futura puede incorporar commits, archivos, diff y timeline sin cambiar la vista.
- [x] 5.5 Ejecutar lint JavaScript focalizado y corregir errores introducidos.
- [ ] 5.6 Verificar build, readiness, bootstrap y flujo selector → tarjeta → categoría → siguiente tarjeta.
- [ ] 5.7 Verificar que cada participante recibe exactamente 300 tarjetas y no ve datos ajenos.
- [ ] 5.8 Construir y levantar Docker con una base limpia y un volumen existente, verificando importación, reinicio y conflictos.
- [x] 5.9 Documentar en README cómo importar el CSV y cómo ejecutar la demostración local.
- [x] 5.10 Dejar registradas como fases posteriores exportación, invitaciones, API GitHub, lenguajes por archivos, taxonomía y acuerdo.

## 6. Base comprobable y autenticación

- [x] 6.1 Separar la fábrica de aplicación del arranque del proceso, con dependencias inyectables para base de datos, sesiones, reloj y logs. La importación de la fábrica no debe abrir puertos ni crear artefactos operativos; pruebas HTTP deben cubrir middleware, salud, errores y cierre limpio antes de usarla en el resto del trabajo.
- [x] 6.2 Reparar los gates de calidad y definir una suite única de lint, pruebas unitarias, integración y E2E. Cada gate debe fallar con un mensaje accionable cuando falten prerrequisitos y nunca reportar éxito por omitir pruebas; conservar evidencia de los comandos y códigos de salida.
- [x] 6.3 Añadir la migración de cuentas locales y sesiones opacas PostgreSQL, ligada a la membresía del estudio y sin contraseñas en `reviewer`. Probar orden, idempotencia, claves foráneas, unicidad por estudio, expiración indexada y rechazo de cuentas que no sean miembros.
- [x] 6.4 Validar configuración de producción y secretos desde archivos, incluyendo origen HTTPS, cookie `__Host-`, saltos de proxy aplicados al servidor, rotación de secretos y los TTL de sesión de 8 horas de inactividad y 24 horas absolutas. El arranque debe fallar de forma sanitizada ante valores ausentes o débiles, con pruebas que demuestren que ningún secreto aparece en mensajes y que el secreto de sesión realmente firma y valida la cookie.
- [x] 6.5 Implementar generación, provisión y reset operativo de credenciales Argon2id. La contraseña debe entrar solo por stdin o descriptor y el hash debe escribirse directamente en un manifiesto protegido, nunca en argv, stdout, stderr o logs. El provisionador debe leer el manifiesto desde un archivo secreto de solo lectura o descriptor, ejecutarse después de crear o reutilizar `study_participant`, insertar solo cuentas ausentes, preservar hashes y versiones existentes y reservar cualquier cambio de credencial para el reset explícito.

## 7. Sesión, acceso y privacidad

- [x] 7.1 Integrar middleware de sesiones PostgreSQL con cookies Secure, HttpOnly y SameSite=Lax, sin `MemoryStore`, y con identificador firmado mediante el secreto de sesión. Cada solicitud protegida debe recargar cuenta y membresía, validar habilitación, versión, expiración idle de 8 horas y máximo absoluto de 24 horas, aplicar el proxy confiable a la IP efectiva y rechazar fallos del store sin filtrar datos.
- [x] 7.2 Implementar login con dummy verify para usuarios inexistentes, límites persistentes de 5 fallos por cuenta y 20 intentos por IP en 15 minutos, desbloqueo temporal, regeneración de SID y respuestas no enumerables. Las pruebas deben cubrir éxito, credencial inválida, cuenta inexistente o deshabilitada, `429` con `Retry-After`, entradas de contraseña no textuales o ausentes y ausencia de sesión autenticada tras el límite.
- [x] 7.3 Sustituir el selector local por una interfaz accesible de login y logout. El login debe ser público y protegido contra CSRF; logout debe ser exclusivamente POST, destruir la sesión y limpiar la cookie; pruebas HTTP y de navegador deben demostrar que no se listan reviewers ni IDs internos.
- [x] 7.4 Migrar todas las operaciones de estudio a rutas canónicas derivadas de la sesión validada, sin nombres de participante en URL, query o formulario, preservando navegación por ordinal, exclusión privada de clasificaciones y descartes, continuación `303` y cola vacía. Probar que las rutas antiguas devuelven 404 y que una sesión no puede cambiar el estudio o participante mediante identificadores suministrados por el cliente.
- [x] 7.5 Proteger todas las mutaciones con tokens CSRF synchronizer ligados y rotados con la sesión, validación timing-safe y comprobación de Origin. Añadir CSP compatible con las vistas, eliminar scripts inline y `onsubmit`, corregir los clientes de integración para enviar Origin y CSRF válidos, y probar tokens ausentes, inválidos, cruzados, rotados y orígenes hostiles sin mutación en PostgreSQL.
- [x] 7.6 Permitir renombrar categorías solo dentro de la cuenta autenticada, con normalización, control de propiedad, preservación de clasificaciones y protección CSRF. Probar nombre duplicado, categoría ajena y participación concurrente, sin aceptar un `participant_id` del cliente.

## 8. Bootstrap y flujo privado

- [ ] 8.1 Hacer que la preparación one-shot espere una base saludable, valide configuración, CSV y manifiesto antes de escribir, aplique migraciones aditivas y ejecute una sola transacción que cree o reutilice estudio, tarjetas y `study_participant`, provisione después las cuentas ausentes y valide todas las cuentas antes de confirmar `READY`. La aplicación debe depender del éxito de la preparación actual y Caddy solo debe arrancar después de la readiness interna; probar clean y existing con rollback completo del intento y preservación de cuentas, credenciales, tarjetas y clasificaciones existentes.
- [x] 8.2 Completar los estados vacíos e incompletos de tarjetas y evidencia sin inventar valores ni ejecutar HTML no confiable. Fixtures y pruebas deben distinguir presente, vacío, no disponible, truncado e incompleto y conservar el contrato de la vista.
- [ ] 8.3 Encapsular cola, categorías, clasificaciones, descartes y progreso en un servicio de estudio y repositorios privados. Todas las consultas deben filtrar por `study_id` y `participant_id` de sesión, mantener transacciones y demostrar con pruebas que `CLASSIFIED` tiene una sola categoría y que cada participante recibe sus 300 tarjetas.
- [ ] 8.4 Añadir fixtures sanitizados del proveedor con metadata, commits, archivos, diff y timeline, incluidos estados vacíos y truncados, sin tokens, correos ni red. Probar que normalización y proyección alimentan la misma vista y que la clasificación no realiza llamadas GitHub en runtime.
- [ ] 8.5 Reconciliar el retiro legacy con el contrato aprobado: clean debe fallar ante objetos legacy sin eliminarlos, existing debe exigir backup externo verificable antes de cualquier retiro permitido, y el inventario debe conservar reviewer mientras existan referencias. Pruebas de allowlist, idempotencia y rollback deben confirmar ausencia de SQL destructivo no autorizado.
- [x] 8.6 Añadir una regresión visual del badge de ciclo de vida para `OPEN`, `CLOSED`, `MERGED` y `UNAVAILABLE`, con texto siempre visible, distinción que no dependa solo del color, contraste WCAG AA y verificación responsive en navegador.

## 9. Borde público y operación VPS

- [ ] 9.1 Configurar Caddy como único borde público con TLS, redirección HTTP a HTTPS y proxy hacia la aplicación en red interna. La configuración debe publicar solo 80/443, bloquear actuator externamente y demostrar con Compose, sockets y solicitudes reales que no se exponen 3000, 7755 ni 5432. Caddy no debe iniciar ni publicar puertos basándose únicamente en un `READY` persistido; debe depender de la preparación actual completada y del health interno de la aplicación. El Compose debe incluir el manifiesto de cuentas y toda la configuración productiva requerida por la aplicación.
- [ ] 9.2 Aplicar headers de seguridad, CSP, Referrer-Policy, HSTS solo bajo HTTPS productivo y no-cache en login y respuestas privadas. Pruebas de headers y navegador deben mostrar ausencia de violaciones CSP, sin relajar la política con `unsafe-eval`.
- [x] 9.3 Endurecer la imagen Node LTS y los servicios: versión fijada, instalación reproducible sin dependencias de desarrollo, copia completa de los módulos runtime incluida `app.js`, usuario no root, capacidades retiradas, filesystem de solo lectura con temporales controlados, límites de recursos y healthchecks internos. Inspección de imagen y Compose debe aportar evidencia y rechazar `latest`.
- [x] 9.4 Migrar secretos a secretos montados o archivos `*_FILE`, mantener valores no secretos fuera de los archivos de secretos y redactar cookies, contraseñas, CSRF y tokens en logs. Probar permisos, arranque, rotación y solicitudes maliciosas sin que el contenido sensible aparezca en stdout o stderr.
- [ ] 9.5 Automatizar backup externo cifrado con manifiesto, checksum y retención documentada, incluyendo cuentas según la política aprobada. Ejecutar un restore en una base aislada, comparar tarjetas, clasificaciones y versiones de credenciales, y demostrar que no se escribe en el volumen de producción.
- [x] 9.6 Completar la pipeline de PR con jobs obligatorios para lint completo, suite unitaria, validación OpenSpec, comprobación de Compose/Dockerfile y gates de integración/E2E cuando exista un runtime efímero. La pipeline debe conservar códigos de salida, rechazar skips silenciosos y no exponer secretos.

## 10. Evidencia de cierre

- [ ] 10.1 Construir un harness de pruebas para clean y existing con proyectos, puertos y volúmenes aislados. Verificar bootstrap, reinicio, preservación de clasificaciones, cuentas, checksums y rechazo cerrado de drift o backup inválido, sin tocar recursos persistentes del usuario.
- [ ] 10.2 Ejecutar una prueba E2E hostil con tres sesiones independientes, las mismas 300 tarjetas y categorías similares. Intentar acceso cruzado mediante URL, IDs, query, formularios, CSRF y cookies, y comprobar en HTML, respuestas, logs y PostgreSQL que no hay filtración ni mutación ajena.
- [ ] 10.3 Ejecutar el E2E completo en el VPS público: TLS, login, categoría, renombrado, clasificación, descarte, siguiente tarjeta, progreso y logout, además de reinicios y conflictos clean/existing. La evidencia debe demostrar readiness, cookies, headers, límites y exposición exclusiva de 80/443, sin skips.
- [ ] 10.4 Actualizar documentación y estado del cambio únicamente después de reunir evidencia de cada tarea. Verificar que README, seguridad, arquitectura, operaciones, desarrollo y OpenSpec describen el mismo contrato, y mantener abiertas las tareas que no tengan pruebas o evidencia runtime.
- [x] 10.5 Añadir limpieza acotada de contextos CSRF, intentos por IP y sesiones expiradas, además de shutdown ordenado de servidor, pool y logs. Probar que el mantenimiento no elimina sesiones activas ni filtra secretos.
- [x] 10.6 Sustituir la construcción insegura de HTML en el resaltado cliente por nodos/texto escapados y añadir una regresión de navegador para contenido GitHub controlado por el usuario.
