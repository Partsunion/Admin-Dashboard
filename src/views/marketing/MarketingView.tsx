import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Check,
    ChevronRight, CircleDollarSign, ExternalLink, Eye, Globe2, Loader2,
    Link2, MapPinned, Megaphone, MousePointerClick, Pause, Play, RefreshCw, Search,
    Settings2, Target, Unplug, Users,
} from 'lucide-react';
import { toast } from 'sonner';

import {
    disconnectMarketingConnection, getMarketingConnections, getMarketingOverview,
    selectMarketingAccount, startMarketingConnection, updateCampaignBudget, updateCampaignStatus,
    type MarketingCampaign, type MarketingConnection, type MarketingOAuthConnection, type MarketingPlatform,
} from '@/api/marketing';
import { parseError } from '@/api/client';
import { usePermissions } from '@/auth/usePermissions';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterPille, NEBEN_AKTION, SEITEN_RAND, SeitenKopf } from '@/components/ui/seite';
import { WORKSPACE_METRIC, WORKSPACE_METRIC_VALUE } from '@/components/ui/dichte';
import { cn } from '@/lib/utils';
import { allCampaigns, compactNumber, datePreset, money, percentChange, totalsByCurrency } from './marketingMetrics';

type CampaignFilter = 'all' | MarketingPlatform | 'active' | 'paused';
type PendingAction =
    | { kind: 'status'; campaign: MarketingCampaign; status: 'ACTIVE' | 'PAUSED' }
    | { kind: 'budget'; campaign: MarketingCampaign; dailyBudget: number };

const STATUS_ACTIVE = new Set(['ACTIVE', 'ENABLED']);
const PROVIDER_TONE = {
    plausible: { icon: 'bg-cyan-500/12 text-cyan-500', mark: 'Website' },
    google: { icon: 'bg-blue-500/12 text-blue-500', mark: 'Google' },
    meta: { icon: 'bg-violet-500/12 text-violet-500', mark: 'Meta' },
} as const;

function connectionLabel(connection: MarketingConnection): string {
    if (connection.state === 'connected') return 'Verbunden';
    if (connection.state === 'error') return 'Prüfung nötig';
    return 'Einrichtung offen';
}

function relativeGeneratedAt(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'gerade eben';
    return `Stand ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(date)}`;
}

function ChangeBadge({ current, previous }: { current: number; previous: number }) {
    const change = percentChange(current, previous);
    if (change === null) return <span className="text-xs text-text-muted">neu im Zeitraum</span>;
    const positive = change >= 0;
    return (
        <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', positive ? 'text-success' : 'text-danger')}>
            {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(change).toLocaleString('de-DE', { maximumFractionDigits: 1 })}%
            <span className="font-normal text-text-muted">zur Vorperiode</span>
        </span>
    );
}

function ConnectionCard({ connection, oauth, canManage, busy, onConnect, onSelect, onDisconnect }: {
    connection: MarketingConnection;
    oauth?: MarketingOAuthConnection;
    canManage: boolean;
    busy: boolean;
    onConnect: (provider: MarketingPlatform) => void;
    onSelect: (provider: MarketingPlatform, accountId: string) => void;
    onDisconnect: (provider: MarketingPlatform) => void;
}) {
    const tone = PROVIDER_TONE[connection.provider];
    const connected = connection.state === 'connected';
    const adsProvider = connection.provider === 'google' || connection.provider === 'meta' ? connection.provider : null;
    const needsSelection = Boolean(oauth?.connected && !oauth.selectedAccountId);
    return (
        <article className="min-w-0 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
                <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', tone.icon)}>
                    {connection.provider === 'plausible' ? <Globe2 size={17} /> : <Megaphone size={17} />}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-text-primary">{connection.label}</p>
                        <span className={cn(
                            'inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wide',
                            connected ? 'text-success' : connection.state === 'error' ? 'text-danger' : 'text-warning',
                        )}>
                            <span className={cn('size-1.5 rounded-full', connected ? 'bg-success' : connection.state === 'error' ? 'bg-danger' : 'bg-warning')} />
                            {needsSelection ? 'Konto wählen' : connectionLabel(connection)}
                        </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-text-secondary">{oauth?.selectedAccountName || connection.accountName || oauth?.authorizedIdentityName || tone.mark}</p>
                    {!connected && !oauth?.connected && <p className="mt-2 text-xs leading-relaxed text-text-muted">{connection.message}</p>}
                </div>
            </div>
            {adsProvider && <div className="mt-3 border-t border-border-subtle pt-3">
                {oauth?.connected && oauth.accounts.length > 0 && <label className="block text-[11px] font-semibold text-text-muted">Aktives Werbekonto
                    <select value={oauth.selectedAccountId || ''} onChange={(event) => onSelect(adsProvider, event.target.value)} disabled={!canManage || busy} className="mt-1.5 h-9 w-full rounded-md border border-border bg-canvas px-2.5 text-xs text-text-primary">
                        <option value="" disabled>Konto auswählen</option>
                        {oauth.accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.id}</option>)}
                    </select>
                </label>}
                <div className="mt-2 flex items-center gap-2">
                    <button type="button" disabled={!canManage || busy || oauth?.authAvailable === false} onClick={() => onConnect(adsProvider)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-semibold text-text-secondary hover:bg-elevated disabled:opacity-50"><Link2 size={13} />{oauth?.connected ? 'Neu anmelden' : 'Anmelden & verbinden'}</button>
                    {oauth?.connected && oauth.managedBy === 'oauth' && <button type="button" disabled={!canManage || busy} onClick={() => onDisconnect(adsProvider)} className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold text-danger hover:underline disabled:opacity-50"><Unplug size={13} />Trennen</button>}
                </div>
                {oauth?.managedBy === 'environment' && <p className="mt-2 text-[11px] text-text-muted">Serverseitige Altverbindung. Neu anmelden, um sie hier verwaltbar zu machen.</p>}
                {oauth && !oauth.authAvailable && <p className="mt-2 text-[11px] leading-relaxed text-warning">Serverkonfiguration fehlt: {oauth.missingConfiguration.join(', ')}</p>}
            </div>}
        </article>
    );
}

