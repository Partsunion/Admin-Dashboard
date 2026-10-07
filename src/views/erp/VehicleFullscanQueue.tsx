import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useAuth} from '@/context/AuthContext';
import {usePermissions} from '@/auth/usePermissions';
import {getAuthToken,ApiError} from '@/api/client';
import {getFullscanRequest,listFullscanRequests,publishFullscanReport,updateFullscanStatus,
  type FullscanReport,type FullscanRequest} from '@/api/vehicleFullscan';

const labels={requested:'Angefragt',in_progress:'In Bearbeitung',completed:'Bereitgestellt',cancelled:'Storniert'};
const money=(cents:number)=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(cents/100);
const inputClass='w-full rounded border border-border bg-surface p-2 text-sm';
const buttonClass='rounded border border-border px-3 py-2 text-xs disabled:opacity-50';

export function VehicleFullscanQueue(){
  const {user}=useAuth();
  const owner=useMemo(()=>`${user?.id??'anonymous'}:${crypto.randomUUID()}`,[user]);
  return user?<FullscanQueueContent key={owner}/>:null;
}

function FullscanQueueContent(){
  const {can}=usePermissions();
  const [token]=useState(getAuthToken),mounted=useRef(true),sequence=useRef(0);
  const current=useCallback(()=>mounted.current&&getAuthToken()===token,[token]);
  const [status,setStatus]=useState('requested'),[search,setSearch]=useState(''),[offset,setOffset]=useState(0);
  const [page,setPage]=useState<{items:FullscanRequest[];total:number;limit:number;offset:number}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[selected,setSelected]=useState<FullscanRequest|null>(null);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    const revision=++sequence.current;let active=true;
    void Promise.resolve().then(async()=>{
      if(!active||!current())return;
      setBusy(true);setError(null);setPage(null);
      const next=await listFullscanRequests(status,search,offset);
      if(active&&current()&&sequence.current===revision)setPage(next);
    }).catch(failure=>{if(active&&current()&&sequence.current===revision)setError(failure instanceof Error?failure.message:'Anfragen konnten nicht geladen werden.');})
      .finally(()=>{if(active&&current()&&sequence.current===revision)setBusy(false);});
    return()=>{active=false;};
  },[current,status,search,offset,refresh]);
  return <section className="admin-work-panel my-5 space-y-4 p-5" aria-label="Manuelle Fahrzeug-Vollscans">
    <h2 className="font-display text-base font-bold">Manuelle Fahrzeug-Vollscans</h2>
    <p className="text-xs text-text-muted">Angefragte VIN prüfen und den fachlichen Bericht mit der Partsunion-Rechnung bereitstellen. Die Bearbeitungszeit von ungefähr zwei Tagen ist eine Schätzung.</p>
    <div className="flex flex-wrap gap-2"><label>Status<select className={inputClass} value={status} onChange={event=>{setStatus(event.target.value);setOffset(0);}}>
      <option value="all">Alle</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Betrieb oder VIN suchen<input className={inputClass} value={search} maxLength={100} onChange={event=>{setSearch(event.target.value);setOffset(0);}}/></label>
      <button className={buttonClass} disabled={busy} onClick={()=>setRefresh(value=>value+1)}>Anfragen aktualisieren</button></div>
    {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Anfragen werden geladen…</p>}
    {page&&<><p>{page.total} Anfragen · {page.total?offset+1:0}–{Math.min(offset+page.items.length,page.total)} angezeigt</p>
      <div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Betrieb</th><th>Fahrzeug / VIN</th><th>Status</th><th>Angefragt</th><th>Gebühr</th><th/></tr></thead><tbody>
        {page.items.map(row=><tr key={`${row.tenant_id}:${row.id}`} className="border-t border-border"><td className="p-2">{row.tenant_id}</td>
          <td>{String(row.vehicle_snapshot.make??'')} {String(row.vehicle_snapshot.model??'')}<br/>{String(row.vehicle_snapshot.vin??'')}</td>
          <td>{labels[row.status]}</td><td>{new Date(row.requested_at).toLocaleString('de-DE')}</td><td>{money(row.gross_cents)}</td>
          <td><button className={buttonClass} onClick={()=>setSelected(row)}>Anfrage öffnen</button></td></tr>)}
      </tbody></table></div>{page.total===0&&<p>Keine Anfragen für diese Auswahl.</p>}
      <div className="flex gap-2"><button className={buttonClass} disabled={busy||offset===0} onClick={()=>setOffset(value=>Math.max(0,value-50))}>Vorherige Anfragen</button>
        <button className={buttonClass} disabled={busy||offset+page.items.length>=page.total} onClick={()=>setOffset(value=>value+50)}>Weitere Anfragen</button></div></>}
    {selected&&<FullscanEditor key={`${selected.tenant_id}:${selected.id}`} selection={selected} canPublish={can('billing.manage')}
      onClose={()=>setSelected(null)} onChanged={()=>setRefresh(value=>value+1)}/>}
  </section>;
}

