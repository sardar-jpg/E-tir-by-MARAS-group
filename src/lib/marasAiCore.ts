/**
 * marasAiCore.ts — pure, unit-tested core for MARAS AI (PR #128).
 *
 * MARAS AI is the internal AI assistant for eTIR by MARAS, available ONLY
 * inside the Admin Panel (the existing ✨ drawer, super/operation admins).
 * This module owns everything decidable without I/O — the system prompt,
 * the enable/disable rule, request validation, and the WHITELIST-based
 * context builders — so the server route stays thin orchestration and the
 * privacy rules ("send only what the request needs, never secrets") are
 * enforced by construction and pinned by tests, not by reviewer vigilance.
 *
 * The OpenAI credential never leaves the server: this module builds plain
 * strings/arrays; the only place an OpenAI client exists is server.ts.
 */
import type { ChatMessage, Shipment, ShipmentDocument } from "../types";
import type { MarasAiResponseSource } from "./marasAiIntents";

// ── Enablement ───────────────────────────────────────────────────────

export type MarasAiAvailability =
  | { enabled: true }
  | { enabled: false; reason: "disabled" | "missing_api_key" };

/**
 * MARAS AI runs only when BOTH switches are set: MARAS_AI_ENABLED=true
 * and a non-empty OPENAI_API_KEY. Anything else is a clean, explicit
 * "unavailable" — never a fake response, never a crash.
 */
export function resolveMarasAiAvailability(env: {
  MARAS_AI_ENABLED?: string;
  OPENAI_API_KEY?: string;
}): MarasAiAvailability {
  if ((env.MARAS_AI_ENABLED || "").toLowerCase() !== "true") return { enabled: false, reason: "disabled" };
  if (!(env.OPENAI_API_KEY || "").trim()) return { enabled: false, reason: "missing_api_key" };
  return { enabled: true };
}

export const DEFAULT_OPENAI_MODEL = "gpt-5.2";
export const MARAS_AI_TIMEOUT_MS = 45_000;
export const MARAS_AI_MAX_OUTPUT_TOKENS = 1_600;

// ── System prompt ────────────────────────────────────────────────────

export const MARAS_AI_SYSTEM_PROMPT = `You are MARAS AI, the internal AI assistant for eTIR by MARAS, an international logistics and truck-management platform. You serve MARAS Admin employees only — never drivers, never customers, never the public.

Your job is to help MARAS staff run logistics operations: shipment summaries, delayed-shipment analysis, missing-document checks, operational risk reviews, internal and driver chat summaries, customer communication drafts, driver instruction drafts, accounting summaries, cost completeness checks, payment status summaries, dashboard and notification summaries, and practical next-step suggestions.

Rules you must always follow:
- Be concise and practical. Lead with what matters operationally.
- Never invent shipment facts. Work only from the CONTEXT DATA provided in this conversation and from what the employee tells you.
- When data you need is unavailable, say so plainly ("I don't have the documents list for this shipment") instead of guessing.
- Clearly distinguish FACTS (from context data) from SUGGESTIONS (your recommendations).
- Protect internal and financial information: it is for MARAS staff; never suggest sharing internal notes, costs, margins, or supplier details with drivers or customers.
- You cannot perform actions. You only read, analyze, and draft. Never claim a message was sent, a status was changed, or a record was updated — the employee must do that themselves in the Admin Panel, and nothing is done unless the backend confirms it.
- Drafts (customer messages, driver instructions) are DRAFTS for staff review — say so.
- Reply in the language the employee writes in (English, Turkish, or Arabic) when practical.
- The one business reference for a shipment is its MAR-YYYY-#### number.`;

// ── Request validation ───────────────────────────────────────────────

export const MARAS_AI_MAX_MESSAGE_CHARS = 4_000;
export const MARAS_AI_MAX_HISTORY_TURNS = 16;
const MAX_HISTORY_ENTRY_CHARS = 6_000;

