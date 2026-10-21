const{test}=require('node:test');const assert=require('node:assert/strict');
test('outbound upload paths stay inside JAN CPT with unique names and project boundaries',async()=>{
 const{destination}=await import('../supabase/functions/sharepoint-uploads/paths.mjs');
 const job={id:'11111111-1111-4111-8111-111111111111',project_id:'22222222-2222-4222-8222-222222222222',project_title:'Roof / Work?',storage_path:'field/22222222-2222-4222-8222-222222222222/photo.jpg',file_name:'photo.jpg',category:'General'};
 const d=destination(job);assert.ok(d.folder.startsWith('JAN CPT/Roof - Work- - 22222222/Photos'));assert.ok(d.file_name.includes(job.id));assert.ok(d.url.startsWith('https://jmaait.sharepoint.com/sites/CapitalProgramming/Shared%20Documents/JAN%20CPT/'));
 assert.throws(()=>destination({...job,storage_path:'another-project/secret.pdf'}));
 assert.throws(()=>destination({...job,storage_path:job.project_id+'/../secret.pdf'}));
 assert.ok(destination({...job,file_name:'report.pdf'}).folder.endsWith('/Files'));
 assert.equal(destination(job).file_name,d.file_name);
});
