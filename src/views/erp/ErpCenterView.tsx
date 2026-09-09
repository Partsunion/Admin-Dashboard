import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
    AlertTriangle,
    ArrowUpRight,
    Boxes,
    Building2,
    CheckCircle2,
    CircleDollarSign,
    Clock3,
    PackageCheck,
    RefreshCw,
    ShoppingCart,
    Truck,
    Users,
    Warehouse,
    type LucideIcon,
} from 'lucide-react';
import { useOrders } from '@/hooks/useOrders';
import { useTenants } from '@/hooks/useTenants';
import { TenantOperations } from '@/views/tenants/TenantOperations';
import { orderStatusBadge, orderStatusLabel } from '@/lib/orderStatus';
import { formatRelative } from '@/utils/format/date';
import { SEITEN_RAND, HAUPT_AKTION, NEBEN_AKTION } from '@/components/ui/seite';
import { SEITEN_TITEL } from '@/components/ui/dichte';
import { cn } from '@/lib/utils';
import { erpOrderSummary, erpTenantSummary, recentOperationalOrders } from './erpMetrics';

const workflow = [
    { status: 'new' as const, label: 'Neu eingegangen', tone: 'bg-accent-500' },
    { status: 'in_progress' as const, label: 'In Bearbeitung', tone: 'bg-info' },
    { status: 'awaiting_parts' as const, label: 'Wartet auf Teile', tone: 'bg-warning' },
    { status: 'ready' as const, label: 'Bereit zur Übergabe', tone: 'bg-success' },
];

function SourceState({ loading, error, label }: { loading: boolean; error: unknown; label: string }): JSX.Element {
    return <span className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.09em]',
        loading ? 'border-border bg-elevated text-text-muted' : error
            ? 'border-danger/20 bg-danger/[0.06] text-danger'
            : 'border-success/20 bg-success/[0.06] text-success',
    )}>
        <span className={cn('size-1.5 rounded-full', loading ? 'bg-text-muted' : error ? 'bg-danger' : 'bg-success')} />
        {label} · {loading ? 'lädt' : error ? 'gestört' : 'bereit'}
    </span>;
}

function Signal({
    label,
    value,
    detail,
    icon: Icon,
    color,
}: {
    label: string;
    value: string | number;
    detail: string;
    icon: LucideIcon;
    color: string;
}): JSX.Element {
    return <div className="admin-signal-cell grid min-h-[84px] grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3.5" style={{ '--signal-color': color } as React.CSSProperties}>
        <span className="flex size-9 items-center justify-center rounded-md bg-elevated text-text-secondary"><Icon size={17} /></span>
        <span className="min-w-0">
            <span className="flex items-baseline justify-between gap-2"><span className="truncate text-xs font-semibold text-text-secondary">{label}</span><strong className="font-display text-[1.45rem] leading-none tabular-nums text-text-primary">{value}</strong></span>
            <span className="mt-1.5 block truncate text-[11px] text-text-muted">{detail}</span>
        </span>
    </div>;
}

function ModuleLink({ to, icon: Icon, title, detail, tone }: { to: string; icon: LucideIcon; title: string; detail: string; tone: string }): JSX.Element {
    return <Link to={to} className="group flex min-w-0 items-center gap-3 border-b border-border px-4 py-3.5 transition-colors last:border-b-0 hover:bg-elevated/70">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-md', tone)}><Icon size={17} /></span>
        <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{title}</strong><span className="mt-0.5 block truncate text-xs text-text-muted">{detail}</span></span>
        <ArrowUpRight size={15} className="shrink-0 text-text-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-text-primary" />
    </Link>;
}

