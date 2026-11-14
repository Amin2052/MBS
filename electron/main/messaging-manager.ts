import {
  createMessage,
  getInboxForUser,
  getSentForUser,
  getMessageById,
  getUnreadCountForUser,
  markMessageRead,
  updateMessage,
  deleteMessageForUser,
  type MessageRecord,
  type MessageCategory
} from "../../src/repositories/message-repository";

import { listUsers, getUserById } from "../../src/repositories/user-repository";
import { getCurrentUser } from "./auth/auth-manager";
import { getCloudConfig } from "./cloud/cloud-config-service";
import { listCloudUsers, upsertCloudUser, sendCloudMessage, listCloudMessages, updateCloudMessage } from "./cloud/cloud-client";

// ===================================================================
// Internal Messaging Manager
//
// Single main-process authority for the Messages system (item 2 of
// the spec) -- same role/convention as password-reset-manager.ts and
// user-manager.ts. Every exported function re-derives the caller from
// the active session (getCurrentUser()) rather than trusting a userId
// the renderer supplied, so a message can never be read, sent, or
// deleted on someone else's behalf just because the renderer asked.
//
// Who may message whom: Owner and Administrator may message any
// active user. An Employee may only message an Administrator or the
// Owner -- this mirrors the "reviewer" concept in the recovery
// workflow (regular users escalate to admins/owner, they don't have a
// general employee-to-employee inbox), and is the same shape as most
// small internal support/helpdesk systems.
// ===================================================================

export interface SendMessageResult {
  success: boolean;
  message?: MessageRecord;
  error?: string;
}

const remoteRecipientMap = new Map<number, string>();
const remoteMessageMap = new Map<number, { remoteId: string; senderUsername: string | null; recipientUsername: string }>();

function remoteIdNumber(remoteId: string): number {
  let hash = 0;
  for (const char of remoteId) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return -Math.max(1, Math.abs(hash));
}

async function syncCurrentUserToCloud(caller: ReturnType<typeof getCurrentUser>): Promise<void> {
  if (!caller) return;
  try { await upsertCloudUser({ username: caller.username, full_name: caller.full_name || caller.username, user_type: caller.user_type, status: caller.status }); } catch {}
}

function requireCaller() {

  const caller = getCurrentUser();

  if (!caller) {
    throw new Error("Your session could not be verified. Please sign in again.");
  }

  return caller;

}

export interface MessageableRecipient {
  id: number;
  full_name: string;
  username: string;
  user_type: string;
}

/** Who the current user is allowed to compose a new message to. */
export async function listMessageableRecipients(): Promise<MessageableRecipient[]> {

  const caller = requireCaller();
  await syncCurrentUserToCloud(caller);
  const all = listUsers();
  const local = all
    .filter(user => {

      if (user.id === caller.id) return false;
      if (user.status !== "active") return false;

      if (caller.user_type === "owner" || caller.user_type === "administrator") {
        return true;
      }

      // Employees may only reach Administrators/Owner.
      return user.user_type === "administrator" || user.user_type === "owner";

    })
    .map(user => ({
      id: user.id,
      full_name: user.full_name || user.username,
      username: user.username,
      user_type: user.user_type
    }));

  try {
    const remoteUsers = await listCloudUsers();
    for (const user of remoteUsers) {
      if (user.username === caller.username || user.status !== "active") continue;
      const existing = local.find(candidate => candidate.username === user.username);
      if (existing) continue;
      if (caller.user_type !== "owner" && caller.user_type !== "administrator" && user.user_type !== "administrator" && user.user_type !== "owner") continue;
      const id = remoteIdNumber(user.username);
      remoteRecipientMap.set(id, user.username);
      local.push({ id, full_name: user.full_name || user.username, username: user.username, user_type: user.user_type });
    }
  } catch {}

  return local;

}

