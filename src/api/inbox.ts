/** Resend-backed admin mailbox API. */
import { z } from 'zod';

import {
    API_BASE_URL,
    apiFetch,
    getAuthToken,
    getAuthorizationValue,
} from './client';
import { InboxMessageSchema, type InboxMessage } from './types';

export type InboxFolder = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'spam';

/** Ordner, in die man verschieben darf. 'sent' und 'drafts' entstehen von selbst. */
export type MovableFolder = 'inbox' | 'archive' | 'trash';

export interface InboxQuery {
    mailbox?: string;
    folder?: InboxFolder;
    limit?: number;
    cursor?: string;
    unreadOnly?: boolean;
    search?: string;
    assignmentStatus?: 'open' | 'in_progress' | 'done';
    assignedToMe?: boolean;
}

const InboxPageSchema = z.object({
    emails: z.array(InboxMessageSchema).default([]),
    cursor: z.string().nullish(),
    hasMore: z.boolean().default(false),
});

export interface InboxPage {
    messages: InboxMessage[];
    cursor: string | null;
    hasMore: boolean;
}

export interface MailboxSummary {
    id: string;
    name: string;
    address: string | null;
    /** 'personal' gehört einer Person, 'quarantine' sammelt Unzuordenbares. */
    kind: 'shared' | 'personal' | 'quarantine';
    unread: number;
    total: number;
    canSend: boolean;
    /** Befristeter Notfallzugriff — in der Oberfläche sichtbar zu machen. */
    isBreakGlass: boolean;
    expiresAt: string | null;
}

const MailboxesSchema = z.object({
    transport: z.literal('resend'),
    mailboxes: z.array(z.object({
        id: z.string(),
        name: z.string(),
        address: z.string().nullable(),
        kind: z.enum(['shared', 'personal', 'quarantine']).default('shared'),
        unread: z.coerce.number().default(0),
        total: z.coerce.number().default(0),
        canSend: z.boolean().default(false),
        isBreakGlass: z.boolean().default(false),
        expiresAt: z.string().nullable().default(null),
    })),
    sendingAddresses: z.array(z.string()).default([]),
});

export async function listInboxMessages(query: InboxQuery = {}): Promise<InboxPage> {
    const params = new URLSearchParams();
    params.set('mailbox', query.mailbox || 'all');
    params.set('folder', query.folder || 'inbox');
    if (query.limit) params.set('limit', String(query.limit));
    if (query.cursor) params.set('offset', query.cursor);
    if (query.unreadOnly) params.set('unread', '1');
    if (query.search) params.set('search', query.search);
    if (query.assignmentStatus) params.set('assignmentStatus', query.assignmentStatus);
    if (query.assignedToMe) params.set('assignedToMe', '1');

    const raw = await apiFetch<unknown>(`/api/inbox/emails?${params.toString()}`);
    const parsed = InboxPageSchema.parse(raw);
    return {
        messages: parsed.emails,
        cursor: parsed.cursor ?? null,
        hasMore: parsed.hasMore,
    };
}

export async function getInboxMessage(id: string): Promise<InboxMessage> {
    const raw = await apiFetch<unknown>(`/api/inbox/email/${encodeURIComponent(id)}`);
    return InboxMessageSchema.parse(raw);
}

