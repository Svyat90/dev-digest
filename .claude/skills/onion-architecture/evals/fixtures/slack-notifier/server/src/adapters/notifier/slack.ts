import { WebClient } from '@slack/web-api';
import type { ChatPostMessageArguments, ChatPostMessageResponse } from '@slack/web-api';
import type { Notifier } from '@devdigest/shared';

export class SlackNotifier implements Notifier {
  private client: WebClient;

  constructor(token: string) {
    this.client = new WebClient(token);
  }

  postMessage(args: ChatPostMessageArguments): Promise<ChatPostMessageResponse> {
    return this.client.chat.postMessage(args);
  }
}
