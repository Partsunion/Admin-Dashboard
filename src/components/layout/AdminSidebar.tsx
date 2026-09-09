/**
 * AdminSidebar — Premium collapsible sidebar for the Admin-Dashboard.
 *
 *  - 240px expanded / 56px collapsed
 *  - localStorage-Persistenz: `pu.admin.sidebar.collapsed.v1`
 *  - 2px Sharp Accent-Bar bei aktivem Item (kein Highlight-BG)
 *  - Tooltips bei collapsed Icons (Radix Tooltip)
 *  - Cmd+\ Toggle
 *  - Mobile: Drawer (Slide-Over via Sheet)
 *
 * Adapted from User-Dashboard `layout/SidebarV2.tsx`.
 */

import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Building2,
  Boxes,
  Calendar,
  KeyRound,
  LayoutDashboard,
  Mail,
  Megaphone,
  MessageSquareText,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  ClipboardCheck,
  Search,
  Send,
  Settings,
  ShoppingCart,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { WORKSPACE_BRAND, WORKSPACE_MARK, WORKSPACE_NAV_ITEM } from './workspaceShell';
import { usePermissions, type Permission } from '@/auth/usePermissions';

const STORAGE_KEY = 'pu.admin.sidebar.collapsed.v1';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  tone: NavTone;
  end?: boolean;
  /** Only shown to SUPER_ADMIN — route is also SUPER_ADMIN-guarded. */
  superAdmin?: boolean;
  permission?: Permission;
  badge?: string;
}

type NavTone = 'accent' | 'info' | 'success' | 'warning' | 'danger';

const NAV_TONES: Record<NavTone, string> = {
  accent: 'bg-[rgb(var(--admin-nav-overlay)/0.045)] text-blue-300',
  info: 'bg-[rgb(var(--admin-nav-overlay)/0.045)] text-sky-300',
  success: 'bg-[rgb(var(--admin-nav-overlay)/0.045)] text-emerald-300',
  warning: 'bg-[rgb(var(--admin-nav-overlay)/0.045)] text-amber-300',
  danger: 'bg-[rgb(var(--admin-nav-overlay)/0.045)] text-rose-300',
};

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

/**
 * Die Navigation trägt nur noch das Tagesgeschäft.
 *
 * Alles, was selten oder nur zur Verwaltung gebraucht wird — Admins, Audit-Log,
 * Support-Konsole, Postfach-Rechte, Wartung — liegt unter /einstellungen.
 * Eine Leiste mit dreizehn Einträgen ist keine Navigation mehr, sondern eine
 * Liste, in der man sucht.
 *
 * Das Mailsystem steht bewusst NICHT hier: es läuft als eigenständige
 * Vollbild-Anwendung unter /mail, außerhalb dieses Rahmens.
 */
const NAV_SECTIONS: NavSection[] = [
  {
    id: 'top',
    label: 'Heute',
    items: [
      { to: '/', label: 'Betriebszentrale', icon: LayoutDashboard, tone: 'accent', end: true },
      { to: '/mail', label: 'E-Mail', icon: Mail, tone: 'info', permission: 'inbox.read' },
      { to: '/calendar', label: 'Kalender', icon: Calendar, tone: 'warning' },
    ],
  },
  {
    id: 'kunden',
    label: 'Betrieb & Händler',
    items: [
      { to: '/tenants', label: 'Händler & Kunden', icon: Building2, tone: 'success', permission: 'tenants.read' },
      { to: '/onboarding', label: 'Einrichtungen', icon: ClipboardCheck, tone: 'accent', permission: 'tenants.read' },
      { to: '/erp', label: 'ERP-Zentrale', icon: Boxes, tone: 'warning' },
      { to: '/orders', label: 'Bestellungen', icon: ShoppingCart, tone: 'info', permission: 'orders.read' },
      { to: '/access-requests', label: 'Zugangsanfragen', icon: KeyRound, tone: 'warning', permission: 'tenants.read' },
    ],
  },
  {
    id: 'wachstum',
    label: 'Wachstum & Vertrieb',
    items: [
      // Jede Person, die diese Plattform betreten darf, soll den Bereich
      // finden. Schreibrechte bleiben in der Ansicht und im Backend separat
      // geschützt; eine Navigationsberechtigung darf den Einstieg nicht
      // unsichtbar machen.
      { to: '/marketing', label: 'Marketing & Ads', icon: Megaphone, tone: 'danger' },
      { to: '/outreach', label: 'Outreach', icon: Send, tone: 'accent', permission: 'emails.send' },
    ],
  },
  {
    id: 'werkzeuge',
    label: 'Teile & Qualität',
    items: [
      { to: '/oe-quality', label: 'Teilequalität', icon: ShieldCheck, tone: 'success', permission: 'oem.read' },
      { to: '/oem-finder', label: 'OEM-Finder', icon: Search, tone: 'info', permission: 'oem.read' },
    ],
  },
  {
    id: 'intern',
    label: 'Intern',
    items: [
      { to: '/notizen', label: 'Notizen', icon: NotebookPen, tone: 'warning' },
      { to: '/feedback', label: 'Feedback', icon: MessageSquareText, tone: 'danger' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { to: '/einstellungen', label: 'Einstellungen', icon: Settings, tone: 'accent' },
    ],
  },
];

function readPersistedCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePersistedCollapsed(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* noop */
  }
}

