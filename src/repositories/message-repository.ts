import { getDatabase } from "../database/database";

// ===================================================================
// Internal Messages Repository
//
// Backs the internal Messages system: a small in-app email analog
// that replaces the Dashboard Notification widget for non-Owner
// users, and carries the offline Account Recovery workflow's request/
// approval/credential-delivery traffic. Plain prepared statements only
// -- authorization and any business rules (who may message whom, etc)
// live one layer up, same convention as every other repository here.
// ===================================================================

export type MessageCategory = "general" | "account_recovery";

export type MessageRecord = {
  id: number;
  sender_id: number | null;
  sender_name: string;
  recipient_id: number;
  recipient_name: string;
  subject: string;
  body: string;
  category: MessageCategory;
  parent_message_id: number | null;
  is_read: number;
  deleted_by_sender: number;
  deleted_by_recipient: number;
  created_at: string;
  updated_at: string;
};

export interface CreateMessageInput {
  senderId: number | null;
  senderName: string;
  recipientId: number;
  recipientName: string;
  subject: string;
  body: string;
  category?: MessageCategory;
  parentMessageId?: number | null;
}

export function createMessage(input: CreateMessageInput): MessageRecord {

  const db = getDatabase();

  const result = db
    .prepare(`
      INSERT INTO messages
      (sender_id, sender_name, recipient_id, recipient_name, subject, body, category, parent_message_id)
      VALUES
      (@sender_id, @sender_name, @recipient_id, @recipient_name, @subject, @body, @category, @parent_message_id)
    `)
    .run({
      sender_id: input.senderId,
      sender_name: input.senderName,
      recipient_id: input.recipientId,
      recipient_name: input.recipientName,
      subject: input.subject.trim(),
      body: input.body,
      category: input.category ?? "general",
      parent_message_id: input.parentMessageId ?? null
    });

  return getMessageById(Number(result.lastInsertRowid)) as MessageRecord;

}

export function getMessageById(id: number): MessageRecord | undefined {

  const db = getDatabase();

  return db
    .prepare(`SELECT * FROM messages WHERE id = ?`)
    .get(id) as MessageRecord | undefined;

}

/** Inbox: messages received by this user, most recent first. */
export function getInboxForUser(userId: number): MessageRecord[] {

  const db = getDatabase();

  return db
    .prepare(`
      SELECT *
      FROM messages
      WHERE recipient_id = ?
        AND deleted_by_recipient = 0
      ORDER BY created_at DESC
    `)
    .all(userId) as MessageRecord[];

}

/** Sent: messages this user has sent, most recent first. */
export function getSentForUser(userId: number): MessageRecord[] {

  const db = getDatabase();

  return db
    .prepare(`
      SELECT *
      FROM messages
      WHERE sender_id = ?
        AND deleted_by_sender = 0
      ORDER BY created_at DESC
    `)
    .all(userId) as MessageRecord[];

}

export function getUnreadCountForUser(userId: number): number {

  const db = getDatabase();

  const row = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM messages
      WHERE recipient_id = ?
        AND deleted_by_recipient = 0
        AND is_read = 0
    `)
    .get(userId) as { count: number };

  return row.count;

}

export function markMessageRead(messageId: number, userId: number): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE messages
    SET is_read = 1
    WHERE id = @id
      AND recipient_id = @userId
  `).run({ id: messageId, userId });

}

/**
 * Edit: only the sender may edit their own message, and only while it
 * is still unread -- once the recipient has opened it, the record of
 * what they were actually told needs to stay intact.
 */
export function updateMessage(
  messageId: number,
  senderId: number,
  fields: { subject: string; body: string }
): { success: boolean; error?: string } {

  const db = getDatabase();

  const existing = getMessageById(messageId);

  if (!existing || existing.sender_id !== senderId) {
    return { success: false, error: "Message not found." };
  }

  if (existing.is_read) {
    return { success: false, error: "This message has already been read and can no longer be edited." };
  }

  db.prepare(`
    UPDATE messages
    SET subject = @subject,
        body = @body,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id: messageId, subject: fields.subject.trim(), body: fields.body });

  return { success: true };

}

/** Trash/Delete: soft-deletes from whichever side (sender or recipient) is calling. */
export function deleteMessageForUser(messageId: number, userId: number): { success: boolean } {

  const db = getDatabase();

  const message = getMessageById(messageId);

  if (!message) {
    return { success: false };
  }

  if (message.recipient_id === userId) {

    db.prepare(`UPDATE messages SET deleted_by_recipient = 1 WHERE id = ?`).run(messageId);

  }

  if (message.sender_id === userId) {

    db.prepare(`UPDATE messages SET deleted_by_sender = 1 WHERE id = ?`).run(messageId);

  }

  return { success: true };

}
