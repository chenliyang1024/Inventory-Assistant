import { Material, Supplier, OrderResult } from '../types';
import { MaterialRepo } from './materialRepo';
import { OrderDecision, decisionToResult, materialMatchesQuery } from '../business';

export class InMemoryRepo implements MaterialRepo {
  private materials = new Map<string, Material>();
  private suppliers = new Map<string, Supplier>();
  private orders: { sku: string; quantity: number; unit_price: number; line_total: number }[] = [];
  private nextOrderId = 1;

  static fromDataset(data: { suppliers: any[]; materials: any[] }): InMemoryRepo {
    const repo = new InMemoryRepo();
    for (const s of data.suppliers) {
      repo.suppliers.set(s.supplier_id, {
        supplier_id: s.supplier_id,
        name: s.name,
        location: s.location ?? null,
        standard_lead_time_days: s.standard_lead_time_days ?? null,
        payment_terms: s.payment_terms ?? null,
      });
    }
    for (const m of data.materials) {
      repo.materials.set(m.sku, {
        sku: m.sku,
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
    return repo;
  }

  async getMaterial(sku: string): Promise<Material | null> {
    return this.materials.get(sku) ?? null;
  }

  async searchMaterials(query: string, category?: string, limit = 10): Promise<Material[]> {
    const out: Material[] = [];
    for (const m of this.materials.values()) {
      if (materialMatchesQuery(m, query, category)) {
        out.push(m);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  async getSupplier(opts: { supplierId?: string; nameContains?: string }): Promise<Supplier | null> {
    if (opts.supplierId) return this.suppliers.get(opts.supplierId) ?? null;
    if (opts.nameContains) {
      const needle = opts.nameContains.toLowerCase();
      for (const s of this.suppliers.values()) {
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
    const material = this.materials.get(sku) ?? null;
    const decision = evaluate(material, quantity);

    if (decision.status !== 'fulfilled' || !material) {
      return decisionToResult(decision, sku, quantity, null);
    }

    const orderId = String(this.nextOrderId++);
    this.orders.push({ sku, quantity, unit_price: material.unit_price, line_total: decision.line_total! });
    material.qty_reserved += quantity; // on_hand untouched, per spec rule 2

    return decisionToResult(decision, sku, quantity, orderId);
  }

  // test helper
  getOrders() {
    return this.orders;
  }
}
