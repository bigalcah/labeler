# Validación CI y gobernanza de release Copilot 369

## Purpose

Definir gates reproducibles para validar los estudios Copilot 369 y 30, proteger sus datos y decisiones de prueba, y
gobernar cualquier futura publicación en `master` sin exponer credenciales ni permitir que un fallo, una omisión o una
excepción de congelación habilite un release.

## ADDED Requirements

### Requirement: Push master SHALL usar el despliegue delegado

La revisión aprobada del 21 de octubre de 2026 SHALL sustituir backup/restore y cutover manual previo
como gates del modo automático. El workflow master existente SHALL seguir invocando deploy SSH tras
calidad, publicación y aprobación production, sin script manual por candidato ni cambios congelados.
Las pruebas SHALL verificar política, ausencia de backup/restore, origen histórico, pareja readonly
y conservación de 30. La instalación inicial privilegiada no SHALL presentarse como deploy completado.

#### Scenario: Candidato validado en master

- **WHEN** el deploy recibe el candidato validado y una política root vigente
- **THEN** completa los pasos conocidos y health/smoke sin exigir backup/restore externo

#### Scenario: Gate fallido o identidad divergente

- **WHEN** falla calidad, fingerprint, identidad, estado o preservación
- **THEN** no publica éxito ni omite controles para continuar

### Requirement: CI SHALL validar los perfiles canónicos 369 y 30 en orden

El gate SHALL validar `pr-card-sorting-local` con las 369 tarjetas de la fuente Copilot canónica, sidecar y checksums, y
`pr-card-sorting-validation-30` con sus 30 tarjetas y fuentes protegidas. SHALL procesarlos en orden 369 y después 30.
El CSV histórico de 300 no SHALL ser perfil ordinario ni fallback. El contrato y la forma del paquete corresponden a
`release-study-bundle`.

#### Scenario: Fuentes válidas

- **WHEN** el gate recibe fuentes, sidecars y checksums válidos para ambos perfiles
- **THEN** comprueba conteos exactos de 369 y 30, primero 369
- **THEN** acepta el par solo después de completar ambas validaciones

#### Scenario: Fuente histórica como perfil ordinario

- **WHEN** se presenta el CSV histórico de 300 como fuente primaria
- **THEN** la validación falla, identifica el perfil o fuente rechazada y no cambia a fallback

#### Scenario: Checksum incorrecto o sidecar ausente

- **WHEN** cualquiera de los perfiles tiene checksum distinto o carece de sidecar requerido
- **THEN** el gate falla y no habilita etapas posteriores

### Requirement: CI SHALL usar identidades sintéticas independientes y seis logins

CI SHALL preparar un manifiesto sintético independiente por estudio y tres cuentas en cada uno. El perfil 369 SHALL usar
`javier`, `diego`, `pablo`; el perfil 30 SHALL usar `javier-30`, `diego-30`, `pablo-30`. Credenciales en claro serán
efímeras y no aparecerán en logs ni artefactos. El enriquecimiento SHALL estar deshabilitado y CI SHALL funcionar sin
token GitHub real ni solicitudes de runtime a GitHub.

#### Scenario: Preparación de cuentas

- **WHEN** CI prepara ambos perfiles en un runner limpio
- **THEN** produce dos manifiestos distintos con exactamente seis identidades asignadas al estudio correspondiente
- **THEN** no se exponen credenciales en claro en salida, logs o artefactos

#### Scenario: Enriquecimiento habilitado o token real requerido

- **WHEN** la configuración habilita enriquecimiento o una operación requiere token GitHub real
- **THEN** la validación falla sin realizar solicitudes ni leer secretos GitHub

### Requirement: La identidad y membresía de pruebas SHALL derivarse del estudio autorizado

