import { useEffect, useMemo, useState } from "react";

import { Mail, Search, X, Trash2, Reply, Pencil, SendHorizontal, Inbox as InboxIcon } from "lucide-react";

import {
  getInbox,
  getSentMessages,
  openMessage,
  sendMessage,
  replyToMessage,
  editMessage,
  deleteMessage,
  listMessageableRecipients
} from "@/services/message-service";

import "./messages-card.css";

import { useLanguage } from "@/hooks/use-language";

// ===================================================================
// Dashboard Messages Card
//
// Replaces the Notification widget for non-Owner users (Admin/
// General dashboards). Deliberately compact: the list only ever shows
// a Subject line (never the body) -- opening a message is a separate,
// explicit action, same "preview vs full view" split the spec calls
// for. Read/unread is tracked server-side (messages:open marks read);
// this component just reflects it with a highlight class.
// ===================================================================

type ViewTab = "inbox" | "sent";

export default function MessagesCard(): JSX.Element {

  const { t } = useLanguage();
  const [tab, setTab] = useState<ViewTab>("inbox");
  const [inbox, setInbox] = useState<MessageRecord[]>([]);
  const [sent, setSent] = useState<MessageRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [openMessageRecord, setOpenMessageRecord] = useState<MessageRecord | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeReplyTo, setComposeReplyTo] = useState<MessageRecord | null>(null);
  const [editingMessage, setEditingMessage] = useState<MessageRecord | null>(null);

  async function reload(): Promise<void> {

    try {

      const [inboxRows, sentRows] = await Promise.all([getInbox(), getSentMessages()]);

      setInbox(inboxRows);
      setSent(sentRows);

    }
    catch (error) {

      console.error("Failed to load messages", error);

    }
    finally {

      setLoading(false);

    }

  }

  useEffect(() => {

    reload();

  }, []);

  const rows = tab === "inbox" ? inbox : sent;

  const filteredRows = useMemo(() => {

    const normalized = search.trim().toLowerCase();

    if (!normalized) return rows;

    return rows.filter(row => row.subject.toLowerCase().includes(normalized));

  }, [rows, search]);

  const unreadCount = useMemo(
    () => inbox.filter(row => !row.is_read).length,
    [inbox]
  );

  async function handleOpenSubject(row: MessageRecord): Promise<void> {

    if (tab === "sent") {
      setOpenMessageRecord(row);
      return;
    }

    const full = await openMessage(row.id);

    if (full) {
      setOpenMessageRecord(full);
      await reload();
    }

  }

  async function handleDelete(id: number): Promise<void> {

    await deleteMessage(id);
    await reload();

    if (openMessageRecord?.id === id) {
      setOpenMessageRecord(null);
    }

  }

  function handleReplyFromPopup(): void {

    if (!openMessageRecord) return;

    setComposeReplyTo(openMessageRecord);
    setEditingMessage(null);
    setOpenMessageRecord(null);
    setComposeOpen(true);

  }

  function handleEdit(row: MessageRecord): void {

    setEditingMessage(row);
    setComposeReplyTo(null);
    setComposeOpen(true);

  }

  function handleNewMessage(): void {

    setComposeReplyTo(null);
    setEditingMessage(null);
    setComposeOpen(true);

  }

  return (
    <div className="dashboard-box dashboard-box-messages">

      <div className="box-header">
        <h2>
          {t("messagesCard.title")}
          {unreadCount > 0 ? <span className="messages-unread-pill">{unreadCount}</span> : null}
        </h2>
        <button className="messages-new-btn" onClick={handleNewMessage} title={t("messagesCard.createNewMessage")}>
          <SendHorizontal size={14} />
          {t("messagesCard.newButton")}
        </button>
      </div>

      <div className="messages-tabs">
        <button
          className={`messages-tab-btn ${tab === "inbox" ? "active" : ""}`}
          onClick={() => setTab("inbox")}
        >
          <InboxIcon size={13} />
          {t("messagesCard.inbox")}
        </button>
        <button
          className={`messages-tab-btn ${tab === "sent" ? "active" : ""}`}
          onClick={() => setTab("sent")}
        >
          {t("messagesCard.sent")}
        </button>
      </div>

      <div className="search-box messages-search">
        <Search size={16} />
        <input
          type="text"
          dir="ltr"
          placeholder={t("messagesCard.searchSubject")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="messages-list">

        {loading && <div className="dashboard-box-empty">{t("messagesCard.loadingMessages")}</div>}

        {!loading && filteredRows.length === 0 && (
          <div className="dashboard-box-empty">
            {tab === "inbox" ? t("messagesCard.noMessagesYet") : t("messagesCard.noSentMessagesYet")}
          </div>
        )}

        {filteredRows.map(row => {

          const isUnread = tab === "inbox" && !row.is_read;
          const canEdit = tab === "sent" && !row.is_read;

          return (
            <div className={`message-row ${isUnread ? "message-row-unread" : ""}`} key={row.id}>

              <button className="message-row-main" onClick={() => handleOpenSubject(row)}>
                <Mail size={14} />
                <span className="message-row-subject">{row.subject}</span>
                <span className="message-row-from">
                  {tab === "inbox" ? row.sender_name : row.recipient_name}
                </span>
              </button>

              {canEdit && (
                <button className="message-icon-btn" title={t("messagesCard.editMessageTitle")} onClick={() => handleEdit(row)}>
                  <Pencil size={13} />
                </button>
              )}

              <button className="message-icon-btn" title={t("common.delete")} onClick={() => handleDelete(row.id)}>
                <Trash2 size={13} />
              </button>

            </div>
          );

        })}

      </div>

      {openMessageRecord ? (
        <MessagePopup
          message={openMessageRecord}
          onClose={() => setOpenMessageRecord(null)}
          onReply={handleReplyFromPopup}
        />
      ) : null}

      {composeOpen ? (
        <ComposeModal
          replyTo={composeReplyTo}
          editing={editingMessage}
          onClose={() => { setComposeOpen(false); setComposeReplyTo(null); setEditingMessage(null); }}
          onSent={async () => { setComposeOpen(false); setComposeReplyTo(null); setEditingMessage(null); await reload(); }}
        />
      ) : null}

    </div>
  );

}

