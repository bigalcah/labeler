# Gestión del estudio Copilot 369

## MODIFIED Requirements

### Requirement: Estudio local configurable

El sistema SHALL crear como productos nuevos únicamente el estudio primario de 369 tarjetas y el
estudio de validación de 30 tarjetas, con las cuentas previstas para cada uno. Un estudio histórico
de 300 solo se reconoce como origen exacto de la transición primaria explícita; MUST NOT servir como
fallback de creación normal. El guardado normal SHALL rechazar cualquier discrepancia de identidad o
configuración en vez de actualizarla.

#### Scenario: Configuración por defecto

- **WHEN** se inicia el estudio sin cambiar la configuración aprobada
- **THEN** se preparan el estudio primario de 369 tarjetas y el estudio de validación de 30 con las cuentas previstas

#### Scenario: Conteo o configuración no autorizados

- **WHEN** una creación normal solicita 300 tarjetas, otro conteo o una configuración distinta de los perfiles aprobados
- **THEN** falla sin crear ni alterar un estudio

### Requirement: Misma muestra para cada participante

El sistema MUST asociar a cada participante del estudio primario los mismos 369 PR en el mismo orden
y a cada participante del estudio de validación los mismos 30 en su orden existente. Cada PR requiere
exactamente una decisión terminal por participante, clasificado o descartado privadamente; no hay
reemplazos ni reservas.

#### Scenario: Cobertura completa

- **WHEN** los tres participantes recorren sus colas primarias
- **THEN** cada uno recibe los mismos 369 PR, una vez y en el mismo orden

#### Scenario: Membresía histórica de validación

- **WHEN** se consulta la membresía existente del estudio de 30
- **THEN** conserva sus 30 tarjetas y orden sin reimportación ni cambio

### Requirement: Progreso independiente

El sistema SHALL mostrar en cola, progreso y clasificación el avance y las decisiones privadas de la
persona autenticada, sin revelar categorías o respuestas de otras personas. Este aislamiento MUST
NOT cambiar el comportamiento autorizado de la exportación comparativa existente ni sus condiciones
de elegibilidad.

#### Scenario: Avance parcial

- **WHEN** una persona consulta su cola, progreso o clasificación tras completar parte de su muestra
- **THEN** ve su avance respecto de la cardinalidad de su estudio y no ve decisiones ajenas

#### Scenario: Exportación comparativa existente

- **WHEN** se solicita la exportación comparativa existente
- **THEN** se mantienen sus condiciones y comportamiento; solo se aplica la cardinalidad 369 donde
  corresponda, sin restaurar otra exportación

### Requirement: Preparación para fuente GitHub

El CSV selecciona la muestra primaria y conserva su procedencia. El navegador y la clasificación no
requieren ni consultan GitHub. La transición primaria podrá ocurrir únicamente cuando el estudio
persistido coincida exactamente con la identidad, configuración y fuente histórica de 300 esperadas,
su orden de membresía sea el esperado y no tenga clasificaciones ni descartes. El historial GitHub
cerrado e íntegro de la fuente histórica SHALL conservarse mediante referencias independientes de la
muestra activa, sin actualizar, borrar ni reasignar runs, páginas, mappings, promociones, snapshots
o telemetría existentes. Runs en curso, dependencias desconocidas, historia huérfana o drift de fuente
o esquema MUST bloquear sin escrituras. La transición válida SHALL conservar study ID/key, usuarios, roles,
hashes y versiones de
credenciales y membresía de participantes, y SHALL ser atómica e idempotente. Un estudio ya en 369 se
reconoce idempotentemente sin escrituras. El estudio existente de 30 se trata solo en lectura.

#### Scenario: Origen CSV

- **WHEN** se prepara la muestra primaria
- **THEN** el CSV selecciona las 369 tarjetas, queda conservada su procedencia y la clasificación no requiere red externa

#### Scenario: Transición histórica sin decisiones ni dependencias

- **WHEN** el estudio persistido coincide exactamente con la configuración, fuente y orden de
  membresía históricos esperados de 300, no tiene clasificaciones, descartes ni dependencias
  históricas, y no hay una decisión concurrente