export async function sendMessage(
  recipientId: number,
  subject: string,
  body: string,
  category: MessageCategory = "general",
  parentMessageId: number | null = null
 ): Promise<SendMessageResult> {

  const caller = requireCaller();

  if (!subject.trim()) {
    return { success: false, error: "A subject is required." };
  }

  if (!body.trim()) {
    return { success: false, error: "A message body is required." };
  }

  // SECURITY: authorization MUST be checked before any cloud dispatch,
  // not only on the local-only fallback path below. listMessageableRecipients()
  // already encodes the role rule (Employee -> Administrator/Owner only) and
  // merges local + cloud-known users, so this also rejects forged/raw
  // recipient ids that don't correspond to any real, reachable user --
  // whether the target only exists locally or only exists in the cloud
  // users list.
  const recipients = await listMessageableRecipients();
  const target = recipients.find(candidate => candidate.id === recipientId);

  if (!target) {
    return { success: false, error: "You are not able to message this user." };
  }

  let cloudRecipientUsername = remoteRecipientMap.get(recipientId);
  if (!cloudRecipientUsername) {
    const localRecipient = getUserById(recipientId);
    cloudRecipientUsername = localRecipient?.username;
  }
  if (cloudRecipientUsername && getCloudConfig().enabled) {
    const recipientUsername = cloudRecipientUsername;
    try {
      await syncCurrentUserToCloud(caller);
      const remote = await sendCloudMessage({ sender_username: caller.username, sender_name: caller.full_name || caller.username, recipient_username: recipientUsername, subject: subject.trim(), body, category, parent_remote_id: parentMessageId ? remoteMessageMap.get(parentMessageId)?.remoteId || null : null }, caller.username);
      const remoteId = String(remote.remote_id);
      const syntheticId = remoteIdNumber(remoteId);
      const message = { id: syntheticId, sender_id: caller.id, sender_name: caller.full_name || caller.username, recipient_id: recipientId, recipient_name: recipientUsername, subject: subject.trim(), body, category, parent_message_id: parentMessageId, is_read: 0, deleted_by_sender: 0, deleted_by_recipient: 0, created_at: remote.created_at || new Date().toISOString(), updated_at: remote.created_at || new Date().toISOString() } as MessageRecord;
      remoteMessageMap.set(syntheticId, { remoteId, senderUsername: caller.username, recipientUsername });
      return { success: true, message };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : "Cloud messaging is unavailable." }; }
  }

  const recipient = getUserById(recipientId);

  if (!recipient || recipient.status !== "active") {
    return { success: false, error: "Recipient not found." };
  }

  const message = createMessage({
    senderId: caller.id,
    senderName: caller.full_name || caller.username,
    recipientId: recipient.id,
    recipientName: recipient.full_name || recipient.username,
    subject,
    body,
    category,
    parentMessageId
  });

  return { success: true, message };

}

/**
 * System-originated message (e.g. Account Recovery credential
 * delivery, or a new-request notice to a reviewer). Not exposed
 * directly over IPC -- only called from other main-process managers
 * (password-reset-manager.ts) that have already done their own
 * authorization. senderId is the acting Administrator/Owner where
 * there is one (credential delivery), or null for a pure system
 * notice with no individual actor.
 */
export function sendSystemMessage(
  senderId: number | null,
  senderName: string,
  recipientId: number,
  subject: string,
  body: string,
  category: MessageCategory = "account_recovery"
): void {

  const recipient = getUserById(recipientId);

  if (!recipient) {
    return;
  }

  createMessage({
    senderId,
    senderName,
    recipientId: recipient.id,
    recipientName: recipient.full_name || recipient.username,
    subject,
    body,
    category
  });

}

export async function getInbox(): Promise<MessageRecord[]> {

  const caller = requireCaller();
  const local = getInboxForUser(caller.id);
  try {
    await syncCurrentUserToCloud(caller);
    const remoteRows = await listCloudMessages(caller.username);
    for (const row of remoteRows) {
      if (row.recipient_username !== caller.username) continue;
      const duplicate = local.some(m => m.sender_name === row.sender_name && m.recipient_name === row.recipient_name && m.subject === row.subject && m.body === row.body && Math.abs(new Date(m.created_at).getTime() - new Date(row.created_at).getTime()) < 5000);
      if (duplicate) continue;
      const id = remoteIdNumber(String(row.remote_id));
      const sender = listUsers().find(u => u.username === row.sender_username);
      const msg = { id, sender_id: sender?.id ?? null, sender_name: row.sender_name, recipient_id: caller.id, recipient_name: caller.full_name || caller.username, subject: row.subject, body: row.body, category: row.category, parent_message_id: null, is_read: Number(row.is_read), deleted_by_sender: Number(row.deleted_by_sender), deleted_by_recipient: Number(row.deleted_by_recipient), created_at: row.created_at, updated_at: row.updated_at } as MessageRecord;
      remoteMessageMap.set(id, { remoteId: String(row.remote_id), senderUsername: row.sender_username || null, recipientUsername: row.recipient_username });
      local.push(msg);
    }
  } catch {}
  return local.sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));

}

export async function getSent(): Promise<MessageRecord[]> {

  const caller = requireCaller();
  const local = getSentForUser(caller.id);
  try {
    const remoteRows = await listCloudMessages(caller.username);
    for (const row of remoteRows) {
      if (row.sender_username !== caller.username) continue;
      const duplicate = local.some(m => m.recipient_name === row.recipient_name && m.subject === row.subject && m.body === row.body && Math.abs(new Date(m.created_at).getTime() - new Date(row.created_at).getTime()) < 5000);
      if (duplicate) continue;
      const id = remoteIdNumber(String(row.remote_id));
      const recipient = listUsers().find(u => u.username === row.recipient_username);
      const msg = { id, sender_id: caller.id, sender_name: caller.full_name || caller.username, recipient_id: recipient?.id ?? remoteIdNumber(String(row.recipient_username)), recipient_name: row.recipient_name, subject: row.subject, body: row.body, category: row.category, parent_message_id: null, is_read: Number(row.is_read), deleted_by_sender: Number(row.deleted_by_sender), deleted_by_recipient: Number(row.deleted_by_recipient), created_at: row.created_at, updated_at: row.updated_at } as MessageRecord;
      remoteMessageMap.set(id, { remoteId: String(row.remote_id), senderUsername: row.sender_username || null, recipientUsername: row.recipient_username });
      local.push(msg);
    }
  } catch {}
  return local.sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));

}

