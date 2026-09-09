/**
 * Tenant Management API — list, get, create, update, deactivate, delete.
 */

import { apiFetch } from './client';
import {
    AdminStatsSchema,
    ActiveTenantDeviceArraySchema,
    CreateTenantResultSchema,
    TenantArraySchema,
    TenantDetailSchema,
    parseApiResponse,
    parseApiResponseStrict,
    type ActiveTenantDevice,
    type AdminStats,
    type CreateTenantResult,
    type Tenant,
    type TenantDetail,
} from './types';

function tenantPathId(tenantId: number | string): string {
    return encodeURIComponent(String(tenantId));
}

export async function listTenants(opts: { includeDeleted?: boolean } = {}): Promise<Tenant[]> {
    const qs = opts.includeDeleted ? '?include_deleted=1' : '';
    const raw = await apiFetch<unknown>(`/api/admin/tenants${qs}`);
    // Tenant IDs drive cross-tenant mutations. Never continue with an
    // unnormalised raw list when its wire contract is malformed.
    return parseApiResponseStrict(TenantArraySchema, raw);
}

export async function getAdminStats(): Promise<AdminStats> {
    const [stats, kpis] = await Promise.all([
        apiFetch<unknown>('/api/admin/stats'),
        apiFetch<{ history?: AdminStats['history']; sales?: unknown; team?: unknown; oem?: unknown }>(
            '/api/admin/kpis'
        ).catch(() => null),
    ]);
    const merged = {
        ...(stats as Record<string, unknown>),
        history: kpis?.history ?? [],
        kpis: kpis ? { sales: kpis.sales, team: kpis.team, oem: kpis.oem } : undefined,
    };
    return parseApiResponse(AdminStatsSchema, merged);
}

export async function getTenant(tenantId: number | string): Promise<TenantDetail> {
    const raw = await apiFetch<{ tenant: unknown }>(
        `/api/admin/tenants/${tenantPathId(tenantId)}/detail`,
    );
    return parseApiResponseStrict(TenantDetailSchema, raw.tenant);
}

/** Echte Response von POST /api/admin/tenants (kein success/tenant-Wrapper). */
export type { CreateTenantResult } from './types';

/** P1.1 — Rechnungs-Provisioning: landet in billing_design_settings (IBAN,
 *  Bank, Nummernkreis-Präfix, Logo, Template, Firmenanschrift für die Rechnung). */
export interface TenantBillingInput {
    company_name?: string;
    company_address?: string;
    company_zip?: string;
    company_city?: string;
    company_phone?: string;
    company_email?: string;
    iban?: string;
    bank_name?: string;
    bic?: string;
    invoice_prefix?: string;
    invoice_template?: string;
    /** Data-URL oder rohes base64 — Backend schreibt es nach logo_base64. */
    logo_base64?: string;
}

/** P1.1 — Steuer-Identität: landet AUSSCHLIESSLICH in tax_profiles. */
export interface TenantTaxInput {
    business_type?: 'sole_trader' | 'company';
    small_business?: boolean; // Kleinunternehmer §19 UStG
    vat_id?: string;
    tax_number?: string;
    tax_method?: 'IST' | 'SOLL';
    period_type?: 'monthly' | 'quarterly';
}

export async function createTenant(data: {
    demo?: { days: number };
    name: string;
    email: string;
    website?: string;
    phone?: string;
    password?: string;
    whatsapp_number?: string;
    logo_url?: string;
    // Befund B2: Limits laufen jetzt im Create-Payload mit, statt über einen
    // zweiten (verlierbaren) PATCH /limits-Call nach der Anlage.
    max_users?: number;
    max_devices?: number;
    // P1.1 — vollständiges Provisioning (optional, atomar in derselben TX).
    billing?: TenantBillingInput;
    tax?: TenantTaxInput;
    // G4 — AVV/DSGVO Art. 28 Zustimmung erfasst (Record-Keeping, kein Hard-Gate).
    dpa_accepted?: boolean;
}): Promise<CreateTenantResult> {
    const raw = await apiFetch<unknown>('/api/admin/tenants', {
        method: 'POST',
        body: JSON.stringify(data),
    });
    // Provisioning drives the success screen and exposes one-time credentials.
    // Never continue with a raw/malformed response: doing so can claim that a
    // customer was created while its canonical ID or owner data is missing.
    return parseApiResponseStrict(CreateTenantResultSchema, raw);
}

/**
 * Partial-Update eines Tenants (non-destruktiv). Backend-PATCH unterstützt
 * max_users, max_devices, whatsapp_number sowie (P1.2) name (Anzeigename =
 * companies.name) und billing (Logo/Kontakt/IBAN/… → billing_design_settings,
 * nur übergebene Keys ändern sich). Steuer-Identität läuft NICHT hierüber.
 */
