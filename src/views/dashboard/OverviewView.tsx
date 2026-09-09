import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    Activity,
    ArrowUpRight,
    Boxes,
    Building2,
    CalendarDays,
    KeyRound,
    Mail,
    Megaphone,
    RefreshCw,
} from 'lucide-react';
import { listAppointments } from '@/api/appointments';
import { getOnboardingPipeline } from '@/api/onboarding';
import { getAccessRequestHistory } from '@/api/accessRequests';
import { useDashboardMetrics } from '@/hooks/useDashboardMetrics';
import { useSystemHealth } from '@/hooks/useSystemHealth';
import { useAuditLogs } from '@/hooks/useAuditLogs';
import { useMailboxes } from '@/hooks/useInbox';
import { zaehleUngeleseneMails } from '@/hooks/useOffeneSachen';
import { usePermissions } from '@/auth/usePermissions';
import { SEITEN_RAND, SeitenKopf, HAUPT_AKTION, NEBEN_AKTION } from '@/components/ui/seite';
import { RankingTable } from '@/components/ranking/RankingTable';
import { auditZeile } from '@/utils/auditLabels';
import { formatRelative } from '@/utils/format/date';
import { formatCurrency } from '@/utils/format/number';
import { terminfenster } from './terminfenster';
import { merchantNextStep, merchantQueue, nextAppointments } from './operationsQueue';

const textLink = 'inline-flex items-center gap-1 text-sm font-semibold text-accent-500 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500';
const sectionPanel = 'admin-work-panel min-w-0 overflow-hidden';
const sectionHeader = 'flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4';

/** Keep return-to-dashboard timing without tying first paint to a data request. */
function measureReturn(): void {
    const marks = performance.getEntriesByName('dashboard-klick', 'mark');
    if (!marks.length) return;
    const duration = Math.round(performance.now() - marks[marks.length - 1].startTime);
    performance.clearMarks('dashboard-klick');
    performance.clearMarks('dashboard-klick-handler');
    if (duration < 60_000) console.warn(`[Messung] Mail → Dashboard: ${duration} ms`);
}

function DataMessage({ children, retry, alert = false }: { children: ReactNode; retry?: () => void; alert?: boolean }): JSX.Element {
    return <div role={alert ? 'alert' : 'status'} className="flex flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-text-secondary">
        <span>{children}</span>{retry && <button type="button" onClick={retry} className={textLink}>Erneut laden</button>}
    </div>;
}

function PanelTitle({ id, icon, tone, children }: { id: string; icon: ReactNode; tone: string; children: ReactNode }): JSX.Element {
    return <div className="flex items-center gap-2.5"><span className={`admin-panel-icon flex size-8 items-center justify-center ${tone}`}>{icon}</span><h2 id={id} className="text-[15px] font-bold">{children}</h2></div>;
}

