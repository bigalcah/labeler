## Purpose

Gestionar un estudio local reproducible con configuración JSON, tres participantes por defecto, membresía persistida de las mismas 300 tarjetas y bootstrap seguro sin implementar todavía administración completa.

## ADDED Requirements

### Requirement: Configuración JSON y precedencia

El sistema SHALL aceptar una configuración JSON con `studyKey`, `expectedCardCount` igual a 300 y `participants`. Si no existe configuración explícita, SHALL usar un fallback local de tres participantes. Un estudio activo existente es autoritativo; una configuración explícita solo crea un estudio nuevo y cualquier drift falla sin borrar participantes o tarjetas.

#### Scenario: Configuración por defecto
- **WHEN** se inicia un estudio nuevo sin configuración explícita
- **THEN** se persisten tres participantes y se exige una muestra de 300 tarjetas

#### Scenario: Estudio existente
- **WHEN** existe un estudio activo con configuración persistida y la configuración local difiere
- **THEN** la configuración persistida sigue siendo autoritativa y el bootstrap falla por drift sin eliminar datos

### Requirement: Misma muestra para cada participante

El sistema MUST persistir `study_card` como membresía canónica y asociar las mismas 300 tarjetas a cada participante activo mediante el estudio, no mediante copias o colas distintas.

#### Scenario: Cobertura completa
- **WHEN** los tres participantes recorren sus colas
- **THEN** cada uno recibe cada PR una vez como pendiente hasta clasificarlo

### Requirement: Progreso independiente

El sistema SHALL mostrar el avance del participante actual sin mostrar categorías ni respuestas de los demás.

#### Scenario: Avance parcial
- **WHEN** un participante ha completado 25 tarjetas
- **THEN** ve 25 completadas y las restantes pendientes, sin revelar el avance de otra persona

### Requirement: Participantes persistidos

El bootstrap SHALL reutilizar o crear filas `reviewer` para los identificadores configurados y SHALL persistir la relación en `study_participant`. La tabla `reviewer` es una identidad temporal del MVP, no un mecanismo de autenticación.

#### Scenario: Reviewer existente
- **WHEN** un participante configurado ya corresponde a un reviewer
- **THEN** el bootstrap reutiliza esa identidad y no crea un duplicado

### Requirement: Bootstrap y readiness

El sistema MUST ejecutar un bootstrap one-shot después de que la base esté saludable y antes de que la aplicación web anuncie readiness. Las migraciones crean estructura; el bootstrap crea estudio, participantes, tarjetas y membresía.

#### Scenario: Bootstrap exitoso
- **WHEN** el CSV pasa validación completa y la transacción confirma 300 `study_card`
- **THEN** el estudio queda listo y la web puede anunciar readiness

#### Scenario: Bootstrap fallido
- **WHEN** falla la validación, aparece drift o ocurre un error transaccional
- **THEN** se hace rollback, no se borra nada y la web permanece no lista

### Requirement: Volumen existente y volumen limpio

El bootstrap SHALL funcionar tanto en un volumen limpio como en uno existente, preservando datos en ambos casos y sin sembrar labels o instances legacy. No SHALL ejecutar una reimportación incondicional.

#### Scenario: Volumen existente
- **WHEN** el estudio ya tiene tarjetas o clasificaciones
- **THEN** se reutiliza el estado compatible y se rechazan conflictos sin sobrescribirlo

### Requirement: Preparación para fuente GitHub

El sistema SHALL conservar el origen de cada tarjeta y permitir que una futura importación GitHub sustituya el proveedor CSV sin cambiar el flujo del estudio.

#### Scenario: Origen CSV
- **WHEN** el estudio se crea desde el CSV
- **THEN** cada tarjeta registra `CSV` como fuente y queda disponible para el proveedor futuro
