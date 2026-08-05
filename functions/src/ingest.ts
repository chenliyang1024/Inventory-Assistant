/**
 * Loads data/inventory_data.json into Firestore.
 *
 * Repeatable: replaces the suppliers/materials collections wholesale from
 * the JSON each run. Orders are untouched (they're activity, not part of
 * the catalogue snapshot).
 *
 * Run locally against your Firebase project:
 *   cd functions
 *   npm run build
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json node lib/ingest.js
 *
 * Or, if you're logged in via `firebase login` and have run
 * `gcloud auth application-default login`, you can omit
 * GOOGLE_APPLICATION_CREDENTIALS and it will use your ADC.
 */
import * as fs from 'fs';
import * as path from 'path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DATA_PATH = path.join(__dirname, '..', 'data', 'inventory_data.json');

async function main() {
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  const data = JSON.parse(raw);

  const batch1 = db.batch();
  for (const s of data.suppliers) {
    const ref = db.collection('suppliers').doc(s.supplier_id);
    batch1.set(ref, {
      name: s.name,
      location: s.location ?? null,
      standard_lead_time_days: s.standard_lead_time_days ?? null,
      payment_terms: s.payment_terms ?? null,
    });
  }
  await batch1.commit();

  // Firestore batches cap at 500 writes; chunk materials defensively.
  const materials = data.materials as any[];
  const CHUNK = 400;
  for (let i = 0; i < materials.length; i += CHUNK) {
    const batch = db.batch();
    for (const m of materials.slice(i, i + CHUNK)) {
      const ref = db.collection('materials').doc(m.sku);
      batch.set(ref, {
        description: m.description,
        category: m.category ?? null,
        spec_grade: m.spec_grade ?? null,
        unit_of_measure: m.unit_of_measure ?? null,
        unit_price: m.unit_price,
        currency: m.currency ?? null,
        qty_on_hand: m.qty_on_hand,
        qty_reserved: m.qty_reserved,
        reorder_point: m.reorder_point ?? null,
        min_order_qty: m.min_order_qty ?? null,
        primary_supplier_id: m.primary_supplier_id ?? null,
        warehouse: m.warehouse ?? null,
        discontinued: !!m.discontinued,
      });
    }
    await batch.commit();
  }

  const metaRef = db.collection('meta').doc('info');
  await metaRef.set({
    dataset_name: data.meta?.dataset_name ?? null,
    as_of_date: data.meta?.as_of_date ?? null,
    currency: data.meta?.currency ?? null,
    notes: data.meta?.notes ?? null,
  });

  console.log(`Ingested ${materials.length} materials and ${data.suppliers.length} suppliers.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
