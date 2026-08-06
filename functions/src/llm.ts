/**
 * LLM layer: intent interpretation and reply phrasing only.
 *
 * Same design boundary as the rest of the system: the model picks which
 * deterministic tool to call and with what arguments, this module executes
 * it against Firestore (via queries.ts/business.ts), and the model's final
 * answer must restate only what the tool result contains. See README for
 * the full reasoning.
 *
 * Uses Gemini via the Gemini Developer API (API-key auth, free tier) rather
 * than Vertex AI -- no Cloud Billing account or Vertex AI enablement
 * required. The key is a Firebase Functions secret.
 */
import { GoogleGenAI, Type, Content, Part, Tool } from '@google/genai';
import { MaterialRepo } from './repos/materialRepo';
import { checkStock, searchMaterials, getSupplierForMaterial, placeOrder } from './queries';

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

const SYSTEM_PROMPT = `You are an inventory assistant for a construction material supplier.

You help staff check stock, look up supplier terms, and place orders.

Rules you must follow:
- Never state a quantity, price, or availability figure that did not come from a tool result in this conversation. If you have not called a tool for the specific SKU or supplier in question, call one before answering.
- If a search returns zero results, do not immediately conclude the item doesn't exist -- retry once with fewer or simpler terms (e.g. drop generic words like "beams"/"beam", keep the specific model or spec identifier) before deciding it's genuinely not in the catalogue.
- Distinguish clearly between two different situations: an item that is not in the catalogue at all (say it doesn't exist -- never substitute the nearest-sounding item and present it as a match), versus an item that IS in the catalogue but has zero or negative available stock (say it's not available / out of stock / over-allocated as applicable -- never say it "doesn't exist").
- "Available" stock means on-hand minus reserved. If a tool result marks an item as over-allocated, mention that plainly rather than just stating a number.
- If an order is rejected, state the reason in plain language and say what IS available instead.
- Be concise and direct. This is a working tool for warehouse/sales staff, not a sales pitch.`;

const TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'search_inventory',
        description:
          "Search the material catalogue by free-text query (matches SKU, description, category, or spec grade). Use this first when the user doesn't give an exact SKU, e.g. 'W12x40 beams' or '25M epoxy rebar'. Returns 0 results if nothing matches -- that means the item is not in the catalogue, not that you should guess.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: { type: Type.STRING, description: 'Free text search terms' },
            category: { type: Type.STRING, description: 'Optional category filter' },
          },
          required: ['query'],
        },
      },
      {
        name: 'check_stock',
        description: 'Look up full stock detail for one exact SKU, including derived availability.',
        parameters: {
          type: Type.OBJECT,
          properties: { sku: { type: Type.STRING } },
          required: ['sku'],
        },
      },
      {
        name: 'place_order',
        description:
          'Attempt to place a customer order for an exact SKU and quantity. Enforces stock, discontinued, and unknown-SKU rules. Returns fulfilled or rejected with a reason.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            sku: { type: Type.STRING },
            quantity: { type: Type.NUMBER },
          },
          required: ['sku', 'quantity'],
        },
      },
      {
        name: 'get_supplier_info',
        description:
          'Get payment terms and standard lead time for the supplier of a given SKU, or by supplier name directly.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            sku: { type: Type.STRING, description: 'Look up the supplier via this SKU' },
            supplier_name: { type: Type.STRING, description: 'Or look up by supplier name' },
          },
        },
      },
    ],
  },
];

interface ToolCallLogEntry {
  tool: string;
  input: Record<string, unknown>;
  result: unknown;
}

/** History as sent by the frontend: role + plain text, independent of any provider's wire format. */
export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

function toGeminiHistory(history: HistoryTurn[]): Content[] {
  return history.map((turn) => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: turn.content }],
  }));
}

async function executeTool(repo: MaterialRepo, name: string, input: Record<string, any>): Promise<unknown> {
  switch (name) {
    case 'search_inventory': {
      const results = await searchMaterials(repo, input.query ?? '', input.category);
      return { count: results.length, results };
    }
    case 'check_stock': {
      const material = await checkStock(repo, input.sku);
      return material ? { found: true, ...material } : { found: false, sku: input.sku };
    }
    case 'place_order': {
      return placeOrder(repo, input.sku, input.quantity);
    }
    case 'get_supplier_info': {
      const supplier = input.sku
        ? await getSupplierForMaterial(repo, input.sku)
        : await repo.getSupplier({ nameContains: input.supplier_name });
      return supplier ? { found: true, ...supplier } : { found: false };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

export interface ChatResult {
  reply: string;
  toolCalls: ToolCallLogEntry[];
}

export async function chat(
  repo: MaterialRepo,
  userMessage: string,
  history: HistoryTurn[] = [],
  apiKey?: string
): Promise<ChatResult> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  const ai = new GoogleGenAI({ apiKey: key });
  const chatSession = ai.chats.create({
    model: MODEL,
    config: { systemInstruction: SYSTEM_PROMPT, tools: TOOLS },
    history: toGeminiHistory(history),
  });

  const toolCallLog: ToolCallLogEntry[] = [];
  let result = await chatSession.sendMessage({ message: userMessage });

  // Bounded loop to avoid runaway back-and-forth on an ambiguous question.
  for (let i = 0; i < 6; i++) {
    const calls = result.functionCalls;

    if (!calls || calls.length === 0) {
      return { reply: result.text ?? '', toolCalls: toolCallLog };
    }

    const functionResponses: Part[] = [];
    for (const call of calls) {
      const name = call.name!;
      const args = (call.args as Record<string, any>) ?? {};
      const toolResult = await executeTool(repo, name, args);
      toolCallLog.push({ tool: name, input: args, result: toolResult });
      functionResponses.push({ functionResponse: { name, response: toolResult as Record<string, unknown> } });
    }

    result = await chatSession.sendMessage({ message: functionResponses });
  }

  return {
    reply: "I wasn't able to resolve that in time -- please rephrase or try a simpler question.",
    toolCalls: toolCallLog,
  };
}