export default function OverviewView(): JSX.Element {
    const [now, setNow] = useState(() => Date.now());
    const [rankingRevision, setRankingRevision] = useState(0);
    useEffect(() => {
        const frame = requestAnimationFrame(measureReturn);
        const minute = setInterval(() => setNow(Date.now()), 60_000);
        return () => { cancelAnimationFrame(frame); clearInterval(minute); };
    }, []);
    const { can } = usePermissions();
    const pipeline = useQuery({ queryKey: ['admin', 'onboarding-pipeline'], queryFn: getOnboardingPipeline, staleTime: 30_000 });
    const appointments = useQuery({ queryKey: ['admin', 'appointments', 'uebersicht'], queryFn: () => listAppointments(terminfenster()), staleTime: 60_000, retry: false });
    const access = useQuery({ queryKey: ['admin', 'access-requests', 'verlauf'], queryFn: () => getAccessRequestHistory(), staleTime: 60_000 });
    const metrics = useDashboardMetrics();
    const health = useSystemHealth();
    const audit = useAuditLogs();
    const mailbox = useMailboxes();
    const attention = merchantQueue(pipeline.data?.tenants ?? []);
    const failedAccess = (access.data ?? []).filter(request => request.status === 'failed');
    const upcoming = nextAppointments(appointments.data?.appointments ?? [], now).slice(0, 4);
    const unread = mailbox.isLoading || mailbox.error ? null : zaehleUngeleseneMails(mailbox.mailboxes);
    const refreshing = pipeline.isFetching || appointments.isFetching || access.isFetching;
    const refresh = (): void => {
        setRankingRevision(value => value + 1);
        void pipeline.refetch(); void appointments.refetch(); void access.refetch();
        metrics.refetch(); health.refetch(); audit.refetch(); mailbox.refetch();
    };
    const facts = [
        { label: 'Händler', detail: 'auf der Plattform', value: metrics.metrics?.activeTenants, to: '/tenants' },
        { label: 'Nutzerkonten', detail: 'über alle Händler', value: metrics.metrics?.totalUsers, to: '/tenants' },
        { label: 'Bestellungen heute', detail: 'aktueller Auftragseingang', value: metrics.metrics?.ordersToday, to: '/orders' },
        { label: 'Monatsumsatz', detail: 'laufender Monat', value: metrics.metrics?.revenueMtd == null ? null : formatCurrency(metrics.metrics.revenueMtd), to: '/orders' },
    ];

    const serviceReady = !health.isLoading && !health.error && Boolean(health.zustand?.erreichbar);

    return <div className={SEITEN_RAND + ' admin-overview'}>
        <section className="admin-page-intro mb-4 px-5 py-5 md:px-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent-500">Admin Operations / Heute</span>
                <span className={`inline-flex items-center gap-2 text-xs font-semibold ${serviceReady ? 'text-success' : 'text-warning'}`}><span className={`size-1.5 rounded-full ${serviceReady ? 'bg-success' : 'bg-warning'}`} />{health.isLoading ? 'API wird geprüft' : serviceReady ? 'API erreichbar' : 'API-Status prüfen'}</span>
            </div>
            <SeitenKopf titel="Arbeitsübersicht" beileile="Die wichtigen Betriebsfälle zuerst: Händlerstart, Kommunikation, Aufträge und Plattformzustand."
                aktionen={<><button type="button" className={NEBEN_AKTION} disabled={refreshing} onClick={refresh}><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />Aktualisieren</button>{can('tenants.create') && <Link to="/tenants/new" className={HAUPT_AKTION}>Händler einrichten</Link>}</>} />
        </section>

        <section aria-label="Plattformzahlen" className="admin-facts-line">
            {facts.map(fact => <Link key={fact.label} to={fact.to} title={fact.detail}><span>{fact.label}</span><strong>{metrics.isLoading ? '—' : fact.value ?? '—'}</strong></Link>)}
        </section>

        <RankingTable refreshKey={rankingRevision} />

        <nav aria-label="Schnellzugriffe" className="admin-command-deck mb-5 grid overflow-hidden sm:grid-cols-2 lg:grid-cols-4">
            <Link to="/erp" className="admin-command-link group flex items-center gap-3"><span className="admin-command-icon text-warning"><Boxes size={16} /></span><span className="min-w-0 flex-1"><strong className="block text-xs">ERP steuern</strong><span className="block truncate text-[11px] text-text-muted">Lager, Einkauf, Forderungen</span></span><ArrowUpRight size={13} className="text-text-faint group-hover:text-warning" /></Link>
            <Link to="/mail" className="admin-command-link group flex items-center gap-3"><span className="admin-command-icon text-info"><Mail size={16} /></span><span className="min-w-0 flex-1"><strong className="block text-xs">Postfach öffnen</strong><span className="block truncate text-[11px] text-text-muted">Antworten und zuordnen</span></span><ArrowUpRight size={13} className="text-text-faint group-hover:text-info" /></Link>
            <Link to="/marketing" className="admin-command-link group flex items-center gap-3"><span className="admin-command-icon text-danger"><Megaphone size={16} /></span><span className="min-w-0 flex-1"><strong className="block text-xs">Marketing & Ads</strong><span className="block truncate text-[11px] text-text-muted">Google, Meta, Website</span></span><ArrowUpRight size={13} className="text-text-faint group-hover:text-danger" /></Link>
            <Link to="/onboarding" className="admin-command-link group flex items-center gap-3"><span className="admin-command-icon text-success"><Building2 size={16} /></span><span className="min-w-0 flex-1"><strong className="block text-xs">Händlerstart</strong><span className="block truncate text-[11px] text-text-muted">Einrichtung und Freigabe</span></span><ArrowUpRight size={13} className="text-text-faint group-hover:text-success" /></Link>
        </nav>

        {metrics.error ? <p role="alert" className="mb-5 text-sm text-warning">Plattformzahlen konnten nicht aktualisiert werden. Angezeigte Werte können veraltet sein. <button type="button" onClick={metrics.refetch} className={textLink}>Erneut laden</button></p> : !metrics.isLoading && facts.some(fact => fact.value == null) && <p className="mb-5 text-xs text-text-muted">Nicht verfügbare Kennzahlen werden als „—“ angezeigt.</p>}

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]">
            <div className="min-w-0 space-y-5">
            <section aria-labelledby="merchant-work-title" className={sectionPanel}>
                <header className={sectionHeader}><div className="flex items-center gap-2"><PanelTitle id="merchant-work-title" icon={<Building2 size={16} />} tone="bg-success/10 text-success">Händler in Bearbeitung</PanelTitle>{pipeline.data && <span className="rounded-full border border-border bg-elevated px-2 py-0.5 text-xs font-semibold tabular-nums text-text-secondary">{attention.length}</span>}</div><Link to="/onboarding" className={textLink}>Alle Einrichtungen<ArrowUpRight size={14} /></Link></header>
                {pipeline.isLoading ? <DataMessage>Einrichtungen werden geladen…</DataMessage> : pipeline.error ? <DataMessage alert retry={() => void pipeline.refetch()}>Einrichtungen konnten nicht aktualisiert werden. Der Bearbeitungsstand ist unbekannt.</DataMessage> : attention.length === 0 ? <DataMessage>Aktuell keine Händler in Einrichtung.</DataMessage> : <div>
                    <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_80px] gap-4 border-b border-border bg-elevated/50 px-5 py-2.5 text-xs font-semibold text-text-muted md:grid"><span>Händler</span><span>Nächster Schritt</span><span>Offen seit</span></div>
                    {attention.slice(0, 7).map(tenant => <Link key={tenant.tenantId} to={'/tenants/' + encodeURIComponent(tenant.tenantId) + '?tab=onboarding'} className="grid gap-2 border-b border-border px-5 py-4 transition-colors last:border-0 hover:bg-accent-500/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_80px] md:items-center md:gap-4">
                        <div className="flex min-w-0 items-center gap-3"><span className={`size-2.5 shrink-0 rounded-full ${tenant.risk === 'at-risk' ? 'bg-danger' : 'bg-success'}`} /><span className="min-w-0"><span className="block truncate font-semibold text-text-primary">{tenant.name}</span>{tenant.risk === 'at-risk' && <span className="mt-1 block text-xs font-medium text-danger">Betreuung erforderlich</span>}</span></div>
                        <span className="text-sm text-text-secondary">{merchantNextStep(tenant)}</span><span className="text-xs font-medium tabular-nums text-text-muted">{tenant.ageDays == null ? 'Unbekannt' : tenant.ageDays + ' Tage'}</span>
                    </Link>)}
                </div>}
                {pipeline.dataUpdatedAt > 0 && <p className="border-t border-border bg-elevated/30 px-5 py-2.5 text-xs text-text-muted">Datenstand {new Date(pipeline.dataUpdatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · Zuerst Betreuungsbedarf, dann älteste Einrichtung</p>}
            </section>
            <section aria-labelledby="activity-title" className={sectionPanel}>
                <header className={sectionHeader}><PanelTitle id="activity-title" icon={<Activity size={16} />} tone="bg-accent-500/[0.10] text-accent-500">Letzte Änderungen</PanelTitle>{can('audit.read') && <Link to="/einstellungen/audit" className={textLink}>Protokoll öffnen<ArrowUpRight size={14} /></Link>}</header>
                {audit.isLoading ? <DataMessage>Protokoll wird geladen…</DataMessage> : audit.error ? <DataMessage alert retry={audit.refetch}>Protokoll derzeit nicht verfügbar.</DataMessage> : !audit.entries.length ? <DataMessage>Keine Änderungen im aktuellen Abruf.</DataMessage> : <ul>{audit.entries.slice(0, 5).map(entry => <li key={entry.id} className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5 last:border-0"><span className="flex min-w-0 items-start gap-3"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent-500" /><span className="min-w-0 break-words text-sm"><strong>{entry.admin_username || 'System'}</strong> · {auditZeile(entry)}</span></span><time className="shrink-0 text-xs font-medium text-text-muted" dateTime={entry.created_at}>{entry.created_at ? formatRelative(entry.created_at) : 'Zeitpunkt unbekannt'}</time></li>)}</ul>}
            </section>
            </div>
            <div className="min-w-0 space-y-5">
                <section className={sectionPanel} aria-labelledby="communications-title">
                    <header className={sectionHeader}><PanelTitle id="communications-title" icon={<Mail size={16} />} tone="bg-info/10 text-info">Kommunikation</PanelTitle></header>
                    <Link to="/mail" className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-info/[0.04]"><span className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info"><Mail size={17} /></span><span><span className="block font-semibold">Posteingang</span><span className="mt-1 block text-xs text-text-muted">{mailbox.error ? 'Postfachstatus nicht verfügbar' : mailbox.isLoading ? 'Postfächer werden geladen…' : 'Ungelesene Nachrichten in deinen Postfächern'}</span></span></span><span className="rounded-xl bg-info/10 px-3 py-1.5 font-display text-xl font-bold tabular-nums text-info">{unread ?? '—'}</span></Link>
                    <Link to="/access-requests" className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 transition-colors hover:bg-warning/[0.04]"><span className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning"><KeyRound size={17} /></span><span><span className="block font-semibold">Zugangsanfragen</span><span className="mt-1 block text-xs text-text-muted">{access.error ? 'Versandstatus nicht verfügbar' : access.isLoading ? 'Versandstatus wird geladen…' : 'Fehlgeschlagene Zustellungen prüfen'}</span></span></span><span className={`rounded-xl px-3 py-1.5 font-display text-xl font-bold tabular-nums ${failedAccess.length ? 'bg-danger/10 text-danger' : 'bg-elevated text-text-secondary'}`}>{access.isLoading || access.error ? '—' : failedAccess.length}</span></Link>
                </section>

                <section className={sectionPanel} aria-labelledby="appointments-title">
                    <header className={sectionHeader}><PanelTitle id="appointments-title" icon={<CalendarDays size={16} />} tone="bg-warning/10 text-warning">Nächste Termine</PanelTitle><Link to="/calendar" className={textLink}>Kalender<ArrowUpRight size={14} /></Link></header>
                    {appointments.isLoading ? <DataMessage>Termine werden geladen…</DataMessage> : appointments.error ? <DataMessage alert retry={() => void appointments.refetch()}>Termine derzeit nicht verfügbar.</DataMessage> : !upcoming.length ? <DataMessage>Keine anstehenden Termine im aktuellen Zweiwochenfenster.</DataMessage> : <ul>{upcoming.map(appointment => <li key={appointment.id} className="border-b border-border last:border-0"><Link to="/calendar" className="flex gap-3 px-5 py-3.5 transition-colors hover:bg-warning/[0.04]"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 font-mono text-xs font-bold text-warning">{new Date(appointment.start_at).toLocaleDateString('de-DE', { day: '2-digit' })}</span><span className="min-w-0"><span className="text-xs font-medium tabular-nums text-text-muted">{new Date(appointment.start_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{appointment.status === 'proposed' ? ' · Bestätigung ausstehend' : ''}</span><span className="mt-1 block truncate font-semibold">{appointment.title || 'Termin'}</span><span className="mt-1 block truncate text-xs text-text-muted">{[appointment.customer_name, appointment.assignee_name].filter(Boolean).join(' · ') || 'Noch nicht zugeordnet'}</span></span></Link></li>)}</ul>}
                </section>
            </div>
        </div>

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted"><span>{health.isLoading ? 'API-Erreichbarkeit wird geprüft…' : health.error || !health.zustand ? 'API-Erreichbarkeit unbekannt' : health.zustand.erreichbar ? 'API erreichbar' : 'API nicht erreichbar'} · Keine Aussage über einzelne Dienste</span><button type="button" className="font-medium hover:text-text-primary hover:underline" onClick={health.refetch}>Erneut prüfen</button></footer>
    </div>;
}
