export interface Material {
  sku: string;
  description: string;
  category: string | null;
  spec_grade: string | null;
  unit_of_measure: string | null;
  unit_price: number;
  currency: string | null;
  qty_on_hand: number;
  qty_reserved: number;
  reorder_point: number | null;
  min_order_qty: number | null;
  primary_supplier_id: string | null;
  warehouse: string | null;
  discontinued: boolean;
}

export interface MaterialView extends Material {
  qty_available_raw: number; // can be negative -- internal/reporting use
  qty_available: number;     // floored at 0 -- what we tell users
  over_allocated: boolean;
}

export interface Supplier {
  supplier_id: string;
  name: string;
  location: string | null;
  standard_lead_time_days: number | null;
  payment_terms: string | null;
}

export type OrderRejectionReason =
  | 'invalid_quantity'
  | 'unknown_sku'
  | 'discontinued'
  | 'insufficient_stock';

export interface OrderResult {
  status: 'fulfilled' | 'rejected';
  reason: OrderRejectionReason | null;
  sku: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  qty_available: number | null;
  order_id: string | null;
}