Toda semilla de cuentas, tarjetas, categorías y sesiones SHALL vincularse a un estudio explícito; la identidad de runtime
procederá de la cuenta o sesión de servidor, nunca del cliente ni del sufijo del username. Antes de mutaciones, CI SHALL
comprobar las mismas tarjetas exactas y en orden canónico para todos los participantes del estudio. Las reservas de
tarjetas SHALL ser disjuntas entre casos que no deban interferir, pero las pruebas de concurrencia y de respuestas
privadas sobre un mismo PR SHALL compartir deliberadamente la tarjeta correspondiente. SHALL preparar tres sesiones
privadas por estudio sin compartir cookies o CSRF.

#### Scenario: Membresía canónica completa

- **WHEN** se inicializan las tarjetas de ambos perfiles
- **THEN** se verifica para cada participante la membresía completa, su orden y su `study_id` autorizado
- **THEN** tarjeta ausente, adicional, desordenada o cruzada hace fallar el gate

#### Scenario: Mutaciones separadas

- **WHEN** CI clasifica, descarta o navega con cuentas sintéticas
- **THEN** cada caso usa reservas con propósito explícito, las carreras compiten por la tarjeta prevista y distintos
  participantes pueden responder al mismo PR sin alterar respuestas ajenas

#### Scenario: Intento de escoger estudio por cliente

- **WHEN** la prueba envía otro `study_id` o interpreta `-30` como selector
- **THEN** prevalece la identidad autenticada del servidor y el cruce falla sin modificar el otro estudio

### Requirement: E2E SHALL cubrir el flujo autenticado real de ambos estudios

Una consulta exitosa a `/actuator/health` no acredita E2E. El gate SHALL iniciar sesión en cada estudio y cubrir
definición de categoría privada, notas opcionales, edición, clasificación, descarte, navegación, progreso, elegibilidad
de exportación y logout. Operaciones mutantes SHALL comprobar CSRF y origen same-origin cuando corresponda. Los
contratos funcionales específicos del paquete quedan en `release-study-bundle` y las capacidades del producto.

#### Scenario: Recorrido autenticado 369

- **WHEN** el usuario sintético 369 inicia sesión y crea categoría privada
- **THEN** guarda notas opcionales, edita decisión, clasifica, descarta, navega y ve progreso consistente sin filtrar
  estado ajeno
- **THEN** el gate comprueba elegibilidad de exportación y cierra la sesión

#### Scenario: Recorrido autenticado 30

- **WHEN** la cuenta `-30` ejecuta el recorrido equivalente
- **THEN** todas las operaciones y elegibilidad quedan limitadas a 30 tarjetas
- **THEN** logout invalida sesión y una petición posterior no entrega datos privados

#### Scenario: E2E incompleto o solo health

- **WHEN** solo se consulta health o falta una operación requerida
- **THEN** el gate falla o queda incompleto y no se acepta como evidencia E2E

#### Scenario: Borde HTTPS equivalente a producción

- **WHEN** el recorrido usa el borde HTTPS de CI
- **THEN** `/login` responde correctamente, `/actuator` y sus subrutas responden 404 externamente y la salud interna se
  comprueba por separado
- **THEN** cookies Secure, HttpOnly y SameSite y los controles de origen y CSRF mantienen sus contratos sin relajar
  Caddy ni la aplicación

#### Scenario: Exportación con una decisión pendiente

- **WHEN** el solicitante solo ha terminado 368 de sus 369 tarjetas aunque otro participante esté completo
- **THEN** la descarga se rechaza sin CSV ni respuestas ajenas, sin redondear el progreso a completo

#### Scenario: Exportación comparativa completa

- **WHEN** el solicitante y al menos otro participante completan las 369 tarjetas en una fixture aislada
- **THEN** la descarga contiene 369 filas y 8 u 11 columnas según haya dos o tres participantes completos,
  conservando privacidad y ordinales
- **THEN** el perfil 30 aplica su propio límite de 30 sin mezclar resultados

#### Scenario: CSRF u origen inválidos

- **WHEN** se intenta una mutación sin CSRF válido o desde origen hostil
- **THEN** se rechaza y el gate verifica que no se guardó ningún cambio

### Requirement: CI SHALL preservar la muestra protegida de 30

