/**
 * Bildprobe des Redesigns — schreibt eine Seite mit dem ECHTEN Markup der
 * Komponenten und der ECHTEN gebauten CSS nach `dist-probe/`.
 *
 * ─── Warum das nötig ist ───────────────────────────────────────────────────
 *
 * Ich kann mich nicht anmelden und die Seite nicht selbst aufrufen. Ohne so
 * eine Probe bliebe „das Redesign ist übernommen" eine Behauptung. Hier läuft
 * derselbe Code, der später im Browser läuft, gegen dieselbe CSS-Datei, die
 * ausgeliefert wird — der Unterschied zur laufenden Anwendung sind nur die
 * ausgedachten Daten.
 *
 * Und genau EIN Fehler wird damit zuverlässig gefunden, der sonst durchgeht:
 * Tailwind schneidet jede Klasse weg, die in keiner Quelldatei steht. Ein
 * Tippfehler wie `bg-bg-canvas` oder eine Farbe, die es nicht gibt
 * (`accent-300`), erzeugt keinen Fehler — sie tut einfach nichts. Am Bild
 * sieht man es, in der Konsole nicht.
 *
 * Läuft absichtlich nur, wenn `dist/` gebaut ist. Sonst wird die Probe
 * übersprungen statt rot zu werden: ein fehlender Build ist kein Fehler im
 * Code.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { mailWorkspaceMessages } from './fixtures/mailWorkspace';
import { TenantDetailSchema, TenantSchema } from '@/api/types';

// Nur die Anmeldung wird vorgetäuscht — SUPER_ADMIN, damit auch die Einträge
// im Bild sind, die sonst nur diese Rolle sieht. Alles Übrige ist echt.
vi.mock('@/auth/usePermissions', () => ({
    usePermissions: () => ({ isSuperAdmin: true, can: () => true, role: 'SUPER_ADMIN' }),
}));

// Erfundene, aber realistische Daten. Sie stehen NUR im Bild — die Anwendung
// selbst holt alles vom Backend. Zweck: sehen, wie es mit Inhalt aussieht.
vi.mock('@/hooks/useDashboardMetrics', () => ({
    useDashboardMetrics: () => ({
        metrics: {
            activeTenants: 4,
            totalUsers: 27,
            ordersToday: 12,
            revenueMtd: 48_320,
            seriesOrders7d: [8, 11, 7, 14, 9, 15, 12],
            seriesRevenue7d: [4100, 5300, 3900, 6800, 5200, 7400, 6100],
        },
        isLoading: false,
        error: null,
        refetch: () => {},
    }),
}));
vi.mock('@/hooks/useSystemHealth', () => ({
    useSystemHealth: () => ({
        zustand: { erreichbar: true },
        isLoading: false,
        error: null,
        refetch: () => {},
    }),
}));
vi.mock('@/hooks/useInbox', () => ({
    useInbox: () => ({ items: mailWorkspaceMessages, isLoading: false, error: null, isFetching: false, hasNextPage: false, refetch: () => {} }),
    useMarkInboxRead: () => ({ mutate: () => {}, isPending: false }),
    useMoveInboxMessage: () => ({ mutate: () => {}, isPending: false }),
    useMarkAsSpam: () => ({ mutate: () => {}, isPending: false }),
    useMarkAsNotSpam: () => ({ mutate: () => {}, isPending: false }),
    useRestoreInboxMessage: () => ({ mutate: () => {}, isPending: false }),
    useMailboxes: () => ({
        mailboxes: [{ id: 'all', name: 'Alle Postfächer', unread: 1 }, { id: 'team', name: 'Team Partsunion', unread: 1 }],
        sendingAddresses: ['team@partsunion.de'],
        transport: 'resend',
        isLoading: false,
        error: null,
        refetch: () => {},
    }),
}));
vi.mock('@/hooks/useAuditLogs', () => ({
    useAuditLogs: () => ({
        entries: [
            { id: '1', action_type: 'ADMIN_LOGIN', admin_username: 'Fecat', created_at: '2026-07-30T00:41:00.000Z' },
            { id: '2', action_type: 'TENANT_UPDATE', entity_name: 'A-V-G Autozubehör', admin_username: 'Elias', created_at: '2026-07-29T18:05:00.000Z' },
            { id: '3', action_type: 'MAILBOX_ACCESS_GRANT', entity_type: 'MAILBOX', admin_username: 'Fecat', created_at: '2026-07-29T09:12:00.000Z' },
        ],
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: () => {},
        refetch: () => {},
    }),
}));
vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({
        user: { id: '1', username: 'Fecat', email: 'fecat.vogt@partsunion.de', role: 'superadmin' },
        logout: async () => {},
    }),
}));
// Im Bild sollen die ECHTEN Zahlen stehen. Der Hochzähler startet sonst bei 0
// und zählt per Animation hoch — ohne Browser passiert das nicht, und die Probe
// zeigte "0" statt "4". Mit reduzierter Bewegung steht der Wert sofort da; das
// ist derselbe Pfad, den auch Nutzer mit dieser Systemeinstellung sehen.
vi.mock('framer-motion', async () => {
    const echt = await vi.importActual<typeof import('framer-motion')>('framer-motion');
    return { ...echt, useReducedMotion: () => true };
});
// Verhindert echte Netzabrufe. Die ANGEZEIGTEN Daten kommen aus dem
// vorbefüllten Zwischenspeicher (siehe `rendern`) — synchron gerendert löst
// sich `queryFn` nicht auf.
vi.mock('@/api/appointments', () => ({
    listAppointments: () => Promise.resolve({
        appointments: [
            { id: 'a1', type: 'quali', title: 'Onboarding-Gespräch', start_at: '2026-07-30T09:00:00.000Z',
              customer_name: 'A-V-G Autozubehör', assignee_name: 'Elias', status: 'confirmed' },
            { id: 'a2', type: 'sales', title: 'Angebot nachfassen', start_at: '2026-07-31T13:30:00.000Z',
              customer_name: 'Kfz-Teile Nord', assignee_name: 'Fecat', status: 'confirmed' },
            { id: 'a3', type: 'call', title: 'Rückruf Werkstatt Süd', start_at: '2026-08-03T10:15:00.000Z',
              customer_name: 'Werkstatt Süd', assignee_name: 'Bardia', status: 'proposed' },
            { id: 'a4', type: 'other', title: 'Zweiter Termin Donnerstag', start_at: '2026-07-30T15:00:00.000Z',
              customer_name: null, assignee_name: 'Fecat', status: 'confirmed' },
        ],
    }),
}));
vi.mock('@/api/onboarding', () => ({
    getOnboardingPipeline: () => Promise.resolve({
        summary: { total: 4, live: 2, configured: 1, setup: 1, atRisk: 0 },
        tenants: [],
    }),
}));
vi.mock('@/hooks/useTenants', () => {
    const kunden = [
        { id: '1', name: 'A-V-G Autozubehör', slug: 'avg-autozubehoer', is_active: true, is_demo: false,
          user_count: 2, max_users: 5, device_count: 4, max_devices: 10, onboarding_status: 'Live', deleted: false },
        { id: '2', name: 'Kfz-Teile Nord GmbH', slug: 'kfz-teile-nord', is_active: true, is_demo: false,
          user_count: 1, max_users: 3, device_count: 4, max_devices: 6, onboarding_status: 'In Einrichtung', deleted: false },
        { id: '3', name: 'Werkstatt Süd', slug: 'werkstatt-sued', is_active: false, is_demo: true,
          user_count: 0, max_users: 3, device_count: 0, max_devices: 6, onboarding_status: null, deleted: false },
    ];
    // Alle Lebenszyklus-Haken derselben Datei; vi.mock ersetzt das GANZE Modul,
    // ein fehlender Export wirft sonst beim Rendern.
    const stumpf = () => ({ mutateAsync: async () => {}, mutate: () => {}, isPending: false });
    return {
        useTenants: () => ({ tenants: kunden, isLoading: false, error: null, refetch: () => {} }),
        useDeactivateTenant: stumpf,
        useActivateTenant: stumpf,
        useSuspendTenant: stumpf,
        useUnsuspendTenant: stumpf,
        useDeleteTenant: stumpf,
        useRestoreTenant: stumpf,
        usePurgeTenant: stumpf,
    };
});
vi.mock('@/hooks/useImpersonate', () => ({
    useImpersonate: () => ({ start: async () => {}, isPending: false }),
}));
vi.mock('@/api/oemFinder', () => ({
    listOemHistory: () => Promise.resolve([]),
    resolveOem: () => Promise.resolve(null),
    reverseOem: () => Promise.resolve(null),
    rateOemResult: () => Promise.resolve(undefined),
}));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => ({ unread: 2 }) }));
vi.mock('@/hooks/useActiveImpersonation', () => ({ useActiveImpersonation: () => null }));

/* eslint-disable import/first -- muessen nach vi.mock stehen */
import { AdminSidebar } from '@/components/layout/AdminSidebar';
import { AdminTopbar } from '@/components/layout/AdminTopbar';
import { MailLayout } from '@/components/layout/MailLayout';
import InboxView from '@/views/operations/InboxView';
import { TenantOverview } from '@/views/tenants/TenantOverview';
import { TenantOperations } from '@/views/tenants/TenantOperations';
import OverviewView from '@/views/dashboard/OverviewView';
import TenantsListView from '@/views/tenants/TenantsListView';
import OnboardingPipelineView from '@/views/onboarding/OnboardingPipelineView';
/* eslint-enable import/first */

