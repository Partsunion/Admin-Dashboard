import { useEffect, useRef, useState } from 'react';
import { usePermissions } from '@/auth/usePermissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { getDemoAccess, changeDemoAccess, type DemoAction, type DemoIntent, type TenantDemoAccess } from '@/api/tenantDemo';

const actions:Record<DemoAction,string>={extend:'Demo verlängern',end:'Demo vorzeitig beenden',convert:'In Kundenkonto umwandeln'};

export function TenantDemoPanel({tenantId}:{tenantId:string}) {
  const {can}=usePermissions();
  if(!can('billing.manage'))return null;
  return <DemoEditor key={tenantId} tenantId={tenantId}/>;
}

function DemoEditor({tenantId}:{tenantId:string}) {
  const [access,setAccess]=useState<TenantDemoAccess|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [reload,setReload]=useState(0);
  const [action,setAction]=useState<DemoAction>('extend');
  const [days,setDays]=useState('14'),[reason,setReason]=useState('');
  const [intent,setIntent]=useState<DemoIntent|null>(null);
  const [confirm,setConfirm]=useState(false);
  const alive=useRef(true),saving=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    void getDemoAccess(tenantId,controller.signal).then(value=>{if(active){setAccess(value);setError('');}}).catch(()=>{if(active)setError('Der Demostatus konnte nicht geladen werden.');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;controller.abort();};
  },[tenantId,reload]);
  function refresh(){if(saving.current)return;setLoading(true);setIntent(null);setConfirm(false);setReload(value=>value+1);}
  const validDays=/^[1-9]\d?$/.test(days)&&Number(days)<=90;
  const valid=!error&&access?.kind==='demo'&&reason.trim().length>=3&&reason.length<=500&&(action!=='extend'||(validDays&&access.status!=='ended'));
  function review(){
    if(!valid||!access||loading||saving.current)return;
    const command={action,expectedVersion:access.version,reason:reason.trim(),...(action==='extend'?{days:Number(days)}:{})};
    setIntent({requestId:crypto.randomUUID(),command});setConfirm(true);
  }
  async function save(){
    if(!intent||saving.current)return;
    saving.current=true;setBusy(true);setError('');
    try{
      const next=await changeDemoAccess(tenantId,intent);
      if(alive.current){setAccess(next);setIntent(null);setConfirm(false);setReason('');}
    }catch{
      // Keep the exact reviewed intent after an uncertain response. The retry
      // must use the same request id and version, even if the server committed.
      if(alive.current){setError('Die Änderung konnte nicht bestätigt werden. Wiederhole denselben Vorgang oder lade den aktuellen Status neu.');setConfirm(false);}
    }finally{saving.current=false;if(alive.current)setBusy(false);}
  }
  const deadline=access?.expiresAt?new Intl.DateTimeFormat('de-DE',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Berlin'}).format(new Date(access.expiresAt)):null;
  return <section aria-label="Händler-Demozugang" className="space-y-4 rounded-xl border border-border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Händler-Demozugang</h2><Button variant="outline" disabled={loading||busy} onClick={refresh}>Status neu laden</Button></div>
    {loading?<p role="status">Demostatus wird geladen …</p>:access&&<div className={access.kind==='demo'?'rounded-lg bg-amber-50 p-4 text-amber-950':''}>
      <p className="font-semibold">{access.kind==='customer'?'Kundenkonto':access.status==='active'?'DEMO · aktiv':access.status==='ended'?'DEMO · beendet':'DEMO · abgelaufen'}</p>
      {access.kind==='demo'&&<p className="mt-1">Ablauf: {deadline} (Europe/Berlin). Vollständiger Funktionsumfang; vorhandene Mitarbeiterrechte gelten weiter.</p>}
    </div>}
    {error&&<p role="alert" className="text-sm text-status-danger">{error}</p>}
    {!loading&&access?.kind==='demo'&&<>
      <fieldset disabled={busy||intent!==null} className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="demo-action">Aktion</Label><select id="demo-action" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3" value={action} onChange={event=>setAction(event.target.value as DemoAction)}>{Object.entries(actions).map(([value,title])=><option key={value} value={value} disabled={value==='extend'&&access.status==='ended'}>{title}</option>)}</select></div>
        {action==='extend'&&<div><Label htmlFor="demo-days">Zusätzliche Tage (1–90)</Label><Input id="demo-days" type="number" min="1" max="90" step="1" value={days} onChange={event=>setDays(event.target.value)}/></div>}
        <div className="sm:col-span-2"><Label htmlFor="demo-reason">Grund für die Änderung</Label><Input id="demo-reason" maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></div>
      </fieldset>
      <p className="text-sm text-muted-foreground">Beim Ablauf und bei der Umwandlung bleiben die Händlerdaten erhalten. Eine Umwandlung löst keine automatische Zahlung aus.</p>
      {intent&&!confirm?<Button disabled={busy} onClick={()=>setConfirm(true)}>Denselben Vorgang erneut prüfen</Button>:<Button disabled={!valid||busy} onClick={review}>Änderung prüfen</Button>}
    </>}
    <ConfirmDialog open={confirm} onOpenChange={open=>{if(!saving.current){setConfirm(open);if(!error&&!open)setIntent(null);}}} title={intent?actions[intent.command.action]:'Demo ändern'}
      description={intent?`${intent.command.action==='extend'?`${intent.command.days} zusätzliche Tage. `:''}Grund: ${intent.command.reason}`:''}
      confirmLabel="Änderung ausführen" tone={intent?.command.action==='end'?'danger':'default'} loading={busy} onConfirm={save}/>
  </section>;
}
