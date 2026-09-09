import { apiFetch } from '@/api/client';
export type RankingPeriod = 'week' | 'month';
export interface RankingRow {
  id: string; name: string; active: boolean; rank: number | null; points: number;
  numbers: number; appointments: number; brochures: number; salesCalls: number; deals: number;
}
export interface RankingReport {
  period: RankingPeriod; start: string; end: string; today: string; launchedWeek: string;
  timezone: string; updatedAt: string; scoringVersion: number;
  weights: { numbers: number; appointments: number; brochures: number; salesCalls: number; deals: number };
  rows: RankingRow[];
  history: { start: string; end: string; current: boolean; rows: RankingRow[] }[];
  firstWeekPause: { start: string; end: string; users: { id: string; name: string }[] };
}

export function loadRanking(period: RankingPeriod, date?: string): Promise<RankingReport> {
  const query = new URLSearchParams({ period, ...(date ? { date } : {}) });
  return apiFetch<RankingReport>(`/api/admin/crm-ranking?${query}`);
}
