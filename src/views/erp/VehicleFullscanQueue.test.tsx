import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {FullscanRequest} from '@/api/vehicleFullscan';
const state=vi.hoisted(()=>({can:true,user:{id:'operator',role:'superadmin'},list:vi.fn(),detail:vi.fn(),publish:vi.fn(),status:vi.fn()}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({user:state.user})}));
vi.mock('@/auth/usePermissions',()=>({usePermissions:()=>({can:()=>state.can})}));
vi.mock('@/api/vehicleFullscan',()=>({listFullscanRequests:state.list,getFullscanRequest:state.detail,publishFullscanReport:state.publish,updateFullscanStatus:state.status}));
import {VehicleFullscanQueue} from './VehicleFullscanQueue';
const row:FullscanRequest={id:'request-a',tenant_id:'tenant-a',vehicle_id:'vehicle-a',branch_id:'branch-a',version:1,status:'requested',requested_at:'2026-10-07T10:00:00Z',estimated_ready_at:'2026-10-09T10:00:00Z',vehicle_snapshot:{vin:'WVWZZZ1JZXW000001',make:'VW',model:'Golf'},vehicle_fingerprint:'a'.repeat(64),net_cents:2000,vat_cents:380,gross_cents:2380,invoice_id:null,billing_snapshot:{customer_name:'Betrieb A',customer_address:'Teststrasse 1',recipient_email:'a@example.invalid'}};
describe('Platform manual fullscan queue',()=>{
  beforeEach(()=>{vi.resetAllMocks();state.can=true;state.list.mockResolvedValue({items:[row],total:1,limit:50,offset:0});state.detail.mockResolvedValue(row);});
  const open=async()=>{fireEvent.click(await screen.findByRole('button',{name:'Anfrage öffnen'}));await screen.findByText(/Betrieb A · VIN/);};
  const fill=()=>{fireEvent.change(screen.getByLabelText('Prüfergebnis'),{target:{value:'Identität geprüft'}});fireEvent.change(screen.getByLabelText('Teilbezeichnung'),{target:{value:'Scheinwerfer'}});fireEvent.change(screen.getByLabelText('Konkreter Prüfnachweis'),{target:{value:'Prüfbogen 1'}});fireEvent.change(screen.getByLabelText('Grenzen und ungeklärte Punkte'),{target:{value:'OE ungeklärt'}});};
  it('shows actual server totals and requests the next page rather than silently slicing',async()=>{
    state.list.mockResolvedValueOnce({items:Array.from({length:50},(_,index)=>({...row,id:`request-${index}`})),total:51,limit:50,offset:0});state.list.mockResolvedValueOnce({items:[{...row,id:'request-50'}],total:51,limit:50,offset:50});
    render(<VehicleFullscanQueue/>);await screen.findByText('51 Anfragen · 1–50 angezeigt');fireEvent.click(screen.getByRole('button',{name:'Weitere Anfragen'}));await screen.findByText('51 Anfragen · 51–51 angezeigt');expect(state.list).toHaveBeenLastCalledWith('requested','',50);
  });
  it('keeps a failed queue read visible without asserting an empty queue',async()=>{
    state.list.mockRejectedValue(new Error('Quelle offline'));render(<VehicleFullscanQueue/>);expect(await screen.findByRole('alert')).toHaveTextContent('Quelle offline');expect(screen.queryByText(/Keine Anfragen/)).not.toBeInTheDocument();
  });
  it('allows read-only inspection and disables report editing and fee publication',async()=>{
    state.can=false;render(<VehicleFullscanQueue/>);await open();expect(screen.getByLabelText('Prüfergebnis')).toBeDisabled();expect(screen.queryByRole('button',{name:'Bericht und Rechnung bereitstellen'})).not.toBeInTheDocument();expect(state.publish).not.toHaveBeenCalled();
  });
  it('locks the original report and repeats the same publication after response loss',async()=>{
    state.publish.mockRejectedValueOnce(new Error('Antwort verloren')).mockResolvedValueOnce({...row,status:'completed',invoice_id:'invoice-a',invoice_snapshot:{document_number:'FULL-1'}});
    render(<VehicleFullscanQueue/>);await open();fill();fireEvent.click(screen.getByRole('button',{name:'Bericht und Rechnung bereitstellen'}));await screen.findByRole('alert');expect(screen.getByLabelText('Prüfergebnis')).toBeDisabled();
    const first=state.publish.mock.calls[0];fireEvent.click(screen.getByRole('button',{name:'Dieselbe Bereitstellung wiederholen'}));await screen.findByText(/Rechnung FULL-1 und Bericht/);expect(state.publish.mock.calls[1]).toEqual(first);
  });
  it('discards a late first-A detail after opening B and then A again',async()=>{
    const other={...row,id:'request-b',tenant_id:'tenant-b'};state.list.mockResolvedValue({items:[row,other],total:2,limit:50,offset:0});let finish!:(row:FullscanRequest)=>void;
    state.detail.mockImplementationOnce(()=>new Promise<FullscanRequest>(resolve=>{finish=resolve;})).mockResolvedValueOnce(other).mockResolvedValueOnce({...row,billing_snapshot:{...row.billing_snapshot!,customer_name:'Frischer Betrieb A'}});
    render(<VehicleFullscanQueue/>);const buttons=await screen.findAllByRole('button',{name:'Anfrage öffnen'});fireEvent.click(buttons[0]);await waitFor(()=>expect(state.detail).toHaveBeenCalledTimes(1));fireEvent.click(buttons[1]);await waitFor(()=>expect(state.detail).toHaveBeenCalledTimes(2));fireEvent.click(buttons[0]);await screen.findByText(/Frischer Betrieb A/);
    await act(async()=>finish({...row,billing_snapshot:{...row.billing_snapshot!,customer_name:'Veralteter Betrieb A'}}));expect(screen.queryByText(/Veralteter Betrieb A/)).not.toBeInTheDocument();
  });
});