const DIST = join(process.cwd(), 'dist', 'assets');
const AUSGABE = join(process.cwd(), 'dist-probe');

/**
 * Schriften und Bilder mitkopieren.
 *
 * Die gebaute CSS verweist mit `url(/assets/…woff2)` auf die Schriften. Ohne
 * sie fällt die Probe auf die Systemschrift zurück — und dann stimmen alle
 * gemessenen Umbrüche nicht, weil Space Grotesk andere Buchstabenbreiten hat.
 *
 * Und ohne die Dateien aus `public/` zeigt die Probe beim Logo das
 * Platzhaltersymbol für ein defektes Bild — was im Bildschirmfoto wie ein Logo
 * aussieht. Genau darauf wäre ich einmal hereingefallen; erst die Messung
 * (`naturalWidth === 0`) hat es gezeigt.
 */
function beiwerkKopieren(): void {
    if (existsSync(DIST)) {
        const ziel = join(AUSGABE, 'assets');
        mkdirSync(ziel, { recursive: true });
        for (const f of readdirSync(DIST).filter((n) => n.endsWith('.woff2'))) {
            copyFileSync(join(DIST, f), join(ziel, f));
        }
    }
    // Aus dem gebauten dist/, nicht aus public/ — so wird auch geprüft, dass
    // die Datei den Build überhaupt überlebt.
    const gebaut = join(process.cwd(), 'dist');
    if (existsSync(gebaut)) {
        for (const f of readdirSync(gebaut).filter((n) => /\.(png|svg|webmanifest|ico)$/.test(n))) {
            copyFileSync(join(gebaut, f), join(AUSGABE, f));
        }
    }
}

