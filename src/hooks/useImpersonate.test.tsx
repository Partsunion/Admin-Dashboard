import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    apiFetch: vi.fn(),
    clearActiveImpersonation: vi.fn(),
    setActiveImpersonation: vi.fn(),
}));

vi.mock('@/api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/lib/impersonationSession', () => ({
    clearActiveImpersonation: mocks.clearActiveImpersonation,
    setActiveImpersonation: mocks.setActiveImpersonation,
}));

import { endImpersonation, useImpersonate } from './useImpersonate';

function wrapper({ children }: PropsWithChildren) {
    const client = new QueryClient({
        defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useImpersonate secure dashboard handoff', () => {
    beforeEach(() => {
        mocks.apiFetch.mockReset();
        mocks.clearActiveImpersonation.mockReset();
        mocks.setActiveImpersonation.mockReset();
        vi.restoreAllMocks();
    });

    it('pre-opens the sales preview and replaces it with the single-use fragment', async () => {
        mocks.apiFetch.mockResolvedValue({
            success: true,
            ticket: 'ticket+/=',
            sessionId: 'session-1',
            expiresAt: '2026-09-08T20:00:00.000Z',
        });
        const previewWindow = {
            closed: false,
            close: vi.fn(),
            document: { title: '', body: { textContent: '' } },
            location: { replace: vi.fn() },
            opener: window,
        } as unknown as Window;
        const open = vi.spyOn(window, 'open').mockImplementation(() => previewWindow);
        const { result } = renderHook(() => useImpersonate(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ tenantId: 'dealer 42', tenantName: 'Demo Händler' });
        });

        expect(mocks.apiFetch).toHaveBeenCalledWith('/api/admin/tenants/dealer%2042/impersonate', {
            method: 'POST',
            body: JSON.stringify({ userId: undefined, reason: 'Admin impersonation via dashboard' }),
        });
        expect(open).toHaveBeenCalledWith('about:blank', '_blank');
        expect(previewWindow.opener).toBeNull();
        expect(previewWindow.document.title).toBe('Partsunion – Händleransicht wird geladen');
        expect(previewWindow.location.replace).toHaveBeenCalledWith(
            'https://app.partsunion.de/impersonate#ticket=ticket%2B%2F%3D',
        );
        expect(mocks.setActiveImpersonation).toHaveBeenCalledWith({
            tenantId: 'dealer 42',
            tenantName: 'Demo Händler',
            sessionId: 'session-1',
            expiresAt: '2026-09-08T20:00:00.000Z',
            startedAt: expect.any(String),
        });
    });

    it('closes the prepared preview when the server returns no ticket', async () => {
        mocks.apiFetch.mockResolvedValue({ success: true });
        const previewWindow = {
            closed: false,
            close: vi.fn(),
            document: { title: '', body: { textContent: '' } },
            location: { replace: vi.fn() },
            opener: window,
        } as unknown as Window;
        const open = vi.spyOn(window, 'open').mockImplementation(() => previewWindow);
        const { result } = renderHook(() => useImpersonate(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ tenantId: 7 });
        });

        expect(open).toHaveBeenCalledWith('about:blank', '_blank');
        expect(previewWindow.close).toHaveBeenCalledOnce();
        expect(previewWindow.location.replace).not.toHaveBeenCalled();
        expect(mocks.setActiveImpersonation).not.toHaveBeenCalled();

        mocks.apiFetch.mockRejectedValueOnce(new Error('Redis unavailable'));
        await expect(endImpersonation('session-1')).rejects.toThrow('Redis unavailable');
        expect(mocks.clearActiveImpersonation).not.toHaveBeenCalled();

        mocks.apiFetch.mockResolvedValueOnce({ success: true, revoked: true });
        await expect(endImpersonation('session-1')).resolves.toBeUndefined();
        expect(mocks.apiFetch).toHaveBeenLastCalledWith('/api/admin/impersonation/revoke', {
            method: 'POST',
            body: JSON.stringify({ sessionId: 'session-1' }),
        });
        expect(mocks.clearActiveImpersonation).toHaveBeenCalledOnce();
    });
});
