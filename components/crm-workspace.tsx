"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import RecentConversations from "@/components/recent-conversations";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

type View = "overview" | "contacts" | "companies" | "pipeline" | "tasks" | "assistant";
type Contact = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  title: string;
  company_id: string | null;
  company_name?: string;
  source: string;
  status: string;
  tags: string[];
  created_at: string;
  open_tasks_count?: number;
  total_tasks_count?: number;
};
type Company = {
  id: string;
  name: string;
  domain: string;
  industry: string;
  website: string;
  size: string;
  notes: string;
  contact_count: number;
  open_deals: number;
};
type Deal = {
  id: string;
  title: string;
  contact_id: string | null;
  contact_name: string | null;
  company_id: string | null;
  company_name: string | null;
  stage: string;
  amount: number;
  currency: string;
  expected_close_date: string | null;
  description: string;
};
type Task = {
  id: string;
  title: string;
  description: string;
  due_date: string | null;
  priority: string;
  completed: boolean;
  contact_id: string | null;
  contact_name: string | null;
  deal_id: string | null;
  deal_title: string | null;
};
type Note = {
  id: string;
  body: string;
  created_at: string;
  channel?: string;
  source_key?: string | null;
  account_id?: string;
  conversation_id?: string;
  conversation_kind?: "email" | "chat" | "";
  message_id?: string;
  unverified_fields?: string[];
};
type StructuredLeadNote = {
  classification: { is_lead?: boolean; confidence: number; reason: string } | null;
  lead_details: Record<string, unknown>;
  unverified_fields: string[];
  channel: string;
  account_id: string;
  conversation_id: string;
  conversation_kind: "email" | "chat" | "";
  message_id: string;
  conversation: string;
};
type ContactDetail = Contact & {
  company: { id: string; name: string } | null;
  deals: Deal[];
  tasks: Task[];
  notes: Note[];
};
type Summary = {
  contacts: number;
  companies: number;
  open_deals: number;
  pipeline_value: number;
  open_tasks: number;
  due_tasks_count: number;
  stages: { stage: string; count: number; value: number }[];
  recent_contacts: Contact[];
  due_tasks: Task[];
};
type AIAssist = {
  summary: string;
  category: string;
  sentiment: "positive" | "neutral" | "negative" | "mixed";
  next_step: string;
  suggested_reply: string;
  business_relevance: "business" | "not_business" | "unclear";
  business_reason: string;
  opportunity_status: "opportunity" | "not_opportunity" | "unclear";
  opportunity_reason: string;
};
type AIAssistFocus = "general" | "follow_up" | "quick_summary" | "deal_blockers";
type Modal = { type: "contact" | "company" | "deal" | "task"; record?: Contact | Company | Deal };
type AssistantConversation = {
  channel: string;
  kind: "email" | "chat";
  accountId: string;
  conversationId: string;
  recipientEmail: string;
  subject: string;
};

const assistantQuickActions: { focus: Exclude<AIAssistFocus, "general">; label: string }[] = [
  { focus: "follow_up", label: "Draft a follow-up" },
  { focus: "quick_summary", label: "Quick summary" },
  { focus: "deal_blockers", label: "What may be blocking the sale?" },
];

const stages = [
  { id: "new", label: "New", color: "violet" },
  { id: "qualified", label: "Qualified", color: "blue" },
  { id: "proposal", label: "Proposal", color: "amber" },
  { id: "won", label: "Won", color: "green" },
  { id: "lost", label: "Lost", color: "gray" },
];

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function structuredLeadNote(body: string): StructuredLeadNote | null {
  try {
    const parsed = object(JSON.parse(body));
    if (!parsed) return null;
    const classification = object(parsed.classification);
    const leadDetails = object(parsed.lead_details);
    if (
      !["lead_opportunity", "inbox_conversation"].includes(String(parsed.record_type)) ||
      (classification !== null && classification !== undefined && (
        typeof classification.confidence !== "number" ||
        typeof classification.reason !== "string"
      )) ||
      typeof parsed.conversation !== "string"
    ) {
      return null;
    }
    return {
      classification: classification && typeof classification.confidence === "number"
        ? { is_lead: typeof classification.is_lead === "boolean" ? classification.is_lead : undefined, confidence: classification.confidence, reason: String(classification.reason ?? "") }
        : null,
      lead_details: leadDetails ?? {},
      unverified_fields: Array.isArray(parsed.unverified_fields) ? parsed.unverified_fields.filter((field): field is string => typeof field === "string") : [],
      channel: typeof parsed.channel === "string" ? parsed.channel : "",
      account_id: typeof parsed.account_id === "string" ? parsed.account_id : "",
      conversation_id: typeof parsed.conversation_id === "string" ? parsed.conversation_id : "",
      conversation_kind: parsed.conversation_kind === "email" || parsed.conversation_kind === "chat" ? parsed.conversation_kind : "",
      message_id: typeof parsed.message_id === "string" ? parsed.message_id : "",
      conversation: parsed.conversation,
    };
  } catch {
    return null;
  }
}

function formatChannelLabel(raw: string): string {
  const clean = raw.trim();
  if (!clean) return "CRM note";
  const lower = clean.toLowerCase();
  if (lower === "instagram") return "Instagram";
  if (lower === "linkedin") return "LinkedIn";
  if (lower === "whatsapp") return "WhatsApp";
  if (lower === "gmail" || lower === "google") return "Gmail";
  if (lower === "outlook") return "Outlook";
  if (lower === "telegram") return "Telegram";
  return clean[0].toUpperCase() + clean.slice(1);
}

function extractNoteChannel(note: Note): string {
  if (note.channel?.trim()) return formatChannelLabel(note.channel);
  const lead = structuredLeadNote(note.body);
  if (lead?.channel) return formatChannelLabel(lead.channel);
  if (lead?.lead_details.source && typeof lead.lead_details.source === "string") {
    return formatChannelLabel(lead.lead_details.source);
  }
  const match = note.body.match(/\[[^\]]*·\s*([^\]]+)\]/);
  if (match) return formatChannelLabel(match[1]);
  return "CRM note";
}

function contactConversationHistory(
  contact: ContactDetail,
  channelFilter: string = "All channels",
  infoFilter: "all" | "unverified" = "all",
  maxLength: number = 12000,
): string {
  // Sort chronologically ascending based on note created_at
  const sortedNotes = [...contact.notes].sort(
    (a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0),
  );

  const filteredNotes = sortedNotes.filter((note) => {
    const channelMatches = channelFilter === "All channels" ||
      extractNoteChannel(note).toLowerCase().includes(channelFilter.toLowerCase());
    if (!channelMatches) return false;
    if (infoFilter === "unverified") {
      const structured = structuredLeadNote(note.body);
      const fields = note.unverified_fields ?? structured?.unverified_fields ?? [];
      return fields.length > 0;
    }
    return true;
  });

  const entries = filteredNotes
    .map((note) => {
      const lead = structuredLeadNote(note.body);
      const content = lead?.conversation ?? note.body;
      if (!content.trim()) return null;
      const channel = extractNoteChannel(note);
      const lines = [`[${new Date(note.created_at).toLocaleString()} · ${channel}]`, content.trim()];
      if (infoFilter === "unverified" && lead) {
        const fields = note.unverified_fields ?? lead.unverified_fields;
        const extracted = fields.flatMap((field) => {
          const value = lead.lead_details[field];
          return value === null || value === undefined || value === "" ? [] : [`${field.replaceAll("_", " ")}: ${String(value)}`];
        });
        if (extracted.length) lines.push(`[UNVERIFIED AI-EXTRACTED DETAILS]\n${extracted.join("\n")}`);
        if (lead.classification) {
          lines.push(`[UNVERIFIED AI CLASSIFICATION]\nPotential customer: ${lead.classification.is_lead ? "yes" : "no"} · ${Math.round(lead.classification.confidence * 100)}% confidence · ${lead.classification.reason}`);
        }
      }
      return lines.join("\n");
    })
    .filter((entry): entry is string => Boolean(entry));

  const totalText = entries.join("\n\n");
  return totalText.length > maxLength
    ? `[Earlier conversation history clipped for context window]\n\n${totalText.slice(-maxLength)}`
    : totalText;
}

function contactAssistantContext(contact: ContactDetail): string {
  const lines = [
    `Contact: ${displayName(contact)}`,
    contact.company?.name ? `Organisation: ${contact.company.name}` : "",
    contact.title ? `Role: ${contact.title}` : "",
    `Contact status: ${contact.status}`,
    ...contact.deals.map((deal) => `Deal: ${deal.title} · stage ${deal.stage}${deal.description ? ` · ${deal.description}` : ""}`),
    ...contact.tasks.filter((task) => !task.completed).map((task) => `Open task: ${task.title}${task.description ? ` · ${task.description}` : ""}`),
  ].filter(Boolean);
  return lines.join("\n").slice(0, 2000);
}

function leadFieldLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function cleanNoteBody(body: string): string {
  try {
    if (object(JSON.parse(body))?.record_type === "lead_opportunity") return body;
  } catch {
    return cleanDisplayText(body);
  }
  return cleanDisplayText(body);
}

