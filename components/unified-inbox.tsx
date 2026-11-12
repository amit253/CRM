"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Provider =
  | "linkedin"
  | "whatsapp"
  | "google"
  | "outlook"
  | "imap"
  | "telegram"
  | "instagram"
  | "facebook";

type Account = {
  id: string;
  name: string;
  provider: string;
  status: string;
};

type InboxItem = {
  key: string;
  id: string;
  accountId: string;
  accountName: string;
  channel: string;
  kind: "email" | "chat";
  title: string;
  sender: string;
  preview: string;
  content: string;
  timestamp: string;
  unread: boolean;
};

type ChatMessage = {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
  isSender: boolean;
};

type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type UnifiedInboxProps = {
  apiConfigured: boolean;
  connection: "success" | "failed" | null;
  provider: string | null;
};

const providers: { id: Provider; name: string; short: string }[] = [
  { id: "linkedin", name: "LinkedIn", short: "in" },
  { id: "whatsapp", name: "WhatsApp", short: "wa" },
  { id: "google", name: "Google / Gmail", short: "G" },
  { id: "outlook", name: "Outlook", short: "O" },
  { id: "imap", name: "IMAP email", short: "@" },
  { id: "telegram", name: "Telegram", short: "tg" },
  { id: "instagram", name: "Instagram", short: "ig" },
  { id: "facebook", name: "Facebook", short: "f" },
];

const emailProviders = new Set(["google", "gmail", "outlook", "microsoft", "imap"]);
const apiExamples: { label: string; method: ApiMethod; path: string }[] = [
  { label: "Connected accounts", method: "GET", path: "/v2/accounts" },
  { label: "Emails", method: "GET", path: "/v2/{account_id}/emails" },
  { label: "Contacts", method: "GET", path: "/v2/{account_id}/contacts" },
  { label: "Chats", method: "GET", path: "/v2/{account_id}/chats" },
  { label: "Chat messages", method: "GET", path: "/v2/{account_id}/chats/{chat_id}/messages" },
];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  const item = record(value);
  if (!item) return "";
  for (const key of ["display_name", "name", "email", "address", "text", "body", "subject", "username"]) {
    const result = text(item[key]);
    if (result) return result;
  }
  return "";
}

function listData(value: unknown): Record<string, unknown>[] {
  const payload = record(value);
  if (!Array.isArray(payload?.data)) {
    throw new Error("Unipile returned an unexpected response; expected a data list.");
  }
  const rows = payload.data.map(record);
  if (rows.some((item) => item === null)) {
    throw new Error("Unipile returned an unexpected item in the data list.");
  }
  return rows.filter((item): item is Record<string, unknown> => item !== null);
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

function providerLabel(provider: string): string {
  const normalized = provider.toLowerCase();
  if (normalized === "google" || normalized === "gmail") return "Gmail";
  if (normalized === "outlook" || normalized === "microsoft") return "Outlook";
  if (normalized === "imap") return "Email";
  return providers.find((item) => item.id === normalized)?.name ?? provider;
}

function ProviderSymbol({ provider }: { provider: string }) {
  const normalized = provider.toLowerCase();
  if (normalized === "linkedin") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><text x="3" y="18" fill="currentColor" fontSize="16" fontWeight="700" letterSpacing="-1">in</text></svg>;
  }
  if (normalized === "instagram") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2"/><circle cx="17.7" cy="6.8" r="1.1" fill="currentColor"/></svg>;
  }
  if (normalized === "whatsapp") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11.6a8 8 0 0 1-11.8 7L4 20l1.4-4.1A8 8 0 1 1 20 11.6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M9 8.5c.3-.6.7-.5 1-.2l1 1.5c.2.3.1.6-.3 1l-.5.5c.6 1.1 1.4 1.8 2.5 2.4l.5-.6c.3-.4.6-.4.9-.2l1.5.8c.4.2.4.6.2.9-.4.8-1.1 1.2-2 1.2-2.7-.1-5.8-2.8-6.1-5.5-.1-.8.4-1.5 1.3-1.8Z" fill="currentColor"/></svg>;
  }
  if (normalized === "telegram") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 4-3.1 16c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1L17.4 7c.4-.4-.1-.6-.6-.3L6 13.5l-4.9-1.6c-1.1-.4-1.1-1.1.2-1.6L20 3.2c.9-.3 1.6.2 1 1.8Z" fill="currentColor"/></svg>;
  }
  if (normalized === "facebook") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.7 21v-8h2.7l.4-3.1h-3.1v-2c0-.9.3-1.5 1.6-1.5H17V3.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.1H7.6V13h2.7v8h3.4Z"/></svg>;
  }
  if (normalized === "outlook" || normalized === "microsoft") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8"/><path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M8 3.5h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
  }
  if (normalized === "google" || normalized === "gmail") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 18V6.5c0-1 .9-1.6 1.8-1l6.7 5 6.7-5c.9-.6 1.8 0 1.8 1V18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M3.5 8.5 12 15l8.5-6.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8"/><path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
}