Los gates SHALL capturar evidencia verificable antes y después de validaciones y ensayos. La preparación ordinaria SHALL
ser de solo lectura sobre el estudio existente de 30, sin reprovisión, refresh ni escrituras. Las pruebas funcionales
mutantes y ensayos de cutover SHALL usar únicamente bases descartables, separando el recorrido funcional de la ventana
de preservación entre releases. Los fingerprints SHALL cubrir IDs, participantes, membresías, orden, tarjetas,
categorías, clasificaciones, descartes, snapshots, cuentas, habilitación, hashes y versiones de credenciales, checksums
y todos los timestamps persistentes del estudio. Solo se excluirán sesiones y actividad transitoria de autenticación
documentadas; nunca se excluirán timestamps persistentes de estudio, categorías, tarjetas o decisiones. Los recibos no
contendrán contenido sensible.

#### Scenario: Release ordinario

- **WHEN** CI registra fingerprints antes y después
- **THEN** fingerprints comparables de tarjetas, membresía y snapshots preservados son idénticos y no hubo escrituras
  persistentes

#### Scenario: Ensayo mutante o cutover aislado

- **WHEN** una prueba simula cambios o cutover
- **THEN** usa base descartable con identidad distinta y evidencia de cero escrituras al estado protegido

#### Scenario: Drift detectado

- **WHEN** fingerprints protegidos difieren
- **THEN** el gate falla, guarda evidencia redactada y bloquea publicación y despliegue

### Requirement: Fallos, omisiones y cancelaciones SHALL bloquear todas las etapas dependientes

Gates de calidad, contrato, aislamiento, integración, E2E, preservación y política serán obligatorios. Fallo,
cancelación, omisión, prerrequisito ausente, comando no ejecutado o código distinto de cero SHALL bloquear build,
publicación y despliegue. Los trabajos requeridos no SHALL usar `always()` ni `continue-on-error` para continuar;
`always()` solo podrá diagnosticar o limpiar sin ocultar resultado. No se permiten reintentos que escondan fallos ni
skips silenciosos. La flakiness se corregirá reproduciendo la selección unitaria completa con concurrencia de navegador
secuencial y acotada, sin relajar aserciones ni eliminar tests.

#### Scenario: Gate fallido

- **WHEN** falla lint, pruebas, contrato, integración, E2E o preservación
- **THEN** el estado global falla y build, publicación y despliegue dependientes no se ejecutan

#### Scenario: Gate omitido, cancelado o sin prerrequisito

- **WHEN** un gate falta, se cancela o carece de prerrequisito
- **THEN** la ejecución no se marca satisfactoria ni publica ni despliega

#### Scenario: Fallo oculto

- **WHEN** se añade condición de omisión, `continue-on-error` o reintento que descarta el fallo inicial
- **THEN** el contrato de CI rechaza la configuración o ejecución

#### Scenario: Reproducción de flakiness

- **WHEN** se reproduce el conjunto unitario completo con concurrencia secuencial y acotada
- **THEN** la falla permanece visible hasta corregir su causa, sin reducir cobertura ni aserciones

### Requirement: CI SHALL aislar runtimes y reportar limpieza verificable

Cada ejecución SHALL poseer contenedores, redes, volúmenes y puertos loopback propios y usar datos sintéticos, sin acceso
a datos reales ni puertos públicos para PostgreSQL o servidor. La limpieza se intentará incluso ante fallo, pero solo
será éxito con recibos verificables de recursos removidos. Limpieza fallida o no confirmada SHALL quedar como fallo o
cancelación no confirmada, con diagnóstico redactado. Logs, artefactos públicos y diagnósticos no SHALL exponer
cookies, tokens, contraseñas, CSRF ni payloads de hashes de credenciales.

#### Scenario: Ejecuciones simultáneas

- **WHEN** dos ejecuciones comparten runner o entorno
- **THEN** nombres, redes, volúmenes y puertos loopback no colisionan ni permiten leer o eliminar recursos ajenos

