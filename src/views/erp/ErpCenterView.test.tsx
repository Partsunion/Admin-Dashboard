import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order, Tenant } from '@/api/types';
vi.mock('./VehicleFullscanQueue',()=>({VehicleFullscanQueue:()=>null}));

const state = vi.hoisted(() => ({ ordersError: false, tenantsError: false }));
const orders: Order[] = [
    { id: 'order-new', status: 'new', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-05T10:00:00Z', merchant_id: 'tenant-1', customer_name: 'Werkstatt Nord', requested_part_name: 'Bremsscheibe', oem_number: 'OE-123' },
    { id: 'order-parts', status: 'awaiting_parts', created_at: '2026-09-06T10:00:00Z', updated_at: '2026-09-06T10:00:00Z', merchant_id: 'tenant-1' },
    { id: 'order-ready', status: 'ready', created_at: '2026-09-06T10:00:00Z', updated_at: '2026-09-06T11:00:00Z', merchant_id: 'tenant-1' },
];
const tenants: Tenant[] = [{
    id: 'tenant-1', name: 'Autoteile Nord', slug: 'autoteile-nord', user_count: 4, max_users: 10,
    device_count: 2, max_devices: 10, is_active: true, onboarding_status: 'completed', payment_status: 'paid',
    whatsapp_number: null, logo_url: null,
}];

vi.mock('@/hooks/useOrders', () => ({
    useOrders: () => ({ orders: state.ordersError ? [] : orders, isLoading: false, error: state.ordersError ? new Error('offline') : null, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useTenants', () => ({
    useTenants: () => ({ tenants: state.tenantsError ? [] : tenants, isLoading: false, error: state.tenantsError ? new Error('offline') : null, refetch: vi.fn() }),
}));
vi.mock('@/views/tenants/TenantOperations', () => ({
    TenantOperations: ({ tenantId }: { tenantId: string }) => <div>Betriebsdaten für {tenantId}</div>,
}));

import ErpCenterView from './ErpCenterView';

describe('ERP-Zentrale', () => {
    beforeEach(() => { state.ordersError = false; state.tenantsError = false; });

    it('zeigt reale Arbeitskennzahlen und öffnet die Händler-Warenwirtschaft', () => {
        render(<MemoryRouter initialEntries={['/erp']}><ErpCenterView /></MemoryRouter>);
        expect(screen.getByRole('heading', { level: 1, name: 'ERP & Warenwirtschaft' })).toBeInTheDocument();
        const signals = screen.getByRole('region', { name: 'ERP-Kennzahlen' });
        expect(within(signals).getByText('3 Aufträge insgesamt')).toBeInTheDocument();
        expect(within(signals).getAllByText('1', { selector: 'strong' })).toHaveLength(3);
        fireEvent.change(screen.getByLabelText('Händler auswählen'), { target: { value: 'tenant-1' } });
        expect(screen.getByText('Betriebsdaten für tenant-1')).toBeInTheDocument();
    });

    it('macht einen Quellenausfall sichtbar und zeigt ihn niemals als Null', () => {
        state.ordersError = true;
        render(<MemoryRouter initialEntries={['/erp']}><ErpCenterView /></MemoryRouter>);
        expect(screen.getByRole('alert')).toHaveTextContent('nicht erreichbar');
        const signals = screen.getByRole('region', { name: 'ERP-Kennzahlen' });
        expect(within(signals).getAllByText('—')).toHaveLength(3);
        expect(within(signals).queryByText('0')).not.toBeInTheDocument();
    });
});
