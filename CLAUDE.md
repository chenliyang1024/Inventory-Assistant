# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A chat assistant for a construction material supplier (Angular frontend + Firebase Functions/Firestore backend) that checks stock, looks up supplier terms, and places orders against a live inventory dataset, via a Gemini tool-use loop.

**There is no root `package.json`.** `frontend/` (Angular CLI project) and `functions/` (Cloud Functions) are independent npm projects — `npm install` must be run inside each separately, never from the repo root.

## Commands

All from `functions/` (there is no build/test tooling at the repo root):

```bash
cd functions
npm install
npm run build          # tsc -> lib/
npm run serve          # build + firebase emulators:start --only functions,firestore,hosting
npm run shell          # build + firebase functions:shell
npm run deploy         # firebase deploy --only functions
npm run logs           # firebase functions:log
npm run ingest         # build + node lib/ingest.js (loads functions/data/inventory_data.json into Firestore)
```

Business-logic tests (no emulator, no Firestore needed — run from repo root):

```bash
npx ts-node tests/run-tests.ts
```

This runs 19 assertions against the real `functions/data/inventory_data.json` via `InMemoryRepo`, covering all required queries plus edge cases (over-allocated SKU, non-existent item, discontinued item, insufficient stock, supplier lookup, plural/singular search matching). There is no test runner framework (no Jest/Mocha) — `tests/run-tests.ts` is a self-contained script with its own `test()`/assert harness; add new cases by calling `test('name', async () => {...})` in that file.

Frontend:

```bash
cd frontend
npm install
ng serve --proxy-config proxy.conf.json   # proxies /api/** to the emulator; see frontend/proxy.conf.json
```

## Architecture

**Layering is the core design constraint.** The LLM never computes anything or sees raw catalogue data — it only picks which deterministic tool to call and phrases the final sentence from that tool's returned JSON. All availability math and order rules live in plain TypeScript, independent of both the LLM and the storage backend:

```
llm.ts        Gemini tool-use loop (bounded to 6 round-trips). Owns the system prompt and
              tool schemas. executeTool() dispatches to queries.ts and nothing else.
queries.ts    Repo-aware orchestration: checkStock, searchMaterials, getSupplierForMaterial,
              placeOrder. Thin — fetches via a MaterialRepo, then hands off to business.ts.
business.ts   Pure functions only (no I/O): computeAvailability, materialMatchesQuery,
              evaluateOrder, decisionToResult. This is the only place business rules live,
              and the only thing tests/run-tests.ts exercises directly.
repos/        MaterialRepo interface (materialRepo.ts) with two implementations:
              firestoreRepo.ts (production) and inMemoryRepo.ts (tests). Both must implement
              placeOrder by taking an `evaluate` function and calling it — this is what lets
              order placement be re-evaluated atomically inside a Firestore transaction
              while using the exact same rule logic the tests exercise.
index.ts      Express app wrapping queries.ts/llm.ts, exported as one Cloud Function `api`.
              Routes are declared with the /api prefix since Hosting rewrites forward the
              full path.
```

Because `queries.ts`/`business.ts` never import Firestore, `firestoreRepo.ts`, or Express, any change to a business rule should be made in `business.ts` and verified via `tests/run-tests.ts` — not by hand-testing against the emulator.

**`qty_available` is never stored**, only derived on read (`computeAvailability`). Never add code that writes a `qty_available` field to Firestore — it would immediately be a stale duplicate of `qty_on_hand - qty_reserved`.

**Order placement never touches `qty_on_hand`** — it only increments `qty_reserved` and appends an `orders` doc. Shipment (decrementing `qty_on_hand`) is out of scope.

**Rule evaluation order matters** in `evaluateOrder` (business.ts): invalid quantity → unknown SKU → discontinued → insufficient stock → fulfilled. This determines which rejection reason the user sees when multiple would apply, and matches the spec's rule ordering — don't reorder these checks without checking `tests/run-tests.ts` expectations.

**Over-allocated stock** (`qty_reserved > qty_on_hand`) floors `qty_available` at 0 but sets `over_allocated: true`; the internal negative value is kept as `qty_available_raw`. The system prompt in `llm.ts` requires the model to state over-allocation explicitly rather than just saying "0 available," since that's indistinguishable from a merely fully-reserved item.

**Search** (`materialMatchesQuery` in business.ts) is loose, case-insensitive, all-terms-must-match substring matching across SKU/description/category/spec_grade — no fuzzy matching, so near-miss SKUs correctly return zero results (this is a deliberate spec trap covered by a test). `FirestoreRepo` implements this by loading the whole `materials` collection and filtering in JS, cached 60s per warm instance — acceptable at ~77 SKUs, the first thing to replace (Algolia/Typesense) if the catalogue grows.

**Firestore schema**: `suppliers` (doc ID = `supplier_id`), `materials` (doc ID = `sku`), `orders` (auto-ID, append-only audit trail). Firestore rules deny all direct client access (`allow read, write: if false`) — the Angular frontend only ever talks to the Cloud Function API, which uses the Admin SDK and bypasses rules entirely.

**Secrets**: `GEMINI_API_KEY` is a Firebase Functions secret (`firebase functions:secrets:set GEMINI_API_KEY`), injected via `defineSecret` in `index.ts` and passed explicitly into `chat()` — don't read `process.env.GEMINI_API_KEY` directly in new code paths that run in the deployed function (it's only a local-dev fallback in `llm.ts`, sourced from `functions/.secret.local`). Get a free key at [Google AI Studio](https://aistudio.google.com/apikey) — this goes through the Gemini Developer API, not Vertex AI, so no Cloud Billing account is required.

**Model**: `llm.ts` defaults to `gemini-flash-lite-latest` (overridable via `GEMINI_MODEL` env var) — chosen for its free-tier daily quota; `gemini-2.0-flash` has none on this key/project and `gemini-flash-latest` (currently `gemini-3.6-flash`) is capped at 5 req/min and 20 req/day free.

See README.md for the full design write-up (alternatives considered, assumptions where the spec was silent, and what's expected to break first under real load).
