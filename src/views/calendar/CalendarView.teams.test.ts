import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('admin calendar Teams contract', () => {
    const view = readFileSync('src/views/calendar/CalendarView.tsx', 'utf8');
    const api = readFileSync('src/api/appointments.ts', 'utf8');

    it('uses the supported createTeams contract and connected-owner capability', () => {
        expect(api).toContain('teamsAvailable?: boolean');
        expect(api).toContain('createTeams?: boolean');
        expect(view).toContain('createTeams: form.createTeams');
        expect(view).toContain('Teams-Besprechung automatisch erstellen');
    });

    it('does not poll removed Microsoft automation endpoints or claim notes control Teams', () => {
        expect(api).not.toContain('/microsoft/status');
        expect(api).not.toContain('/microsoft/reviews');
        expect(view).not.toContain('steuern Teams automatisch');
    });
});
