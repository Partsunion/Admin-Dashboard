import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Archive,
    ArrowLeft,
    Download,
    FilePen,
    FileText,
    Forward,
    Inbox,
    Loader2,
    Mail,
    MailOpen,
    MoreHorizontal,
    Paperclip,
    Pencil,
    RefreshCw,
    Reply,
    ReplyAll,
    RotateCcw,
    Search,
    Send,
    ShieldAlert,
    ShieldCheck,
    Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { MailHtmlFrame } from '@/components/mail/MailHtmlFrame';
import { MailConversation, MailInternalNote, MailWorkflow } from '@/components/mail/MailWorkflow';
import { useConfirmDiscard } from '@/hooks/useUnsavedChanges';
import { MailComposer } from '@/components/mail/MailComposer';
import { originalQuote, prefixSubject, replyRecipients, seedFromDraft, type ComposeSeed } from '@/components/mail/mailCompose';

import {
    downloadInboxAttachment,
    type InboxFolder,
    getInboxMessage,
} from '@/api/inbox';
import type { InboxMessage } from '@/api/types';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/useDebounce';
import {
    useInbox,
    useMailboxes,
    useMarkAsNotSpam,
    useMarkAsSpam,
    useMarkInboxRead,
    useMoveInboxMessage,
    useRestoreInboxMessage,
} from '@/hooks/useInbox';
import { formatDateTime, formatRelative } from '@/utils/format/date';
import { cn } from '@/lib/utils';
import { SEITEN_RAND_OHNE_BREITE } from '@/components/ui/seite';
import { inboxAttention, nextInboxMessageId } from './inboxWorkspace';

function senderLabel(message: InboxMessage): string {
    if (message.direction === 'outbound') return message.to[0] || 'Unbekannter Empfänger';
    return message.from_name || message.from;
}

