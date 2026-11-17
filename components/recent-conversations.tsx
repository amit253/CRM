"use client";

import { useMemo, useRef, useState } from "react";

type Account = {
  id: string;
  name: string;
  provider: string;
  status: string;
};

type ConversationMessage = {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
};

type RecentConversation = {
  key: string;
  id: string;
  accountId: string;
  accountName: string;
  provider: string;
  channel: string;
  kind: "email" | "chat";
  title: string;
  sender: string;
  recipientEmail: string;
  preview: string;
  timestamp: string;
  messages: ConversationMessage[];
};

type RecentConversationsProps = {
  enabled: boolean;
  onUseConversation: (transcript: string, sender: string, title: string, metadata?: { channel: string; kind: "email" | "chat"; accountId: string; conversationId: string; recipientEmail: string; subject: string }) => void;
};

const emailProviders = new Set(["google", "gmail", "outlook", "microsoft", "imap"]);
const providerLabels: Record<string, string> = {
  google: "Gmail",
  gmail: "Gmail",
  outlook: "Outlook",
  microsoft: "Outlook",
  imap: "Email",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  instagram: "Instagram",
  facebook: "Facebook",
};

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  const item = object(value);
  if (!item) return "";
  for (const key of ["display_name", "name", "email", "address", "text", "body", "subject", "username"]) {
    const result = text(item[key]);
    if (result) return result;
  }
  return "";
}

function emailAddress(value: unknown): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const email = emailAddress(item);
      if (email) return email;
    }
    return "";
  }
  if (typeof value === "string") {
    return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  }
  const item = object(value);
  if (!item) return "";
  for (const key of ["email", "address", "identifier", "from", "sender"]) {
    const email = emailAddress(item[key]);
    if (email) return email;
  }
  return "";
}

function listData(value: unknown): Record<string, unknown>[] {
  const rows = object(value)?.data;
  if (!Array.isArray(rows)) {
    throw new Error("Unipile returned an unexpected response; expected a data list.");
  }
  const items = rows.map(object);
  if (items.some((item) => item === null)) {
    throw new Error("Unipile returned an invalid item in the data list.");
  }
  return items.filter((item): item is Record<string, unknown> => item !== null);
}

function plainText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function channelName(provider: string): string {
  const normalized = provider.toLowerCase();
  return providerLabels[normalized] ?? provider;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`/api/unipile/bridge${path}`, { cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = object(body)?.detail ?? object(body)?.error;
    throw new Error(typeof detail === "string" ? detail : `Inbox request failed (${response.status}).`);
  }
  return body;
}

function messageFromEmail(raw: Record<string, unknown>, index: number, fallbackSender: string): ConversationMessage {
  return {
    id: text(raw.id) || `email-${index}`,
    sender: text(raw.from) || text(raw.sender) || fallbackSender,
    text: plainText(text(raw.body_plain) || text(raw.body) || text(raw.snippet) || text(raw.subject)),
    timestamp: text(raw.date) || text(raw.timestamp) || text(raw.created_at),
  };
}

function mapEmails(rows: Record<string, unknown>[], account: Account): RecentConversation[] {
  const threads = new Map<string, { rows: Record<string, unknown>[]; id: string }>();
  for (const raw of rows) {
    const id = text(raw.id);
    if (!id) continue;
    const threadId = text(raw.thread_id) || text(raw.threadId) || id;
    const existing = threads.get(threadId);
    if (existing) existing.rows.push(raw);
    else threads.set(threadId, { id: threadId, rows: [raw] });
  }

  return [...threads.values()].map(({ id, rows: threadRows }) => {
    const sorted = threadRows.sort((left, right) =>
      (Date.parse(text(left.date) || text(left.timestamp)) || 0) -
      (Date.parse(text(right.date) || text(right.timestamp)) || 0),
    );
    const latest = sorted[sorted.length - 1];
    const messages = sorted.map((row, index) => messageFromEmail(row, index, account.name))
      .filter((message) => message.text);
    const sender = text(latest.from) || text(latest.sender) || account.name;
    const channel = channelName(account.provider);
    return {
      key: `${account.id}:email:${id}`,
      id,
      accountId: account.id,
      accountName: account.name,
      provider: account.provider,
      channel,
      kind: "email" as const,
      title: text(latest.subject) || "(No subject)",
      sender,
      recipientEmail: emailAddress(sender),
      preview: messages[messages.length - 1]?.text || "No preview available",
      timestamp: text(latest.date) || text(latest.timestamp) || text(latest.created_at),
      messages,
    };
  });
}

