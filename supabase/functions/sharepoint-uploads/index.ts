import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import {destination,projectFolder,folderUrl} from './paths.mjs';
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return reply({error:'POST required'},405);
 const token=req.headers.get('x-jan-cpt-sharepoint-key')||'';
 if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'Unauthorized'},401);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try{
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),n=>n.toString(16).padStart(2,'0')).join('');
  const {data:keys,error:authError}=await db.from('sharepoint_sync_keys').select('id').eq('enabled',true).eq('token_hash',hash);
  if(authError||keys?.length!==1)return reply({error:'Unauthorized'},401);
  const raw=await req.text();if(raw.length>4096)return reply({error:'Request too large'},413);
  let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid JSON'},400)}
  async function ensureMapping(job:any){
   const {error:insertError}=await db.from('sharepoint_project_folders').upsert({project_id:job.project_id},{onConflict:'project_id',ignoreDuplicates:true});
   if(insertError)throw insertError;
   const {data:map,error}=await db.from('sharepoint_project_folders').select('*').eq('project_id',job.project_id).single();
   if(error)throw error;
   if(map.folder_path)return map;
   const folder=projectFolder(job);
   const {data:saved,error:saveError}=await db.from('sharepoint_project_folders').update({folder_path:folder,url:folderUrl(folder)}).eq('project_id',job.project_id).is('folder_path',null).select('*');
   if(saveError)throw saveError;
   if(saved?.[0])return saved[0];
   const {data:existing,error:readError}=await db.from('sharepoint_project_folders').select('*').eq('project_id',job.project_id).single();if(readError)throw readError;return existing;
  }
  if(input.action==='claimfolders'){
   const {data:jobs,error}=await db.rpc('claim_sharepoint_folders');if(error)throw error;
   const results=[];
   for(const job of jobs||[]){
    const {data:project,error:projectError}=await db.from('projects').select('title').eq('id',job.project_id).single();if(projectError)throw projectError;
    const map=await ensureMapping({...job,project_title:project.title});
    results.push({id:job.project_id,folder:map.folder_path});
   }
   return reply({jobs:results});
  }
  if(input.action==='completefolder'&&/^[0-9a-f-]{36}$/i.test(input.id)){
   const {error}=await db.from('sharepoint_project_folders').update({status:'ready',ready_at:new Date().toISOString(),leased_until:null}).eq('project_id',input.id).eq('status','sending').not('folder_path','is',null);
   if(error)throw error;return reply({status:'ready'});
  }
  if(input.action==='claim'){
   const {data:jobs,error}=await db.rpc('claim_sharepoint_uploads');if(error)throw error;
   const results=[];
   for(const job of jobs||[]){
    try{
     const map=await ensureMapping(job);
     const target=destination(job,map.folder_path);
     const {data,error:signError}=await db.storage.from('project-docs').createSignedUrl(job.storage_path,1200);
     if(signError||!data?.signedUrl)throw Error('File unavailable');
     results.push({id:job.id,...target,download_url:data.signedUrl});
    }catch{
     await db.from('sharepoint_uploads').update({status:'error',error_message:'File unavailable or invalid path; original remains in JAN CPT.'}).eq('id',job.id);
    }
   }
   return reply({jobs:results});
  }
  if(input.action==='complete'&&/^[0-9a-f-]{36}$/i.test(input.id)){
   const {data:job,error}=await db.from('sharepoint_uploads').select('*').eq('id',input.id).single();
   if(error||!job)return reply({error:'Upload not found'},404);
   if(job.status==='delivered')return reply({status:'delivered'});
   if(job.status!=='sending')return reply({error:'Upload was not claimed'},409);
   const map=await ensureMapping(job);
   const target=destination(job,map.folder_path);
   const {error:updateError}=await db.from('sharepoint_uploads').update({status:'delivered',destination_url:target.url,delivered_at:new Date().toISOString(),leased_until:null,error_message:null}).eq('id',job.id).eq('status','sending');
   if(updateError)throw updateError;
   const {error:mapError}=await db.from('sharepoint_project_folders').update({status:'ready',ready_at:new Date().toISOString(),leased_until:null}).eq('project_id',job.project_id);if(mapError)throw mapError;
   return reply({status:'delivered'});
  }
  return reply({error:'Unsupported action'},400);
 }catch{return reply({error:'Delivery service unavailable; retry later.'},503)}
});
