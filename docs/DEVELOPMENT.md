# Desarrollo

Ejecuta los comandos desde la raíz: `index.js` usa `./views`, `dotenv` busca `.env` desde el cwd y los scripts usan
rutas relativas. `npm ci` instala desde el lockfile.

## Scripts existentes

`quality`, `lint`, `lint:js`, `lint:css`, `lint:md`, `test:unit`, `test:integration` y `test:e2e` son los gates
estables. También existen `dev`, `start`, `minify`, `minify:css`, `backup:legacy`, `bootstrap:study`, `enrich:study`,
`import:csv`, `migrate:study`, `retire:legacy:apply`, `retire:legacy:clean-check`, `retire:legacy:check`,
`test:foundation`, `test:migrations`, `test:study-http`, `test:study-concurrency` y `test:rollback-readonly`.

No existen `npm test`, `npm run build` ni una compilación EJS separada. EJS renderiza en runtime. `lint:md` solo cubre
Markdown raíz y no valida la documentación de OpenSpec. `quality` ejecuta únicamente `lint` y pruebas unitarias
autocontenidas. `test:integration` requiere `STUDY_HTTP_BASE_URL`, `STUDY_HTTP_REPLAY_CARD_ID`,
`STUDY_HTTP_NAVIGATION_CARD_ID`, `STUDY_HTTP_CONCURRENT_CARD_ID` y
`STUDY_HTTP_CATEGORY_ID`; ejecuta el contrato HTTP del runtime actual;
`test:e2e` requiere `STUDY_E2E_BASE_URL` y comprueba una instalación del runtime actual. Ambos fallan con código no cero
si falta su destino y emiten líneas JSON con el comando y código de salida, sin valores de entorno.

## Desarrollo local

```bash
npm ci
npm run dev
npm run lint:js
npm run lint:md
npm run quality
```

Para gates contra servicios preparados, configura sus destinos explícitamente antes de ejecutarlos:

```bash
STUDY_HTTP_BASE_URL=http://127.0.0.1:7755 \
STUDY_HTTP_REPLAY_CARD_ID=<uuid> \
STUDY_HTTP_NAVIGATION_CARD_ID=<uuid> \
STUDY_HTTP_CONCURRENT_CARD_ID=<uuid> \
STUDY_HTTP_CATEGORY_ID=<uuid> \
npm run test:integration
STUDY_E2E_BASE_URL=https://example.invalid npm run test:e2e
```

Cada subcomando emite evidencia JSONL en stdout con `gate`, `command` y `exitCode`. Esta evidencia describe la ejecución
sin copiar secretos ni valores de variables de entorno.

El servidor usa `3000` por defecto. Docker publica `7755:3000`; sus precondiciones están en
[`docs/OPERATIONS.md`](OPERATIONS.md).

Los cambios documentation-only no modifican runtime, dependencias, SQL, Compose, bases o volúmenes. Actualiza
`docs/JAVASCRIPT-API.md` cuando cambien exports, handlers, clases, factories, entrypoints o coordinadores JavaScript.