export interface AdminSidebarProps {
  className?: string;
  /** Mobile open state (controlled). Mobile uses Sheet drawer. */
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

export function AdminSidebar({
  className,
  mobileOpen = false,
  onMobileOpenChange,
}: AdminSidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => readPersistedCollapsed());

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writePersistedCollapsed(next);
      return next;
    });
  }, []);

  // Cmd+\ toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleCollapsed]);

  const desktopSidebar = (
    <aside
      className={cn(
        'hidden md:flex flex-col h-screen sticky top-0 shrink-0',
        // Redesign: durchscheinende Verlaufsflaeche statt deckendem Grau. Die
        // Leiste sitzt damit auf dem Lichtverlauf der Seite, statt ihn zu
        // verdecken.
        'admin-sidebar border-r',
        'transition-[width] duration-200 ease-out',
        collapsed ? 'w-16' : 'w-64',
        className,
      )}
      aria-label="Hauptnavigation"
    >
      <SidebarBrand collapsed={collapsed} />
      <SidebarNav collapsed={collapsed} />
      <SidebarFooter collapsed={collapsed} onToggle={toggleCollapsed} />
    </aside>
  );

  return (
    <TooltipProvider delayDuration={150}>
      {desktopSidebar}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent
          side="left"
          className="admin-sidebar w-64 border-r p-0"
        >
          <SheetTitle className="sr-only">Admin-Navigation</SheetTitle>
          <SheetDescription className="sr-only">Arbeitsbereich auswählen</SheetDescription>
          <div className="flex flex-col h-full">
            <SidebarBrand collapsed={false} />
            <SidebarNav collapsed={false} onNavigate={() => onMobileOpenChange?.(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}

/**
 * Markenblock nach dem Redesign: Verlaufsquadrat, daneben Name und
 * "ADMIN CONSOLE" in Versalien.
 *
 * Im Quadrat steht UNSER Symbol, nicht das gezeichnete "P" des Entwurfs. Die
 * Geometrie ist die des Entwurfs (32 px, 9 px Radius, Akzentverlauf), der
 * Inhalt ist die echte Marke.
 *
 * Warum die weisse Ausstanzung und nicht das farbige Logo: das Markenblau
 * (#2260cd) auf dem Akzentverlauf ergibt keinen Kontrast — Blau auf Blau. Auf
 * farbigem Grund nimmt man die einfarbige Fassung, das ist bei jeder Marke so.
 * Die Datei ist aus der Wortmarke freigestellt, nicht nachgezeichnet.
 */
function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn(
        WORKSPACE_BRAND,
        collapsed && 'justify-center px-0',
      )}
    >
      <span className={WORKSPACE_MARK}>
        <img
          src="/partsunion-symbol-weiss.png"
          alt="Partsunion"
          width={19}
          height={19}
          className="size-[19px]"
        />
      </span>
      {!collapsed && (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-display text-[15px] font-bold tracking-[-0.01em] text-[hsl(var(--admin-nav-text))]">
            Partsunion
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--admin-nav-muted))]">
            Operations Console
          </span>
        </span>
      )}
    </div>
  );
}

