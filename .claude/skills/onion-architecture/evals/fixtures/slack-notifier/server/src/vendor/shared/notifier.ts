import type { ChatPostMessageArguments, ChatPostMessageResponse } from '@slack/web-api';

export interface Notifier {
  postMessage(args: ChatPostMessageArguments): Promise<ChatPostMessageResponse>;
}