export async function markInboxRead(id: string, isRead = true): Promise<{ success: boolean }> {
    return apiFetch(`/api/inbox/email/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
        body: JSON.stringify({ read: isRead }),
    });
}

export async function getInboxThread(id: string): Promise<{ messages: InboxMessage[]; hasMore: boolean }> {
    const raw = await apiFetch<unknown>(`/api/inbox/email/${encodeURIComponent(id)}/thread`);
    const parsed = InboxPageSchema.parse(raw);
    return { messages: parsed.emails, hasMore: parsed.hasMore };
}

export async function updateInboxAssignment(id: string, input: { assignedTo?: string; status?: 'open' | 'in_progress' | 'done'; notes?: string; expectedNotes?: string | null }): Promise<{ success: boolean }> {
    return z.object({ success: z.literal(true) }).parse(await apiFetch(`/api/inbox/email/${encodeURIComponent(id)}/assign`, {
        method: 'POST', body: JSON.stringify({ messageId: id, ...input }),
    }));
}

export async function listMailboxes(): Promise<{
    transport: 'resend';
    mailboxes: MailboxSummary[];
    sendingAddresses: string[];
}> {
    return MailboxesSchema.parse(await apiFetch<unknown>('/api/inbox/mailboxes'));
}

export interface ContactSuggestion {
    address: string;
    displayName: string | null;
    lastSeen: string;
}

const ContactsSchema = z.object({
    contacts: z.array(z.object({
        address: z.string(),
        displayName: z.string().nullish(),
        lastSeen: z.string(),
    })).default([]),
});

/**
 * Adressvorschläge beim Verfassen. Stammen ausschließlich aus Nachrichten, die
 * der Aufrufer selbst sehen darf — die Vervollständigung verrät also nicht,
 * mit wem ein Kollege korrespondiert.
 */
export async function suggestContacts(prefix: string): Promise<ContactSuggestion[]> {
    if (prefix.trim().length < 2) return [];
    const raw = await apiFetch<unknown>(`/api/inbox/contacts?q=${encodeURIComponent(prefix)}`);
    return ContactsSchema.parse(raw).contacts.map((entry) => ({
        address: entry.address,
        displayName: entry.displayName ?? null,
        lastSeen: entry.lastSeen,
    }));
}

/**
 * Als Spam markieren. Mit blockSender wird der Absender zusätzlich für die
 * Postfächer gesperrt, in denen die Nachricht liegt.
 */
export async function markAsSpam(
    id: string,
    blockSender: boolean,
): Promise<{ success: boolean; blocked: boolean }> {
    return apiFetch(`/api/inbox/email/${encodeURIComponent(id)}/spam`, {
        method: 'POST',
        body: JSON.stringify({ blockSender }),
    });
}

/** Kein Spam: zurück in den Ursprungsordner, Sperre wird mit aufgehoben. */
export async function markAsNotSpam(id: string): Promise<{ success: boolean }> {
    return apiFetch(`/api/inbox/email/${encodeURIComponent(id)}/not-spam`, { method: 'POST' });
}

// ── Regeln und Abwesenheitsnotiz ───────────────────────────────────────────

export interface MailRule {
    id: string;
    mailboxAddress: string;
    position: number;
    isActive: boolean;
    name: string;
    field: 'from' | 'subject' | 'body';
    operator: 'contains' | 'equals' | 'domain';
    value: string;
    action: 'move_archive' | 'move_trash' | 'move_spam' | 'mark_read';
}

export interface AutoReplyEntry {
    mailboxAddress: string;
    isActive: boolean;
    subject: string;
    body: string;
    startsAt: string | null;
    endsAt: string | null;
    cooldownHours: number;
}

const RulesSchema = z.object({
    rules: z.array(z.object({
        id: z.string(),
        mailboxAddress: z.string(),
        position: z.coerce.number().default(100),
        isActive: z.boolean().default(true),
        name: z.string().default(''),
        field: z.enum(['from', 'subject', 'body']),
        operator: z.enum(['contains', 'equals', 'domain']),
        value: z.string(),
        action: z.enum(['move_archive', 'move_trash', 'move_spam', 'mark_read']),
    })).default([]),
    autoReplies: z.array(z.object({
        mailboxAddress: z.string(),
        isActive: z.boolean().default(false),
        subject: z.string().default('Abwesenheitsnotiz'),
        body: z.string().default(''),
        startsAt: z.string().nullish(),
        endsAt: z.string().nullish(),
        cooldownHours: z.coerce.number().default(24),
    })).default([]),
    sendable: z.array(z.string()).default([]),
});

export async function listMailRules(): Promise<{
    rules: MailRule[];
    autoReplies: AutoReplyEntry[];
    sendable: string[];
}> {
    const parsed = RulesSchema.parse(await apiFetch<unknown>('/api/inbox/rules'));
    return {
        rules: parsed.rules,
        autoReplies: parsed.autoReplies.map((a) => ({
            ...a,
            startsAt: a.startsAt ?? null,
            endsAt: a.endsAt ?? null,
        })),
        sendable: parsed.sendable,
    };
}

export async function createMailRule(input: Omit<MailRule, 'id'>): Promise<MailRule> {
    return apiFetch('/api/inbox/rules', {
        method: 'POST',
        body: JSON.stringify({ ...input, mailbox: input.mailboxAddress }),
    });
}

export async function deleteMailRule(id: string): Promise<{ success: boolean }> {
    return apiFetch(`/api/inbox/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function putAutoReply(input: {
    mailbox: string;
    isActive: boolean;
    subject: string;
    body: string;
    startsAt: string | null;
    endsAt: string | null;
    cooldownHours: number;
}): Promise<{ success: boolean }> {
    return apiFetch(`/api/inbox/autoreply/${encodeURIComponent(input.mailbox)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
    });
}

// ── Postfach-Verwaltung (nur Superadmin) ───────────────────────────────────

export interface MailboxAdminEntry {
    address: string;
    kind: 'shared' | 'personal' | 'quarantine';
    displayName: string;
    ownerUsername: string | null;
    isActive: boolean;
    isFallback: boolean;
    /** Kompakt als "name:cansend[:notfall]"-Liste, komma-getrennt. */
    readers: string | null;
}

export interface AccessEvent {
    occurredAt: string;
    event: string;
    actorLabel: string | null;
    targetLabel: string | null;
    mailboxAddress: string | null;
    reason: string | null;
}

const MailboxAdminSchema = z.object({
    mailboxes: z.array(z.object({
        address: z.string(),
        kind: z.enum(['shared', 'personal', 'quarantine']),
        displayName: z.string().default(''),
        ownerUsername: z.string().nullish(),
        isActive: z.boolean().default(true),
        isFallback: z.boolean().default(false),
        readers: z.string().nullish(),
    })).default([]),
    events: z.array(z.object({
        occurredAt: z.string(),
        event: z.string(),
        actorLabel: z.string().nullish(),
        targetLabel: z.string().nullish(),
        mailboxAddress: z.string().nullish(),
        reason: z.string().nullish(),
    })).default([]),
});

export async function listMailboxAdministration(): Promise<{
    mailboxes: MailboxAdminEntry[];
    events: AccessEvent[];
}> {
    const raw = await apiFetch<unknown>('/api/inbox/admin/mailboxes');
    const parsed = MailboxAdminSchema.parse(raw);
    return {
        mailboxes: parsed.mailboxes.map((m) => ({
            ...m,
            ownerUsername: m.ownerUsername ?? null,
            readers: m.readers ?? null,
        })),
        events: parsed.events.map((e) => ({
            ...e,
            actorLabel: e.actorLabel ?? null,
            targetLabel: e.targetLabel ?? null,
            mailboxAddress: e.mailboxAddress ?? null,
            reason: e.reason ?? null,
        })),
    };
}

export interface GrantAccessInput {
    adminId: string;
    mailbox: string;
    canSend: boolean;
    breakGlass?: boolean;
    reason?: string;
}

export async function grantMailboxAccess(
    input: GrantAccessInput,
): Promise<{ success: boolean; breakGlass: boolean }> {
    return apiFetch('/api/inbox/admin/access', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export async function revokeMailboxAccess(
    adminId: string,
    mailbox: string,
): Promise<{ success: boolean }> {
    const params = new URLSearchParams({ adminId, mailbox });
    return apiFetch(`/api/inbox/admin/access?${params.toString()}`, { method: 'DELETE' });
}

export interface StoredDocument {
    slug: string;
    filename: string;
    contentType: string;
    byteSize: number;
    updatedAt: string;
    updatedBy: string | null;
}

const DocumentsSchema = z.object({
    documents: z.array(z.object({
        slug: z.string(),
        filename: z.string(),
        contentType: z.string(),
        byteSize: z.coerce.number(),
        updatedAt: z.string(),
        updatedBy: z.string().nullish(),
    })).default([]),
});

export async function listDocuments(): Promise<StoredDocument[]> {
    const raw = await apiFetch<unknown>('/api/inbox/admin/documents');
    return DocumentsSchema.parse(raw).documents.map((d) => ({ ...d, updatedBy: d.updatedBy ?? null }));
}

/**
 * Lädt ein Dokument unter einem festen Slug hoch und ersetzt eine vorhandene
 * Fassung. Der Link bleibt gleich — auch bereits verschickte Mails zeigen
 * danach die neue Datei.
 */
export async function putDocument(slug: string, file: File): Promise<StoredDocument> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return apiFetch(`/api/inbox/admin/documents/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        body: JSON.stringify({
            filename: file.name,
            contentType: file.type || 'application/pdf',
            contentBase64: btoa(binary),
        }),
    });
}

/** Verschiebt eine Nachricht in Archiv oder Papierkorb — oder zurück. */
export async function moveInboxMessage(
    id: string,
    folder: MovableFolder,
): Promise<{ success: boolean; folder: string }> {
    return apiFetch(`/api/inbox/email/${encodeURIComponent(id)}/folder`, {
        method: 'PATCH',
        body: JSON.stringify({ folder }),
    });
}

/** Holt eine Nachricht aus dem Papierkorb in ihren Ursprungsordner zurück. */
export async function restoreInboxMessage(id: string): Promise<{ success: boolean }> {
    return apiFetch(`/api/inbox/email/${encodeURIComponent(id)}/restore`, { method: 'POST' });
}

// ── Entwürfe ───────────────────────────────────────────────────────────────

export interface DraftInput {
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    htmlContent?: string;
    replyToMessageId?: string | null;
}

export async function createDraft(input: DraftInput): Promise<{ success: boolean; id: string }> {
    return z.object({ success: z.literal(true), id: z.string().min(1) }).parse(await apiFetch('/api/inbox/drafts', { method: 'POST', body: JSON.stringify(input) }));
}

export async function updateDraft(id: string, input: DraftInput): Promise<{ success: boolean }> {
    return z.object({ success: z.literal(true) }).parse(await apiFetch(`/api/inbox/drafts/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
    }));
}

export async function deleteDraft(id: string): Promise<{ success: boolean }> {
    return apiFetch(`/api/inbox/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export interface DraftAttachment {
    id: string;
    filename: string;
    content_type: string;
    byte_size: number;
}

/**
 * Lädt einen Anhang zu einem Entwurf hoch.
 *
 * Als base64 im JSON-Body, weil der Versand-Endpunkt kein multipart spricht.
 * Die Bytes liegen serverseitig am Entwurf — ein Neuladen der Seite verliert
 * sie also nicht, und beim Senden müssen sie nicht erneut übertragen werden.
 */
export async function uploadDraftAttachment(
    draftId: string,
    file: File,
): Promise<DraftAttachment> {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    // In Blöcken, weil String.fromCharCode(...) bei großen Dateien den
    // Aufrufstapel sprengt.
    for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return apiFetch(`/api/inbox/drafts/${encodeURIComponent(draftId)}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            contentBase64: btoa(binary),
        }),
    });
}

export async function deleteDraftAttachment(
    draftId: string,
    attachmentId: string,
): Promise<{ success: boolean }> {
    return apiFetch(
        `/api/inbox/drafts/${encodeURIComponent(draftId)}/attachments/${encodeURIComponent(attachmentId)}`,
        { method: 'DELETE' },
    );
}

export interface SendInboxEmailInput {
    requestId: string;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    htmlContent?: string;
    replyToMessageId?: string;
    /** Aus diesem Entwurf senden — seine Anhänge gehen mit. */
    draftId?: string;
}

export async function sendInboxEmail(input: SendInboxEmailInput): Promise<{
    success: boolean;
    messageId: string;
}> {
    return z.object({ success: z.literal(true), messageId: z.string().min(1) }).parse(await apiFetch('/api/inbox/email/send', {
        method: 'POST',
        body: JSON.stringify(input),
    }));
}

export type EmailDraftTone = 'professional' | 'friendly' | 'formal' | 'brief';

export interface EmailDraftSuggestion {
    subject: string;
    body: string;
}

const EmailDraftSuggestionSchema = z.object({
    subject: z.string().min(1),
    body: z.string().min(1),
});

/** Erstellt einen Vorschlag; versendet oder speichert selbst nichts. */
export async function createEmailDraftSuggestion(input: {
    topic: string;
    tone: EmailDraftTone;
}): Promise<EmailDraftSuggestion> {
    const raw = await apiFetch<unknown>('/api/inbox/email/ai-draft', {
        method: 'POST',
        body: JSON.stringify(input),
    });
    return EmailDraftSuggestionSchema.parse(raw);
}

/** Backwards-compatible reply helper used by older callers. */
export async function replyInboxMessage(params: {
    id: string;
    to: string;
    subject: string;
    body: string;
    from?: string;
}): Promise<{ success: boolean }> {
    return sendInboxEmail({
        requestId: crypto.randomUUID(),
        from: params.from || 'info@partsunion.de',
        to: [params.to],
        subject: params.subject,
        body: params.body,
        replyToMessageId: params.id,
    });
}

/** Download through the authenticated API, following Resend's short-lived URL. */
export async function downloadInboxAttachment(
    messageId: string,
    attachmentId: string,
    filename: string,
): Promise<void> {
    const blob = await fetchInboxAttachment(messageId, attachmentId);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || 'anhang';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Firefox/Safari may not have consumed the object URL when click() returns.
    // Revoking synchronously made the visible attachment button appear broken.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const PREVIEWABLE_ATTACHMENT_TYPES = new Set([
    'application/pdf',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain',
]);

/** Opens safe document/image types in a new tab and downloads other files. */
export async function openInboxAttachment(
    messageId: string,
    attachmentId: string,
    filename: string,
    contentType: string,
): Promise<void> {
    const normalizedType = contentType.split(';')[0]?.trim().toLowerCase();
    if (!PREVIEWABLE_ATTACHMENT_TYPES.has(normalizedType)) {
        await downloadInboxAttachment(messageId, attachmentId, filename);
        return;
    }

    // Open the tab during the user gesture. Opening only after await fetch()
    // is treated as an unsolicited popup by Safari and hardened browsers.
    const preview = window.open('', '_blank');
    if (preview) {
        preview.opener = null;
        preview.document.title = filename || 'Anhang';
        preview.document.body.textContent = 'Anhang wird geladen …';
    }

    try {
        const blob = await fetchInboxAttachment(messageId, attachmentId);
        const url = URL.createObjectURL(blob);
        if (preview && !preview.closed) {
            preview.location.replace(url);
            window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
            return;
        }
        URL.revokeObjectURL(url);
        await downloadInboxAttachment(messageId, attachmentId, filename);
    } catch (error) {
        preview?.close();
        throw error;
    }
}

/** Authenticated bytes for explicitly selected forward attachments; never fetch message URLs. */
export async function fetchInboxAttachment(messageId: string, attachmentId: string): Promise<Blob> {
    const authorization = getAuthorizationValue(getAuthToken());
    const response = await fetch(
        `${API_BASE_URL}/api/inbox/email/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
        {
            credentials: 'include',
            headers: authorization ? { Authorization: authorization } : undefined,
            signal: AbortSignal.timeout(30_000),
        },
    );
    if (!response.ok) {
        const problem = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(problem?.error || 'Anhang konnte nicht geladen werden.');
    }
    return response.blob();
}

/* ── Push-Benachrichtigungen ──────────────────────────────────────────── */

export interface PushKeyResponse {
    publicKey: string | null;
    enabled: boolean;
}

export function fetchPushKey(): Promise<PushKeyResponse> {
    return apiFetch<PushKeyResponse>('/api/inbox/push/key');
}

export function subscribePush(subscription: unknown): Promise<{ ok: boolean }> {
    return apiFetch('/api/inbox/push/subscribe', {
        method: 'POST',
        body: JSON.stringify(subscription),
    });
}

export function unsubscribePush(endpoint: string): Promise<{ ok: boolean }> {
    return apiFetch('/api/inbox/push/subscribe', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint }),
    });
}
