## Purpose

Permitir que participantes persistidos clasifiquen las mismas 300 tarjetas con categorías planas privadas y exactamente una clasificación por tarjeta y participante, sin que el bootstrap cree respuestas.

## ADDED Requirements

### Requirement: Categorías privadas por participante

El sistema SHALL permitir crear, renombrar y reutilizar categorías planas asociadas al participante seleccionado, sin compartirlas con otros participantes.

#### Scenario: Categorías similares
- **WHEN** dos participantes crean `Missing tests` y `Falta de pruebas`
- **THEN** el sistema conserva dos categorías independientes y cada una solo aparece a su creador

### Requirement: Una clasificación por PR y participante

El sistema MUST conservar como máximo una clasificación vigente para cada combinación de PR y participante.

#### Scenario: Clasificación normal
- **WHEN** el participante selecciona una categoría y guarda el PR
- **THEN** el sistema registra una sola categoría y permite avanzar a la siguiente tarjeta

#### Scenario: Corrección antes de terminar
- **WHEN** el participante vuelve a un PR ya clasificado
- **THEN** puede actualizar su categoría y observación sin modificar la respuesta de otro participante

### Requirement: Clasificación con observación opcional

El sistema SHALL permitir guardar una observación textual junto a la categoría, sin exigir todavía confianza ni resultados especiales.

#### Scenario: Observación de causa
- **WHEN** el participante clasifica un PR y escribe una observación
- **THEN** la observación queda asociada a su clasificación y permanece oculta para los demás participantes

### Requirement: Cola común de tarjetas

El sistema SHALL leer los mismos 300 PR desde la membresía `study_card` para cada participante y excluir de su cola únicamente los PR que ese participante ya haya clasificado.

#### Scenario: Tres participantes
- **WHEN** tres participantes comienzan el estudio local
- **THEN** cada uno puede recorrer las 300 tarjetas de forma independiente

### Requirement: Guardado y progreso

El sistema MUST guardar la clasificación y actualizar el progreso de forma atómica, y SHALL recuperar el avance cuando el participante vuelva a entrar.

#### Scenario: Reanudación
- **WHEN** un participante cierra la aplicación después de clasificar parte de la muestra
- **THEN** al volver conserva sus categorías, respuestas y número de tarjetas completadas

### Requirement: Bootstrap no crea categorías ni clasificaciones

El bootstrap SHALL crear solo la estructura del estudio, participantes, tarjetas y membresía. Las categorías y clasificaciones MUST ser creadas por acciones explícitas del participante y permanecer privadas.

#### Scenario: Estudio recién preparado
- **WHEN** termina el bootstrap de las 300 tarjetas
- **THEN** cada participante tiene 300 tarjetas pendientes y ningún catálogo o clasificación sembrado

### Requirement: Aislamiento del flujo local

El selector de participantes existente SHALL poder utilizarse durante esta fase de demostración, pero las rutas de clasificación MUST derivar el participante de la selección válida y no exponer categorías o clasificaciones ajenas.

#### Scenario: Cambio de participante
- **WHEN** se selecciona otro participante en el entorno local
- **THEN** se carga únicamente su catálogo de categorías y sus PR pendientes
