/**
 * Routen-Rauchtest — rendert JEDE Route des Dashboards einmal.
 *
 * Warum das nötig ist: tsc prüft Typen, ESLint den Stil, der Build die
 * Auflösung von Importen. Keiner davon merkt, wenn eine Ansicht beim Rendern
 * abstürzt — ein Hook in falscher Reihenfolge, ein `undefined.map`, eine
 * Route, die auf eine gelöschte Komponente zeigt. Genau solche Fehler entstehen
 * beim Umbau der Navigation.
 *
 * Der Test mountet den echten Router unter einer angemeldeten Attrappe und
 * prüft für jeden Pfad zweierlei: dass etwas gerendert wird, und dass die
 * Fehlergrenze NICHT ausgelöst hat.
 *
 * Netzwerkaufrufe werden nicht gemockt — die Ansichten zeigen dann ihren Lade-
 * oder Fehlerzustand. Das genügt: geprüft wird, dass die Route trägt, nicht
 * dass die API antwortet.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Admin } from '@/api/types';

const superadmin: Admin = {
    id: 'admin-1',
    username: 'Fecat',
    email: 'operator@example.test',
    role: 'superadmin',
    must_change_password: false,
};

vi.mock('@/context/AuthContext', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('@/context/AuthContext');
    return {
        ...actual,
        useAuth: () => ({
            user: superadmin,
            isAuthenticated: true,
            isLoading: false,
            login: vi.fn(),
            logout: vi.fn(),
            refreshUser: vi.fn(),
            markPasswordChanged: vi.fn(),
        }),
    };
});

// Netzwerk stilllegen: die Ansichten sollen ihren Lade-/Fehlerzustand zeigen,
// statt auf echte Antworten zu warten.
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline im Test'))));

// Route rendering is tested here; idle prefetch has its own contract tests.
// Otherwise its delayed imports may outlive the test environment.
vi.mock('./vorwaermen', () => ({ ansichtenVorwaermen: vi.fn() }));

import { AdminRoutes } from './adminRoutes';

/** Jede Route, die ein Mensch aufrufen kann. */
const ROUTES = [
    '/',
    '/calendar',
    '/marketing',
    '/erp',
    '/tenants',
    '/tenants/new',
    '/tenants/tenant-1',
    '/onboarding',
    '/access-requests',
    '/oem-finder',
    '/mail',
    '/einstellungen',
    '/einstellungen/admins',
    '/einstellungen/postfaecher',
    '/einstellungen/regeln',
    '/einstellungen/support',
    '/einstellungen/audit',
    '/einstellungen/wartung',
    '/bot/testing',
    '/testing/e2e-runner',
    '/testing/live-sim',
    '/orders',
    '/oe-quality',
    '/ein-pfad-den-es-nicht-gibt',
];

/** Alte Pfade, die auf ihr neues Ziel zeigen müssen. */
const REDIRECTS: Array<[string, string]> = [
    ['/inbox', 'Posteingang'],
    ['/inbox/verwaltung', 'Postfach-Rechte'],
    ['/profile', 'Einstellungen'],
    ['/admins', 'Einstellungen'],
    ['/audit', 'Einstellungen'],
    ['/support', 'Einstellungen'],
    ['/maintenance', 'Einstellungen'],
];

const clients: QueryClient[] = [];

function renderAt(path: string) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    clients.push(client);
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
                <AdminRoutes />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('Dashboard-Routen', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
        for (const client of clients.splice(0)) client.clear();
    });

    it.each(ROUTES)('rendert %s ohne Absturz', async (path) => {
        const { container } = renderAt(path);

        // Sidebar text alone is not evidence that the requested lazy view rendered.
        await act(async () => { await vi.dynamicImportSettled(); });

        // Lazy-Loading: erst nach dem Auflösen des Chunks steht der Inhalt.
        await waitFor(() => {
            expect(container.textContent).toBeTruthy();
            // The resolved view may legitimately show its own API loading state.
            expect(container.querySelector('main')?.textContent ?? container.textContent).toBeTruthy();
        }, { timeout: 5000 });

        // A handled offline API error is an expected view state. It shares
        // generic copy with ErrorState, so assert the actual fatal boundaries.
        expect(screen.queryByRole('heading', { name: /^(Unerwarteter Fehler|Unexpected error)$/i })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Neue Version verfügbar' })).toBeNull();
        if (path === '/tenants') {
            expect(await screen.findByText('Kunden konnten nicht geladen werden.')).toBeVisible();
            expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeEnabled();
        }
    }, 15_000);

    it.each(REDIRECTS)('leitet %s weiter', async (path) => {
        const { container } = renderAt(path);
        await act(async () => { await vi.dynamicImportSettled(); });
        await waitFor(() => {
            expect(container.textContent).toBeTruthy();
            expect(container.querySelector('main')?.textContent ?? container.textContent).toBeTruthy();
        }, { timeout: 5000 });
        expect(screen.queryByText(/Seite nicht gefunden/i)).toBeNull();
    }, 15_000);
});
