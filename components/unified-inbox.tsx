"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  senderEmail: string;
  senderPhone: string;
  preview: string;
  content: string;
  timestamp: string;
  unread: boolean;
  messageIdentity: string;
  inbound: boolean;
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
  aiConfigured: boolean;
  connection: "success" | "failed" | null;
  provider: string | null;
};

type Classification = {
  is_lead: boolean;
  confidence: number;
  reason: string;
  source: "automatic" | "manual";
  classified_at: string;
};

type LeadSource = "email" | "whatsapp" | "linkedin" | "instagram" | "website" | "phone" | "other";

type LeadExtraction = {
  contact_name: string | null;
  organisation: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  service_interest: "executive_coaching" | "executive_presence" | "storytelling_communication" | "corporate_training" | "leadership_workshop" | "keynote_speaking" | "event_speaking" | "professional_development" | "coaching_programme" | "other" | "unclear";
  lead_intent: "inquiry" | "availability_request" | "pricing_request" | "proposal_request" | "meeting_request" | "speaking_request" | "training_request" | "coaching_request" | "partnership" | "referral" | "other";
  company_need: string | null;
  event_or_programme: string | null;
  expected_audience: string | null;
  location: string | null;
  requested_date: string | null;
  budget: string | null;
  urgency: "high" | "medium" | "low" | "unknown";
  decision_maker: "yes" | "no" | "unknown";
  lead_stage: "new" | "contacted" | "discovery_call_booked" | "qualified" | "proposal_sent" | "follow_up" | "negotiation" | "won" | "lost" | "nurture";
  next_action: string | null;
  next_action_date: string | null;
  summary: string;
  qualification_notes: string | null;
};

type LeadExtractionStatus =
  | { status: "pending" }
  | { status: "complete"; details: LeadExtraction }
  | { status: "failed"; error: string };

const LEAD_CLASSIFICATION_THRESHOLD = 0.4;
const LEAD_POLICY_VERSION = "anand-leads-v3-confidence-only-0.4";

function isClassification(value: unknown): value is Classification {
  const item = record(value);
  return Boolean(
    item &&
    typeof item.is_lead === "boolean" &&
    typeof item.confidence === "number" &&
    typeof item.reason === "string" &&
    (item.source === "automatic" || item.source === "manual") &&
    typeof item.classified_at === "string",
  );
}

function isLeadExtraction(value: unknown): value is LeadExtraction {
  const item = record(value);
  const nullableStrings = [
    "contact_name", "organisation", "role", "email", "phone", "company_need",
    "event_or_programme", "expected_audience", "location", "requested_date",
    "budget", "next_action", "next_action_date", "qualification_notes",
  ];
  return Boolean(
    item &&
    nullableStrings.every((key) => item[key] === null || typeof item[key] === "string") &&
    ["email", "whatsapp", "linkedin", "instagram", "website", "phone", "other"].includes(String(item.source)) &&
    typeof item.service_interest === "string" &&
    typeof item.lead_intent === "string" &&
    ["high", "medium", "low", "unknown"].includes(String(item.urgency)) &&
    ["yes", "no", "unknown"].includes(String(item.decision_maker)) &&
    typeof item.lead_stage === "string" &&
    typeof item.summary === "string",
  );
}

function extractionStatusMessage(status: LeadExtractionStatus): string {
  if (status.status === "complete") return "Lead details extracted. Review and edit them before saving to CRM.";
  if (status.status === "pending") return "Extracting relevant lead details automatically…";
  return `Lead detected, but automatic extraction failed: ${status.error}`;
}

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

type DuplicateContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company_name: string | null;
  matched_fields: string[];
};

type PromotionDuplicateCheck = {
  email: string;
  phone: string;
  matches: DuplicateContact[];
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function crmRequestError(payload: unknown, action: string): string {
  const body = record(payload);
  const bridgeError = typeof body?.error === "string" ? body.error : "";
  const detail = body?.detail;
  const detailObject = record(detail);
  const serverMessage =
    typeof detail === "string"
      ? detail
      : typeof detailObject?.message === "string"
        ? detailObject.message
        : "";

  if (/FastAPI is not running|fetch failed|ECONNREFUSED/i.test(`${bridgeError} ${serverMessage}`)) {
    return `Couldn't ${action} because the CRM backend isn't responding. Start FastAPI at http://127.0.0.1:8001, then try again.`;
  }
  if (serverMessage) return serverMessage;
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      const issue = record(item);
      if (typeof issue?.msg !== "string") return [];
      const location = Array.isArray(issue.loc)
        ? issue.loc.filter((part): part is string | number => typeof part === "string" || typeof part === "number").filter((part) => part !== "body").join(" ")
        : "";
      return [`${location ? `${location}: ` : ""}${issue.msg}`];
    });
    if (messages.length) return `Please correct the following: ${messages.join("; ")}.`;
  }
  if (bridgeError && !/^\w+Error:/.test(bridgeError)) {
    return `Couldn't ${action}. ${bridgeError}`;
  }
  return `Couldn't ${action} because the CRM service is temporarily unavailable. Please try again.`;
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
  const item = record(value);
  if (!item) return "";
  for (const key of ["email", "address", "display_name", "name"]) {
    const email = emailAddress(item[key]);
    if (email) return email;
  }
  return "";
}

