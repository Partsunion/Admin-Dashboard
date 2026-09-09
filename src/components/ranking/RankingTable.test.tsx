// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RankingTable } from './RankingTable';
import { loadRanking, type RankingReport } from './api';
vi.mock('./api', () => ({ loadRanking: vi.fn() }));
const api = vi.mocked(loadRanking);
const row = { id: 'a', name: 'Aaron Beispiel', active: true, rank: 1, points: 29, numbers: 2, appointments: 1, brochures: 1, salesCalls: 0, deals: 1 };
const report: RankingReport = {
  period: 'week', start: '2026-09-07', end: '2026-09-14', today: '2026-09-09', launchedWeek: '2026-09-07',
  timezone: 'Europe/Berlin', scoringVersion: 1, updatedAt: '2026-09-09T10:00:00Z',
  weights: { numbers: 1, appointments: 5, brochures: 2, salesCalls: 3, deals: 20 }, rows: [row],
  history: [{ start: '2026-09-07', end: '2026-09-14', current: true, rows: [row] }],
  firstWeekPause: { start: '2026-09-07', end: '2026-09-14', users: [{ id: 'b', name: 'Alexander Blawat' }] },
};
beforeEach(() => { vi.clearAllMocks(); api.mockResolvedValue(report); });
afterEach(cleanup);
describe('sales ranking', () => {
  it('shows compact metrics, the first-week pause and persistent weekly points', async () => {
    render(<RankingTable />);
    await screen.findByText('Aaron Beispiel');
    expect(screen.getByRole('columnheader', { name: 'Broschüren' })).toBeTruthy();
    expect(screen.getByText(/Alexander Blawat pausiert/)).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByText('29')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Wochenpunkte/ }));
    expect(screen.getByRole('button', { name: /KW 37/ })).toBeTruthy();
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Vorheriger Zeitraum' }).hasAttribute('disabled')).toBe(true);
  });
  it('switches to the calendar month without keeping stale weekly numbers', async () => {
    render(<RankingTable />);
    await screen.findByText('Aaron Beispiel');
    api.mockResolvedValue({ ...report, period: 'month', start: '2026-09-01', end: '2026-10-01', rows: [{ ...row, points: 50 }] });
    fireEvent.click(screen.getByRole('button', { name: 'Monat' }));
    await waitFor(() => expect(api).toHaveBeenLastCalledWith('month', undefined));
    await screen.findByText('50');
    expect(screen.queryByText('29')).toBeNull();
    expect(screen.getByText('September 2026')).toBeTruthy();
  });
  it('does not turn API errors into a zero-score ranking and allows a retry', async () => {
    api.mockRejectedValueOnce(new Error('offline'));
    render(<RankingTable />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
    await screen.findByText('Aaron Beispiel');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('retains the last valid report with an explicit warning if refresh fails', async () => {
    render(<RankingTable />);
    await screen.findByText('Aaron Beispiel');
    api.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Rangliste aktualisieren' }));
    await screen.findByRole('alert');
    expect(screen.getByText('29')).toBeTruthy();
  });
  it('labels both years correctly when a week crosses New Year', async () => {
    api.mockResolvedValue({ ...report, start: '2026-12-28', end: '2027-01-04', today: '2027-01-01' });
    render(<RankingTable />);
    expect(await screen.findByRole('table', { name: /28\.12\..*2026.*03\.01\..*2027/ })).toBeTruthy();
  });
});
