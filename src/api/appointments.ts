/**
 * Termine/Kalender API — Quali- & Sales-Calls des Vertriebsteams.
 * Backend: /api/admin/appointments (Whatsapp-Bot appointmentRoutes).
 */
import { apiFetch } from './client';

export type AppointmentType = 'quali' | 'sales' | 'call' | 'other';
export type AppointmentStatus = 'proposed' | 'confirmed' | 'declined' | 'cancelled' | 'completed' | 'no_show';
export type BookingEmailStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain';
export interface WebsiteBooking {
    confirmationStatus: BookingEmailStatus;
    teamStatus: BookingEmailStatus;
    confirmationSentAt?: string;
    confirmationError?: string;
    teamError?: string;
    consentGivenAt: string;
}

export interface Appointment {
    teams_meeting?: {
        requested?: boolean;
        state?: 'pending' | 'ready' | 'failed' | 'cancelled';
        error?: string;
    };
    invitation_from?: string | null;
    id: string;
    type: AppointmentType | string;
    title: string;
    notes: string | null;
    assignee_id: string | null;
    assignee_name: string | null;
    created_by_id: string | null;
    created_by_name: string | null;
    company_id: string | null;
    customer_name: string | null;
    customer_email: string | null;
    customer_phone: string | null;
    start_at: string;
    end_at: string;
    duration_minutes: number;
    location: string | null;
    meeting_link: string | null;
    status: AppointmentStatus | string;
    public_token: string | null;
    invite_sent_at: string | null;
    invite_delivery_mode?: 'review' | 'test' | 'live' | string | null;
    invite_recipient?: string | null;
    invite_email_error?: string | null;
    cancellation_email_sent_at?: string | null;
    cancellation_delivery_mode?: 'review' | 'test' | 'live' | string | null;
    cancellation_email_recipient?: string | null;
    cancellation_email_error?: string | null;
    responded_at: string | null;
    created_at: string;
    updated_at: string;
    source?: string | null;
    external_calendar_user?: string | null;
    website_booking?: WebsiteBooking | null;
}

export function retryWebsiteConfirmation(id: string): Promise<{ok: boolean}> {
    return apiFetch(`/api/admin/consultations/${encodeURIComponent(id)}/confirmation`, {method:'POST',body:JSON.stringify({})});
}

export interface AppointmentAdmin {
    id: string;
    username: string;
    name: string;
    email: string;
    teamsAvailable?: boolean;
}

export interface CreateAppointmentInput {
    createTeams?: boolean;
    type?: AppointmentType;
    title?: string;
    notes?: string;
    assigneeId?: string;
    companyId?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    start?: string;            // "YYYY-MM-DDTHH:MM"
    durationMinutes?: number;
    location?: string;
    meetingLink?: string;
    sendInvite?: boolean;
}

export interface UpdateAppointmentInput extends Partial<CreateAppointmentInput> {
    status?: AppointmentStatus;
    resendInvite?: boolean;
}

export interface MutationResult {
    appointment: Appointment;
    inviteSent: boolean;
    inviteError?: string;
    calendarSynced?: boolean;
    calendarError?: string;
    calendarDecision?: {
        eligible: boolean;
        type: AppointmentType;
        reason: string;
        confidence: number;
    };
}

const BASE = '/api/admin/appointments';

export function listAppointments(
    params: { from?: string; to?: string; assigneeId?: string; status?: string } = {},
): Promise<{ appointments: Appointment[] }> {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ appointments: Appointment[] }>(`${BASE}${suffix}`);
}

export function getAppointmentById(id: string): Promise<{ appointment: Appointment }> {
    return apiFetch<{ appointment: Appointment }>(`${BASE}/${encodeURIComponent(id)}`);
}

export function listAppointmentAdmins(): Promise<{ admins: AppointmentAdmin[] }> {
    return apiFetch<{ admins: AppointmentAdmin[] }>(`${BASE}/admins`);
}

export function createAppointment(body: CreateAppointmentInput): Promise<MutationResult> {
    return apiFetch<MutationResult>(BASE, { method: 'POST', body: JSON.stringify(body) });
}

export function updateAppointment(id: string, body: UpdateAppointmentInput): Promise<MutationResult> {
    return apiFetch<MutationResult>(`${BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export interface CancellationResult {
    appointment: Appointment;
    emailSent: boolean;
    emailSentToLead: boolean;
    emailError?: string;
}

export function cancelAppointment(id: string): Promise<CancellationResult> {
    return apiFetch<CancellationResult>(`${BASE}/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
}
