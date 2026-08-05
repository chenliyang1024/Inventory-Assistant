import { getFirestore, Firestore, Transaction, DocumentData } from 'firebase-admin/firestore';
import { Material, Supplier, OrderResult } from '../types';
import { OrderDecision, decisionToResult, materialMatchesQuery } from '../business';
import { MaterialRepo } from './materialRepo';

const MATERIALS_COLLECTION = 'materials';
const SUPPLIERS_COLLECTION = 'suppliers';
const ORDERS_COLLECTION = 'orders';

function docToMaterial(id: string, data: DocumentData): Material {
  return {
    sku: id,
    description: data.description,
    category: data.category ?? null,
    spec_grade: data.spec_grade ?? null,
    unit_of_measure: data.unit_of_measure ?? null,
    unit_price: data.unit_price,
    currency: data.currency ?? null,
    qty_on_hand: data.qty_on_hand,
    qty_reserved: data.qty_reserved,
    reorder_point: data.reorder_point ?? null,
    min_order_qty: data.min_order_qty ?? null,
    primary_supplier_id: data.primary_supplier_id ?? null,
    warehouse: data.warehouse ?? null,
    discontinued: !!data.discontinued,
  };
}

function docToSupplier(id: string, data: DocumentData): Supplier {
  return {
    supplier_id: id,
    name: data.name,
    location: data.location ?? null,
    standard_lead_time_days: data.standard_lead_time_days ?? null,
    payment_terms: data.payment_terms ?? null,
  };
}

export class FirestoreRepo implements MaterialRepo {
  private db: Firestore;

  // Small catalogue (tens to low hundreds of SKUs) -- cached per warm
  // function instance rather than re-read on every search. See README
  // for what changes once the catalogue grows past this scale.
  private materialsCache: Material[] | null = null;
  private cacheLoadedAt = 0;
  private readonly CACHE_TTL_MS = 60_000;

  constructor(db?: Firestore) {
    this.db = db ?? getFirestore();
  }

  private async loadAllMaterials(): Promise<Material[]> {
    const fresh = Date.now() - this.cacheLoadedAt < this.CACHE_TTL_MS;
    if (this.materialsCache && fresh) return this.materialsCache;

    const snap = await this.db.collection(MATERIALS_COLLECTION).get();
    const loaded = snap.docs.map((d) => docToMaterial(d.id, d.data() as DocumentData));
    this.materialsCache = loaded;
    this.cacheLoadedAt = Date.now();
    return loaded;
  }

  async getMaterial(sku: string): Promise<Material | null> {
    const doc = await this.db.collection(MATERIALS_COLLECTION).doc(sku).get();
    if (!doc.exists) return null;
    return docToMaterial(doc.id, doc.data()!);
  }

  async searchMaterials(query: string, category?: string, limit = 10): Promise<Material[]> {
    const all = await this.loadAllMaterials();
    const out: Material[] = [];
    for (const m of all) {
      if (materialMatchesQuery(m, query, category)) {
        out.push(m);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  async getSupplier(opts: { supplierId?: string; nameContains?: string }): Promise<Supplier | null> {
    if (opts.supplierId) {
      const doc = await this.db.collection(SUPPLIERS_COLLECTION).doc(opts.supplierId).get();
      return doc.exists ? docToSupplier(doc.id, doc.data()!) : null;
    }
    if (opts.nameContains) {
      const needle = opts.nameContains.toLowerCase();
      const snap = await this.db.collection(SUPPLIERS_COLLECTION).get();
      for (const doc of snap.docs) {
        const s = docToSupplier(doc.id, doc.data());
        if (s.name.toLowerCase().includes(needle)) return s;
      }
    }
    return null;
  }

  async placeOrder(
    sku: string,
    quantity: number,
    evaluate: (material: Material | null, quantity: number) => OrderDecision
  ): Promise<OrderResult> {
    const materialRef = this.db.collection(MATERIALS_COLLECTION).doc(sku);

    const result = await this.db.runTransaction(async (tx: Transaction) => {
      const doc = await tx.get(materialRef);
      const material = doc.exists ? docToMaterial(doc.id, doc.data()!) : null;

      // Re-run the exact same rule evaluation used everywhere else, but
      // against data read INSIDE this transaction -- this is what makes
      // it safe against two orders racing for the same last unit.
      const decision = evaluate(material, quantity);

      if (decision.status !== 'fulfilled' || !material) {
        return decisionToResult(decision, sku, quantity, null);
      }

      const orderRef = this.db.collection(ORDERS_COLLECTION).doc();
      tx.update(materialRef, { qty_reserved: material.qty_reserved + quantity });
      tx.set(orderRef, {
        sku,
        quantity,
        unit_price: decision.unit_price,
        line_total: decision.line_total,
        created_at: new Date().toISOString(),
      });

      return decisionToResult(decision, sku, quantity, orderRef.id);
    });

    // Invalidate the cache so a subsequent search/check_stock reflects
    // the just-placed order rather than a stale cached snapshot.
    this.materialsCache = null;

    return result;
  }
}