function MetricCard({ label, value, note, icon: Icon, tone = 'accent' }: { label: string; value: string; note?: React.ReactNode; icon: typeof Users; tone?: 'accent' | 'info' | 'success' | 'warning' }) {
    const tones = {
        accent: 'bg-accent-500/12 text-accent-500', info: 'bg-info/12 text-info',
        success: 'bg-success/12 text-success', warning: 'bg-warning/12 text-warning',
    };
    return (
        <article className={cn('karte grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3', WORKSPACE_METRIC)}>
            <span className={cn('flex size-8 items-center justify-center rounded-lg', tones[tone])}><Icon size={16} /></span>
            <div className="min-w-0"><p className="truncate text-xs font-semibold text-text-secondary">{label}</p>{note && <div className="mt-0.5 truncate text-[11px] text-text-muted">{note}</div>}</div>
            <p className={cn('max-w-[150px] truncate text-right font-display font-semibold tracking-tight text-text-primary', WORKSPACE_METRIC_VALUE)}>{value}</p>
        </article>
    );
}

function TrendChart({ points }: { points: Array<{ date: string; visitors: number; pageviews: number }> }) {
    if (!points.length) return <div className="flex h-48 items-center justify-center text-sm text-text-muted">Noch keine Verlaufsdaten im Zeitraum.</div>;
    const width = 900;
    const height = 230;
    const padding = 22;
    const max = Math.max(1, ...points.flatMap((point) => [point.visitors, point.pageviews]));
    const coordinates = (key: 'visitors' | 'pageviews') => points.map((point, index) => {
        const x = padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
        const y = height - padding - (point[key] / max) * (height - padding * 2);
        return `${x},${y}`;
    }).join(' ');
    const area = `${padding},${height - padding} ${coordinates('visitors')} ${width - padding},${height - padding}`;
    return (
        <div>
            <div className="mb-4 flex items-center gap-5 text-xs text-text-muted">
                <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-accent-500" />Besucher</span>
                <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-cyan-500" />Seitenaufrufe</span>
            </div>
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Verlauf von Besuchern und Seitenaufrufen" className="h-52 w-full overflow-visible">
                <defs>
                    <linearGradient id="marketing-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--accent-500))" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="hsl(var(--accent-500))" stopOpacity="0" />
                    </linearGradient>
                </defs>
                {[0.25, 0.5, 0.75, 1].map((position) => <line key={position} x1={padding} x2={width - padding} y1={height * position - 5} y2={height * position - 5} className="stroke-border" strokeDasharray="4 6" />)}
                <polygon points={area} fill="url(#marketing-area)" />
                <polyline points={coordinates('visitors')} fill="none" className="stroke-accent-500" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points={coordinates('pageviews')} fill="none" className="stroke-cyan-500" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="mt-1 flex justify-between text-[11px] text-text-muted">
                <span>{new Date(`${points[0].date}T00:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}</span>
                <span>{new Date(`${points[points.length - 1].date}T00:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}</span>
            </div>
        </div>
    );
}

function Ranking({ rows, valueLabel = 'Besucher' }: { rows: Array<{ label: string; visitors: number }>; valueLabel?: string }) {
    const max = Math.max(1, ...rows.map((row) => row.visitors));
    if (!rows.length) return <p className="py-8 text-center text-sm text-text-muted">Noch keine Daten.</p>;
    return (
        <div className="space-y-4">
            {rows.slice(0, 8).map((row, index) => (
                <div key={`${row.label}-${index}`} className="min-w-0">
                    <div className="mb-1.5 flex items-center justify-between gap-4 text-sm">
                        <span className="truncate font-medium text-text-secondary" title={row.label}>{row.label}</span>
                        <span className="shrink-0 font-mono text-xs font-semibold text-text-primary">{compactNumber(row.visitors)} {valueLabel}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-overlay/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-accent-600 to-cyan-500" style={{ width: `${Math.max(3, (row.visitors / max) * 100)}%` }} /></div>
                </div>
            ))}
        </div>
    );
}

function CampaignTable({ campaigns, canManage, onAction }: { campaigns: MarketingCampaign[]; canManage: boolean; onAction: (action: PendingAction) => void }) {
    const [budgets, setBudgets] = useState<Record<string, string>>({});
    if (!campaigns.length) return <div className="px-6 py-14 text-center text-sm text-text-muted">Keine Kampagnen für diesen Filter gefunden.</div>;
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] border-collapse text-left">
                <thead><tr className="border-b border-border bg-overlay/[0.02] text-xs font-semibold text-text-muted">
                    <th className="px-5 py-3.5">Kampagne</th><th className="px-4 py-3.5">Status</th><th className="px-4 py-3.5 text-right">Budget / Tag</th>
                    <th className="px-4 py-3.5 text-right">Ausgaben</th><th className="px-4 py-3.5 text-right">Klicks</th><th className="px-4 py-3.5 text-right">CTR</th>
                    <th className="px-4 py-3.5 text-right">Ergebnisse</th><th className="px-4 py-3.5 text-right">Kosten / Ergebnis</th><th className="px-5 py-3.5 text-right">Steuerung</th>
                </tr></thead>
                <tbody>{campaigns.map((campaign) => {
                    const active = STATUS_ACTIVE.has(campaign.status);
                    const key = `${campaign.provider}:${campaign.id}`;
                    const draft = budgets[key] ?? (campaign.dailyBudget == null ? '' : String(campaign.dailyBudget));
                    return (
                        <tr key={key} className="border-b border-border-subtle last:border-0 hover:bg-overlay/[0.025]">
                            <td className="px-5 py-4"><div className="flex items-center gap-3"><span className={cn('flex size-9 items-center justify-center rounded-lg text-xs font-bold uppercase', campaign.provider === 'google' ? 'bg-blue-500/12 text-blue-500' : 'bg-violet-500/12 text-violet-500')}>{campaign.provider === 'google' ? 'G' : 'M'}</span><div className="min-w-0"><p className="max-w-[260px] truncate text-sm font-semibold text-text-primary">{campaign.name}</p><p className="mt-0.5 text-xs text-text-muted">{campaign.provider === 'google' ? 'Google Ads' : 'Meta Ads'} · {campaign.channel || 'Kampagne'}</p></div></div></td>
                            <td className="px-4 py-4"><span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold', active ? 'border-success/20 bg-success/10 text-success' : 'border-border bg-overlay/[0.04] text-text-muted')}><span className={cn('size-1.5 rounded-full', active ? 'bg-success' : 'bg-text-faint')} />{active ? 'Aktiv' : campaign.status === 'PAUSED' ? 'Pausiert' : campaign.status}</span></td>
                            <td className="px-4 py-4 text-right">{campaign.budgetEditable && canManage ? <div className="ml-auto flex w-[150px] items-center gap-1.5"><Input type="number" min="1" step="1" value={draft} onChange={(event) => setBudgets((old) => ({ ...old, [key]: event.target.value }))} className="h-8 px-2 text-right font-mono text-xs" aria-label={`Tagesbudget ${campaign.name}`} /><button type="button" className="flex size-8 shrink-0 items-center justify-center rounded-md text-accent-500 hover:bg-accent-500/10 disabled:opacity-40" disabled={!draft || Number(draft) === campaign.dailyBudget} onClick={() => onAction({ kind: 'budget', campaign, dailyBudget: Number(draft) })} aria-label="Budget speichern"><Check size={15} /></button></div> : <span className="font-mono text-xs text-text-secondary">{campaign.dailyBudget == null ? '—' : money(campaign.dailyBudget, campaign.currency)}</span>}</td>
                            <td className="px-4 py-4 text-right font-mono text-xs text-text-primary">{money(campaign.spend, campaign.currency)}</td>
                            <td className="px-4 py-4 text-right font-mono text-xs text-text-secondary">{compactNumber(campaign.clicks)}</td>
                            <td className="px-4 py-4 text-right font-mono text-xs text-text-secondary">{campaign.ctr.toLocaleString('de-DE', { maximumFractionDigits: 2 })}%</td>
                            <td className="px-4 py-4 text-right font-mono text-xs text-text-secondary">{campaign.conversions.toLocaleString('de-DE', { maximumFractionDigits: 1 })}</td>
                            <td className="px-4 py-4 text-right font-mono text-xs text-text-secondary">{campaign.conversions ? money(campaign.cpa, campaign.currency) : '—'}</td>
                            <td className="px-5 py-4 text-right">{canManage ? <button type="button" onClick={() => onAction({ kind: 'status', campaign, status: active ? 'PAUSED' : 'ACTIVE' })} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors', active ? 'border-warning/25 text-warning hover:bg-warning/10' : 'border-success/25 text-success hover:bg-success/10')}>{active ? <Pause size={13} /> : <Play size={13} />}{active ? 'Pausieren' : 'Aktivieren'}</button> : <span className="text-xs text-text-muted">Nur Lesen</span>}</td>
                        </tr>
                    );
                })}</tbody>
            </table>
        </div>
    );
}

