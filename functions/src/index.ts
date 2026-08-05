import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import express, { Request, Response } from 'express';

import { FirestoreRepo } from './repos/firestoreRepo';
import { checkStock, searchMaterials, getSupplierForMaterial, placeOrder } from './queries';
import { chat as runChat } from './llm';

initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

const app = express();
app.use(express.json());

function repo() {
  return new FirestoreRepo();
}

// Firebase Hosting rewrites forward the full original path (e.g. /api/materials/SKU-1)
// to this function, so routes are declared with the /api prefix included.

app.get('/api/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));

app.get('/api/materials/:sku', async (req: Request, res: Response) => {
  const material = await checkStock(repo(), req.params.sku);
  if (!material) return res.status(404).json({ found: false, sku: req.params.sku });
  res.json({ found: true, ...material });
});

app.get('/api/materials', async (req: Request, res: Response) => {
  const query = String(req.query.q || '');
  const category = req.query.category ? String(req.query.category) : undefined;
  const results = await searchMaterials(repo(), query, category);
  res.json({ count: results.length, results });
});

app.post('/api/orders', async (req: Request, res: Response) => {
  const { sku, quantity } = req.body || {};
  if (!sku || quantity === undefined) {
    return res.status(400).json({ status: 'rejected', reason: 'invalid_request' });
  }
  const result = await placeOrder(repo(), sku, quantity);
  res.status(result.status === 'fulfilled' ? 201 : 400).json(result);
});

app.get('/api/suppliers/:supplierId', async (req: Request, res: Response) => {
  const supplier = await repo().getSupplier({ supplierId: req.params.supplierId });
  if (!supplier) return res.status(404).json({ found: false });
  res.json({ found: true, ...supplier });
});

app.post('/api/chat', async (req: Request, res: Response) => {
  const { message, history } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  try {
    const result = await runChat(repo(), message, history || [], GEMINI_API_KEY.value());
    res.json({ reply: result.reply, tool_calls: result.toolCalls });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'chat failed' });
  }
});

export const api = onRequest({ secrets: [GEMINI_API_KEY] }, app);