function blankReport(fingerprint:string):FullscanReport{return {title:'Fahrzeug-Vollscan',summary:'',vehicle_fingerprint:fingerprint,
  positions:[{part_name:'',oem_number:null,estimated_sale_price:null,source:'manual',source_reference:'',notes:''}],rest_parts_estimate:null,limitations:''};}

function FullscanEditor({selection,canPublish,onClose,onChanged}:{selection:FullscanRequest;canPublish:boolean;onClose:()=>void;onChanged:()=>void}){
  const mounted=useRef(true),pending=useRef(false),[token]=useState(getAuthToken);
  const [row,setRow]=useState<FullscanRequest|null>(null),[report,setReport]=useState(()=>blankReport(selection.vehicle_fingerprint));
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [publishIntent,setPublishIntent]=useState<{key:string;row:FullscanRequest;report:FullscanReport}|null>(null);
  const current=useCallback(()=>mounted.current&&getAuthToken()===token,[token]);
  const acceptRow=useCallback((next:FullscanRequest)=>{
    if(next.id!==selection.id||next.tenant_id!==selection.tenant_id)throw new Error('Antwort gehört zu einer anderen Anfrage.');
    setRow(next);if(next.result)setReport(next.result);
  },[selection.id,selection.tenant_id]);
  const reload=useCallback(async()=>{
    setBusy(true);setError(null);
    try{const next=await getFullscanRequest(selection);if(current())acceptRow(next);}
    catch(failure){if(current())setError(failure instanceof Error?failure.message:'Antrag konnte nicht geladen werden.');}
    finally{if(current())setBusy(false);}
  },[current,acceptRow,selection]);
  useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(current())return reload();});return()=>{mounted.current=false;};},[current,reload]);
  const publish=async()=>{
    if(!row||!canPublish||pending.current||!current())return;
    const intent=publishIntent??{key:crypto.randomUUID(),row,report:structuredClone(report)};
    setPublishIntent(intent);pending.current=true;setBusy(true);setError(null);
    try{const next=await publishFullscanReport(intent.row,intent.report,intent.key);if(!current())return;acceptRow(next);setPublishIntent(null);onChanged();}
    catch(failure){if(current()){
      setError(failure instanceof Error?failure.message:'Bereitstellung nicht bestätigt. Dieselbe Bereitstellung wiederholen oder Anfragestand laden.');
      if(failure instanceof ApiError&&[400,403,404,409,422].includes(failure.status))setPublishIntent(null);
    }}
    finally{pending.current=false;if(current())setBusy(false);}
  };
  const changeStatus=async(status:'in_progress'|'cancelled')=>{
    if(!row||!canPublish||pending.current||publishIntent||!current())return;
    pending.current=true;setBusy(true);setError(null);
    try{const next=await updateFullscanStatus(row,status,crypto.randomUUID());if(!current())return;acceptRow(next);onChanged();}
    catch(failure){if(current())setError(failure instanceof Error?failure.message:'Änderung nicht bestätigt. Anfragestand laden.');}
    finally{pending.current=false;if(current())setBusy(false);}
  };
  const editable=canPublish&&!busy&&!publishIntent&&row!==null&&['requested','in_progress'].includes(row.status);
  const reportValid=Boolean(report.title.trim()&&report.summary.trim()&&report.limitations.trim()
    &&report.positions.every(part=>part.part_name.trim()&&part.source_reference.trim()));
  return <article className="space-y-3 border-t border-border pt-4" aria-label="Vollscan bearbeiten">
    <div className="flex gap-2"><h3 className="font-semibold">Anfrage {selection.id}</h3><button className={buttonClass} onClick={onClose}>Schließen</button>
      <button className={buttonClass} disabled={busy} onClick={()=>void reload()}>Anfragestand laden</button></div>
    {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Anfrage wird verarbeitet…</p>}
    {row&&<><p>{row.billing_snapshot?.customer_name||row.tenant_id} · VIN {String(row.vehicle_snapshot.vin??'')} · {labels[row.status]}</p>
      <p className="whitespace-pre-wrap text-xs">{row.billing_snapshot?.customer_address}</p>
      <p>{money(row.net_cents)} netto + {money(row.vat_cents)} USt. = {money(row.gross_cents)} gesamt</p>
      {!canPublish&&<p>Lesender Zugriff. Zur Bearbeitung und Rechnungsfreigabe ist die Plattform-Billingberechtigung erforderlich.</p>}
      <fieldset disabled={!editable} className="space-y-3">
        <label className="block">Berichtstitel<input className={inputClass} value={report.title} maxLength={200} onChange={event=>setReport({...report,title:event.target.value})}/></label>
        <label className="block">Prüfergebnis<textarea className={inputClass} value={report.summary} maxLength={10000} onChange={event=>setReport({...report,summary:event.target.value})}/></label>
        {report.positions.map((part,index)=><div key={index} className="grid gap-2 border border-border p-3 sm:grid-cols-2">
          <label>Teilbezeichnung<input className={inputClass} value={part.part_name} maxLength={300} onChange={event=>setReport({...report,positions:report.positions.map((item,i)=>i===index?{...item,part_name:event.target.value}:item)})}/></label>
          <label>OE-Nummer, sofern geklärt<input className={inputClass} value={part.oem_number??''} maxLength={80} onChange={event=>setReport({...report,positions:report.positions.map((item,i)=>i===index?{...item,oem_number:event.target.value.trim()||null}:item)})}/></label>
          <label>Geschätzter VK in EUR<input className={inputClass} type="number" min="0" max="100000000" step="0.01" value={part.estimated_sale_price??''} onChange={event=>setReport({...report,positions:report.positions.map((item,i)=>i===index?{...item,estimated_sale_price:event.target.value===''?null:Number(event.target.value)}:item)})}/></label>
          <label>Quelle<select className={inputClass} value={part.source} onChange={event=>setReport({...report,positions:report.positions.map((item,i)=>i===index?{...item,source:event.target.value as typeof part.source}:item)})}>
            <option value="manual">Manueller Nachweis</option><option value="yq">YQ · manuell dokumentiert</option><option value="ebay_active">Aktive eBay-Angebote</option><option value="internal_sales">Eigene Verkäufe</option></select></label>
          <label>Konkreter Prüfnachweis<input className={inputClass} value={part.source_reference} maxLength={2000} onChange={event=>setReport({...report,positions:report.positions.map((item,i)=>i===index?{...item,source_reference:event.target.value}:item)})}/></label>
          <label>Teilhinweise<input className={inputClass} value={part.notes} maxLength={5000} onChange={event=>setReport({...report,positions:report.positions.map((item,i)=>i===index?{...item,notes:event.target.value}:item)})}/></label>
          <button className={buttonClass} disabled={report.positions.length===1} onClick={()=>setReport({...report,positions:report.positions.filter((_,i)=>i!==index)})}>Position entfernen</button>
        </div>)}
        <button className={buttonClass} disabled={report.positions.length>=2000} onClick={()=>setReport({...report,positions:[...report.positions,...blankReport('').positions]})}>Teilposition hinzufügen</button>
        <label className="block">Restteile-VK-Schätzung in EUR, falls belegbar<input className={inputClass} type="number" min="0" max="100000000" step="0.01" value={report.rest_parts_estimate??''} onChange={event=>setReport({...report,rest_parts_estimate:event.target.value===''?null:Number(event.target.value)})}/></label>
        <label className="block">Grenzen und ungeklärte Punkte<textarea className={inputClass} value={report.limitations} maxLength={10000} onChange={event=>setReport({...report,limitations:event.target.value})}/></label>
      </fieldset>
      {canPublish&&['requested','in_progress'].includes(row.status)&&<div className="flex flex-wrap gap-2">
        <button className={buttonClass} disabled={!editable||row.status==='in_progress'} onClick={()=>void changeStatus('in_progress')}>Bearbeitung beginnen</button>
        <button className={buttonClass} disabled={!editable} onClick={()=>void changeStatus('cancelled')}>Anfrage ohne Rechnung stornieren</button>
        <button className={buttonClass} disabled={busy||(!publishIntent&&!reportValid)} onClick={()=>void publish()}>{publishIntent?'Dieselbe Bereitstellung wiederholen':'Bericht und Rechnung bereitstellen'}</button>
      </div>}
      {row.invoice_id&&<p>Rechnung {row.invoice_snapshot?.document_number} und Bericht sind im Händlerbereich bereitgestellt.</p>}
    </>}
  </article>;
}
