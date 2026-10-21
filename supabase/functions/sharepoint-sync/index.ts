import { prepareDocument } from './validation.mjs';

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
    if(Number(req.headers.get('content-length')||0)>16384) return reply({error:'Payload too large'},413);
    const reader=req.body?.getReader();
    if(!reader) return reply({error:'File metadata required'},400);
    const chunks:Uint8Array[]=[];let length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>16384){await reader.cancel();return reply({error:'Payload too large'},413);}chunks.push(value);}
    const raw=new Uint8Array(length);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
    let input;try{input=JSON.parse(new TextDecoder().decode(raw));}catch{return reply({error:'Invalid JSON'},400);}
    const projects=await api('projects?select=id,sharepoint_folder_url&sharepoint_folder_url=not.is.null');
    const folders=await api('sharepoint_project_folders?select=project_id,url&status=eq.ready&url=not.is.null');
    projects.push(...folders.map((f:any)=>({id:f.project_id,sharepoint_folder_url:f.url})));
    let parsed;try{parsed=prepareDocument(input,projects);}catch(e){return reply({error:(e as Error).message},400);}
    if(!parsed.payload)return reply(parsed);
    return reply(await api('rpc/receive_sharepoint_document',{payload:parsed.payload}));
  }catch{return reply({error:'Delivery could not be stored; retry later.'},503);}
});