async function crmRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/crm${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = object(result);
    const detail = body?.detail ?? body?.error;
    if (typeof detail === "string") throw new Error(detail);
    if (Array.isArray(detail)) {
      const validationErrors = detail.flatMap((item) => {
        const validationError = object(item);
        if (!validationError || typeof validationError.msg !== "string") return [];
        const location = Array.isArray(validationError.loc)
          ? validationError.loc.filter((part): part is string | number => typeof part === "string" || typeof part === "number").slice(1).join(".")
          : "";
        return [location ? `${location}: ${validationError.msg}` : validationError.msg];
      });
      if (validationErrors.length) {
        throw new Error(`Please check the CRM fields: ${validationErrors.join("; ")}`);
      }
    }
    throw new Error(`CRM request failed (${response.status}).`);
  }
  return result as T;
}

function displayName(contact: Pick<Contact, "first_name" | "last_name">): string {
  return `${contact.first_name} ${contact.last_name}`.trim();
}

function cleanDisplayText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\s*\(demo\)/gi, "")
    .replace(/\bfictional\b/gi, "")
    .replace(/\bdemo(?:\s+dataset)?\b/gi, "")
    .replace(/^\s*[:\-]\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,:;-]+|[\s.,:;-]+$/g, "")
    .trim();
}

function cleanContact(contact: Contact): Contact {
  return {
    ...contact,
    company_name: contact.company_name ? cleanDisplayText(contact.company_name) : contact.company_name,
    source: cleanDisplayText(contact.source),
    tags: (contact.tags ?? []).filter((tag) => !/demo/i.test(tag)),
  };
}

function cleanCompany(company: Company): Company {
  return { ...company, name: cleanDisplayText(company.name), notes: cleanDisplayText(company.notes) };
}

function cleanDeal(deal: Deal): Deal {
  return {
    ...deal,
    title: cleanDisplayText(deal.title),
    description: cleanDisplayText(deal.description),
    contact_name: deal.contact_name ? cleanDisplayText(deal.contact_name) : deal.contact_name,
    company_name: deal.company_name ? cleanDisplayText(deal.company_name) : deal.company_name,
  };
}

function cleanTask(task: Task): Task {
  return {
    ...task,
    title: cleanDisplayText(task.title),
    description: cleanDisplayText(task.description),
    contact_name: task.contact_name ? cleanDisplayText(task.contact_name) : task.contact_name,
    deal_title: task.deal_title ? cleanDisplayText(task.deal_title) : task.deal_title,
  };
}