- **THEN** la transición se completa atómicamente a 369 preservando identidad y cuentas, y repetirla
  no escribe ni altera el resultado

#### Scenario: Transición con historial conocido

- **WHEN** la primaria exacta de 300 no tiene decisiones y conserva historial GitHub cerrado, íntegro y verificable
- **THEN** una operación de mantenimiento autorizada puede activar únicamente las 369 tarjetas sin borrar ni
  reescribir el historial, sus identidades, timestamps ni procedencia y conservando los datos de validación

#### Scenario: Bloqueo por decisiones, discrepancia o historial desconocido

- **WHEN** existe una clasificación, descarte, diferencia de identidad, fuente u orden, un run en curso,
  una referencia huérfana, dependencia no reconocida o esquema desconocido
- **THEN** la transición falla sin cambiar, borrar, separar ni desvincular datos u objetos persistidos

#### Scenario: Decisión concurrente durante la transición

- **WHEN** una clasificación o descarte se guarda concurrentemente con la comprobación de elegibilidad
- **THEN** no puede eludirse la guarda: la transición se bloquea sin dejar un estado parcialmente cambiado

#### Scenario: Estudio primario ya ampliado

- **WHEN** la preparación reconoce el estudio primario ya configurado con los mismos 369 PR
- **THEN** lo valida de forma idempotente sin actualizar sus datos existentes

#### Scenario: Estudio de validación existente

- **WHEN** se prepara el estudio primario junto con un estudio existente de 30
- **THEN** el estudio de 30, sus cuentas, decisiones, categorías, membresía, fuente, orden, fixtures,
  manifest y snapshots se leen sin mutación, reprovisión, refresco, reimportación, enriquecimiento,
  resiembra ni reinicio

## ADDED Requirements

### Requirement: Compatibilidad verificable del historial conservado

El sistema MUST distinguir el contrato físico nuevo study-schema-4 de study-schema-3; MUST NOT declarar
compatibilidad por el mero conteo, un ledger o un manifiesto. La release corregida conserva el manifiesto
v2 y el bundle copilot369-v1, pero exige consumidor e imagen compatibles con el esquema observado.
Los checkpoints de migración, la activación de la muestra y la publicación SHALL tener evidencias
independientes. La preparación ordinaria de una pareja existente exacta SHALL continuar siendo readonly.

#### Scenario: Referencias listas pero muestra todavía histórica

- **WHEN** se verifica el nuevo contrato físico y se conserva la primaria de 300 tras la migración de referencias
- **THEN** se registra solo ese checkpoint; no se declara muestra 369 activa ni despliegue completo

#### Scenario: Imagen o consumidor incompatibles

- **WHEN** una imagen o consumidor solo declara soporte de study-schema-3 frente a una base study-schema-4
- **THEN** no se activa ni se presenta como fallback; la recuperación requiere la ruta verificada correspondiente

#### Scenario: Interrupción y continuación

- **WHEN** se interrumpe una operación antes o después de la migración de referencias o del cutover
- **THEN** se observa la base real en readonly y se exige autorización y backup aplicables antes de continuar,
  sin repetir escrituras confirmadas ni inferir éxito de punteros o timestamps

### Requirement: Validación previa a escrituras

El sistema MUST validar completamente el CSV canónico, su checksum, manifest, conteo, identidades y
compatibilidad antes de modificar datos. Los campos opcionales ausentes de tarjetas primarias nuevas
se omiten y se informan; la tarjeta histórica y presentación del estudio de 30 permanecen sin
cambios.

#### Scenario: Fuente inválida

- **WHEN** falla la validación del CSV, checksum, manifest, conteo, identidad o compatibilidad
- **THEN** no se escribe ningún dato de la fuente ni se altera ninguno de los dos estudios

#### Scenario: Dato opcional ausente

- **WHEN** una tarjeta primaria nueva carece de un dato opcional
- **THEN** se omite el campo y se informa al operador sin modificar ni cambiar la representación
  existente de tarjetas del estudio de 30
