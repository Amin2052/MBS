/**
 * Internal Messages — Renderer Service
 *
 * Pure renderer-side service, same pattern as auth-service.ts: no
 * Node/Electron logic here, only calls through the contextBridge API
 * on `window.mooral.messages`. All authorization (who may message
 * whom, who may read/edit/delete a given message) lives in the main
 * process's messaging-manager.ts.
 */

export async function listMessageableRecipients(): Promise<MessageableRecipient[]> {

  return window.mooral.messages.listRecipients();

}

export async function getInbox(): Promise<MessageRecord[]> {

  return window.mooral.messages.inbox();

}

export async function getSentMessages(): Promise<MessageRecord[]> {

  return window.mooral.messages.sent();

}

export async function getUnreadMessageCount(): Promise<number> {

  return window.mooral.messages.unreadCount();

}

export async function openMessage(id: number): Promise<MessageRecord | null> {

  return window.mooral.messages.open(id);

}

export async function sendMessage(
  recipientId: number,
  subject: string,
  body: string
): Promise<{ success: boolean; message?: MessageRecord; error?: string }> {

  return window.mooral.messages.send({ recipientId, subject, body });

}

export async function replyToMessage(
  messageId: number,
  body: string
): Promise<{ success: boolean; message?: MessageRecord; error?: string }> {

  return window.mooral.messages.reply({ messageId, body });

}

export async function editMessage(
  messageId: number,
  subject: string,
  body: string
): Promise<{ success: boolean; error?: string }> {

  return window.mooral.messages.edit({ messageId, subject, body });

}

export async function deleteMessage(messageId: number): Promise<{ success: boolean }> {

  return window.mooral.messages.delete(messageId);

}
