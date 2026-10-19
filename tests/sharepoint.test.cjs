const {test}=require('node:test');
const assert=require('node:assert/strict');
const moduleReady=import('../supabase/functions/sharepoint-sync/validation.mjs');
const folder='https://jmaait.sharepoint.com/sites/CapitalProgramming/Shared%20Documents/_Projects/_JAN/Test';
const projects=[{id:'project-1',sharepoint_folder_url:folder}];
const file={site_url:'https://jmaait.sharepoint.com/sites/CapitalProgramming',library_id:'12345678-1234-1234-1234-123456789abc',item_id:12,file_name:'Plan.pdf',url:folder+'/Plan.pdf',modified_at:'2026-10-01T14:00:00Z',version:'1.0'};
test('SharePoint delivery matches exact folder boundaries and stable IDs',async()=>{
 const {prepareDocument}=await moduleReady;
 const result=prepareDocument(file,projects).payload;
 assert.equal(result.project_id,'project-1');assert.equal(result.source_id,file.library_id+':12');
 assert.equal(prepareDocument({...file,url:folder+'-Other/Plan.pdf'},projects).status,'unmapped');
 assert.equal(prepareDocument({...file,is_folder:true},projects).status,'ignored_folder');
 assert.throws(()=>prepareDocument(file,[...projects,...projects]),/Multiple projects/);
});
test('SharePoint delivery rejects external URLs, malformed metadata and traversal',async()=>{
 const {prepareDocument}=await moduleReady;
 for(const change of [{url:'https://evil.example/Plan.pdf'},{url:'https://jmaait.sharepoint.com.evil.example/Plan.pdf'},
 {url:folder+'/Plan.pdf?redirect=https://evil.example'}, {url:folder+'/%2e%2e%2fPlan.pdf'},
 {file_name:'Different.pdf'},{modified_at:'tomorrow'},{item_id:'0'},{library_id:'wrong'},
 {site_url:'https://other.sharepoint.com/sites/Test'}]) assert.throws(()=>prepareDocument({...file,...change},projects));
});
