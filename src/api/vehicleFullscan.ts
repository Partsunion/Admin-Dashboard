import {apiFetch} from './client';

export interface FullscanReport {
  title:string;summary:string;vehicle_fingerprint:string;
  positions:Array<{part_name:string;oem_number:string|null;estimated_sale_price:number|null;
    source:'manual'|'yq'|'ebay_active'|'internal_sales';source_reference:string;notes:string}>;
  rest_parts_estimate:number|null;limitations:string;
}
export interface FullscanRequest {
  id:string;tenant_id:string;vehicle_id:string;branch_id:string;version:number;
  status:'requested'|'in_progress'|'completed'|'cancelled';requested_at:string;estimated_ready_at:string;
  vehicle_snapshot:Record<string,unknown>;vehicle_fingerprint:string;
  billing_snapshot?:{customer_name:string;customer_address:string;recipient_email:string};
  net_cents:number;vat_cents:number;gross_cents:number;result?:FullscanReport|null;
  invoice_id:string|null;invoice_snapshot?:{document_number:string}|null;
}
const base='/api/admin/internal-erp/vehicle-fullscan-requests';
export function listFullscanRequests(status:string,search:string,offset:number){
  return apiFetch<{items:FullscanRequest[];total:number;limit:number;offset:number}>(`${base}?${new URLSearchParams({status,search,offset:String(offset),limit:'50'})}`,{dedupe:false});
}
export function getFullscanRequest(row:Pick<FullscanRequest,'id'|'tenant_id'>){
  return apiFetch<FullscanRequest>(`${base}/${encodeURIComponent(row.id)}?${new URLSearchParams({tenant_id:row.tenant_id})}`,{dedupe:false});
}
export function updateFullscanStatus(row:FullscanRequest,status:'in_progress'|'cancelled',key:string){
  return apiFetch<FullscanRequest>(`${base}/${encodeURIComponent(row.id)}/status`,{method:'POST',headers:{'Idempotency-Key':key},
    body:JSON.stringify({tenant_id:row.tenant_id,expected_version:row.version,status})});
}
export function publishFullscanReport(row:FullscanRequest,report:FullscanReport,key:string){
  return apiFetch<FullscanRequest>(`${base}/${encodeURIComponent(row.id)}/publish`,{method:'POST',headers:{'Idempotency-Key':key},
    body:JSON.stringify({tenant_id:row.tenant_id,expected_version:row.version,report})});
}