#### Scenario: Limpieza verificada

- **WHEN** la limpieza elimina todos los recursos asignados
- **THEN** recibos identifican recursos y confirman su ausencia sin datos sensibles

#### Scenario: Fallo o interrupción de limpieza

- **WHEN** no puede verificarse la eliminación o una cancelación impide confirmarla
- **THEN** estado queda fallido o cancelado no confirmado, conserva diagnósticos redactados y nunca informa éxito

### Requirement: Los cambios del pipeline SHALL respetar la congelación y su excepción acotada

El conjunto congelado consta exactamente de los siete workflows bajo `.github/workflows/` y
`deployment/docker-compose.release.yml`, comparados con `b409233`. Una excepción de pipeline aprobada solo podrá cambiar
`shared-validation.yml`, `release.yml` y `deployment/docker-compose.release.yml`; en el mismo cambio actualizará
fingerprints anterior/nuevo, allowlist exacta y evidencia de contrato. Los otros cinco workflows SHALL permanecer byte
por byte iguales a `b409233`. Antes de merge a `master` SHALL ejecutarse literalmente
`git diff --name-only origin/master...develop -- .github/workflows deployment/docker-compose.release.yml`; toda ruta
impresa bloquea merge de producto. No se enmascara el resultado ni se desactiva la política global. La excepción
requiere aprobación explícita del usuario y revisión de owner.

#### Scenario: Excepción aprobada en archivos permitidos

- **WHEN** un cambio autorizado modifica uno o más archivos de la allowlist
- **THEN** registra hashes anterior y nuevo, actualiza fingerprints y prueba de contrato en ese cambio
- **THEN** los otros cinco workflows siguen idénticos a `b409233`

#### Scenario: Diff en merge de producto

- **WHEN** el chequeo literal imprime cualquier ruta
- **THEN** merge queda bloqueado y se informa la desviación sin supresión automática

#### Scenario: Excepción incompleta

- **WHEN** falta aprobación, allowlist exacta, fingerprints o evidencia contractual
- **THEN** la excepción se rechaza y master continúa bloqueado

### Requirement: CI SHALL probar la normalización sin debilitar preservación ni linaje

Las regresiones SHALL reutilizar el harness y gates completos existentes, con selección unitaria completa y sin skips,
exclusiones ni retries verdes. La cobertura SHALL probar con integración los entrypoints reales: inicialización ordinaria
desde origen normalizado vacío hacia `runStudyMigrations`, y el mantenimiento local `maintenance` desde origen histórico
normalizado mediante `Runtime.maintenance()`, `scripts/migrate-study-schema.js` y `scripts/cutover-copilot-369.js`.
No se confundirá ese cutover con el modo `existing` de retiro legacy. SHALL demostrar lectura ordinaria readonly de 014 canónica con bundle Copilot
369+30 y decisiones, sin registrar 015, y aceptación readonly del destino canónico de la pareja Copilot 369+30 con 015
válida; esta ruta Copilot exacta evita completamente el migrador. SHALL cubrir `assertLedgerState` y
`runStudyMigrations` con el prefijo exacto completo 001–014, 002 opcional en posición permitida y 015 externa solo tras
014; rechazar IDs desconocidos, huecos, duplicados y orden incorrecto, sin clasificar la 015 válida como desconocida.
Sin 015, SHALL conservar los casos positivos de migración desde ledger vacío o prefijo gestionado válido incompleto,
sin confundir su elegibilidad para continuar con readiness de aplicación.
SHALL probar fallos antes de escrituras para FK inválida, huérfanos, datos parciales/desconocidos,
secuencia de ledger incompleta/desordenada, fuentes/pins 015 incorrectos, índices no equivalentes, dependencias
inesperadas, errores de backup/restore y concurrencia de locks/generación.

