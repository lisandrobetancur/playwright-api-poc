# playwright-api-poc

Proof of concept for **API-only** testing with [Playwright Test](https://playwright.dev/docs/api-testing) and TypeScript.
No browsers are used: every test runs through `APIRequestContext`.

## Requirements

- Node.js >= 20 (see `.nvmrc`)

## Setup

```bash
npm install
cp .env.example .env
```

> There is no need to run `npx playwright install`: API tests don't require browsers.

## Commands

| Command              | Description                            |
| -------------------- | -------------------------------------- |
| `npm test`           | Run the whole test suite               |
| `npm run test:smoke` | Run only tests tagged with `@smoke`    |
| `npm run report`     | Open the HTML report                   |
| `npm run typecheck`  | Type-check the project with TypeScript |
| `npm run format`     | Format the code with Prettier          |

## Environment variables

| Variable       | Description                                     | Default                                |
| -------------- | ----------------------------------------------- | -------------------------------------- |
| `API_BASE_URL` | Base URL of the API under test                  | `https://jsonplaceholder.typicode.com` |
| `API_TOKEN`    | Optional token, sent as `Authorization: Bearer` | —                                      |

In CI, set `API_BASE_URL` as a repository variable and `API_TOKEN` as a repository secret
(Settings → Secrets and variables → Actions).

## Project structure

```
├── playwright.config.ts     # baseURL, headers, reporters, retries
├── src/
│   ├── clients/             # One client per resource (wraps the endpoints)
│   ├── data/                # Test data factories
│   ├── fixtures/            # Playwright fixtures (inject the clients)
│   └── types/               # API model types
├── tests/                   # Specs (*.spec.ts)
└── .github/workflows/       # CI with GitHub Actions
```

## Adding a new resource

1. Define its type in `src/types/`.
2. Create a client in `src/clients/` that extends `BaseClient`.
3. Register it as a fixture in `src/fixtures/api.fixture.ts`.
4. Write the specs in `tests/`, importing `test` and `expect` from `@src/fixtures/api.fixture`.
