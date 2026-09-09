/**
 * TenantWizard — Multi-step wizard for creating a new tenant.
 *
 * Steps:
 *   1. Stammdaten (name, WhatsApp-Nummer Meta Cloud; Slug vergibt das Backend)
 *   2. Admin-Account (email, optionales Passwort — leer = Backend generiert)
 *   3. Limits (users, devices) — laufen im Create-Payload mit
 *   4. Rechnung & Steuer (IBAN/Nummernkreis/tax_profile/Logo — alles optional)
 *   5. Bestätigung
 *   + persistenter Erfolgs-Screen (einmaliges Initial-Passwort, WaWi-Status)
 *
 * Auto-saves wizard state to localStorage so a closed tab doesn't lose
 * progress. Das Passwort wird bewusst NICHT persistiert (kein Klartext im
 * Browser-Speicher) und beim Restore leer gelassen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Copy, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateTenant } from '@/hooks/useTenants';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useBeforeUnload } from '@/hooks/useBeforeUnload';
import type { CreateTenantResult, TenantBillingInput } from '@/api/tenants';
import { validateEmail } from '@/utils/validation/email';
import { copyToClipboard } from '@/utils/clipboard';
import { buildTenantTaxInput } from './tenantProvisioning';
import { TenantDemoPanel } from './TenantDemoPanel';
import { SEITEN_RAND_OHNE_BREITE } from '@/components/ui/seite';
import { cn } from '@/lib/utils';

interface WizardState {
    step: number;
    name: string;
    whatsapp: string;
    adminEmail: string;
    usersLimit: number;
    devicesLimit: number;
    // P1.1 — Rechnung (→ billing_design_settings)
    companyName: string;
    companyAddress: string;
    companyZip: string;
    companyCity: string;
    iban: string;
    bankName: string;
    bic: string;
    invoicePrefix: string;
    // P1.1 — Steuer (→ tax_profiles)
    businessType: '' | 'sole_trader' | 'company';
    smallBusiness: boolean;
    vatId: string;
    taxNumber: string;
    taxMethod: '' | 'IST' | 'SOLL';
    // G4 — AVV/DSGVO Art. 28 Zustimmung (Record-Keeping, kein Pflicht-Gate).
    dpaAccepted: boolean;
    demoEnabled: boolean;
    demoDays: number;
}

/** Alte Draft-Versionen persistierten zusätzlich Slug + Klartext-Passwort. */
type LegacyWizardState = WizardState & {
    slug?: string;
    slugManuallyEdited?: boolean;
    adminPassword?: string;
};

const INITIAL: WizardState = {
    step: 0,
    name: '',
    whatsapp: '',
    adminEmail: '',
    // Match the backend's canonical licence defaults. Operators can still
    // raise either value explicitly for a contracted plan.
    usersLimit: 10,
    devicesLimit: 5,
    companyName: '',
    companyAddress: '',
    companyZip: '',
    companyCity: '',
    iban: '',
    bankName: '',
    bic: '',
    invoicePrefix: 'RE-',
    businessType: '',
    smallBusiness: false,
    vatId: '',
    taxNumber: '',
    taxMethod: '',
    dpaAccepted: false,
    demoEnabled: false,
    demoDays: 14,
};

const STEPS = ['Stammdaten', 'Kontoinhaber', 'Nutzung', 'Rechnung & Steuer', 'Prüfen'];

/** Gleiche Normalisierung + Regex wie das Backend (400 bei Mismatch). */
const WHATSAPP_RE = /^\+?\d{10,15}$/;
function normalizeWhatsapp(num: string): string {
    return num.replace(/[\s\-()]/g, '');
}