function phoneNumber(value: unknown): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const phone = phoneNumber(item);
      if (phone) return phone;
    }
    return "";
  }
  const item = record(value);
  if (!item) return "";
  for (const key of ["phone", "phone_number", "mobile", "number", "display_name", "name"]) {
    const candidate = item[key];
    if (typeof candidate === "string" && /[+\d][\d\s().-]{6,}/.test(candidate)) {
      return candidate.match(/\+?[\d][\d\s().-]{6,}\d/)?.[0]?.trim() ?? "";
    }
    const phone = phoneNumber(candidate);
    if (phone) return phone;
  }
  return "";
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(36);
}

function messageIdentity(raw: Record<string, unknown>, kind: "email" | "chat"): string {
  const lastMessage = record(raw.last_message);
  const id = kind === "email"
    ? text(raw.id)
    : text(lastMessage?.id) || text(raw.last_message_id) || text(raw.message_id);
  if (id) return id;
  const timestamp = kind === "email"
    ? text(raw.date) || text(raw.timestamp) || text(raw.created_at)
    : text(lastMessage?.timestamp) || text(raw.last_message_timestamp) || text(raw.updated_at);
  const content = kind === "email"
    ? text(raw.body_plain) || text(raw.body) || text(raw.snippet) || text(raw.subject)
    : text(lastMessage) || text(raw.last_message_text) || text(raw.last_message_preview);
  return `${timestamp}:${fingerprint(content)}`;
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

function leadSource(provider: string): LeadSource {
  const normalized = provider.toLowerCase();
  if (["google", "gmail", "outlook", "microsoft", "imap", "email"].includes(normalized)) return "email";
  if (normalized === "whatsapp" || normalized === "linkedin" || normalized === "instagram") return normalized;
  if (normalized === "phone") return "phone";
  if (normalized === "website") return "website";
  return "other";
}

function senderDisplayName(item: InboxItem): string {
  const sender = item.sender.replace(/<[^>]*>/g, "").replace(/^["']|["']$/g, "").trim();
  return sender && !sender.includes("@") && sender.toLowerCase() !== item.accountName.toLowerCase()
    ? sender
    : "";
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
  const direction = text(raw.direction).toLowerCase();
  const folder = text(raw.folder).toLowerCase();

  return {
    key: `${account.id}:${kind}:${id}`,
    id,
    accountId: account.id,
    accountName: account.name,
    channel,
    kind,
    title,
    sender: from || (kind === "email" ? account.name : title),
    senderEmail: emailAddress(raw.from) || emailAddress(raw.sender) || text(raw.sender_email),
    senderPhone: phoneNumber(raw.from) || phoneNumber(raw.sender) || text(raw.sender_phone) || text(raw.phone),
    preview: plainText(preview).replace(/\s+/g, " ") || "No preview available",
    content: kind === "email" ? plainText(text(raw.body_plain) || text(raw.body) || preview) : "",
    timestamp,
    unread: kind === "email" ? Boolean(raw.is_unread) : unreadCount > 0,
    messageIdentity: messageIdentity(raw, kind),
    inbound: kind === "chat" || (
      raw.is_sender !== true &&
      raw.is_sent !== true &&
      direction !== "sent" &&
      direction !== "outgoing" &&
      !folder.includes("sent")
    ),
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

export default function UnifiedInbox({ apiConfigured, aiConfigured, connection, provider }: UnifiedInboxProps) {
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
  const [classifications, setClassifications] = useState<Record<string, Classification>>({});
  const [leadExtractions, setLeadExtractions] = useState<Record<string, LeadExtractionStatus>>({});
  const [automaticAnalysisError, setAutomaticAnalysisError] = useState("");
  const [manualAnalysisLoading, setManualAnalysisLoading] = useState(false);
  const [manualAnalysisError, setManualAnalysisError] = useState("");
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [promotionForm, setPromotionForm] = useState<LeadExtraction | null>(null);
  const [promotionNote, setPromotionNote] = useState("");
  const [promotionLoading, setPromotionLoading] = useState(false);
  const [promotionExtracting, setPromotionExtracting] = useState(false);
  const [promotionError, setPromotionError] = useState("");
  const [promotionDuplicateCheck, setPromotionDuplicateCheck] = useState<PromotionDuplicateCheck | null>(null);
  const [promotionDuplicateLoading, setPromotionDuplicateLoading] = useState(false);
  const [promotionExtractionError, setPromotionExtractionError] = useState("");
  const [promotionSuccess, setPromotionSuccess] = useState("");
  const seenMessageIdentities = useRef(new Set<string>());
  const initialSyncComplete = useRef(false);
  const inboxRequestInProgress = useRef(false);
  const classifyingIdentities = useRef(new Set<string>());
  const classificationsRef = useRef<Record<string, Classification>>({});
  const leadExtractionsRef = useRef<Record<string, LeadExtractionStatus>>({});
  const promotionExtractionRun = useRef(0);

  const persistSeenIdentity = useCallback((identity: string) => {
    seenMessageIdentities.current.add(identity);
    while (seenMessageIdentities.current.size > 1000) {
      const oldest = seenMessageIdentities.current.values().next().value;
      if (typeof oldest === "string") seenMessageIdentities.current.delete(oldest);
    }
    try {
      localStorage.setItem(
        "phigrad-inbox-seen-messages",
        JSON.stringify([...seenMessageIdentities.current].slice(-1000)),
      );
    } catch {
      setAutomaticAnalysisError("Automatic analysis may repeat after this page closes because local inbox state could not be saved.");
    }
  }, []);

  const saveClassification = useCallback((itemKey: string, classification: Classification) => {
    const updated = { ...classificationsRef.current, [itemKey]: classification };
    const entries = Object.entries(updated).slice(-500);
    classificationsRef.current = Object.fromEntries(entries);
    setClassifications(classificationsRef.current);
    try {
      localStorage.setItem("phigrad-inbox-classifications", JSON.stringify(entries));
    } catch {
      setAutomaticAnalysisError("Classification results will be cleared when this page closes because local storage is unavailable.");
    }
  }, []);

  const saveLeadExtractionStatus = useCallback((itemKey: string, status: LeadExtractionStatus) => {
    const updated = { ...leadExtractionsRef.current, [itemKey]: status };
    const entries = Object.entries(updated).slice(-500);
    leadExtractionsRef.current = Object.fromEntries(entries);
    setLeadExtractions(leadExtractionsRef.current);
    try {
      localStorage.setItem(
        "phigrad-inbox-lead-extractions",
        JSON.stringify(entries.filter((entry): entry is [string, Extract<LeadExtractionStatus, { status: "complete" }>] =>
          entry[1].status === "complete",
        )),
      );
    } catch {
      setAutomaticAnalysisError("Extracted lead details may need to be fetched again after this page closes because local storage is unavailable.");
    }
  }, []);

  const requestClassification = useCallback(async (messageText: string): Promise<Omit<Classification, "source" | "classified_at">> => {
    const response = await fetch("/api/crm/inbox/classify-lead", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: messageText.slice(0, 12000) }),
    });
    const payload: unknown = await response.json().catch(() => null);
    const result = record(payload);
    if (!response.ok) {
      const detail = result?.detail;
      throw new Error(typeof detail === "string" ? detail : `Lead classification failed (${response.status}).`);
    }
    if (typeof result?.is_lead !== "boolean" || typeof result.confidence !== "number" || typeof result.reason !== "string") {
      throw new Error("AI returned an invalid lead classification.");
    }
    return {
      is_lead: result.confidence >= LEAD_CLASSIFICATION_THRESHOLD,
      confidence: result.confidence,
      reason: result.reason,
    };
  }, []);

  const requestLeadExtraction = useCallback(async (
    item: InboxItem,
    conversationText: string,
  ): Promise<LeadExtraction> => {
    const source = leadSource(item.channel);
    const response = await fetch("/api/crm/inbox/extract-lead", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: conversationText.slice(0, 12000),
        source,
        sender_name: senderDisplayName(item),
        sender_email: item.senderEmail,
        sender_phone: item.senderPhone,
      }),
    });
    const payload: unknown = await response.json().catch(() => null);
    const result = record(payload);
    if (!response.ok) {
      const detail = result?.detail;
      throw new Error(typeof detail === "string" ? detail : `Lead-detail extraction failed (${response.status}).`);
    }
    if (!isLeadExtraction(result) || result.source !== source) {
      throw new Error("AI returned invalid lead details. Check the conversation and try again.");
    }
    return result;
  }, []);

  const classifyNewMessages = useCallback(async (candidates: InboxItem[]) => {
    const classifyOne = async (item: InboxItem) => {
      const identity = `${item.accountId}:${item.kind}:${item.messageIdentity}`;
      if (seenMessageIdentities.current.has(identity) || classifyingIdentities.current.has(identity)) return;
      classifyingIdentities.current.add(identity);
      try {
        let messageText = item.content;
        if (item.kind === "chat") {
          const response = await getJson(
            `/v2/${encodeURIComponent(item.accountId)}/chats/${encodeURIComponent(item.id)}/messages?limit=50`,
          );
          const messages = listData(response).map((raw) => ({
            timestamp: text(raw.timestamp) || text(raw.date),
            text: plainText(text(raw.text) || text(raw.body) || text(raw.message)),
            isSender: raw.is_sender === true,
          })).filter((message) => message.text).sort((left, right) =>
            (Date.parse(left.timestamp) || 0) - (Date.parse(right.timestamp) || 0),
          );
          const latest = messages.at(-1);
          if (!latest || latest.isSender) {
            persistSeenIdentity(identity);
            return;
          }
          messageText = messages
            .map((message) => `${message.isSender ? "Anand" : item.sender}: ${message.text}`)
            .join("\n\n");
        }
        if (!item.inbound || messageText.trim().length < 10) {
          persistSeenIdentity(identity);
          return;
        }
        const result = await requestClassification(messageText);
        const classification: Classification = {
          ...result,
          source: "automatic",
          classified_at: new Date().toISOString(),
        };
        saveClassification(item.key, classification);
        persistSeenIdentity(identity);
        setAutomaticAnalysisError("");
        if (classification.is_lead) {
          saveLeadExtractionStatus(item.key, { status: "pending" });
          try {
            const details = await requestLeadExtraction(item, messageText);
            saveLeadExtractionStatus(item.key, { status: "complete", details });
          } catch (error) {
            const message = error instanceof Error ? error.message : "The AI request failed.";
            saveLeadExtractionStatus(item.key, { status: "failed", error: message });
            setAutomaticAnalysisError(`${item.channel} lead was detected, but its details could not be extracted: ${message}`);
          }
        }
      } catch (error) {
        setAutomaticAnalysisError(
          `${item.channel} message could not be classified: ${error instanceof Error ? error.message : "The AI request failed."}`,
        );
      } finally {
        classifyingIdentities.current.delete(identity);
      }
    };
    let nextIndex = 0;
    await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, async () => {
      while (nextIndex < candidates.length) {
        const item = candidates[nextIndex];
        nextIndex += 1;
        await classifyOne(item);
      }
    }));
  }, [persistSeenIdentity, requestClassification, requestLeadExtraction, saveClassification, saveLeadExtractionStatus]);

  const loadInbox = useCallback(async (checkForNewMessages = false) => {
    if (inboxRequestInProgress.current) return;
    inboxRequestInProgress.current = true;
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
      const identities = nextItems.map((item) => `${item.accountId}:${item.kind}:${item.messageIdentity}`);
      if (!initialSyncComplete.current) {
        identities.forEach((identity) => seenMessageIdentities.current.add(identity));
        while (seenMessageIdentities.current.size > 1000) {
          const oldest = seenMessageIdentities.current.values().next().value;
          if (typeof oldest === "string") seenMessageIdentities.current.delete(oldest);
        }
        initialSyncComplete.current = true;
        try {
          localStorage.setItem(
            "phigrad-inbox-seen-messages",
            JSON.stringify([...seenMessageIdentities.current].slice(-1000)),
          );
        } catch {
          setAutomaticAnalysisError("Automatic analysis may repeat after this page closes because local inbox state could not be saved.");
        }
      } else if (checkForNewMessages && aiConfigured) {
        void classifyNewMessages(
          nextItems.filter((item) =>
            !seenMessageIdentities.current.has(`${item.accountId}:${item.kind}:${item.messageIdentity}`),
          ),
        );
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load connected accounts.");
    } finally {
      setLoading(false);
      inboxRequestInProgress.current = false;
    }
  }, [aiConfigured, classifyNewMessages]);

  useEffect(() => {
    try {
      const storedSeen: unknown = JSON.parse(localStorage.getItem("phigrad-inbox-seen-messages") ?? "[]");
      if (Array.isArray(storedSeen)) {
        storedSeen.filter((value): value is string => typeof value === "string").forEach((value) => seenMessageIdentities.current.add(value));
        initialSyncComplete.current = storedSeen.length > 0;
      }
      const policyIsCurrent = localStorage.getItem("phigrad-inbox-lead-policy") === LEAD_POLICY_VERSION;
      if (!policyIsCurrent) {
        localStorage.removeItem("phigrad-inbox-classifications");
        localStorage.removeItem("phigrad-inbox-lead-extractions");
        localStorage.setItem("phigrad-inbox-lead-policy", LEAD_POLICY_VERSION);
      } else {
        const storedClassifications: unknown = JSON.parse(localStorage.getItem("phigrad-inbox-classifications") ?? "[]");
        if (Array.isArray(storedClassifications)) {
          const valid = storedClassifications.flatMap((entry) => {
            if (!Array.isArray(entry) || typeof entry[0] !== "string" || !isClassification(entry[1])) return [];
            return [[entry[0], entry[1]] as const];
          });
          classificationsRef.current = Object.fromEntries(valid.slice(-500));
          setClassifications(classificationsRef.current);
        }
        const storedExtractions: unknown = JSON.parse(localStorage.getItem("phigrad-inbox-lead-extractions") ?? "[]");
        if (Array.isArray(storedExtractions)) {
          const valid = storedExtractions.flatMap((entry) => {
            if (!Array.isArray(entry) || typeof entry[0] !== "string" || !isLeadExtraction(entry[1])) return [];
            return [[entry[0], { status: "complete", details: entry[1] } as const] as const];
          });
          leadExtractionsRef.current = Object.fromEntries(valid.slice(-500));
          setLeadExtractions(leadExtractionsRef.current);
        }
      }
    } catch {
      setAutomaticAnalysisError("Saved inbox classifications could not be read; older conversations will not be sent automatically.");
    }
    void loadInbox(false);
  }, [loadInbox]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadInbox(true);
    }, 60_000);
    return () => window.clearInterval(timer);
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

  function selectedConversationText(item: InboxItem): string {
    if (item.kind === "email") return item.content;
    return chatMessages
      .map((message) => `${message.isSender ? "Anand" : message.sender}: ${message.text}`)
      .join("\n\n");
  }

  async function analyzeSelectedConversation() {
    if (!selectedItem) return;
    const conversationText = selectedConversationText(selectedItem);
    if (conversationText.trim().length < 10) {
      setManualAnalysisError("There is not enough readable conversation history to classify as a lead.");
      return;
    }
    setManualAnalysisLoading(true);
    setManualAnalysisError("");
    try {
      const result = await requestClassification(conversationText);
      saveClassification(selectedItem.key, {
        ...result,
        source: "manual",
        classified_at: new Date().toISOString(),
      });
    } catch (error) {
      setManualAnalysisError(error instanceof Error ? error.message : "Could not analyze this conversation.");
    } finally {
      setManualAnalysisLoading(false);
    }
  }

  async function extractSelectedLeadDetails(item: InboxItem, conversationText: string) {
    const extractionRun = promotionExtractionRun.current + 1;
    promotionExtractionRun.current = extractionRun;
    setPromotionExtracting(true);
    setPromotionExtractionError("");
    saveLeadExtractionStatus(item.key, { status: "pending" });
    try {
      const details = await requestLeadExtraction(item, conversationText);
      if (promotionExtractionRun.current !== extractionRun) return;
      const completedDetails = {
        ...details,
        contact_name: details.contact_name || senderDisplayName(item) || null,
        email: details.email || item.senderEmail || null,
        phone: details.phone || item.senderPhone || null,
      };
      saveLeadExtractionStatus(item.key, { status: "complete", details: completedDetails });
      setPromotionForm((current) => current ? {
        ...completedDetails,
      } : current);
    } catch (error) {
      if (promotionExtractionRun.current !== extractionRun) return;
      const message = error instanceof Error ? error.message : "The AI request failed.";
      saveLeadExtractionStatus(item.key, { status: "failed", error: message });
      setPromotionExtractionError(
        `Lead details could not be extracted: ${message} You can review and enter the details manually, or retry extraction.`,
      );
    } finally {
      if (promotionExtractionRun.current === extractionRun) setPromotionExtracting(false);
    }
  }

  function beginPromotion() {
    if (!selectedItem || !classifications[selectedItem.key]?.is_lead) return;
    const conversationText = selectedConversationText(selectedItem);
    const savedExtraction = leadExtractions[selectedItem.key];
    const cachedDetails = savedExtraction?.status === "complete" ? savedExtraction.details : null;
    promotionExtractionRun.current += 1;
    setPromotionForm({
      ...(cachedDetails ?? {}),
      contact_name: cachedDetails?.contact_name || senderDisplayName(selectedItem) || null,
      organisation: cachedDetails?.organisation ?? null,
      role: cachedDetails?.role ?? null,
      email: cachedDetails?.email || selectedItem.senderEmail || null,
      phone: cachedDetails?.phone || selectedItem.senderPhone || null,
      source: leadSource(selectedItem.channel),
      service_interest: cachedDetails?.service_interest ?? "unclear",
      lead_intent: cachedDetails?.lead_intent ?? "inquiry",
      company_need: cachedDetails?.company_need ?? null,
      event_or_programme: cachedDetails?.event_or_programme ?? null,
      expected_audience: cachedDetails?.expected_audience ?? null,
      location: cachedDetails?.location ?? null,
      requested_date: cachedDetails?.requested_date ?? null,
      budget: cachedDetails?.budget ?? null,
      urgency: cachedDetails?.urgency ?? "unknown",
      decision_maker: cachedDetails?.decision_maker ?? "unknown",
      lead_stage: cachedDetails?.lead_stage ?? "new",
      next_action: cachedDetails?.next_action ?? null,
      next_action_date: cachedDetails?.next_action_date ?? null,
      summary: cachedDetails?.summary ?? "",
      qualification_notes: cachedDetails?.qualification_notes ?? null,
    });
    setPromotionNote(
      `${selectedItem.channel} · ${selectedItem.title}\n${selectedItem.timestamp ? `${selectedItem.timestamp}\n` : ""}\n${conversationText || selectedItem.preview}`.slice(0, 12000),
    );
    setPromotionError("");
    setPromotionDuplicateCheck(null);
    setPromotionExtractionError("");
    setPromotionSuccess("");
    setPromotionOpen(true);
    if (cachedDetails) {
      setPromotionExtracting(false);
    } else if (conversationText.trim().length >= 10) {
      void extractSelectedLeadDetails(selectedItem, conversationText);
    } else {
      setPromotionExtractionError("There is not enough readable conversation history to extract lead details. Enter them manually.");
    }
  }

  async function checkPromotionDuplicates() {
    if (!promotionForm) return;
    setPromotionDuplicateLoading(true);
    setPromotionError("");
    try {
      const email = (promotionForm.email ?? "").trim();
      const phone = (promotionForm.phone ?? "").trim();
      if (!email && !phone) {
        throw new Error("Enter an email address or phone number to check for an existing customer.");
      }
      const response = await fetch("/api/crm/contacts/check-duplicate", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const result = record(payload);
      if (!response.ok || !result || !Array.isArray(result.matches)) {
        throw new Error(crmRequestError(payload, "check for an existing customer"));
      }
      const matches = result.matches.flatMap((item): DuplicateContact[] => {
        const match = record(item);
        if (
          !match ||
          typeof match.id !== "string" ||
          typeof match.name !== "string" ||
          typeof match.email !== "string" ||
          typeof match.phone !== "string" ||
          !Array.isArray(match.matched_fields)
        ) return [];
        return [{
          id: match.id,
          name: match.name,
          email: match.email,
          phone: match.phone,
          company_name: typeof match.company_name === "string" ? match.company_name : null,
          matched_fields: match.matched_fields.filter((field): field is string => typeof field === "string"),
        }];
      });
      setPromotionDuplicateCheck({ email, phone, matches });
    } catch (error) {
      setPromotionDuplicateCheck(null);
      const message = error instanceof Error ? error.message : "";
      setPromotionError(
        /failed to fetch|networkerror/i.test(message)
          ? "Couldn't check for an existing customer because the CRM backend isn't responding. Start FastAPI at http://127.0.0.1:8001, then try again."
          : message || "Couldn't check for an existing customer. Please try again.",
      );
    } finally {
      setPromotionDuplicateLoading(false);
    }
  }

  async function submitPromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem || !promotionForm || !classifications[selectedItem.key]?.is_lead) return;
    setPromotionLoading(true);
    setPromotionError("");
    try {
      const fullName = (promotionForm.contact_name ?? "").trim();
      const nameParts = fullName.split(/\s+/).filter(Boolean);
      const leadClassification = classifications[selectedItem.key];
      if (!nameParts[0]) {
        throw new Error("Enter the lead contact's first name before saving.");
      }
      const response = await fetch("/api/crm/inbox-promotions", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: nameParts[0],
          last_name: nameParts.slice(1).join(" "),
          email: (promotionForm.email ?? "").trim(),
          phone: (promotionForm.phone ?? "").trim(),
          role: (promotionForm.role ?? "").trim(),
          company_name: (promotionForm.organisation ?? "").trim(),
          company_domain: "",
          source: `Unipile · ${selectedItem.channel}`,
          note: promotionNote.trim(),
          classification: {
            is_lead: leadClassification.is_lead,
            confidence: leadClassification.confidence,
            reason: leadClassification.reason,
          },
          lead_details: promotionForm,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const result = record(payload);
      if (!response.ok || typeof result?.contact_id !== "string") {
        const detail = result?.detail;
        const duplicateDetail = record(detail);
        if (duplicateDetail?.code === "duplicate_contact" && Array.isArray(duplicateDetail.matches)) {
          const matches = duplicateDetail.matches.flatMap((item): DuplicateContact[] => {
            const match = record(item);
            if (
              !match ||
              typeof match.id !== "string" ||
              typeof match.name !== "string" ||
              typeof match.email !== "string" ||
              typeof match.phone !== "string" ||
              !Array.isArray(match.matched_fields)
            ) return [];
            return [{
              id: match.id,
              name: match.name,
              email: match.email,
              phone: match.phone,
              company_name: typeof match.company_name === "string" ? match.company_name : null,
              matched_fields: match.matched_fields.filter((field): field is string => typeof field === "string"),
            }];
          });
          setPromotionDuplicateCheck({
            email: (promotionForm.email ?? "").trim(),
            phone: (promotionForm.phone ?? "").trim(),
            matches,
          });
          throw new Error(typeof duplicateDetail.message === "string" ? duplicateDetail.message : "Customer already exists in CRM.");
        }
        throw new Error(crmRequestError(payload, "save this lead to CRM"));
      }
      const changes = [
        result.contact_created === true ? "contact added" : "existing contact updated",
        result.company_created === true ? "company added" : result.company_id ? "company linked" : "",
        "conversation saved as a note",
      ].filter(Boolean);
      setPromotionSuccess(`CRM updated: ${changes.join(" · ")}.`);
      setPromotionOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setPromotionError(
        /failed to fetch|networkerror/i.test(message)
          ? "Couldn't save this lead because the CRM backend isn't responding. Start FastAPI at http://127.0.0.1:8001, then try again."
          : message || "Couldn't save this lead to CRM. Please try again.",
      );
    } finally {
      setPromotionLoading(false);
    }
  }

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
          <Link href="/"><span>⌂</span> CRM overview</Link>
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
            <button type="button" className="unified-refresh" onClick={() => void loadInbox(true)} disabled={loading}>{loading ? "Syncing…" : "↻  Refresh inbox"}</button>
          </div>
          <div className="unified-ai-notice" role="note">
            {aiConfigured
              ? "New incoming message text is sent to OpenRouter about once a minute while this inbox is open. If classified as a lead at 40% confidence or higher, sender metadata and conversation text are also sent for automatic detail extraction. No CRM record is saved without your review. Older conversations are only analyzed when requested."
              : "Configure OpenRouter to classify new conversations against Anand’s business lead criteria. Older conversations can be classified on request."}
          </div>
          {automaticAnalysisError && <div className="unified-error" role="status"><strong>AI classification needs attention</strong><span>{automaticAnalysisError}</span></div>}
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
                <div className="unified-list-heading"><span>{loading ? "Syncing conversations…" : `${filteredItems.length} conversations`}</span><button type="button" onClick={() => void loadInbox(true)} aria-label="Refresh conversations">↻</button></div>
                <div className="unified-conversation-list">
                  {!loading && filteredItems.length === 0 && (
                    <div className="unified-empty"><span className="unified-empty-icon">▤</span><strong>{accounts.length ? "No conversations found" : "Connect your first channel"}</strong><p>{accounts.length ? "Try another channel filter or check the account permissions." : "Connect Gmail, LinkedIn, Instagram, or another supported provider to see real conversations here."}</p><a href="#accounts">{accounts.length ? "Manage connected accounts" : "Connect an account"} <span>→</span></a></div>
                  )}
                  {filteredItems.map((item) => (
                    <button type="button" key={item.key} className={`unified-conversation ${selectedKey === item.key ? "current" : ""}`} onClick={() => { promotionExtractionRun.current += 1; setPromotionExtracting(false); setSelectedKey(item.key); setManualAnalysisError(""); setPromotionOpen(false); setPromotionError(""); setPromotionSuccess(""); }}>
                      <span className={`unified-contact-avatar channel-${item.channel.toLowerCase().replace(/[^a-z]/g, "")}`} aria-label={item.channel}><ProviderSymbol provider={item.channel} /></span>
                      <span className="unified-conversation-copy">
                        <span className="unified-conversation-meta"><strong>{item.title}</strong><time>{formatTime(item.timestamp)}</time></span>
                        <span className="unified-conversation-channel"><span className={`unified-channel-icon channel-${item.channel.toLowerCase().replace(/[^a-z]/g, "")}`}><ProviderSymbol provider={item.channel} /></span>{item.channel}<i>·</i>{item.sender}</span>
                        <span className="unified-conversation-preview">{item.preview}</span>
                        {classifications[item.key] && <span className={`unified-classification-badge relevance-${classifications[item.key].is_lead ? "business" : "not_business"}`}>{classifications[item.key].is_lead ? "Lead" : "Not a lead"} · {Math.round(classifications[item.key].confidence * 100)}%</span>}
                        {classifications[item.key]?.is_lead && leadExtractions[item.key] && <span className={`unified-classification-badge extraction-${leadExtractions[item.key].status}`}>{leadExtractions[item.key].status === "complete" ? "Lead details ready" : leadExtractions[item.key].status === "pending" ? "Extracting lead details…" : "Details need review"}</span>}
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
                    <section className="unified-conversation-actions" aria-label="Conversation actions">
                      {classifications[selectedItem.key] && (
                        <div className={`unified-classification-result relevance-${classifications[selectedItem.key].is_lead ? "business" : "not_business"}`}>
                          <strong>{classifications[selectedItem.key].is_lead ? "Potential business lead" : "Not classified as a lead"} · {Math.round(classifications[selectedItem.key].confidence * 100)}% confidence</strong>
                          <p>{classifications[selectedItem.key].reason}</p>
                        </div>
                      )}
                      {classifications[selectedItem.key]?.is_lead && leadExtractions[selectedItem.key] && (
                        <p className={leadExtractions[selectedItem.key].status === "failed" ? "unified-action-error" : "unified-action-hint"} role={leadExtractions[selectedItem.key].status === "failed" ? "alert" : "status"}>
                          {extractionStatusMessage(leadExtractions[selectedItem.key])}
                        </p>
                      )}
                      <div className="unified-conversation-action-buttons">
                        <button type="button" className="unified-action-secondary" onClick={() => void analyzeSelectedConversation()} disabled={!aiConfigured || manualAnalysisLoading || messagesLoading}>
                          {manualAnalysisLoading ? "Classifying…" : "Classify as lead"}
                        </button>
                        <button type="button" className="unified-action-primary" onClick={beginPromotion} disabled={!aiConfigured || !classifications[selectedItem.key]?.is_lead || messagesLoading || promotionExtracting || leadExtractions[selectedItem.key]?.status === "pending"}>
                          Add to CRM
                        </button>
                      </div>
                      {!aiConfigured && <p className="unified-action-hint">OpenRouter is not configured.</p>}
                      {aiConfigured && !classifications[selectedItem.key] && <p className="unified-action-hint">Classify this conversation first. Older conversations are analyzed only when you choose this action.</p>}
                      {aiConfigured && classifications[selectedItem.key] && !classifications[selectedItem.key].is_lead && <p className="unified-action-hint">Only conversations classified as genuine leads can be added to CRM.</p>}
                      {manualAnalysisError && <p className="unified-action-error" role="alert">{manualAnalysisError}</p>}
                      {promotionSuccess && <p className="unified-action-success" role="status">{promotionSuccess}</p>}
                      {promotionOpen && promotionForm && (
                        <form className="unified-promotion-form" onSubmit={(event) => void submitPromotion(event)}>
                          <div className="unified-promotion-heading"><strong>Review extracted lead details</strong><button type="button" onClick={() => { promotionExtractionRun.current += 1; setPromotionExtracting(false); setPromotionOpen(false); }} aria-label="Close CRM form">×</button></div>
                          <p>AI-extracted fields are suggestions. Edit them, check the email or phone for an existing customer, then save the new contact and conversation details.</p>
                          {promotionExtracting && <p className="unified-action-hint" role="status">Extracting relevant lead details…</p>}
                          {promotionExtractionError && <div className="unified-extraction-error"><p className="unified-action-error" role="alert">{promotionExtractionError}</p><button type="button" className="unified-action-secondary" onClick={() => void extractSelectedLeadDetails(selectedItem, selectedConversationText(selectedItem))} disabled={promotionExtracting}>Retry extraction</button></div>}
                          <div className="unified-promotion-fields">
                            <label>Contact name<input required maxLength={200} value={promotionForm.contact_name ?? ""} onChange={(event) => setPromotionForm({ ...promotionForm, contact_name: event.target.value || null })} /></label>
                            <label>Organisation<input maxLength={180} value={promotionForm.organisation ?? ""} onChange={(event) => setPromotionForm({ ...promotionForm, organisation: event.target.value || null })} /></label>
                            <label>Role<input maxLength={120} value={promotionForm.role ?? ""} onChange={(event) => setPromotionForm({ ...promotionForm, role: event.target.value || null })} /></label>
                            <label>Email<input type="email" maxLength={254} value={promotionForm.email ?? ""} onChange={(event) => { setPromotionForm({ ...promotionForm, email: event.target.value || null }); setPromotionDuplicateCheck(null); setPromotionError(""); }} /></label>
                            <label>Phone<input maxLength={100} value={promotionForm.phone ?? ""} onChange={(event) => { setPromotionForm({ ...promotionForm, phone: event.target.value || null }); setPromotionDuplicateCheck(null); setPromotionError(""); }} /></label>
                          </div>
                          <div className="unified-duplicate-check">
                            <button type="button" className="unified-action-secondary" onClick={() => void checkPromotionDuplicates()} disabled={promotionDuplicateLoading || !(promotionForm.email?.trim() || promotionForm.phone?.trim())}>
                              {promotionDuplicateLoading ? "Checking…" : "Check existing customer"}
                            </button>
                            {!promotionForm.email?.trim() && !promotionForm.phone?.trim() && (
                              <p className="unified-action-hint">Enter an email or phone number above to check for an existing customer.</p>
                            )}
                            {promotionDuplicateCheck &&
                              promotionDuplicateCheck.email === (promotionForm.email ?? "").trim() &&
                              promotionDuplicateCheck.phone === (promotionForm.phone ?? "").trim() && (
                              promotionDuplicateCheck.matches.length > 0 ? (
                                <div className="unified-duplicate-result" role="alert">
                                  <strong>Customer already exists in CRM. This lead cannot be added as a duplicate.</strong>
                                  {promotionDuplicateCheck.matches.map((match) => (
                                    <p key={match.id}>
                                      {match.name || "Unnamed contact"}
                                      {match.company_name ? ` · ${match.company_name}` : ""}
                                      {match.email ? ` · ${match.email}` : ""}
                                      {match.phone ? ` · ${match.phone}` : ""}
                                      {` · Matched by ${match.matched_fields.join(" and ")}`}
                                    </p>
                                  ))}
                                </div>
                              ) : (
                                <p className="unified-duplicate-clear" role="status">No existing customer found for this email or phone.</p>
                              )
                            )}
                            {promotionError && <p className="unified-action-error" role="alert">{promotionError}</p>}
                          </div>
                          <div className="unified-promotion-fields">
                            <label>Lead source<select value={promotionForm.source} onChange={(event) => setPromotionForm({ ...promotionForm, source: event.target.value as LeadSource })}>{(["email", "whatsapp", "linkedin", "instagram", "website", "phone", "other"] as const).map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
                            <label>Service interest<select value={promotionForm.service_interest} onChange={(event) => setPromotionForm({ ...promotionForm, service_interest: event.target.value as LeadExtraction["service_interest"] })}>{(["executive_coaching", "executive_presence", "storytelling_communication", "corporate_training", "leadership_workshop", "keynote_speaking", "event_speaking", "professional_development", "coaching_programme", "other", "unclear"] as const).map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
                            <label>Lead intent<select value={promotionForm.lead_intent} onChange={(event) => setPromotionForm({ ...promotionForm, lead_intent: event.target.value as LeadExtraction["lead_intent"] })}>{(["inquiry", "availability_request", "pricing_request", "proposal_request", "meeting_request", "speaking_request", "training_request", "coaching_request", "partnership", "referral", "other"] as const).map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
                            <label>Event or programme<input maxLength={300} value={promotionForm.event_or_programme ?? ""} onChange={(event) => setPromotionForm({ ...promotionForm, event_or_programme: event.target.value || null })} /></label>
                            <label>Expected audience<input maxLength={300} value={promotionForm.expected_audience ?? ""} onChange={(event) => setPromotionForm({ ...promotionForm, expected_audience: event.target.value || null })} /></label>
                            <label>Location<input maxLength={180} value={promotionForm.location ?? ""} onChange={(event) => setPromotionForm({ ...promotionForm, location: event.target.value || null })} /></label>
                            <label>Requested date or timeframe<input maxLength={180} value={promotionForm.requested_date ?? ""} onChange={(event) => setPromotionForm({ ...promotionForm, requested_date: event.target.value || null })} /></label>
                            <label>Budget<input maxLength={120} value={promotionForm.budget ?? ""} onChange={(event) => setPromotionForm({ ...promotionForm, budget: event.target.value || null })} /></label>
                            <label>Urgency<select value={promotionForm.urgency} onChange={(event) => setPromotionForm({ ...promotionForm, urgency: event.target.value as LeadExtraction["urgency"] })}>{(["high", "medium", "low", "unknown"] as const).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                            <label>Decision maker<select value={promotionForm.decision_maker} onChange={(event) => setPromotionForm({ ...promotionForm, decision_maker: event.target.value as LeadExtraction["decision_maker"] })}>{(["yes", "no", "unknown"] as const).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                            <label>Lead stage<select value={promotionForm.lead_stage} onChange={(event) => setPromotionForm({ ...promotionForm, lead_stage: event.target.value as LeadExtraction["lead_stage"] })}>{(["new", "contacted", "discovery_call_booked", "qualified", "proposal_sent", "follow_up", "negotiation", "won", "lost", "nurture"] as const).map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
                            <label>Next action<input maxLength={500} value={promotionForm.next_action ?? ""} onChange={(event) => setPromotionForm({ ...promotionForm, next_action: event.target.value || null })} /></label>
                            <label>Next-action date<input type="text" maxLength={60} placeholder="YYYY-MM-DD, if confirmed" value={promotionForm.next_action_date ?? ""} onChange={(event) => setPromotionForm({ ...promotionForm, next_action_date: event.target.value || null })} /></label>
                          </div>
                          <label className="unified-promotion-note">Company need<textarea maxLength={600} rows={2} value={promotionForm.company_need ?? ""} onChange={(event) => setPromotionForm({ ...promotionForm, company_need: event.target.value || null })} /></label>
                          <label className="unified-promotion-note">CRM summary<textarea maxLength={1200} rows={3} value={promotionForm.summary} onChange={(event) => setPromotionForm({ ...promotionForm, summary: event.target.value })} /></label>
                          <label className="unified-promotion-note">Qualification notes<textarea maxLength={2000} rows={3} value={promotionForm.qualification_notes ?? ""} onChange={(event) => setPromotionForm({ ...promotionForm, qualification_notes: event.target.value || null })} /></label>
                          <label className="unified-promotion-note">Conversation to attach<textarea required maxLength={12000} rows={5} value={promotionNote} onChange={(event) => setPromotionNote(event.target.value)} /></label>
                          <div className="unified-conversation-action-buttons"><button type="button" className="unified-action-secondary" onClick={() => { promotionExtractionRun.current += 1; setPromotionExtracting(false); setPromotionOpen(false); }}>Cancel</button><button type="submit" className="unified-action-primary" disabled={promotionLoading || promotionExtracting || promotionDuplicateLoading || (promotionDuplicateCheck?.email === (promotionForm.email ?? "").trim() && promotionDuplicateCheck.phone === (promotionForm.phone ?? "").trim() && promotionDuplicateCheck.matches.length > 0) || !promotionNote.trim() || !promotionForm.contact_name?.trim()}>{promotionLoading ? "Saving…" : "Save lead to CRM"}</button></div>
                        </form>
                      )}
                    </section>
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