function mapChats(rows: Record<string, unknown>[], account: Account): RecentConversation[] {
  return rows.flatMap((raw) => {
    const id = text(raw.id);
    if (!id) return [];
    const channel = channelName(account.provider);
    const lastMessage = object(raw.last_message);
    const preview = plainText(
      text(lastMessage) || text(raw.last_message_text) || text(raw.last_message_preview),
    );
    return [{
      key: `${account.id}:chat:${id}`,
      id,
      accountId: account.id,
      accountName: account.name,
      provider: account.provider,
      channel,
      kind: "chat" as const,
      title: text(raw.name) || text(raw.title) || text(raw.sender) || "Conversation",
      sender: text(raw.from) || text(raw.sender) || text(raw.sender_name) || account.name,
      recipientEmail: emailAddress(raw.user),
      preview: preview || "No preview available",
      timestamp: text(raw.last_message_timestamp) || text(raw.updated_at) || text(raw.timestamp),
      messages: [],
    }];
  });
}

async function loadAccountRows(account: Account): Promise<RecentConversation[]> {
  const isEmail = emailProviders.has(account.provider.toLowerCase());
  if (isEmail) {
    const response = await getJson(`/v2/${encodeURIComponent(account.id)}/emails?limit=30`);
    return mapEmails(listData(response), account);
  }

  if (account.provider.toLowerCase() !== "linkedin") {
    const response = await getJson(`/v2/${encodeURIComponent(account.id)}/chats?limit=30`);
    return mapChats(listData(response), account);
  }

  const inboxResponse = await getJson(`/v2/${encodeURIComponent(account.id)}/inboxes`);
  const inboxes = listData(inboxResponse);
  const outcomes = await Promise.all(inboxes.map(async (inbox) => {
    const inboxId = text(inbox.id);
    if (!inboxId) return { rows: [] as Record<string, unknown>[], error: "LinkedIn returned an inbox without an ID." };
    try {
      const response = await getJson(
        `/v2/${encodeURIComponent(account.id)}/inboxes/${encodeURIComponent(inboxId)}/chats`,
      );
      return { rows: listData(response), error: "" };
    } catch (error) {
      return {
        rows: [] as Record<string, unknown>[],
        error: error instanceof Error ? error.message : "Could not load LinkedIn inbox chats.",
      };
    }
  }));
  const chats = new Map<string, Record<string, unknown>>();
  for (const row of outcomes.flatMap((outcome) => outcome.rows)) {
    const chatId = text(row.id);
    if (chatId) chats.set(chatId, row);
  }
  if (chats.size === 0 && outcomes.some((outcome) => outcome.error)) {
    throw new Error(outcomes.map((outcome) => outcome.error).filter(Boolean).join(" · "));
  }
  return mapChats([...chats.values()], account);
}

function transcriptFor(messages: ConversationMessage[]): string {
  const completeTranscript = messages
    .filter((message) => message.text)
    .map((message) => {
      const timestamp = message.timestamp ? ` · ${message.timestamp}` : "";
      return `${message.sender || "Message"}${timestamp}:\n${message.text}`;
    })
    .join("\n\n");
  return completeTranscript.length > 12000
    ? `[Earlier content omitted to fit the 12,000 character limit.]\n${completeTranscript.slice(-11920)}`
    : completeTranscript;
}

