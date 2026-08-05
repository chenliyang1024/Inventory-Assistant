import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { InMemoryRepo } from '../functions/src/repos/inMemoryRepo';
import { checkStock, searchMaterials, getSupplierForMaterial, placeOrder } from '../functions/src/queries';
import { toMaterialView } from '../functions/src/business';

const tests: { name: string; fn: () => Promise<void> }[] = [];
function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

function loadRepo(): InMemoryRepo {
  const dataPath = path.join(__dirname, '..', 'functions', 'data', 'inventory_data.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  return InMemoryRepo.fromDataset(data);
}

// --- availability math -----------------------------------------------

test('over-allocated SKU floors to 0 but is flagged', async () => {
  const repo = loadRepo();
  const m = await checkStock(repo, 'STL-W12X40-A992');
  assert.ok(m);
  assert.strictEqual(m!.qty_on_hand, 4);
  assert.strictEqual(m!.qty_reserved, 6);
  assert.strictEqual(m!.qty_available_raw, -2);
  assert.strictEqual(m!.qty_available, 0);
  assert.strictEqual(m!.over_allocated, true);
});

test('fully reserved SKU shows 0 available, not over-allocated', async () => {
  const repo = loadRepo();
  const m = await checkStock(repo, 'RBR-20M-EPOXY');
  assert.strictEqual(m!.qty_available, 0);
  assert.strictEqual(m!.over_allocated, false);
});

test('normal availability calc', async () => {
  const repo = loadRepo();
  const m = await checkStock(repo, 'STL-PL12-A36');
  assert.strictEqual(m!.qty_available, 4); // on_hand 8 - reserved 4
});

// --- search / unknown SKU ---------------------------------------------

test('search finds beam by description', async () => {
  const repo = loadRepo();
  const results = await searchMaterials(repo, 'W12x40');
  assert.ok(results.some((r) => r.sku === 'STL-W12X40-A992'));
});

test('no 25M epoxy rebar exists (spec trap)', async () => {
  const repo = loadRepo();
  const results = await searchMaterials(repo, '25M epoxy rebar');
  assert.ok(!results.some((r) => r.sku === 'RBR-25M-EPOXY'));
});

test('unknown SKU lookup returns null', async () => {
  const repo = loadRepo();
  const m = await checkStock(repo, 'NOT-A-REAL-SKU');
  assert.strictEqual(m, null);
});

// --- order rules --------------------------------------------------------

test('order rejected for unknown SKU', async () => {
  const repo = loadRepo();
  const result = await placeOrder(repo, 'NOT-A-REAL-SKU', 5);
  assert.strictEqual(result.status, 'rejected');
  assert.strictEqual(result.reason, 'unknown_sku');
});

test('order rejected when quantity exceeds available (spec query 3)', async () => {
  const repo = loadRepo();
  const result = await placeOrder(repo, 'RBR-15M-400W', 500);
  assert.strictEqual(result.status, 'rejected');
  assert.strictEqual(result.reason, 'insufficient_stock');
  assert.strictEqual(result.qty_available, 120);
});

test('order fulfilled within available stock', async () => {
  const repo = loadRepo();
  const result = await placeOrder(repo, 'STL-PL12-A36', 3);
  assert.strictEqual(result.status, 'fulfilled');
  assert.strictEqual(result.line_total, Math.round(402.0 * 3 * 100) / 100);
});

test('order rejected for discontinued item even with stock (spec query 4)', async () => {
  const repo = loadRepo();
  const result = await placeOrder(repo, 'STL-PL38-A36', 3);
  assert.strictEqual(result.status, 'rejected');
  assert.strictEqual(result.reason, 'discontinued');
});

test('order rejected for discontinued item with zero stock (checked before stock)', async () => {
  const repo = loadRepo();
  const result = await placeOrder(repo, 'FST-A490-34X212', 1);
  assert.strictEqual(result.status, 'rejected');
  assert.strictEqual(result.reason, 'discontinued');
});

test('order rejected as insufficient_stock (not discontinued) for a non-discontinued zero-stock SKU', async () => {
  // STL-HSS8X8X12: 0 on hand, NOT discontinued -- must reject for stock,
  // not be confused with the discontinued rule.
  const repo = loadRepo();
  const result = await placeOrder(repo, 'STL-HSS8X8X12', 1);
  assert.strictEqual(result.status, 'rejected');
  assert.strictEqual(result.reason, 'insufficient_stock');
  assert.strictEqual(result.qty_available, 0);
});

test('second fully-reserved SKU (W14x48 beam) also shows 0 available, not over-allocated', async () => {
  const repo = loadRepo();
  const m = await checkStock(repo, 'STL-W14X48-A992');
  assert.strictEqual(m!.qty_on_hand, 1);
  assert.strictEqual(m!.qty_reserved, 1);
  assert.strictEqual(m!.qty_available, 0);
  assert.strictEqual(m!.over_allocated, false);
});

test('order increments reserved, not on_hand', async () => {
  const repo = loadRepo();
  const before = await checkStock(repo, 'STL-W10X33-A992');
  await placeOrder(repo, 'STL-W10X33-A992', 2);
  const after = await checkStock(repo, 'STL-W10X33-A992');
  assert.strictEqual(after!.qty_on_hand, before!.qty_on_hand);
  assert.strictEqual(after!.qty_reserved, before!.qty_reserved + 2);
});

test('min_order_qty does not block small customer orders', async () => {
  const repo = loadRepo();
  const result = await placeOrder(repo, 'RBR-10M-400W', 1);
  assert.strictEqual(result.status, 'fulfilled');
});

test('order rejected for zero/negative quantity', async () => {
  const repo = loadRepo();
  const result = await placeOrder(repo, 'STL-PL12-A36', 0);
  assert.strictEqual(result.status, 'rejected');
  assert.strictEqual(result.reason, 'invalid_quantity');
});

// --- supplier lookups ----------------------------------------------------

test('supplier lookup for rebar material (spec query 5)', async () => {
  const repo = loadRepo();
  const supplier = await getSupplierForMaterial(repo, 'RBR-20M-EPOXY');
  assert.ok(supplier);
  assert.strictEqual(supplier!.supplier_id, 'SUP-002');
  assert.strictEqual(supplier!.payment_terms, 'NET30');
  assert.strictEqual(supplier!.standard_lead_time_days, 7);
});

test('ambiguous multi-word search returns all plausible matches (LLM disambiguates, not us)', async () => {
  // "steel plate" matches both the 1/2in and 3/8in plate SKUs -- the
  // assistant should surface both rather than silently picking one.
  const repo = loadRepo();
  const results = await searchMaterials(repo, 'steel plate');
  const skus = results.map((r) => r.sku);
  assert.ok(skus.includes('STL-PL12-A36'));
  assert.ok(skus.includes('STL-PL38-A36'));
});

// --- runner ---------------------------------------------------------------

async function main() {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`ok - ${t.name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL - ${t.name}`);
      console.error(err);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
  if (failed > 0) process.exit(1);
}

main();