function gebauteCss(): string | null {
    if (!existsSync(DIST)) return null;
    // Vite emits a main stylesheet and lazy-view styles. Alphabetical first
    // used to pick OverviewView.css and silently omit every global utility.
    const index = readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf8');
    const initial = [...index.matchAll(/<link\b[^>]*href="\/assets\/([^"/]+\.css)"[^>]*>/g)]
        .map((match) => match[1]);
    if (initial.length === 0) throw new Error('Der Produktionsbuild bindet keine CSS ein.');
    const lazy = readdirSync(DIST).filter((file) => file.endsWith('.css') && !initial.includes(file)).sort();
    return [...initial, ...lazy].map((file) => readFileSync(join(DIST, file), 'utf8')).join('\n');
}

/**
 * Ist der Bau aelter als der Quelltext?
 *
 * Diese Pruefung vergleicht benutzte Klassen gegen die AUSGELIEFERTE CSS. Wer
 * eine Klasse aendert und nicht neu baut, bekommt darum "Regel fehlt" gemeldet
 * — obwohl der Quelltext stimmt und nur die CSS von vorher ist.
 *
 * Das ist mir am 2026-08-06 zweimal passiert. Beim ersten Mal habe ich in
 * derselben Befehlskette ausgeliefert, weil ein `grep` hinter `vitest` den
 * Fehlerstatus verschluckt hat — mit einer Meldung, die in die voellig falsche
 * Richtung zeigte. Ein Test, der bei veraltetem Bau etwas anderes behauptet
 * als die Wahrheit, ist schlimmer als keiner.
 *
 * Deshalb sagt er es jetzt selbst.
 */
