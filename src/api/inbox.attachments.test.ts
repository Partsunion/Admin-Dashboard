import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadInboxAttachment, openInboxAttachment } from './inbox';

describe('mail attachments', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('opens previewable attachments from the original user gesture', async () => {
        const replace = vi.fn();
        const popup = {
            closed: false,
            close: vi.fn(),
            document: { title: '', body: { textContent: '' } },
            location: { replace },
            opener: {} as unknown,
        };
        vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('pdf', {
            status: 200,
            headers: { 'Content-Type': 'application/pdf' },
        })));
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:attachment');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

        const promise = openInboxAttachment('mail-1', 'file-1', 'Angebot.pdf', 'application/pdf');
        expect(window.open).toHaveBeenCalledOnce();
        expect(popup.document.body.textContent).toContain('geladen');
        await promise;

        expect(replace).toHaveBeenCalledWith('blob:attachment');
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/inbox/email/mail-1/attachments/file-1'),
            expect.objectContaining({ credentials: 'include' }),
        );
    });

    it('keeps download object URLs alive until the browser consumed the click', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('file', { status: 200 })));
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        vi.spyOn(window, 'setTimeout').mockImplementation(((callback: TimerHandler) => {
            expect(revoke).not.toHaveBeenCalled();
            if (typeof callback === 'function') callback();
            return 1;
        }) as typeof window.setTimeout);
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

        await downloadInboxAttachment('mail-1', 'file-1', 'daten.bin');
        expect(revoke).toHaveBeenCalledWith('blob:download');
    });
});
