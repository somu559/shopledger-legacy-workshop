# Repository Guidelines

## Project Structure

- `server.js` serves the browser UI and mounts the Express routers in `routes/` under `/api`. It also serves printable invoices.
- `lib/` holds order, pricing, coupon, GST, inventory, khata, invoice, and reporting logic. Keep route handlers focused on HTTP and reuse these modules for business rules.
- `public/` contains the HTML, CSS, and browser JavaScript. `config.js` holds shop settings and billing rules. `data/db.json` is the file-backed store and the source fixture for integration tests.
- `test/` contains the API and browser-script tests. See `docs/shopledger-architecture.png` for the module map and checkout flow.

## Development Commands

- `npm ci` installs the dependencies from `package-lock.json`.
- `npm start` serves the app on port 3000 by default. Use `PORT=3001 npm start` to override it. Local orders and settlements update `data/db.json`.
- `npm test` runs the full suite. There is no build step or configured lint or format command.

## Coding Style

Use two-space indentation, single quotes, semicolons, and descriptive camelCase names in JavaScript. Use CommonJS for server modules and plain JavaScript for the browser. Follow the surrounding file's declaration style and reuse existing pricing and escaping helpers.

## Testing

Use `node:test` and `node:assert/strict`. Name files `*.test.js` and describe the expected behavior in test names. Add API cases with Supertest in `test/shopledger.test.js` using its isolated database copy. Put browser-script cases in `test/frontend.test.js`. There is no numeric coverage target. For billing changes, cover successful and rejected requests and verify affected stock, ledger, or invoice figures.

## Commits and Pull Requests

Use short, imperative subjects, such as “Reject invalid order quantities.” In the PR, describe the behavior change and how you verified it. Link the related issue when one exists, and include screenshots for visible UI changes. Keep real customer records and export keys out of commits and PR evidence.
