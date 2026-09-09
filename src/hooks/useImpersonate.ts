/**
 * useImpersonate — Tenant-impersonation flow.
 *
 * Calls POST /api/admin/tenants/:tenantId/impersonate to obtain a
 * short-lived, single-use ticket. On success, opens the user dashboard in a
 * new tab with that ticket in the URL fragment.
 *
 * The backend endpoint must:
 *  1. Verify the caller is a super-admin
 *  2. Issue a single-use exchange ticket for a tenant-scoped session
 *  3. Log the impersonation event to the audit trail
 */

import {
    useMutation,
    type MutateOptions,
    type UseMutateAsyncFunction,
    type UseMutateFunction,
    type UseMutationResult,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/api/client';
import { clearActiveImpersonation, setActiveImpersonation } from '@/lib/impersonationSession';

export interface ImpersonateInput {
    tenantId: number | string;
    userId?: number | string;
    reason?: string;
    /** Anzeigename für den Topbar-Banner (P1.4). */
    tenantName?: string;
}

export interface ImpersonateResult {
    success: boolean;
    /** Audit H-1: single-use ticket exchanged for the token by the user
     *  dashboard (the JWT is NEVER placed in a URL anymore). */
    ticket?: string;
    /** Server-side revoke handle for "exit impersonation". */
    sessionId?: string;
    expiresAt?: string;
    dashboardUrl?: string;
}

interface PreparedImpersonateInput extends ImpersonateInput {
    previewWindow: Window | null;
}

const USER_DASHBOARD_BASE = import.meta.env.VITE_USER_DASHBOARD_URL || 'https://app.partsunion.de';

/**
 * End a preview only after the backend confirms that its JWT has been
 * blacklisted. Keeping the local marker on an error gives the operator a real
 * retry path instead of displaying a false "beendet" state.
 */
export async function endImpersonation(sessionId: string | null | undefined): Promise<void> {
    if (!sessionId) {
        throw new Error('Der sichere Widerrufsschlüssel dieser Vorschau fehlt.');
    }
    await apiFetch('/api/admin/impersonation/revoke', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
    });
    clearActiveImpersonation();
}

export function useImpersonate(): UseMutationResult<
    ImpersonateResult,
    Error,
    ImpersonateInput
> {
    const mutation = useMutation<ImpersonateResult, Error, PreparedImpersonateInput>({
        mutationFn: async (input): Promise<ImpersonateResult> => {
            const tenantPathId = encodeURIComponent(String(input.tenantId));
            let result: ImpersonateResult;
            try {
                result = await apiFetch<ImpersonateResult>(
                    `/api/admin/tenants/${tenantPathId}/impersonate`,
                    {
                        method: 'POST',
                        body: JSON.stringify({
                            userId: input.userId,
                            reason: input.reason || 'Admin impersonation via dashboard',
                        }),
                    }
                );
            } catch (error) {
                input.previewWindow?.close();
                throw error;
            }

            // Audit H-1: open the user dashboard with a single-use TICKET, not
            // the JWT. The ticket is short-lived + single-use, so a URL/Referer/
            // log leak is worthless after the user dashboard redeems it.
            if (result.ticket) {
                // The user dashboard deliberately rejects credentials in the
                // query string because they can reach proxy and access logs.
                // Fragments stay in the browser and are scrubbed before React,
                // telemetry, or the exchange request initializes.
                const url = `${USER_DASHBOARD_BASE}/impersonate#ticket=${encodeURIComponent(result.ticket)}`;
                if (input.previewWindow && !input.previewWindow.closed) {
                    input.previewWindow.location.replace(url);
                } else {
                    // A blocked popup must not turn a successful MFA/ticket
                    // exchange into a false success. Reuse the current tab;
                    // navigating an existing context is not popup-blocked.
                    window.open(url, '_self');
                }
                // P1.4: Marker setzen, damit der AdminTopbar einen „Impersonation
                // läuft"-Banner zeigt (der eigentliche Tab ist das User-Dashboard).
                // sessionId erlaubt das serverseitige Beenden ("Zurück zum Admin").
                setActiveImpersonation({
                    tenantId: String(input.tenantId),
                    tenantName: input.tenantName ?? String(input.tenantId),
                    sessionId: result.sessionId ?? null,
                    expiresAt: result.expiresAt ?? null,
                    startedAt: new Date().toISOString(),
                });
            } else {
                input.previewWindow?.close();
            }

            return result;
        },
    });

    const prepare = useCallback((input: ImpersonateInput): PreparedImpersonateInput => {
        // Create the browsing context synchronously inside the original click.
        // Waiting for the API response first loses the browser's transient user
        // activation and lets popup blockers discard an otherwise valid sales
        // preview. `opener` is severed before any remote URL is loaded.
        const previewWindow = window.open('about:blank', '_blank');
        if (previewWindow) {
            previewWindow.opener = null;
            previewWindow.document.title = 'Partsunion – Händleransicht wird geladen';
            previewWindow.document.body.textContent = 'Sichere Händleransicht wird geladen …';
        }
        return { ...input, previewWindow };
    }, []);

    const mutate: UseMutateFunction<ImpersonateResult, Error, ImpersonateInput> = useCallback(
        (input, options) => mutation.mutate(
            prepare(input),
            options as MutateOptions<ImpersonateResult, Error, PreparedImpersonateInput>,
        ),
        [mutation, prepare],
    );
    const mutateAsync: UseMutateAsyncFunction<ImpersonateResult, Error, ImpersonateInput> = useCallback(
        (input, options) => mutation.mutateAsync(
            prepare(input),
            options as MutateOptions<ImpersonateResult, Error, PreparedImpersonateInput>,
        ),
        [mutation, prepare],
    );

    return { ...mutation, mutate, mutateAsync } as UseMutationResult<
        ImpersonateResult,
        Error,
        ImpersonateInput
    >;
}