Los ensayos SHALL inyectar interrupciones antes, durante y después del commit y fallos al persistir el recibo. Para cada
origen (vacío, histórico 300+30 y Copilot 369+30), la fase `normalization_verified` SHALL detenerse sin bootstrap,
cutover, runtime, reinicio, publicación, cambio de punteros ni consumo de reserva; identidad Copilot con esquema, datos y
tokens finales no omite fase ni autorización. Autorización ausente, expirada, de candidato distinto o normalization-only
no SHALL admitir siguiente fase. Reconcile es readonly: solo demuestra origen intacto, que aún requiere autorización
externa explícita separada, o registra checkpoint cuando el catálogo canónico y ledger 015 exacto están presentes; tras
commit sin recibo no repite 015 y se detiene hasta continuación fresca. La forma física sola sin 015 no demuestra commit;
parcial/unknown queda bloqueado. `origin` sigue siendo pre-015; baseline, backup/restore y handoff del paso siguiente
deben ser post-015. Se rechaza backup pre-015 antes de SQL. La normalización de 300 con decisiones válidas no relaja
la condición de cero historial del cutover. Los estados ambiguos quedan bloqueados/unknown, sin SQL de mutación,
reinicio ni reparación de punteros. Toda ejecución SHALL comprobar cleanup real y el
inventario completo de integración, ampliándolo explícitamente si se agregan archivos; no se permiten skips, retries
verdes ni selección reducida. Los fingerprints de datos protegidos 30 y de la primaria SHALL conservarse, admitiendo
únicamente la fila 015 esperada en el fingerprint global del ledger, no declarar inalterado el fingerprint total de DB.

#### Scenario: 014 ordinaria y destino con 015

- **WHEN** el harness verifica la pareja Copilot 369+30 en catálogo canónico 014 con decisiones y sin 015, o esa misma pareja con fila 015 correcta
- **THEN** ambos recorridos terminan en readonly y la primera base no obtiene una fila 015 implícita

#### Scenario: Linaje exacto y ledger externo reconocido

- **WHEN** todos los consumidores inspeccionan el prefijo completo 001–014, opcional 002 en posición permitida y 015
  externa válida después de 014
- **THEN** aceptan solo ese orden, rechazan IDs desconocidos, huecos, duplicados o desorden, y no tratan 015 como
  migración gestionada ni la ejecutan automáticamente

#### Scenario: Rechazo de linaje en entrypoints reales

- **WHEN** la inicialización ordinaria desde origen vacío o el cutover local `maintenance` desde origen histórico encuentra
  ledger con ID desconocido, hueco, duplicado o fuera de orden
- **THEN** falla antes de SQL mutante; una 015 válida se reconoce sin ejecutarla automáticamente, y no legitima los demás errores del ledger

#### Scenario: Entrypoints reales después de normalizar

- **WHEN** la integración ejecuta la inicialización ordinaria desde origen normalizado vacío y el cutover local `maintenance`
  desde origen histórico normalizado
- **THEN** cada entrypoint aplica `runStudyMigrations` sin reaplicar el prefijo completo, ejecutar 015 ni escribir ledger
  o datos de aplicación que ya correspondan al estado verificado

#### Scenario: Fase de normalización no admite el runtime

- **WHEN** termina normalización desde origen vacío, histórico 300+30 o Copilot 369+30, aunque este último ya tenga los
  tokens del release
- **THEN** queda detenido en `normalization_verified` sin bootstrap, cutover, runtime, reinicio, publicación, cambios de
  punteros ni consumo de reserva hasta autorización separada, fresca y explícita

#### Scenario: Reconciliación y backup post-015

- **WHEN** hay crash tras commit SQL antes del recibo, o se ofrece backup pre-015 para el paso mutante siguiente
- **THEN** reconcile solo registra checkpoint readonly con catálogo canónico y ledger 015 exacto, sin repetir SQL, y
  detiene hasta nueva continuación; backup pre-015 se rechaza antes de SQL y se exige binding post-015

#### Scenario: Histórico con decisiones

- **WHEN** la fuente 300+30 contiene decisiones válidas durante la normalización
- **THEN** la normalización puede terminar, pero el cutover posterior sigue bloqueado por cero historial primario

