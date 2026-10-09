/**
 * Marketing Email Templates API — generate, save, send.
 */

import { apiFetch } from './client';
import {
    EmailTemplateSchema,
    GeneratedEmailSchema,
    EmailRecipientSchema,
    parseApiResponse,
    parseApiResponseStrict,
    type EmailRecipient,
    type EmailTemplate,
    type GeneratedEmail,
} from './types';
import { z } from 'zod';

export async function generateEmailTemplate(prompt: string): Promise<{ success: boolean; email: GeneratedEmail }> {
    const raw = await apiFetch<{ success: boolean; email: unknown }>('/api/admin/emails/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
    });
    return { success: raw.success, email: parseApiResponse(GeneratedEmailSchema, raw.email) };
}

export async function improveEmailTemplate(
    prompt: string,
    existingContent: string
): Promise<{ success: boolean; email: GeneratedEmail }> {
    const raw = await apiFetch<{ success: boolean; email: unknown }>('/api/admin/emails/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt, improve: true, existingContent }),
    });
    return { success: raw.success, email: parseApiResponse(GeneratedEmailSchema, raw.email) };
}

export async function getEmailRecipients(
    type: 'active' | 'cancelled' | 'trial' | 'all'
): Promise<{ type: string; count: number; recipients: EmailRecipient[] }> {
    const raw = await apiFetch<{ type: string; count: number; recipients: unknown }>(
        `/api/admin/emails/recipients/${type}`
    );
    const list = z.array(EmailRecipientSchema).safeParse(raw.recipients);
    return {
        type: raw.type,
        count: raw.count,
        recipients: list.success ? list.data : [],
    };
}

const CampaignResultSchema=z.object({requestId:z.string().uuid(),success:z.boolean(),status:z.enum(['completed','unknown']),
    sent:z.number().int().nonnegative(),accepted:z.number().int().nonnegative(),failed:z.number().int().nonnegative(),unknown:z.number().int().nonnegative(),pending:z.number().int().nonnegative(),total:z.number().int().positive(),delivery_confirmed:z.literal(false)})
    .refine(result=>result.sent===result.accepted&&result.accepted+result.failed+result.unknown+result.pending===result.total
        &&result.success===(result.status==='completed')&&result.success===(result.unknown===0&&result.pending===0),'Unvollständiger Versandnachweis');
export type MarketingCampaignResult=z.infer<typeof CampaignResultSchema>;
/** Caller supplies its original decision UUID on every retry. */
export async function sendMarketingEmail(subject:string,htmlContent:string,recipientType?:string,customEmails?:string[],requestId?:string):Promise<MarketingCampaignResult>{
    if(!requestId||!z.string().uuid().safeParse(requestId).success)throw new Error('Der ursprüngliche Versandauftrag requestId ist erforderlich.');
    const raw=await apiFetch<unknown>('/api/admin/emails/send',{method:'POST',headers:{'Idempotency-Key':requestId},body:JSON.stringify({requestId,subject,htmlContent,recipientType,customEmails})});
    const result=parseApiResponseStrict(CampaignResultSchema,raw);
    if(result.requestId.toLowerCase()!==requestId.toLowerCase())throw new Error('Versandnachweis gehört zu einem anderen Auftrag.');
    return result;
}

export async function getSavedTemplates(): Promise<EmailTemplate[]> {
    const raw = await apiFetch<unknown>('/api/admin/emails/templates');
    const parsed = z.array(EmailTemplateSchema).safeParse(raw);
    return parsed.success ? parsed.data : [];
}

export async function saveEmailTemplate(
    name: string,
    subject: string,
    htmlContent: string,
    prompt?: string
): Promise<{ success: boolean; id: string }> {
    return apiFetch('/api/admin/emails/templates', {
        method: 'POST',
        body: JSON.stringify({ name, subject, htmlContent, prompt }),
    });
}