function ConfirmAction({ action, busy, onCancel, onConfirm }: { action: PendingAction; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
    const budget = action.kind === 'budget';
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="marketing-confirm-title">
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
                <div className="flex items-start gap-4"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-warning/12 text-warning">{budget ? <CircleDollarSign size={21} /> : action.status === 'PAUSED' ? <Pause size={21} /> : <Play size={21} />}</span><div><h2 id="marketing-confirm-title" className="font-display text-lg font-semibold text-text-primary">{budget ? 'Tagesbudget ändern?' : action.status === 'PAUSED' ? 'Kampagne pausieren?' : 'Kampagne aktivieren?'}</h2><p className="mt-2 text-sm leading-relaxed text-text-secondary"><strong className="text-text-primary">{action.campaign.name}</strong>{budget ? ` erhält ein Tagesbudget von ${money(action.dailyBudget, action.campaign.currency)}.` : action.status === 'PAUSED' ? ' liefert nach Bestätigung keine neuen Anzeigen mehr aus.' : ' kann nach Bestätigung wieder Budget ausgeben.'}</p>{budget && action.campaign.budgetShared && <p className="mt-3 rounded-lg border border-warning/20 bg-warning/[0.07] px-3 py-2 text-xs leading-relaxed text-warning">Dieses Google-Budget wird geteilt. Die Änderung kann deshalb weitere Kampagnen mit demselben Budget betreffen.</p>}<p className="mt-3 text-xs leading-relaxed text-text-muted">Die Änderung wirkt direkt beim Werbeanbieter, wird protokolliert und verlangt eine aktuelle Sicherheitsbestätigung.</p></div></div>
                <div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={onCancel} disabled={busy}>Abbrechen</Button><Button onClick={onConfirm} disabled={busy} className="min-w-28">{busy ? <Loader2 className="animate-spin" /> : budget ? 'Budget ändern' : 'Bestätigen'}</Button></div>
            </div>
        </div>
    );
}

