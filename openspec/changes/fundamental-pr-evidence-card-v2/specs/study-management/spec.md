## MODIFIED Requirements

### Requirement: Misma muestra para cada participante
El sistema MUST asociar las mismas 300 tarjetas a cada participante activo y SHALL servir para cada una la misma versión del snapshot GitHub promovido, cuando exista.

#### Scenario: Evidencia consistente
- **WHEN** tres participantes abren la misma tarjeta
- **THEN** reciben la misma identidad, baseline CSV, evidencia GitHub y procedencia, sin compartir decisiones privadas

#### Scenario: Cobertura completa
- **WHEN** los tres participantes recorren sus colas
- **THEN** cada uno recibe cada PR una vez como pendiente hasta clasificarlo

### Requirement: Progreso independiente
El sistema SHALL mostrar el avance del participante actual sin mostrar categorías ni respuestas de los demás. La proyección `CardV2` MUST excluir progreso, observaciones y decisiones del contrato de evidencia.

#### Scenario: Aislamiento de progreso
- **WHEN** un participante solicita una tarjeta ya revisada por otro
- **THEN** ve solo su propio estado y la evidencia común de la tarjeta

#### Scenario: Avance parcial
- **WHEN** un participante ha completado 25 tarjetas
- **THEN** ve 25 completadas y las restantes pendientes, sin revelar el avance de otra persona

### Requirement: Preparación para fuente GitHub
El sistema SHALL conservar el origen de cada tarjeta y permitir que una futura captura GitHub aditiva sustituya valores resueltos sin cambiar el flujo del estudio. Un run v2 no podrá reemplazar una promoción ya usada por decisiones.

#### Scenario: Run compatible antes de clasificar
- **WHEN** el estudio aún no tiene decisiones y existe un run v2 completo
- **THEN** puede promoverlo atómicamente para las 300 tarjetas

#### Scenario: Run posterior a decisiones
- **WHEN** el estudio ya contiene clasificaciones o descartes
- **THEN** un run distinto no se hace visible para ese estudio ni modifica sus decisiones

#### Scenario: Origen CSV
- **WHEN** el estudio se crea desde el CSV
- **THEN** cada tarjeta registra `CSV` como fuente y queda disponible para el proveedor GitHub aditivo

### Requirement: Manifiesto de cuentas de participantes
Una preparación de estudio limpia MUST recibir un manifiesto de credenciales que coincida exactamente con el `studyKey` y la lista ordenada de participantes configurados. El manifiesto SHALL ser un archivo regular con permiso `0400`, generado fuera del contenedor y montado como solo lectura únicamente para `labeling-study-prepare` en una ruta absoluta configurada mediante `STUDY_ACCOUNT_MANIFEST_FILE`. El servidor web MUST NOT recibir el archivo, su ruta ni contraseñas en claro.

#### Scenario: Manifiesto válido en despliegue limpio
- **WHEN** el manifiesto protegido coincide con la configuración del estudio
- **THEN** la preparación crea las cuentas de participantes con los hashes declarados
- **AND** el servidor inicia sin acceso al manifiesto

#### Scenario: Manifiesto ausente o inválido
- **WHEN** el manifiesto falta, no tiene permiso `0400`, no es un archivo regular o no coincide con el estudio configurado
- **THEN** la preparación falla antes de crear cuentas de participantes
- **AND** el servidor no inicia
