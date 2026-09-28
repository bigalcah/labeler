## 1. Preparación segura del runtime CI

- [x] 1.1 Actualizar la configuración temporal del estudio con los usernames CI esperados y generar las contraseñas como un arreglo JSON entregado al generador por stdin; comprobar que no aparecen en argumentos, logs ni evidencia.
- [x] 1.2 Alinear la URL base, `PUBLIC_HOSTNAME`, `APP_ORIGIN` y la identidad TLS de Caddy en `localhost`; validar que integración y E2E usan ese mismo origen.
- [x] 1.3 Ajustar ownership y permisos de solo los archivos temporales montados que sus consumidores necesitan leer, y dejar el Caddyfile legible y sin permiso de escritura para Caddy.

## 2. Datos de integración, sesión y limpieza

- [x] 2.1 Crear la categoría temporal con `study_id` y `participant_id`, capturando únicamente el identificador devuelto por la consulta.
- [x] 2.2 Crear y firmar la cookie de sesión dentro de `labeling-server` leyendo `/run/secrets/session-current`; comprobar que el host no necesita exportar el contenido del secreto.
- [x] 2.3 Mantener la limpieza incondicional, proteger `docker compose down` con la existencia de `compose.env`, retirar el directorio temporal y conservar el código de fallo de setup o validación.
- [x] 2.4 Añadir o ajustar pruebas de contrato para entradas JSON/privacidad, ownership, hostname, seed de estudio, cookie en contenedor, limpieza parcial y ausencia de bypass.

## 3. Gates locales completos

- [x] 3.1 Ejecutar `node --test test/ci-workflow.test.js test/credential-workflow.test.js` y corregir cualquier regresión de contrato sin eliminar pruebas ni debilitar assertions.
- [x] 3.2 Ejecutar `npm run lint:js`, `npm run test:unit` y `openspec validate repair-develop-pr-validation --strict`; registrar cada resultado por separado.
- [ ] 3.3 Validar la configuración Compose, Dockerfiles, integración y E2E usando los mismos pasos y entradas seguras del workflow compartido; no contar etapas omitidas como aprobadas.
- [x] 3.4 Revisar el diff para confirmar que solo incluye el workflow compartido y pruebas de contrato directamente justificadas, sin secretos, `continue-on-error`, skips ni rutas ajenas.

## 4. Gate remoto y evidencia de revisión

- [ ] 4.1 Después de aprobación explícita de apply y autorización de publicación, abrir una PR de CI separada contra `develop`, sin modificar la PR #1 ni importar commits ajenos.
- [ ] 4.2 Verificar que el run de la PR de CI corresponde a su head SHA y que lint, unit, OpenSpec, Compose, Dockerfiles, integración y E2E finalizaron en éxito y no fueron omitidos.
- [ ] 4.3 Si cambia el head o la base durante la revisión, descartar la evidencia obsoleta y comprobar un nuevo run contra el SHA vigente; informar fallos posteriores sin sortear gates.
- [ ] 4.4 Tras la integración autorizada del cambio CI, comprobar que la PR #1 obtiene un run nuevo sobre la base corregida y que cada gate requerido se ejecuta; mantenerla abierta ante fallos, omisiones o evidencia ligada a un SHA distinto.
