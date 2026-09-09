import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingHealthRow } from '@/api/onboarding';
import OverviewView from './OverviewView';

const state = vi.hoisted(() => ({ canCreate: true, pipelineError: false, mailError: false }));
vi.mock('@/components/ranking/api', () => ({ loadRanking: async () => { throw new Error('Ranking not configured in overview fixture'); } }));
vi.mock('@/auth/usePermissions', () => ({ usePermissions: () => ({ can: (permission: string) => permission !== 'tenants.create' || state.canCreate }) }));
vi.mock('@/hooks/useDashboardMetrics', () => ({ useDashboardMetrics: () => ({ metrics: { activeTenants: 4, totalUsers: 12, ordersToday: null, revenueMtd: null }, isLoading: false, error: null, refetch: vi.fn() }) }));
vi.mock('@/hooks/useSystemHealth', () => ({ useSystemHealth: () => ({ zustand: { erreichbar: true }, isLoading: false, error: null, refetch: vi.fn() }) }));
vi.mock('@/hooks/useAuditLogs', () => ({ useAuditLogs: () => ({ entries: [], isLoading: false, error: null, refetch: vi.fn() }) }));
vi.mock('@/hooks/useInbox', () => ({ useMailboxes: () => ({ mailboxes: [{ id: 'all', unread: 7 }, { id: 'sales', unread: 4 }], isLoading: false, error: state.mailError ? new Error('offline') : null, refetch: vi.fn() }) }));
vi.mock('@/api/appointments', () => ({ listAppointments: async () => ({ appointments: [] }) }));
vi.mock('@/api/accessRequests', () => ({ getAccessRequestHistory: async () => [{ id: 'failed', status: 'failed' }, { id: 'sent', status: 'sent' }] }));
vi.mock('@/api/onboarding', () => ({ getOnboardingPipeline: async () => {
    if (state.pipelineError) throw new Error('offline');
    return { summary: { total: 3 }, tenants: [row('old', 'setup', 30), row('risk', 'at-risk', 2), row('live', 'live', 40)] };
} }));

function row(id: string, risk: OnboardingHealthRow['risk'], ageDays: number): OnboardingHealthRow {
    return { tenantId: id, name: id === 'risk' ? 'Betreuung erforderlich GmbH' : id, risk, ageDays, planId: null, planExpiresAt: null, paymentStatus: null, onboardingStatus: null, activatedAt: null, timeToActivationHours: null, whatsappConfigured: false, lastOrderAt: null, createdAt: null, dpaAcceptedAt: null, dpaVersion: null };
}
function mount(): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><OverviewView /></MemoryRouter></QueryClientProvider>);
}

describe('Operational overview', () => {
    beforeEach(() => { state.canCreate = true; state.pipelineError = false; state.mailError = false; });
    it('starts with an actionable merchant queue and prioritises factual risk before age', async () => {
        mount();
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Arbeitsübersicht');
        const queue = screen.getByRole('region', { name: 'Händler in Bearbeitung' });
        const first = await within(queue).findByRole('link', { name: /Betreuung erforderlich GmbH/ });
        expect(first).toHaveAttribute('href', '/tenants/risk?tab=onboarding');
        const merchantLinks = within(queue).getAllByRole('link').filter(link => link.getAttribute('href')?.startsWith('/tenants/'));
        expect(merchantLinks[0]).toBe(first);
        expect(within(queue).queryByText('live')).not.toBeInTheDocument();
        expect(within(queue).getAllByText('AVV-Nachweis ergänzen')).toHaveLength(2);
    });
    it('keeps other work available when one data source fails and never reports an empty queue as success', async () => {
        state.pipelineError = true;
        mount();
        expect(await screen.findByText(/Der Bearbeitungsstand ist unbekannt/)).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Kommunikation' })).toBeInTheDocument();
        expect(screen.queryByText('Aktuell keine Händler in Einrichtung.')).not.toBeInTheDocument();
    });
    it('shows missing financial data as unknown rather than zero and counts virtual mailbox totals once', async () => {
        mount();
        const facts = screen.getByRole('region', { name: 'Plattformzahlen' });
        expect(within(facts).getAllByText('—')).toHaveLength(2);
        expect(within(facts).queryByText('0')).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Posteingang/ })).toHaveTextContent('7');
        await waitFor(() => expect(screen.getByRole('link', { name: /Zugangsanfragen/ })).toHaveTextContent('1'));
    });
    it('does not turn mailbox failures into zero unread messages', async () => {
        state.mailError = true;
        mount();
        await screen.findByText('Die Rangliste konnte nicht geladen werden.');
        expect(screen.getByRole('link', { name: /Posteingang/ })).toHaveTextContent('Postfachstatus nicht verfügbar');
        expect(screen.getByRole('link', { name: /Posteingang/ })).toHaveTextContent('—');
    });
    it('does not offer merchant creation to a read-only operator', async () => {
        state.canCreate = false;
        mount();
        await screen.findByText('Die Rangliste konnte nicht geladen werden.');
        expect(screen.queryByRole('link', { name: 'Händler einrichten' })).not.toBeInTheDocument();
    });
});