export default function ErpCenterView(): JSX.Element {
    const ordersQuery = useOrders();
    const tenantsQuery = useTenants();
    const [searchParams, setSearchParams] = useSearchParams();
    const selectedTenant = searchParams.get('tenant') ?? '';
    const ordersKnown = !ordersQuery.isLoading && !ordersQuery.error;
    const tenantsKnown = !tenantsQuery.isLoading && !tenantsQuery.error;
    const orderSummary = useMemo(() => erpOrderSummary(ordersQuery.orders), [ordersQuery.orders]);
    const tenantSummary = useMemo(() => erpTenantSummary(tenantsQuery.tenants), [tenantsQuery.tenants]);
    const recentOrders = useMemo(() => recentOperationalOrders(ordersQuery.orders), [ordersQuery.orders]);
    const tenantNames = useMemo(() => new Map(tenantsQuery.tenants.map((tenant) => [String(tenant.id), tenant.name])), [tenantsQuery.tenants]);
    const maxWorkflow = Math.max(1, ...workflow.map((item) => orderSummary.byStatus[item.status]));
    const selectedExists = tenantsQuery.tenants.some((tenant) => String(tenant.id) === selectedTenant);

    function selectTenant(value: string): void {
        const next = new URLSearchParams(searchParams);
        if (value) next.set('tenant', value);
        else next.delete('tenant');
        setSearchParams(next, { replace: true });
    }

    const attention = [
        ...(ordersKnown && orderSummary.olderThan48Hours > 0 ? [{
            tone: 'danger',
            title: `${orderSummary.olderThan48Hours} offene Vorgänge älter als 48 Stunden`,
            detail: 'Bearbeitungsstand und Zuständigkeit prüfen',
            to: '/orders',
        }] : []),
        ...(ordersKnown && orderSummary.awaitingParts > 0 ? [{
            tone: 'warning',
            title: `${orderSummary.awaitingParts} Bestellungen warten auf Teile`,
            detail: 'Beschaffung oder Alternativteil klären',
            to: '/orders',
        }] : []),
        ...(tenantsKnown && tenantSummary.paymentAttention > 0 ? [{
            tone: 'danger',
            title: `${tenantSummary.paymentAttention} Händler mit Zahlungsbedarf`,
            detail: 'Forderungen und Plattformstatus prüfen',
            to: '/tenants',
        }] : []),
        ...(tenantsKnown && tenantSummary.onboardingOpen > 0 ? [{
            tone: 'info',
            title: `${tenantSummary.onboardingOpen} ERP-Einrichtungen noch offen`,
            detail: 'Stammdaten, Import und Übergabe abschließen',
            to: '/onboarding',
        }] : []),
    ];

    return <div className={cn(SEITEN_RAND, 'admin-erp-workspace')}>
        <section className="admin-page-intro mb-4 px-5 py-5 md:px-6">
            <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent-500">Operations / ERP</span>
                        <span className="h-3 w-px bg-border" />
                        <span className="text-xs font-medium text-text-muted">Plattformweiter Arbeitsbereich</span>
                    </div>
                    <h1 className={cn('font-display font-bold leading-tight tracking-[-0.035em]', SEITEN_TITEL)}>ERP & Warenwirtschaft</h1>
                    <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-secondary">Auftragsfluss steuern, betriebliche Engpässe erkennen und anschließend direkt in die Warenwirtschaft des jeweiligen Händlers wechseln.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={NEBEN_AKTION} disabled={ordersQuery.isLoading || tenantsQuery.isLoading} onClick={() => { ordersQuery.refetch(); tenantsQuery.refetch(); }}><RefreshCw size={15} className={(ordersQuery.isLoading || tenantsQuery.isLoading) ? 'animate-spin' : ''} />Daten aktualisieren</button>
                    <Link to="/orders" className={HAUPT_AKTION}>Aufträge bearbeiten<ArrowUpRight size={15} /></Link>
                </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                <SourceState loading={ordersQuery.isLoading} error={ordersQuery.error} label="Aufträge" />
                <SourceState loading={tenantsQuery.isLoading} error={tenantsQuery.error} label="Händler" />
                <span className="ml-auto hidden items-center gap-1.5 text-xs text-text-muted sm:inline-flex"><Clock3 size={13} />Keine Werte aus Fehlerzuständen abgeleitet</span>
            </div>
        </section>

        {Boolean(ordersQuery.error || tenantsQuery.error) && <div role="alert" className="mb-4 flex items-start gap-3 border border-warning/25 bg-warning/[0.06] px-4 py-3 text-sm text-text-secondary"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" /><span>Mindestens eine Betriebsquelle ist nicht erreichbar. Betroffene Kennzahlen werden als „—“ angezeigt und nicht als Null interpretiert.</span></div>}

        <section aria-label="ERP-Kennzahlen" className="admin-signal-rail mb-5 grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
            <Signal label="Offene Aufträge" value={ordersKnown ? orderSummary.open : '—'} detail={ordersKnown ? `${orderSummary.total} Aufträge insgesamt` : 'Auftragsquelle nicht verfügbar'} icon={ShoppingCart} color="hsl(var(--accent-500))" />
            <Signal label="Wartet auf Teile" value={ordersKnown ? orderSummary.awaitingParts : '—'} detail="Beschaffung und Alternativen" icon={Truck} color="hsl(var(--warning))" />
            <Signal label="Übergabebereit" value={ordersKnown ? orderSummary.ready : '—'} detail={ordersKnown ? `${orderSummary.completed} bereits erledigt` : 'Auftragsquelle nicht verfügbar'} icon={PackageCheck} color="hsl(var(--success))" />
            <Signal label="Aktive Händler" value={tenantsKnown ? tenantSummary.active : '—'} detail={tenantsKnown ? `${tenantSummary.users} Nutzerkonten angebunden` : 'Händlerquelle nicht verfügbar'} icon={Building2} color="hsl(var(--info))" />
        </section>

        <div className="mb-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
            <section className="admin-work-panel admin-erp-flow overflow-hidden" aria-labelledby="erp-flow-title">
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
                    <div><h2 id="erp-flow-title" className="font-display text-base font-bold">Auftragsfluss</h2><p className="mt-1 text-xs text-text-muted">Aktueller Bestand je operativer Phase</p></div>
                    <Link to="/orders" className="inline-flex items-center gap-1 text-xs font-bold text-accent-500 hover:underline">Vollständige Liste<ArrowUpRight size={13} /></Link>
                </header>
                <div className="space-y-4 px-5 py-5">
                    {workflow.map((item) => {
                        const count = orderSummary.byStatus[item.status];
                        const width = ordersKnown ? Math.max(count > 0 ? 5 : 0, (count / maxWorkflow) * 100) : 0;
                        return <div key={item.status} className="grid grid-cols-[minmax(116px,0.7fr)_minmax(120px,1.8fr)_40px] items-center gap-3">
                            <span className="truncate text-xs font-semibold text-text-secondary">{item.label}</span>
                            <span className="h-2 overflow-hidden rounded-sm bg-elevated"><span className={cn('block h-full rounded-sm transition-[width] duration-300', item.tone)} style={{ width: `${width}%` }} /></span>
                            <strong className="text-right font-mono text-sm tabular-nums">{ordersKnown ? count : '—'}</strong>
                        </div>;
                    })}
                </div>
                <div className="grid border-t border-border sm:grid-cols-2 sm:divide-x sm:divide-border">
                    <ModuleLink to="/orders" icon={ShoppingCart} title="Bestellsteuerung" detail="Status, Kunde, Teil und OEM" tone="bg-accent-500/10 text-accent-500" />
                    <ModuleLink to="/tenants" icon={CircleDollarSign} title="Forderungen & Verträge" detail="Je Händler in der Betriebsakte" tone="bg-danger/10 text-danger" />
                    <ModuleLink to="/tenants" icon={Warehouse} title="Lager & Bestand" detail="Bestände und Mindestmengen prüfen" tone="bg-warning/10 text-warning" />
                    <ModuleLink to="/tenants" icon={Truck} title="Einkauf & Beschaffung" detail="Offene und überfällige Beschaffung" tone="bg-info/10 text-info" />
                </div>
            </section>

            <section className="admin-work-panel admin-erp-attention overflow-hidden" aria-labelledby="erp-attention-title">
                <header className="border-b border-border px-5 py-4"><h2 id="erp-attention-title" className="font-display text-base font-bold">Handlungsbedarf</h2><p className="mt-1 text-xs text-text-muted">Systemisch priorisierte Betriebsfälle</p></header>
                {!ordersKnown || !tenantsKnown ? <p className="px-5 py-6 text-sm text-text-muted">Handlungsbedarf wird angezeigt, sobald alle benötigten Quellen geladen sind.</p> : attention.length === 0 ? <div className="flex items-start gap-3 px-5 py-6"><span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-success/10 text-success"><CheckCircle2 size={18} /></span><span><strong className="block text-sm">Keine akuten Betriebsfälle</strong><span className="mt-1 block text-xs leading-relaxed text-text-muted">In den verfügbaren Auftrags- und Händlerdaten wurde kein unmittelbarer Handlungsbedarf gefunden.</span></span></div> : <ul className="divide-y divide-border">{attention.map((item) => <li key={item.title}><Link to={item.to} className="group flex items-start gap-3 px-5 py-4 transition-colors hover:bg-elevated/60"><span className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.tone === 'danger' ? 'bg-danger' : item.tone === 'warning' ? 'bg-warning' : 'bg-info')} /><span className="min-w-0 flex-1"><strong className="block text-sm leading-snug">{item.title}</strong><span className="mt-1 block text-xs leading-relaxed text-text-muted">{item.detail}</span></span><ArrowUpRight size={14} className="mt-0.5 shrink-0 text-text-faint group-hover:text-text-primary" /></Link></li>)}</ul>}
            </section>
        </div>

        <section className="admin-work-panel admin-data-table mb-5 overflow-hidden" aria-labelledby="erp-orders-title">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4"><div><h2 id="erp-orders-title" className="font-display text-base font-bold">Zuletzt bearbeitete Aufträge</h2><p className="mt-1 text-xs text-text-muted">Nur aktuell operative Vorgänge</p></div><span className="font-mono text-xs text-text-muted">{ordersKnown ? `${recentOrders.length} angezeigt` : 'Quelle gestört'}</span></header>
            {!ordersKnown ? <p className="px-5 py-7 text-sm text-text-muted">Aufträge konnten nicht geladen werden.</p> : recentOrders.length === 0 ? <p className="px-5 py-7 text-sm text-text-muted">Keine offenen Aufträge vorhanden.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-elevated/55 text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted"><tr><th className="px-5 py-3">Auftrag</th><th className="px-4 py-3">Händler</th><th className="px-4 py-3">Teil / OEM</th><th className="px-4 py-3">Status</th><th className="px-5 py-3 text-right">Aktualisiert</th></tr></thead><tbody className="divide-y divide-border">{recentOrders.map((order) => <tr key={order.id} className="transition-colors hover:bg-elevated/50"><td className="px-5 py-3.5"><Link to="/orders" className="font-mono text-xs font-bold text-accent-500 hover:underline">{order.id.slice(0, 10)}</Link><span className="mt-1 block max-w-[180px] truncate text-xs text-text-muted">{order.customer_name || 'Kunde nicht hinterlegt'}</span></td><td className="px-4 py-3.5"><Link to={`/tenants/${encodeURIComponent(order.merchant_id)}`} className="font-medium hover:text-accent-500 hover:underline">{tenantNames.get(String(order.merchant_id)) || order.merchant_id}</Link></td><td className="max-w-[260px] px-4 py-3.5"><span className="block truncate font-medium">{order.requested_part_name || 'Teil nicht hinterlegt'}</span>{order.oem_number && <span className="mt-1 block font-mono text-[11px] text-text-muted">OE {order.oem_number}</span>}</td><td className="px-4 py-3.5"><span className={cn('inline-flex rounded px-2 py-1 text-xs font-semibold', orderStatusBadge(order.status))}>{orderStatusLabel(order.status)}</span></td><td className="px-5 py-3.5 text-right text-xs text-text-muted">{formatRelative(order.updated_at)}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="admin-work-panel admin-erp-selector overflow-hidden" aria-labelledby="merchant-erp-title">
            <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
                <div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-500/10 text-accent-500"><Boxes size={20} /></span><div><h2 id="merchant-erp-title" className="font-display text-base font-bold">Händler-Warenwirtschaft</h2><p className="mt-1 text-xs text-text-muted">Lager, Rechnungen, Einkauf und Aufträge eines Betriebs</p></div></div>
                <label className="flex min-w-[260px] flex-col gap-1.5 text-xs font-semibold text-text-secondary"><span>Händler auswählen</span><select value={selectedExists ? selectedTenant : ''} onChange={(event) => selectTenant(event.target.value)} className="h-10 rounded-md border border-border-strong bg-surface px-3 text-sm font-medium text-text-primary focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"><option value="">Betrieb auswählen…</option>{tenantsQuery.tenants.map((tenant) => <option key={String(tenant.id)} value={String(tenant.id)}>{tenant.name}</option>)}</select></label>
            </header>
            {!tenantsKnown ? <p className="px-5 py-8 text-sm text-text-muted">Händlerdaten stehen derzeit nicht zur Verfügung.</p> : selectedExists ? <div className="p-5"><TenantOperations tenantId={selectedTenant} /></div> : <div className="grid gap-0 md:grid-cols-[1fr_1.2fr] md:divide-x md:divide-border"><div className="flex items-start gap-3 px-5 py-7"><span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-info/10 text-info"><Building2 size={19} /></span><div><strong className="block text-sm">Betrieb oben auswählen</strong><p className="mt-1 max-w-md text-xs leading-relaxed text-text-muted">Danach erscheinen reale Warenwirtschaftsdaten dieses Händlers – inklusive offener Forderungen, Mindestbestände und Beschaffung.</p></div></div><dl className="grid grid-cols-2 gap-x-5 gap-y-4 bg-elevated/35 px-5 py-6"><div><dt className="text-xs text-text-muted">Händler gesamt</dt><dd className="mt-1 font-display text-xl font-bold tabular-nums">{tenantSummary.total}</dd></div><div><dt className="text-xs text-text-muted">Nutzerkonten</dt><dd className="mt-1 font-display text-xl font-bold tabular-nums">{tenantSummary.users}</dd></div><div><dt className="text-xs text-text-muted">Einrichtung offen</dt><dd className="mt-1 font-display text-xl font-bold tabular-nums text-info">{tenantSummary.onboardingOpen}</dd></div><div><dt className="text-xs text-text-muted">Zahlungsbedarf</dt><dd className="mt-1 font-display text-xl font-bold tabular-nums text-danger">{tenantSummary.paymentAttention}</dd></div></dl></div>}
        </section>

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted"><span className="inline-flex items-center gap-1.5"><Users size={13} />Zentrale Steuerung mit Drill-down je Händler</span><Link to="/tenants" className="font-semibold text-accent-500 hover:underline">Händlerakten öffnen</Link></footer>
    </div>;
}
