/**
 * AdminTopbar — 56px Topbar with breadcrumb, quick-actions, ⌘K trigger,
 * notifications and user menu.
 *
 * Adapted from User-Dashboard `layout/TopbarV2.tsx` for Admin context.
 */

import { Fragment, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Briefcase,
  LogOut,
  Menu,
  Search,
  ShieldAlert,
  User as UserIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/context/AuthContext';
import { useActiveImpersonation } from '@/hooks/useActiveImpersonation';
import { endImpersonation } from '@/hooks/useImpersonate';
import { useOffeneSachen } from '@/hooks/useOffeneSachen';
import { NotificationsBell } from './NotificationsBell';
import { ErscheinungsbildKnopf } from './ErscheinungsbildKnopf';
import type { Admin } from '@/api/types';
import { useConfirmDiscard } from '@/hooks/useUnsavedChanges';
import { WORKSPACE_HEADER, WORKSPACE_SEARCH, WORKSPACE_ACTION, WORKSPACE_AVATAR } from './workspaceShell';
import { canUseWorkspaceSwitch } from '@/lib/workspaceAccess';

const ROUTE_LABELS: Record<string, string> = {
  '': 'Arbeitsübersicht',
  tenants: 'Händler',
  onboarding: 'Onboarding & Einrichtung',
  calendar: 'Kalender',
  einstellungen: 'Einstellungen',
  'access-requests': 'Zugänge beantragen',
  support: 'Support-Konsole',
  admins: 'Admins',
  audit: 'Audit Log',
  oem: 'OEM',
  registry: 'Registry',
  lookup: 'Lookup',
  batch: 'Batch Test',
  errors: 'Errors',
  accuracy: 'Accuracy',
  bot: 'Bot',
  testing: 'Test & Simulation',
  'e2e-runner': 'E2E-Flow-Runner',
  'live-sim': 'Live-Simulation',
  inbox: 'Inbox',
  orders: 'Bestellungen',
  erp: 'ERP & Warenwirtschaft',
  maintenance: 'Maintenance',
  marketing: 'Marketing-Zentrale',
  settings: 'Settings',
  profile: 'Profil',
};

// Hier stand `PLATFORM_NOTIFICATIONS_ENABLED = false` mit der richtigen
// Begruendung: /api/events/ticket verlangt einen Mandantenbezug, den eine
// Plattform-Admin-Sitzung nicht hat, und ein Anschluss haette bei jedem Laden
// und jedem Wiederverbinden eine fehlschlagende Anfrage erzeugt.
//
// Die Glocke braucht dafuer aber gar keinen Ereignisstrom. Was hier wirklich
// interessiert — ungelesene Post, nicht zugestellte Zugangsanfragen — holen
// wir ohnehin schon fuer andere Ansichten. Siehe hooks/useOffeneSachen.ts.

function humanize(segment: string): string {
  return ROUTE_LABELS[segment] ?? segment.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface BreadcrumbCrumb {
  label: string;
  to: string;
  isLast: boolean;
}

function buildBreadcrumbs(pathname: string): BreadcrumbCrumb[] {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) {
    return [{ label: 'Arbeitsübersicht', to: '/', isLast: true }];
  }
  const crumbs: BreadcrumbCrumb[] = [{ label: 'Arbeitsübersicht', to: '/', isLast: false }];
  let acc = '';
  parts.forEach((seg, idx) => {
    acc += `/${seg}`;
    crumbs.push({
      label: parts[0] === 'tenants' && idx === 1 ? (seg === 'new' ? 'Händler einrichten' : 'Händlerakte') : humanize(seg),
      to: acc,
      isLast: idx === parts.length - 1,
    });
  });
  return crumbs;
}

/**
 * Zurückhaltende Pille in der Kopfzeile — dieselbe Form wie im CRM.
 *
 * Nicht ausgeführt: sie wird nur hier gebraucht, und ein Export neben
 * Komponenten kostet in dieser Datei das schnelle Neuladen im Entwicklungslauf.
 * Das Gegenstück im CRM steht dort ebenfalls dateiintern.
 */

/**
 * Feste Breite des Wechselknopfs.
 *
 * "CRM" und "Admin" sind unterschiedlich lang. Ohne feste Breite läge der
 * Rückweg im CRM ein paar Pixel woanders — und genau das war der Wunsch: nach
 * dem Wechsel soll der Zeiger auf dem Knopf zurück stehen. Der Wert ist in
 * beiden Anwendungen gleich (CRM-System/src/app/components/layout/Topbar.tsx).
 */
const WECHSEL_BREITE = 'md:w-[104px] md:justify-center';

interface AdminTopbarProps {
  /** Trigger when user opens command palette (⌘K). */
  onOpenCommandPalette?: () => void;
  /** Trigger to toggle the mobile sidebar (hamburger). */
  onOpenMobileSidebar?: () => void;
  /** Optional slot for tenant-specific quick actions. */
  rightSlot?: ReactNode;
  className?: string;
}

export function AdminTopbar({
  onOpenCommandPalette,
  onOpenMobileSidebar,
  rightSlot,
  className,
}: AdminTopbarProps) {
  const location = useLocation();
  const crumbs = buildBreadcrumbs(location.pathname);
  const { ungeleseneMails, fehlgeschlageneAnfragen } = useOffeneSachen();
  const { user, logout } = useAuth();
  const impersonation = useActiveImpersonation();
  const [endingImpersonation, setEndingImpersonation] = useState(false);

  const handleLogout = async (): Promise<void> => {
    await logout();
  };

  return (
    <div className={cn('sticky top-0 z-30', className)}>
      {/* P1.4: Impersonation-Banner — der eigentliche Impersonation-Tab ist das
          User-Dashboard; hier sieht der Admin den State + steigt in-app aus. */}
      {impersonation && (
        <div className="flex items-center justify-between gap-3 bg-status-warning px-4 py-1.5 text-xs font-medium text-canvas">
          <span className="flex items-center gap-2">
            <ShieldAlert size={13} />
            Impersonation aktiv:{' '}
            <strong className="font-semibold">{impersonation.tenantName}</strong>
            {impersonation.expiresAt && (
              <span className="opacity-80">
                · bis{' '}
                {new Date(impersonation.expiresAt).toLocaleTimeString('de-DE', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </span>
          <button
            type="button"
            disabled={endingImpersonation}
            onClick={async () => {
              // Audit H-1: revoke server-side (blacklist the token) before
              // clearing the local marker, so "exit" is real, not cosmetic.
              if (endingImpersonation) return;
              setEndingImpersonation(true);
              try {
                await endImpersonation(impersonation?.sessionId);
              } catch (error) {
                toast.error('Händleransicht konnte nicht sicher beendet werden.', {
                  description: error instanceof Error ? error.message : 'Bitte erneut versuchen.',
                });
              } finally {
                setEndingImpersonation(false);
              }
            }}
            className="font-semibold underline underline-offset-2 hover:opacity-80 disabled:cursor-wait disabled:opacity-70"
          >
            {endingImpersonation ? 'Wird sicher beendet…' : 'Zurück zum Admin'}
          </button>
        </div>
      )}
      <header
        className={cn(
          WORKSPACE_HEADER,
          // Redesign: die Kopfzeile schwebt ueber dem Inhalt statt ihn
          // abzuschneiden — durchscheinend mit Weichzeichner. `supports` sorgt
          // dafuer, dass sie ohne backdrop-filter deckend bleibt und der Text
          // darunter nicht durchscheint.
          'admin-topbar border-b border-border bg-surface',
        )}
        role="banner"
      >
      {/* Mobile: hamburger */}
      <button
        type="button"
        onClick={onOpenMobileSidebar}
        className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-md text-text-secondary hover:text-text-primary hover:bg-elevated"
        aria-label="Navigation öffnen"
      >
        <Menu size={18} />
      </button>

      <Breadcrumbs crumbs={crumbs} />

      <div className="flex-1" />

      <CommandTrigger onClick={onOpenCommandPalette} />


      <ErscheinungsbildKnopf />

      <NotificationsBell
        ungeleseneMails={ungeleseneMails}
        fehlgeschlageneAnfragen={fehlgeschlageneAnfragen}
      />
      {/* Workspace-Wechsel → CRM (separate App/Domain)
          
          Sitzt UNMITTELBAR links vom Avatar und hat eine feste Breite — im CRM
          steht der Rückweg ("Admin") an genau derselben Stelle mit genau
          derselben Breite. Wer hier klickt, hat den Zeiger nach dem Wechsel
          direkt auf dem Knopf zurück. Der Wert steht in beiden Anwendungen als
          WECHSEL_BREITE; wer ihn ändert, muss es dort auch tun. */}
      {canUseWorkspaceSwitch(user) && user?.app_access?.crm !== false && <a
        href="https://crm.partsunion.de"
        className={cn(WORKSPACE_ACTION, WECHSEL_BREITE)}
        aria-label="Zum CRM wechseln"
        title="Zum CRM wechseln"
      >
        <Briefcase size={15} className="shrink-0 text-text-tertiary" />
        <span className="hidden md:inline">CRM</span>
      </a>}

      <UserMenu user={user} onLogout={handleLogout} />

      {rightSlot}
      </header>
    </div>
  );
}

function Breadcrumbs({ crumbs }: { crumbs: BreadcrumbCrumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="hidden sm:flex items-center min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-[12px] font-medium">
        {crumbs.map((c, i) => (
          <Fragment key={`${c.to}-${i}`}>
            {i > 0 && (
              <span aria-hidden className="shrink-0 text-border-strong">
                /
              </span>
            )}
            <li className="max-w-[180px] truncate">
              {c.isLast ? (
                <span aria-current="page" className="font-bold text-text-primary">
                  {c.label}
                </span>
              ) : (
                <Link to={c.to} className="text-text-muted transition-colors hover:text-text-primary">
                  {c.label}
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}


function CommandTrigger({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={WORKSPACE_SEARCH}
      aria-label="Befehlspalette öffnen"
    >
      <Search size={16} className="shrink-0 text-text-muted" aria-hidden />
      {/* Der Platzhaltertext nennt, wonach man suchen kann — "Suche…" liess
          offen, ob damit Kunden, Tickets oder Teilenummern gemeint sind. */}
      <span className="hidden min-w-0 flex-1 truncate text-left text-xs font-medium text-text-muted lg:inline">
        Kunden, Tickets, OE-Nummern…
      </span>
      <kbd className="hidden items-center rounded-[5px] bg-overlay/[0.06] px-1.5 py-[3px] font-mono text-[10px] font-medium text-text-muted md:inline-flex">
        ⌘K
      </kbd>
    </button>
  );
}

function UserMenu({
  user,
  onLogout,
}: {
  user: Admin | null;
  onLogout: () => void | Promise<void>;
}) {
  const displayName = user?.username ?? 'Admin';
  const confirmDiscard = useConfirmDiscard();
  const initials = user
    ? displayName
        .split(/[\s._-]+/)
        .filter(Boolean)
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'AD';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={WORKSPACE_AVATAR}
          aria-label="Benutzermenü"
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="text-sm font-medium">{displayName}</span>
          <span className="text-xs text-text-muted">
            {user?.email ?? 'nicht angemeldet'}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile" className="flex items-center gap-2 cursor-pointer">
            <UserIcon size={14} /> Profil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            if (confirmDiscard()) void onLogout();
          }}
          className="flex items-center gap-2 text-status-danger focus:text-status-danger"
        >
          <LogOut size={14} /> Abmelden
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
