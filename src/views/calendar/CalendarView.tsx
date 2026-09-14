/**
 * Kalender / Termine — Quali- & Sales-Calls des Vertriebsteams.
 *
 * Calendly-artiger Flow: Admin legt im Call einen Termin an, der Kunde erhält
 * eine E-Mail-Einladung (+ .ics + Bestätigungs-Link) und bestätigt selbst — der
 * Status springt dann automatisch auf „Bestätigt". Termine sind einem Admin
 * (Elias/Bardia/Aaron/Fecat) zugewiesen und nach Zuständigem filterbar.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Loader2, Clock, User, Mail, Phone,
    MapPin, Check, RotateCcw, CalendarX, Video, ExternalLink, Workflow,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HAUPT_AKTION, NEBEN_AKTION, SEITEN_RAND, SeitenKopf } from '@/components/ui/seite';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';
import {
    listAppointments, listAppointmentAdmins, createAppointment, updateAppointment, cancelAppointment,
    type Appointment, type CreateAppointmentInput,
} from '@/api/appointments';
import { cn } from '@/lib/utils';
import { KALENDER_ZELLE } from '@/components/ui/dichte';
import { WebsiteBookingStatus } from './WebsiteBookingStatus';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { appointmentConflicts, safeMeetingUrl, validateCalendarDraft } from './calendarForm';

// ── Anzeige-Maps ──────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; chip: string; dot: string }> = {
    quali: { label: 'Quali', chip: 'bg-violet-500/15 text-violet-300 hell:text-violet-700 border-violet-500/30', dot: 'bg-violet-400' },
    sales: { label: 'Sales', chip: 'bg-sky-500/15 text-sky-300 hell:text-sky-700 border-sky-500/30', dot: 'bg-sky-400' },
    call: { label: 'Rückruf', chip: 'bg-emerald-500/15 text-emerald-300 hell:text-emerald-700 border-emerald-500/30', dot: 'bg-emerald-400' },
    other: { label: 'Termin', chip: 'bg-slate-500/15 text-slate-300 hell:text-slate-700 border-slate-500/30', dot: 'bg-slate-400' },
};
const STATUS_META: Record<string, { label: string; cls: string }> = {
    proposed: { label: 'Vorgeschlagen', cls: 'bg-amber-500/15 text-amber-300 hell:text-amber-800 border-amber-500/30' },
    confirmed: { label: 'Bestätigt', cls: 'bg-emerald-500/15 text-emerald-300 hell:text-emerald-700 border-emerald-500/30' },
    declined: { label: 'Abgelehnt', cls: 'bg-rose-500/15 text-rose-300 hell:text-rose-700 border-rose-500/30' },
    cancelled: { label: 'Abgesagt', cls: 'bg-slate-500/15 text-slate-400 hell:text-slate-700 border-slate-500/30' },
    completed: { label: 'Erledigt', cls: 'bg-blue-500/15 text-blue-300 hell:text-blue-700 border-blue-500/30' },
    no_show: { label: 'Nicht erschienen', cls: 'bg-orange-500/15 text-orange-300 hell:text-orange-800 border-orange-500/30' },
};
const DURATIONS = [15, 30, 45, 60, 90, 120];
const EMPTY_APPOINTMENTS: Appointment[] = [];

// ── Datums-Helfer (lokale Wall-Clock, kein TZ-Mathe) ─────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function timeOf(iso: string): string {
    const m = iso.match(/T(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : '';
}
function dayKeyOf(iso: string): string {
    return iso.slice(0, 10);
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function buildGrid(cursor: Date): Date[] {
    const first = startOfMonth(cursor);
    const offset = (first.getDay() + 6) % 7; // Montag = 0
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    return Array.from({ length: 42 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
    });
}

type AppointmentForm = CreateAppointmentInput & { date?: string; time?: string; managedTeams?: boolean };
const emptyForm = (): AppointmentForm => ({
    type: 'sales', durationMinutes: 30, sendInvite: true, date: '', time: '10:00',
});

export default function CalendarView(): JSX.Element {
    const { user } = useAuth();
    const myId = user?.id != null ? String(user.id) : null;

    const [cursor, setCursor] = useState<Date>(() => new Date());
    const [assigneeFilter, setAssigneeFilter] = useState<string>('all'); // all | mine | <adminId>
    const [selectedDay, setSelectedDay] = useState<string>(() => toKey(new Date()));

    const [createOpen, setCreateOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState(emptyForm());
    const [saving, setSaving] = useState(false);
    const [formDirty, setFormDirty] = useState(false);
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});
    const [conflicts, setConflicts] = useState<Appointment[]>([]);
    const [conflictConfirmed, setConflictConfirmed] = useState(false);
    const saveLock = useRef(false);
    const [detail, setDetail] = useState<Appointment | null>(null);
    useUnsavedChanges('Kalendertermin', createOpen && formDirty, saving);

    const grid = useMemo(() => buildGrid(cursor), [cursor]);
    const todayKey = toKey(new Date());
    const rangeStart = `${toKey(grid[0])}T00:00`;
    const rangeEnd = `${toKey(grid[grid.length - 1])}T23:59`;
    const assigneeId =
        assigneeFilter === 'mine'
            ? myId ?? undefined
            : assigneeFilter !== 'all'
              ? assigneeFilter
              : undefined;

    const appointmentsQ = useQuery({
        queryKey: ['admin', 'appointments', rangeStart, rangeEnd, assigneeId ?? 'all'],
        queryFn: () => listAppointments({ from: rangeStart, to: rangeEnd, assigneeId }),
        staleTime: 15_000,
        refetchInterval: 15_000,
    });
    const adminsQ = useQuery({
        queryKey: ['admin', 'appointment-admins'],
        queryFn: listAppointmentAdmins,
        staleTime: 5 * 60_000,
    });
    const appointments = appointmentsQ.data?.appointments ?? EMPTY_APPOINTMENTS;
    const admins = adminsQ.data?.admins ?? [];
    const loading = appointmentsQ.isFetching;

    const byDay = useMemo(() => {
        const map: Record<string, Appointment[]> = {};
        for (const a of appointments) {
            const k = dayKeyOf(a.start_at);
            (map[k] ||= []).push(a);
        }
        Object.values(map).forEach((list) => list.sort((x, y) => x.start_at.localeCompare(y.start_at)));
        return map;
    }, [appointments]);

    const selectedList = byDay[selectedDay] || [];

    // Termine im ANGEZEIGTEN Monat — nicht alle geladenen. Der Entwurf schreibt
    // dort "15 TERMINE"; eine Zahl über den ganzen Zeitraum wäre neben dem
    // Monatsnamen irreführend.
    const monatsTermine = useMemo(
        () => appointments.filter((a) => {
            const d = new Date(a.start_at);
            return d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear();
        }).length,
        [appointments, cursor],
    );

    // ── Modal öffnen ──────────────────────────────────────────────────────────
    function openCreate(dayKey?: string) {
        setEditingId(null);
        const assigneeId = myId && admins.some((admin) => admin.id === myId) ? myId : undefined;
        setForm({
            ...emptyForm(),
            date: dayKey || selectedDay || todayKey,
            assigneeId,
            createTeams: Boolean(admins.find((admin) => admin.id === assigneeId)?.teamsAvailable),
        });
        setFormDirty(false); setFormErrors({}); setConflicts([]); setConflictConfirmed(false);
        setCreateOpen(true);
    }
    function openEdit(a: Appointment) {
        setEditingId(a.id);
        setForm({
            type: a.type as CreateAppointmentInput['type'],
            title: a.title,
            notes: a.notes || '',
            assigneeId: a.assignee_id || undefined,
            customerName: a.customer_name || '',
            customerEmail: a.customer_email || '',
            customerPhone: a.customer_phone || '',
            durationMinutes: a.duration_minutes,
            location: a.location || '',
            meetingLink: a.meeting_link || '',
            managedTeams: Boolean(a.teams_meeting?.requested),
            sendInvite: false,
            date: dayKeyOf(a.start_at),
            time: timeOf(a.start_at),
        });
        setFormDirty(false); setFormErrors({}); setConflicts([]); setConflictConfirmed(false);
        setDetail(null);
        setCreateOpen(true);
    }
    function changeForm(update: (current: ReturnType<typeof emptyForm>) => ReturnType<typeof emptyForm>): void {
        setFormDirty(true); setFormErrors({}); setConflicts([]); setConflictConfirmed(false); setForm(update);
    }
    function closeForm(): void {
        if (saving) return;
        if (formDirty && !window.confirm('Ungespeicherte Terminänderungen verwerfen?')) return;
        setCreateOpen(false); setFormDirty(false); setFormErrors({}); setConflicts([]); setConflictConfirmed(false);
    }

    async function submitForm() {
        if (saveLock.current) return;
        const errors = validateCalendarDraft(form);
        setFormErrors(errors);
        if (Object.keys(errors).length) { toast.error('Bitte die markierten Termindaten prüfen.'); requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-admin-appointment-form] [aria-invalid="true"]')?.focus()); return; }
        const start = `${form.date}T${form.time}`;
        const payload: CreateAppointmentInput = {
            type: form.type, title: form.title?.trim() || undefined, notes: form.notes,
            assigneeId: form.assigneeId, customerName: form.customerName?.trim(), customerEmail: form.customerEmail?.trim(),
            customerPhone: form.customerPhone?.trim(), durationMinutes: form.durationMinutes, location: form.location?.trim(),
            meetingLink: form.meetingLink?.trim() ? safeMeetingUrl(form.meetingLink) : undefined, start, sendInvite: form.sendInvite,
            createTeams: form.createTeams,
        };
        saveLock.current = true; setSaving(true);
        try {
            let availability: { appointments: Appointment[] } = { appointments: [] };
            try {
                if (form.assigneeId) availability = await listAppointments({ from: `${form.date}T00:00`, to: `${form.date}T23:59`, assigneeId: form.assigneeId });
            } catch {
                toast.error('Die Verfügbarkeit konnte nicht aktuell geprüft werden. Bitte erneut versuchen.');
                return;
            }
            const overlapping = appointmentConflicts(availability.appointments, start, form.durationMinutes || 30, form.assigneeId, editingId || undefined);
            setConflicts(overlapping);
            if (overlapping.length && !conflictConfirmed) { toast.error('Bitte die Terminüberschneidung prüfen und bewusst bestätigen.'); return; }
            if (editingId) {
                const res = await updateAppointment(editingId, { ...payload, resendInvite: form.sendInvite });
                if (res.calendarError) toast.warning(`Termin gespeichert, Teams-Synchronisierung ausstehend: ${res.calendarError}`);
                else toast.success(res.inviteSent ? 'Termin aktualisiert · Teams und Einladung aktualisiert.' : 'Termin aktualisiert.');
            } else {
                const res = await createAppointment(payload);
                if (res.calendarError) toast.warning(`Termin angelegt, Teams-Synchronisierung ausstehend: ${res.calendarError}`);
                else if (res.inviteSent) toast.success(res.calendarSynced ? 'Termin und Teams-Call angelegt · Einladung verschickt.' : 'Termin angelegt · Einladung an den Kunden verschickt.');
                else if (form.sendInvite && form.customerEmail) toast.warning(`Termin angelegt, aber E-Mail nicht versendet: ${res.inviteError || 'unbekannt'}`);
                else toast.success('Termin angelegt.');
            }
            setCreateOpen(false);
            setFormDirty(false); setFormErrors({}); setConflicts([]); setConflictConfirmed(false);
            setSelectedDay(form.date!);
            await appointmentsQ.refetch();
        } catch {
            toast.error(editingId ? 'Aktualisieren fehlgeschlagen.' : 'Anlegen fehlgeschlagen.');
        } finally {
            saveLock.current = false; setSaving(false);
        }
    }

    async function doCancel(a: Appointment) {
        if (!confirm('Termin wirklich absagen? Der Kunde wird per E-Mail informiert.')) return;
        try {
            const result = await cancelAppointment(a.id);
            setDetail(result.appointment);
            if (result.emailSentToLead) toast.success('Termin abgesagt · E-Mail an den Lead versendet.');
            else if (result.emailSent) toast.warning('Termin abgesagt · E-Mail wurde nur an die interne Testadresse versendet.');
            else toast.warning(`Termin abgesagt · keine E-Mail an den Lead versendet${result.emailError ? `: ${result.emailError}` : '.'}`);
            await appointmentsQ.refetch();
        }
        catch { toast.error('Absagen fehlgeschlagen.'); }
    }
    async function resend(a: Appointment) {
        try {
            const r = await updateAppointment(a.id, {
                resendInvite: Boolean(a.customer_email),
                ...(a.teams_meeting?.requested ? { createTeams: true } : {}),
            });
            setDetail(r.appointment);
            if (r.inviteSent) toast.success('Einladung an den Kunden verschickt.');
            else if (r.calendarSynced && !a.customer_email) toast.success('Teams-Termin synchronisiert.');
            else toast.warning(`Einladung nicht versendet${r.inviteError ? `: ${r.inviteError}` : '.'}`);
            await appointmentsQ.refetch();
        }
        catch { toast.error('Erneutes Senden fehlgeschlagen.'); }
    }
    const selDate = new Date(`${selectedDay}T00:00`);

    return (
        <div className={cn(SEITEN_RAND, 'space-y-6')}>
            <SeitenKopf
                titel="Kalender"
                beileile="Quali- & Sales-Termine planen, einladen und nachhalten."
                aktionen={
                    <>
                        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                            <SelectTrigger className="h-auto w-[190px] rounded-[10px] border-overlay/[0.08] bg-overlay/[0.04] px-3.5 py-2.5 text-[12px] font-semibold">
                                <SelectValue placeholder="Zuständig" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Alle Zuständigen</SelectItem>
                                {myId && <SelectItem value="mine">Meine Termine</SelectItem>}
                                {admins.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <button type="button" onClick={() => openCreate()} className={HAUPT_AKTION}>
                            <Plus className="size-[15px]" /> Neuer Termin
                        </button>
                    </>
                }
            />

            {appointmentsQ.isError && (
                <div className="flex items-center justify-between gap-3 rounded-[14px] border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                    <span>Termine konnten nicht geladen werden.</span>
                    <Button size="sm" variant="outline" onClick={() => void appointmentsQ.refetch()}>
                        Erneut versuchen
                    </Button>
                </div>
            )}

            <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_328px]">
                {/* Kalendergitter */}
                <div className="karte overflow-hidden">
                    <div className="flex flex-wrap items-center gap-3.5 border-b border-overlay/[0.06] px-5 py-[18px]">
                        <h3 className="font-display text-xl font-semibold">
                            {MONTHS[cursor.getMonth()]} <span className="text-text-muted">{cursor.getFullYear()}</span>
                        </h3>
                        {/* Anzahl im Monat als Mono-Feld, wie im Entwurf. Sie
                            steht dort als "15 TERMINE" fest; hier gezählt. */}
                        <span className="rounded-md bg-overlay/[0.05] px-2 py-1.5 font-mono text-[11px] font-medium text-text-faint">
                            {monatsTermine} {monatsTermine === 1 ? 'TERMIN' : 'TERMINE'}
                        </span>
                        <span className="flex-1" />
                        <button type="button" onClick={() => setCursor(new Date())} className={cn(NEBEN_AKTION, '!px-3.5 !py-[7px] !text-xs')}>
                            Heute
                        </button>
                        <button
                            type="button"
                            aria-label="Voriger Monat"
                            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                            className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-overlay/[0.08] bg-overlay/[0.05] text-text-tertiary transition-colors hover:text-text-primary"
                        >
                            <ChevronLeft className="size-4" />
                        </button>
                        <button
                            type="button"
                            aria-label="Nächster Monat"
                            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                            className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-overlay/[0.08] bg-overlay/[0.05] text-text-tertiary transition-colors hover:text-text-primary"
                        >
                            <ChevronRight className="size-4" />
                        </button>
                        {loading && <Loader2 className="size-4 animate-spin text-text-muted" />}
                    </div>
                    <div className="grid grid-cols-7 border-b border-overlay/[0.06]">
                        {WD.map((d) => (
                            <div key={d} className="px-3 py-[11px] text-center font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-text-faint">
                                {d}
                            </div>
                        ))}
                    </div>
                    <div className="grid grid-cols-7">
                        {grid.map((d, i) => {
                            const k = toKey(d);
                            const inMonth = d.getMonth() === cursor.getMonth();
                            const list = byDay[k] || [];
                            const isToday = k === todayKey;
                            const isSel = k === selectedDay;
                            return (
                                <button
                                    key={i}
                                    onClick={() => setSelectedDay(k)}
                                    onDoubleClick={() => openCreate(k)}
                                    className={[
                                        'border-b border-r p-1.5 text-left align-top transition-colors', KALENDER_ZELLE,
                                        i % 7 === 6 ? 'border-r-0' : '',
                                        inMonth ? '' : 'bg-muted/30 text-muted-foreground',
                                        isSel ? 'ring-2 ring-inset ring-primary/60' : 'hover:bg-accent/40',
                                    ].join(' ')}
                                >
                                    <div className="mb-1 flex items-center justify-between">
                                        <span className={['inline-flex size-6 items-center justify-center rounded-full text-xs', isToday ? 'bg-primary font-semibold text-primary-foreground' : ''].join(' ')}>{d.getDate()}</span>
                                        {list.length > 0 && <span className="text-[10px] text-muted-foreground">{list.length}</span>}
                                    </div>
                                    <div className="space-y-1">
                                        {list.slice(0, 3).map((a) => {
                                            const tm = TYPE_META[a.type] || TYPE_META.other;
                                            return (
                                                <div key={a.id} className={['truncate rounded border px-1 py-0.5 text-[10px] leading-tight', tm.chip, a.status === 'cancelled' ? 'line-through opacity-60' : ''].join(' ')}>
                                                    <span className="font-medium">{timeOf(a.start_at)}</span> {a.website_booking ? 'Website · ' : ''}{a.customer_name || a.title}
                                                </div>
                                            );
                                        })}
                                        {list.length > 3 && <div className="px-1 text-[10px] text-muted-foreground">+{list.length - 3} mehr</div>}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Tages-Panel */}
                <div className="karte overflow-hidden bg-overlay/[0.035]">
                    <div className="flex items-center justify-between border-b px-4 py-3">
                        <div>
                            <div className="text-sm font-semibold">{WD[(selDate.getDay() + 6) % 7]}, {selDate.getDate()}. {MONTHS[selDate.getMonth()]}</div>
                            <div className="text-xs text-muted-foreground">{selectedList.length} Termin{selectedList.length === 1 ? '' : 'e'}</div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => openCreate(selectedDay)}><Plus className="size-4" /> Termin</Button>
                    </div>
                    <div className="max-h-[560px] space-y-2 overflow-auto p-3">
                        {selectedList.length === 0 && (
                            <div className="py-10 text-center text-sm text-muted-foreground">
                                <CalendarIcon className="mx-auto mb-2 size-6 opacity-40" />
                                Keine Termine an diesem Tag.
                            </div>
                        )}
                        {selectedList.map((a) => {
                            const tm = TYPE_META[a.type] || TYPE_META.other;
                            const sm = STATUS_META[a.status] || STATUS_META.proposed;
                            return (
                                <button key={a.id} onClick={() => setDetail(a)} className="w-full rounded-lg border border-overlay/[0.08] bg-overlay/[0.045] p-3 text-left transition-colors hover:bg-overlay/[0.08]">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="flex items-center gap-1.5 text-sm font-medium"><Clock className="size-3.5 text-muted-foreground" />{timeOf(a.start_at)}–{timeOf(a.end_at)}</span>
                                        <span className={['rounded-full border px-2 py-0.5 text-[10px] font-medium', sm.cls].join(' ')}>{sm.label}</span>
                                    </div>
                                    <div className="mt-1.5 truncate text-sm font-medium">{a.customer_name || a.title}</div>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                        <span className={['rounded border px-1.5 py-0.5 text-[10px]', tm.chip].join(' ')}>{tm.label}</span>
                                        {a.assignee_name && <span className="inline-flex items-center gap-1"><User className="size-3" />{a.assignee_name}</span>}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Create / Edit Modal */}
            <Dialog open={createOpen} onOpenChange={(open) => { if (!open) closeForm(); }}>
                <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-[560px]">
                    <DialogHeader>
                        <DialogTitle>{editingId ? 'Termin bearbeiten' : 'Neuer Termin'}</DialogTitle>
                        <DialogDescription>Quali- oder Sales-Call planen. Mit Kunden-E-Mail wird automatisch eine Einladung verschickt.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3" data-admin-appointment-form>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="grid gap-1.5">
                                <Label>Art</Label>
                                <Select value={form.type} onValueChange={(v) => changeForm((f) => ({ ...f, type: v as CreateAppointmentInput['type'] }))}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="quali">Quali-Call</SelectItem>
                                        <SelectItem value="sales">Sales-Call</SelectItem>
                                        <SelectItem value="call">Anruf / Rückruf</SelectItem>
                                        <SelectItem value="other">Sonstiger Termin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-1.5">
                                <Label>Zuständig</Label>
                                <Select disabled={form.managedTeams} value={form.assigneeId || 'none'} onValueChange={(v) => changeForm((f) => {
                                    const assigneeId = v === 'none' ? undefined : v;
                                    return {
                                        ...f,
                                        assigneeId,
                                        createTeams: Boolean(f.createTeams && admins.find((admin) => admin.id === assigneeId)?.teamsAvailable),
                                    };
                                })}>
                                    <SelectTrigger><SelectValue placeholder="Niemand" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">— Niemand —</SelectItem>
                                        {admins.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
                            <div className="grid gap-1.5">
                                <Label htmlFor="admin-appointment-date">Datum</Label>
                                <Input id="admin-appointment-date" type="date" value={form.date} aria-invalid={!!formErrors.date} aria-describedby={formErrors.date ? 'admin-appointment-date-error' : undefined} onChange={(e) => changeForm((f) => ({ ...f, date: e.target.value }))} />
                                {formErrors.date && <p id="admin-appointment-date-error" className="text-xs font-medium text-destructive">{formErrors.date}</p>}
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="admin-appointment-time">Uhrzeit</Label>
                                <Input id="admin-appointment-time" type="time" value={form.time} aria-invalid={!!formErrors.time} aria-describedby={formErrors.time ? 'admin-appointment-time-error' : undefined} onChange={(e) => changeForm((f) => ({ ...f, time: e.target.value }))} className="w-full sm:w-[120px]" />
                                {formErrors.time && <p id="admin-appointment-time-error" className="text-xs font-medium text-destructive">{formErrors.time}</p>}
                            </div>
                            <div className="grid gap-1.5">
                                <Label>Dauer</Label>
                                <Select value={String(form.durationMinutes)} onValueChange={(v) => changeForm((f) => ({ ...f, durationMinutes: Number(v) }))}>
                                    <SelectTrigger className="w-full sm:w-[110px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>{DURATIONS.map((d) => <SelectItem key={d} value={String(d)}>{d} Min.</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Titel <span className="text-muted-foreground">(optional)</span></Label>
                            <Input value={form.title || ''} placeholder="z. B. Erstgespräch Werkstatt Müller" onChange={(e) => changeForm((f) => ({ ...f, title: e.target.value }))} />
                        </div>
                        <div className="border-t pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Kunde</div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="grid gap-1.5">
                                <Label>Name</Label>
                                <Input value={form.customerName || ''} placeholder="Firma / Ansprechpartner" onChange={(e) => changeForm((f) => ({ ...f, customerName: e.target.value }))} />
                            </div>
                            <div className="grid gap-1.5">
                                <Label>Telefon</Label>
                                <Input value={form.customerPhone || ''} placeholder="+49 …" onChange={(e) => changeForm((f) => ({ ...f, customerPhone: e.target.value }))} />
                            </div>
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="admin-appointment-email">E-Mail <span className="text-muted-foreground">(für die Einladung)</span></Label>
                            <Input id="admin-appointment-email" type="email" value={form.customerEmail || ''} placeholder="kunde@firma.de" aria-invalid={!!formErrors.customerEmail} aria-describedby={formErrors.customerEmail ? 'admin-appointment-email-error' : undefined} onChange={(e) => changeForm((f) => ({ ...f, customerEmail: e.target.value }))} />
                            {formErrors.customerEmail && <p id="admin-appointment-email-error" className="text-xs font-medium text-destructive">{formErrors.customerEmail}</p>}
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="grid gap-1.5">
                                <Label>Ort</Label>
                                <Input value={form.location || ''} placeholder="Telefon / vor Ort" onChange={(e) => changeForm((f) => ({ ...f, location: e.target.value }))} />
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="admin-appointment-meeting-link">Meeting-Link</Label>
                                <Input id="admin-appointment-meeting-link" disabled={form.createTeams || form.managedTeams} value={form.meetingLink || ''} placeholder={form.createTeams ? 'Wird beim Speichern erstellt' : 'https://meet…'} aria-invalid={!!formErrors.meetingLink} aria-describedby={formErrors.meetingLink ? 'admin-appointment-meeting-link-error' : undefined} onChange={(e) => changeForm((f) => ({ ...f, meetingLink: e.target.value }))} />
                                {formErrors.meetingLink && <p id="admin-appointment-meeting-link-error" className="text-xs font-medium text-destructive">{formErrors.meetingLink}</p>}
                            </div>
                        </div>
                        {form.managedTeams ? (
                            <p className="text-xs text-muted-foreground">Mit Teams verbunden. Änderungen an Zeit und Titel werden im Microsoft-Kalender des Organisators übernommen.</p>
                        ) : admins.find((admin) => admin.id === form.assigneeId)?.teamsAvailable ? (
                            <label className="flex items-start gap-2 rounded-lg border bg-muted/30 p-2.5 text-sm">
                                <input
                                    type="checkbox"
                                    checked={Boolean(form.createTeams)}
                                    onChange={(event) => changeForm((current) => ({
                                        ...current,
                                        createTeams: event.target.checked,
                                        ...(event.target.checked ? { meetingLink: '' } : {}),
                                    }))}
                                    className="mt-0.5 size-4 shrink-0 accent-primary"
                                />
                                <span>Teams-Besprechung automatisch erstellen<span className="mt-1 block text-xs text-muted-foreground">Der Beitrittslink wird in die Kunden-E-Mail und den Kalenderanhang übernommen.</span></span>
                            </label>
                        ) : (
                            <p className="text-xs text-muted-foreground">Für diese Person ist kein Teams-Kalender verbunden. Du kannst einen vorhandenen Meeting-Link einfügen.</p>
                        )}
                        <div className="grid gap-1.5">
                            <Label>Interne Notizen</Label>
                            <Textarea rows={2} value={form.notes || ''} placeholder="z. B. Teams-Beratung / vor Ort / telefonischer Rückruf" onChange={(e) => changeForm((f) => ({ ...f, notes: e.target.value }))} />
                            <p className="text-xs text-muted-foreground">Diese Notizen bleiben intern und werden nicht an den Kunden geschickt.</p>
                        </div>
                        {conflicts.length > 0 && (
                            <div role="alert" className="rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                                <p className="font-semibold">Terminüberschneidung erkannt</p>
                                <p className="mt-1 text-xs opacity-80">Für diese zuständige Person liegen bereits folgende aktive Termine im Zeitraum:</p>
                                <ul className="mt-2 space-y-1 text-xs">
                                    {conflicts.map((item) => <li key={item.id}>• {timeOf(item.start_at)}–{timeOf(item.end_at)} · {item.customer_name || item.title}</li>)}
                                </ul>
                                <label className="mt-3 flex cursor-pointer items-center gap-2 font-medium">
                                    <input type="checkbox" checked={conflictConfirmed} onChange={(event) => setConflictConfirmed(event.target.checked)} className="size-4 accent-primary" />
                                    Trotzdem bewusst speichern
                                </label>
                            </div>
                        )}
                        <label className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2.5 text-sm">
                            <input type="checkbox" checked={!!form.sendInvite} onChange={(e) => changeForm((f) => ({ ...f, sendInvite: e.target.checked }))} className="size-4 accent-primary" />
                            <Mail className="size-4 text-muted-foreground" />
                            {editingId ? 'Neue Einladung per E-Mail senden' : 'Einladung per E-Mail an den Kunden senden'}
                        </label>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={closeForm} disabled={saving}>Abbrechen</Button>
                        <Button onClick={submitForm} disabled={saving}>
                            {saving ? <Loader2 className="size-4 animate-spin" /> : (editingId ? <Check className="size-4" /> : <Plus className="size-4" />)}
                            {editingId ? 'Speichern' : 'Anlegen'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Detail Modal */}
            <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
                <DialogContent className="overflow-hidden sm:max-w-[520px]">
                    {detail && (() => {
                        const tm = TYPE_META[detail.type] || TYPE_META.other;
                        const sm = STATUS_META[detail.status] || STATUS_META.proposed;
                        return (
                            <>
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2">
                                        <span className={['rounded border px-1.5 py-0.5 text-[11px]', tm.chip].join(' ')}>{tm.label}</span>
                                        {detail.customer_name || detail.title}
                                    </DialogTitle>
                                    <DialogDescription>
                                        <span className={['mr-2 rounded-full border px-2 py-0.5 text-[10px] font-medium', sm.cls].join(' ')}>{sm.label}</span>
                                        {detail.invite_sent_at && <span className="text-xs text-muted-foreground">Einladung verschickt</span>}
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-2 text-sm">
                                    <Row icon={<Clock className="size-4" />} text={`${dayKeyOf(detail.start_at).split('-').reverse().join('.')} · ${timeOf(detail.start_at)}–${timeOf(detail.end_at)} (${detail.duration_minutes} Min.)`} />
                                    {detail.assignee_name && <Row icon={<User className="size-4" />} text={`Zuständig: ${detail.assignee_name}`} />}
                                    {detail.customer_email && <Row icon={<Mail className="size-4" />} text={detail.customer_email} />}
                                    {detail.customer_phone && <Row icon={<Phone className="size-4" />} text={detail.customer_phone} />}
                                    {safeMeetingUrl(detail.meeting_link || undefined) && (
                                        <a
                                            href={safeMeetingUrl(detail.meeting_link || undefined)}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 font-medium text-primary transition-colors hover:bg-muted"
                                        >
                                            <Video className="size-4 shrink-0" />
                                            <span className="min-w-0 truncate">Teams-Besprechung öffnen</span>
                                            <ExternalLink className="ml-auto size-3.5 shrink-0" />
                                        </a>
                                    )}
                                    {!detail.meeting_link && detail.location && <Row icon={<MapPin className="size-4" />} text={detail.location} />}
                                    {detail.notes && <div className="break-words [overflow-wrap:anywhere] rounded-lg border bg-muted/30 p-2.5 text-sm text-muted-foreground">{detail.notes}</div>}
                                    {detail.website_booking && <WebsiteBookingStatus appointment={detail} />}
                                    {!detail.website_booking && (detail.teams_meeting?.requested || detail.external_calendar_user || detail.source === 'microsoft' || detail.meeting_link || detail.customer_email) && (
                                        <OfficeFlow appointment={detail} />
                                    )}
                                </div>
                                {detail.status !== 'cancelled' && (
                                    <div className="grid grid-cols-1 gap-2 border-t pt-4 sm:grid-cols-2">
                                        <Button size="sm" variant="outline" className="w-full" onClick={() => openEdit(detail)}><RotateCcw className="size-4" /> Verschieben/Bearbeiten</Button>
                                        {detail.customer_email && <Button size="sm" variant="outline" className="w-full" onClick={() => resend(detail)}><Mail className="size-4" /> Erneut einladen</Button>}
                                        {!detail.customer_email && detail.teams_meeting?.state === 'failed' && <Button size="sm" variant="outline" className="w-full" onClick={() => resend(detail)}><Video className="size-4" /> Teams synchronisieren</Button>}
                                        <Button size="sm" variant="destructive" className="w-full sm:col-span-2" onClick={() => doCancel(detail)}><CalendarX className="size-4" /> Termin absagen</Button>
                                    </div>
                                )}
                            </>
                        );
                    })()}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function Row({ icon, text }: { icon: ReactNode; text: string }) {
    return (
        <div className="flex min-w-0 items-start gap-2 overflow-hidden text-sm">
            <span className="shrink-0 text-muted-foreground">{icon}</span>
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{text}</span>
        </div>
    );
}

function OfficeFlow({ appointment }: { appointment: Appointment }) {
    const inviteToLead = Boolean(
        appointment.invite_sent_at
        && appointment.invite_delivery_mode === 'live'
        && appointment.invite_recipient?.toLowerCase() === appointment.customer_email?.toLowerCase(),
    );
    const cancellationToLead = Boolean(
        appointment.cancellation_email_sent_at
        && appointment.cancellation_delivery_mode === 'live'
        && appointment.cancellation_email_recipient?.toLowerCase() === appointment.customer_email?.toLowerCase(),
    );
    const microsoftManagedInvite = Boolean(
        appointment.source === 'microsoft_graph'
        && appointment.external_calendar_user
        && appointment.customer_email,
    );
    const inviteLabel = inviteToLead
        ? 'Einladung an Lead versendet'
        : microsoftManagedInvite
            ? 'Einladung in Microsoft 365 vorhanden'
        : appointment.invite_sent_at
            ? appointment.invite_delivery_mode === 'test' ? 'Einladung nur intern getestet' : 'Einladung an Kunden versendet'
            : appointment.invite_email_error ? 'Einladung nicht versendet' : 'Noch keine Einladung versendet';
    const cancellationLabel = cancellationToLead
        ? 'Absage an Lead versendet'
        : appointment.cancellation_email_sent_at
            ? appointment.cancellation_delivery_mode === 'test' ? 'Absage nur intern getestet' : 'Absageversand protokolliert'
            : appointment.status === 'cancelled' ? 'Absage-E-Mail nicht versendet' : null;
    const steps = [
        { label: 'Kalender synchron', active: appointment.teams_meeting?.state === 'ready' || !!(appointment.external_calendar_user || appointment.source === 'microsoft_graph') },
        { label: 'Teams bereit', active: !!appointment.meeting_link },
        { label: inviteLabel, active: inviteToLead || microsoftManagedInvite || Boolean(appointment.invite_sent_at && appointment.invite_delivery_mode !== 'test') },
        ...(cancellationLabel ? [{ label: cancellationLabel, active: cancellationToLead }] : []),
    ];
    return (
        <div className="rounded-lg border bg-muted/20 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <Workflow className="size-4 text-primary" /> Microsoft 365 Flow
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
                {steps.map((step) => (
                    <div key={step.label} className="flex min-w-0 items-center gap-2 text-xs">
                        <span className={cn('size-2 shrink-0 rounded-full', step.active ? 'bg-emerald-400' : 'bg-muted-foreground/35')} />
                        <span className="min-w-0 break-words leading-tight">{step.label}</span>
                    </div>
                ))}
            </div>
            {(appointment.invite_email_error || appointment.cancellation_email_error) && (
                <p className="mt-2 border-t pt-2 text-[11px] leading-4 text-amber-500">
                    {appointment.cancellation_email_error || appointment.invite_email_error}
                </p>
            )}
            {appointment.teams_meeting?.state === 'failed' && appointment.teams_meeting.error && (
                <p className="mt-2 border-t pt-2 text-[11px] leading-4 text-amber-500">
                    Teams-Synchronisierung fehlgeschlagen: {appointment.teams_meeting.error}
                </p>
            )}
        </div>
    );
}
