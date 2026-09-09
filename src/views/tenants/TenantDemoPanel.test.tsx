import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({read:vi.fn(),change:vi.fn(),allowed:true}));
vi.mock('@/auth/usePermissions',()=>({usePermissions:()=>({can:()=>mocks.allowed})}));
vi.mock('@/api/tenantDemo',()=>({getDemoAccess:mocks.read,changeDemoAccess:mocks.change}));
import {TenantDemoPanel} from './TenantDemoPanel';
const demo=()=>({kind:'demo',status:'active',startedAt:'2026-09-01T10:00:00.000Z',expiresAt:'2026-09-21T10:00:00.000Z',endedAt:null,serverTime:'2026-09-07T10:00:00.000Z',remainingSeconds:14*86400,version:1});
beforeEach(()=>{mocks.allowed=true;mocks.read.mockReset().mockResolvedValue(demo());mocks.change.mockReset().mockResolvedValue({...demo(),version:2});});
async function review(){await screen.findByText('DEMO · aktiv');fireEvent.change(screen.getByLabelText('Grund für die Änderung'),{target:{value:'Händler benötigt mehr Testzeit'}});fireEvent.click(screen.getByRole('button',{name:'Änderung prüfen'}));return screen.findByRole('dialog');}
describe('operator demo management',()=>{
  it('does not query or show billing controls without permission',()=>{mocks.allowed=false;render(<TenantDemoPanel tenantId="tenant-a"/>);expect(mocks.read).not.toHaveBeenCalled();expect(screen.queryByText('Händler-Demozugang')).not.toBeInTheDocument();});
  it('shows the actual deadline and requires confirmation before extending',async()=>{render(<TenantDemoPanel tenantId="tenant-a"/>);const dialog=await review();expect(screen.getByText(/21. September 2026/)).toBeInTheDocument();expect(mocks.change).not.toHaveBeenCalled();fireEvent.click(within(dialog).getByRole('button',{name:'Änderung ausführen'}));await waitFor(()=>expect(mocks.change).toHaveBeenCalledOnce());expect(mocks.change.mock.calls[0]).toEqual(['tenant-a',{requestId:expect.any(String),command:{action:'extend',days:14,expectedVersion:1,reason:'Händler benötigt mehr Testzeit'}}]);});
  it('does not change the account when confirmation is cancelled',async()=>{render(<TenantDemoPanel tenantId="tenant-a"/>);const dialog=await review();fireEvent.click(within(dialog).getByRole('button',{name:'Abbrechen'}));expect(mocks.change).not.toHaveBeenCalled();expect(screen.getByLabelText('Grund für die Änderung')).toBeEnabled();});
  it('retries a lost response with the exact previous operation',async()=>{
    mocks.change.mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({...demo(),version:2});render(<TenantDemoPanel tenantId="tenant-a"/>);
    let dialog=await review();fireEvent.click(within(dialog).getByRole('button',{name:'Änderung ausführen'}));await screen.findByRole('alert');
    expect(screen.getByLabelText('Zusätzliche Tage (1–90)')).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Denselben Vorgang erneut prüfen'}));dialog=await screen.findByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'Änderung ausführen'}));
    await waitFor(()=>expect(mocks.change).toHaveBeenCalledTimes(2));expect(mocks.change.mock.calls[0]).toEqual(mocks.change.mock.calls[1]);
  });
  it('never displays a late status from the previous dealer',async()=>{let resolve!:(value:unknown)=>void;mocks.read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValueOnce({...demo(),kind:'customer',remainingSeconds:null});const view=render(<TenantDemoPanel tenantId="tenant-a"/>);view.rerender(<TenantDemoPanel tenantId="tenant-b"/>);await screen.findByText('Kundenkonto');await act(async()=>resolve(demo()));expect(screen.queryByText('DEMO · aktiv')).not.toBeInTheDocument();});
  it('does not offer to turn an existing paying customer into a new demo',async()=>{mocks.read.mockResolvedValue({...demo(),kind:'customer',remainingSeconds:null});render(<TenantDemoPanel tenantId="tenant-a"/>);await screen.findByText('Kundenkonto');expect(screen.queryByLabelText('Aktion')).not.toBeInTheDocument();});
});
