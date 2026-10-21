import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import {destination} from './paths.mjs';
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
  if(input.action==='claim'){
   const {data:jobs,error}=await db.rpc('claim_sharepoint_uploads');if(error)throw error;
   const results=[];
   for(const job of jobs||[]){
    try{
     const target=destination(job);
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
   const target=destination(job);
   const {error:updateError}=await db.from('sharepoint_uploads').update({status:'delivered',destination_url:target.url,delivered_at:new Date().toISOString(),leased_until:null,error_message:null}).eq('id',job.id).eq('status','sending');
   if(updateError)throw updateError;
   return reply({status:'delivered'});
  }
  return reply({error:'Unsupported action'},400);
 }catch{return reply({error:'Delivery service unavailable; retry later.'},503)}
});
