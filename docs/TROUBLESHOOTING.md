# Troubleshooting

## Cwd y entorno

Ejecuta desde la raíz. `index.js` usa `./views`; `dotenv` busca `.env` desde el cwd. El template de deployment usa
placeholders y no contiene credenciales listas para usar. No compartas tokens, passwords, manifests ni payloads.

## Compose no arranca

La dependencia estática es `labeling-database` saludable, después `labeling-study-prepare` exitoso y finalmente
`labeling-server`. El host publica `7755:3000`.

```bash
docker compose --env-file deployment/.env -f deployment/docker-compose.yml ps
docker compose --env-file deployment/.env -f deployment/docker-compose.yml logs labeling-study-prepare
docker compose --env-file deployment/.env -f deployment/docker-compose.yml logs labeling-server
```

No uses `down -v` como corrección o rollback.

## PostgreSQL y migraciones

Los init scripts solo se ejecutan con `PGDATA` vacío. El runner gestiona `001`, `003` y `004`; `002` es externo. No
edites manualmente `labeler_migration`; revisa `deployment/ROLLBACK.md` ante drift o restauraciones.

## GitHub

La configuración habilitada debe declarar exactamente un perfil `default` en
`GITHUB_CREDENTIAL_ALIASES`; las claves `owner/name` y los perfiles adicionales fallan
con `INVALID_PROFILE`. El perfil debe usar exactamente una fuente (`tokenEnv` o
`tokenFile`). `CREDENTIAL_NOT_FOUND` indica secreto ausente y
`INSUFFICIENT_PERMISSIONS` permisos read-only declarados insuficientes. La credencial
solo pertenece a prepare. Consulta [`GITHUB-ENRICHMENT.md`](../deployment/GITHUB-ENRICHMENT.md)
sin imprimir el token.

## Resultados engañosos

`lint` no equivale a runtime; `lint:md` no cubre `docs/`; no existe `npm test` ni `npm run build`; minify modifica
archivos. Registra comando, salida, fecha, entorno y alcance.
