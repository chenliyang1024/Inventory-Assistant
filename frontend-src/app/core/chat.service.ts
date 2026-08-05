import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  reply: string;
  tool_calls?: unknown[];
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  // Exposed as a signal so the component can render reactively without
  // wiring up its own subscription management.
  readonly messages = signal<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hi — I can check stock, look up supplier terms, or place an order against the live inventory. Try: "Do we have any W12x40 beams available?"',
    },
  ]);
  readonly pending = signal(false);
  readonly error = signal<string | null>(null);

  // History sent back to the API on each turn, in Claude's message format.
  // Kept separate from `messages` (which is display-shaped) so a change to
  // one doesn't require reshaping the other.
  private apiHistory: { role: 'user' | 'assistant'; content: string }[] = [];

  constructor(private http: HttpClient) {}

  async send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.pending()) return;

    this.error.set(null);
    this.messages.update((msgs) => [...msgs, { role: 'user', content: trimmed }]);
    this.pending.set(true);

    try {
      const res = await firstValueFrom(
        this.http.post<ChatResponse>('/api/chat', { message: trimmed, history: this.apiHistory })
      );
      this.messages.update((msgs) => [...msgs, { role: 'assistant', content: res.reply }]);
      this.apiHistory.push({ role: 'user', content: trimmed });
      this.apiHistory.push({ role: 'assistant', content: res.reply });
    } catch (err: any) {
      this.error.set(err?.error?.error || 'Something went wrong talking to the assistant.');
    } finally {
      this.pending.set(false);
    }
  }
}