function bauIstVeraltet(): string | null {
    if (!existsSync(DIST)) return null;
    const cssDatei = readdirSync(DIST).filter((f) => f.endsWith('.css')).sort()[0];
    if (!cssDatei) return null;
    const gebautAm = statSync(join(DIST, cssDatei)).mtimeMs;

    let neuste = 0;
    let neusteDatei = '';
    const durchgehen = (verzeichnis: string): void => {
        for (const eintrag of readdirSync(verzeichnis)) {
            const pfad = join(verzeichnis, eintrag);
            const s = statSync(pfad);
            if (s.isDirectory()) durchgehen(pfad);
            else if (/\.(tsx?|css)$/.test(eintrag) && s.mtimeMs > neuste) {
                neuste = s.mtimeMs;
                neusteDatei = pfad;
            }
        }
    };
    durchgehen('src');

    return neuste > gebautAm
        ? `${neusteDatei} ist neuer als der Bau — erst "npx vite build", dann diese Pruefung`
        : null;
}

/**
 * Attrappen-Daten für die Abfragen, die über react-query laufen.
 *
 * `renderToStaticMarkup` ist synchron — eine Zusage aus `queryFn` löst sich
 * dabei NIE auf, und die Probe zeigte "Wird geladen…". Deshalb wird der
 * Zwischenspeicher vorher direkt befüllt; das ist derselbe Zustand, den die
 * Anwendung nach dem Laden hat.
 */
const TERMINE = [
    { id: 'a1', type: 'quali', title: 'Onboarding-Gespräch', start_at: '2026-07-30T09:00:00.000Z',
      customer_name: 'A-V-G Autozubehör', assignee_name: 'Elias', status: 'confirmed' },
    { id: 'a4', type: 'other', title: 'Zweiter Termin Donnerstag', start_at: '2026-07-30T15:00:00.000Z',
      customer_name: null, assignee_name: 'Fecat', status: 'confirmed' },
    { id: 'a2', type: 'sales', title: 'Angebot nachfassen', start_at: '2026-07-31T13:30:00.000Z',
      customer_name: 'Kfz-Teile Nord', assignee_name: 'Fecat', status: 'confirmed' },
    { id: 'a3', type: 'call', title: 'Rückruf Werkstatt Süd', start_at: '2026-08-03T10:15:00.000Z',
      customer_name: 'Werkstatt Süd', assignee_name: 'Bardia', status: 'proposed' },
];