export interface MarasAiHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export type MarasAiChatBodyResult =
  | { ok: true; message: string; history: MarasAiHistoryTurn[]; shipmentId: string | null; page: string | null; conversationId: string | null }
  | { ok: false; error: string };

export function validateMarasAiChatBody(body: unknown): MarasAiChatBodyResult {
  const b = (body || {}) as Record<string, unknown>;
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message) return { ok: false, error: "A message is required." };
  if (message.length > MARAS_AI_MAX_MESSAGE_CHARS) {
    return { ok: false, error: `Message is too long (max ${MARAS_AI_MAX_MESSAGE_CHARS} characters).` };
  }
  const rawHistory = Array.isArray(b.history) ? b.history : [];
  const history: MarasAiHistoryTurn[] = [];
  for (const raw of rawHistory.slice(-MARAS_AI_MAX_HISTORY_TURNS)) {
    const entry = raw as Record<string, unknown>;
    if ((entry.role === "user" || entry.role === "assistant") && typeof entry.text === "string" && entry.text.trim()) {
      history.push({ role: entry.role, text: entry.text.slice(0, MAX_HISTORY_ENTRY_CHARS) });
    }
  }
  const context = (b.context || {}) as Record<string, unknown>;
  const shipmentId = typeof context.shipmentId === "string" && context.shipmentId.trim() ? context.shipmentId.trim() : null;
  const page = typeof context.page === "string" && context.page.trim() ? context.page.trim().slice(0, 60) : null;
  const conversationId =
    typeof b.conversationId === "string" && b.conversationId.trim() ? b.conversationId.trim().slice(0, 80) : null;
  return { ok: true, message, history, shipmentId, page, conversationId };
}

// ── Conversation history (persisted per admin) ──────────────────────
//
// Each Admin owns their conversations exclusively: every route in
// server.ts checks canAccessConversation() before returning or deleting
// one, and the list endpoint filters to the caller's own adminId. A
// Super Admin follows exactly the same rule — no cross-admin reading.

export interface MarasAiStoredMessage {
  role: "user" | "assistant";
  text: string;
  at: string;
  /** Assistant turns only — how the reply was produced (honest, server-derived). */
  source?: MarasAiResponseSource;
}

export interface MarasAiConversation {
  id: string;
  /** Owning admin's session id — the ONLY identity conversations are ever served to. */
  adminId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: MarasAiStoredMessage[];
}

export const MARAS_AI_MAX_STORED_MESSAGES = 60;
const MAX_TITLE_CHARS = 60;

/** Auto-title from the opening message: first line, whitespace collapsed, capped. */
export function deriveConversationTitle(firstMessage: string): string {
  const clean = firstMessage.split("\n")[0].replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  return clean.length > MAX_TITLE_CHARS ? `${clean.slice(0, MAX_TITLE_CHARS - 1)}…` : clean;
}

/** Appends new turns, keeping only the newest MARAS_AI_MAX_STORED_MESSAGES. */
export function appendConversationMessages(
  existing: MarasAiStoredMessage[],
  added: MarasAiStoredMessage[]
): MarasAiStoredMessage[] {
  return [...existing, ...added].slice(-MARAS_AI_MAX_STORED_MESSAGES);
}

/** Ownership rule — the single place "whose conversation is this" is decided. */
export function canAccessConversation(conversation: { adminId?: string }, adminId: string): boolean {
  return !!adminId && conversation.adminId === adminId;
}

/** The stored thread reduced to model-input history (newest turns, capped like client history). */
export function conversationHistoryForModel(conversation: MarasAiConversation): MarasAiHistoryTurn[] {
  return conversation.messages
    .slice(-MARAS_AI_MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 6_000) }));
}

/** Compact listing entry — never includes message bodies. */
export function toConversationSummary(conversation: MarasAiConversation): {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
} {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
  };
}

