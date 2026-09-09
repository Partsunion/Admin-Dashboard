import { useCallback, useEffect, useId, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, ChevronDown } from 'lucide-react';
import { loadRanking, type RankingPeriod, type RankingReport } from './api';
import './ranking.css';

const number = new Intl.NumberFormat('de-DE');
const dateLabel = (date: string) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(date + 'T12:00:00Z'));
function shift(date: string, days: number) {
  const value = new Date(date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
function periodLabel(start: string, end: string, period: RankingPeriod) {
  if (period === 'month') return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date(start + 'T12:00:00Z'));
  const last = shift(end, -1);
  const firstYear = start.slice(0, 4), lastYear = last.slice(0, 4);
  return dateLabel(start) + (firstYear !== lastYear ? ' ' + firstYear : '') + ' – ' + dateLabel(last) + ' ' + lastYear;
}
function weekLabel(day: string) {
  const value = new Date(day + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + 3);
  const year = value.getUTCFullYear();
  const week = Math.ceil(((value.getTime() - Date.UTC(year, 0, 1, 12)) / 86400000 + 1) / 7);
  return 'KW ' + String(week).padStart(2, '0');
}
const columns = [
  ['numbers', 'Nummern', 'Unterschiedliche tatsächlich angewählte Rufnummern, einmal pro Person und Zeitraum.'],
  ['appointments', 'Termine', 'Erstmals bestätigte Quali- oder Sales-Termine mit Kundenkontakt. Punkte für die Person, die den Termin angelegt hat.'],
  ['brochures', 'Broschüren', 'Erfolgreich versendete Broschüren. Fehlgeschlagene Zustellungen zählen nicht.'],
  ['salesCalls', 'Sales Calls', 'Als durchgeführt markierte Sales-Termine, am Termindatum. Punkte für die zugewiesene Person.'],
  ['deals', 'Abschlüsse', 'Erster Wechsel eines Leads in eine gewonnene Phase. Punkte für die ausführende Person.'],
] as const;

export function RankingTable({ refreshKey = 0 }: { refreshKey?: number }) {
  const id = useId();
  const [selection, setSelection] = useState<{ period: RankingPeriod; date?: string }>({ period: 'week' });
  const [report, setReport] = useState<RankingReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true;
    const fetchReport = async (initial = false) => {
      if (initial) setBusy(true);
      try {
        const data = await loadRanking(selection.period, selection.date);
        if (active) { setReport(data); setError(false); }
      } catch { if (active) setError(true); }
      finally { if (active) setBusy(false); }
    };
    void fetchReport(true);
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void fetchReport(); }, 60000);
    const onFocus = () => { void fetchReport(); };
    window.addEventListener('focus', onFocus);
    return () => { active = false; clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, [selection, revision, refreshKey]);
  const select = (period: RankingPeriod, date?: string) => {
    setReport(null); setBusy(true); setError(false); setSelection({ period, date });
  };
  const previous = report ? shift(report.start, -1) : undefined;
  const earliest = report && (selection.period === 'month' ? report.launchedWeek.slice(0, 7) + '-01' : report.launchedWeek);
  const isCurrent = report && report.start <= report.today && report.end > report.today;
  const paused = report && report.start < report.firstWeekPause.end && report.end > report.firstWeekPause.start ? report.firstWeekPause.users : [];
  const people = report ? [...new Map(report.history.flatMap(week => week.rows.map(row => [row.id, row] as const))).values()] : [];
  return <section className="sales-ranking" aria-labelledby={id + '-title'}>
    <header className="sales-ranking-head">
      <div className="sales-ranking-heading"><span className="sales-ranking-eyebrow">VERTRIEB / TEAMLEISTUNG</span><h2 id={id + '-title'}>Die Rangliste<span className="sales-ranking-dot" aria-hidden="true" /></h2></div>
      <div className="sales-ranking-controls">
        <div className="sales-ranking-tabs" role="group" aria-label="Ranglisten-Zeitraum">
          {(['week', 'month'] as const).map(period => <button type="button" key={period} aria-pressed={selection.period === period} onClick={() => select(period)}>{period === 'week' ? 'Woche' : 'Monat'}</button>)}
        </div>
        <button type="button" className="sales-ranking-icon" aria-label="Rangliste aktualisieren" disabled={busy} onClick={refresh}><RefreshCw size={14} className={busy ? 'sales-ranking-spin' : ''} /></button>
      </div>
    </header>
    <div className="sales-ranking-period">
      <div className="sales-ranking-pagination">
        <button type="button" className="sales-ranking-icon" aria-label="Vorheriger Zeitraum" disabled={busy || !report || report.start <= (earliest || '')} onClick={() => select(selection.period, previous)}><ChevronLeft size={16} /></button>
        <span>{report ? periodLabel(report.start, report.end, selection.period) : selection.period === 'week' ? 'Wochenwertung' : 'Monatswertung'}</span>
        <button type="button" className="sales-ranking-icon" aria-label="Nächster Zeitraum" disabled={busy || !report || !!isCurrent} onClick={() => select(selection.period, report?.end)}><ChevronRight size={16} /></button>
        {report && !isCurrent && <button type="button" className="sales-ranking-link" onClick={() => select(selection.period)}>Aktuell</button>}
      </div>
      <span className="sales-ranking-period-note">{report && !isCurrent ? 'Abgeschlossener Zeitraum' : selection.period === 'week' ? 'Neue Wertung jeden Montag' : 'Wertung pro Kalendermonat'}</span>
    </div>
    {error && <div className="sales-ranking-message" role="alert">{report ? 'Aktualisierung fehlgeschlagen. Die angezeigten Werte können veraltet sein.' : 'Die Rangliste konnte nicht geladen werden.'} <button type="button" className="sales-ranking-link" onClick={refresh}>Erneut laden</button></div>}
    {busy && !report && <p className="sales-ranking-message" role="status">Teamleistung wird geladen …</p>}
    {report && <>
      <div className="sales-ranking-scroll" tabIndex={0} role="region" aria-label="Vertriebsranking, horizontal scrollbar">
        <table className="sales-ranking-table sales-ranking-main-table">
          <caption className="sales-ranking-sr-only">Vertriebsranking {periodLabel(report.start, report.end, report.period)}. Gleiche Punktzahl bedeutet gleicher Rang.</caption>
          <thead><tr><th scope="col" className="sales-ranking-place">#</th><th scope="col">Vertriebler</th>{columns.map(([key, label, description]) => <th scope="col" key={key}><abbr title={description}>{label}</abbr></th>)}<th scope="col">Punkte</th></tr></thead>
          <tbody>{report.rows.map(row => <tr key={row.id} data-leader={row.rank === 1 || undefined}>
            <td className="sales-ranking-place">{row.rank ? String(row.rank).padStart(2, '0') : '—'}</td>
            <th scope="row"><span className="sales-ranking-person"><span className="sales-ranking-initials" aria-hidden="true">{row.name.split(/\s+/).filter(Boolean).map(word => word[0]).slice(0, 2).join('')}</span><span>{row.name}{!row.active && <small>Inaktiv</small>}</span></span></th>
            {columns.map(([key]) => <td key={key} className={row[key] === 0 ? 'sales-ranking-zero' : undefined}>{number.format(row[key])}</td>)}
            <td><strong className="sales-ranking-points">{number.format(row.points)}</strong></td>
          </tr>)}</tbody>
        </table>
        {!report.rows.length && <p className="sales-ranking-message">Für diesen Zeitraum nimmt noch niemand an der Wertung teil.</p>}
      </div>
      <p className="sales-ranking-scroll-hint">Weitere Kennzahlen durch seitliches Scrollen →</p>
      {report.rows.length > 0 && report.rows.every(row => row.points === 0) && <p className="sales-ranking-footnote">Noch keine gewerteten Aktivitäten in diesem Zeitraum.</p>}
      {!!paused.length && <p className="sales-ranking-pause">{paused.map(user => user.name).join(', ')} pausiert in der Startwoche ({dateLabel(report.firstWeekPause.start)} – {dateLabel(shift(report.firstWeekPause.end, -1))}). Ab {dateLabel(report.firstWeekPause.end)} regulär in der Wertung.</p>}
      <footer className="sales-ranking-footer">
        <button type="button" className="sales-ranking-history-button" aria-expanded={historyOpen} aria-controls={id + '-history'} onClick={() => setHistoryOpen(value => !value)}><ChevronDown size={14} style={{ transform: historyOpen ? 'rotate(180deg)' : undefined }} />Wochenpunkte<span>{report.history.length}</span></button>
        <span>Stand {new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(report.updatedAt))} · Berlin</span>
      </footer>
      {historyOpen && <div id={id + '-history'} className="sales-ranking-history">
        <div className="sales-ranking-scroll" tabIndex={0} role="region" aria-label="Wochenpunkte, horizontal scrollbar"><table className="sales-ranking-table">
          <caption className="sales-ranking-history-caption">Wochenpunkte bleiben erhalten. Ältere Wochen erreichst du über die Zeitraum-Auswahl.</caption>
          <thead><tr><th scope="col">Woche</th>{people.map(person => <th key={person.id} scope="col">{person.name}</th>)}</tr></thead>
          <tbody>{report.history.map(week => <tr key={week.start}><th scope="row"><button type="button" className="sales-ranking-week-link" onClick={() => select('week', week.start)}>{weekLabel(week.start)} <span>{dateLabel(week.start)} – {dateLabel(shift(week.end, -1))}</span>{week.current && <small>Läuft</small>}</button></th>{people.map(person => {
            const row = week.rows.find(entry => entry.id === person.id);
            return <td key={person.id}>{row ? number.format(row.points) : <span title="Nicht in der Wertung">—</span>}</td>;
          })}</tr>)}</tbody>
        </table></div>
      </div>}
      <details className="sales-ranking-rules"><summary>So wird gezählt</summary><div><p>{columns.map(([key, label]) => label + ': ' + report.weights[key] + (report.weights[key] === 1 ? ' Punkt' : ' Punkte')).join(' · ')}.</p><ul>{columns.map(([key, label, description]) => <li key={key}><strong>{label}:</strong> {description}</li>)}</ul><p>Ein bestätigter Termin bleibt als Buchungsleistung erhalten, auch wenn er später abgesagt wird. Wiederholte Bestätigungen und Statuswechsel geben keine zusätzlichen Punkte. Nummern zählen im Wochenranking einmal pro Woche, im Monatsranking einmal pro Monat. Deshalb sind Monatspunkte keine Summe der Wochenpunkte. Gleiche Punktzahl bedeutet gleicher Rang.</p><p>Wertung seit {dateLabel(report.launchedWeek)}{'.'} Anrufzahlen erfassen die im CRM protokollierten ausgehenden Anrufe.</p></div></details>
    </>}
  </section>;
}
