import { prepareDocument } from './validation.mjs';
import {CONTENT_BUCKET,MAX_BODY_BYTES,decodeContent,contentPath,sameSourceVersion} from './content.mjs';

const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST') return reply({error:'POST required'},405);
  const token=req.headers.get('x-jan-cpt-sharepoint-key')||'';
  if(!/^[a-f0-9]{64}$/.test(token)) return reply({error:'Unauthorized'},401);
  const base=Deno.env.get('SUPABASE_URL');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!base||!key) return reply({error:'Service unavailable'},503);
  async function api(path:string,body?:unknown){
    const r=await fetch(base+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',
      headers:{apikey:key!,Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    if(!r.ok) throw new Error('Database operation failed');
    return r.json();
  }
  try{
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),x=>x.toString(16).padStart(2,'0')).join('');
    const keys=await api('sharepoint_sync_keys?select=id&enabled=eq.true&token_hash=eq.'+hash+'&limit=1');
    if(keys.length!==1) return reply({error:'Unauthorized'},401);
    if(Number(req.headers.get('content-length')||0)>MAX_BODY_BYTES) return reply({error:'Payload too large'},413);
    const reader=req.body?.getReader();
    if(!reader) return reply({error:'File metadata required'},400);
    const chunks:Uint8Array[]=[];let length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BODY_BYTES){await reader.cancel();return reply({error:'Payload too large'},413);}chunks.push(value);}
    const raw=new Uint8Array(length);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
    let input;try{input=JSON.parse(new TextDecoder().decode(raw));}catch{return reply({error:'Invalid JSON'},400);}
    if(!Object.prototype.hasOwnProperty.call(input||{},'content_base64')&&length>16384)return reply({error:'Payload too large'},413);
    const projects=await api('projects?select=id,sharepoint_folder_url&sharepoint_folder_url=not.is.null');
    const folders=await api('sharepoint_project_folders?select=project_id,url&status=eq.ready&url=not.is.null');
    projects.push(...folders.map((f:any)=>({id:f.project_id,sharepoint_folder_url:f.url})));
    let parsed;try{parsed=prepareDocument(input,projects);}catch(e){return reply({error:(e as Error).message},400);}
    if(!parsed.payload)return reply(parsed);
    const payload=parsed.payload;
    const received=await api('rpc/receive_sharepoint_document',{payload});
    const content=decodeContent(input,payload.file_name);
    if(content.content_status!=='ready')return reply({...received,content_status:content.content_status,...(content.content_error?{content_error:content.content_error}:{})});
    // Metadata-only deliveries continue to work without a cache. An unchanged
    // timestamp still accepts its first content delivery for initial backfill.
    try {
      const rows=await api('sharepoint_documents?select=project_id,file_name,modified_at,source_version,content_version_conflict&source_id=eq.'+encodeURIComponent(payload.source_id)+'&limit=1');
      if(!sameSourceVersion(rows[0],payload))return reply({...received,content_status:'stale'});
      const path=await contentPath(payload,content);
      const upload=await fetch(base+'/storage/v1/object/'+CONTENT_BUCKET+'/'+path,{method:'POST',
        headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':content.contentType,'x-upsert':'false'},
        body:content.bytes,signal:AbortSignal.timeout(20000)});
      if(!upload.ok){
        let detail:any={};try{detail=await upload.json();}catch{}
        // The immutable key includes the byte hash. A duplicate cannot replace
        // another file; it is the expected result of an identical retry.
        if(upload.status!==409&&String(detail.statusCode)!=='409'&&detail.code!=='Duplicate'&&detail.error!=='Duplicate')throw new Error('Content upload failed');
      }
      const cached=await api('rpc/cache_sharepoint_file_contents',{payload:{source_id:payload.source_id,project_id:payload.project_id,
        storage_path:path,size_bytes:content.bytes.length,source_modified_at:payload.modified_at,source_version:payload.source_version,file_name:payload.file_name}});
      return reply({...received,content_status:cached.content_status});
    }catch{
      // Keep metadata accepted, but let the flow retry this content delivery.
      // Never delete an object after an uncertain database write.
      return reply({...received,content_status:'error',content_error:'File contents could not be cached; retry this delivery.'},503);
    }
  }catch{return reply({error:'Delivery could not be stored; retry later.'},503);}
});
