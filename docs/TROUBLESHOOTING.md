# Troubleshooting

## Cwd y entorno

Ejecuta desde la raíz. `index.js` usa `./views`; `dotenv` busca `.env` desde el cwd. El template de deployment usa
placeholders y no contiene credenciales listas para usar. No compartas tokens, passwords, manifests ni payloads.
El flujo aprobado solo admite `pr-card-sorting-local` de 300 tarjetas y
`pr-card-sorting-validation-30` de 30.

## Compose no arranca

La dependencia es `labeling-database` saludable, después `labeling-study-prepare` exitoso para los
dos perfiles y finalmente `labeling-server`. Caddy queda al frente después de la readiness interna.
El host publica `7755:3000` solo para el stack local.

```bash
docker compose --env-file deployment/.env \
  -f deployment/docker-compose.yml \
  -f deployment/docker-compose.clean.yml ps
docker compose --env-file deployment/.env \
  -f deployment/docker-compose.yml \
  -f deployment/docker-compose.clean.yml logs labeling-study-prepare
docker compose --env-file deployment/.env \
  -f deployment/docker-compose.yml \
  -f deployment/docker-compose.clean.yml logs labeling-server
```

No uses `down -v` como corrección o rollback.

## Perfiles y preparación

Si falla `validate:study-profiles`, revisa `STUDY_PROFILES_INPUT`, las raíces montadas, los
checksums, el conteo 30 o 300, los IDs únicos y el mapeo de usernames. La validación debe terminar
antes de cualquier escritura.

```bash
npm run validate:study-profiles
npm run prepare:study-profiles
```

La preparación procesa primero 300 y después 30. Un fallo del perfil de validación no borra ni
reescribe el estudio actual. `clean` falla ante objetos legacy y `existing` requiere backup externo
verificable y confirmación explícita. No introduzcas un tercer conteo ni un selector de estudio.

## PostgreSQL y migraciones

Los init scripts solo se ejecutan con `PGDATA` vacío. El runner gestiona `001` y `003` a `012`; `002` es externo. No
edites manualmente `labeler_migration`; revisa `deployment/ROLLBACK.md` ante drift o restauraciones.

## Sesión y privacidad

El `study_id` no se calcula desde el username ni se recibe del cliente. Se obtiene de la cuenta y
la sesión de servidor, que también determinan la membresía y el participante. No uses un username,
query, URL, formulario, cookie o cabecera para cambiar de estudio. Categorías, clasificaciones,
descartes, observaciones y progreso son privados por estudio y participante.

Si una solicitud protegida devuelve no autenticado, vuelve a iniciar sesión y comprueba expiración,
revocación y `credential_version`. Las mutaciones necesitan CSRF y `Origin` permitido. No existe
selector de participante, selector de estudio ni UI administrativa.

## GitHub

La configuración habilitada debe declarar exactamente un perfil `default` en
`GITHUB_CREDENTIAL_ALIASES`; las claves `owner/name` y los perfiles adicionales fallan
con `INVALID_PROFILE`. El perfil debe usar exactamente una fuente (`tokenEnv` o
`tokenFile`). `CREDENTIAL_NOT_FOUND` indica secreto ausente y
`INSUFFICIENT_PERMISSIONS` permisos read-only declarados insuficientes. La credencial
solo pertenece a prepare. El run debe usar el `study_id`, checksum, membresía y conteo persistidos
del estudio seleccionado, que puede ser 30 o 300. El camino CSV-only no necesita token. La captura
live de GitHub sigue pendiente. Consulta [`GITHUB-ENRICHMENT.md`](../deployment/GITHUB-ENRICHMENT.md)
sin imprimir el token.

## Exportación

La exportación no es una ruta web. No existe `/export`, descarga desde navegador ni exportación
administrativa. El operador debe proporcionar un secreto HMAC externo, `--study-key` explícito y
un destino nuevo. Si falta una decisión terminal, el estudio no está `READY` o el secreto falta,
`export:study` falla sin crear un paquete parcial.

```bash
npm run export:study -- \
  --study-key pr-card-sorting-validation-30 \
  --output /absolute/external/validation-30
```

## Resultados engañosos

`lint` no equivale a runtime; `lint:md` no cubre `docs/`; `docs:study-check` valida el contrato y
los documentos requeridos; no existe `npm test` ni `npm run build`; minify modifica archivos.
Registra comando, salida, fecha, entorno y alcance.

El E2E hostil aislado de los dos estudios está completado. Permanecen pendientes la evidencia
externa de backup y restore, el E2E hostil histórico, el E2E completo en VPS o entorno público,
el cierre documental histórico y la captura live de GitHub.