function endpointFor(account: Account): "emails" | "chats" {
  return emailProviders.has(account.provider.toLowerCase()) ? "emails" : "chats";
}

function normalizeItem(raw: Record<string, unknown>, account: Account, kind: "email" | "chat"): InboxItem {
  const id = text(raw.id) || `${kind}-${Math.random().toString(36).slice(2)}`;
  const channel = providerLabel(account.provider);
  const from = text(raw.from) || text(raw.sender) || text(raw.sender_name);
  const chatLastMessage = record(raw.last_message);
  const preview = kind === "email"
    ? text(raw.snippet) || text(raw.body_plain) || text(raw.body)
    : text(chatLastMessage) || text(raw.last_message_text) || text(raw.last_message_preview);
  const title = kind === "email"
    ? text(raw.subject) || "(No subject)"
    : text(raw.name) || text(raw.title) || from || "Conversation";
  const timestamp = kind === "email"
    ? text(raw.date) || text(raw.timestamp)
    : text(raw.last_message_timestamp) || text(raw.updated_at) || text(raw.timestamp);
  const unreadCount = Number(raw.unread_count ?? 0);

  return {
    key: `${account.id}:${kind}:${id}`,
    id,
    accountId: account.id,
    accountName: account.name,
    channel,
    kind,
    title,
    sender: from || (kind === "email" ? account.name : "Conversation"),
    preview: plainText(preview).replace(/\s+/g, " ") || "No preview available",
    content: kind === "email" ? plainText(text(raw.body_plain) || text(raw.body) || preview) : "",
    timestamp,
    unread: kind === "email" ? Boolean(raw.is_unread) : unreadCount > 0,
  };
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`/api/unipile/bridge${path}`, { cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = record(body)?.detail ?? record(body)?.error;
    throw new Error(typeof detail === "string" ? detail : `Unipile request failed (${response.status}).`);
  }
  return body;
}

async function loadAccountConversations(
  account: Account,
): Promise<{ kind: "email" | "chat"; rows: Record<string, unknown>[]; error: string }> {
  const kind: "email" | "chat" = endpointFor(account) === "emails" ? "email" : "chat";
  if (kind === "email") {
    const payload = await getJson(`/v2/${encodeURIComponent(account.id)}/emails?limit=30`);
    return { kind, rows: listData(payload), error: "" };
  }

  if (account.provider.toLowerCase() !== "linkedin") {
    const payload = await getJson(`/v2/${encodeURIComponent(account.id)}/chats?limit=30`);
    return { kind, rows: listData(payload), error: "" };
  }

  const inboxPayload = await getJson(`/v2/${encodeURIComponent(account.id)}/inboxes`);
  const inboxes = listData(inboxPayload);
  const results = await Promise.all(inboxes.map(async (inbox) => {
    const inboxId = text(inbox.id);
    if (!inboxId) {
      return { rows: [] as Record<string, unknown>[], error: "Unipile returned an inbox without an ID." };
    }

    try {
      const payload = await getJson(
        `/v2/${encodeURIComponent(account.id)}/inboxes/${encodeURIComponent(inboxId)}/chats`,
      );
      return { rows: listData(payload), error: "" };
    } catch (error) {
      return {
        rows: [] as Record<string, unknown>[],
        error: error instanceof Error ? error.message : "Could not load inbox chats.",
      };
    }
  }));
  const rowsById = new Map<string, Record<string, unknown>>();
  for (const row of results.flatMap((result) => result.rows)) {
    const chatId = text(row.id);
    if (chatId) rowsById.set(chatId, row);
  }
  const errors = results.map((result) => result.error).filter(Boolean);
  return { kind, rows: [...rowsById.values()], error: errors.join(" · ") };
}

