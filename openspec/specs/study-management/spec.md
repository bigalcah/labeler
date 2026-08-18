# study-management Specification

## Purpose

Gestionar el estudio local de demostración con una muestra fija de 300 tarjetas, tres participantes por defecto y progreso independiente sin implementar todavía administración completa.

## Requirements

### Requirement: Estudio local configurable
El sistema SHALL disponer de una configuración de estudio con una cantidad de participantes configurable y valor inicial de tres.

#### Scenario: Configuración por defecto
- **WHEN** se inicia el estudio de demostración sin cambiar configuración
- **THEN** se preparan tres participantes y la muestra de 300 tarjetas

### Requirement: Misma muestra para cada participante
El sistema MUST asociar las mismas 300 tarjetas a cada participante activo.

#### Scenario: Cobertura completa
- **WHEN** los tres participantes recorren sus colas
- **THEN** cada uno recibe cada PR una vez como pendiente hasta clasificarlo

### Requirement: Progreso independiente
El sistema SHALL mostrar el avance del participante actual sin mostrar categorías ni respuestas de los demás.

#### Scenario: Avance parcial
- **WHEN** un participante ha completado 25 tarjetas
- **THEN** ve 25 completadas y las restantes pendientes, sin revelar el avance de otra persona

### Requirement: Preparación para fuente GitHub
El sistema SHALL conservar el origen de cada tarjeta y permitir que una futura importación GitHub sustituya el proveedor CSV sin cambiar el flujo del estudio.

#### Scenario: Origen CSV
- **WHEN** el estudio se crea desde el CSV
- **THEN** cada tarjeta registra `CSV` como fuente y queda disponible para el proveedor futuro