export default function RecentConversations({
  enabled,
  onUseConversation,
}: RecentConversationsProps) {
  const [conversations, setConversations] = useState<RecentConversation[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedHistory, setSelectedHistory] = useState<ConversationMessage[]>([]);
  const [filter, setFilter] = useState("All platforms");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const historyRequestId = useRef(0);

  const platforms = useMemo(
    () => [...new Set(conversations.map((conversation) => conversation.channel))].sort(),
    [conversations],
  );
  const visibleConversations = useMemo(() => {
    const counts = new Map<string, number>();
    return conversations.filter((conversation) => {
      if (filter !== "All platforms" && conversation.channel !== filter) return false;
      const count = counts.get(conversation.channel) ?? 0;
      if (count >= 10) return false;
      counts.set(conversation.channel, count + 1);
      return true;
    });
  }, [conversations, filter]);
  const selected = conversations.find((conversation) => conversation.key === selectedKey) ?? null;

  async function loadRecent() {
    historyRequestId.current += 1;
    setLoading(true);
    setError("");
    setHistoryError("");
    setSelectedKey("");
    setSelectedHistory([]);
    try {
      const accountsResponse = await getJson("/v2/accounts");
      const accounts = listData(accountsResponse).flatMap((raw) => {
        const id = text(raw.id);
        const provider = text(raw.provider);
        if (!id || !provider || text(raw.status).toLowerCase() !== "running") return [];
        return [{
          id,
          name: text(raw.name) || text(raw.user_id) || channelName(provider),
          provider,
          status: text(raw.status),
        }];
      });
      const outcomes = await Promise.all(accounts.map(async (account) => {
        try {
          return { rows: await loadAccountRows(account), error: "" };
        } catch (caught) {
          return {
            rows: [] as RecentConversation[],
            error: `${channelName(account.provider)} (${account.name}): ${caught instanceof Error ? caught.message : "Could not load conversations."}`,
          };
        }
      }));
      const sorted = outcomes.flatMap((outcome) => outcome.rows).sort((left, right) =>
        (Date.parse(right.timestamp) || 0) - (Date.parse(left.timestamp) || 0),
      );
      const counts = new Map<string, number>();
      const limited = sorted.filter((conversation) => {
        const count = counts.get(conversation.channel) ?? 0;
        if (count >= 10) return false;
        counts.set(conversation.channel, count + 1);
        return true;
      });
      setConversations(limited);
      setError(outcomes.map((outcome) => outcome.error).filter(Boolean).join(" · "));
      if (!limited.length && !outcomes.some((outcome) => outcome.error)) {
        setError(accounts.length ? "No recent conversations were returned by the connected accounts." : "No connected accounts are available.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load recent inbox conversations.");
    } finally {
      setLoading(false);
    }
  }

  async function selectConversation(conversation: RecentConversation) {
    const requestId = ++historyRequestId.current;
    setSelectedKey(conversation.key);
    setSelectedHistory([]);
    setHistoryError("");
    if (conversation.kind === "email") {
      setSelectedHistory(conversation.messages);
      setHistoryLoading(false);
      return;
    }

    setHistoryLoading(true);
    try {
      const response = await getJson(
        `/v2/${encodeURIComponent(conversation.accountId)}/chats/${encodeURIComponent(conversation.id)}/messages?limit=50`,
      );
      const messages = listData(response).map((raw, index) => ({
        id: text(raw.id) || `${conversation.id}-${index}`,
        sender: text(raw.sender) || text(raw.sender_name) || text(raw.sender_id) || (raw.is_sender ? "You" : conversation.title),
        text: plainText(text(raw.text) || text(raw.body) || text(raw.message)),
        timestamp: text(raw.timestamp) || text(raw.date),
      })).filter((message) => message.text).reverse();
      if (requestId !== historyRequestId.current) return;
      setSelectedHistory(messages);
      if (!messages.length) setHistoryError("No message history was returned for this conversation.");
    } catch (caught) {
      if (requestId === historyRequestId.current) {
        setHistoryError(caught instanceof Error ? caught.message : "Could not load conversation history.");
      }
    } finally {
      if (requestId === historyRequestId.current) setHistoryLoading(false);
    }
  }

  function useInAssistant() {
    if (!selected) return;
    const transcript = transcriptFor(selectedHistory);
    if (transcript.trim().length < 10) {
      setHistoryError("This conversation has too little readable text to analyze.");
      return;
    }
    onUseConversation(transcript, selected.sender, selected.title, {
      channel: selected.channel,
      kind: selected.kind,
      accountId: selected.accountId,
      conversationId: selected.id,
      recipientEmail: selected.recipientEmail,
      subject: selected.title,
    });
  }

  return (
    <section className="crm-panel crm-recent-conversations">
      <header className="crm-recent-heading">
        <div>
          <span className="crm-eyebrow">UNIFIED INBOX · ON DEMAND</span>
          <h2>Recent conversations</h2>
          <p>Load up to 10 recent threads per platform. Nothing is sent to AI until you review a conversation, choose it below, and submit it with consent.</p>
        </div>
        <button type="button" className="crm-secondary-button" onClick={() => void loadRecent()} disabled={!enabled || loading}>
          {loading ? "Loading…" : conversations.length ? "↻ Refresh inbox" : "Load recent"}
        </button>
      </header>
      {!enabled && <p className="crm-recent-empty">Connect an inbox to load recent conversations.</p>}
      {error && <p className="crm-recent-error" role="status">{error}</p>}
      {conversations.length > 0 && (
        <div className="crm-recent-content">
          <div className="crm-recent-list-column">
            <label className="crm-field crm-recent-filter">
              <span>Platform</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option>All platforms</option>
                {platforms.map((platform) => <option key={platform}>{platform}</option>)}
              </select>
            </label>
            <div className="crm-recent-list">
              {visibleConversations.map((conversation) => (
                <button
                  type="button"
                  className={`crm-recent-item ${selectedKey === conversation.key ? "active" : ""}`}
                  key={conversation.key}
                  onClick={() => void selectConversation(conversation)}
                >
                  <span className="crm-recent-item-top"><strong>{conversation.title}</strong><time>{formatTime(conversation.timestamp)}</time></span>
                  <span className="crm-recent-item-meta">{conversation.channel} · {conversation.accountName} · {conversation.kind === "email" ? "Email" : "Chat"}</span>
                  <span className="crm-recent-item-preview">{conversation.preview}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="crm-recent-history">
            {!selected && <div className="crm-recent-empty">Choose a recent email or chat to review its available history.</div>}
            {selected && <>
              <div className="crm-recent-history-heading">
                <div><strong>{selected.title}</strong><span>{selected.channel} · {selected.sender} · {selected.accountName}</span></div>
                <span className="crm-ai-tag">{selected.kind === "email" ? "Email thread" : "Conversation"}</span>
              </div>
              {historyLoading && <p className="crm-recent-empty">Loading conversation history…</p>}
              {historyError && <p className="crm-recent-error" role="status">{historyError}</p>}
              {!historyLoading && !historyError && selectedHistory.length > 0 && (
                <>
                  <div className="crm-recent-messages">
                    {selectedHistory.slice(-20).map((message) => (
                      <article key={message.id}>
                        <div><strong>{message.sender}</strong><time>{formatTime(message.timestamp)}</time></div>
                        <p>{message.text}</p>
                      </article>
                    ))}
                  </div>
                  <button type="button" className="crm-primary-button" onClick={useInAssistant}>Use this history in AI assistant</button>
                </>
              )}
            </>}
          </div>
        </div>
      )}
      {conversations.length > 0 && <p className="crm-recent-footnote">The list is capped at 10 conversations for each platform. Conversation history stays in this browser until you explicitly submit it for AI analysis.</p>}
    </section>
  );
}
