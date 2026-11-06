# playwright-api-poc

API test suite for the [Prop Room API](https://github.com/lisandrobetancur/prop-room-api) (an inventory
management REST API) built with [Playwright Test](https://playwright.dev/docs/api-testing) and TypeScript.
No browsers are used: every test runs through `APIRequestContext`.

## Requirements

- Node.js >= 20 (see `.nvmrc`)
- A running Prop Room API (default `http://localhost:8000`):
  - from its repository: `make run`, or
  - with Docker: `docker run --rm -p 8000:8000 ghcr.io/lisandrobetancur/prop-room-api:latest`

## Setup

```bash
npm install
cp .env.example .env
```

> There is no need to run `npx playwright install`: API tests don't require browsers.

## Commands

| Command                  | Description                                                     |
| ------------------------ | --------------------------------------------------------------- |
| `npm test`               | Run the whole suite                                             |
| `npm run test:smoke`     | Run only the tests tagged with `@smoke`                         |
| `npm run report`         | Open the HTML report                                            |
| `npm run typecheck`      | Type-check the project with TypeScript                          |
| `npm run generate:types` | Regenerate `src/api/schema.d.ts` from the live OpenAPI contract |
| `npm run format`         | Format the code with Prettier                                   |

Run a single area or test:

```bash
npx playwright test tests/products
npx playwright test -g "creates a product"
```

## Environment variables

| Variable       | Description                               | Default                 |
| -------------- | ----------------------------------------- | ----------------------- |
| `API_BASE_URL` | Base URL of the API under test            | `http://localhost:8000` |
| `API_KEY`      | Valid `X-API-Key` value (supplier writes) | `test-api-key-123`      |

## How the suite works

- **Isolation:** the API keeps its data in memory. An auto fixture calls `POST /__reset` before every test,
  so each test starts from the predictable seed data. Because the reset affects the whole server, tests run
  serially in **one worker**. Never point the suite at a shared environment.
- **Authentication:** the `admin`, `clerk` and `viewer` fixtures are request contexts already logged in as
  the seed users (a fresh login per test, after the reset). `request` is the anonymous client
  and `apiKeyClient` sends the `X-API-Key` header.
- **Types:** `src/api/schema.d.ts` is generated from the API's OpenAPI contract. `src/api/types.ts` exposes
  friendly aliases (`Product`, `Movement`, `PurchaseOrder`, ...) to type response bodies. CI fails when the
  generated file no longer matches the live contract.
- **Assertions:** custom matchers print the request URL and the response body on failure:

  ```ts
  await expect(response).toHaveStatus(201);
  await expect(response).toBeApiError(409, 'insufficient stock');
  await expect(response).toHaveValidationErrorFor('sku');
  ```

## Project structure

```
├── playwright.config.ts        # baseURL, single worker, reporters, global setup
├── src/
│   ├── api/                    # Types generated from the OpenAPI contract + aliases
│   ├── data/
│   │   ├── seed.ts             # Seed data IDs and values (stable after every reset)
│   │   └── factories.ts        # Builders for valid request bodies with unique values
│   ├── fixtures/api.fixture.ts # test/expect with reset, role clients and login helpers
│   └── support/                # Custom matchers, env and the health-check global setup
├── tests/
│   ├── auth/  users/           # Login, tokens, refresh, logout, Basic, API key, cookies, users
│   ├── products/               # CRUD, filters, ETags, CSV import, photos, ledger
│   ├── catalog/                # Categories and suppliers (cursor pagination)
│   ├── warehouses/             # Warehouses, stock levels, stock adjustments (If-Match)
│   ├── movements/              # Immutable stock ledger, idempotency
│   ├── purchase-orders/        # Order lifecycle and idempotency
│   ├── reports/                # Async report jobs and low-stock alerts
│   └── http/                   # Maintenance, chaos, redirects, echo, rate limit, cookies, HTTP semantics
└── .github/workflows/          # CI: runs the suite against the API's Docker image
```

## Writing a new test

```ts
import { test, expect } from '@src/fixtures/api.fixture';
import { buildProduct } from '@src/data/factories';
import type { Product } from '@src/api/types';

test('admin creates a product', async ({ admin }) => {
  const response = await admin.post('/products', { data: buildProduct() });

  await expect(response).toHaveStatus(201);
  const product: Product = await response.json();
  expect(response.headers()['location']).toBe(`/products/${product.id}`);
});
```

## CI

`.github/workflows/api-tests.yml` starts `ghcr.io/lisandrobetancur/prop-room-api:latest` as a service
container, checks that the generated types are up to date, type-checks, checks formatting and runs the suite.
The HTML report and JUnit results are uploaded as an artifact.

> If the GHCR package is private, the workflow cannot pull it: make the package public, or add a
> `docker/login-action` step with a token that can read packages.
