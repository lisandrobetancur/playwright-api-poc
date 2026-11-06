# playwright-api-poc

POC de pruebas **solo de API** con [Playwright Test](https://playwright.dev/docs/api-testing) y TypeScript.
No usa navegadores: todas las pruebas usan `APIRequestContext`.

## Requisitos

- Node.js >= 20 (ver `.nvmrc`)

## Instalación

```bash
npm install
cp .env.example .env
```

> No hace falta `npx playwright install`: las pruebas de API no necesitan navegadores.

## Comandos

| Comando              | Descripción                                   |
| -------------------- | --------------------------------------------- |
| `npm test`           | Ejecuta todas las pruebas                     |
| `npm run test:smoke` | Ejecuta solo las pruebas etiquetadas `@smoke` |
| `npm run report`     | Abre el reporte HTML                          |
| `npm run typecheck`  | Verifica tipos con TypeScript                 |
| `npm run format`     | Formatea el código con Prettier               |

## Variables de entorno

| Variable       | Descripción                                          | Default                                |
| -------------- | ---------------------------------------------------- | -------------------------------------- |
| `API_BASE_URL` | URL base de la API bajo prueba                       | `https://jsonplaceholder.typicode.com` |
| `API_TOKEN`    | Token opcional, enviado como `Authorization: Bearer` | —                                      |

## Estructura

```
├── playwright.config.ts     # baseURL, headers, reporters, retries
├── src/
│   ├── clients/             # Clientes por recurso (encapsulan endpoints)
│   ├── data/                # Factories de datos de prueba
│   ├── fixtures/            # Fixtures de Playwright (inyectan los clientes)
│   └── types/               # Tipos de los modelos de la API
├── tests/                   # Specs (*.spec.ts)
└── .github/workflows/       # CI con GitHub Actions
```

## Añadir un nuevo recurso

1. Define el tipo en `src/types/`.
2. Crea un cliente en `src/clients/` que extienda `BaseClient`.
3. Regístralo como fixture en `src/fixtures/api.fixture.ts`.
4. Escribe los specs en `tests/` importando `test` y `expect` desde `@src/fixtures/api.fixture`.