export async function updateTenant(
    tenantId: number | string,
    data: Partial<{
        whatsapp_number: string;
        max_users: number;
        max_devices: number;
        name: string;
        billing: TenantBillingInput;
    }>
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>(`/api/admin/tenants/${tenantPathId(tenantId)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    });
}

/**
 * WhatsApp-Aktivierung: setzt merchant_settings.settings.meta.phone_number_id
 * (der EINE Schlüssel, über den Inbound-Routing + Outbound-Send den Absender
 * auflösen). Ohne ihn empfängt/sendet der Bot fail-closed nichts. access_token/
 * app_secret bleiben Plattform-ENV — hier nur die per-Tenant-Nummer.
 */
export async function setTenantWhatsAppMeta(
    tenantId: number | string,
    data: { phone_number_id: string; waba_id?: string }
): Promise<{ success: boolean; configured: boolean; phone_number_id: string; waba_id?: string }> {
    return apiFetch(`/api/admin/tenants/${tenantPathId(tenantId)}/whatsapp-meta`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export interface WhatsAppMetaTestResult {
    ok: boolean;
    displayPhoneNumber?: string;
    verifiedName?: string;
    qualityRating?: string;
    error?: string;
}

/** Read-only Graph-Ping (kein Versand). Optionales phone_number_id testet einen
 *  Kandidaten VOR dem Speichern; sonst die gespeicherte Nummer. */
export async function testTenantWhatsAppMeta(
    tenantId: number | string,
    data: { phone_number_id?: string } = {}
): Promise<WhatsAppMetaTestResult> {
    return apiFetch(`/api/admin/tenants/${tenantPathId(tenantId)}/whatsapp-meta/test`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export async function updateTenantLimits(
    tenantId: number | string,
    limits: { max_users: number; max_devices: number }
): Promise<void> {
    // Dedizierte Route mit zod-Validierung (1-100 / 1-50) im Backend.
    await apiFetch<unknown>(`/api/admin/tenants/${tenantPathId(tenantId)}/limits`, {
        method: 'PATCH',
        body: JSON.stringify(limits),
    });
}

/**
 * Setzt das Passwort eines Tenant-Users (z.B. Owner) direkt neu —
 * POST /api/admin/users/:id/reset-password. KEIN E-Mail-Versand: der Admin
 * teilt das neue Passwort selbst mit. (Der frühere Code rief fälschlich den
 * Platform-Admin-Reset auf, der wegen Anti-Enumeration immer success meldet.)
 */
export async function resetTenantUserPassword(
    userId: string,
    newPassword: string
): Promise<{ success: boolean; message?: string }> {
    return apiFetch<{ success: boolean; message?: string }>(
        `/api/admin/users/${encodeURIComponent(userId)}/reset-password`,
        { method: 'POST', body: JSON.stringify({ newPassword }) }
    );
}

export async function deactivateTenant(tenantId: number | string): Promise<{ success: boolean }> {
    const result = await apiFetch<{ success?: unknown }>(
        `/api/admin/tenants/${tenantPathId(tenantId)}/deactivate`,
        { method: 'POST' },
    );
    if (result.success !== true) {
        throw new Error('Deaktivierung wurde vom Server nicht bestätigt.');
    }
    return { success: true };
}

export async function activateTenant(tenantId: number | string): Promise<{ success: boolean }> {
    const result = await apiFetch<{ success?: unknown }>(
        `/api/admin/tenants/${tenantPathId(tenantId)}/activate`,
        { method: 'POST' },
    );
    if (result.success !== true) {
        throw new Error('Aktivierung wurde vom Server nicht bestätigt.');
    }
    return { success: true };
}

/**
 * Sperrt einen Mandanten wegen offener Zahlung (Sales-led Billing-Lockout).
 * Der Backend setzt payment_status='suspended'; alle Tenant-Routen antworten
 * danach mit HTTP 402, bis ein Admin reaktiviert.
 */
export async function suspendTenant(
    tenantId: number | string
): Promise<{ success: boolean; id: number | string; payment_status: string }> {
    return apiFetch<{ success: boolean; id: number | string; payment_status: string }>(
        `/api/admin/tenants/${tenantPathId(tenantId)}/suspend`,
        { method: 'POST' }
    );
}

/** Hebt eine Zahlungs-Sperre wieder auf (payment_status='active'). */
export async function unsuspendTenant(
    tenantId: number | string
): Promise<{ success: boolean; id: number | string; payment_status: string }> {
    return apiFetch<{ success: boolean; id: number | string; payment_status: string }>(
        `/api/admin/tenants/${tenantPathId(tenantId)}/unsuspend`,
        { method: 'POST' }
    );
}

/**
 * Soft-Delete eines Tenants (Befund B7 — jetzt real implementiert):
 * setzt tenant_settings.deleted_at + Billing-Lockout. Der Tenant verschwindet
 * aus Liste und Plattform-KPIs, alle Daten bleiben erhalten und sind über
 * restoreTenant() wiederherstellbar.
 */
export async function deleteTenant(
    tenantId: number | string
): Promise<{ success: boolean; tenantId: string; deleted: boolean }> {
    return apiFetch<{ success: boolean; tenantId: string; deleted: boolean }>(
        `/api/admin/tenants/${tenantPathId(tenantId)}`,
        { method: 'DELETE' }
    );
}

/** Hebt einen Soft-Delete wieder auf (deleted_at=NULL, payment_status='active'). */
export async function restoreTenant(
    tenantId: number | string
): Promise<{ success: boolean; tenantId: string; deleted: boolean }> {
    return apiFetch<{ success: boolean; tenantId: string; deleted: boolean }>(
        `/api/admin/tenants/${tenantPathId(tenantId)}/restore`,
        { method: 'POST' }
    );
}

/**
 * Endgültiges Purge eines bereits soft-gelöschten Tenants (irreversibel):
 * gibt Owner-E-Mail/Username, Firmen-Name/-Mail und die Meta-Nummer frei, damit
 * der Händler neu onboardet werden kann. Superadmin-only (Backend).
 */
export async function purgeTenant(
    tenantId: number | string
): Promise<{ success: boolean; tenantId: string; purged: boolean }> {
    return apiFetch<{ success: boolean; tenantId: string; purged: boolean }>(
        `/api/admin/tenants/${tenantPathId(tenantId)}/purge`,
        { method: 'POST' }
    );
}

/** Mintet einen neuen Setup-/Magic-Link für den Owner neu und gibt ihn zurück
 *  (z. B. wenn die Willkommens-Mail nicht ankam). Superadmin-only (Backend). */
export async function resendTenantWelcome(
    tenantId: number | string
): Promise<{ ok: boolean; welcome_email_sent: boolean; setup_link?: string }> {
    return apiFetch<{ ok: boolean; welcome_email_sent: boolean; setup_link?: string }>(
        `/api/admin/tenants/${tenantPathId(tenantId)}/resend-welcome`,
        { method: 'POST' }
    );
}

export async function listActiveDevices(
    tenantId: number | string
): Promise<ActiveTenantDevice[]> {
    const raw = await apiFetch<unknown>(
        `/api/admin/tenants/${tenantPathId(tenantId)}/devices`,
    );
    // A malformed session list must fail visibly. Falling through with raw data
    // can make active sessions disappear or revoke the wrong device.
    return parseApiResponseStrict(ActiveTenantDeviceArraySchema, raw);
}

export async function removeActiveDevice(
    tenantId: number | string,
    deviceId: string,
    sessionId: string,
    userId: string,
): Promise<void> {
    const safeDeviceId = encodeURIComponent(deviceId);
    const selector = new URLSearchParams({ session_id: sessionId, user_id: userId });
    const result = await apiFetch<{ success?: unknown }>(
        `/api/admin/tenants/${tenantPathId(tenantId)}/devices/${safeDeviceId}?${selector.toString()}`,
        { method: 'DELETE' },
    );
    if (result?.success !== true) {
        throw new Error('Geräte-Session wurde vom Server nicht bestätigt.');
    }
}

export async function createTenantUser(
    tenantId: number | string,
    user: { email: string; username: string; password: string; role: string }
): Promise<void> {
    await apiFetch<unknown>(`/api/admin/tenants/${tenantPathId(tenantId)}/users`, {
        method: 'POST',
        body: JSON.stringify(user),
    });
}

// ── P1.3 Support-Konsole: read-only Chats + Probleme EINES Tenants ───────────

export interface TenantConversationMessage {
    direction: string | null;
    content: string | null;
    created_at: string;
}

export interface TenantConversation {
    phone: string;
    message_count: number;
    last_message_at: string;
    last_message: string | null;
    last_direction: string | null;
    messages: TenantConversationMessage[];
}

export async function getTenantConversations(
    tenantId: number | string
): Promise<TenantConversation[]> {
    const raw = await apiFetch<{ conversations?: TenantConversation[] }>(
        `/api/admin/tenants/${tenantPathId(tenantId)}/conversations`
    );
    return raw?.conversations ?? [];
}

export interface TenantIssues {
    stalledOrders: Array<{
        id: string;
        customer_contact: string | null;
        status: string;
        requested_part_name: string | null;
        oem_number: string | null;
        created_at: string;
    }>;
    unmetLookups: Array<{
        id: string;
        query_text: string | null;
        resolved_oem: string | null;
        top_confidence: number | null;
        created_at: string;
    }>;
    failedJobs: Array<{
        id: string;
        job_type: string | null;
        error_message: string | null;
        created_at: string;
    }>;
    total: number;
}

export async function getTenantIssues(tenantId: number | string): Promise<TenantIssues> {
    const raw = await apiFetch<Partial<TenantIssues>>(
        `/api/admin/tenants/${tenantPathId(tenantId)}/issues`
    );
    return {
        stalledOrders: raw?.stalledOrders ?? [],
        unmetLookups: raw?.unmetLookups ?? [],
        failedJobs: raw?.failedJobs ?? [],
        total: raw?.total ?? 0,
    };
}
