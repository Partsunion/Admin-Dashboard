import {beforeEach,describe,expect,it,vi} from 'vitest';
const {call}=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('./client',()=>({apiFetch:call}));
import {sendMarketingEmail} from './emails';
const id='9c08be94-f11c-49a4-a2aa-45ce8e8c8fab';
const acknowledged={requestId:id,success:true,status:'completed',sent:1,accepted:1,failed:0,unknown:0,pending:0,total:1,delivery_confirmed:false};
beforeEach(()=>{call.mockReset();});
describe('original Admin marketing transport evidence',()=>{
    it('requires an explicit original decision ID before every offered API mutation',async()=>{await expect(sendMarketingEmail('Original','<p>Original</p>','custom',['recipient@example.invalid'])).rejects.toThrow('requestId');expect(call).not.toHaveBeenCalled();});
    it('replays a lost response using exactly the original decision and original payload',async()=>{
        call.mockRejectedValueOnce(new Error('Original response lost')).mockResolvedValueOnce(acknowledged);
        await expect(sendMarketingEmail('Original','<p>Original</p>',undefined,['recipient@example.invalid'],id)).rejects.toThrow('response lost');expect(await sendMarketingEmail('Original','<p>Original</p>',undefined,['recipient@example.invalid'],id)).toEqual(acknowledged);expect(call.mock.calls[0]).toEqual(call.mock.calls[1]);expect(call.mock.calls[0][1].headers).toEqual({'Idempotency-Key':id});
    });
    it('accepts the actual canonical PostgreSQL UUID receipt for the same uppercase original key',async()=>{call.mockResolvedValue(acknowledged);expect(await sendMarketingEmail('Original','<p>Original</p>',undefined,['recipient@example.invalid'],id.toUpperCase())).toEqual(acknowledged);expect(call.mock.calls[0][1].headers).toEqual({'Idempotency-Key':id.toUpperCase()});});
    it('retains unknown/pending as unknown and never calls accepted provider evidence actual delivery',async()=>{
        const unknown={...acknowledged,success:false,status:'unknown',sent:0,accepted:0,unknown:1};call.mockResolvedValue(unknown);expect(await sendMarketingEmail('Original','<p>Original</p>',undefined,['recipient@example.invalid'],id)).toEqual(unknown);expect(call).toHaveBeenCalledTimes(1);
    });
    it.each([{...acknowledged,accepted:0},{...acknowledged,delivery_confirmed:true},{...acknowledged,requestId:'2327ab73-a77b-4787-a6ad-7d7a3eb055cc'}])('rejects inconsistent counts, delivery claims and unrelated receipt identity',async(raw)=>{call.mockResolvedValue(raw);await expect(sendMarketingEmail('Original','<p>Original</p>',undefined,['recipient@example.invalid'],id)).rejects.toThrow();expect(call).toHaveBeenCalledTimes(1);});
});