#### Scenario: Catálogo retirado y convergencia protegida

- **WHEN** el fixture fijado del catálogo retirado y uno de los tres bundles admitidos pasan los gates de normalización
- **THEN** una sola ejecución transaccional produce catálogo canónico y fila 015 exacta preservando las huellas de datos;
  repetir sobre 015 válida no ejecuta DDL ni añade otra fila

#### Scenario: Regresión negativa, crash o concurrencia

- **WHEN** falla una precondición, una escritura, la persistencia del recibo o la adquisición/propiedad de locks, o el
  proceso cae antes, durante o después del commit
- **THEN** el gate comprueba que no hubo escrituras fuera de la transacción prevista, que reconcile conserva estado
  honesto y que ninguna mutación posterior avanza sin autorización fresca

#### Scenario: Suite incompleta o protección alterada

- **WHEN** hay una prueba omitida/cancelada, cleanup no confirmado, cobertura de integración sin inventariar o cambio
  inesperado en datos protegidos
- **THEN** el gate falla y no habilita build, publicación ni despliegue

### Requirement: Release SHALL exigir gates, identidad confiable y evidencia operativa real

Solo un push confiable a `master` SHALL iniciar la cadena de release; build, publicación y despliegue dependerán de los
gates obligatorios satisfactorios, en ese orden. La validación de pull requests seguirá permitida, sin publicar ni
desplegar producción. Imágenes SHALL ser inmutables y referidas por commit y digest; acciones externas de los dos
workflows afectados SHALL conservar sus SHA pins. Secretos de conexión VPS estarán limitados al job protegido
`production`; credenciales de runtime, cuentas y backup permanecerán externas en el host, fuera de CI, manifiestos,
paquetes y logs. Antes de habilitar release se verificará protección real de rama, revisión de owner, entorno
`production` y disponibilidad de esas protecciones según el plan/visibilidad del repositorio, pues YAML por sí solo no
lo demuestra. El HOLD continúa hasta adopción del launcher antes del primer push a master, readiness, backup/restore
verificables y autorización manual de cutover cuando aplique. CI local o remoto no es autorización operativa ni
garantía de riesgo cero. Paquete y launcher pertenecen a `release-study-bundle`.

#### Scenario: Pull request u otra rama

- **WHEN** una pull request o rama distinta de `master` completa gates
- **THEN** no publica imágenes ni despliega a VPS y no dispone de secretos productivos

#### Scenario: Push confiable con gates completos

- **WHEN** push confiable a `master` supera gates y produce referencias inmutables válidas
- **THEN** el despliegue solo comienza después de publicar las imágenes verificadas y satisfacer las reglas del entorno
  `production`, y registra commit y digest

#### Scenario: Protección administrativa no comprobada

- **WHEN** solo hay evidencia YAML sin verificación de branch protection, owner review o secrets
- **THEN** readiness permanece pendiente y HOLD continúa

#### Scenario: Adopción, backup o cutover sin evidencia

- **WHEN** falta adopción verificada, backup, aprobación del operador o elegibilidad manual de cutover
- **THEN** release real permanece bloqueado por HOLD y CI no presenta simulación como autorización

#### Scenario: Adopción sin drenaje verificable

- **WHEN** no se demuestra exclusión de pushes ordinarios a master, drenaje/cancelación de
  operaciones v1 queued, running, esperando aprobación, retryables o en vuelo, CI terminal y
  ausencia de deploy bajo lock
- **THEN** no se instala ni adopta consumidor y no se permite re-run/ingreso v1 durante la ventana
  mediante control operativo verificable; no se añade administración automática de ramas o
  environments
- **THEN** el inventario es readonly en PostgreSQL y no reinicia servicios ni ejecuta prepare;
  registra IDs/tiempos de contenedor y servicio y fingerprints persistentes. La aplicación previa
  puede seguir ejecutándose si no hay cutover
- **THEN** la ventana permanece hasta el primer candidato v2 autorizado y validado, tras lo cual todo ingreso v1 se rechaza