function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { isSuperAdmin, can } = usePermissions();
  // Hide SUPER_ADMIN-only entries from non-super admins so they don't click a
  // link that dead-ends at the 403 ForbiddenView (the route guard still enforces it).
  const sections = NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((it) => (!it.superAdmin || isSuperAdmin) && (!it.permission || can(it.permission))),
    }))
    .filter((section) => section.items.length > 0);
  return (
    <nav className="admin-sidebar-scroll flex-1 overflow-y-auto px-0 pb-3 pt-3" aria-label="Navigation">
      {sections.map((section) => (
        <SidebarSection
          key={section.id}
          section={section}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}

function SidebarSection({
  section,
  collapsed,
  onNavigate,
}: {
  section: NavSection;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="mb-3">
      {!collapsed && (
        <div className="mb-1 px-[22px] text-[9px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--admin-nav-faint))]">
          {section.label}
        </div>
      )}
      <ul className="space-y-0.5">
        {section.items.map((item) => (
          <li key={item.to}>
            <SidebarLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SidebarLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  const link = (
    <NavLink
      to={item.to}
      aria-label={collapsed ? item.label : undefined}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          // Redesign: 10 px Radius, Manrope halbfett, durchscheinende
          // Auflage beim Ueberfahren statt deckender Flaeche.
          WORKSPACE_NAV_ITEM,
          'text-[hsl(var(--admin-nav-muted))]',
          'hover:bg-[rgb(var(--admin-nav-overlay)/0.055)] hover:text-[hsl(var(--admin-nav-text))]',
          collapsed ? 'justify-center px-0' : 'gap-[11px] px-[11px]',
          // Aktiv: waagerechter Akzentverlauf, der nach rechts ausläuft — plus
          // der 2-px-Balken am linken Rand (unten als Element, nicht als
          // inset-Schatten: der wuerde beim Radius mitgerundet).
          isActive &&
            'bg-[rgb(var(--admin-nav-overlay)/0.09)] text-[hsl(var(--admin-nav-text))] shadow-[inset_0_0_0_1px_rgb(var(--admin-nav-overlay)/0.035)]',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* 2px Sharp Accent-Bar bei active */}
          {isActive && (
            <span
              aria-hidden
              className="absolute inset-y-2 left-0 w-[2px] rounded-r-full bg-[hsl(var(--admin-nav-signal))]"
            />
          )}
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md transition-[background-color,color] duration-150',
              isActive ? 'bg-[rgb(var(--admin-nav-overlay)/0.10)] text-[hsl(var(--admin-nav-text))]' : NAV_TONES[item.tone],
            )}
          >
            <Icon size={15} aria-hidden />
          </span>
          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          {!collapsed && item.badge && <span className="text-[9px] font-bold tracking-[0.1em] text-[hsl(var(--admin-nav-faint))]">{item.badge}</span>}
        </>
      )}
    </NavLink>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarFooter({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex w-full items-center rounded-lg py-1.5 text-xs font-semibold transition-colors',
        'text-[hsl(var(--admin-nav-muted))] hover:bg-[rgb(var(--admin-nav-overlay)/0.05)] hover:text-[hsl(var(--admin-nav-text))]',
        collapsed ? 'justify-center px-0' : 'justify-start gap-2 px-1',
      )}
      aria-label={collapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
    >
      {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      {!collapsed && <span>Einklappen</span>}
      {!collapsed && (
        <kbd className="ml-auto rounded-[5px] bg-[rgb(var(--admin-nav-overlay)/0.06)] px-1.5 py-[3px] font-mono text-[10px] font-medium text-[hsl(var(--admin-nav-faint))]">
          ⌘\
        </kbd>
      )}
    </button>
  );

  return (
    <div className="shrink-0 border-t border-[rgb(var(--admin-nav-overlay)/0.08)] p-3.5">
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            Sidebar ausklappen ( ⌘\ )
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </div>
  );
}

/** Re-export for tests / route helpers. */
export const ADMIN_NAV_SECTIONS: ReadonlyArray<NavSection> = NAV_SECTIONS;
export type { NavItem, NavSection };
