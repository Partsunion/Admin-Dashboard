/** Reproducible newsletter rendering regression. The checked-in synthetic
 * fixture covers seven content images and attribute/style tracking pixels.
 * It contains no mailbox data and all image hosts use the reserved .invalid
 * domain. This is a regression fixture, not acceptance of a live mailbox. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { sanitizeMailHtml } from '@/lib/sanitizeMailHtml';
import { aufDunkelUmstellen } from '@/components/mail/mailDunkel';
import { renderMailRahmen } from '@/components/mail/mailRahmen';

const ROH = join(process.cwd(), 'src/test/fixtures/newsletter-rendering.html');
const AUSGABE = join(process.cwd(), 'dist-probe');



describe('Newsletter-Regression durch die vollständige Darstellungskette', () => {
    const roh = readFileSync(ROH, 'utf8');

    /**
     * 1x1/2x2-Bilder im Eingang — die duerfen im Ausgang fehlen. Die
     * Winzigkeit kann als Attribut (width="1") ODER im style
     * (width:1px;height:1px) erklaert sein; Facebook/Instagram nutzen nur
     * das style-Attribut, und genau so ueberlebte ihr Oeffnungs-Tracker
     * (email_open_log_pic.php) die Entfernung.
     */
    function istZaehlpixelTag(tag: string): boolean {
        if (/\b(?:width|height)="[12]"/i.test(tag)) return true;
        const stil = /\bstyle="([^"]*)"/i.exec(tag)?.[1] ?? '';
        return /(?:^|;)\s*width\s*:\s*[12](?:\.\d+)?px/i.test(stil)
            && /(?:^|;)\s*height\s*:\s*[12](?:\.\d+)?px/i.test(stil);
    }

    function zaehlpixelImRoh(): number {
        return (roh.match(/<img\b[^>]*>/gi) ?? []).filter(istZaehlpixelTag).length;
    }

    function kette() {
        const sauber = sanitizeMailHtml(roh);
        return aufDunkelUmstellen(sauber);
    }

    it('schreibt die Mail nach dist-probe/', () => {
        mkdirSync(AUSGABE, { recursive: true });
        const doc = renderMailRahmen({
            betreff: 'Sind Sie auf der Automechanika Frankfurt 2026 dabei?',
            vorschautext: '',
            kategorieLabel: 'NEWSLETTER',
            kategorieFarbe: '#5B8CFF',
            absenderName: 'Test-Teilehandel',
            absenderAdresse: 'news@dealer.example.invalid',
            absenderInitialen: 'TT',
            empfangenAm: '30.07.2026, 02:14',
            chips: ['info@partsunion.de'],
            inhaltHtml: kette(),
            anhaenge: [],
            zeigeMarkenleiste: true,
            fusszeileHerkunft: 'Eingegangen über Partsunion Mail',
            aussenHintergrund: null,
            dunkel: true,
            volleBreite: true,
        });
        writeFileSync(
            join(AUSGABE, 'mail.html'),
            `<!doctype html><html lang="de"><head><meta charset="utf-8">`
            + `<title>Mail — synthetische Newsletter-Regression</title></head>`
            + `<body style="margin:0;background:#08090C">${doc}</body></html>`,
            'utf8',
        );
    });

    /**
     * ─── Regeln statt Exemplare ───────────────────────────────────────────
     *
     * Hier standen feste Zeichenketten aus EINER Beispielmail
     * ("mcusercontent.com", "newstracking.yqservice.eu"). Das las sich
     * konkret, prüfte aber nur, dass genau jene Nachricht durchläuft. Als ich
     * die Probe auf eine andere echte Mail umgestellt habe, wurde der Test rot
     * — obwohl der Code stimmte.
     *
     * Ein Test, der an einer Beispieldatei klebt, meldet Aenderungen der
     * DATEI, nicht des Verhaltens. Die Regeln unten gelten fuer jede Mail.
     */
    it('ersetzt kein Inhaltsbild durch einen Platzhalter', () => {
        expect(
            kette(),
            'data-original-src stammt aus der alten Klick-erst-Loesung',
        ).not.toContain('data-original-src');
    });

    it('reicht die Bilder mit ihrer eigenen Adresse durch', () => {
        const eingang = (roh.match(/<img\b[^>]*\bsrc="https?:\/\/[^"]+"/gi) ?? []).length;
        const ausgang = (kette().match(/<img\b[^>]*\bsrc="https?:\/\/[^"]+"/gi) ?? []).length;
        // Zaehlpixel duerfen fehlen, sonst nichts. Groesser als der Eingang
        // waere ebenfalls falsch (dann fuegen wir selbst welche hinzu).
        expect(ausgang, 'Bilder gehen verloren').toBeLessThanOrEqual(eingang);
        expect(ausgang, 'es duerfen keine dazukommen').toBeGreaterThanOrEqual(
            eingang - zaehlpixelImRoh(),
        );
    });

    it('entfernt die Zählpixel', () => {
        /**
         * Ein Zaehlpixel ist ein 1x1-Bild von fremdem Server. Es traegt keinen
         * Inhalt; sein einziger Zweck ist die Lesebestaetigung.
         */
        const ausgang = kette();
        const uebrig = (ausgang.match(/<img\b[^>]*>/gi) ?? []).filter(istZaehlpixelTag).length;
        expect(uebrig, 'ein 1x1-Bild ist im Ausgang geblieben').toBe(0);
    });
});
