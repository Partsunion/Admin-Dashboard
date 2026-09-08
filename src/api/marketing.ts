import { apiFetch } from './client';

export type MarketingPlatform = 'google' | 'meta';
export type MarketingProvider = MarketingPlatform | 'plausible';

export interface MarketingConnection {
    provider: MarketingProvider;
    label: string;
    state: 'connected' | 'not_configured' | 'error';
    accountName?: string;
    missing?: string[];
    message?: string;
}

export interface MarketingAccountOption {
    id: string;
    name: string;
    currency?: string;
}

export interface MarketingOAuthConnection {
    provider: MarketingPlatform;
    connected: boolean;
    managedBy: 'oauth' | 'environment' | 'none';
    authAvailable: boolean;
    missingConfiguration: string[];
    authorizedIdentityName?: string;
    selectedAccountId?: string;
    selectedAccountName?: string;
    selectedAccountCurrency?: string;
    accounts: MarketingAccountOption[];
    connectedAt?: string;
    expiresAt?: string;
}

export interface MarketingSummary {
    impressions: number;
    clicks: number;
    spend: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    cpc: number;
    cpa: number;
}

export interface MarketingCampaign extends MarketingSummary {
    provider: MarketingPlatform;
    id: string;
    name: string;
    status: string;
    effectiveStatus?: string;
    channel?: string;
    currency: string;
    dailyBudget: number | null;
    budgetEditable: boolean;
    budgetShared?: boolean;
}

export interface WebsiteAnalytics {
    summary: { visitors: number; visits: number; pageviews: number; bounceRate: number; visitDuration: number; events: number };
    previous: WebsiteAnalytics['summary'];
    trend: Array<{ date: string; visitors: number; pageviews: number }>;
    pages: Array<{ label: string; visitors: number; pageviews?: number; bounceRate?: number }>;
    entryPages: Array<{ label: string; visitors: number; visits?: number; bounceRate?: number }>;
    sources: Array<{ label: string; visitors: number }>;
    channels: Array<{ label: string; visitors: number; visits?: number }>;
    attribution: Array<{ channel: string; rawChannel: string; source: string; medium: string; campaign: string; content: string; entryPage: string; visitors: number; visits: number }>;
    pagesByChannel: Array<{ channel: string; page: string; visitors: number; pageviews: number }>;
    regions: Array<{ label: string; country: string; region: string; visitors: number; visits?: number }>;
    clicks: Array<{ channel: string; page: string; target: string; placement: string; destination: string; kind: string; clicks: number }>;
    acquisition: { organicVisits: number; coldOutreachVisits: number; directVisits: number; paidVisits: number };
}

export interface AdsAccountAnalytics {
    accountName: string;
    currency: string;
    summary: MarketingSummary;
    campaigns: MarketingCampaign[];
}

export interface MarketingOverview {
    range: { from: string; to: string; previousFrom: string; previousTo: string };
    generatedAt: string;
    connections: MarketingConnection[];
    website?: WebsiteAnalytics;
    ads: Partial<Record<MarketingPlatform, AdsAccountAnalytics>>;
}

export function getMarketingOverview(from: string, to: string, force = false): Promise<MarketingOverview> {
    const query = new URLSearchParams({ from, to });
    if (force) query.set('force', 'true');
    return apiFetch(`/api/admin/marketing/overview?${query.toString()}`);
}

export async function getMarketingConnections(): Promise<MarketingOAuthConnection[]> {
    const response = await apiFetch<{ connections: MarketingOAuthConnection[] }>('/api/admin/marketing/connections');
    return response.connections;
}

export function startMarketingConnection(provider: MarketingPlatform): Promise<{ authorizationUrl: string; expiresAt: string }> {
    return apiFetch(`/api/admin/marketing/connections/${provider}/start`, { method: 'POST' });
}

export function selectMarketingAccount(provider: MarketingPlatform, accountId: string): Promise<{ account: MarketingAccountOption }> {
    return apiFetch(`/api/admin/marketing/connections/${provider}/account`, {
        method: 'PUT', body: JSON.stringify({ accountId }),
    });
}

export function disconnectMarketingConnection(provider: MarketingPlatform): Promise<{ ok: true }> {
    return apiFetch(`/api/admin/marketing/connections/${provider}`, { method: 'DELETE' });
}

export function updateCampaignStatus(platform: MarketingPlatform, id: string, status: 'ACTIVE' | 'PAUSED'): Promise<{ ok: true }> {
    return apiFetch(`/api/admin/marketing/campaigns/${platform}/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
    });
}

export function updateCampaignBudget(platform: MarketingPlatform, id: string, dailyBudget: number): Promise<{ ok: true }> {
    return apiFetch(`/api/admin/marketing/campaigns/${platform}/${encodeURIComponent(id)}/budget`, {
        method: 'PATCH',
        body: JSON.stringify({ dailyBudget }),
    });
}
