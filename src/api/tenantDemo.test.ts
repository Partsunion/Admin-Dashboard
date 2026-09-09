import {beforeEach,describe,expect,it,vi} from 'vitest';
const fetchMock=vi.hoisted(()=>vi.fn());
vi.mock('./client',()=>({apiFetch:fetchMock}));
import {changeDemoAccess,getDemoAccess} from './tenantDemo';
const demo=()=>({kind:'demo',status:'active',startedAt:'2026-09-01T10:00:00.000Z',expiresAt:'2026-09-21T10:00:00.000Z',endedAt:null,serverTime:'2026-09-07T10:00:00.000Z',remainingSeconds:14*86400,version:1});
beforeEach(()=>{fetchMock.mockReset();});
describe('operator demo transport',()=>{
  it('reads an explicit full demo status from a safely encoded tenant path',async()=>{fetchMock.mockResolvedValue(demo());expect(await getDemoAccess('tenant/a')).toEqual(demo());expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/tenants/tenant%2Fa/demo-access');});
  it.each([{remainingSeconds:1},{expiresAt:null},{version:'1'},{status:'expired'},{endedAt:'2027-01-01T00:00:00.000Z'},{startedAt:'2026-10-01T00:00:00.000Z'}])('rejects contradictory access %j',async patch=>{fetchMock.mockResolvedValue({...demo(),...patch});await expect(getDemoAccess('tenant-a')).rejects.toThrow();});
  it('never interprets a failed request as an unlimited account',async()=>{fetchMock.mockRejectedValue(new Error('offline'));await expect(getDemoAccess('tenant-a')).rejects.toThrow('offline');});
  it('reuses the same deliberate command and idempotency key without automatic retries',async()=>{
    const intent={requestId:'request-001',command:{action:'extend' as const,days:7,reason:'Zusätzliche Testzeit',expectedVersion:1}};
    fetchMock.mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({access:demo(),replayed:true});
    await expect(changeDemoAccess('tenant-a',intent)).rejects.toThrow('lost response');await changeDemoAccess('tenant-a',intent);
    expect(fetchMock.mock.calls[0]).toEqual(fetchMock.mock.calls[1]);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({maxRetries:0,headers:{'Idempotency-Key':'request-001'},body:JSON.stringify(intent.command)});
  });
});