export async function getUnreadCount(): Promise<number> {

  const caller = requireCaller();
  let count = getUnreadCountForUser(caller.id);
  try {
    const remoteRows = await listCloudMessages(caller.username);
    count += remoteRows.filter(row => row.recipient_username === caller.username && Number(row.is_read) === 0 && Number(row.deleted_by_recipient) === 0).filter(row => !getInboxForUser(caller.id).some(m => m.sender_name === row.sender_name && m.subject === row.subject && m.body === row.body)).length;
  } catch {}
  return count;

}

export async function openMessage(messageId: number): Promise<MessageRecord | null> {

  const caller = requireCaller();

  if (remoteMessageMap.has(messageId)) {
    const remote = remoteMessageMap.get(messageId)!;
    try { await updateCloudMessage(remote.remoteId, { is_read: 1 }, caller.username); } catch {}
    const inbox = await getInbox();
    return inbox.find(m => m.id === messageId) || null;
  }

  const message = getMessageById(messageId);

  if (!message || (message.recipient_id !== caller.id && message.sender_id !== caller.id)) {
    return null;
  }

  if (message.recipient_id === caller.id && !message.is_read) {
    markMessageRead(messageId, caller.id);
    message.is_read = 1;
  }

  return message;

}

export async function replyToMessage(originalMessageId: number, body: string): Promise<SendMessageResult> {

  const caller = requireCaller();

  let original = getMessageById(originalMessageId);
  if (!original && remoteMessageMap.has(originalMessageId)) {
    const remote = remoteMessageMap.get(originalMessageId)!;
    const remoteRows = await listCloudMessages(caller.username).catch(() => []);
    const row = remoteRows.find(item => String(item.remote_id) === remote.remoteId);
    if (row) {
      original = { id: originalMessageId, sender_id: remote.senderUsername === caller.username ? caller.id : null, sender_name: row.sender_name, recipient_id: remote.recipientUsername === caller.username ? caller.id : remoteIdNumber(remote.recipientUsername), recipient_name: row.recipient_name, subject: row.subject, body: row.body, category: row.category, parent_message_id: null, is_read: Number(row.is_read), deleted_by_sender: Number(row.deleted_by_sender), deleted_by_recipient: Number(row.deleted_by_recipient), created_at: row.created_at, updated_at: row.updated_at } as MessageRecord;
    }
  }

  if (!original || (original.recipient_id !== caller.id && original.sender_id !== caller.id && !remoteMessageMap.has(originalMessageId))) {
    return { success: false, error: "Original message not found." };
  }

  const subject = original.subject.toLowerCase().startsWith("re:")
    ? original.subject
    : `Re: ${original.subject}`;

  if (remoteMessageMap.has(originalMessageId)) {
    const remote = remoteMessageMap.get(originalMessageId)!;
    const recipientUsername = remote.senderUsername === caller.username ? remote.recipientUsername : remote.senderUsername;
    if (!recipientUsername) return { success: false, error: "This message cannot be replied to." };
    const syntheticRecipientId = remoteIdNumber(recipientUsername);
    remoteRecipientMap.set(syntheticRecipientId, recipientUsername);
    return sendMessage(syntheticRecipientId, subject, body, "general", originalMessageId);
  }

  const replyRecipientId = original.sender_id === caller.id ? original.recipient_id : original.sender_id;
  if (replyRecipientId === null) return { success: false, error: "This message cannot be replied to." };
  return sendMessage(replyRecipientId, subject, body, "general", original.id);

}

export async function editMessage(
  messageId: number,
  subject: string,
  body: string
): { success: boolean; error?: string } {

  const caller = requireCaller();

  if (!subject.trim() || !body.trim()) {
    return { success: false, error: "Subject and message body are required." };
  }

  if (remoteMessageMap.has(messageId)) {
    try { await updateCloudMessage(remoteMessageMap.get(messageId)!.remoteId, { subject: subject.trim(), body }, caller.username); return { success: true }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : "Cloud message update failed." }; }
  }

  return updateMessage(messageId, caller.id, { subject, body });

}

export async function deleteMessage(messageId: number): Promise<{ success: boolean }> {

  const caller = requireCaller();
  if (remoteMessageMap.has(messageId)) {
    try { await updateCloudMessage(remoteMessageMap.get(messageId)!.remoteId, { deleted_by_sender: remoteMessageMap.get(messageId)!.senderUsername === caller.username ? 1 : 0, deleted_by_recipient: remoteMessageMap.get(messageId)!.recipientUsername === caller.username ? 1 : 0 }, caller.username); return { success: true }; }
    catch { return { success: false }; }
  }
  return deleteMessageForUser(messageId, caller.id);

}