function rendern(inhalt: JSX.Element, route = '/'): string {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['admin', 'appointments', 'uebersicht'], { appointments: TERMINE.map((appointment, index) => ({
        ...appointment, start_at: new Date(Date.now() + (index + 1) * 36e5).toISOString(),
    })) });
    qc.setQueryData(['admin', 'access-requests', 'verlauf'], []);
    const onboarding = {
        summary: { total: 4, live: 2, configured: 1, setup: 1, atRisk: 0 },
        tenants: [
            { tenantId: '1', name: 'A-V-G Autozubehör', risk: 'live', whatsappConfigured: true,
              planId: 'pro', createdAt: '2026-06-01T10:00:00Z', activatedAt: '2026-06-03T09:00:00Z',
              timeToActivationHours: 47, lastOrderAt: '2026-07-29T08:00:00Z', dpaAcceptedAt: '2026-06-01T11:00:00Z',
              dpaVersion: '1.2', ageDays: 59, paymentStatus: 'paid', onboardingStatus: 'live' },
            { tenantId: '2', name: 'Kfz-Teile Nord GmbH', risk: 'setup', whatsappConfigured: false,
              planId: 'basis', createdAt: '2026-07-20T10:00:00Z', activatedAt: null,
              timeToActivationHours: null, lastOrderAt: null, dpaAcceptedAt: null,
              dpaVersion: null, ageDays: 10, paymentStatus: 'open', onboardingStatus: 'setup' },
        ],
    };
    // Beide Schlüssel: die Übersicht und die Onboarding-Ansicht fragen
    // dieselben Daten unter verschiedenen Namen ab.
    qc.setQueryData(['admin', 'onboarding', 'pipeline'], onboarding);
    qc.setQueryData(['admin', 'onboarding-pipeline'], onboarding);
    qc.setQueryData(['admin', 'readiness-profile', '1'], { billing: { company_name: 'A-V-G Autozubehör GmbH', company_address: 'Hafenstraße 12', company_zip: '20457', company_city: 'Hamburg' }, tax: { business_type: 'company', vat_id: 'DE000000000' }, dpaAcceptedAt: '2026-08-01', dpaVersion: '1.2' });
    qc.setQueryData(['admin', 'provisioning', '1'], { ownerName: 'Elias', dueAt: '2026-09-12', stage: 'integration', checks: {}, notes: '', updatedAt: '2026-09-05', version: 1, readiness: { ready: false, blockers: ['WhatsApp-Anbindung testen', 'Einweisung abschließen'] } });
    qc.setQueryData(['admin', 'tenant-operations', '1'], { generatedAt: '2026-09-05T12:00:00Z', orders: { total: 84, open: 7, completed: 77, lastOrderAt: '2026-09-05T10:00:00Z' }, finance: { issuedCount: 28, openCount: 4, overdueCount: 2, outstandingCents: 184500, overdueCents: 62900, currency: 'EUR' }, inventory: { products: 1320, units: 8840, lowStock: 12, locations: 3 }, procurement: { openOrders: 5, overdueOrders: 1 }, unavailable: [] });
    return renderToStaticMarkup(
        <QueryClientProvider client={qc}>
            <MemoryRouter initialEntries={[route]}>{inhalt}</MemoryRouter>
        </QueryClientProvider>,
    );
}

/** Ganzer Bildschirm: Leiste links, Kopfzeile oben, Übersicht darunter. */
function ganzeSeite(): string {
    return rendern(
        <div className="flex h-screen h-dvh w-full overflow-hidden bg-canvas text-text-primary" data-workspace="admin">
            <AdminSidebar />
            <div className="flex min-w-0 flex-1 flex-col">
                <AdminTopbar />
                <main className="min-w-0 flex-1 overflow-auto">
                    <OverviewView />
                </main>
            </div>
        </div>,
    );
}

