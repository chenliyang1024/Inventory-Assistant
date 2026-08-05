import { MaterialRepo } from './repos/materialRepo';
import { toMaterialView, evaluateOrder } from './business';
import { MaterialView, Supplier, OrderResult } from './types';

export async function checkStock(repo: MaterialRepo, sku: string): Promise<MaterialView | null> {
  const m = await repo.getMaterial(sku);
  return m ? toMaterialView(m) : null;
}

export async function searchMaterials(
  repo: MaterialRepo,
  query: string,
  category?: string
): Promise<MaterialView[]> {
  const results = await repo.searchMaterials(query, category);
  return results.map(toMaterialView);
}

export async function getSupplierForMaterial(repo: MaterialRepo, sku: string): Promise<Supplier | null> {
  const m = await repo.getMaterial(sku);
  if (!m || !m.primary_supplier_id) return null;
  return repo.getSupplier({ supplierId: m.primary_supplier_id });
}

export async function placeOrder(repo: MaterialRepo, sku: string, quantity: number): Promise<OrderResult> {
  return repo.placeOrder(sku, quantity, evaluateOrder);
}
