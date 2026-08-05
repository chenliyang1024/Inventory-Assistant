/**
 * Pure business logic. No Firestore, no network, no I/O.
 * Every function here takes plain data in and returns plain data out,
 * so it can be unit tested directly (see tests/run-tests.ts) without a
 * live Firestore instance or emulator.
 */
import { Material, MaterialView, OrderResult, OrderRejectionReason } from './types';

export function computeAvailability(m: Material): {
  raw: number;
  available: number;
  overAllocated: boolean;
} {
  const raw = m.qty_on_hand - m.qty_reserved;
  return { raw, available: Math.max(raw, 0), overAllocated: raw < 0 };
}

export function toMaterialView(m: Material): MaterialView {
  const { raw, available, overAllocated } = computeAvailability(m);
  return {
    ...m,
    qty_available_raw: raw,
    qty_available: available,
    over_allocated: overAllocated,
  };
}

/** Loose, case-insensitive, all-terms-must-match substring search. */
export function materialMatchesQuery(m: Material, query: string, category?: string): boolean {
  if (category && m.category !== category) return false;
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [m.sku, m.description, m.category, m.spec_grade]
    .filter((v): v is string => !!v)
    .join(' ')
    .toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

export interface OrderDecision {
  status: 'fulfilled' | 'rejected';
  reason: OrderRejectionReason | null;
  unit_price: number | null;
  line_total: number | null;
  qty_available: number | null;
}

/**
 * Pure rule evaluation: given a material snapshot (or null if the SKU
 * doesn't exist) and a requested quantity, decide the outcome. No writes
 * happen here -- this just decides. Rule order matters for which message
 * the user sees when multiple rules would apply (unknown -> discontinued
 * -> insufficient stock -> success), matching the spec's rule list order.
 */
export function evaluateOrder(material: Material | null, quantity: number): OrderDecision {
  if (!quantity || quantity <= 0) {
    return { status: 'rejected', reason: 'invalid_quantity', unit_price: null, line_total: null, qty_available: null };
  }
  if (!material) {
    return { status: 'rejected', reason: 'unknown_sku', unit_price: null, line_total: null, qty_available: null };
  }

  const { available } = computeAvailability(material);

  if (material.discontinued) {
    return { status: 'rejected', reason: 'discontinued', unit_price: material.unit_price, line_total: null, qty_available: available };
  }
  if (quantity > available) {
    return { status: 'rejected', reason: 'insufficient_stock', unit_price: material.unit_price, line_total: null, qty_available: available };
  }

  const lineTotal = Math.round(material.unit_price * quantity * 100) / 100;
  return { status: 'fulfilled', reason: null, unit_price: material.unit_price, line_total: lineTotal, qty_available: available };
}

export function decisionToResult(
  decision: OrderDecision,
  sku: string,
  quantity: number,
  orderId: string | null
): OrderResult {
  return {
    status: decision.status,
    reason: decision.reason,
    sku,
    quantity,
    unit_price: decision.unit_price,
    line_total: decision.line_total,
    // For a fulfilled order, report what's left AFTER this order; for a
    // rejection, decision.qty_available already holds "what IS available".
    qty_available:
      decision.status === 'fulfilled' && decision.qty_available !== null
        ? decision.qty_available - quantity
        : decision.qty_available,
    order_id: orderId,
  };
}