export default function UnifiedInbox({ apiConfigured, connection, provider }: UnifiedInboxProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState("All channels");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<Provider>("google");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState("");
  const [apiMethod, setApiMethod] = useState<ApiMethod>("GET");
  const [apiPath, setApiPath] = useState("/v2/accounts");
  const [apiBody, setApiBody] = useState("");
  const [apiResult, setApiResult] = useState("");
  const [apiStatus, setApiStatus] = useState<number | null>(null);
  const [apiLoading, setApiLoading] = useState(false);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setSourceErrors([]);
    try {
      const accountPayload = await getJson("/v2/accounts");
      const connected = listData(accountPayload).flatMap((raw) => {
        const id = text(raw.id);
        const provider = text(raw.provider);
        if (!id || !provider) return [];
        return [{
          id,
          provider,
          name: text(raw.name) || text(raw.user_id) || providerLabel(provider),
          status: text(raw.status) || "unknown",
        }];
      });
      setAccounts(connected);

      const activeAccounts = connected.filter((account) => account.status === "running");
      const outcomes = await Promise.all(activeAccounts.map(async (account) => {
        try {
          const { kind, rows, error } = await loadAccountConversations(account);
          return {
            account,
            kind,
            rows,
            error: error ? `${providerLabel(account.provider)} (${account.name}): ${error}` : "",
          };
        } catch (error) {
          return {
            account,
            kind: endpointFor(account) === "emails" ? "email" as const : "chat" as const,
            rows: [],
            error: `${providerLabel(account.provider)} (${account.name}): ${error instanceof Error ? error.message : "Could not load messages."}`,
          };
        }
      }));
      const nextItems = outcomes.flatMap(({ account, kind, rows }) =>
        rows.map((row) => normalizeItem(row, account, kind)),
      ).sort((left, right) => {
        const leftTime = Date.parse(left.timestamp) || 0;
        const rightTime = Date.parse(right.timestamp) || 0;
        return rightTime - leftTime;
      });
      setItems(nextItems);
      setSelectedKey((current) => nextItems.some((item) => item.key === current) ? current : nextItems[0]?.key ?? null);
      setSourceErrors(outcomes.map((item) => item.error).filter(Boolean));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load connected accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const channels = useMemo(
    () => [...new Set(items.map((item) => item.channel))].sort(),
    [items],
  );
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const channelMatches = filter === "All channels" || item.channel === filter;
      const queryMatches = !query || [item.title, item.sender, item.preview, item.accountName, item.channel]
        .some((value) => value.toLowerCase().includes(query));
      return channelMatches && queryMatches;
    });
  }, [filter, items, search]);
  const selectedItem = items.find((item) => item.key === selectedKey) ?? null;

  useEffect(() => {
    if (!selectedItem || selectedItem.kind !== "chat") {
      setChatMessages([]);
      setMessagesError("");
      return;
    }
    let active = true;
    setMessagesLoading(true);
    setMessagesError("");
    setChatMessages([]);
    void getJson(`/v2/${encodeURIComponent(selectedItem.accountId)}/chats/${encodeURIComponent(selectedItem.id)}/messages?limit=50`)
      .then((payload) => {
        if (!active) return;
        const messages = listData(payload).map((raw, index) => ({
          id: text(raw.id) || `${selectedItem.id}-${index}`,
          sender: text(raw.sender) || text(raw.sender_name) || text(raw.sender_id) || (raw.is_sender ? "You" : selectedItem.title),
          text: text(raw.text) || text(raw.body) || text(raw.message),
          timestamp: text(raw.timestamp) || text(raw.date),
          isSender: Boolean(raw.is_sender),
        })).filter((message) => message.text);
        setChatMessages(messages.reverse());
      })
      .catch((error: unknown) => {
        if (active) setMessagesError(error instanceof Error ? error.message : "Could not load this conversation.");
      })
      .finally(() => {
        if (active) setMessagesLoading(false);
      });
    return () => { active = false; };
  }, [selectedItem]);

  async function connectAccount() {
    setConnecting(true);
    setConnectError("");
    try {
      const response = await fetch("/api/unipile/auth-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selectedProvider }),
      });
      const result: unknown = await response.json();
      const link = record(result)?.url;
      if (!response.ok || typeof link !== "string") {
        const message = record(result)?.error;
        throw new Error(typeof message === "string" ? message : "Unable to start the account connection.");
      }
      window.location.assign(link);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Unable to start the account connection.");
      setConnecting(false);
    }
  }

  async function runApiRequest() {
    setApiResult("");
    setApiStatus(null);
    if (/\{[^}]+\}/.test(apiPath)) {
      setApiResult("Replace path placeholders with real IDs first. Account IDs start with acc_; chat message paths also need a real chat ID.");
      return;
    }
    if (apiMethod !== "GET" && !window.confirm("This sends a live request that may change or delete account data. Continue?")) return;
    let body: string | undefined;
    if (apiBody.trim() && apiMethod !== "GET") {
      try {
        body = JSON.stringify(JSON.parse(apiBody));
      } catch {
        setApiResult("Request body must be valid JSON.");
        return;
      }
    }
    setApiLoading(true);
    try {
      const response = await fetch(`/api/unipile/bridge${apiPath}`, {
        method: apiMethod,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const responseText = await response.text();
      try {
        setApiResult(JSON.stringify(JSON.parse(responseText), null, 2));
      } catch {
        setApiResult(responseText || "(empty response)");
      }
      setApiStatus(response.status);
    } catch (error) {
      setApiResult(error instanceof Error ? error.message : "The request failed.");
    } finally {
      setApiLoading(false);
    }
  }

  return (
    <main className="unified-app">
      <aside className="unified-sidebar">
        <a className="unified-brand" href="#inbox"><span className="unified-brand-mark">p</span><span>phigrad</span></a>
        <div className="unified-workspace"><span className="unified-workspace-icon">P</span><span><small>WORKSPACE</small><strong>Phigrad Studio</strong></span><b>⌄</b></div>
        <span className="unified-nav-label">WORKSPACE</span>
        <nav className="unified-nav">
          <a href="#inbox" className="selected"><span>▤</span> Inbox <b>{items.length}</b></a>
          <a href="#accounts"><span>⌘</span> Connected accounts</a>
        </nav>
        <div className="unified-sidebar-bottom">
          <div className="unified-sidebar-note"><span>●</span><strong>Channels, together.</strong><p>Your conversations, organized in one calm workspace.</p></div>
          <div className="unified-profile"><span className="unified-profile-avatar">P</span><span><strong>Workspace owner</strong><small>Personal workspace</small></span><b>···</b></div>
        </div>
      </aside>

      <section className="unified-main" id="inbox">
        <header className="unified-topbar">
          <div className="unified-breadcrumb">Workspace <span>/</span> <strong>Inbox</strong></div>
          <div className="unified-top-actions"><span className={apiConfigured ? "unified-live-dot" : "unified-status-missing"} /> {apiConfigured ? `${accounts.length} connected ${accounts.length === 1 ? "account" : "accounts"}` : "API key not configured"} <span className="unified-top-avatar">P</span></div>
        </header>
        <div className="unified-content">
          {connection === "success" && <div className="unified-connection-notice" role="status"><strong>{provider ? providerLabel(provider) : "Account"} connected.</strong> Syncing conversations from your connected channel.</div>}
          {connection === "failed" && <div className="unified-connection-notice failed" role="alert"><strong>Connection didn’t complete.</strong> Try again and check your Unipile settings if the issue persists.</div>}
          <div className="unified-page-heading">
            <div><span className="unified-eyebrow">YOUR COMMUNICATION HUB</span><h1>Unified inbox</h1><p>Stay on top of conversations across every connected channel.</p></div>
            <button type="button" className="unified-refresh" onClick={() => void loadInbox()} disabled={loading}>{loading ? "Syncing…" : "↻  Refresh inbox"}</button>
          </div>
          <section className="unified-inbox-card" aria-label="Unified inbox">
            <div className="unified-inbox-toolbar">
              <div className="unified-filters" aria-label="Filter by channel">
                {["All channels", ...channels].map((channel) => (
                  <button type="button" key={channel} className={filter === channel ? "active" : ""} onClick={() => setFilter(channel)}>
                    {channel === "All channels" ? "All channels" : <><span className={`unified-channel-icon channel-${channel.toLowerCase().replace(/[^a-z]/g, "")}`}><ProviderSymbol provider={channel} /></span>{channel}</>}
                  </button>
                ))}
              </div>
              <label className="unified-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" /></label>
            </div>
            {(loadError || sourceErrors.length > 0) && (
              <div className="unified-error" role="status">
                <strong>{loadError ? "Inbox could not be loaded" : "Some channels could not be synced"}</strong>
                <span>{loadError || sourceErrors.join(" · ")}</span>
              </div>
            )}
            <div className="unified-inbox-body">
              <div className="unified-conversation-column">
                <div className="unified-list-heading"><span>{loading ? "Syncing conversations…" : `${filteredItems.length} conversations`}</span><button type="button" onClick={() => void loadInbox()} aria-label="Refresh conversations">↻</button></div>
                <div className="unified-conversation-list">
                  {!loading && filteredItems.length === 0 && (
                    <div className="unified-empty"><span className="unified-empty-icon">▤</span><strong>{accounts.length ? "No conversations found" : "Connect your first channel"}</strong><p>{accounts.length ? "Try another channel filter or check the account permissions." : "Connect Gmail, LinkedIn, Instagram, or another supported provider to see real conversations here."}</p><a href="#accounts">{accounts.length ? "Manage connected accounts" : "Connect an account"} <span>→</span></a></div>
                  )}
                  {filteredItems.map((item) => (
                    <button type="button" key={item.key} className={`unified-conversation ${selectedKey === item.key ? "current" : ""}`} onClick={() => setSelectedKey(item.key)}>
                      <span className={`unified-contact-avatar channel-${item.channel.toLowerCase().replace(/[^a-z]/g, "")}`} aria-label={item.channel}><ProviderSymbol provider={item.channel} /></span>
                      <span className="unified-conversation-copy">
                        <span className="unified-conversation-meta"><strong>{item.title}</strong><time>{formatTime(item.timestamp)}</time></span>
                        <span className="unified-conversation-channel"><span className={`unified-channel-icon channel-${item.channel.toLowerCase().replace(/[^a-z]/g, "")}`}><ProviderSymbol provider={item.channel} /></span>{item.channel}<i>·</i>{item.sender}</span>
                        <span className="unified-conversation-preview">{item.preview}</span>
                      </span>
                      {item.unread && <span className="unified-unread-dot" aria-label="Unread" />}
                    </button>
                  ))}
                </div>
              </div>
              <section className="unified-detail" aria-label="Conversation details">
                {selectedItem ? (
                  <>
                    <div key={selectedItem.key} className="unified-detail-transition">
                      <header className="unified-detail-header">
                        <span className={`unified-contact-avatar large channel-${selectedItem.channel.toLowerCase().replace(/[^a-z]/g, "")}`} aria-label={selectedItem.channel}><ProviderSymbol provider={selectedItem.channel} /></span>
                        <div><h2>{selectedItem.title}</h2><p>{selectedItem.sender} <span>·</span> {selectedItem.accountName}</p></div>
                        <span className={`unified-detail-channel channel-${selectedItem.channel.toLowerCase().replace(/[^a-z]/g, "")}`}><ProviderSymbol provider={selectedItem.channel} />{selectedItem.channel}</span>
                      </header>
                      <div className="unified-detail-body">
                        {selectedItem.kind === "email" ? (
                          <article className="unified-email">
                            <div className="unified-email-subject">{selectedItem.title}</div>
                            <div className="unified-email-sender"><span className={`unified-contact-avatar small channel-${selectedItem.channel.toLowerCase().replace(/[^a-z]/g, "")}`} aria-label={selectedItem.channel}><ProviderSymbol provider={selectedItem.channel} /></span><div><strong>{selectedItem.sender}</strong><small>to {selectedItem.accountName}</small></div><time>{formatTime(selectedItem.timestamp)}</time></div>
                            <div className="unified-email-content">{selectedItem.content || selectedItem.preview}</div>
                          </article>
                        ) : (
                          <div className="unified-chat-thread">
                            {messagesLoading && <div className="unified-thread-state">Loading conversation…</div>}
                            {messagesError && <div className="unified-thread-error">{messagesError}</div>}
                            {!messagesLoading && !messagesError && chatMessages.length === 0 && <div className="unified-thread-state">No messages were returned for this chat.</div>}
                            {chatMessages.map((message) => (
                              <article className={`unified-message ${message.isSender ? "outgoing" : ""}`} key={message.id}>
                                <div>{message.text}</div><time>{formatTime(message.timestamp)}{message.isSender ? " · You" : ` · ${message.sender}`}</time>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <footer className="unified-detail-footer"><span>Connected through Unipile</span><span>{selectedItem.channel} <i /> Live account data</span></footer>
                  </>
                ) : (
                  <div className="unified-detail-placeholder"><span>✦</span><strong>Select a conversation</strong><p>Choose a message to view its details.</p></div>
                )}
              </section>
            </div>
          </section>

          <section className="unified-accounts-section" id="accounts">
            <div className="unified-section-heading"><div><span className="unified-eyebrow">CHANNELS</span><h2>Connected accounts</h2><p>Connect the inboxes you want to bring together.</p></div><div className="unified-connect-control">
              <label><span className="sr-only">Choose provider</span><select value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value as Provider)}>{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}</select></label>
              <button type="button" onClick={() => void connectAccount()} disabled={connecting}>{connecting ? "Opening secure sign-in…" : "＋ Connect account"}</button>
            </div></div>
            {connectError && <div className="unified-error" role="alert"><strong>Could not connect account</strong><span>{connectError}</span></div>}
            <div className="unified-account-grid">
              {accounts.map((account) => (
                <article className="unified-account-card" key={account.id}>
                  <span className={`unified-account-icon channel-${account.provider.toLowerCase()}`}><ProviderSymbol provider={account.provider} /></span>
                  <span><strong>{account.name}</strong><small>{providerLabel(account.provider)} · {account.status}</small></span>
                  <i className={account.status === "running" ? "connected" : ""} title={account.status} />
                </article>
              ))}
              {!accounts.length && !loading && <div className="unified-no-accounts">No accounts connected yet. Choose a provider above to get started.</div>}
            </div>
          </section>

          <details className="unified-developer-tools">
            <summary>Developer tools <span>Use the generic Unipile API explorer</span></summary>
            <div className="unified-dev-body">
              <div className="unified-dev-examples">{apiExamples.map((example) => <button type="button" key={example.label} onClick={() => { setApiMethod(example.method); setApiPath(example.path); }}>{example.label}</button>)}</div>
              <p>Replace <code>{"{account_id}"}</code> with a connected account ID beginning <code>acc_</code>. Chat messages also need a real chat ID.</p>
              <div className="unified-dev-controls"><select aria-label="HTTP method" value={apiMethod} onChange={(event) => setApiMethod(event.target.value as ApiMethod)}>{(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map((method) => <option key={method}>{method}</option>)}</select><input aria-label="Unipile API path" value={apiPath} onChange={(event) => setApiPath(event.target.value)} /><button type="button" onClick={() => void runApiRequest()} disabled={apiLoading}>{apiLoading ? "Running…" : "Run request"}</button></div>
              {apiMethod !== "GET" && <textarea aria-label="JSON request body" value={apiBody} onChange={(event) => setApiBody(event.target.value)} placeholder={'{\n  "key": "value"\n}'} />}
              {apiResult && <pre className="unified-api-response"><strong>{apiStatus ?? "Error"}</strong>{apiResult}</pre>}
            </div>
          </details>
          <footer className="unified-footer">A clearer view of every conversation <span>PERSONAL WORKSPACE · POWERED BY UNIPILE</span></footer>
        </div>
      </section>
    </main>
  );
}
