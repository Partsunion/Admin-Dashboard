import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as shell from './workspaceShell';
import { ADMIN_NAV_SECTIONS } from './AdminSidebar';
const crm = '../CRM-System/src/app/components/layout/workspaceShell.ts';
describe('Shared internal shell contract', () => {
    it('fixes header and brand to the same height and preserves visible keyboard focus', () => {
        expect(shell.WORKSPACE_HEADER).toContain('h-[60px]');
        expect(shell.WORKSPACE_BRAND).toContain('h-[60px]');
        expect(shell.WORKSPACE_FRAME).toContain('h-dvh');
        expect(shell.WORKSPACE_NAV_ITEM).toContain('focus-visible:ring-2');
    });
    it.skipIf(!existsSync(crm))('keeps both independently deployed shell contracts identical', () => {
        // Both shells share geometry. Admin uses its existing fixed-dark navigation
        // token; CRM currently spells the identical white overlay literally.
        const normalize = (file: string) => readFileSync(file, 'utf8')
            .replace(/\r\n/g, '\n')
            .replace('border-white/[0.08]', 'border-[rgb(var(--admin-nav-overlay)/0.08)]')
            .replace('ring-white/15', 'ring-[rgb(var(--admin-nav-overlay)/0.15)]')
            .replace('border-overlay/[0.08]', 'border-[rgb(var(--admin-nav-overlay)/0.08)]')
            .replace('ring-overlay/15', 'ring-[rgb(var(--admin-nav-overlay)/0.15)]').trim();
        const tokens = readFileSync('src/design-system/tokens.css', 'utf8');
        expect(tokens.match(/--admin-nav-overlay\s*:[^;]+;/g)).toEqual(['--admin-nav-overlay: 255 255 255;']);
        expect(normalize(crm)).toBe(normalize('src/components/layout/workspaceShell.ts'));
    });
});

describe('Admin operations navigation', () => {
    it('exposes ERP and never hides Marketing behind a client-side read permission', () => {
        const items = ADMIN_NAV_SECTIONS.flatMap((section) => section.items);
        expect(items.find((item) => item.to === '/erp')?.label).toBe('ERP-Zentrale');
        expect(items.find((item) => item.to === '/marketing')?.permission).toBeUndefined();
    });
});