export default function MarketingView(): JSX.Element {
    const queryClient = useQueryClient();
    const initial = useMemo(() => datePreset(30), []);
    const [from, setFrom] = useState(initial.from);
    const [to, setTo] = useState(initial.to);
    const [refreshToken, setRefreshToken] = useState(0);
    const [filter, setFilter] = useState<CampaignFilter>('all');
    const [search, setSearch] = useState('');
    const [pending, setPending] = useState<PendingAction | null>(null);
    const { can } = usePermissions();
    const canManage = can('marketing.manage');
    const connectionQuery = useQuery({
        queryKey: ['admin', 'marketing', 'connections'],
        queryFn: getMarketingConnections,
        staleTime: 60_000,
    });
    const query = useQuery({
        queryKey: ['admin', 'marketing', from, to, refreshToken],
        queryFn: () => getMarketingOverview(from, to, refreshToken > 0),
        enabled: Boolean(from && to && from <= to),
        staleTime: 3 * 60_000,
    });
    const mutation = useMutation({
        mutationFn: async (action: PendingAction) => action.kind === 'status'
            ? updateCampaignStatus(action.campaign.provider, action.campaign.id, action.status)
            : updateCampaignBudget(action.campaign.provider, action.campaign.id, action.dailyBudget),
        onSuccess: () => { toast.success('Änderung beim Werbeanbieter gespeichert.'); setPending(null); setRefreshToken((value) => value + 1); },
        onError: (error) => toast.error(parseError(error).message),
    });
    const connectionMutation = useMutation({
        mutationFn: async (action: { kind: 'connect'; provider: MarketingPlatform } | { kind: 'select'; provider: MarketingPlatform; accountId: string } | { kind: 'disconnect'; provider: MarketingPlatform }) => {
            if (action.kind === 'connect') return { action, result: await startMarketingConnection(action.provider) };
            if (action.kind === 'select') return { action, result: await selectMarketingAccount(action.provider, action.accountId) };
            return { action, result: await disconnectMarketingConnection(action.provider) };
        },
        onSuccess: ({ action, result }) => {
            if (action.kind === 'connect' && 'authorizationUrl' in result) {
                window.location.assign(result.authorizationUrl);
                return;
            }
            toast.success(action.kind === 'disconnect' ? 'Werbekonto-Verbindung getrennt.' : 'Aktives Werbekonto gespeichert.');
            void queryClient.invalidateQueries({ queryKey: ['admin', 'marketing'] });
            setRefreshToken((value) => value + 1);
        },
        onError: (error) => toast.error(parseError(error).message),
    });

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const result = params.get('connection');
        if (!result) return;
        if (result === 'connected') toast.success('Werbekonto sicher verbunden. Wähle jetzt das aktive Konto.');
        else toast.error('Die Anmeldung beim Werbeanbieter wurde nicht abgeschlossen.');
        params.delete('provider'); params.delete('connection'); params.delete('code');
        const next = `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', next);
        void queryClient.invalidateQueries({ queryKey: ['admin', 'marketing'] });
    }, [queryClient]);
    const data = query.data;
    const campaigns = useMemo(() => allCampaigns(data).filter((campaign) => {
        if (filter === 'google' || filter === 'meta') if (campaign.provider !== filter) return false;
        if (filter === 'active' && !STATUS_ACTIVE.has(campaign.status)) return false;
        if (filter === 'paused' && campaign.status !== 'PAUSED') return false;
        return campaign.name.toLocaleLowerCase('de-DE').includes(search.trim().toLocaleLowerCase('de-DE'));
    }), [data, filter, search]);
    const currencyTotals = totalsByCurrency(data);
    const adClicks = currencyTotals.reduce((sum, row) => sum + row.summary.clicks, 0);
    const conversions = currencyTotals.reduce((sum, row) => sum + row.summary.conversions, 0);
    const impressions = currencyTotals.reduce((sum, row) => sum + row.summary.impressions, 0);
    const trackedClicks = data?.website?.clicks.reduce((sum, row) => sum + row.clicks, 0) || 0;
    const spendLabel = currencyTotals.length ? currencyTotals.map((row) => money(row.summary.spend, row.currency)).join(' · ') : '—';
    const funnels = [
        { label: 'Impressionen', value: impressions, icon: Eye }, { label: 'Anzeigenklicks', value: adClicks, icon: MousePointerClick },
        { label: 'Website-Besucher', value: data?.website?.summary.visitors || 0, icon: Users }, { label: 'Interaktionen', value: trackedClicks, icon: Target },
        { label: 'Ergebnisse', value: conversions, icon: Check },
    ];
    const funnelMax = Math.max(1, ...funnels.map((step) => step.value));
    const invalidRange = !from || !to || from > to;
    const visitDuration = data?.website?.summary.visitDuration || 0;
    const visitDurationLabel = `${Math.floor(visitDuration / 60)}:${String(Math.round(visitDuration % 60)).padStart(2, '0')} min`;

    return (
        <div className={cn(SEITEN_RAND, 'space-y-5')}>
            <section className="admin-page-intro px-5 py-5 md:px-6">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-danger">Growth Operations / Website & Paid Media</div>
                <SeitenKopf titel="Marketing & Ads" beileile="Normale Website-Besuche, SEO, Kaltakquise und Anzeigen gemeinsam verstehen – bis zu Einstiegsseite und Klickziel." aktionen={<><span className="text-xs text-text-muted">{data ? relativeGeneratedAt(data.generatedAt) : ''}</span><button type="button" className={NEBEN_AKTION} onClick={() => setRefreshToken((value) => value + 1)} disabled={query.isFetching}><RefreshCw size={15} className={query.isFetching ? 'animate-spin' : ''} />Aktualisieren</button></>} />
            </section>

            <section className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm" aria-label="Auswertungszeitraum">
                <div className="mr-auto flex flex-wrap gap-2">{[7, 30, 90].map((days) => { const preset = datePreset(days); const active = preset.from === from && preset.to === to; return <FilterPille key={days} aktiv={active} onClick={() => { setFrom(preset.from); setTo(preset.to); }}>{days} Tage</FilterPille>; })}</div>
                <label className="text-xs font-semibold text-text-muted">Von<Input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 h-9 w-[150px]" /></label>
                <label className="text-xs font-semibold text-text-muted">Bis<Input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="mt-1 h-9 w-[150px]" /></label>
            </section>

            {invalidRange && <div role="alert" className="flex items-center gap-2 rounded-xl border border-danger/20 bg-danger/[0.07] px-4 py-3 text-sm text-danger"><AlertTriangle size={16} />Das Startdatum muss vor oder auf dem Enddatum liegen.</div>}

            {query.isLoading && <LoadingState label="Marketingdaten werden zusammengeführt…" />}
            {query.isError && <ErrorState message={parseError(query.error).message} onRetry={() => void query.refetch()} />}
            {data && <>
                <section className="grid gap-3 lg:grid-cols-3" aria-label="Verbindungen">{data.connections.map((connection) => <ConnectionCard
                    key={connection.provider}
                    connection={connection}
                    oauth={connectionQuery.data?.find((item) => item.provider === connection.provider)}
                    canManage={canManage}
                    busy={connectionMutation.isPending}
                    onConnect={(provider) => connectionMutation.mutate({ kind: 'connect', provider })}
                    onSelect={(provider, accountId) => connectionMutation.mutate({ kind: 'select', provider, accountId })}
                    onDisconnect={(provider) => {
                        if (window.confirm(`${provider === 'google' ? 'Google Ads' : 'Meta Ads'} wirklich vom Admin-Dashboard trennen?`)) connectionMutation.mutate({ kind: 'disconnect', provider });
                    }}
                />)}</section>

                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Kennzahlen">
                    <MetricCard label="Website-Besucher" value={compactNumber(data.website?.summary.visitors || 0)} icon={Users} note={data.website ? <ChangeBadge current={data.website.summary.visitors} previous={data.website.previous.visitors} /> : <span className="text-xs text-text-muted">Website-Statistik verbinden</span>} />
                    <MetricCard label="Anzeigenklicks" value={compactNumber(adClicks)} icon={MousePointerClick} tone="info" note={<span className="text-xs text-text-muted">Google + Meta im Zeitraum</span>} />
                    <MetricCard label="Werbeausgaben" value={spendLabel} icon={CircleDollarSign} tone="warning" note={<span className="text-xs text-text-muted">Währungen bleiben getrennt</span>} />
                    <MetricCard label="Ergebnisse" value={conversions.toLocaleString('de-DE', { maximumFractionDigits: 1 })} icon={Target} tone="success" note={<span className="text-xs text-text-muted">Gemäß Anbieter-Konversionen</span>} />
                </section>

                <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
                    <article className="karte p-5 md:p-6"><div className="mb-5 flex items-start justify-between gap-3"><div><h2 className="font-display text-lg font-semibold text-text-primary">Website-Entwicklung</h2><p className="mt-1 text-xs text-text-muted">Besucher und Seitenaufrufe im gewählten Zeitraum</p></div><Activity size={18} className="text-accent-500" /></div><TrendChart points={data.website?.trend || []} /><div className="mt-5 grid grid-cols-2 gap-2 border-t border-border pt-4 sm:grid-cols-4">{[
                        ['Besuche', compactNumber(data.website?.summary.visits || 0)],
                        ['Seitenaufrufe', compactNumber(data.website?.summary.pageviews || 0)],
                        ['Absprungrate', `${(data.website?.summary.bounceRate || 0).toLocaleString('de-DE', { maximumFractionDigits: 1 })}%`],
                        ['Ø Besuchsdauer', visitDurationLabel],
                    ].map(([label, value]) => <div key={label} className="rounded-lg bg-overlay/[0.03] px-3 py-2.5"><p className="text-[11px] font-medium text-text-muted">{label}</p><p className="mt-1 font-mono text-sm font-semibold text-text-primary">{value}</p></div>)}</div></article>
                    <article className="karte p-5 md:p-6"><div className="mb-5"><h2 className="font-display text-lg font-semibold text-text-primary">Wirkungskette</h2><p className="mt-1 text-xs text-text-muted">Orientierung über getrennte Anbieter-Metriken, keine personenbezogene Attribution.</p></div><div className="space-y-3">{funnels.map((step, index) => <div key={step.label} className="relative overflow-hidden rounded-lg border border-border bg-overlay/[0.025] p-3"><div aria-hidden className="absolute inset-y-0 left-0 bg-accent-500/[0.09]" style={{ width: `${Math.max(2, (step.value / funnelMax) * 100)}%` }} /><div className="relative flex items-center gap-3"><span className="flex size-8 items-center justify-center rounded-lg bg-surface text-accent-500"><step.icon size={15} /></span><span className="flex-1 text-sm font-medium text-text-secondary">{step.label}</span><strong className="font-mono text-sm text-text-primary">{compactNumber(step.value)}</strong>{index < funnels.length - 1 && <ChevronRight size={14} className="text-text-faint" />}</div></div>)}</div></article>
                </section>

                <section className="karte overflow-hidden" aria-label="Website-Herkunft">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4 md:px-6">
                        <div><h2 className="font-display text-lg font-semibold text-text-primary">Woher Website-Besuche kommen</h2><p className="mt-1 text-xs text-text-muted">SEO, Direktzugriffe, Werbung und markierte CRM-Kaltakquise. Die Werte zeigen Besuche, nicht Werbeklicks.</p></div>
                        <Globe2 size={18} className="text-accent-500" />
                    </div>
                    <div className="grid grid-cols-2 border-b border-border md:grid-cols-4">{[
                        ['SEO', data.website?.acquisition.organicVisits || 0],
                        ['Kaltakquise', data.website?.acquisition.coldOutreachVisits || 0],
                        ['Direkt', data.website?.acquisition.directVisits || 0],
                        ['Bezahlt', data.website?.acquisition.paidVisits || 0],
                    ].map(([label, value], index) => <div key={String(label)} className={cn('px-5 py-4', index % 2 === 1 && 'border-l border-border', index > 1 && 'border-t border-border md:border-t-0', index > 1 && 'md:border-l')}><p className="text-[11px] font-semibold text-text-muted">{label}</p><p className="mt-1 font-mono text-xl font-semibold text-text-primary">{compactNumber(Number(value))}</p><p className="mt-0.5 text-[10px] text-text-faint">Besuche im Zeitraum</p></div>)}</div>
                    <div className="grid xl:grid-cols-[minmax(260px,0.65fr)_minmax(0,1.35fr)]">
                        <div className="border-b border-border p-5 xl:border-b-0 xl:border-r md:p-6"><h3 className="mb-5 text-sm font-semibold text-text-primary">Kanäle</h3><Ranking rows={(data.website?.channels || []).map((row) => ({ label: row.label, visitors: row.visits || 0 }))} valueLabel="Besuche" /></div>
                        <div className="min-w-0"><div className="border-b border-border-subtle px-5 py-4"><h3 className="text-sm font-semibold text-text-primary">Kampagnen und markierte Zugriffe</h3><p className="mt-1 text-xs text-text-muted">CRM-E-Mails werden automatisch als Kaltakquise und mit dem Vertriebler markiert.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-border bg-overlay/[0.02] text-xs font-semibold text-text-muted"><th className="px-5 py-3">Herkunft</th><th className="px-4 py-3">Quelle / Kampagne</th><th className="px-4 py-3">Vertriebler / Inhalt</th><th className="px-4 py-3">Einstieg</th><th className="px-5 py-3 text-right">Besuche</th></tr></thead><tbody>{(data.website?.attribution || []).length ? data.website!.attribution.slice(0, 30).map((row, index) => <tr key={`${row.channel}:${row.source}:${row.campaign}:${row.content}:${row.entryPage}:${index}`} className="border-b border-border-subtle last:border-0"><td className="px-5 py-3.5"><span className={cn('inline-flex rounded px-2 py-1 text-[11px] font-semibold', row.channel === 'Kaltakquise' ? 'bg-accent-500/10 text-accent-500' : 'bg-overlay/[0.05] text-text-secondary')}>{row.channel}</span></td><td className="px-4 py-3.5"><p className="text-sm font-medium text-text-primary">{row.source}</p><p className="mt-0.5 text-xs text-text-muted">{row.medium} · {row.campaign}</p></td><td className="px-4 py-3.5 text-xs text-text-secondary">{row.content}</td><td className="px-4 py-3.5 font-mono text-xs text-text-secondary">{row.entryPage}</td><td className="px-5 py-3.5 text-right font-mono text-sm font-semibold text-text-primary">{row.visits}</td></tr>) : <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-text-muted">Noch keine Zugriffe im Zeitraum.</td></tr>}</tbody></table></div></div>
                    </div>
                </section>

                <section className="grid gap-4 xl:grid-cols-3">
                    <article className="karte p-5 md:p-6"><div className="mb-5 flex items-center gap-2"><ExternalLink size={17} className="text-info" /><h2 className="font-display text-lg font-semibold text-text-primary">Einstiegsseiten</h2></div><Ranking rows={(data.website?.entryPages || []).map((row) => ({ label: row.label, visitors: row.visits || 0 }))} valueLabel="Besuche" /></article>
                    <article className="karte p-5 md:p-6"><div className="mb-5 flex items-center gap-2"><BarChart3 size={17} className="text-accent-500" /><h2 className="font-display text-lg font-semibold text-text-primary">Besuchte Seiten</h2></div><Ranking rows={data.website?.pages || []} /></article>
                    <article className="karte p-5 md:p-6"><div className="mb-2 flex items-center gap-2"><MapPinned size={17} className="text-success" /><h2 className="font-display text-lg font-semibold text-text-primary">Ungefähre Regionen</h2></div><p className="mb-5 text-xs leading-relaxed text-text-muted">Aus der anonymen Reichweitenmessung. Vollständige IP-Adressen werden nicht gespeichert oder angezeigt.</p><Ranking rows={(data.website?.regions || []).map((row) => ({ label: row.label, visitors: row.visitors }))} /></article>
                </section>

                <section className="karte overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h2 className="font-display text-lg font-semibold text-text-primary">Seiten nach Herkunft</h2><p className="mt-1 text-xs text-text-muted">Welche Seiten Besucher aus den einzelnen Kanälen aufgerufen haben.</p></div><Activity size={18} className="text-info" /></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead><tr className="border-b border-border bg-overlay/[0.02] text-xs font-semibold text-text-muted"><th className="px-5 py-3">Herkunft</th><th className="px-4 py-3">Seite</th><th className="px-4 py-3 text-right">Besucher</th><th className="px-5 py-3 text-right">Aufrufe</th></tr></thead><tbody>{(data.website?.pagesByChannel || []).length ? data.website!.pagesByChannel.slice(0, 40).map((row, index) => <tr key={`${row.channel}:${row.page}:${index}`} className="border-b border-border-subtle last:border-0"><td className="px-5 py-3.5 text-sm font-medium text-text-primary">{row.channel}</td><td className="px-4 py-3.5 font-mono text-xs text-text-secondary">{row.page}</td><td className="px-4 py-3.5 text-right font-mono text-sm text-text-secondary">{row.visitors}</td><td className="px-5 py-3.5 text-right font-mono text-sm font-semibold text-text-primary">{row.pageviews}</td></tr>) : <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-text-muted">Noch keine Seitenaufrufe im Zeitraum.</td></tr>}</tbody></table></div></section>

                <section className="karte overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h2 className="font-display text-lg font-semibold text-text-primary">Klickziele auf der Website</h2><p className="mt-1 text-xs text-text-muted">Welche Aktion auf welcher Seite und aus welcher Herkunft genutzt wurde.</p></div><MousePointerClick size={18} className="text-accent-500" /></div><div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left"><thead><tr className="border-b border-border bg-overlay/[0.02] text-xs font-semibold text-text-muted"><th className="px-5 py-3">Ziel</th><th className="px-4 py-3">Herkunft</th><th className="px-4 py-3">Ausgangsseite</th><th className="px-4 py-3">Bereich</th><th className="px-4 py-3">Typ</th><th className="px-5 py-3 text-right">Klicks</th></tr></thead><tbody>{(data.website?.clicks || []).length ? data.website!.clicks.map((row, index) => <tr key={`${row.channel}:${row.page}:${row.target}:${index}`} className="border-b border-border-subtle last:border-0"><td className="px-5 py-3.5"><p className="max-w-[280px] truncate text-sm font-semibold text-text-primary" title={row.target}>{row.target}</p>{row.destination && <p className="mt-0.5 max-w-[280px] truncate text-xs text-text-muted">{row.destination}</p>}</td><td className="px-4 py-3.5 text-xs font-medium text-text-secondary">{row.channel}</td><td className="px-4 py-3.5 font-mono text-xs text-text-secondary">{row.page}</td><td className="px-4 py-3.5 text-xs text-text-secondary">{row.placement}</td><td className="px-4 py-3.5 text-xs text-text-secondary">{row.kind}</td><td className="px-5 py-3.5 text-right font-mono text-sm font-semibold text-text-primary">{row.clicks}</td></tr>) : <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-text-muted">Noch keine Klickziele im Zeitraum.</td></tr>}</tbody></table></div></section>

                <section className="karte overflow-hidden"><div className="flex flex-wrap items-center gap-3 border-b border-border p-5"><div className="mr-auto"><h2 className="font-display text-lg font-semibold text-text-primary">Kampagnensteuerung</h2><p className="mt-1 text-xs text-text-muted">Live-Status, Tagesbudgets und Effizienz aus Google Ads und Meta Ads.</p></div><div className="relative w-full sm:w-60"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Kampagne suchen…" className="h-9 pl-9" /></div></div><div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">{([['all', 'Alle'], ['google', 'Google'], ['meta', 'Meta'], ['active', 'Aktiv'], ['paused', 'Pausiert']] as const).map(([value, label]) => <FilterPille key={value} aktiv={filter === value} onClick={() => setFilter(value)}>{label}</FilterPille>)}</div><CampaignTable campaigns={campaigns} canManage={canManage} onAction={setPending} /></section>

                {!canManage && <div className="flex items-start gap-3 rounded-xl border border-info/20 bg-info/[0.07] p-4 text-sm text-text-secondary"><Settings2 size={18} className="mt-0.5 shrink-0 text-info" /><p>Du siehst alle Marketingdaten. Direkte Änderungen an Budget und Auslieferung sind aus Sicherheitsgründen nur für Superadmins mit erneuter Anmeldung freigeschaltet.</p></div>}
            </>}
            {pending && <ConfirmAction action={pending} busy={mutation.isPending} onCancel={() => !mutation.isPending && setPending(null)} onConfirm={() => mutation.mutate(pending)} />}
        </div>
    );
}

