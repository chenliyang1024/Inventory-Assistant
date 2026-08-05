import { Material, Supplier, OrderResult } from '../types';
import { OrderDecision } from '../business';

/**
 * Storage boundary. Business rules (app/business.ts) never touch Firestore
 * directly -- they call these methods, which each backend implements its
 * own way. This is what lets the rule logic be unit tested with a plain
 * in-memory implementation instead of needing a live Firestore/emulator.
 */
export interface MaterialRepo {
  getMaterial(sku: string): Promise<Material | null>;

  /** Loose search across sku/description/category/spec_grade. */
  searchMaterials(query: string, category?: string, limit?: number): Promise<Material[]>;

  getSupplier(opts: { supplierId?: string; nameContains?: string }): Promise<Supplier | null>;

  /**
   * Atomically: re-read the material, run `evaluate` against it, and if the
   * decision is "fulfilled", persist the reservation increment + order
   * record in the same atomic operation. Returns the OrderResult either way.
   *
   * The Firestore implementation wraps this in a transaction so concurrent
   * orders can't both succeed against stock that only covers one of them.
   */
  placeOrder(
    sku: string,
    quantity: number,
    evaluate: (material: Material | null, quantity: number) => OrderDecision
  ): Promise<OrderResult>;
}
