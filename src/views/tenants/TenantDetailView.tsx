/**
 * TenantDetailView — full-page merchant workspace with URL-addressable tabs.
 * Wires:
 *   - Rich detail (users, settings) via useTenant → GET /api/admin/tenants/:id/detail
 *   - Active devices via useTenantDevices + useRemoveDevice
 *   - Limits-Editor (max_users/max_devices) via useUpdateTenantLimits
 *   - WhatsApp-Nummer (Bot-Zuordnung) via useUpdateTenant
 *   - Owner-Passwort-Reset DIREKT via resetTenantUserPassword (kein E-Mail-Versand)
 *   - Impersonation via useImpersonate
 */
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';

import { TenantProvisioning } from './TenantProvisioningPanel';
import { TenantDemoPanel } from './TenantDemoPanel';
import { TenantOperations } from './TenantOperations';
import { TenantOverview } from './TenantOverview';
import { TenantReadinessProfile } from './TenantReadinessProfile';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { SEITEN_RAND } from '@/components/ui/seite';
import { SEITEN_TITEL } from '@/components/ui/dichte';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    useTenants,
    useTenant,
    useTenantDevices,
    useRemoveDevice,
    useSuspendTenant,
    useUnsuspendTenant,
    useUpdateTenant,
    useUpdateTenantLimits,
    type TenantDeviceRow,
} from '@/hooks/useTenants';
import { useImpersonate } from '@/hooks/useImpersonate';
import { usePermissions } from '@/auth/usePermissions';
import { LoadingState } from '@/components/feedback/LoadingState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { copyToClipboard } from '@/utils/clipboard';
import { formatDateTime, formatRelative } from '@/utils/format/date';
import { resetTenantUserPassword, setTenantWhatsAppMeta, testTenantWhatsAppMeta, type WhatsAppMetaTestResult } from '@/api/tenants';
import { getTenantOnboardingHealth, type OnboardingHealthRow, type OnboardingRisk } from '@/api/onboarding';
import { uniqueTenantOwner, validTenantResetPassword } from './tenantOwner';
import { generateSecurePassword } from '@/utils/validation/password';
import {
    presentTenantPaymentStatus,
    type TenantPaymentTone,
} from './tenantStatus';

/** Gleiche Validierung wie das Backend: Strip von Leerzeichen/Bindestrichen/
 *  Klammern, dann optionales + gefolgt von 10-15 Ziffern. */
const WHATSAPP_RE = /^\+?\d{10,15}$/;
function normalizeWhatsapp(value: string): string {
    return value.replace(/[\s\-()]/g, '');
}

/** Backend-Limits der PATCH /tenants/:id/limits Route (zod 1-100 / 1-50). */
const MAX_USERS_MIN = 1;
const MAX_USERS_MAX = 100;
const MAX_DEVICES_MIN = 1;
const MAX_DEVICES_MAX = 50;

const PAYMENT_TONE_CLASS: Record<TenantPaymentTone, string> = {
    success: 'bg-status-success/10 text-status-success',
    info: 'bg-accent-500/[0.12] text-accent-500',
    warning: 'bg-status-warning/10 text-status-warning',
    danger: 'bg-status-danger-muted text-status-danger',
    neutral: 'bg-surface text-text-secondary border border-border',
};

interface TenantLimitsDraft {
    tenantId: string;
    maxUsers: string;
    maxDevices: string;
}

interface TenantWhatsappDraft {
    tenantId: string;
    value: string;
}

export default function TenantDetailView(): JSX.Element {
    const { id } = useParams<{ id: string }>();
    const [params] = useSearchParams();
    return <TenantDetailWorkspace key={`${id}:${params.get('tab') ?? 'overview'}`} />;
}