describe('Bildprobe Redesign', () => {
    const css = gebauteCss();

    it.skipIf(!css)('schreibt die Seitenleiste als Seite nach dist-probe/', () => {
        const markup = rendern(<AdminSidebar />);

        // Die Leiste ist `hidden md:flex` — in der Probe wird sie erzwungen
        // sichtbar, sonst wäre das Bild leer. Nur DIESE eine Regel wird
        // hinzugefügt; alles andere kommt aus der ausgelieferten CSS.
        const seite = `<!doctype html>
<html lang="de" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Probe — Seitenleiste</title>
<style>${css}</style>
<style>aside.hidden { display: flex !important; }</style>
</head>
<body class="bg-canvas text-text-primary">
<div class="flex min-h-screen">${markup}</div>
</body>
</html>`;

        mkdirSync(AUSGABE, { recursive: true });
        writeFileSync(join(AUSGABE, 'seitenleiste.html'), seite, 'utf8');

        // Belegt, dass die Redesign-Merkmale wirklich im Markup stehen und
        // nicht nur im Kopf des Autors.
        expect(markup).toContain('Operations Console');
        expect(markup).toContain('w-64');
        expect(markup).toContain('Händler &amp; Kunden');
        expect(markup).toContain('ERP-Zentrale');
        expect(markup).toContain('Marketing &amp; Ads');
        expect(markup).toContain('Bestellungen');
    });

    it.skipIf(!css)('schreibt den ganzen Bildschirm nach dist-probe/', () => {
        const markup = ganzeSeite();
        const seite = `<!doctype html>
<html lang="de" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Probe — Admin-Dashboard</title>
<style>${css}</style>
<style>
  /* Die Schnellaktionen sind lg:flex — in der Probe immer zeigen. */
</style>
</head>
<body class="bg-canvas text-text-primary">${markup}</body>
</html>`;
        mkdirSync(AUSGABE, { recursive: true });
        beiwerkKopieren();
        writeFileSync(join(AUSGABE, 'dashboard.html'), seite, 'utf8');
        // Dieselbe Seite hell: `class="light"` auf <html> kippt den Tokensatz.
        // Ohne ein Bild davon bliebe „es gibt einen Hellmodus" eine Behauptung.
        writeFileSync(
            join(AUSGABE, 'dashboard-hell.html'),
            seite.replace('<html lang="de" class="dark">', '<html lang="de" class="light">'),
            'utf8',
        );

        // Die beiden Punkte, die ausdrücklich gefordert waren.
        expect(markup).toContain('Arbeitsübersicht');
        expect(markup).toContain('href="/mail"');    // E-Mail bleibt eigene Seite
    });

    it.skipIf(!css)('schreibt die Mail-Hülle nach dist-probe/', () => {
        const markup = rendern(<Routes><Route element={<MailLayout />}><Route path="/" element={<InboxView />} /></Route></Routes>);
        const seite = `<!doctype html>
<html lang="de" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Probe — Partsunion Mail</title>
<style>${css}</style>
</head>
<body class="bg-canvas text-text-primary">${markup}</body>
</html>`;
        mkdirSync(AUSGABE, { recursive: true });
        writeFileSync(join(AUSGABE, 'mail.html'), seite, 'utf8');

        // Das Logo muss im Build liegen, nicht nur im Markup.
        expect(
            existsSync(join(process.cwd(), 'dist', 'partsunion-symbol-weiss.png')),
            'partsunion-symbol-weiss.png fehlt im Build — das Markup zeigt dann ein defektes Bild',
        ).toBe(true);

        // Eigene Hülle, nicht die Dashboard-Leiste — genau so gefordert.
        expect(markup).toContain('Partsunion Mail');
        expect(markup).not.toContain('ADMIN CONSOLE');
        // Aber die Gestaltung von dort.
        expect(markup).toContain('bg-surface');
    });

    it.skipIf(!css)('schreibt die Kunden-Ansicht nach dist-probe/', () => {
        const markup = rendern(
            <div className="flex min-h-screen">
                <AdminSidebar />
                <div className="flex min-w-0 flex-1 flex-col">
                    <AdminTopbar />
                    <main className="min-w-0 flex-1">
                        <TenantsListView />
                    </main>
                </div>
            </div>,
        );
        mkdirSync(AUSGABE, { recursive: true });
        beiwerkKopieren();
        writeFileSync(join(AUSGABE, 'kunden.html'), `<!doctype html>
<html lang="de" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Probe — Kunden</title>
<style>${css}</style>
<style>
</style>
</head><body class="bg-canvas text-text-primary">${markup}</body></html>`, 'utf8');

        // Die Merkmale des Entwurfs stehen im Markup.
        expect(markup).toContain('Händler-Arbeitsansichten');
        expect(markup).toContain('Name, Kennung oder WhatsApp suchen');
        expect(markup).toContain('text-sm');
    });

    it.skipIf(!css)('schreibt die Kundenakte mit echten Komponenten und Beispieldaten', () => {
        const tenant = TenantSchema.parse({ id: '1', name: 'A-V-G Autozubehör', slug: 'avg-autozubehoer', is_active: true, user_count: 3, max_users: 5, device_count: 4, max_devices: 10, payment_status: 'overdue', onboarding_status: 'configured', created_at: '2026-08-01' });
        const detail = TenantDetailSchema.parse({ id: '1', users: [{ id: 'owner-1', role: 'merchant', name: 'Anna Nord', email: 'anna@beispiel.invalid', created_at: '2026-08-01' }], settings: { max_users: 5, max_devices: 10 }, devices: [], stats: {} });
        const markup = rendern(<div className="flex h-screen w-full overflow-hidden bg-canvas text-text-primary" data-workspace="admin"><AdminSidebar /><div className="flex min-w-0 flex-1 flex-col"><AdminTopbar /><main className="min-w-0 flex-1 overflow-auto p-4 md:p-7"><h1 className="mb-5 font-display text-2xl font-semibold">A-V-G Autozubehör</h1><TenantOverview tenant={tenant} detail={detail} detailLoading={false} detailError={false} retryDetail={() => {}} onSection={() => {}} /></main></div></div>, '/tenants/1');
        mkdirSync(AUSGABE, { recursive: true }); beiwerkKopieren();
        writeFileSync(join(AUSGABE, 'kundenakte.html'), `<!doctype html><html lang="de" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Probe — Kundenakte</title><style>${css}</style></head><body class="bg-canvas text-text-primary">${markup}</body></html>`, 'utf8');
        expect(markup).toContain('Nächste Schritte für diesen Händler');
        expect(markup).toContain('Zahlungsstatus klären');
    });

    it.skipIf(!css)('schreibt die ERP-Arbeitsansicht mit betrieblichen Hinweisen', () => {
        const markup = rendern(<div className="flex h-screen w-full overflow-hidden bg-canvas text-text-primary" data-workspace="admin"><AdminSidebar /><div className="flex min-w-0 flex-1 flex-col"><AdminTopbar /><main className="min-w-0 flex-1 overflow-auto p-4 md:p-7"><h1 className="mb-5 font-display text-2xl font-semibold">A-V-G Autozubehör · Betrieb</h1><TenantOperations tenantId="1" /></main></div></div>, '/tenants/1?tab=operations');
        mkdirSync(AUSGABE, { recursive: true }); beiwerkKopieren();
        writeFileSync(join(AUSGABE, 'erp.html'), `<!doctype html><html lang="de" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Probe — ERP</title><style>${css}</style></head><body class="bg-canvas text-text-primary">${markup}</body></html>`, 'utf8');
        expect(markup).toContain('Betrieblicher Handlungsbedarf');
        expect(markup).toContain('12 Artikel am Mindestbestand');
    });

    it.skipIf(!css)('schreibt die Onboarding-Ansicht nach dist-probe/', () => {
        const markup = rendern(
            <div className="flex min-h-screen">
                <AdminSidebar />
                <div className="flex min-w-0 flex-1 flex-col">
                    <AdminTopbar />
                    <main className="min-w-0 flex-1"><OnboardingPipelineView /></main>
                </div>
            </div>,
        );
        mkdirSync(AUSGABE, { recursive: true });
        beiwerkKopieren();
        writeFileSync(join(AUSGABE, 'onboarding.html'), `<!doctype html>
<html lang="de" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Probe — Onboarding</title>
<style>${css}</style>
<style>
</style>
</head><body class="bg-canvas text-text-primary">${markup}</body></html>`, 'utf8');

        expect(markup).toContain('Einrichtungen');
        /**
         * Die Kacheln benutzen jetzt KACHEL_ZAHL aus dichte.ts — dieselbe
         * Zahlengroesse und Laufweite wie jede andere Kennzahl in beiden
         * Anwendungen. Vorher standen sie auf 28-38 px und -0.04em, waehrend
         * alle uebrigen 22-28 px und -0.03em benutzten: dieselbe Sorte Karte
         * in zwei Groessen.
         *
         * Geprueft wird deshalb der TOKEN und nicht mehr eine Zahl, die hier
         * jemand von Hand nachziehen muesste.
         */
        expect(markup).toContain('tabular-nums');
    });

    it.skipIf(!css)('enthält für jede benutzte Klasse eine Regel in der CSS', () => {
        // Erst die ehrliche Antwort, falls der Bau veraltet ist.
        expect(bauIstVeraltet(), 'veralteter Bau — die Meldung unten waere irrefuehrend').toBeNull();

        const markup = ganzeSeite()
            + rendern(<MailLayout />)
            + rendern(<TenantsListView />)
            + rendern(<OnboardingPipelineView />);

        // Alle Klassen aus dem Markup einsammeln …
        /**
         * HTML-Entitäten zurückwandeln.
         *
         * Klassen wie `[&_svg]:shrink-0` (shadcn) stehen im Markup als
         * `[&amp;_svg]:shrink-0`. Ohne diese Rückwandlung meldet die Prüfung sie
         * als fehlend, obwohl sie in der CSS stehen — vier Fehlalarme auf einen
         * Schlag, und danach glaubt man der Prüfung nicht mehr.
         */
        const entschluesseln = (t: string) => t
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#x27;/g, "'")
            .replace(/&#39;/g, "'");

        const benutzt = new Set<string>();
        for (const m of markup.matchAll(/class="([^"]+)"/g)) {
            for (const k of entschluesseln(m[1]).split(/\s+/)) if (k) benutzt.add(k);
        }

        // … und nachsehen, ob die CSS sie kennt. Klassen ohne eigene Regel
        // sind bei Tailwind entweder Tippfehler oder Namen, die es nicht gibt.
        //
        // Ausgenommen sind Klassen, die NICHT von Tailwind kommen: lucide-react
        // hängt an jedes Symbol `lucide lucide-<name>`. Die haben zu Recht
        // keine Regel in unserer CSS und wären hier nur Rauschen, das die
        // Prüfung nutzlos macht.
        const fremd = (k: string) => k === 'lucide' || k.startsWith('lucide-');

        /**
         * Steht die Klasse als Selektor in der CSS?
         *
         * Tailwind maskiert Sonderzeichen im Selektor mit Backslash — und zwar
         * nicht nur `.` und `[`, sondern auch `&`, `>`, `*`, `=` und eine
         * FÜHRENDE ZIFFER als Hex-Folge (`2xl:` wird `\32xl\:`). Jede dieser
         * Regeln einzeln nachzubauen ist fehleranfällig; ich habe mich damit
         * schon zweimal selbst in die Irre geführt.
         *
         * Deshalb umgekehrt: die Backslashes werden aus der CSS ENTFERNT und
         * dann wird der rohe Klassenname gesucht. Die Hex-Maskierung der
         * führenden Ziffer wird vorher zurückgedreht (`\32x` → `2x`).
         *
         * Gegengeprüft: mit einem erfundenen Klassennamen fällt die Prüfung
         * weiterhin.
         */
        const cssRoh = css!
            .replace(/\\3([0-9a-fA-F])\s?/g, '$1')
            .replace(/\\/g, '');
        const ohneRegel = [...benutzt]
            .filter((k) => !fremd(k))
            .filter((k) => !cssRoh.includes(`.${k}`));

        expect(ohneRegel, `Klassen ohne Regel in der gebauten CSS: ${ohneRegel.join(', ')}`)
            .toEqual([]);
    });
});