export default function TenantWizard(): JSX.Element {
    const nav = useNavigate();
    const [state, setState] = useLocalStorage<WizardState>('admin.tenantWizard.draft', INITIAL);
    // Passwort NUR im Memory — niemals in den localStorage-Draft.
    // Logo NUR im Memory (base64 kann groß sein) — nicht in den localStorage-Draft.
    const [logoBase64, setLogoBase64] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const [result, setResult] = useState<CreateTenantResult | null>(null);
    const [setupLinkCopied, setSetupLinkCopied] = useState(false);
    const createMut = useCreateTenant();

    // Legacy-Drafts migrieren: Klartext-Passwort + Slug-Felder aus dem
    // localStorage entfernen, fehlende Felder auffüllen.
    useEffect(() => {
        setState((s) => {
            const legacy = s as LegacyWizardState;
            // Aktuelle Draft-Form (kennt companyName) unverändert lassen; alte/
            // partielle Drafts auf die volle Form normalisieren (neue Felder aus
            // INITIAL backfillen), damit keine Inputs auf undefined laufen.
            const isCurrentShape =
                legacy.adminPassword === undefined &&
                legacy.slug === undefined &&
                legacy.whatsapp !== undefined &&
                legacy.companyName !== undefined;
            if (isCurrentShape) {
                if (typeof s.demoEnabled === 'boolean' && typeof s.demoDays === 'number') return s;
                // Preserve billing/tax details from existing drafts when adding
                // the optional demo fields. No old draft becomes a demo implicitly.
                return { ...s, demoEnabled: false, demoDays: 14 };
            }
            return {
                ...INITIAL,
                step: legacy.step ?? 0,
                name: legacy.name ?? '',
                whatsapp: legacy.whatsapp ?? '',
                adminEmail: legacy.adminEmail ?? '',
                usersLimit: legacy.usersLimit ?? INITIAL.usersLimit,
                devicesLimit: legacy.devicesLimit ?? INITIAL.devicesLimit,
            };
        });
    }, [setState]);

    // CRM → Onboarding handoff: a deep-link from the CRM ("In Onboarding
    // übergeben") lands here with prefilled query params so the operator doesn't
    // re-type what sales already captured. Applied once, then cleared from the
    // URL. The operator stays in control (reviews + submits) — no auto-
    // provisioning from the weakly-authed CRM.
    const [searchParams, setSearchParams] = useSearchParams();
    const prefilledRef = useRef(false);
    useEffect(() => {
        if (prefilledRef.current) return;
        if ([...searchParams.keys()].length === 0) return;
        prefilledRef.current = true;
        const g = (k: string): string | undefined => searchParams.get(k) ?? undefined;
        const seats = Number(g('seats'));
        const small = g('smallBusiness');
        setState((s) => ({
            ...s,
            name: g('name') ?? s.name,
            adminEmail: g('email') ?? s.adminEmail,
            whatsapp: g('whatsapp') ?? s.whatsapp,
            companyName: g('company') ?? g('name') ?? s.companyName,
            companyCity: g('city') ?? s.companyCity,
            companyZip: g('zip') ?? s.companyZip,
            companyAddress: g('address') ?? s.companyAddress,
            vatId: g('vat') ?? s.vatId,
            taxNumber: g('taxNumber') ?? s.taxNumber,
            smallBusiness: small === '1' || small === 'true' ? true : s.smallBusiness,
            usersLimit: Number.isFinite(seats) && seats >= 1 && seats <= 100 ? seats : s.usersLimit,
        }));
        setSearchParams({}, { replace: true });
    }, [searchParams, setSearchParams, setState]);

    const isDirty = state.name !== '' || state.adminEmail !== '';
    // Passwort, Logo und Setup-Link existieren nur in dieser Browser-Sitzung.
    // Auch auf den letzten Wizard-Schritten darf ein Tab-Close sie nicht still
    // verwerfen (der übrige Formularentwurf liegt dagegen in localStorage).
    useBeforeUnload(
        result
            ? Boolean(result.user_created?.initial_password || result.setup_link)
            : Boolean(logoBase64 || isDirty),
    );

    const emailCheck = useMemo(() => validateEmail(state.adminEmail), [state.adminEmail]);
    const whatsappNormalized = normalizeWhatsapp(state.whatsapp ?? '');
    const whatsappValid = whatsappNormalized === '' || WHATSAPP_RE.test(whatsappNormalized);

    const demoDurationValid = !state.demoEnabled || (Number.isInteger(state.demoDays) && state.demoDays >= 1 && state.demoDays <= 90);

    function canProceed(): boolean {
        switch (state.step) {
            case 0:
                return state.name.trim().length >= 2 && whatsappValid;
            case 1:
                return emailCheck.valid;
            case 2:
                return (
                    Number.isInteger(state.usersLimit) &&
                    state.usersLimit >= 1 &&
                    state.usersLimit <= 100 &&
                    Number.isInteger(state.devicesLimit) &&
                    state.devicesLimit >= 1 &&
                    state.devicesLimit <= 50 && demoDurationValid
                );
            case 3:
                return true; // Rechnung & Steuer — alle Felder optional
            case 4:
                return true; // Bestätigung
            default:
                return false;
        }
    }

    function onLogoSelected(file: File | undefined): void {
        if (!file) return;
        if (file.size > 1_500_000) {
            toast.error('Logo zu groß (max. 1,5 MB).');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => setLogoBase64(String(reader.result || ''));
        reader.onerror = () => toast.error('Logo konnte nicht gelesen werden.');
        reader.readAsDataURL(file);
    }

    async function submit(): Promise<void> {
        // Persistierte/CRM-vorbefüllte Drafts können den Stepper umgehen. Vor
        // dem irreversiblen Provisioning deshalb alle Pflichtschritte noch
        // einmal gemeinsam prüfen und den Operator zum ersten Fehler führen.
        const invalidStep =
            state.name.trim().length < 2 || !whatsappValid
                ? 0
                : !emailCheck.valid
                  ? 1
                  : !Number.isInteger(state.usersLimit) ||
                      state.usersLimit < 1 ||
                      state.usersLimit > 100 ||
                      !Number.isInteger(state.devicesLimit) ||
                      state.devicesLimit < 1 ||
                      state.devicesLimit > 50 || !demoDurationValid
                    ? 2
                    : null;
        if (invalidStep !== null) {
            setState((current) => ({ ...current, step: invalidStep }));
            toast.error('Bitte korrigiere die markierten Pflichtangaben.');
            return;
        }
        if (submittingRef.current) return; // double-click / double-fire guard
        submittingRef.current = true;
        setSubmitting(true);
        try {
            // Befund B2: Limits laufen im Create-Payload mit — die Anlage ist
            // damit ein einziger Call, kein nachgelagerter (verlierbarer)
            // PATCH /limits mehr.
            const billing: TenantBillingInput = {};
            if (state.companyName.trim()) billing.company_name = state.companyName.trim();
            if (state.companyAddress.trim()) billing.company_address = state.companyAddress.trim();
            if (state.companyZip.trim()) billing.company_zip = state.companyZip.trim();
            if (state.companyCity.trim()) billing.company_city = state.companyCity.trim();
            if (state.iban.trim()) billing.iban = state.iban.replace(/\s+/g, '');
            if (state.bankName.trim()) billing.bank_name = state.bankName.trim();
            if (state.bic.trim()) billing.bic = state.bic.trim().toUpperCase();
            if (state.invoicePrefix.trim()) billing.invoice_prefix = state.invoicePrefix.trim();
            if (logoBase64) billing.logo_base64 = logoBase64;

            // Backend schreibt tax_profiles und schaltet onboarding_status auf
            // „configured", sobald zusätzlich die Rechnungs-Identität steht.
            // Auch eine alleinige IST/SOLL-Auswahl ist eine Steuerentscheidung.
            const tax = buildTenantTaxInput(state);

            const created = await createMut.mutateAsync({
                name: state.name.trim(),
                email: state.adminEmail.trim(),
                max_users: state.usersLimit,
                max_devices: state.devicesLimit,
                ...(whatsappNormalized ? { whatsapp_number: whatsappNormalized } : {}),
                ...(Object.keys(billing).length ? { billing } : {}),
                ...(tax ? { tax } : {}),
                ...(state.dpaAccepted ? { dpa_accepted: true } : {}),
                ...(state.demoEnabled ? { demo: { days: state.demoDays } } : {}),
            });

            setState(() => INITIAL); // Draft leeren
            setResult(created); // persistenter Erfolgs-Screen statt flüchtigem Toast
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen.');
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    }

    // ------------------------------------------------------------------
    // Erfolgs-Screen (persistent — Initial-Passwort wird nur einmal geliefert)
    // ------------------------------------------------------------------
    if (result) {

        return (
            <div className={cn(SEITEN_RAND_OHNE_BREITE, 'mx-auto max-w-3xl')}>
                <header className="mb-6">
                    <h1 className="text-2xl font-display font-semibold tracking-tight">
                        Händlerdatensatz angelegt
                    </h1>
                    <p className="text-sm text-text-secondary">
                        „{result.name}" wurde erfolgreich erstellt.
                    </p>
                </header>

                <div className="mb-5"><TenantDemoPanel tenantId={String(result.id)} /></div>
                <div className="rounded-md border border-border bg-surface/40 p-6 space-y-4">
                    <div className="flex items-center gap-2 text-sm text-success">
                        <Check className="size-4" />
                        <span>
                            Kunde „{result.name}" ({result.email}) wurde angelegt.
                        </span>
                    </div>

                    {!result.wawi_synced && (
                        <div className="flex items-start gap-2 rounded-md border border-warning bg-warning-muted p-3 text-sm text-warning">
                            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                            <span>WaWi nicht erreichbar — Kunde lokal angelegt.</span>
                        </div>
                    )}

                    <div
                        className={cn(
                            'flex items-start gap-2 rounded-md border p-3 text-sm',
                            result.welcome_email_sent
                                ? 'border-success/40 bg-success/10 text-success'
                                : 'border-warning bg-warning-muted text-warning',
                        )}
                    >
                        {result.welcome_email_sent ? (
                            <Check className="size-4 shrink-0 mt-0.5" />
                        ) : (
                            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                        )}
                        <span>
                            {result.welcome_email_sent
                                ? `Willkommens-E-Mail wurde an ${result.email} gesendet.`
                                : 'Willkommens-E-Mail wurde nicht gesendet. Den Setup-Link jetzt manuell sicher übermitteln.'}
                        </span>
                    </div>

                    {result.setup_link && (
                        <div className="space-y-2">
                            <Label>Einmaliger Setup-Link</Label>
                            <div className="break-all rounded-md border border-border bg-surface p-3 font-mono text-xs">
                                {result.setup_link}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                    const ok = await copyToClipboard(result.setup_link ?? '');
                                    if (ok) {
                                        setSetupLinkCopied(true);
                                        toast.success('Setup-Link kopiert.');
                                        setTimeout(() => setSetupLinkCopied(false), 2000);
                                    } else {
                                        toast.error('Kopieren fehlgeschlagen — bitte manuell kopieren.');
                                    }
                                }}
                            >
                                {setupLinkCopied ? (
                                    <>
                                        <Check className="size-3" /> Kopiert
                                    </>
                                ) : (
                                    <>
                                        <Copy className="size-3" /> Setup-Link kopieren
                                    </>
                                )}
                            </Button>
                            <p className="text-xs text-warning font-medium">
                                Der Link setzt das Händler-Passwort und ist vertraulich. Nicht in
                                Tickets oder unverschlüsselte Notizen kopieren.
                            </p>
                        </div>
                    )}

                    <p className="text-sm text-text-secondary">Der Händler legt sein Passwort selbst über den einmaligen Einladungslink fest. Die Anlage ist der erste Schritt; Einrichtung und Freigabe werden im Händlerdatensatz fortgeführt.</p>
                </div>

                <div className="flex justify-end mt-6">
                    <Button onClick={() => nav(`/tenants/${result.id}?tab=onboarding`)}>
                        Einrichtung fortsetzen <ArrowRight className="size-4" />
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className={cn(SEITEN_RAND_OHNE_BREITE, 'mx-auto max-w-3xl')}>
            <header className="mb-6">
                <h1 className="text-2xl font-display font-semibold tracking-tight">Händler einrichten</h1>
                <p className="text-sm text-text-secondary">Stammdaten und Zugang vorbereiten. Anschließend folgen Integration, Prüfung und Freigabe.</p>
            </header>

            {/* Stepper */}
            <ol className="grid grid-cols-2 gap-3 mb-8 sm:grid-cols-5" aria-label="Wizard Steps">
                {STEPS.map((label, idx) => (
                    <li
                        key={label}
                        className={cn(
                            'flex items-center gap-2 text-xs font-medium',
                            idx === state.step && 'text-text-primary',
                            idx < state.step && 'text-accent-500',
                            idx > state.step && 'text-text-muted',
                        )}
                    >
                        <span
                            className={cn(
                                'size-5 rounded-full flex items-center justify-center text-[10px] border',
                                idx === state.step && 'border-accent-500 bg-accent-500 text-white',
                                idx < state.step && 'border-accent-500 text-accent-500',
                                idx > state.step && 'border-border',
                            )}
                        >
                            {idx < state.step ? <Check className="size-3" /> : idx + 1}
                        </span>
                        <span>{label}</span>
                    </li>
                ))}
            </ol>

            <div className="rounded-md border border-border bg-surface/40 p-6 space-y-4">
                {state.step === 0 && (
                    <>
                        <div className="space-y-2">
                            <Label htmlFor="t-name">Kundenname (Firma)</Label>
                            <Input
                                id="t-name"
                                value={state.name}
                                onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
                                placeholder="Acme Auto Parts"
                                autoFocus
                            />
                            <p className="text-xs text-text-muted">
                                Der Slug wird automatisch vergeben.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="t-whatsapp">WhatsApp-Nummer (Meta Cloud)</Label>
                            <Input
                                id="t-whatsapp"
                                type="tel"
                                value={state.whatsapp ?? ''}
                                onChange={(e) =>
                                    setState((s) => ({ ...s, whatsapp: e.target.value }))
                                }
                                placeholder="+49 151 23456789"
                            />
                            {state.whatsapp && !whatsappValid && (
                                <p className="text-xs text-status-danger">
                                    Ungültige Nummer — erwartet werden 10–15 Ziffern, optional mit
                                    führendem +.
                                </p>
                            )}
                            <p className="text-xs text-text-muted">
                                Die WhatsApp-Nummer des Händlers (Meta Cloud API) — ohne sie kann
                                der Kunde keine WhatsApp-Bestellungen empfangen.
                            </p>
                        </div>
                    </>
                )}

                {state.step === 1 && (
                    <>
                        <div className="space-y-2">
                            <Label htmlFor="t-email">E-Mail des Kontoinhabers</Label>
                            <Input
                                id="t-email"
                                type="email"
                                value={state.adminEmail}
                                onChange={(e) => setState((s) => ({ ...s, adminEmail: e.target.value }))}
                                placeholder="admin@acme.de"
                                autoFocus
                            />
                            {state.adminEmail && !emailCheck.valid && (
                                <p className="text-xs text-status-danger">{emailCheck.errors[0]}</p>
                            )}
                        </div>
                        <div className="rounded-md border border-border bg-elevated p-4 text-sm text-text-secondary">Der Kontoinhaber erhält eine persönliche Einladung per E-Mail und legt sein Passwort selbst fest. Prüfe die Adresse mit dem Händler vor der Anlage.</div>
                    </>
                )}

                {state.step === 2 && (
                    <>
                        <div className="space-y-3 rounded-lg border border-border bg-surface/40 p-4">
                            <label className="flex items-start gap-3" htmlFor="t-demo"><input id="t-demo" type="checkbox" className="mt-1 h-4 w-4" checked={state.demoEnabled ?? false} onChange={event => setState(s => ({ ...s, demoEnabled: event.target.checked }))} /><span><strong>Als Händler-Demo anlegen</strong><span className="mt-1 block text-sm text-text-secondary">Vollständige App mit sichtbarer Demo-Kennzeichnung und zeitlich begrenztem Zugang.</span></span></label>
                            {state.demoEnabled && <div className="space-y-2"><Label htmlFor="t-demo-days">Demodauer in Tagen</Label><Input id="t-demo-days" type="number" min={1} max={90} step={1} value={state.demoDays} onChange={event => setState(s => ({ ...s, demoDays: Number(event.target.value) }))} /><p className="text-xs text-text-muted">1–90 Tage ab der erfolgreichen Händleranlage. Die Daten bleiben nach Ablauf erhalten.</p></div>}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="t-users">User-Limit</Label>
                            <Input
                                id="t-users"
                                type="number"
                                min={1}
                                max={100}
                                value={state.usersLimit}
                                onChange={(e) => setState((s) => ({ ...s, usersLimit: parseInt(e.target.value, 10) || 0 }))}
                            />
                            <p className="text-xs text-text-muted">Erlaubt: 1–100.</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="t-devices">Device-Limit</Label>
                            <Input
                                id="t-devices"
                                type="number"
                                min={1}
                                max={50}
                                value={state.devicesLimit}
                                onChange={(e) =>
                                    setState((s) => ({ ...s, devicesLimit: parseInt(e.target.value, 10) || 0 }))
                                }
                            />
                            <p className="text-xs text-text-muted">Erlaubt: 1–50.</p>
                        </div>
                    </>
                )}

                {state.step === 3 && (
                    <div className="space-y-6">
                        <p className="text-xs text-text-muted">
                            Optional — pflegbar auch später unter „Rechnungseinstellungen".
                            Vollständig ausgefüllt (Firma + IBAN + Steuerentscheidung) ist der
                            Kunde sofort rechnungsfähig (Onboarding „konfiguriert").
                        </p>

                        {/* Firmenanschrift (Rechnungskopf) */}
                        <div className="space-y-3">
                            <h3 className="text-xs font-mono uppercase tracking-widest text-text-secondary">
                                Firmenanschrift (Rechnungskopf)
                            </h3>
                            <div className="space-y-2">
                                <Label htmlFor="t-company">Firmenname auf der Rechnung</Label>
                                <Input
                                    id="t-company"
                                    value={state.companyName ?? ''}
                                    onChange={(e) => setState((s) => ({ ...s, companyName: e.target.value }))}
                                    placeholder={state.name || 'Acme Auto Parts GmbH'}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="t-addr">Straße & Nr.</Label>
                                <Input
                                    id="t-addr"
                                    value={state.companyAddress ?? ''}
                                    onChange={(e) => setState((s) => ({ ...s, companyAddress: e.target.value }))}
                                    placeholder="Musterstraße 1"
                                />
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-2">
                                    <Label htmlFor="t-zip">PLZ</Label>
                                    <Input
                                        id="t-zip"
                                        value={state.companyZip ?? ''}
                                        onChange={(e) => setState((s) => ({ ...s, companyZip: e.target.value }))}
                                        placeholder="10115"
                                    />
                                </div>
                                <div className="space-y-2 col-span-2">
                                    <Label htmlFor="t-city">Ort</Label>
                                    <Input
                                        id="t-city"
                                        value={state.companyCity ?? ''}
                                        onChange={(e) => setState((s) => ({ ...s, companyCity: e.target.value }))}
                                        placeholder="Berlin"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Bank & Nummernkreis */}
                        <div className="space-y-3">
                            <h3 className="text-xs font-mono uppercase tracking-widest text-text-secondary">
                                Bank & Nummernkreis
                            </h3>
                            <div className="space-y-2">
                                <Label htmlFor="t-iban">IBAN</Label>
                                <Input
                                    id="t-iban"
                                    value={state.iban ?? ''}
                                    onChange={(e) => setState((s) => ({ ...s, iban: e.target.value }))}
                                    className="font-mono"
                                    placeholder="DE00 0000 0000 0000 0000 00"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label htmlFor="t-bank">Bank</Label>
                                    <Input
                                        id="t-bank"
                                        value={state.bankName ?? ''}
                                        onChange={(e) => setState((s) => ({ ...s, bankName: e.target.value }))}
                                        placeholder="Sparkasse"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="t-bic">BIC</Label>
                                    <Input
                                        id="t-bic"
                                        value={state.bic ?? ''}
                                        onChange={(e) => setState((s) => ({ ...s, bic: e.target.value }))}
                                        className="font-mono"
                                        placeholder="XXXXDEXX"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="t-prefix">Rechnungs-Nummernkreis (Präfix)</Label>
                                <Input
                                    id="t-prefix"
                                    value={state.invoicePrefix ?? ''}
                                    onChange={(e) => setState((s) => ({ ...s, invoicePrefix: e.target.value }))}
                                    className="font-mono"
                                    placeholder="RE-"
                                />
                                <p className="text-xs text-text-muted">
                                    Format {'{Präfix}{Jahr}-{laufende Nr.}'} — z.B.{' '}
                                    <span className="font-mono">{(state.invoicePrefix || 'RE-')}2026-00001</span>.
                                </p>
                            </div>
                        </div>

                        {/* Steuerprofil */}
                        <div className="space-y-3">
                            <h3 className="text-xs font-mono uppercase tracking-widest text-text-secondary">
                                Steuerprofil
                            </h3>
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={state.smallBusiness ?? false}
                                    onChange={(e) => setState((s) => ({ ...s, smallBusiness: e.target.checked }))}
                                    className="size-4 rounded border-border"
                                />
                                Kleinunternehmer nach §19 UStG (keine USt ausweisen)
                            </label>
                            <p className="text-xs text-text-muted -mt-1">
                                Autoteile-Hinweis: Die <strong>Differenzbesteuerung (§25a)</strong> für Gebrauchtteile
                                wird <strong>pro Artikel</strong> gesetzt (Artikel-Flag → Margenschema), nicht hier
                                global. Hier nur zwischen Regelbesteuerung und §19 entscheiden.
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label htmlFor="t-vat">USt-IdNr.</Label>
                                    <Input
                                        id="t-vat"
                                        value={state.vatId ?? ''}
                                        onChange={(e) => setState((s) => ({ ...s, vatId: e.target.value }))}
                                        className="font-mono"
                                        placeholder="DE123456789"
                                        disabled={state.smallBusiness}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="t-taxno">Steuernummer</Label>
                                    <Input
                                        id="t-taxno"
                                        value={state.taxNumber ?? ''}
                                        onChange={(e) => setState((s) => ({ ...s, taxNumber: e.target.value }))}
                                        className="font-mono"
                                        placeholder="12/345/67890"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label htmlFor="t-bt">Rechtsform</Label>
                                    <select
                                        id="t-bt"
                                        value={state.businessType ?? ''}
                                        onChange={(e) => setState((s) => ({ ...s, businessType: e.target.value as WizardState['businessType'] }))}
                                        className="flex h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                                    >
                                        <option value="">— wählen —</option>
                                        <option value="sole_trader">Einzelunternehmer</option>
                                        <option value="company">Gesellschaft (GmbH/UG/…)</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="t-tm">Besteuerung</Label>
                                    <select
                                        id="t-tm"
                                        value={state.taxMethod ?? ''}
                                        onChange={(e) => setState((s) => ({ ...s, taxMethod: e.target.value as WizardState['taxMethod'] }))}
                                        className="flex h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                                    >
                                        <option value="">— Standard (Soll) —</option>
                                        <option value="SOLL">Soll-Versteuerung</option>
                                        <option value="IST">Ist-Versteuerung</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* AVV / DSGVO Art. 28 */}
                        <div className="space-y-3">
                            <h3 className="text-xs font-mono uppercase tracking-widest text-text-secondary">
                                Auftragsverarbeitung (AVV)
                            </h3>
                            <label className="flex items-start gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={state.dpaAccepted ?? false}
                                    onChange={(e) => setState((s) => ({ ...s, dpaAccepted: e.target.checked }))}
                                    className="size-4 rounded border-border mt-0.5"
                                />
                                <span>
                                    AVV nach Art. 28 DSGVO mit dem Händler abgeschlossen / akzeptiert
                                    <span className="block text-xs text-text-muted">
                                        Wird mit Datum, Version und Bearbeiter dokumentiert (Nachweis). Kein Pflicht-Gate —
                                        kann auch später erfasst werden.
                                    </span>
                                </span>
                            </label>
                        </div>

                        {/* Logo */}
                        <div className="space-y-3">
                            <h3 className="text-xs font-mono uppercase tracking-widest text-text-secondary">
                                Logo (für Rechnungs-PDF)
                            </h3>
                            {logoBase64 ? (
                                <div className="flex items-center gap-3">
                                    <img
                                        src={logoBase64}
                                        alt="Logo-Vorschau"
                                        className="h-12 w-auto rounded border border-border bg-white p-1"
                                    />
                                    <Button variant="outline" size="sm" onClick={() => setLogoBase64('')}>
                                        <X className="size-3" /> Entfernen
                                    </Button>
                                </div>
                            ) : (
                                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50">
                                    <Upload className="size-4" />
                                    Logo wählen (PNG/JPG, max. 1,5 MB)
                                    <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        className="hidden"
                                        onChange={(e) => onLogoSelected(e.target.files?.[0])}
                                    />
                                </label>
                            )}
                        </div>
                    </div>
                )}

                {state.step === 4 && (
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                        <dt className="text-text-secondary">Kontotyp</dt>
                        <dd className="font-semibold">{state.demoEnabled ? `DEMO · ${state.demoDays} Tage` : 'Kundenkonto'}</dd>
                        <dt className="text-text-secondary">Name</dt>
                        <dd>{state.name}</dd>
                        <dt className="text-text-secondary">WhatsApp-Nummer</dt>
                        <dd className="font-mono">{whatsappNormalized || '—'}</dd>
                        <dt className="text-text-secondary">Admin-Email</dt>
                        <dd>{state.adminEmail}</dd>
                        <dt className="text-text-secondary">Passwort</dt>
                        <dd>Persönliche Einladung per E-Mail</dd>
                        <dt className="text-text-secondary">User-Limit</dt>
                        <dd className="font-mono">{state.usersLimit}</dd>
                        <dt className="text-text-secondary">Device-Limit</dt>
                        <dd className="font-mono">{state.devicesLimit}</dd>
                        <dt className="text-text-secondary">IBAN</dt>
                        <dd className="font-mono">{state.iban ? state.iban.replace(/\s+/g, '') : '—'}</dd>
                        <dt className="text-text-secondary">Steuer</dt>
                        <dd>
                            {state.smallBusiness
                                ? 'Kleinunternehmer §19'
                                : state.vatId
                                  ? `USt-ID ${state.vatId}`
                                  : '—'}
                        </dd>
                        <dt className="text-text-secondary">Logo</dt>
                        <dd>{logoBase64 ? 'hochgeladen' : '—'}</dd>
                        <dt className="text-text-secondary">Onboarding</dt>
                        <dd>
                            {state.companyName && state.iban && (state.smallBusiness || state.vatId)
                                ? 'konfiguriert (sofort rechnungsfähig)'
                                : 'ausstehend (später konfigurierbar)'}
                        </dd>
                    </dl>
                )}
            </div>

            <div className="flex items-center justify-between mt-6">
                <Button
                    variant="outline"
                    onClick={() => {
                        if (state.step === 0) nav('/tenants');
                        else setState((s) => ({ ...s, step: s.step - 1 }));
                    }}
                >
                    <ArrowLeft className="size-4" /> Zurück
                </Button>
                {state.step < STEPS.length - 1 ? (
                    <Button
                        disabled={!canProceed()}
                        onClick={() => setState((s) => ({ ...s, step: s.step + 1 }))}
                    >
                        Weiter <ArrowRight className="size-4" />
                    </Button>
                ) : (
                    <Button disabled={submitting} onClick={() => void submit()}>
                        {submitting ? 'Erstelle…' : 'Kunde erstellen'}
                    </Button>
                )}
            </div>
        </div>
    );
}