function initials(value: string): string {
    const clean = value.includes('@') ? value.split('@')[0] : value;
    return clean
        .split(/[\s._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('') || 'M';
}

function preview(value: string | null | undefined): string {
    return (value || '').replace(/\s+/g, ' ').trim() || 'Keine Vorschau verfügbar.';
}

const FOLDER_LABELS: Record<InboxFolder, string> = {
    inbox: 'Posteingang',
    sent: 'Gesendet',
    drafts: 'Entwürfe',
    archive: 'Archiv',
    trash: 'Papierkorb',
    spam: 'Spam',
};

const FOLDER_EMPTY_HINTS: Record<InboxFolder, string> = {
    inbox: 'Neue E-Mails erscheinen hier automatisch.',
    sent: 'Gesendete E-Mails erscheinen hier.',
    drafts: 'Angefangene E-Mails werden hier gespeichert.',
    archive: 'Archivierte E-Mails erscheinen hier.',
    trash: 'Gelöschte E-Mails bleiben hier, bis du sie wiederherstellst.',
    spam: 'Aussortierte E-Mails. Prüfe hier, falls etwas fehlt.',
};

const FOLDER_ICONS: Record<InboxFolder, typeof Inbox> = {
    inbox: Inbox,
    sent: Send,
    drafts: FilePen,
    archive: Archive,
    trash: Trash2,
    spam: ShieldAlert,
};

const WORK_QUEUES = [
    { value: 'all', label: 'Alle' },
    { value: 'mine', label: 'Meine' },
    { value: 'open', label: 'Offen' },
    { value: 'in_progress', label: 'In Arbeit' },
    { value: 'done', label: 'Erledigt' },
] as const;

export default function InboxView(): JSX.Element {
    const [folder, setFolder] = useState<InboxFolder>('inbox');
    const [mailbox, setMailbox] = useState('all');
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const confirmDiscard = useConfirmDiscard();
    const [composeOpen, setComposeOpen] = useState(false);
    const [composeSeed, setComposeSeed] = useState<ComposeSeed>({});
    const [draftLoading, setDraftLoading] = useState<string | null>(null);
    const draftRequest = useRef(0);
    useEffect(() => () => { draftRequest.current++; }, []);
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [workQueue, setWorkQueue] = useState('all');
    const debouncedSearch = useDebounce(search, 250);
    const searchRef = useRef<HTMLInputElement>(null);

    const mailboxQuery = useMailboxes();
    const inboxQuery = useInbox({
        mailbox,
        folder,
        search: debouncedSearch || undefined,
        unreadOnly: folder === 'inbox' && unreadOnly ? true : undefined,
        assignmentStatus: workQueue === 'open' || workQueue === 'in_progress' || workQueue === 'done' ? workQueue : undefined,
        assignedToMe: workQueue === 'mine',
        limit: 50,
    });
    const markRead = useMarkInboxRead();
    const moveMessage = useMoveInboxMessage();
    const markSpam = useMarkAsSpam();
    const markNotSpam = useMarkAsNotSpam();
    const restoreMessage = useRestoreInboxMessage();
    const listedSelection = inboxQuery.items.find((item) => item.id === selectedId) ?? null;

    /**
     * Der volle Koerper kommt erst beim Oeffnen — die Liste traegt nur noch
     * eine Vorschau.
     *
     * Vorher verschickte die Liste fuer jede Nachricht das komplette HTML:
     * 50 Mails = 4,3 MB, eine einzelne davon 3,6 MB. Nach JEDER Aktion im
     * Postfach lud die Liste neu, und der Browser zerlegte die Megabytes auf
     * dem Hauptthread — der nachgemessene 3,3-Sekunden-Stau, in dem jeder
     * Klick (auch der auf "Dashboard") in der Warteschlange stand.
     *
     * `staleTime: 5 min`: eine geoeffnete Mail aendert ihren Koerper nicht.
     * Entwuerfe sind ausgenommen — die oeffnen den Verfasser, keinen Leser.
     */
    const vollAbfrage = useQuery({
        queryKey: ['admin', 'inbox', 'email', selectedId] as const,
        queryFn: () => getInboxMessage(selectedId as string),
        enabled: selectedId !== null && listedSelection?.folder !== 'drafts',
        staleTime: 5 * 60_000,
    });
    const selectedVoll = vollAbfrage.data && vollAbfrage.data.id === selectedId
        ? vollAbfrage.data
        : null;
    const selected = selectedVoll ?? listedSelection;
    const allUnread = mailboxQuery.mailboxes.find((item) => item.id === 'all')?.unread ?? 0;

    function selectFolder(nextFolder: InboxFolder): void {
        if ((nextFolder !== folder || selectedId !== null) && !confirmDiscard()) return;
        draftRequest.current++; setDraftLoading(null);
        setFolder(nextFolder);
        setSelectedId(null);
    }

    function selectMailbox(nextMailbox: string): void {
        if ((nextMailbox !== mailbox || selectedId !== null) && !confirmDiscard()) return;
        draftRequest.current++; setDraftLoading(null);
        setMailbox(nextMailbox);
        setSelectedId(null);
    }

    /** Ein Entwurf wird zum Weiterschreiben geöffnet, nicht zum Lesen. */
    async function openDraft(message: InboxMessage): Promise<void> {
        const request = ++draftRequest.current;
        setDraftLoading(message.id);
        try {
            const full = await getInboxMessage(message.id);
            if (request !== draftRequest.current) return;
            if (full.id !== message.id || full.folder !== 'drafts') throw new Error('Diese Nachricht ist kein bearbeitbarer Entwurf mehr. Bitte das Postfach aktualisieren.');
            openCompose(seedFromDraft(full));
        } catch (error) {
            if (request === draftRequest.current) toast.error(error instanceof Error ? error.message : 'Entwurf konnte nicht vollständig geladen werden.');
        } finally { if (request === draftRequest.current) setDraftLoading(null); }
    }

    function selectMessage(message: InboxMessage): void {
        if (message.id !== selectedId && !confirmDiscard()) return;
        if (message.folder === 'drafts') {
            void openDraft(message);
            return;
        }
        draftRequest.current++; setDraftLoading(null);
        setSelectedId(message.id);
        // Im Ungelesen-Filter nicht automatisch als gelesen markieren — die
        // Nachricht würde sonst beim Öffnen aus der gefilterten Liste fallen.
        // Dort markiert der Nutzer bewusst über den Button oder „u“.
        if (unreadOnly) return;
        if (message.direction === 'inbound' && !message.is_read) {
            markRead.mutate({ id: message.id, isRead: true });
        }
    }

    function openCompose(seed: ComposeSeed = {}): void {
        draftRequest.current++; setDraftLoading(null);
        if (!mailboxQuery.sendingAddresses.length) { toast.error('Für dein Konto ist kein Versandpostfach freigegeben.'); return; }
        setComposeSeed({ ...seed, from: seed.from || (mailboxQuery.sendingAddresses.includes(mailbox) ? mailbox : undefined) });
        setComposeOpen(true);
    }

    function preferredSender(message: InboxMessage): string | undefined {
        const candidates = [mailbox, message.mailbox, ...message.mailboxes];
        return candidates.find(address => address && mailboxQuery.sendingAddresses.includes(address)) || mailboxQuery.sendingAddresses[0];
    }

    function replyTo(message: InboxMessage, all = false): void {
        if (!selectedVoll || selectedVoll.id !== message.id || vollAbfrage.isError) {
            toast.error('Bitte zuerst den vollständigen Nachrichteninhalt laden.'); return;
        }
        const recipients = replyRecipients(message, mailboxQuery.sendingAddresses, all);
        openCompose({
            mode: all ? 'replyAll' : 'reply', original: message,
            from: preferredSender(message),
            to: recipients.to.join('; '), cc: recipients.cc.join('; '),
            subject: prefixSubject(message.subject, 'Re'),
            replyToMessageId: message.id,
        });
    }

    /** Weiterleiten: kein replyToMessageId — die Mail startet einen eigenen Thread. */
    function forwardMessage(message: InboxMessage): void {
        if (!selectedVoll || selectedVoll.id !== message.id || vollAbfrage.isError) {
            toast.error('Der vollständige Nachrichteninhalt muss vor dem Weiterleiten geladen sein.');
            return;
        }
        openCompose({
            mode: 'forward', original: message,
            from: preferredSender(message),
            subject: prefixSubject(message.subject, 'Fwd'),
            body: `\n\n${originalQuote(message)}`,
        });
    }

    /** Nach dem Verschieben verschwindet die Nachricht aus der Liste. */
    function moveTo(message: InboxMessage, target: 'archive' | 'trash'): void {
        if (!confirmDiscard()) return;
        const nextId = nextInboxMessageId(inboxQuery.items, message.id);
        setSelectedId(nextId);
        moveMessage.mutate(
            { id: message.id, folder: target },
            {
                onSuccess: () => toast.success(
                    target === 'trash' ? 'In den Papierkorb verschoben.' : 'Archiviert.',
                ),
                onError: (error) => {
                    setSelectedId(current => current === nextId ? message.id : current);
                    toast.error(error instanceof Error ? error.message : 'Verschieben fehlgeschlagen.');
                },
            },
        );
    }

    function restore(message: InboxMessage): void {
        if (!confirmDiscard()) return;
        const nextId = nextInboxMessageId(inboxQuery.items, message.id);
        setSelectedId(nextId);
        restoreMessage.mutate(message.id, {
            onSuccess: () => toast.success('Wiederhergestellt.'),
            onError: (error) => {
                setSelectedId(current => current === nextId ? message.id : current);
                toast.error(error instanceof Error ? error.message : 'Wiederherstellen fehlgeschlagen.');
            },
        });
    }

    /**
     * Als Spam markieren. Der Absender wird dabei für die betroffenen
     * Postfächer gesperrt — wer eine Mail als Spam einstuft, will die nächste
     * desselben Absenders in aller Regel auch nicht sehen.
     */
    function reportSpam(message: InboxMessage): void {
        if (!confirmDiscard()) return;
        const nextId = nextInboxMessageId(inboxQuery.items, message.id);
        setSelectedId(nextId);
        markSpam.mutate(
            { id: message.id, blockSender: true },
            {
                onSuccess: () => toast.success(`Als Spam markiert. ${message.from} ist jetzt gesperrt.`),
                onError: (error) => {
                    setSelectedId(current => current === nextId ? message.id : current);
                    toast.error(error instanceof Error ? error.message : 'Markieren fehlgeschlagen.');
                },
            },
        );
    }

    function reportNotSpam(message: InboxMessage): void {
        if (!confirmDiscard()) return;
        const nextId = nextInboxMessageId(inboxQuery.items, message.id);
        setSelectedId(nextId);
        markNotSpam.mutate(message.id, {
            onSuccess: () => toast.success('Kein Spam — Absender wieder freigegeben.'),
            onError: (error) => {
                setSelectedId(current => current === nextId ? message.id : current);
                toast.error(error instanceof Error ? error.message : 'Freigeben fehlgeschlagen.');
            },
        });
    }

    function toggleRead(message: InboxMessage): void {
        markRead.mutate(
            { id: message.id, isRead: !message.is_read },
            {
                onError: (error) => toast.error(
                    error instanceof Error ? error.message : 'Status konnte nicht geändert werden.',
                ),
            },
        );
    }

    function refresh(): void {
        inboxQuery.refetch();
        mailboxQuery.refetch();
    }

    // Tastaturkürzel. Der Ref hält den aktuellen Zustand, damit der Listener
    // nur einmal registriert wird statt bei jedem Render. Die Zuweisung läuft
    // im Effect (nicht im Render), sonst wäre der Ref-Zugriff unsauber.
    const shortcutState = useRef({
        items: inboxQuery.items,
        selected,
        composeOpen,
        folder,
        selectMessage,
        replyTo,
        forwardMessage,
        toggleRead,
        openCompose,
        moveTo,
        restore,
        confirmDiscard,
    });

    useEffect(() => {
        shortcutState.current = {
            items: inboxQuery.items,
            selected,
            composeOpen,
            folder,
            selectMessage,
            replyTo,
            forwardMessage,
            toggleRead,
            openCompose,
            moveTo,
            restore,
            confirmDiscard,
        };
    });

    useEffect(() => {
        function isTyping(target: EventTarget | null): boolean {
            if (!(target instanceof HTMLElement)) return false;
            return target.isContentEditable
                || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
        }

        function onKeyDown(event: KeyboardEvent): void {
            const state = shortcutState.current;
            if (event.defaultPrevented || state.composeOpen || event.metaKey || event.ctrlKey || event.altKey) return;
            // Menüs und Dialoge besitzen ihre eigene Tastatursteuerung. Escape
            // darf dort nicht zusätzlich die geöffnete Nachricht schließen.
            if (event.target instanceof HTMLElement && event.target.closest('[role="menu"], [role="dialog"]')) return;

            if (event.key === 'Escape') {
                if (isTyping(event.target)) (event.target as HTMLElement).blur();
                else if (state.selected && state.confirmDiscard()) setSelectedId(null);
                return;
            }
            if (isTyping(event.target)) return;

            if (event.key === '/') {
                event.preventDefault();
                searchRef.current?.focus();
                return;
            }

            if (event.key === 'j' || event.key === 'k') {
                if (state.items.length === 0) return;
                event.preventDefault();
                const current = state.selected
                    ? state.items.findIndex((item) => item.id === state.selected?.id)
                    : -1;
                const step = event.key === 'j' ? 1 : -1;
                // Ohne Auswahl startet j oben und k unten.
                const next = current === -1
                    ? (step === 1 ? 0 : state.items.length - 1)
                    : Math.min(Math.max(current + step, 0), state.items.length - 1);
                state.selectMessage(state.items[next]);
                return;
            }

            if (event.key === 'n') {
                event.preventDefault();
                state.openCompose();
                return;
            }

            if (!state.selected) return;
            if (event.key.toLowerCase() === 'r' && state.selected.direction === 'inbound') {
                event.preventDefault();
                state.replyTo(state.selected, event.shiftKey);
            } else if (event.key === 'f') {
                event.preventDefault();
                state.forwardMessage(state.selected);
            } else if (event.key === 'u' && state.selected.direction === 'inbound') {
                event.preventDefault();
                state.toggleRead(state.selected);
            } else if (event.key === 'e' && state.folder !== 'archive' && state.folder !== 'trash') {
                event.preventDefault();
                state.moveTo(state.selected, 'archive');
            } else if ((event.key === 'Delete' || event.key === '#') && state.folder !== 'trash') {
                event.preventDefault();
                state.moveTo(state.selected, 'trash');
            } else if (event.key === 'z' && state.folder === 'trash') {
                event.preventDefault();
                state.restore(state.selected);
            }
        }

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    return (
        <div className="admin-mail-workspace flex h-full min-h-[520px] flex-col overflow-hidden bg-canvas">
            <header className="admin-mail-toolbar flex min-h-[68px] shrink-0 items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3 md:px-5">
                <span aria-hidden className="hidden size-9 shrink-0 items-center justify-center rounded-md bg-accent-500/10 text-accent-500 sm:flex"><Inbox className="size-[18px]" /></span>
                <div className="sr-only shrink-0 sm:not-sr-only">
                    <h1 className="font-display text-xl font-semibold tracking-tight">Postfach</h1>
                    <p className="mt-0.5 text-xs text-text-muted">Kundenkommunikation im Team</p>
                </div>

                <div className="relative ml-auto min-w-0 flex-1 max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                    <Input
                        ref={searchRef}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Nachrichten durchsuchen…"
                        aria-label="E-Mails durchsuchen"
                        className="h-10 rounded-lg bg-elevated/50 pl-9 shadow-none"
                    />
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={refresh}
                    aria-label="Postfach aktualisieren"
                    title="Aktualisieren"
                >
                    <RefreshCw className={cn('size-4', inboxQuery.isFetching && 'animate-spin')} />
                </Button>
                <Button type="button" size="sm" onClick={() => openCompose()} aria-label="Neue E-Mail" disabled={!mailboxQuery.sendingAddresses.length}>
                    <Pencil className="size-4" />
                    <span className="hidden sm:inline">Neue E-Mail</span>
                </Button>
            </header>

            <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-border-subtle bg-surface px-3 py-2 lg:hidden">
                <select aria-label="Mail-Ordner" value={folder} onChange={event => selectFolder(event.target.value as InboxFolder)} className="h-10 min-w-0 rounded-md border border-border-subtle bg-surface px-2 text-sm">
                    {Object.entries(FOLDER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}{value === 'inbox' && allUnread ? ` (${allUnread})` : ''}</option>)}
                </select>
                <select aria-label="Postfach auswählen" value={mailbox} onChange={event => selectMailbox(event.target.value)} className="h-10 min-w-0 rounded-md border border-border-subtle bg-surface px-2 text-sm">
                    {!mailboxQuery.mailboxes.some(item => item.id === 'all') && <option value="all">Alle Postfächer</option>}
                    {mailboxQuery.mailboxes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
            </div>

            {/* The reader gets remaining width; message bodies still load only on demand. */}
            <div className="admin-mail-grid grid min-h-0 flex-1 grid-cols-1 gap-px bg-border-subtle lg:grid-cols-[184px_minmax(300px,356px)_minmax(0,1fr)] xl:grid-cols-[196px_minmax(320px,380px)_minmax(0,1fr)]">
                <MailboxRail
                    folder={folder}
                    mailbox={mailbox}
                    mailboxes={mailboxQuery.mailboxes}
                    unreadOnly={unreadOnly}
                    onFolderChange={selectFolder}
                    onMailboxChange={selectMailbox}
                    onUnreadOnlyChange={(next) => { if (confirmDiscard()) { setUnreadOnly(next); setSelectedId(null); } }}
                />

                <section
                    aria-label={FOLDER_LABELS[folder]}
                    className={cn(
                        'admin-mail-list flex min-h-0 flex-col overflow-hidden bg-surface',
                        selected ? 'hidden lg:flex' : 'flex',
                    )}
                >
                    <div className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
                        <div>
                            <h2 className="text-sm font-semibold">{FOLDER_LABELS[folder]}</h2>
                            <p className="text-[11px] text-text-muted">
                                {inboxQuery.isLoading ? 'Wird geladen…' : inboxQuery.error ? 'Nicht verfügbar' : `${inboxQuery.items.length} Nachrichten geladen${inboxQuery.hasNextPage ? ' · weitere vorhanden' : ''}`}
                            </p>
                        </div>
                        {debouncedSearch && <span className="max-w-32 truncate text-[11px] text-text-muted">„{debouncedSearch}“</span>}
                    </div>

                    <div className="border-b border-border-subtle px-3 py-2">
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Arbeitsliste</p>
                        <nav aria-label="Arbeitsansicht" className="flex gap-1 overflow-x-auto pb-1">
                            {WORK_QUEUES.map(queue => <button key={queue.value} type="button" aria-pressed={workQueue === queue.value} onClick={() => { if (workQueue !== queue.value && confirmDiscard()) { setWorkQueue(queue.value); setSelectedId(null); } }} className={cn('shrink-0 rounded-md px-2 py-1.5 text-xs font-medium transition-colors', workQueue === queue.value ? 'bg-accent-600 text-white shadow-sm' : 'text-text-secondary hover:bg-elevated')}>{queue.label}</button>)}
                        </nav>
                        {folder === 'inbox' && <label className="mt-2 flex min-h-9 cursor-pointer items-center gap-2 text-sm text-text-secondary lg:hidden"><input type="checkbox" checked={unreadOnly} onChange={event => { if (confirmDiscard()) { setUnreadOnly(event.target.checked); setSelectedId(null); } }} className="size-4 accent-accent-500" />Nur ungelesene</label>}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {inboxQuery.isLoading ? (
                            <LoadingState label="Lade E-Mails…" className="border-0" />
                        ) : inboxQuery.error ? (
                            <ErrorState
                                title="Mailbox nicht erreichbar"
                                message="Die E-Mails konnten nicht geladen werden."
                                detail={inboxQuery.error instanceof Error ? inboxQuery.error.message : undefined}
                                onRetry={inboxQuery.refetch}
                                className="m-4"
                            />
                        ) : inboxQuery.items.length === 0 ? (
                            <EmptyState
                                icon={FOLDER_ICONS[folder]}
                                title={debouncedSearch ? 'Keine Treffer' : 'Keine E-Mails'}
                                description={debouncedSearch
                                    ? 'Versuche einen anderen Suchbegriff.'
                                    : FOLDER_EMPTY_HINTS[folder]}
                                className="m-4 border-0 bg-transparent"
                            />
                        ) : (
                            <ul aria-label="E-Mail-Liste" aria-busy={Boolean(draftLoading)} onKeyDown={event => {
                                if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('li > button:not(:disabled)'));
                                const index = buttons.indexOf(event.target as HTMLButtonElement);
                                if (index < 0) return;
                                event.preventDefault();
                                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
                                // Moving focus must not mark another message as read. Enter opens it.
                                buttons[next]?.focus();
                            }}>
                                {inboxQuery.items.map((message) => (
                                    <MessageListItem
                                        key={message.id}
                                        message={message}
                                        selected={selectedId === message.id}
                                        loading={draftLoading === message.id}
                                        onSelect={() => selectMessage(message)}
                                    />
                                ))}
                            </ul>
                        )}
                    </div>
                    {inboxQuery.hasNextPage && (
                        <div className="shrink-0 border-t border-border-subtle p-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-full"
                                disabled={inboxQuery.isFetchingNextPage}
                                onClick={inboxQuery.fetchNextPage}
                            >
                                {inboxQuery.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
                                Weitere laden
                            </Button>
                        </div>
                    )}
                </section>

                <MessageDetail
                    message={selectedVoll ?? selected}
                    koerperLaedt={selected !== null && selectedVoll === null && vollAbfrage.isFetching}
                    bodyError={vollAbfrage.isError}
                    onRetryBody={() => void vollAbfrage.refetch()}
                    onSelectThreadMessage={(id) => { if (id === selectedId || confirmDiscard()) setSelectedId(id); }}
                    folder={folder}
                    onBack={() => { if (confirmDiscard()) setSelectedId(null); }}
                    onReply={replyTo}
                    onReplyAll={message => replyTo(message, true)}
                    canSend={mailboxQuery.sendingAddresses.length > 0}
                    onForward={forwardMessage}
                    onToggleRead={toggleRead}
                    onMove={moveTo}
                    onRestore={restore}
                    onSpam={reportSpam}
                    onNotSpam={reportNotSpam}
                    togglingRead={markRead.isPending}
                    moving={moveMessage.isPending || restoreMessage.isPending || markSpam.isPending || markNotSpam.isPending}
                />
            </div>

            {composeOpen && <MailComposer
                key={`${composeSeed.draftId || composeSeed.replyToMessageId || 'new'}:${composeSeed.to || ''}:${composeOpen ? 'open' : 'closed'}`}
                onClose={() => setComposeOpen(false)}
                seed={composeSeed}
                sendingAddresses={mailboxQuery.sendingAddresses}
            />}
        </div>
    );
}

function MailboxRail({
    folder,
    mailbox,
    mailboxes,
    unreadOnly,
    onFolderChange,
    onMailboxChange,
    onUnreadOnlyChange,
}: {
    folder: InboxFolder;
    mailbox: string;
    mailboxes: ReturnType<typeof useMailboxes>['mailboxes'];
    unreadOnly: boolean;
    onFolderChange: (folder: InboxFolder) => void;
    onMailboxChange: (mailbox: string) => void;
    onUnreadOnlyChange: (unreadOnly: boolean) => void;
}): JSX.Element {
    const allUnread = mailboxes.find((item) => item.id === 'all')?.unread ?? 0;
    return (
        <aside className="admin-mail-folders hidden min-h-0 flex-col bg-surface lg:flex">
            <nav className="space-y-1 p-3" aria-label="Mail-Ordner">
                <RailButton
                    active={folder === 'inbox'}
                    icon={Inbox}
                    label="Posteingang"
                    count={allUnread}
                    onClick={() => onFolderChange('inbox')}
                />
                <RailButton
                    active={folder === 'sent'}
                    icon={Send}
                    label="Gesendet"
                    onClick={() => onFolderChange('sent')}
                />
                <RailButton
                    active={folder === 'drafts'}
                    icon={FilePen}
                    label="Entwürfe"
                    onClick={() => onFolderChange('drafts')}
                />
                <RailButton
                    active={folder === 'archive'}
                    icon={Archive}
                    label="Archiv"
                    onClick={() => onFolderChange('archive')}
                />
                <RailButton
                    active={folder === 'spam'}
                    icon={ShieldAlert}
                    label="Spam"
                    onClick={() => onFolderChange('spam')}
                />
                <RailButton
                    active={folder === 'trash'}
                    icon={Trash2}
                    label="Papierkorb"
                    onClick={() => onFolderChange('trash')}
                />
                {folder === 'inbox' && (
                    <button
                        type="button"
                        aria-pressed={unreadOnly}
                        onClick={() => onUnreadOnlyChange(!unreadOnly)}
                        className={cn(
                            'flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-xs transition-colors',
                            unreadOnly
                                ? 'bg-accent-500/10 font-medium text-accent-500'
                                : 'text-text-muted hover:bg-elevated hover:text-text-primary',
                        )}
                    >
                        <span className={cn(
                            'ml-0.5 size-3 rounded-sm border transition-colors',
                            unreadOnly ? 'border-accent-400 bg-accent-500' : 'border-border-strong',
                        )} />
                        <span>Nur ungelesene</span>
                    </button>
                )}
            </nav>
            <div className="mx-3 border-t border-border-subtle" />
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <p className="mb-2 px-2 text-xs font-medium text-text-muted">Postfächer</p>
                <div className="space-y-0.5">
                    {mailboxes.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            aria-pressed={mailbox === item.id}
                            onClick={() => onMailboxChange(item.id)}
                            className={cn(
                                'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors',
                                mailbox === item.id
                                    ? 'bg-accent-500/10 font-semibold text-accent-500'
                                    : 'text-text-secondary hover:bg-elevated/70 hover:text-text-primary',
                            )}
                        >
                            <Mail className="size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{item.name}</span>
                            {item.unread > 0 && (
                                <span className="rounded-full bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-500">
                                    {item.unread}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>
            <div className="border-t border-border-subtle p-4 text-xs leading-6 text-text-muted"><p className="font-medium text-text-secondary">Schneller arbeiten</p><p><kbd>J</kbd> / <kbd>K</kbd> Nachricht wechseln</p><p><kbd>R</kbd> Antworten · <kbd>/</kbd> Suchen</p></div>
        </aside>
    );
}

function RailButton({
    active,
    icon: Icon,
    label,
    count = 0,
    onClick,
}: {
    active: boolean;
    icon: typeof Inbox;
    label: string;
    count?: number;
    onClick: () => void;
}): JSX.Element {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                'flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                active
                    ? 'bg-accent-600 font-semibold text-white shadow-sm'
                    : 'text-text-secondary hover:bg-elevated hover:text-text-primary',
            )}
        >
            <Icon className="size-4" />
            <span>{label}</span>
            {count > 0 && <span className="ml-auto text-xs font-semibold">{count}</span>}
        </button>
    );
}

function MessageListItem({
    message,
    selected,
    onSelect,
    loading,
}: {
    message: InboxMessage;
    selected: boolean;
    onSelect: () => void;
    loading: boolean;
}): JSX.Element {
    const label = senderLabel(message);
    const attention = inboxAttention(message);
    return (
        <li>
            <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={onSelect}
                disabled={loading}
                className={cn(
                    'group relative w-full border-b border-border-subtle px-4 py-4 text-left transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500',
                    selected ? 'bg-accent-500/10' : !message.is_read && message.direction === 'inbound' ? 'bg-accent-500/[0.03] hover:bg-elevated/70' : 'hover:bg-elevated/70',
                )}
            >
                {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent-500" />}
                <div className="flex items-start gap-3">
                    <div className={cn(
                        'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-semibold',
                        !message.is_read && message.direction === 'inbound'
                            ? 'bg-accent-500 text-white'
                            : 'bg-elevated text-text-secondary',
                    )}>
                        {loading ? <Loader2 className="size-4 animate-spin" aria-label="Entwurf wird vollständig geladen" /> : initials(label)}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                            <span className={cn(
                                'min-w-0 flex-1 truncate text-sm',
                                !message.is_read && message.direction === 'inbound' ? 'font-semibold text-text-primary' : 'text-text-secondary',
                            )}>
                                {label}
                            </span>
                            <time className="shrink-0 text-xs text-text-muted" dateTime={message.received_at} title={formatDateTime(message.received_at)}>{formatRelative(message.received_at)}</time>
                        </div>
                        <div className={cn(
                            'mt-1 truncate text-sm',
                            !message.is_read && message.direction === 'inbound' ? 'font-medium text-text-primary' : 'text-text-secondary',
                        )}>
                            {message.subject || '(ohne Betreff)'}
                        </div>
                        <p className="mt-1.5 line-clamp-2 break-words text-xs leading-5 text-text-muted">{preview(message.body)}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            {!message.is_read && message.direction === 'inbound' && <span className="inline-flex items-center gap-1 text-accent-500"><span aria-hidden className="size-1.5 rounded-full bg-accent-500" />Ungelesen</span>}
                            {message.assignment_status === 'open' && <span className="rounded-md bg-status-warning/10 px-1.5 py-0.5 text-status-warning">Offen</span>}
                            {message.assignment_status === 'in_progress' && <span className="rounded-md bg-accent-500/10 px-1.5 py-0.5 text-accent-500">In Bearbeitung</span>}
                            {message.assignment_status === 'done' && <span className="rounded-md bg-success/10 px-1.5 py-0.5 text-success">Erledigt</span>}
                            {message.assigned_to && <span className="max-w-28 truncate text-text-muted" title={`Zuständig: ${message.assigned_to}`}>{message.assigned_to}</span>}
                            {attention && <span className={cn('rounded-md px-1.5 py-0.5 font-medium', attention.urgent ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning')}>{attention.label}</span>}
                            {message.attachments.length > 0 && <span className="ml-auto inline-flex items-center gap-1 text-text-muted"><Paperclip className="size-3 shrink-0" aria-hidden /><span>{message.attachments.length}<span className="sr-only"> Anhänge</span></span></span>}
                        </div>
                    </div>
                </div>
            </button>
        </li>
    );
}

function MessageDetail({
    message,
    koerperLaedt,
    bodyError,
    onRetryBody,
    onSelectThreadMessage,
    folder,
    onBack,
    onReply,
    onReplyAll,
    canSend,
    onForward,
    onToggleRead,
    onMove,
    onRestore,
    onSpam,
    onNotSpam,
    togglingRead,
    moving,
}: {
    message: InboxMessage | null;
    /** Voll-Nachricht ist noch unterwegs — Vorschau nicht als Mail ausgeben. */
    koerperLaedt?: boolean;
    bodyError: boolean;
    onRetryBody: () => void;
    onSelectThreadMessage: (id: string) => void;
    folder: InboxFolder;
    onBack: () => void;
    onReply: (message: InboxMessage) => void;
    onReplyAll: (message: InboxMessage) => void;
    canSend: boolean;
    onForward: (message: InboxMessage) => void;
    onToggleRead: (message: InboxMessage) => void;
    onMove: (message: InboxMessage, target: 'archive' | 'trash') => void;
    onRestore: (message: InboxMessage) => void;
    onSpam: (message: InboxMessage) => void;
    onNotSpam: (message: InboxMessage) => void;
    togglingRead: boolean;
    moving: boolean;
}): JSX.Element {
    // Bereinigung, Abschottung UND Gestaltung liegen in MailHtmlFrame — hier
    // bewusst kein zweiter Satz Regeln. Zwei Konfigurationen für dieselbe
    // Aufgabe driften auseinander, und die schwächere gewinnt am Ende immer.

    if (!message) {
        return (
            <section className="hidden min-h-0 items-center justify-center bg-canvas p-6 lg:flex" aria-label="Keine E-Mail ausgewählt">
                <div className="max-w-sm text-center">
                    <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-accent-500/20 bg-accent-500/10 text-accent-500">
                        <MailOpen className="size-7" />
                    </div>
                    <h2 className="font-display text-xl font-semibold">Platz für das nächste Gespräch</h2>
                    <p className="mt-2 text-sm leading-relaxed text-text-muted">Wähle eine E-Mail, um den Verlauf zu lesen, die Zuständigkeit zu klären oder zu antworten.</p>
                </div>
            </section>
        );
    }

    const detailName = message.direction === 'inbound'
        ? (message.from_name || message.from)
        : 'Partsunion';
    const detailAddress = message.from;
    return (
        <section className="admin-mail-detail flex min-h-0 flex-col overflow-hidden bg-surface" aria-label="E-Mail-Detail">
            <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2 md:px-5">
                <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack} aria-label="Zurück zur E-Mail-Liste">
                    <ArrowLeft className="size-4" />
                </Button>
                {message.direction === 'inbound' && (
                    <Button size="sm" onClick={() => onReply(message)} title="Antworten (r)" disabled={!canSend || koerperLaedt || bodyError}>
                        <Reply className="size-4" /> Antworten
                    </Button>
                )}
                {message.direction === 'inbound' && <Button variant="outline" size="sm" className="hidden sm:inline-flex" disabled={!canSend || koerperLaedt || bodyError} onClick={() => onReplyAll(message)} title="Allen antworten (Umschalt+R)"><ReplyAll className="size-4" />Allen antworten</Button>}
                {folder === 'trash' ? (
                    <Button variant="outline" size="sm" onClick={() => onRestore(message)} disabled={moving} title="Wiederherstellen (z)">
                        {moving ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                        Wiederherstellen
                    </Button>
                ) : folder !== 'archive' && <Button variant="ghost" size="sm" onClick={() => onMove(message, 'archive')} disabled={moving} aria-label="Archivieren" title="Archivieren (e)"><Archive className="size-4" /><span className="hidden sm:inline">Archivieren</span></Button>}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="ml-auto shrink-0" aria-label="Weitere Nachrichtenaktionen"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {message.direction === 'inbound' && <DropdownMenuItem onSelect={() => onReplyAll(message)} disabled={!canSend || koerperLaedt || bodyError}><ReplyAll />Allen antworten</DropdownMenuItem>}
                        <DropdownMenuItem onSelect={() => onForward(message)} disabled={!canSend || koerperLaedt || bodyError}><Forward />Weiterleiten</DropdownMenuItem>
                        {message.direction === 'inbound' && <DropdownMenuItem onSelect={() => onToggleRead(message)} disabled={togglingRead}><Mail />{message.is_read ? 'Als ungelesen markieren' : 'Als gelesen markieren'}</DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        {folder === 'spam' ? <DropdownMenuItem onSelect={() => onNotSpam(message)} disabled={moving}><ShieldCheck />Kein Spam · Absender freigeben</DropdownMenuItem>
                            : message.direction === 'inbound' && <DropdownMenuItem onSelect={() => onSpam(message)} disabled={moving}><ShieldAlert />Spam melden und Absender sperren</DropdownMenuItem>}
                        {folder !== 'trash' && <DropdownMenuItem onSelect={() => onMove(message, 'trash')} disabled={moving} variant="destructive"><Trash2 />In den Papierkorb</DropdownMenuItem>}
                    </DropdownMenuContent>
                </DropdownMenu>
                {/* Die Zuordnung stammt aus einer Kopfzeile, die der Absender
                    geschrieben hat — der Zustellempfänger war nicht ermittelbar. */}
                {message.mailbox_source?.includes('header') && (
                    <span
                        className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning"
                        title="Der Zustellempfänger war nicht ermittelbar. Die Zuordnung beruht auf einer Kopfzeile des Absenders."
                    >
                        <ShieldAlert className="size-3" />
                        <span className="hidden sm:inline">Zuordnung ungeprüft</span>
                    </span>
                )}
            </div>

            {message.direction === 'inbound' && <MailWorkflow message={message} />}
            <div className="min-h-0 flex-1 overflow-y-auto">
                <article className={cn(SEITEN_RAND_OHNE_BREITE, 'mx-auto max-w-4xl')}>
                    <MailConversation messageId={message.id} onSelect={onSelectThreadMessage} />
                    <h2 className="text-xl font-semibold leading-tight text-text-primary md:text-2xl">
                        {message.subject || '(ohne Betreff)'}
                    </h2>
                    <div className="mt-4 flex flex-wrap items-start gap-3 border-b border-border-subtle pb-4">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-text-secondary">
                            {initials(detailName)}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-medium text-text-primary">{detailName}</span>
                                <span className="break-all text-xs text-text-muted">&lt;{detailAddress}&gt;</span>
                            </div>
                            <div className="mt-1 break-words text-xs text-text-muted">
                                An: {message.to.join(', ') || 'Unbekannt'}
                                {message.cc.length > 0 && ` · Cc: ${message.cc.join(', ')}`}
                            </div>
                        </div>
                        <time className="shrink-0 text-xs text-text-muted" dateTime={message.received_at}>
                            {formatDateTime(message.received_at)}
                        </time>
                    </div>

                    {message.direction === 'inbound' && <MailInternalNote message={message} />}
                    {message.attachments.length > 0 && (
                        <div className="mt-5 flex flex-wrap gap-2">
                            {message.attachments.map((attachment) => (
                                <button
                                    key={attachment.id}
                                    type="button"
                                    onClick={async () => {
                                        try {
                                            await downloadInboxAttachment(message.id, attachment.id, attachment.filename || 'anhang');
                                        } catch (error) {
                                            toast.error(error instanceof Error ? error.message : 'Anhang konnte nicht geladen werden.');
                                        }
                                    }}
                                    className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-elevated"
                                >
                                    <FileText className="size-4 text-accent-500" />
                                    <span className="max-w-52 truncate text-xs text-text-secondary">{attachment.filename || 'Anhang'}</span>
                                    <Download className="size-3.5 text-text-muted" />
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="mt-5 text-sm leading-7 text-text-primary">
                        {/* Der Rahmen traegt jetzt auch reine Textmails: er
                            wandelt sie in Absaetze um und zeigt Absender,
                            Betreff und Anhaenge im Partsunion-Layout.

                            Waehrend der volle Koerper unterwegs ist, KEIN
                            Rahmen mit der Listen-Vorschau: die ist auf 200
                            Zeichen gekuerzt und saehe wie eine kaputte Mail
                            aus. Ein ruhiger Balken sagt ehrlicher "kommt
                            gleich" — und er kommt schnell, es ist EINE Mail
                            statt wie frueher fuenfzig. */}
                        {bodyError ? (
                            <ErrorState title="Nachricht nicht verfügbar" message="Der vollständige E-Mail-Inhalt konnte nicht geladen werden." onRetry={onRetryBody} />
                        ) : koerperLaedt ? (
                            <div
                                role="status"
                                aria-label="Nachricht wird geladen"
                                className="h-48 animate-pulse rounded-2xl bg-overlay/[0.05]"
                            />
                        ) : (
                            <MailHtmlFrame message={message} />
                        )}
                    </div>

                    {message.direction === 'inbound' && (
                        <button
                            type="button"
                            onClick={() => onReply(message)}
                            disabled={!canSend || koerperLaedt || bodyError}
                            className="mt-10 flex w-full items-center gap-2 karte-klein px-4 py-3 text-sm text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
                        >
                            <Reply className="size-4" /> Auf diese E-Mail antworten…
                        </button>
                    )}
                </article>
            </div>
        </section>
    );
}