// ── Context builders (WHITELIST only — never secrets) ────────────────
//
// Everything sent to the model is assembled here from explicitly named
// fields. shareToken, session tokens, password hashes, storage
// credentials, and push tokens are simply never read, so they can never
// leak into a prompt. The unit tests feed records CONTAINING those fields
// and assert the output does not.

function line(label: string, value: string | number | undefined | null): string | null {
  if (value === undefined || value === null || value === "") return null;
  return `${label}: ${value}`;
}

export function buildShipmentAiContext(
  shipment: Shipment,
  documents: ShipmentDocument[] | undefined,
  recentInternalChat: ChatMessage[] | undefined
): string {
  const docs = documents || shipment.documents || [];
  const docLines = docs.slice(0, 25).map((d) => `  - ${d.category || "other"}: ${d.name || "unnamed"}`);
  const chatLines = (recentInternalChat || [])
    .slice(-15)
    .map((m) => `  - [${m.timestamp}] ${m.senderName} (${m.sender}${m.channel ? `, ${m.channel}` : ""}): ${(m.text || m.fileName || "").slice(0, 300)}`);
  const timeline = (shipment.timeline || []).slice(-5).map((t) => `  - [${(t as { timestamp?: string }).timestamp || ""}] ${(t as { status?: string; note?: string }).status || (t as { note?: string }).note || ""}`);

  const parts = [
    "CONTEXT DATA — shipment record (internal, for MARAS staff only):",
    line("Shipment", shipment.shipmentNumber),
    line("Status", shipment.status),
    line("Route", `${shipment.loadingCity || "?"} (${shipment.loadingCountry || "?"}) -> ${shipment.deliveryCity || "?"} (${shipment.deliveryCountry || "?"})`),
    line("Customer company", shipment.companyName),
    line("Assigned driver", shipment.assignedDriverName),
    line("Truck", shipment.truckNumber),
    line("Cargo", shipment.cargoDescription),
    line("Cargo weight (kg)", shipment.cargoWeight),
    line("Agreed amount", `${shipment.agreedAmount} ${shipment.currency}`),
    line("Created", shipment.createdAt),
    line("Last updated", shipment.updatedAt),
    line("Last chat activity", shipment.lastChatActivityAt),
    line("Internal notes", (shipment.internalNotes || "").slice(0, 500) || undefined),
    docLines.length ? `Documents on file (${docs.length}):\n${docLines.join("\n")}` : "Documents on file: none",
    timeline.length ? `Recent timeline:\n${timeline.join("\n")}` : null,
    chatLines.length ? `Recent internal chat:\n${chatLines.join("\n")}` : null,
  ];
  return parts.filter(Boolean).join("\n");
}

export interface MonitoringAlertForAi {
  title: string;
  severity: string;
  area: string;
  count: number;
  time: string;
  explanation: string;
  suggestedAction: string;
}

/** Super-Admin-only: a compact digest of current technical alerts for monitoring questions. */
export function buildMonitoringAiContext(alerts: MonitoringAlertForAi[]): string {
  if (alerts.length === 0) {
    return "CONTEXT DATA — application monitoring (Super Admin only): no technical alerts are currently recorded.";
  }
  const lines = alerts
    .slice(0, 30)
    .map((a) => `  - [${a.severity.toUpperCase()}] ${a.title} (${a.area}, x${a.count}, last ${a.time}): ${a.explanation} Suggested: ${a.suggestedAction}`);
  return `CONTEXT DATA — application monitoring (Super Admin only, ${alerts.length} alert group(s)):\n${lines.join("\n")}`;
}

// ── Model input assembly ─────────────────────────────────────────────

export interface MarasAiModelTurn {
  role: "user" | "assistant";
  content: string;
}

/** Conversation turns for the Responses API `input` array (system prompt + context travel via `instructions`). */
export function buildMarasAiInput(history: MarasAiHistoryTurn[], message: string): MarasAiModelTurn[] {
  return [
    ...history.map((h) => ({ role: h.role, content: h.text })),
    { role: "user" as const, content: message },
  ];
}
