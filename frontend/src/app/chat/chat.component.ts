import { Component, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../core/chat.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
})
export class ChatComponent implements AfterViewChecked {
  draft = '';

  @ViewChild('scrollAnchor') private scrollAnchor?: ElementRef<HTMLDivElement>;

  constructor(public chat: ChatService) {}

  async submit(): Promise<void> {
    const text = this.draft;
    this.draft = '';
    await this.chat.send(text);
  }

  async resetDemo(): Promise<void> {
    if (!confirm('Reset the demo data? This clears all orders and reservations back to the original catalogue.')) {
      return;
    }
    await this.chat.resetDemo();
  }

  ngAfterViewChecked(): void {
    this.scrollAnchor?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
}