function MessagePopup({
  message,
  onClose,
  onReply
}: {
  message: MessageRecord;
  onClose: () => void;
  onReply: () => void;
}): JSX.Element {

  const { t } = useLanguage();

  return (
    <div className="message-modal-overlay">
      <div className="message-modal" onClick={event => event.stopPropagation()}>

        <div className="message-modal-header">
          <h3><Mail size={16} /> {message.subject}</h3>
          <button className="message-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="message-modal-meta">
          <div><span>{t("messagesCard.fromLabel")}</span><strong>{message.sender_name}</strong></div>
          <div><span>{t("messagesCard.toLabel")}</span><strong>{message.recipient_name}</strong></div>
          <div><span>{t("common.date")}</span><strong>{new Date(message.created_at).toLocaleString()}</strong></div>
        </div>

        <div className="message-modal-body">
          {message.body}
        </div>

        <div className="message-modal-actions">
          <button className="save-btn" onClick={onReply}>
            <Reply size={14} />
            {t("messagesCard.reply")}
          </button>
          <button className="cancel-btn" onClick={onClose}>{t("messagesCard.close")}</button>
        </div>

      </div>
    </div>
  );

}

function ComposeModal({
  replyTo,
  editing,
  onClose,
  onSent
}: {
  replyTo: MessageRecord | null;
  editing: MessageRecord | null;
  onClose: () => void;
  onSent: () => void;
}): JSX.Element {

  const { t } = useLanguage();
  const [recipients, setRecipients] = useState<MessageableRecipient[]>([]);
  const [recipientId, setRecipientId] = useState<number | "">(
    editing ? editing.recipient_id : ""
  );
  const [subject, setSubject] = useState(editing ? editing.subject : replyTo ? `Re: ${replyTo.subject.replace(/^re:\s*/i, "")}` : "");
  const [body, setBody] = useState(editing ? editing.body : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {

    if (!replyTo && !editing) {
      listMessageableRecipients().then(setRecipients);
    }

  }, [replyTo, editing]);

  async function handleSubmit(): Promise<void> {

    if (!body.trim()) {
      setError(t("messagesCard.bodyRequired"));
      return;
    }

    if (!editing && !replyTo && !recipientId) {
      setError(t("messagesCard.recipientRequired"));
      return;
    }

    if (!editing && !subject.trim()) {
      setError(t("messagesCard.subjectRequired"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {

      const result = editing
        ? await editMessage(editing.id, subject, body)
        : replyTo
          ? await replyToMessage(replyTo.id, body)
          : await sendMessage(Number(recipientId), subject, body);

      if (result.success) {
        onSent();
      }
      else {
        setError(result.error ?? t("forgotUsername.genericError"));
      }

    }
    finally {

      setSubmitting(false);

    }

  }

  return (
    <div className="message-modal-overlay">
      <div className="message-modal" onClick={event => event.stopPropagation()}>

        <div className="message-modal-header">
          <h3><SendHorizontal size={16} /> {editing ? t("messagesCard.editMessageHeading") : replyTo ? `${t("messagesCard.replyToHeading")} ${replyTo.sender_name}` : t("messagesCard.newMessageHeading")}</h3>
          <button className="message-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {!replyTo && !editing ? (
          <div className="form-group">
            <label>{t("messagesCard.recipient")}</label>
            <select
              dir="ltr"
              value={recipientId}
              onChange={e => setRecipientId(e.target.value ? Number(e.target.value) : "")}
              disabled={submitting}
            >
              <option value="">{t("messagesCard.selectRecipient")}</option>
              {recipients.map(recipient => (
                <option value={recipient.id} key={recipient.id}>
                  {recipient.full_name} ({recipient.user_type})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {!replyTo ? (
          <div className="form-group">
            <label>{t("messagesCard.subject")}</label>
            <input
              type="text"
              dir="ltr"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              disabled={submitting}
            />
          </div>
        ) : null}

        <div className="form-group">
          <label>{t("messagesCard.message")}</label>
          <textarea
            dir="ltr"
            rows={5}
            value={body}
            onChange={e => setBody(e.target.value)}
            disabled={submitting}
          />
        </div>

        {error ? <p className="settings-error-message">{error}</p> : null}

        <div className="message-modal-actions">
          <button className="save-btn" onClick={handleSubmit} disabled={submitting}>
            {submitting ? t("messagesCard.sending") : editing ? t("profile.saveChanges") : t("messagesCard.send")}
          </button>
          <button className="cancel-btn" onClick={onClose} disabled={submitting}>{t("common.cancel")}</button>
        </div>

      </div>
    </div>
  );

}
