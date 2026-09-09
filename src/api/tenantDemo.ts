import { z } from 'zod';
import { apiFetch } from './client';

const accessSchema=z.object({
  kind:z.enum(['customer','demo']),status:z.enum(['active','expired','ended']),
  startedAt:z.string().datetime().nullable(),expiresAt:z.string().datetime().nullable(),endedAt:z.string().datetime().nullable(),
  serverTime:z.string().datetime(),remainingSeconds:z.number().int().nonnegative().nullable(),version:z.number().int().nonnegative(),
}).superRefine((value,context)=>{
  const invalid=(message:string)=>context.addIssue({code:z.ZodIssueCode.custom,message});
  if((value.startedAt===null)!==(value.expiresAt===null)||(value.startedAt&&value.expiresAt&&Date.parse(value.expiresAt)<=Date.parse(value.startedAt))||(value.endedAt&&(!value.startedAt||Date.parse(value.endedAt)<Date.parse(value.startedAt)||Date.parse(value.endedAt)>Date.parse(value.serverTime))))invalid('Widersprüchliche Demo-Zeitpunkte');
  if(value.kind==='customer'){
    if(value.status!=='active'||value.remainingSeconds!==null)context.addIssue({code:z.ZodIssueCode.custom,message:'Ungültiger Kundenstatus'});
    return;
  }
  const expected=value.endedAt?'ended':value.expiresAt&&Date.parse(value.expiresAt)<=Date.parse(value.serverTime)?'expired':'active';
  const remaining=value.endedAt?0:value.expiresAt?Math.max(0,Math.ceil((Date.parse(value.expiresAt)-Date.parse(value.serverTime))/1000)):null;
  if(!value.startedAt||!value.expiresAt||Date.parse(value.startedAt)>Date.parse(value.serverTime)||value.status!==expected||value.remainingSeconds!==remaining)invalid('Ungültige Demo-Laufzeit');
});
export type TenantDemoAccess=z.infer<typeof accessSchema>;
export type DemoAction='extend'|'end'|'convert';
export type DemoCommand={action:DemoAction;expectedVersion:number;reason:string;days?:number};
export type DemoIntent={requestId:string;command:DemoCommand};
const endpoint=(tenantId:string)=>`/api/admin/tenants/${encodeURIComponent(tenantId)}/demo-access`;
export async function getDemoAccess(tenantId:string,signal?:AbortSignal):Promise<TenantDemoAccess>{
  return accessSchema.parse(await apiFetch<unknown>(endpoint(tenantId),{...(signal?{signal}:{}),maxRetries:0,dedupe:false}));
}
export async function changeDemoAccess(tenantId:string,intent:DemoIntent):Promise<TenantDemoAccess>{
  const raw=await apiFetch<unknown>(endpoint(tenantId),{method:'POST',maxRetries:0,headers:{'Content-Type':'application/json','Idempotency-Key':intent.requestId},body:JSON.stringify(intent.command)});
  return z.object({access:accessSchema,replayed:z.boolean()}).parse(raw).access;
}