function TenantDetailWorkspace(): JSX.Element {
    const { id } = useParams<{ id: string }>();
    const location = useLocation();
    const listSearch = typeof location.state?.tenantListSearch === 'string' ? new URLSearchParams(location.state.tenantListSearch).toString() : '';
    const nav = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const tabs = [{ id: 'overview', label: 'Übersicht' }, { id: 'profile', label: 'Firmendaten' }, { id: 'onboarding', label: 'Einrichtung & Freigabe' }, { id: 'operations', label: 'Bestellungen & ERP' }, { id: 'integrations', label: 'Integrationen' }, { id: 'access', label: 'Zugänge & Sicherheit' }];
    const activeTab = tabs.some(tab => tab.id === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
    const {
        tenants,
        isLoading,
        error: tenantsError,
        refetch: refetchTenants,
    } = useTenants();
    const tenant = tenants.find((t) => t.id === id);
    const detailQ = useTenant(id ?? null);
    const detail = detailQ.data;
    const {
        devices,
        isLoading: devicesLoading,
        error: devicesError,
        refetch: refetchDevices,
    } = useTenantDevices(activeTab === 'access' ? id ?? null : null);
    const removeDeviceMut = useRemoveDevice();
    const suspendMut = useSuspendTenant();
    const unsuspendMut = useUnsuspendTenant();
    const updateTenantMut = useUpdateTenant();
    const updateLimitsMut = useUpdateTenantLimits();
    const impersonateMut = useImpersonate();
    const { isSuperAdmin, can } = usePermissions();
    const [confirmSuspend, setConfirmSuspend] = useState(false);
    const [deviceToRemove, setDeviceToRemove] = useState<{
        tenantId: string;
        device: TenantDeviceRow;
    } | null>(null);

    // ── Limits-Editor ──────────────────────────────────────────────────
    const [limitsDraft, setLimitsDraft] = useState<TenantLimitsDraft | null>(null);

    // ── Anzeigename (P1.2) — Draft überlagert den Server-Namen; null = noch
    //    nicht bearbeitet (zeigt den geladenen Tenant-Namen, ohne Effect-Sync).
    const [nameDraft, setNameDraft] = useState<string | null>(null);

    // ── WhatsApp-Nummer ────────────────────────────────────────────────
    const [whatsappDraft, setWhatsappDraft] = useState<TenantWhatsappDraft | null>(null);

    // ── WhatsApp Meta-Cloud (phone_number_id = Aktivierungs-Schlüssel) ──
    const [metaPnid, setMetaPnid] = useState('');
    const [metaWaba, setMetaWaba] = useState('');
    const [metaSaving, setMetaSaving] = useState(false);
    const [metaTesting, setMetaTesting] = useState(false);
    const [metaTest, setMetaTest] = useState<WhatsAppMetaTestResult | null>(null);

    // ── Onboarding health (per-tenant cockpit) ──────────────────────────
    const [obHealth, setObHealth] = useState<OnboardingHealthRow | null>(null);
    useEffect(() => {
        if (!id) return;
        let alive = true;
        getTenantOnboardingHealth(id).then((h) => { if (alive) setObHealth(h); }).catch(() => {});
        return () => { alive = false; };
    }, [id]);

    async function handleSaveMeta(): Promise<void> {
        if (!id) return;
        const pnid = metaPnid.trim();
        if (!/^\d{6,}$/.test(pnid)) {
            toast.error('phone_number_id: nur Ziffern (Meta-ID).');
            return;
        }
        setMetaSaving(true);
        try {
            await setTenantWhatsAppMeta(id, { phone_number_id: pnid, waba_id: metaWaba.trim() || undefined });
            toast.success('WhatsApp-ID gespeichert. Jetzt „Verbindung testen".');
            setMetaTest(null);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
        } finally {
            setMetaSaving(false);
        }
    }

    async function handleTestMeta(): Promise<void> {
        if (!id) return;
        setMetaTesting(true);
        setMetaTest(null);
        try {
            const r = await testTenantWhatsAppMeta(id, metaPnid.trim() ? { phone_number_id: metaPnid.trim() } : {});
            setMetaTest(r);
            if (r.ok) toast.success('Verbindung OK.');
            else toast.error(r.error || 'Verbindung fehlgeschlagen.');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Test fehlgeschlagen.');
        } finally {
            setMetaTesting(false);
        }
    }

    // ── Passwort-Reset-Dialog ──────────────────────────────────────────
    const [resetOpen, setResetOpen] = useState(false);
    const [resetVisible, setResetVisible] = useState(false);
    const [resetPasswordInput, setResetPasswordInput] = useState('');
    const [resetBusy, setResetBusy] = useState(false);
    /** Nach Erfolg: das gesetzte Passwort — wird genau EINMAL angezeigt. */
    const [resetResultPassword, setResetResultPassword] = useState<string | null>(null);

    const suspended = tenant?.payment_status?.trim().toLowerCase() === 'suspended';
    const payment = presentTenantPaymentStatus(tenant?.payment_status);
    const ownerUser = detail && !detailQ.isError ? uniqueTenantOwner(detail.users) : undefined;
    // P1.2: angezeigter Name = Draft (falls bearbeitet), sonst Server-Wert.
    const nameValue = nameDraft ?? tenant?.name ?? '';

    // Serverwerte bleiben die Quelle der Wahrheit, bis der Operator das jeweilige
    // Feld tatsächlich bearbeitet. Tenant-gebundene Drafts verhindern, dass beim
    // Wechsel zwischen zwei Detail-Routen Eingaben des vorherigen Kunden aufblitzen.
    const activeLimitsDraft = limitsDraft?.tenantId === id ? limitsDraft : null;
    const maxUsersInput =
        activeLimitsDraft?.maxUsers ?? (detail ? String(detail.settings.max_users) : '');
    const maxDevicesInput =
        activeLimitsDraft?.maxDevices ?? (detail ? String(detail.settings.max_devices) : '');
    const activeWhatsappDraft = whatsappDraft?.tenantId === id ? whatsappDraft : null;
    const whatsappInput =
        activeWhatsappDraft?.value ?? detail?.settings.whatsapp_number ?? '';

    const maxUsersValue = Number(maxUsersInput);
    const maxDevicesValue = Number(maxDevicesInput);
    const limitsValid =
        Number.isInteger(maxUsersValue) &&
        maxUsersValue >= MAX_USERS_MIN &&
        maxUsersValue <= MAX_USERS_MAX &&
        Number.isInteger(maxDevicesValue) &&
        maxDevicesValue >= MAX_DEVICES_MIN &&
        maxDevicesValue <= MAX_DEVICES_MAX;

    const whatsappNormalized = normalizeWhatsapp(whatsappInput);
    const whatsappValid = WHATSAPP_RE.test(whatsappNormalized);
    useUnsavedChanges('Händler-Stammdaten', Boolean(
        (nameDraft !== null && nameDraft !== tenant?.name)
        || (activeLimitsDraft && (maxUsersValue !== detail?.settings.max_users || maxDevicesValue !== detail?.settings.max_devices))
        || (activeWhatsappDraft && whatsappNormalized !== (detail?.settings.whatsapp_number ?? ''))
    ), updateTenantMut.isPending || updateLimitsMut.isPending);

    function handleUnsuspend(): void {
        if (!tenant || !can('billing.manage')) return;
        unsuspendMut.mutate(tenant.id, {
            onSuccess: () => toast.success(`${tenant.name} reaktiviert.`),
            onError: (err) =>
                toast.error(err instanceof Error ? err.message : 'Reaktivieren fehlgeschlagen.'),
        });
    }

    function handleImpersonate(): void {
        if (id == null || !can('tenants.impersonate')) return;
        impersonateMut.mutate(
            { tenantId: id, tenantName: tenant?.name },
            {
                onSuccess: () => toast.success('Impersonation gestartet.'),
                onError: (err) =>
                    toast.error(
                        err instanceof Error ? err.message : 'Impersonation fehlgeschlagen.',
                    ),
            }
        );
    }

    function handleSaveLimits(): void {
        if (id == null || !limitsValid) return;
        updateLimitsMut.mutate(
            { id, limits: { max_users: maxUsersValue, max_devices: maxDevicesValue } },
            {
                onSuccess: () => {
                    toast.success('Limits gespeichert.');
                    void detailQ.refetch().then((result) => {
                        if (result.isSuccess) {
                            setLimitsDraft((draft) =>
                                draft?.tenantId === id ? null : draft,
                            );
                        }
                    });
                },
                onError: (err) =>
                    toast.error(
                        err instanceof Error ? err.message : 'Limits speichern fehlgeschlagen.',
                    ),
            }
        );
    }

    function handleSaveName(): void {
        if (id == null) return;
        const next = nameValue.trim();
        if (next.length < 2) {
            toast.error('Name muss mindestens 2 Zeichen haben.');
            return;
        }
        updateTenantMut.mutate(
            { id, patch: { name: next } },
            {
                onSuccess: () => {
                    setNameDraft(null); // zurück auf den (refetchten) Server-Wert
                    toast.success('Name gespeichert.');
                },
                onError: (err) =>
                    toast.error(err instanceof Error ? err.message : 'Name speichern fehlgeschlagen.'),
            }
        );
    }

    function handleSaveWhatsapp(): void {
        if (id == null) return;
        if (!whatsappValid) {
            toast.error('Ungültige Nummer — erwartet wird +49… mit 10-15 Ziffern.');
            return;
        }
        updateTenantMut.mutate(
            { id, patch: { whatsapp_number: whatsappNormalized } },
            {
                onSuccess: () => {
                    toast.success('WhatsApp-Nummer gespeichert.');
                    void detailQ.refetch().then((result) => {
                        if (result.isSuccess) {
                            setWhatsappDraft((draft) =>
                                draft?.tenantId === id ? null : draft,
                            );
                        }
                    });
                },
                onError: (err) =>
                    toast.error(
                        err instanceof Error
                            ? err.message
                            : 'WhatsApp-Nummer speichern fehlgeschlagen.',
                    ),
            }
        );
    }

    function openResetDialog(): void {
        if (!can('users.resetPassword') || !ownerUser || detailQ.isLoading) return;
        setResetPasswordInput('');
        setResetVisible(false);
        setResetResultPassword(null);
        setResetOpen(true);
    }

    async function handleResetPassword(): Promise<void> {
        if (!can('users.resetPassword') || resetBusy) return;
        if (!ownerUser) {
            toast.error('Kein Owner-User gefunden — Passwort-Reset nicht möglich.');
            return;
        }
        const pw = resetPasswordInput;
        if (!validTenantResetPassword(pw)) {
            toast.error('Passwort muss zwischen 12 und 128 Zeichen haben.');
            return;
        }
        setResetBusy(true);
        try {
            const res = await resetTenantUserPassword(ownerUser.id, pw);
            if (res.success) {
                setResetResultPassword(pw);
                toast.success(`Passwort für ${ownerUser.username} neu gesetzt.`);
            } else {
                toast.error(res.message ?? 'Passwort-Reset fehlgeschlagen.');
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Passwort-Reset fehlgeschlagen.');
        } finally {
            setResetBusy(false);
        }
    }

    return (
        <>
        <div className={SEITEN_RAND}>
                <Link to={'/tenants' + (listSearch ? '?' + listSearch : '')} className="mb-4 inline-block text-sm text-text-muted hover:text-accent-500">← Händlerübersicht</Link>
                <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0"><p className="mb-1 text-xs font-medium text-text-muted">Kundenakte · {tenant?.is_demo ? 'Demozugang' : 'Händler'}</p><h1 className={'flex flex-wrap items-center gap-3 break-words font-semibold ' + SEITEN_TITEL}>
                        {tenant?.name ?? 'Kunde'}
                        {tenant?.is_demo && (
                            <span className="rounded-full bg-accent-500/12 px-2 py-0.5 text-xs font-medium text-accent-500">
                                Demo-Zugang
                            </span>
                        )}
                    </h1><p className="mt-2 text-sm text-text-muted">{tenant ? `${tenant.slug} · ${tenant.is_active ? 'Konto aktiv' : 'Konto inaktiv'}` : 'Wird geladen…'}</p></div>
                    {tenant && activeTab === 'overview' && can('tenants.update') && <Button variant="outline" onClick={() => setSearchParams({ tab: 'profile' })}>Firmendaten bearbeiten</Button>}
                </header>
                <label className="mb-5 block sm:hidden"><span className="sr-only">Händlerbereich</span><select value={activeTab ?? 'overview'} onChange={event => setSearchParams({ tab: event.target.value })} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm">{tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}</select></label>
                <nav aria-label="Händlerbereiche" className="mb-6 hidden gap-1 overflow-x-auto border-b border-border sm:flex">
                    {tabs.map(tab => <button key={tab.id} type="button" aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => setSearchParams({ tab: tab.id })} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium ${activeTab === tab.id ? 'border-accent-500 text-accent-500' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>{tab.label}</button>)}
                </nav>
                {id && tenant && activeTab === 'onboarding' && <div className="space-y-5"><TenantDemoPanel tenantId={id} /><TenantProvisioning tenantId={id} /></div>}
                {id && tenant && activeTab === 'operations' && <TenantOperations tenantId={id} />}
                {tenant && activeTab === 'overview' && <TenantOverview tenant={tenant} detail={detail} detailLoading={detailQ.isLoading} detailError={detailQ.isError} retryDetail={() => void detailQ.refetch()} onSection={tab => setSearchParams({ tab })} />}
                {id && tenant && activeTab === 'profile' && <div className="mb-5"><TenantReadinessProfile tenantId={id} readOnly={!can('tenants.update')} /></div>}

                <div className="merchant-sections grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
                    {isLoading && <LoadingState label="Lade Kunde…" />}
                    {!isLoading && Boolean(tenantsError) && (
                        <ErrorState
                            title="Kunde konnte nicht geladen werden"
                            message="Die Kundenliste ist derzeit nicht verfügbar. Der Datensatz wird deshalb nicht fälschlich als fehlend angezeigt."
                            detail={tenantsError instanceof Error ? tenantsError.message : undefined}
                            onRetry={refetchTenants}
                        />
                    )}
                    {!isLoading && !tenantsError && !tenant && (
                        <p className="text-sm text-text-muted">Kunde nicht gefunden.</p>
                    )}
                    {tenant && (
                        <>
                            <section hidden={activeTab !== 'profile'} className="rounded-lg border border-border bg-surface p-5">
                                <h3 className="text-base font-semibold text-text-primary mb-4">
                                    Stammdaten
                                </h3>
                                <dl className="grid grid-cols-2 gap-2 text-sm">
                                    <dt className="text-text-secondary">Status</dt>
                                    <dd>{tenant.is_active ? 'Aktiv' : 'Inaktiv'}</dd>
                                    <dt className="text-text-secondary">Zahlung</dt>
                                    <dd>
                                        <span
                                            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_TONE_CLASS[payment.tone]}`}
                                        >
                                            <span
                                                className="inline-block size-1.5 rounded-full bg-current"
                                                aria-hidden="true"
                                            />
                                            {payment.label}
                                        </span>
                                    </dd>
                                    <dt className="text-text-secondary">Onboarding</dt>
                                    <dd>{tenant.onboarding_status ?? '—'}</dd>
                                    <dt className="text-text-secondary">Nutzer</dt>
                                    <dd className="tabular-nums">
                                        {tenant.user_count}/{detail?.settings.max_users ?? tenant.max_users}
                                    </dd>
                                    <dt className="text-text-secondary">Geräte</dt>
                                    <dd className="tabular-nums">
                                        {tenant.device_count}/{detail?.settings.max_devices ?? tenant.max_devices}
                                    </dd>
                                    {tenant.created_at && (
                                        <>
                                            <dt className="text-text-secondary">Erstellt</dt>
                                            <dd>{formatDateTime(tenant.created_at)}</dd>
                                        </>
                                    )}
                                </dl>
                            </section>

                            <section hidden={activeTab !== 'profile'} className="rounded-lg border border-border bg-surface p-5">
                                <h3 className="text-base font-semibold text-text-primary mb-4">
                                    Anzeigename
                                </h3>
                                <div className="flex items-end gap-2">
                                    <div className="flex-1 space-y-1">
                                        <Label htmlFor="tenant-name" className="text-xs">
                                            Firmen-/Anzeigename
                                        </Label>
                                        <Input
                                            id="tenant-name"
                                            value={nameValue}
                                            onChange={(e) => setNameDraft(e.target.value)}
                                            disabled={!can('tenants.update') || updateTenantMut.isPending}
                                        />
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={
                                            !can('tenants.update') || updateTenantMut.isPending ||
                                            nameValue.trim().length < 2 ||
                                            nameValue.trim() === (tenant.name ?? '')
                                        }
                                        onClick={handleSaveName}
                                    >
                                        {updateTenantMut.isPending ? 'Speichert…' : 'Speichern'}
                                    </Button>
                                </div>
                            </section>

                            <section hidden={activeTab !== 'profile'} className="rounded-lg border border-border bg-surface p-5">
                                <h3 className="text-base font-semibold text-text-primary mb-4">
                                    Limits
                                </h3>
                                {detailQ.isLoading ? (
                                    <div className="text-xs text-text-muted">Lade…</div>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="flex items-end gap-2">
                                            <div className="flex-1 space-y-1">
                                                <Label htmlFor="tenant-max-users" className="text-xs">
                                                    Max. User ({MAX_USERS_MIN}-{MAX_USERS_MAX})
                                                </Label>
                                                <Input
                                                    id="tenant-max-users"
                                                    type="number"
                                                    min={MAX_USERS_MIN}
                                                    max={MAX_USERS_MAX}
                                                    step={1}
                                                    value={maxUsersInput}
                                                    onChange={(e) => {
                                                        if (!id) return;
                                                        setLimitsDraft({
                                                            tenantId: id,
                                                            maxUsers: e.target.value,
                                                            maxDevices: maxDevicesInput,
                                                        });
                                                    }}
                                                    disabled={!can('tenants.update') || !detail || updateLimitsMut.isPending}
                                                />
                                            </div>
                                            <div className="flex-1 space-y-1">
                                                <Label htmlFor="tenant-max-devices" className="text-xs">
                                                    Max. Geräte ({MAX_DEVICES_MIN}-{MAX_DEVICES_MAX})
                                                </Label>
                                                <Input
                                                    id="tenant-max-devices"
                                                    type="number"
                                                    min={MAX_DEVICES_MIN}
                                                    max={MAX_DEVICES_MAX}
                                                    step={1}
                                                    value={maxDevicesInput}
                                                    onChange={(e) => {
                                                        if (!id) return;
                                                        setLimitsDraft({
                                                            tenantId: id,
                                                            maxUsers: maxUsersInput,
                                                            maxDevices: e.target.value,
                                                        });
                                                    }}
                                                    disabled={!can('tenants.update') || !detail || updateLimitsMut.isPending}
                                                />
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={!can('tenants.update') || !detail || !limitsValid || updateLimitsMut.isPending}
                                                onClick={handleSaveLimits}
                                            >
                                                {updateLimitsMut.isPending ? 'Speichert…' : 'Speichern'}
                                            </Button>
                                        </div>
                                        {!limitsValid && detail && (
                                            <p className="text-xs text-status-danger">
                                                Erlaubt: {MAX_USERS_MIN}-{MAX_USERS_MAX} User,{' '}
                                                {MAX_DEVICES_MIN}-{MAX_DEVICES_MAX} Geräte (ganze Zahlen).
                                            </p>
                                        )}
                                    </div>
                                )}
                            </section>

                            {obHealth && (
                                <section hidden={activeTab !== 'onboarding'} className="rounded-lg border border-border bg-surface p-5">
                                    <h3 className="text-base font-semibold text-text-primary mb-4">
                                        Onboarding-Status
                                    </h3>
                                    <div className="space-y-1.5 text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className="text-text-muted">Status</span>
                                            {(() => {
                                                const m: Record<OnboardingRisk, { label: string; cls: string }> = {
                                                    live: { label: 'Live (aktiviert)', cls: 'bg-status-success/10 text-status-success' },
                                                    configured: { label: 'Konfiguriert', cls: 'bg-accent-500/10 text-accent-500' },
                                                    setup: { label: 'In Einrichtung', cls: 'bg-amber-500/10 text-amber-400 hell:text-amber-800' },
                                                    'at-risk': { label: 'Gefährdet', cls: 'bg-status-danger/10 text-status-danger' },
                                                };
                                                const r = m[obHealth.risk];
                                                return <span className={`px-2 py-0.5 rounded ${r.cls}`}>{r.label}</span>;
                                            })()}
                                        </div>
                                        <div className="text-text-muted">Plan: <span className="text-text-primary">{obHealth.planId ?? '—'}</span></div>
                                        <div className="text-text-muted">WhatsApp: <span className="text-text-primary">{obHealth.whatsappConfigured ? 'verbunden' : 'offen'}</span></div>
                                        <div className="text-text-muted">Aktiviert: <span className="text-text-primary">{obHealth.activatedAt ? formatDateTime(obHealth.activatedAt) : 'noch nicht'}</span></div>
                                        <div className="text-text-muted">Time-to-Value: <span className="text-text-primary">{obHealth.timeToActivationHours != null ? (obHealth.timeToActivationHours < 48 ? `${Math.round(obHealth.timeToActivationHours)} h` : `${Math.round(obHealth.timeToActivationHours / 24)} T`) : '—'}</span></div>
                                    </div>
                                </section>
                            )}

                            <section hidden={activeTab !== 'integrations'} className="rounded-lg border border-border bg-surface p-5">
                                <h3 className="text-base font-semibold text-text-primary mb-4">
                                    WhatsApp-Nummer
                                </h3>
                                {detailQ.isLoading ? (
                                    <div className="text-xs text-text-muted">Lade…</div>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="flex items-end gap-2">
                                            <div className="flex-1 space-y-1">
                                                <Label htmlFor="tenant-whatsapp" className="text-xs">
                                                    WhatsApp-Nummer (Bot-Zuordnung)
                                                </Label>
                                                <Input
                                                    id="tenant-whatsapp"
                                                    type="tel"
                                                    placeholder="+4915123456789"
                                                    value={whatsappInput}
                                                    onChange={(e) => {
                                                        if (!id) return;
                                                        setWhatsappDraft({
                                                            tenantId: id,
                                                            value: e.target.value,
                                                        });
                                                    }}
                                                    disabled={!detail || updateTenantMut.isPending}
                                                />
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={!detail || !whatsappValid || updateTenantMut.isPending}
                                                onClick={handleSaveWhatsapp}
                                            >
                                                {updateTenantMut.isPending ? 'Speichert…' : 'Speichern'}
                                            </Button>
                                        </div>
                                        {whatsappInput.length > 0 && !whatsappValid && (
                                            <p className="text-xs text-status-danger">
                                                Ungültiges Format — erwartet wird z.B. +4915123456789
                                                (10-15 Ziffern, optional +).
                                            </p>
                                        )}
                                        <p className="text-xs text-text-muted">
                                            Ohne Nummer empfängt der Kunde keine WhatsApp-Bestellungen.
                                        </p>
                                    </div>
                                )}
                            </section>

                            <section hidden={activeTab !== 'integrations'} className="rounded-lg border border-border bg-surface p-5">
                                <h3 className="text-base font-semibold text-text-primary mb-4">
                                    WhatsApp-Aktivierung (Meta Cloud)
                                </h3>
                                <div className="space-y-2">
                                    <div className="flex flex-wrap items-end gap-2">
                                        <div className="flex-1 min-w-[12rem] space-y-1">
                                            <Label htmlFor="tenant-meta-pnid" className="text-xs">
                                                Meta phone_number_id
                                            </Label>
                                            <Input
                                                id="tenant-meta-pnid"
                                                inputMode="numeric"
                                                placeholder="z.B. 1151047651429851"
                                                value={metaPnid}
                                                onChange={(e) => setMetaPnid(e.target.value)}
                                                disabled={metaSaving}
                                            />
                                        </div>
                                        <div className="w-36 space-y-1">
                                            <Label htmlFor="tenant-meta-waba" className="text-xs">
                                                WABA-ID (optional)
                                            </Label>
                                            <Input
                                                id="tenant-meta-waba"
                                                inputMode="numeric"
                                                placeholder="WABA-ID"
                                                value={metaWaba}
                                                onChange={(e) => setMetaWaba(e.target.value)}
                                                disabled={metaSaving}
                                            />
                                        </div>
                                        <Button size="sm" variant="outline" disabled={metaSaving} onClick={handleSaveMeta}>
                                            {metaSaving ? 'Speichert…' : 'Speichern'}
                                        </Button>
                                        <Button size="sm" variant="outline" disabled={metaTesting} onClick={handleTestMeta}>
                                            {metaTesting ? 'Teste…' : 'Verbindung testen'}
                                        </Button>
                                    </div>
                                    {metaTest && (
                                        <p className={`text-xs ${metaTest.ok ? 'text-status-success' : 'text-status-danger'}`}>
                                            {metaTest.ok
                                                ? `✓ Verbunden${metaTest.displayPhoneNumber ? ' — ' + metaTest.displayPhoneNumber : ''}${metaTest.verifiedName ? ' (' + metaTest.verifiedName + ')' : ''}`
                                                : `✗ ${metaTest.error ?? 'Verbindung fehlgeschlagen'}`}
                                        </p>
                                    )}
                                    <p className="text-xs text-text-muted">
                                        Aktivierungs-Schlüssel: Inbound-Routing UND Versand laufen über die
                                        phone_number_id. „Verbindung testen" pingt die Meta-Graph-API (kein Versand).
                                    </p>
                                </div>
                            </section>

                            <section hidden={activeTab !== 'access'} className="rounded-lg border border-border bg-surface p-5">
                                <h3 className="text-base font-semibold text-text-primary mb-4">
                                    Benutzer
                                </h3>
                                {detailQ.isLoading ? (
                                    <div className="text-xs text-text-muted">Lade…</div>
                                ) : detailQ.error ? (
                                    <p className="text-xs text-status-danger">
                                        {detailQ.error instanceof Error
                                            ? detailQ.error.message
                                            : 'Detail-Daten konnten nicht geladen werden.'}
                                    </p>
                                ) : !detail || detail.users.length === 0 ? (
                                    <p className="text-xs text-text-muted">Keine Benutzer vorhanden.</p>
                                ) : (
                                    <ul className="space-y-1">
                                        {detail.users.map((u) => (
                                            <li
                                                key={u.id}
                                                className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface/30 px-3 py-2 text-xs"
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-medium truncate">
                                                        {u.name || u.username}
                                                    </div>
                                                    <div className="text-text-muted truncate">
                                                        {u.email} · seit {formatRelative(u.created_at)}
                                                    </div>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-1.5">
                                                    <span className="rounded border border-border px-2 py-0.5 text-xs text-text-secondary">
                                                        {u.role}
                                                    </span>
                                                    <span
                                                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                                            u.is_active
                                                                ? 'bg-accent-500/12 text-accent-500'
                                                                : 'bg-status-danger-muted text-status-danger'
                                                        }`}
                                                    >
                                                        {u.is_active ? 'Aktiv' : 'Inaktiv'}
                                                    </span>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>

                            <section hidden={activeTab !== 'access'} className="rounded-lg border border-border bg-surface p-5">
                                <h3 className="text-base font-semibold text-text-primary mb-4">
                                    Aktive Geräte
                                </h3>
                                {devicesLoading ? (
                                    <div className="text-xs text-text-muted">Lade…</div>
                                ) : devicesError ? (
                                    <ErrorState
                                        className="px-3 py-4"
                                        title="Geräte konnten nicht geladen werden"
                                        message="Der aktuelle Session-Stand ist unbekannt. Es werden deshalb nicht fälschlich null aktive Geräte angezeigt."
                                        detail={
                                            devicesError instanceof Error
                                                ? devicesError.message
                                                : undefined
                                        }
                                        onRetry={refetchDevices}
                                    />
                                ) : devices.length === 0 ? (
                                    <p className="text-xs text-text-muted">Keine aktiven Geräte.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {!isSuperAdmin && (
                                            <p className="text-xs text-text-muted">
                                                Geräte können nur von Superadmins abgemeldet werden.
                                            </p>
                                        )}
                                        <ul className="space-y-1">
                                            {devices.map((d) => (
                                                <li
                                                    key={d.id}
                                                    className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface/30 px-3 py-2 text-xs"
                                                >
                                                    <div className="min-w-0 flex-1 space-y-0.5">
                                                        <div className="font-medium truncate">{d.user}</div>
                                                        <div className="flex flex-wrap gap-x-3 text-text-muted">
                                                            <span>
                                                                Letzte Aktivität:{' '}
                                                                {d.last_seen
                                                                    ? formatRelative(d.last_seen)
                                                                    : 'unbekannt'}
                                                            </span>
                                                            <span>IP: {d.ip ?? 'unbekannt'}</span>
                                                        </div>
                                                        {d.user_agent && (
                                                            <div
                                                                className="truncate text-text-muted"
                                                                title={d.user_agent}
                                                            >
                                                                {d.user_agent}
                                                            </div>
                                                        )}
                                                        <div
                                                            className="truncate font-mono text-[10px] text-text-muted"
                                                            title={d.device_id}
                                                        >
                                                            Geräte-ID: {d.device_id}
                                                        </div>
                                                    </div>
                                                    {isSuperAdmin && (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="shrink-0"
                                                            aria-label={`${d.user} von diesem Gerät abmelden`}
                                                            onClick={() => {
                                                                if (id != null) {
                                                                    setDeviceToRemove({ tenantId: id, device: d });
                                                                }
                                                            }}
                                                        >
                                                            Abmelden
                                                        </Button>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </section>

                            <section hidden={activeTab !== 'access'} className="rounded-lg border border-border bg-surface p-5">
                                <h3 className="text-base font-semibold text-text-primary mb-4">
                                    Aktionen
                                </h3>
                                <div className="flex gap-2 flex-wrap">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => void copyToClipboard(tenant.slug)}
                                    >
                                        Slug kopieren
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => nav(`/einstellungen/audit?tenant=${tenant.id}`)}
                                    >
                                        Audit anzeigen
                                    </Button>
                                    {can('users.resetPassword') && <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={detailQ.isLoading || !ownerUser}
                                        onClick={openResetDialog}
                                    >
                                        Passwort zurücksetzen
                                    </Button>}
                                    {can('tenants.impersonate') && <Button size="sm" variant="outline" onClick={handleImpersonate}>
                                        Händleransicht öffnen
                                    </Button>}
                                    {can('billing.manage') && (suspended ? (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={unsuspendMut.isPending}
                                            onClick={handleUnsuspend}
                                        >
                                            Reaktivieren
                                        </Button>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => setConfirmSuspend(true)}
                                        >
                                            Sperren
                                        </Button>
                                    ))}
                                </div>
                                {can('users.resetPassword') && !detailQ.isLoading && !ownerUser && <p className="mt-3 text-xs text-status-warning">Passwortreset gesperrt: Der Kontoinhaber ist nicht eindeutig aus den verfügbaren Nutzerdaten bestimmbar. Es wird kein Mitarbeiterkonto ersatzweise ausgewählt.</p>}
                            </section>
                        </>
                    )}
                </div>
        </div>

        <ConfirmDialog
            open={deviceToRemove !== null}
            onOpenChange={(open) => {
                if (!open && !removeDeviceMut.isPending) setDeviceToRemove(null);
            }}
            title="Gerät wirklich abmelden?"
            description={
                deviceToRemove
                    ? `${deviceToRemove.device.user} verliert die aktive Sitzung auf dem Gerät ${deviceToRemove.device.device_id}. Eine erneute Anmeldung ist erforderlich.`
                    : undefined
            }
            tone="danger"
            confirmLabel="Gerät abmelden"
            loading={removeDeviceMut.isPending}
            onConfirm={async () => {
                if (!deviceToRemove) return;
                try {
                    await removeDeviceMut.mutateAsync({
                        tenantId: deviceToRemove.tenantId,
                        deviceId: deviceToRemove.device.device_id,
                        sessionId: deviceToRemove.device.session_id,
                        userId: deviceToRemove.device.user_id,
                    });
                    toast.success('Gerät wurde abgemeldet.');
                    setDeviceToRemove(null);
                } catch (err) {
                    toast.error(
                        err instanceof Error ? err.message : 'Abmelden fehlgeschlagen.',
                    );
                }
            }}
        />

        <ConfirmDialog
            open={confirmSuspend}
            onOpenChange={setConfirmSuspend}
            title={tenant ? `${tenant.name} sperren?` : 'Sperren?'}
            description="Diesen Kunden wegen offener Zahlung sperren? Der Zugang wird sofort blockiert."
            tone="danger"
            confirmLabel="Sperren"
            loading={suspendMut.isPending}
            onConfirm={async () => {
                if (tenant && can('billing.manage')) {
                    try {
                        await suspendMut.mutateAsync(tenant.id);
                        toast.success(`${tenant.name} gesperrt.`);
                    } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Sperren fehlgeschlagen.');
                    }
                }
                setConfirmSuspend(false);
            }}
        />

        <Dialog
            open={resetOpen}
            onOpenChange={(open) => {
                if (resetBusy) return;
                setResetOpen(open);
                if (!open) {
                    // Passwort nie im State behalten, sobald der Dialog zu ist.
                    setResetPasswordInput('');
                    setResetResultPassword(null);
                }
            }}
        >
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Owner-Passwort zurücksetzen</DialogTitle>
                    <DialogDescription>
                        {ownerUser
                            ? `Setzt das Passwort von ${ownerUser.username} (${ownerUser.email}) direkt neu. Es wird KEINE E-Mail versendet — das Passwort selbst übermitteln.`
                            : 'Kein Owner-User gefunden (weder Rolle „merchant" noch ein aktiver User).'}
                    </DialogDescription>
                </DialogHeader>

                {resetResultPassword ? (
                    <div className="space-y-2">
                        <Label className="text-xs">Neues Passwort</Label>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 rounded-md border border-border bg-surface/30 px-3 py-2 font-mono text-sm break-all select-all">
                                {resetResultPassword}
                            </code>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    void copyToClipboard(resetResultPassword).then((ok) =>
                                        ok
                                            ? toast.success('Passwort kopiert.')
                                            : toast.error('Kopieren fehlgeschlagen.'),
                                    );
                                }}
                            >
                                Kopieren
                            </Button>
                        </div>
                        <p className="text-xs text-text-muted">
                            Wird nur einmal angezeigt — jetzt kopieren und sicher übermitteln.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <Label htmlFor="tenant-reset-password" className="text-xs">
                            Neues Passwort (12–128 Zeichen)
                        </Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="tenant-reset-password"
                                type={resetVisible ? 'text' : 'password'}
                                maxLength={128}
                                autoComplete="off"
                                spellCheck={false}
                                value={resetPasswordInput}
                                onChange={(e) => setResetPasswordInput(e.target.value)}
                                disabled={resetBusy || !ownerUser}
                            />
                            <Button type="button" size="icon" variant="ghost" aria-label={resetVisible ? 'Passwort verbergen' : 'Passwort anzeigen'} aria-pressed={resetVisible} onClick={() => setResetVisible(value => !value)}>{resetVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={resetBusy || !ownerUser}
                                onClick={() => setResetPasswordInput(generateSecurePassword())}
                            >
                                Generieren
                            </Button>
                        </div>
                    </div>
                )}

                <DialogFooter>
                    {resetResultPassword ? (
                        <Button variant="outline" onClick={() => setResetOpen(false)}>
                            Schließen
                        </Button>
                    ) : (
                        <>
                            <Button
                                variant="outline"
                                disabled={resetBusy}
                                onClick={() => setResetOpen(false)}
                            >
                                Abbrechen
                            </Button>
                            <Button
                                disabled={
                                    resetBusy ||
                                    !ownerUser ||
                                    !validTenantResetPassword(resetPasswordInput)
                                }
                                onClick={() => void handleResetPassword()}
                            >
                                {resetBusy ? 'Setzt…' : 'Passwort setzen'}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    );
}
