## 1. Inventario y proteccion de datos

- [ ] 1.1 Inventariar rutas, vistas, scripts SQL, funciones, procedimientos, dependencias npm y assets que referencien `instance`, `label`, reviews, discards, conflictos o Socket.IO.
- [ ] 1.2 Definir y ejecutar un respaldo/export reproducible de filas legacy, registrar su checksum y verificar que puede leerse antes de eliminar objetos.
- [ ] 1.3 Añadir una migracion versionada y una guardia que impidan el retiro si faltan el respaldo verificado o el inventario de consumidores.

## 2. Retiro de realtime y dependencias

- [ ] 2.1 Eliminar la inicializacion del servidor Socket.IO y los eventos `label_added`, `label_removed` y `label_renamed`.
- [ ] 2.2 Eliminar listeners, scripts y assets cliente que solo actualicen labels globales mediante Socket.IO.
- [ ] 2.3 Retirar `socket.io` de `package.json`, `package-lock.json` y cualquier documentacion de instalacion, y verificar que no queden imports.

## 3. Retiro de interfaces legacy

- [ ] 3.1 Retirar las rutas exclusivas de labels globales, merge y rename legacy.
- [ ] 3.2 Retirar las rutas y vistas exclusivas de reviews, discards y resolucion de conflictos legacy.
- [ ] 3.3 Conservar y verificar las rutas `pr_cards` que el MVP reutiliza aunque mantengan nombres legacy, sin consultas a labels o conflictos.
- [ ] 3.4 Verificar que las rutas eliminadas responden 404 y que cola, tarjeta, categorias, clasificacion y progreso del MVP siguen respondiendo.

## 4. Retiro del esquema SQL legacy

- [ ] 4.1 Separar los scripts SQL legacy de las migraciones requeridas por el estudio MVP sin eliminar `reviewer`, `pr_cards`, `study`, `study_participant`, `study_card`, `participant_category` ni `pr_classification`.
- [ ] 4.2 Eliminar en una migracion controlada el tipo `conflict` y las tablas legacy de `instance`, labels, reviews, discards y resolucion de conflictos.
- [ ] 4.3 Retirar vistas, funciones y procedimientos SQL que dependan exclusivamente de los objetos eliminados.
- [ ] 4.4 Verificar foreign keys, indices y funciones restantes despues de la migracion sin usar `DROP CASCADE` indiscriminado.

## 5. Despliegue y fixtures

- [ ] 5.1 Retirar de Docker los mounts y cargas de `label.txt`, `reviewer.txt` e `instance.tsv`.
- [ ] 5.2 Mantener el bootstrap MVP como unica fuente de participantes, `pr_cards` y membresias de estudio.
- [ ] 5.3 Ejecutar la migracion de retiro despues de PostgreSQL saludable y antes de readiness, preservando el comportamiento para volumen nuevo y existente.
- [ ] 5.4 Eliminar o archivar los fixtures legacy del repositorio solo despues de verificar que ninguna instruccion de despliegue los necesita.

## 6. Verificacion y rollback

- [ ] 6.1 Ejecutar lint, tests, build y una comprobacion estructural sin referencias runtime a Socket.IO, labels globales o conflictos legacy.
- [ ] 6.2 Probar una base limpia: bootstrap MVP, tres participantes, 300 tarjetas, categorias privadas y clasificacion sin tablas legacy.
- [ ] 6.3 Probar una base existente: respaldo, migracion, reinicio y preservacion de las clasificaciones MVP.
- [ ] 6.4 Probar el rollback restaurando la version anterior y el respaldo en una base desechable.
- [ ] 6.5 Verificar que cada participante sigue viendo solo sus categorias, respuestas, conteos y tarjetas pendientes despues del retiro.