function cleanContactDetail(detail: ContactDetail): ContactDetail {
  return {
    ...cleanContact(detail),
    company: detail.company ? { ...detail.company, name: cleanDisplayText(detail.company.name) } : null,
    deals: detail.deals.map(cleanDeal),
    tasks: detail.tasks.map(cleanTask),
    notes: detail.notes.map((note) => ({ ...note, body: cleanNoteBody(note.body) })),
  };
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "No due date";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function initial(value: string): string {
  return value.trim().slice(0, 1).toUpperCase() || "?";
}

export default function CRMWorkspace({ aiConfigured, unipileConfigured }: { aiConfigured: boolean; unipileConfigured: boolean }) {
  const [view, setView] = useState<View>("overview");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);
  const [contactDetail, setContactDetail] = useState<ContactDetail | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [conversationText, setConversationText] = useState("");
  const [assistantContactId, setAssistantContactId] = useState("");
  const [assistantSourceLabel, setAssistantSourceLabel] = useState("");
  const [analysisConsent, setAnalysisConsent] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIAssist | null>(null);
  const [aiError, setAiError] = useState("");
  const [aiFocus, setAiFocus] = useState<AIAssistFocus>("general");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSummary, nextContacts, nextCompanies, nextDeals, nextTasks] = await Promise.all([
        crmRequest<Summary>("/summary"),
        crmRequest<Contact[]>("/contacts"),
        crmRequest<Company[]>("/companies"),
        crmRequest<Deal[]>("/deals"),
        crmRequest<Task[]>("/tasks"),
      ]);
      setSummary({
        ...nextSummary,
        recent_contacts: nextSummary.recent_contacts.map(cleanContact),
        due_tasks: nextSummary.due_tasks.map(cleanTask),
      });
      setContacts(nextContacts.map(cleanContact));
      setCompanies(nextCompanies.map(cleanCompany));
      setDeals(nextDeals.map(cleanDeal));
      setTasks(nextTasks.map(cleanTask));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load CRM data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openTasks = useMemo(() => tasks.filter((task) => !task.completed), [tasks]);
  const visibleContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contacts.filter((contact) =>
      !query || [displayName(contact), contact.email, contact.company_name ?? "", contact.title]
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [contacts, search]);

  async function submitRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;
    setSaving(true);
    setError("");
    const formData = new FormData(event.currentTarget);
    const form = Object.fromEntries(formData.entries());
    const record = Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]),
    ) as Record<string, string | number | null>;
    const endpoint = {
      contact: "/contacts",
      company: "/companies",
      deal: "/deals",
      task: "/tasks",
    }[modal.type];
    if ("company_id" in record && !record.company_id) record.company_id = null;
    if ("contact_id" in record && !record.contact_id) record.contact_id = null;
    if ("deal_id" in record && !record.deal_id) record.deal_id = null;
    if ("expected_close_date" in record && !record.expected_close_date) record.expected_close_date = null;
    if ("due_date" in record && !record.due_date) record.due_date = null;
    if ("amount" in record) record.amount = Number(record.amount || 0);
    const updateId = modal.record?.id;
    const updatePath = updateId ? `${endpoint}/${encodeURIComponent(updateId)}` : endpoint;
    try {
      await crmRequest(updatePath, {
        method: updateId ? "PATCH" : "POST",
        body: JSON.stringify(record),
      });
      setModal(null);
      await refresh();
      if (contactDetail && modal.type === "contact") await showContact(contactDetail.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this record.");
    } finally {
      setSaving(false);
    }
  }

  async function showContact(contactId: string) {
    setContactLoading(true);
    setContactDetail(null);
    setConversationText("");
    setAssistantSourceLabel("");
    setAiResult(null);
    setAiError("");
    setAnalysisConsent(false);
    setAiFocus("general");
    try {
      const detail = await crmRequest<ContactDetail>(`/contacts/${encodeURIComponent(contactId)}`);
      setContactDetail(cleanContactDetail(detail));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load contact.");
    } finally {
      setContactLoading(false);
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactDetail || !noteText.trim()) return;
    setSaving(true);
    try {
      await crmRequest(`/contacts/${encodeURIComponent(contactDetail.id)}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: noteText.trim() }),
      });
      setNoteText("");
      await showContact(contactDetail.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save note.");
    } finally {
      setSaving(false);
    }
  }

  async function analyzeText(text: string, context: string, focus: AIAssistFocus = "general") {
    if (text.trim().length < 10) {
      setAiError("Paste at least 10 characters of business conversation first.");
      return;
    }
    if (!analysisConsent) {
      setAiError("Confirm that you have permission to share this text before analyzing it.");
      return;
    }
    setAiLoading(true);
    setAiError("");
    setAiResult(null);
    setAnalysisConsent(false);
    try {
      const result = await crmRequest<AIAssist>("/ai/assist", {
        method: "POST",
        body: JSON.stringify({
          text: text.trim(),
          contact_context: context,
          analysis_focus: focus,
        }),
      });
      setAiResult(result);
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : "The AI assistant could not analyze this conversation.");
    } finally {
      setAiLoading(false);
    }
  }

  const [historyChannelFilter, setHistoryChannelFilter] = useState("All channels");
  const [historyInfoFilter, setHistoryInfoFilter] = useState<"all" | "unverified">("all");
  const [assistantConversation, setAssistantConversation] = useState<AssistantConversation | null>(null);
  const [sendReplyOpen, setSendReplyOpen] = useState(false);
  const [sendReplyText, setSendReplyText] = useState("");
  const [sendReplyAccountId, setSendReplyAccountId] = useState("");
  const [sendReplyContactId, setSendReplyContactId] = useState("");
  const [sendReplyRecipient, setSendReplyRecipient] = useState("");
  const [sendReplyKind, setSendReplyKind] = useState<"email" | "chat">("email");
  const [sendReplySubject, setSendReplySubject] = useState("");
  const [sendReplyChannel, setSendReplyChannel] = useState("email");
  const [sendReplyLoading, setSendReplyLoading] = useState(false);
  const [sendReplyError, setSendReplyError] = useState("");
  const [sendReplySuccess, setSendReplySuccess] = useState("");
  const [unipileAccounts, setUnipileAccounts] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [followUpDueDate, setFollowUpDueDate] = useState(() => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [suggestedTaskSaved, setSuggestedTaskSaved] = useState(false);

  const loadUnipileAccounts = useCallback(async () => {
    try {
      const response = await fetch("/api/unipile/bridge/v2/accounts", { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      const rows = object(payload)?.data;
      if (Array.isArray(rows)) {
        const list = rows.flatMap((r) => {
          const item = object(r);
          if (!item || typeof item.id !== "string") return [];
          return [{
            id: item.id,
            name: typeof item.name === "string" ? item.name : item.id,
            provider: typeof item.provider === "string" ? item.provider : "unknown",
          }];
        });
        setUnipileAccounts(list);
        if (list[0]) {
          const firstEmail = list.find((account) => ["google", "gmail", "outlook", "microsoft", "imap"].includes(account.provider.toLowerCase()));
          setSendReplyAccountId((current) => current || (firstEmail ?? list[0]).id);
        }
      }
    } catch {
      // Ignore if accounts can't be fetched
    }
  }, []);

  useEffect(() => {
    if (unipileConfigured) {
      void loadUnipileAccounts();
    }
  }, [unipileConfigured, loadUnipileAccounts]);

  function openSendReplyModal(draftText: string, targetContact?: Contact, initialSubject?: string) {
    const contact = targetContact ?? contactDetail ?? contacts.find((item) => item.id === assistantContactId);
    setSendReplyContactId(contact?.id ?? assistantContactId ?? "");
    let conversation = assistantConversation;
    if (!conversation && contact) {
      const contactNotes = (contact as ContactDetail).notes || [];
      const latestThread = [...contactNotes]
        .filter((note) => note.account_id && note.conversation_id && note.conversation_kind)
        .sort((left, right) => (Date.parse(right.created_at) || 0) - (Date.parse(left.created_at) || 0))[0];
      if (latestThread?.account_id && latestThread.conversation_id && latestThread.conversation_kind) {
        conversation = {
          channel: latestThread.channel || extractNoteChannel(latestThread),
          kind: latestThread.conversation_kind,
          accountId: latestThread.account_id,
          conversationId: latestThread.conversation_id,
          recipientEmail: contact?.email ?? "",
          subject: "",
        };
        setAssistantConversation(conversation);
      }
    }
    setSendReplyText(draftText);
    setSendReplyError("");
    setSendReplySuccess("");
    const recipient = conversation?.recipientEmail || contact?.email || "";
    setSendReplyRecipient(recipient);
    setSendReplySubject(
      initialSubject ||
        (conversation?.subject ? `Re: ${conversation.subject}` : contact ? `Following up: Anand Munshi · ${displayName(contact)}` : "Following up"),
    );
    setSendReplyKind(conversation?.kind ?? (contact?.email ? "email" : "chat"));
    setSendReplyChannel(conversation?.channel ?? (contact?.email ? "email" : "chat"));
    if (conversation?.accountId) setSendReplyAccountId(conversation.accountId);
    setSendReplyOpen(true);
  }

  function handleFollowUpReply(task: Task) {
    const contact = contacts.find((c) => c.id === task.contact_id);
    const draft = `Hi ${contact ? contact.first_name : "there"},\n\nFollowing up regarding: ${task.title}.\n\nLet me know your thoughts.\n\nBest,\nAnand`;
    openSendReplyModal(draft, contact, `Following up: ${task.title}`);
  }

  function handleFollowUpAI(task: Task) {
    const contact = contacts.find((c) => c.id === task.contact_id);
    setView("assistant");
    setAssistantContactId(task.contact_id || "");
    const contextLines = [
      `Follow-up task: ${task.title}`,
      task.description ? `Details: ${task.description}` : "",
      task.due_date ? `Due date: ${task.due_date}` : "",
      contact ? `Contact: ${displayName(contact)}${contact.company_name ? ` · ${contact.company_name}` : ""}` : "",
    ].filter(Boolean).join("\n");
    setConversationText(contextLines);
    setAssistantSourceLabel(`Follow-up: ${task.title}`);
    setAiResult(null);
    setAiError("");
    setAnalysisConsent(true);
  }

  async function handleSendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sendReplyAccountId || !sendReplyText.trim()) {
      setSendReplyError("Choose a connected account and enter message text.");
      return;
    }
    setSendReplyLoading(true);
    setSendReplyError("");
    setSendReplySuccess("");
    try {
      const selectedAcc = unipileAccounts.find((a) => a.id === sendReplyAccountId);
      if (!selectedAcc) throw new Error("The selected connected account is no longer available. Refresh accounts and try again.");
      const isEmailAccount = ["google", "gmail", "outlook", "microsoft", "imap"].includes(selectedAcc.provider.toLowerCase());

      if (isEmailAccount) {
        if (!sendReplyRecipient.trim()) throw new Error("Enter the customer's email address before sending.");
        const response = await fetch(`/api/unipile/bridge/v2/${encodeURIComponent(sendReplyAccountId)}/emails/send`, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: [{ email: sendReplyRecipient.trim() }],
            subject: sendReplySubject.trim() || "Message from Anand Munshi",
            plain_text: sendReplyText.trim(),
          }),
        });
        const resJson: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const detail = object(resJson)?.detail ?? object(resJson)?.error;
          throw new Error(typeof detail === "string" ? detail : `Email send failed (${response.status}).`);
        }
      } else {
        const hasExistingThread = assistantConversation?.kind === "chat" && assistantConversation.accountId === sendReplyAccountId && assistantConversation.conversationId;
        const chatSendUrl = hasExistingThread
          ? `/api/unipile/bridge/v2/${encodeURIComponent(sendReplyAccountId)}/chats/${encodeURIComponent(assistantConversation.conversationId)}/messages/send`
          : `/api/unipile/bridge/v2/${encodeURIComponent(sendReplyAccountId)}/chats`;
        const chatSendBody = hasExistingThread
          ? JSON.stringify({ text: sendReplyText.trim() })
          : JSON.stringify({
              users_ids: [sendReplyRecipient.trim()],
              text: sendReplyText.trim(),
            });

        const response = await fetch(chatSendUrl, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: chatSendBody,
        });
        const resJson: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const detail = object(resJson)?.detail ?? object(resJson)?.error ?? object(resJson)?.message;
          throw new Error(typeof detail === "string" ? detail : `Message send failed (${response.status}). Check recipient ID or channel.`);
        }
      }

      const contact =
        (sendReplyContactId ? contacts.find((item) => item.id === sendReplyContactId) : null) ??
        contactDetail ??
        contacts.find((item) => item.id === assistantContactId);
      if (contact) {
        const sentAt = new Date().toISOString();
        const channelName = selectedAcc.provider;
        const messageId = `sent-${Date.now()}`;
        const sentLog = `[${channelName} · outbound · ${sentAt}]\n${sendReplyText.trim()}`;
        try {
          await crmRequest(`/contacts/${encodeURIComponent(contact.id)}/notes`, {
            method: "POST",
            body: JSON.stringify({
              body: sentLog,
              channel: channelName,
              created_at: sentAt,
              source_key: `sent:${sendReplyAccountId}:${assistantConversation?.conversationId ?? sendReplyRecipient}:${messageId}`,
              account_id: sendReplyAccountId,
              conversation_id: assistantConversation?.conversationId ?? "",
              conversation_kind: isEmailAccount ? "email" : "chat",
              message_id: messageId,
            }),
          });
        } catch {
          throw new Error("Message was sent, but CRM could not save the sent-message activity. Reopen the contact and add it manually.");
        }
        await refresh();
        if (contactDetail && contactDetail.id === contact.id) {
          await showContact(contact.id);
        } else if (assistantContactId === contact.id) {
          await showContact(contact.id);
        }
      }

      setSendReplySuccess(contact ? "Message sent and saved to the CRM timeline." : "Message sent successfully.");
      setTimeout(() => setSendReplyOpen(false), 2000);
    } catch (caught) {
      setSendReplyError(caught instanceof Error ? caught.message : "The message could not be sent.");
    } finally {
      setSendReplyLoading(false);
    }
  }

  function analyzeConversation() {
    if (!contactDetail) return;
    void analyzeText(conversationText, contactAssistantContext(contactDetail), aiFocus);
  }

  function analyzeFromAssistant() {
    const contact = contacts.find((item) => item.id === assistantContactId);
    const context = contact
      ? `${displayName(contact)}${contact.company_name ? `, ${contact.company_name}` : ""}${contact.title ? `, ${contact.title}` : ""}`
      : "";
    void analyzeText(conversationText, context, "general");
  }

  function prepareContactAssistant(focus: Exclude<AIAssistFocus, "general">) {
    if (!contactDetail) return;
    const history = contactConversationHistory(contactDetail, historyChannelFilter, historyInfoFilter);
    const latestThread = [...contactDetail.notes]
      .filter((note) => note.account_id && note.conversation_id && note.conversation_kind)
      .filter((note) => historyChannelFilter === "All channels" || extractNoteChannel(note).toLowerCase().includes(historyChannelFilter.toLowerCase()))
      .sort((left, right) => (Date.parse(right.created_at) || 0) - (Date.parse(left.created_at) || 0))[0];
    setAssistantConversation(latestThread?.account_id && latestThread.conversation_id && latestThread.conversation_kind ? {
      channel: latestThread.channel || extractNoteChannel(latestThread),
      kind: latestThread.conversation_kind,
      accountId: latestThread.account_id,
      conversationId: latestThread.conversation_id,
      recipientEmail: contactDetail.email,
      subject: "",
    } : null);
    setAiFocus(focus);
    setConversationText(history);
    setAiResult(null);
    setAiError(history ? "" : "There is no saved conversation history for this filter. Paste the latest message below to continue.");
    setAnalysisConsent(false);
  }

  function useRecentConversation(
    transcript: string,
    sender: string,
    title: string,
    metadata?: { channel: string; kind: "email" | "chat"; accountId: string; conversationId: string; recipientEmail: string; subject: string },
  ) {
    const normalizedSender = sender.trim().toLowerCase();
    const senderEmail = sender.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? "";
    const matchedContact = contacts.find((contact) =>
      (contact.email && (contact.email.toLowerCase() === normalizedSender || contact.email.toLowerCase() === senderEmail)) ||
      displayName(contact).toLowerCase() === normalizedSender,
    );
    setConversationText(transcript);
    setAssistantContactId(matchedContact?.id ?? "");
    setAssistantConversation(metadata ? {
      channel: metadata.channel,
      kind: metadata.kind,
      accountId: metadata.accountId,
      conversationId: metadata.conversationId,
      recipientEmail: metadata.recipientEmail || senderEmail,
      subject: metadata.subject || title,
    } : null);
    setAssistantSourceLabel(`${title} · ${sender}`);
    if (metadata?.accountId) setSendReplyAccountId(metadata.accountId);
    if (metadata?.channel) setSendReplyChannel(metadata.channel);
    setAiResult(null);
    setAiError("");
    setAnalysisConsent(false);
  }

  async function saveSuggestedTask(customDueDate?: string) {
    const contact = contactDetail ?? contacts.find((item) => item.id === assistantContactId);
    if (!contact || !aiResult?.next_step) {
      setAiError("Select a CRM contact to attach this suggested follow-up.");
      return;
    }
    setSaving(true);
    setAiError("");
    try {
      const defaultDue = customDueDate || followUpDueDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await crmRequest("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: aiResult.next_step.slice(0, 180),
          description: `Suggested by AI after reviewing a conversation with ${displayName(contact)}. Review before acting.`,
          contact_id: contact.id,
          due_date: defaultDue,
          priority: "medium",
        }),
      });
      await refresh();
      if (contactDetail) await showContact(contact.id);
      setSuggestedTaskSaved(true);
      setTimeout(() => setSuggestedTaskSaved(false), 3500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create follow-up task.");
    } finally {
      setSaving(false);
    }
  }

  async function updateDealStage(deal: Deal, stage: string) {
    try {
      await crmRequest(`/deals/${encodeURIComponent(deal.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ stage }),
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update deal stage.");
    }
  }

  async function toggleTask(task: Task) {
    try {
      await crmRequest(`/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: !task.completed }),
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update task.");
    }
  }

  const viewLabels: Record<View, string> = {
    overview: "Overview",
    contacts: "Contacts",
    companies: "Companies",
    pipeline: "Sales pipeline",
    tasks: "Tasks",
    assistant: "AI assistant",
  };

  function openCreate(type: Modal["type"]) {
    setModal({ type });
  }

  return (
    <main className="crm-app">
      <aside className="crm-sidebar">
        <Link className="crm-brand" href="/" aria-label="Phigrad CRM home"><span className="crm-brand-mark">p</span><span>phigrad<span className="crm-brand-product">CRM</span></span></Link>
        <WorkspaceSwitcher variant="crm" />
        <span className="crm-nav-label">WORKSPACE</span>
        <nav className="crm-nav" aria-label="CRM navigation">
          {(["overview", "contacts", "companies", "pipeline", "tasks", "assistant"] as View[]).map((item) => (
            <button type="button" className={view === item ? "active" : ""} key={item} onClick={() => { setView(item); setSearch(""); }}>
              <span className={`crm-nav-icon crm-nav-${item}`}>{({ overview: "⌂", contacts: "♙", companies: "▦", pipeline: "◫", tasks: "✓", assistant: "✦" })[item]}</span>{viewLabels[item]}
              {item === "tasks" && openTasks.length > 0 && <b>{openTasks.length}</b>}
            </button>
          ))}
          <a href="/inbox"><span className="crm-nav-icon">▤</span>Unified inbox</a>
        </nav>
        <div className="crm-sidebar-bottom">
          <button type="button" className={`crm-ai-status ${view === "assistant" ? "active" : ""}`} onClick={() => setView("assistant")} aria-label="Open AI assistant">
            <span className={aiConfigured ? "ready" : ""}>✦</span><strong>AI assistant</strong><small>{aiConfigured ? "Open conversation tools" : "Open setup & assistant"}</small>
          </button>
          <div className="crm-profile"><span>P</span><div><strong>Workspace owner</strong><small>Local workspace</small></div><b>···</b></div>
        </div>
      </aside>

      <section className="crm-main">
        <header className="crm-topbar">
          <div className="crm-breadcrumb"><span>Workspace</span><i>/</i><strong>{viewLabels[view]}</strong></div>
          <div className="crm-top-actions">
            <span className="crm-local-badge"><i /> Local workspace</span>
            <button type="button" className="crm-avatar" aria-label="Workspace profile">P</button>
          </div>
        </header>
        <div className="crm-content">
          {error && <div className="crm-alert" role="alert"><span>!</span><div><strong>Something needs attention</strong><p>{error}</p></div><button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
          <div className="crm-page-heading">
            <div><span className="crm-eyebrow">CUSTOMER RELATIONSHIP MANAGEMENT</span><h1>{viewLabels[view]}</h1><p>{view === "overview" ? "A clear view of your relationships, opportunities, and next steps." : view === "contacts" ? "Build thoughtful relationships and keep every important detail close." : view === "companies" ? "Keep the organizations behind your relationships organized." : view === "pipeline" ? "Track business opportunities from first conversation to close." : view === "assistant" ? "Turn a message you choose into clear context and a thoughtful next step." : "Make sure every promising conversation has a next step."}</p></div>
            <div className="crm-heading-actions">
              <button type="button" className="crm-secondary-button" onClick={() => void refresh()} disabled={loading}>↻ <span>Refresh</span></button>
              {view !== "overview" && view !== "assistant" && <button type="button" className="crm-primary-button" onClick={() => openCreate(view === "contacts" ? "contact" : view === "companies" ? "company" : view === "pipeline" ? "deal" : "task")}>＋ <span>{view === "contacts" ? "Add contact" : view === "companies" ? "Add company" : view === "pipeline" ? "Add sale" : "Add task"}</span></button>}
              {view === "overview" && <button type="button" className="crm-primary-button" onClick={() => openCreate("contact")}>＋ <span>New contact</span></button>}
            </div>
          </div>

          {loading && !summary ? <div className="crm-loading"><span className="crm-spinner" /> Loading your CRM workspace…</div> : null}
          {!loading && error && !summary ? <div className="crm-empty-state"><strong>CRM data is not available</strong><p>Check that the FastAPI service is running, then try again.</p><button className="crm-secondary-button" onClick={() => void refresh()}>Try again</button></div> : null}

          {summary && view === "overview" && (
            <>
              <section className="crm-stat-grid">
                <article className="crm-stat-card" title="Count of non-archived contacts saved in the local CRM database."><div><span>Contacts</span><i className="stat-violet">♙</i></div><strong>{summary.contacts}</strong><small>Active relationships</small></article>
                <article className="crm-stat-card" title="Count of company records saved in the local CRM database."><div><span>Companies</span><i className="stat-blue">▦</i></div><strong>{summary.companies}</strong><small>Organizations tracked</small></article>
                <article className="crm-stat-card" title="Count of sales not in Won or Lost stages."><div><span>Open sales pipeline</span><i className="stat-green">◫</i></div><strong>{summary.open_deals}</strong><small>{summary.open_deals === 1 ? "active sale" : "active sales"}</small></article>
                <article className="crm-stat-card" title="Open tasks count; the smaller figure counts open tasks with a due date of today or earlier."><div><span>Follow-ups</span><i className="stat-amber">✓</i></div><strong>{summary.open_tasks}</strong><small>{summary.due_tasks_count} due today or overdue</small></article>
              </section>
              <section className="crm-overview-grid">
                <article className="crm-panel crm-pipeline-preview">
                  <div className="crm-panel-heading"><div><span className="crm-eyebrow">SALES</span><h2>Sales pipeline overview</h2></div><button type="button" className="crm-text-button" onClick={() => setView("pipeline")}>Open sales pipeline →</button></div>
                  <div className="crm-stage-summary">{stages.slice(0, 3).map((stage) => {
                    const data = summary.stages.find((item) => item.stage === stage.id);
                    return <div key={stage.id} className="crm-stage-row"><span className={`crm-stage-dot ${stage.color}`} /><strong>{stage.label}</strong><span>{data?.count ?? 0}</span></div>;
                  })}</div>
                  <div className="crm-panel-footer"><span>Sales opportunities by stage</span><button type="button" onClick={() => openCreate("deal")}>＋ Add sale</button></div>
                </article>
                <article className="crm-panel crm-followups-preview">
                  <div className="crm-panel-heading"><div><span className="crm-eyebrow">STAY ON TRACK</span><h2>Upcoming follow-ups</h2></div><button type="button" className="crm-text-button" onClick={() => setView("tasks")}>All tasks →</button></div>
                  {summary.due_tasks.length ? (
                    <div className="crm-task-preview-list">
                      {summary.due_tasks.slice(0, 5).map((task) => (
                        <div className="crm-task-preview" key={task.id}>
                          <button
                            type="button"
                            aria-label={task.completed ? "Reopen task" : "Complete task"}
                            className={`crm-task-check ${task.completed ? "checked" : ""}`}
                            onClick={() => void toggleTask(task)}
                          >
                            {task.completed ? "✓" : ""}
                          </button>
                          <div className="crm-task-preview-copy">
                            <strong>{task.title}</strong>
                            <small>{task.contact_name || task.deal_title || "General follow-up"}</small>
                          </div>
                          <div className="crm-task-preview-actions">
                            <time className={task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && !task.completed ? "overdue" : ""}>
                              {formatDate(task.due_date)}
                            </time>
                            {task.contact_id && (
                              <>
                                <button
                                  type="button"
                                  className="crm-action-pill-btn reply"
                                  onClick={() => handleFollowUpReply(task)}
                                  title="Reply directly to this contact"
                                >
                                  ✉ Reply
                                </button>
                                <button
                                  type="button"
                                  className="crm-action-pill-btn ai"
                                  onClick={() => handleFollowUpAI(task)}
                                  title="Ask AI for draft or insights on this follow-up"
                                >
                                  ✦ AI
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="crm-inline-empty">No follow-ups yet. Add a task to keep momentum.</div>}
                  <div className="crm-panel-footer"><span>Keep each opportunity moving forward</span><button type="button" onClick={() => openCreate("task")}>＋ Add task</button></div>
                </article>
              </section>
              <section className="crm-panel crm-recent-contacts">
                <div className="crm-panel-heading"><div><span className="crm-eyebrow">RELATIONSHIPS</span><h2>Recently added contacts</h2></div><button type="button" className="crm-text-button" onClick={() => setView("contacts")}>View contacts →</button></div>
                {summary.recent_contacts.length ? <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>CONTACT</th><th>COMPANY</th><th>STATUS</th><th>EMAIL</th></tr></thead><tbody>{summary.recent_contacts.map((contact) => <tr key={contact.id} onClick={() => { setView("contacts"); void showContact(contact.id); }}><td><span className="crm-table-person"><i>{initial(contact.first_name)}</i><strong>{displayName(contact)}</strong></span></td><td>{contact.company_name || "—"}</td><td><span className={`crm-status-pill status-${contact.status}`}>{contact.status}</span></td><td>{contact.email || "—"}</td></tr>)}</tbody></table></div> : <div className="crm-inline-empty">Your contact list is ready. Add a person to start building your CRM.</div>}
              </section>
            </>
          )}

          {summary && view === "contacts" && (
            <section className="crm-panel crm-list-panel">
              <div className="crm-list-toolbar"><div><strong>{visibleContacts.length}</strong><span> contacts</span></div><label className="crm-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, company, or email" /></label></div>
              {visibleContacts.length ? <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>CONTACT</th><th>COMPANY</th><th>ROLE</th><th>STATUS</th><th>FOLLOW-UPS</th><th>SOURCE</th><th>EMAIL</th></tr></thead><tbody>{visibleContacts.map((contact) => <tr key={contact.id} onClick={() => void showContact(contact.id)}><td><span className="crm-table-person"><i>{initial(contact.first_name)}</i><strong>{displayName(contact)}</strong></span></td><td>{contact.company_name || "—"}</td><td>{contact.title || "—"}</td><td><span className={`crm-status-pill status-${contact.status}`}>{contact.status}</span></td><td><span className={`crm-status-pill ${(contact.open_tasks_count ?? 0) > 0 ? "status-prospect" : "status-inactive"}`}>{(contact.open_tasks_count ?? 0)} open</span></td><td>{contact.source || "—"}</td><td>{contact.email || "—"}</td></tr>)}</tbody></table></div> : <EmptyState title={contacts.length ? "No contacts match your search" : "Start with a person"} text={contacts.length ? "Try a different name, company, or email." : "Create a contact to start keeping track of business relationships."} action={!contacts.length ? "Add your first contact" : undefined} onAction={() => openCreate("contact")} />}
            </section>
          )}

          {summary && view === "companies" && (
            <section className="crm-company-grid">
              {companies.map((company) => <article className="crm-company-card" key={company.id}><div className="crm-company-top"><span className="crm-company-logo">{initial(company.name)}</span><button type="button" aria-label={`Edit ${company.name}`} onClick={() => setModal({ type: "company", record: company })}>···</button></div><h2>{company.name}</h2><p>{company.industry || company.domain || "Company profile"}</p>              <div className="crm-company-metrics"><span><strong>{company.contact_count}</strong> contacts</span><span><strong>{company.open_deals}</strong> open sales</span></div>{company.website && <a href={company.website.startsWith("http") ? company.website : `https://${company.website}`} target="_blank" rel="noreferrer">{company.website} ↗</a>}</article>)}
              {!companies.length && <div className="crm-panel crm-company-empty"><EmptyState title="Organize your accounts" text="Add companies to connect contacts and opportunities to the organizations they belong to." action="Add a company" onAction={() => openCreate("company")} /></div>}
            </section>
          )}

          {summary && view === "pipeline" && (
            <section className="crm-pipeline-board">
              {stages.map((stage) => {
                const stageDeals = deals.filter((deal) => deal.stage === stage.id);
                return <div className="crm-pipeline-column" key={stage.id}><div className="crm-column-heading"><span className={`crm-stage-dot ${stage.color}`} /><strong>{stage.label}</strong><span>{stageDeals.length}</span></div><div className="crm-deal-stack">{stageDeals.map((deal) => <article className="crm-deal-card" key={deal.id}><button type="button" className="crm-deal-edit" aria-label={`Edit ${deal.title}`} onClick={() => setModal({ type: "deal", record: deal })}>···</button><h3>{deal.title}</h3><p>{deal.company_name || deal.contact_name || "Unassigned opportunity"}</p><div><span>{deal.contact_name || "No contact"}</span><time>{formatDate(deal.expected_close_date)}</time></div><label className="crm-move-deal">Move to<select value={deal.stage} onChange={(event) => void updateDealStage(deal, event.target.value)} aria-label={`Move ${deal.title} to stage`}>{stages.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label></article>)}</div>{!stageDeals.length && <div className="crm-column-empty">No sales</div>}</div>;
              })}
            </section>
          )}

          {summary && view === "tasks" && (
            <section className="crm-panel crm-list-panel">
              <div className="crm-list-toolbar"><div><strong>{openTasks.length}</strong><span> open follow-ups</span></div><span className="crm-task-hint">Tasks stay attached to their contact or sale.</span></div>
              {tasks.length ? (
                <div className="crm-task-list">
                  {tasks.map((task) => (
                    <article className={`crm-task-row ${task.completed ? "completed" : ""}`} key={task.id}>
                      <button type="button" className={`crm-task-check ${task.completed ? "checked" : ""}`} onClick={() => void toggleTask(task)} aria-label={task.completed ? "Reopen task" : "Complete task"}>{task.completed ? "✓" : ""}</button>
                      <div className="crm-task-copy">
                        <strong>{task.title}</strong>
                        <p>{task.description || task.contact_name || task.deal_title || "General follow-up"}</p>
                      </div>
                      <span className={`crm-priority priority-${task.priority}`}>{task.priority}</span>
                      <span className="crm-task-related">{task.contact_name || task.deal_title || "—"}</span>
                      <time className={task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && !task.completed ? "overdue" : ""}>{formatDate(task.due_date)}</time>
                      <div className="crm-task-actions">
                        {task.contact_id && (
                          <>
                            <button type="button" className="crm-action-pill-btn reply" onClick={() => handleFollowUpReply(task)} title="Reply directly to this contact">
                              ✉ Reply
                            </button>
                            <button type="button" className="crm-action-pill-btn ai" onClick={() => handleFollowUpAI(task)} title="Ask AI for draft or insights on this follow-up">
                              ✦ AI Help
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : <EmptyState title="Nothing on your to-do list" text="Create a follow-up task and link it to a contact or deal." action="Create a task" onAction={() => openCreate("task")} />}
            </section>
          )}

          {summary && view === "assistant" && (
            <section className="crm-ai-workspace">
              <article className="crm-ai-intro">
                <span className="crm-ai-intro-icon">✦</span>
                <div><span className="crm-eyebrow">OPENROUTER · HUMAN-REVIEWED</span><h2>Conversation insight, on your terms</h2><p>Paste a business email or message to get a concise summary, tone, next step, and reply draft. Nothing is analyzed until you submit it.</p></div>
                <span className={`crm-ai-tag ${aiConfigured ? "" : "unavailable"}`}>{aiConfigured ? "Connected" : "Key not configured"}</span>
              </article>

              {!aiConfigured && <div className="crm-ai-setup" role="status"><strong>AI assistant is unavailable</strong><p>Ask an administrator to finish the AI setup. Your CRM records stay on this computer.</p></div>}

              <RecentConversations enabled={unipileConfigured} onUseConversation={useRecentConversation} />

              <div className="crm-ai-workspace-grid">
                <article className="crm-panel crm-ai-compose">
                  <div className="crm-panel-heading"><div><span className="crm-eyebrow">ANALYZE A MESSAGE</span><h2>What would you like help with?</h2></div></div>
                  <label className="crm-field"><span>Link to a contact <small>Optional</small></span><select value={assistantContactId} onChange={(event) => { setAssistantContactId(event.target.value); setAiResult(null); setAiError(""); setAnalysisConsent(false); }}><option value="">No contact context</option>{contacts.map((contact) => <option value={contact.id} key={contact.id}>{displayName(contact)}{contact.company_name ? ` · ${contact.company_name}` : ""}</option>)}</select></label>
                  {assistantSourceLabel && <p className="crm-ai-source">Selected from inbox: <strong>{assistantSourceLabel}</strong></p>}
                  <label className="crm-field crm-ai-message-field"><span>Business message or email</span><textarea value={conversationText} onChange={(event) => { setConversationText(event.target.value); setAssistantSourceLabel(""); setAssistantConversation(null); setAiResult(null); setAiError(""); }} placeholder="Paste only the message text you want help with. Or select a recent inbox conversation above." rows={10} maxLength={12000} /></label>
                  <div className="crm-ai-compose-meta"><span>10–12,000 characters · Avoid passwords, payment details, and sensitive personal data.</span><span>{conversationText.length}/12000</span></div>
                  <label className="crm-ai-consent"><input type="checkbox" checked={analysisConsent} onChange={(event) => setAnalysisConsent(event.target.checked)} /><span>I have permission to share this text for this analysis. The selected text and optional contact context will be sent to the AI assistant.</span></label>
                  {aiError && <p className="crm-inline-error" role="alert">{aiError}</p>}
                  <div className="crm-ai-submit-row"><button type="button" className="crm-primary-button" onClick={analyzeFromAssistant} disabled={!aiConfigured || aiLoading || conversationText.trim().length < 10 || !analysisConsent}>{aiLoading ? "Analyzing…" : "✦ Analyze with AI"}</button><span>Results are suggestions. Review them before taking action.</span></div>
                </article>

                <aside className="crm-ai-guidance">
                  <article className="crm-panel"><span className="crm-eyebrow">WHAT YOU’LL GET</span><div className="crm-ai-capability"><span>01</span><div><strong>Understand</strong><p>A short, factual summary and business category.</p></div></div><div className="crm-ai-capability"><span>02</span><div><strong>Read the tone</strong><p>A lightweight sentiment signal to help prioritize context.</p></div></div><div className="crm-ai-capability"><span>03</span><div><strong>Plan a response</strong><p>A suggested next step and a reply draft for your review.</p></div></div></article>
                  <article className="crm-ai-privacy"><strong>You choose what is shared</strong><p>Inbox history is loaded only when you request it. Only the text in the composer, plus optional contact context, is analyzed after you confirm. Nothing is saved to the CRM automatically.</p></article>
                </aside>
              </div>

              {aiResult && <article className="crm-panel crm-ai-workspace-result">
                <div className="crm-panel-heading"><div><span className="crm-eyebrow">AI DRAFT · REVIEW BEFORE USE</span><h2>Conversation analysis</h2></div><div className="crm-ai-result-pills"><span className={`crm-opportunity-pill relevance-${aiResult.business_relevance}`}>{aiResult.business_relevance === "business" ? "Business-related" : aiResult.business_relevance === "not_business" ? "Not business-related" : "Relevance unclear"}</span><span className={`crm-opportunity-pill opportunity-${aiResult.opportunity_status}`}>{aiResult.opportunity_status === "opportunity" ? "Business opportunity" : aiResult.opportunity_status === "not_opportunity" ? "No clear opportunity" : "Opportunity unclear"}</span><span className={`crm-sentiment-pill sentiment-${aiResult.sentiment}`}>{aiResult.sentiment} sentiment</span></div></div>
                  <div className="crm-ai-result-grid">
                  <div><small>CATEGORY</small><strong>{aiResult.category}</strong></div>
                  <div className="crm-ai-opportunity-reason"><small>BUSINESS RELEVANCE</small><p>{aiResult.business_reason || "The conversation did not include enough evidence to classify its business relevance."}</p></div>
                  <div className="crm-ai-opportunity-reason"><small>OPPORTUNITY SIGNAL</small><p>{aiResult.opportunity_reason || "The conversation did not include enough evidence to explain an opportunity classification."}</p></div>
                  <div className="crm-ai-result-summary"><small>SUMMARY</small><p>{aiResult.summary}</p></div>
                  <div>
                    <small>SUGGESTED NEXT STEP</small>
                    <p>{aiResult.next_step}</p>
                    <div className="crm-ai-followup-schedule">
                      <label className="crm-ai-date-picker">
                        <span>Due date:</span>
                        <input
                          type="date"
                          value={followUpDueDate}
                          min={new Date().toISOString().slice(0, 10)}
                          onChange={(e) => setFollowUpDueDate(e.target.value)}
                          aria-label="Follow-up due date"
                        />
                      </label>
                      <button
                        type="button"
                        className="crm-action-pill-btn save-task"
                        onClick={() => void saveSuggestedTask(followUpDueDate)}
                        disabled={saving || !assistantContactId}
                        title={!assistantContactId ? "Select a contact above to attach this task" : "Save as follow-up task"}
                      >
                        {suggestedTaskSaved ? "✓ Saved to follow-ups" : saving ? "Saving…" : "＋ Save as follow-up task"}
                      </button>
                    </div>
                    {!assistantContactId && <small className="crm-ai-hint">Select a contact above to attach this task.</small>}
                  </div>
                  <div><small>REPLY DRAFT</small><p className="crm-reply-draft">{aiResult.suggested_reply}</p><button type="button" className="crm-text-button" onClick={() => void navigator.clipboard.writeText(aiResult.suggested_reply)}>Copy draft</button></div>
                </div>
                <div className="crm-ai-send-row"><button type="button" className="crm-secondary-button" onClick={() => openSendReplyModal(aiResult.suggested_reply)} disabled={!unipileConfigured}>Send with connected account</button>{!unipileConfigured && <span>Connect an account in the inbox before sending.</span>}</div>
              </article>}
            </section>
          )}

          {summary && !loading && (
            <footer className="crm-data-footer"><span><i /> Your CRM records stay with this workspace.</span><span>{unipileConfigured ? "Inbox connected" : "Connect an inbox"}</span></footer>
          )}
        </div>
      </section>

      {sendReplyOpen && (
        <div className="crm-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSendReplyOpen(false); }}>
          <section className="crm-modal crm-send-reply-modal" role="dialog" aria-modal="true" aria-labelledby="send-reply-title">
            <div className="crm-modal-heading">
              <div><span className="crm-eyebrow">SEND VIA CONNECTED ACCOUNT</span><h2 id="send-reply-title">Send message</h2></div>
              <button type="button" onClick={() => setSendReplyOpen(false)} aria-label="Close send dialog">×</button>
            </div>
            <form onSubmit={(event) => void handleSendReply(event)}>
              <div className="crm-form-grid">
                <label className="crm-field">
                  <span>Account <i> *</i></span>
                  <select value={sendReplyAccountId} onChange={(e) => {
                    setSendReplyAccountId(e.target.value);
                    const acc = unipileAccounts.find((a) => a.id === e.target.value);
                    const isEmail = acc ? ["google", "gmail", "outlook", "microsoft", "imap"].includes(acc.provider.toLowerCase()) : false;
                    setSendReplyKind(isEmail ? "email" : "chat");
                    setSendReplyChannel(acc?.provider ?? "");
                    const contact = contactDetail ?? contacts.find((item) => item.id === (sendReplyContactId || assistantContactId));
                    if (isEmail) {
                      setSendReplyRecipient((curr) => curr || contact?.email || "");
                    } else if (assistantConversation?.accountId === e.target.value) {
                      setSendReplyRecipient(assistantConversation.recipientEmail || "");
                    }
                  }} required>
                    <option value="">Select a connected account</option>
                    {unipileAccounts.map((acc) => <option key={acc.id} value={acc.id}>{acc.name} · {acc.provider}</option>)}
                  </select>
                </label>
                <label className="crm-field">
                  <span>Log to contact <small>Optional</small></span>
                  <select value={sendReplyContactId} onChange={(e) => {
                    setSendReplyContactId(e.target.value);
                    const chosen = contacts.find((item) => item.id === e.target.value);
                    if (chosen && sendReplyKind === "email") {
                      setSendReplyRecipient(chosen.email || "");
                    }
                  }}>
                    <option value="">No contact link</option>
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>{displayName(contact)}{contact.email ? ` · ${contact.email}` : ""}</option>
                    ))}
                  </select>
                </label>
                <label className="crm-field">
                  <span>Recipient {sendReplyKind === "email" ? "(email)" : "(chat ID / handle)"} <i> *</i></span>
                  <input type={sendReplyKind === "email" ? "email" : "text"} value={sendReplyRecipient} onChange={(e) => setSendReplyRecipient(e.target.value)} placeholder={sendReplyKind === "email" ? "recipient@example.com" : "Provider chat ID or user handle"} required />
                </label>
                {sendReplyKind === "email" && <label className="crm-field crm-field-wide">
                  <span>Subject</span>
                  <input type="text" value={sendReplySubject} onChange={(e) => setSendReplySubject(e.target.value)} placeholder="Email subject line" />
                </label>}
                <label className="crm-field crm-field-wide">
                  <span>Message <i> *</i></span>
                  <textarea rows={6} value={sendReplyText} onChange={(e) => setSendReplyText(e.target.value)} placeholder="Type or edit your message before sending…" required />
                </label>
              </div>
              {sendReplyError && <p className="crm-inline-error" role="alert">{sendReplyError}</p>}
              {sendReplySuccess && <p className="crm-inline-success" role="status">{sendReplySuccess}</p>}
              <div className="crm-modal-actions">
                <button type="button" className="crm-secondary-button" onClick={() => setSendReplyOpen(false)}>Cancel</button>
                <button type="submit" className="crm-primary-button" disabled={sendReplyLoading || !sendReplyAccountId || !sendReplyRecipient || !sendReplyText.trim()}>{sendReplyLoading ? "Sending…" : "Send message"}</button>
              </div>
              <p className="crm-form-note">The message will be sent from the connected account and logged as a note on the CRM contact.</p>
            </form>
          </section>
        </div>
      )}

      {(modal || contactDetail || contactLoading) && (
        <div className="crm-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setModal(null); setContactDetail(null); } }}>
          {modal && <section className="crm-modal" role="dialog" aria-modal="true" aria-labelledby="crm-modal-title">
            <div className="crm-modal-heading"><div><span className="crm-eyebrow">{modal.record ? "UPDATE RECORD" : "NEW RECORD"}</span><h2 id="crm-modal-title">{modal.record ? "Edit" : "Add"} {modal.type === "deal" ? "sale" : modal.type}</h2></div><button type="button" onClick={() => setModal(null)} aria-label="Close dialog">×</button></div>
            <form onSubmit={submitRecord}>
              {modal.type === "contact" && <><div className="crm-form-grid"><Field label="First name" name="first_name" required defaultValue={(modal.record as Contact | undefined)?.first_name} /><Field label="Last name" name="last_name" defaultValue={(modal.record as Contact | undefined)?.last_name} /><Field label="Email" name="email" type="email" defaultValue={(modal.record as Contact | undefined)?.email} /><Field label="Phone" name="phone" defaultValue={(modal.record as Contact | undefined)?.phone} /><Field label="Job title" name="title" defaultValue={(modal.record as Contact | undefined)?.title} /><label className="crm-field"><span>Company</span><select name="company_id" defaultValue={(modal.record as Contact | undefined)?.company_id ?? ""}><option value="">No company</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label><Field label="Source channel" name="source" placeholder="LinkedIn, Gmail, referral…" defaultValue={(modal.record as Contact | undefined)?.source} /><label className="crm-field"><span>Status</span><select name="status" defaultValue={(modal.record as Contact | undefined)?.status ?? "lead"}>{["lead", "prospect", "customer", "partner", "inactive"].map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label></div><p className="crm-form-note">Email is used to help you recognize duplicate records. Records are stored in your local CRM database.</p></>}
              {modal.type === "company" && <div className="crm-form-grid"><Field label="Company name" name="name" required defaultValue={(modal.record as Company | undefined)?.name} /><Field label="Website" name="website" placeholder="example.com" defaultValue={(modal.record as Company | undefined)?.website} /><Field label="Domain" name="domain" placeholder="example.com" defaultValue={(modal.record as Company | undefined)?.domain} /><Field label="Industry" name="industry" defaultValue={(modal.record as Company | undefined)?.industry} /><Field label="Company size" name="size" placeholder="e.g. 50–200" defaultValue={(modal.record as Company | undefined)?.size} /><label className="crm-field crm-field-wide"><span>Notes</span><textarea name="notes" rows={3} defaultValue={(modal.record as Company | undefined)?.notes} /></label></div>}
              {modal.type === "deal" && <div className="crm-form-grid"><Field label="Sale name" name="title" required defaultValue={(modal.record as Deal | undefined)?.title} /><label className="crm-field"><span>Contact</span><select name="contact_id" defaultValue={(modal.record as Deal | undefined)?.contact_id ?? ""}><option value="">Unassigned</option>{contacts.map((contact) => <option value={contact.id} key={contact.id}>{displayName(contact)}</option>)}</select></label><label className="crm-field"><span>Company</span><select name="company_id" defaultValue={(modal.record as Deal | undefined)?.company_id ?? ""}><option value="">Unassigned</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label><label className="crm-field"><span>Stage</span><select name="stage" defaultValue={(modal.record as Deal | undefined)?.stage ?? "new"}>{stages.map((stage) => <option value={stage.id} key={stage.id}>{stage.label}</option>)}</select></label><Field label="Expected close" name="expected_close_date" type="date" defaultValue={(modal.record as Deal | undefined)?.expected_close_date ?? ""} /><label className="crm-field crm-field-wide"><span>Description</span><textarea name="description" rows={3} defaultValue={(modal.record as Deal | undefined)?.description} /></label></div>}
              {modal.type === "task" && <div className="crm-form-grid"><Field label="Task" name="title" required placeholder="e.g. Follow up about the proposal" /><Field label="Due date" name="due_date" type="date" /><label className="crm-field"><span>Priority</span><select name="priority" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label className="crm-field"><span>Contact</span><select name="contact_id" defaultValue={contactDetail?.id ?? ""}><option value="">No contact</option>{contacts.map((contact) => <option value={contact.id} key={contact.id}>{displayName(contact)}</option>)}</select></label><label className="crm-field"><span>Sale</span><select name="deal_id" defaultValue=""><option value="">No sale</option>{deals.map((deal) => <option value={deal.id} key={deal.id}>{deal.title}</option>)}</select></label><label className="crm-field crm-field-wide"><span>Details</span><textarea name="description" rows={3} /></label></div>}
              <div className="crm-modal-actions"><button type="button" className="crm-secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="crm-primary-button" disabled={saving}>{saving ? "Saving…" : modal.record ? "Save changes" : `Create ${modal.type === "deal" ? "sale" : modal.type}`}</button></div>
            </form>
          </section>}

          {!modal && (contactLoading ? <section className="crm-contact-drawer"><button type="button" className="crm-drawer-close" onClick={() => setContactDetail(null)}>×</button><div className="crm-loading"><span className="crm-spinner" /> Loading contact…</div></section> : contactDetail && <section className="crm-contact-drawer" role="dialog" aria-modal="true" aria-labelledby="contact-detail-title">
            <header className="crm-drawer-header"><button type="button" className="crm-drawer-close" onClick={() => setContactDetail(null)} aria-label="Close contact details">×</button><span className="crm-drawer-avatar">{initial(contactDetail.first_name)}</span><div><span className="crm-eyebrow">CONTACT PROFILE</span><h2 id="contact-detail-title">{displayName(contactDetail)}</h2><p>{contactDetail.title || "Business contact"}{contactDetail.company_name ? ` · ${contactDetail.company_name}` : ""}</p></div><button type="button" className="crm-secondary-button" onClick={() => setModal({ type: "contact", record: contactDetail })}>Edit</button></header>
            <div className="crm-drawer-content">
              <div className="crm-detail-facts">
                <span><small>EMAIL</small><strong>{contactDetail.email || "—"}</strong></span>
                <span><small>PHONE</small><strong>{contactDetail.phone || "—"}</strong></span>
                <span><small>STATUS</small><strong className={`crm-status-pill status-${contactDetail.status}`}>{contactDetail.status}</strong></span>
                <span><small>FOLLOW-UPS</small><strong className="crm-status-pill status-prospect">{contactDetail.tasks.filter((t) => !t.completed).length} open</strong></span>
                <span><small>SOURCE</small><strong>{contactDetail.source || "—"}</strong></span>
              </div>
              <section className="crm-drawer-section crm-contact-history">
                <div className="crm-drawer-section-heading">
                  <h3>Previous conversations</h3>
                  <div className="crm-history-filters">
                    <select
                      value={historyChannelFilter}
                      onChange={(e) => setHistoryChannelFilter(e.target.value)}
                      aria-label="Filter conversations by channel"
                    >
                      <option>All channels</option>
                      {[...new Set(contactDetail.notes.map(extractNoteChannel))].sort().map((channel) => <option key={channel}>{channel}</option>)}
                    </select>
                    <select
                      value={historyInfoFilter}
                      onChange={(e) => setHistoryInfoFilter(e.target.value as "all" | "unverified")}
                      aria-label="Filter verified or unverified CRM information"
                    >
                      <option value="all">All context</option>
                      <option value="unverified">Unverified info</option>
                    </select>
                    <span>{contactDetail.notes.length} saved</span>
                  </div>
                </div>
                {contactDetail.notes.length ? (
                  <div className="crm-contact-history-list">
                    {[...contactDetail.notes]
                      .sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0))
                      .filter((note) => {
                        const channel = extractNoteChannel(note);
                        const channelMatches = historyChannelFilter === "All channels" || channel.toLowerCase().includes(historyChannelFilter.toLowerCase());
                        if (!channelMatches) return false;
                        if (historyInfoFilter === "unverified") {
                          const structured = structuredLeadNote(note.body);
                          return (note.unverified_fields ?? structured?.unverified_fields ?? []).length > 0;
                        }
                        return true;
                      })
                      .map((note) => {
                        const lead = structuredLeadNote(note.body);
                        const channel = extractNoteChannel(note);
                        const unverifiedFields = note.unverified_fields ?? lead?.unverified_fields ?? [];
                        return <article key={note.id}>
                          <div><strong>{lead ? `Conversation · ${channel}` : `Note · ${channel}`}{unverifiedFields.length > 0 ? " · Unverified details" : ""}</strong><time>{new Date(note.created_at).toLocaleString()}</time></div>
                          <p>{lead?.conversation ?? note.body}</p>
                          {historyInfoFilter === "unverified" && lead && <dl className="crm-unverified-info">{unverifiedFields.map((field) => {
                            const value = lead.lead_details[field];
                            return value === null || value === undefined || value === "" ? null : <div key={field}><dt>{field.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>;
                          })}</dl>}
                        </article>;
                      })}
                  </div>
                ) : <p className="crm-muted-copy">No previous conversations are saved for this contact yet.</p>}
              </section>
              <section className="crm-drawer-section crm-contact-ai-prompts">
                <div className="crm-drawer-section-heading"><h3>Quick AI help</h3><span>Uses saved history</span></div>
                <div className="crm-ai-quick-actions" aria-label="Quick AI actions">
                  {assistantQuickActions.map((action) => (
                    <button type="button" key={action.focus} className={aiFocus === action.focus ? "active" : ""} aria-pressed={aiFocus === action.focus} onClick={() => prepareContactAssistant(action.focus)} disabled={!aiConfigured}>
                      {action.label}
                    </button>
                  ))}
                </div>
                <p className="crm-privacy-note">Select an action to load previous conversations into the assistant. Review the text and confirm permission before sending it for analysis.</p>
              </section>
              <section className="crm-drawer-section"><div className="crm-drawer-section-heading"><h3>AI conversation assistant</h3><span className={aiConfigured ? "crm-ai-tag" : "crm-ai-tag unavailable"}>{aiConfigured ? "AI Ready" : "Unavailable"}</span></div><p className="crm-privacy-note">Paste the business message or email text you want help with. Only this text and the contact context are analyzed after you confirm below.</p><textarea value={conversationText} onChange={(event) => { setConversationText(event.target.value); setAssistantConversation(null); setAiResult(null); setAiError(""); }} placeholder="Paste a message or email thread here to get a summary, business category, next step, and reply draft…" rows={5} maxLength={12000} disabled={!aiConfigured} /><label className="crm-ai-consent"><input type="checkbox" checked={analysisConsent} onChange={(event) => setAnalysisConsent(event.target.checked)} /><span>I have permission to share this text for analysis.</span></label><div className="crm-ai-actions"><button type="button" className="crm-primary-button" onClick={analyzeConversation} disabled={!aiConfigured || aiLoading || conversationText.trim().length < 10 || !analysisConsent}>{aiLoading ? "Analyzing…" : "✦ Analyze conversation"}</button><span>{conversationText.length}/12000</span></div>{aiError && <p className="crm-inline-error" role="alert">{aiError}</p>}{aiResult && <><div className="crm-ai-result"><div className="crm-ai-result-top"><span><small>CATEGORY</small><strong>{aiResult.category}</strong></span><span><small>SENTIMENT</small><strong className={`sentiment-${aiResult.sentiment}`}>{aiResult.sentiment}</strong></span></div><div><small>SUMMARY</small><p>{aiResult.summary}</p></div><div><small>SUGGESTED NEXT STEP</small><p>{aiResult.next_step}</p><div className="crm-ai-followup-schedule"><label className="crm-ai-date-picker"><span>Due date:</span><input type="date" value={followUpDueDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFollowUpDueDate(e.target.value)} aria-label="Follow-up due date" /></label><button type="button" className="crm-action-pill-btn save-task" onClick={() => void saveSuggestedTask(followUpDueDate)} disabled={saving} title="Save as follow-up task">{suggestedTaskSaved ? "✓ Saved to follow-ups" : saving ? "Saving…" : "＋ Save as follow-up task"}</button></div></div><div><small>REPLY DRAFT · REVIEW BEFORE SENDING</small><p className="crm-reply-draft">{aiResult.suggested_reply}</p><button type="button" className="crm-text-button" onClick={() => void navigator.clipboard.writeText(aiResult.suggested_reply)}>Copy draft</button></div></div><div className="crm-ai-send-row"><button type="button" className="crm-secondary-button" onClick={() => openSendReplyModal(aiResult.suggested_reply)} disabled={!unipileConfigured}>Send with connected account</button>{!unipileConfigured && <span>Connect a Unipile account to send from the assistant.</span>}</div></>}</section>
              <section className="crm-drawer-section"><div className="crm-drawer-section-heading"><h3>Notes & activity</h3><span>{contactDetail.notes.length}</span></div><form className="crm-note-form" onSubmit={addNote}><textarea rows={2} value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Add a private note about this relationship…" /><button type="submit" className="crm-secondary-button" disabled={saving || !noteText.trim()}>Add note</button></form>{contactDetail.notes.length ? <div className="crm-note-list">{contactDetail.notes.map((note) => {
                const lead = structuredLeadNote(note.body);
                return <article key={note.id}>{lead ? <>
                  <div className="crm-lead-note-heading"><strong>Lead details</strong>{lead.classification && <span>{lead.classification.is_lead ? "Qualified lead" : "Not a lead"}</span>}</div>
                  {lead.classification && <p>{lead.classification.reason}</p>}
                  <dl className="crm-lead-note-fields">{Object.entries(lead.lead_details).filter(([, value]) => value !== null && value !== "").map(([field, value]) => <div key={field}><dt>{leadFieldLabel(field)}</dt><dd>{String(value)}</dd></div>)}</dl>
                  <details className="crm-lead-note-conversation"><summary>Conversation</summary><p>{lead.conversation}</p></details>
                </> : <p>{note.body}</p>}<time>{new Date(note.created_at).toLocaleString()}</time></article>;
              })}</div> : <p className="crm-muted-copy">No notes yet.</p>}</section>
              <section className="crm-drawer-section">
                <div className="crm-drawer-section-heading">
                  <h3>Follow-ups & tasks ({contactDetail.tasks.filter((t) => !t.completed).length} open)</h3>
                  <button type="button" className="crm-text-button" onClick={() => openCreate("task")}>＋ Add task</button>
                </div>
                {contactDetail.deals.length > 0 && contactDetail.deals.map((deal) => <div className="crm-related-row" key={deal.id}><span>◫</span><strong>{deal.title}</strong><small>{deal.stage}</small></div>)}
                {contactDetail.tasks.map((task) => (
                  <div className="crm-related-row crm-drawer-task-row" key={task.id}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", minWidth: 0, flex: 1 }}>
                      <button type="button" className={`crm-task-check ${task.completed ? "checked" : ""}`} onClick={() => void toggleTask(task)} aria-label={task.completed ? "Reopen task" : "Complete task"}>
                        {task.completed ? "✓" : ""}
                      </button>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</strong>
                        <small style={{ display: "block", color: "#878d9a" }}>{task.completed ? "Completed" : formatDate(task.due_date)}</small>
                      </div>
                    </div>
                    {!task.completed && (
                      <div style={{ display: "flex", gap: "5px", flexShrink: 0, alignItems: "center" }}>
                        <button type="button" className="crm-action-pill-btn reply" onClick={() => handleFollowUpReply(task)} title="Reply directly to this contact">
                          ✉ Reply
                        </button>
                        <button type="button" className="crm-action-pill-btn ai" onClick={() => handleFollowUpAI(task)} title="Ask AI for draft or insights on this follow-up">
                          ✦ AI
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {contactDetail.deals.length === 0 && contactDetail.tasks.length === 0 && <p className="crm-muted-copy">No sales or tasks linked to this contact.</p>}
              </section>
            </div>
          </section>)}
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  placeholder,
  min,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  min?: string;
  step?: string;
}) {
  return <label className="crm-field"><span>{label}{required && <i> *</i>}</span><input name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} min={min} step={step} /></label>;
}

function EmptyState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="crm-empty-state"><span>✦</span><strong>{title}</strong><p>{text}</p>{action && <button type="button" className="crm-primary-button" onClick={onAction}>＋ {action}</button>}</div>;
}
