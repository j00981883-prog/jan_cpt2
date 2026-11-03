const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto}=require('node:crypto');
const ready=import('../supabase/functions/sharepoint-sync/content.mjs');
const project='11111111-1111-4111-8111-111111111111';
const library='22222222-2222-4222-8222-222222222222';
const folder='https://jmaait.sharepoint.com/sites/CapitalProgramming/Shared%20Documents/Project';
const metadata={site_url:'https://jmaait.sharepoint.com/sites/CapitalProgramming',library_id:library,item_id:7,file_name:'Scope.txt',url:folder+'/Scope.txt',modified_at:'2026-11-01T12:00:00Z',version:'3.0'};
const b64=value=>Buffer.from(value).toString('base64');

test('content validation preserves metadata-only delivery and accepts supported real bytes',async()=>{
 const {decodeContent}=await ready;
 assert.equal(decodeContent({},'Scope.txt').content_status,'not_provided');
 const text=decodeContent({content_base64:b64('Scope: replace ceiling.\nBudget,$23')},'Scope.csv');
 assert.equal(text.content_status,'ready');assert.equal(text.contentType,'text/csv');
 assert.match(new TextDecoder().decode(text.bytes),/replace ceiling/);
 const pdf=decodeContent({content_base64:b64('%PDF-1.7\nTest fixture\n%%EOF')},'Scope.PDF');
 assert.equal(pdf.content_status,'ready');assert.equal(pdf.contentType,'application/pdf');
});

test('content validation rejects Office files, malformed base64 and disguised binary data',async()=>{
 const {decodeContent}=await ready;
 assert.equal(decodeContent({content_base64:b64('PK zip bytes')},'Document.docx').content_status,'unsupported');
 for(const value of [null,{},'', 'data:text/plain;base64,SGk=', 'SGk', 'SG k=', 'A===','!!!!','Zh=='])assert.equal(decodeContent({content_base64:value},'Scope.txt').content_status,'invalid',String(value));
 assert.equal(decodeContent({content_base64:b64('not a PDF')},'Scope.pdf').content_status,'invalid');
 assert.equal(decodeContent({content_base64:b64(Buffer.from([0xFF,0xFE,0,0]))},'Scope.txt').content_status,'invalid');
 assert.equal(decodeContent({content_base64:b64('contains\0binary')},'Scope.csv').content_status,'invalid');
});

test('the decoded byte limit is exact and large valid base64 avoids regex recursion',async()=>{
 const {decodeContent,MAX_FILE_BYTES}=await ready;
 assert.equal(decodeContent({content_base64:b64(Buffer.alloc(MAX_FILE_BYTES,65))},'Large.txt').bytes.length,MAX_FILE_BYTES);
 assert.equal(decodeContent({content_base64:b64(Buffer.alloc(MAX_FILE_BYTES+1,65))},'Large.txt').content_status,'too_large');
});

test('immutable paths distinguish source/version/bytes while repeated delivery keeps the same path',async()=>{
 const {contentPath,decodeContent,sameSourceVersion}=await ready;
 const payload={project_id:project,source_id:library+':7',modified_at:metadata.modified_at,source_version:'3.0',file_name:'Scope.txt'};
 const content=decodeContent({content_base64:b64('Scope')},'Scope.txt');
 const first=await contentPath(payload,content);
 assert.match(first,new RegExp('^'+project+'/[a-f0-9]{64}/[a-f0-9]{64}/[a-f0-9]{64}\\.txt$'));
 assert.equal(await contentPath(payload,content),first);
 assert.notEqual(await contentPath({...payload,source_version:'4.0'},content),first);
 assert.notEqual(await contentPath({...payload,source_id:library+':8'},content),first);
 assert.notEqual(await contentPath(payload,decodeContent({content_base64:b64('Different')},'Scope.txt')),first);
 assert.equal(sameSourceVersion({...payload,modified_at:'2026-11-01T12:00:00+00:00'},payload),true);
 assert.equal(sameSourceVersion({...payload,source_version:'4.0'},payload),false);
 assert.equal(sameSourceVersion({...payload,project_id:'another'},payload),false);
 assert.equal(sameSourceVersion({...payload,content_version_conflict:true},payload),false);
});

async function setup(options={}){
 const content=await ready;
 const {prepareDocument}=await import('../supabase/functions/sharepoint-sync/validation.mjs');
 const calls=[],uploads=[],objects=new Map();let handler,record=options.existing||null,cache=null;
 const raw=fs.readFileSync(path.join(__dirname,'../supabase/functions/sharepoint-sync/index.ts'),'utf8').replace(/^import .*;\r?\n/gm,'');
 const context={...content,prepareDocument,Request,Response,Uint8Array,TextEncoder,TextDecoder,AbortSignal,Date,JSON,Object,Number,String,crypto:webcrypto,
  Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://test.invalid':'test-service-placeholder'},serve:fn=>{handler=fn;}},
  fetch:async(url,init={})=>{
   calls.push({url,method:init.method||'GET'});const u=new URL(url),route=u.pathname.split('/rest/v1/')[1];
   if(u.pathname.startsWith('/storage/v1/object/sharepoint-ai/')){
    const objectPath=u.pathname.slice('/storage/v1/object/sharepoint-ai/'.length);uploads.push(objectPath);
    assert.equal(init.headers['x-upsert'],'false');assert.equal(init.method,'POST');
    if(options.storageFailure)return Response.json({error:'unavailable'},{status:503});
    if(options.advanceDuringUpload)record={...record,modified_at:'2026-11-02T12:00:00Z',source_version:'4.0'};
    if(objects.has(objectPath))return Response.json({statusCode:'409',error:'Duplicate'},{status:400});
    objects.set(objectPath,init.body);return Response.json({Key:objectPath});
   }
   if(route==='sharepoint_sync_keys')return Response.json(options.authorized===false?[]:[{id:'key-record'}]);
   if(route==='projects')return Response.json([{id:project,sharepoint_folder_url:folder}]);
   if(route==='sharepoint_project_folders')return Response.json([]);
   if(route==='sharepoint_documents')return Response.json(record?[record]:[]);
   const body=JSON.parse(init.body||'{}');
   if(route==='rpc/receive_sharepoint_document'){
    const next=body.payload;
    if(record&&Date.parse(record.modified_at)>=Date.parse(next.modified_at))return Response.json({status:'unchanged'});
    record={...next};return Response.json({status:'added',project_id:project});
   }
   if(route==='rpc/cache_sharepoint_file_contents'){
    const next=body.payload;
    if(record.project_id!==next.project_id||Date.parse(record.modified_at)!==Date.parse(next.source_modified_at)||record.source_version!==next.source_version)return Response.json({content_status:'stale'});
    if(cache&&cache.storage_path===next.storage_path)return Response.json({content_status:'unchanged'});
    cache={...next};return Response.json({content_status:'cached'});
   }
   throw new Error('Unexpected route '+route);
  }};
 vm.runInNewContext(stripTypeScriptTypes(raw),context);
 return {calls,uploads,objects,getCache:()=>cache,getRecord:()=>record,
  async send(body,headers={}){const response=await handler(new Request('https://test.invalid/functions/v1/sharepoint-sync',{method:'POST',headers:{'x-jan-cpt-sharepoint-key':'a'.repeat(64),'content-type':'application/json',...headers},body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};}};
}

test('receiver keeps metadata-only delivery working without storage/cache access',async()=>{
 const s=await setup(),result=await s.send(metadata);
 assert.equal(result.status,200);assert.equal(result.body.status,'added');assert.equal(result.body.content_status,'not_provided');
 assert.equal(s.uploads.length,0);assert.equal(s.getCache(),null);
 assert.ok(s.calls.every(call=>!call.url.includes('/documents?')));
});

test('an unchanged metadata record can receive its first contents and safely retry',async()=>{
 const existing={project_id:project,source_id:library+':7',file_name:metadata.file_name,modified_at:metadata.modified_at,source_version:metadata.version};
 const s=await setup({existing});
 const first=await s.send({...metadata,content_base64:b64('Actual project scope')});
 assert.equal(first.body.status,'unchanged');assert.equal(first.body.content_status,'cached');
 assert.equal(s.getCache().source_id,library+':7');assert.equal(s.getCache().project_id,project);
 const again=await s.send({...metadata,content_base64:b64('Actual project scope')});
 assert.equal(again.body.content_status,'unchanged');assert.equal(s.objects.size,1);
 assert.equal(s.uploads[0],s.uploads[1]);
 assert.ok(s.calls.every(call=>!call.url.includes('/documents?')));
});

test('stale delivery never uploads and a metadata update during upload prevents linking stale bytes',async()=>{
 const existing={project_id:project,source_id:library+':7',file_name:metadata.file_name,modified_at:'2026-11-02T12:00:00Z',source_version:'4.0'};
 const stale=await setup({existing});const result=await stale.send({...metadata,content_base64:b64('Old scope')});
 assert.equal(result.body.content_status,'stale');assert.equal(stale.uploads.length,0);assert.equal(stale.getCache(),null);
 const raced=await setup({advanceDuringUpload:true});const race=await raced.send({...metadata,content_base64:b64('Old scope')});
 assert.equal(race.body.content_status,'stale');assert.equal(raced.getCache(),null);
 assert.equal(raced.calls.some(call=>call.method==='DELETE'),false);
});

test('content rejection retains metadata and transient storage failure requests retry',async()=>{
 const s=await setup();const invalid=await s.send({...metadata,content_base64:b64('Binary\0')});
 assert.equal(invalid.status,200);assert.equal(invalid.body.status,'added');assert.equal(invalid.body.content_status,'invalid');assert.equal(s.uploads.length,0);
 const broken=await setup({storageFailure:true}),result=await broken.send({...metadata,content_base64:b64('Scope')});
 assert.equal(result.status,503);assert.equal(result.body.status,'added');assert.equal(result.body.content_status,'error');
 assert.ok(broken.getRecord());assert.equal(broken.getCache(),null);assert.ok(!JSON.stringify(result).includes('test-service-placeholder'));
});

test('unauthorized or oversized requests do not register files or upload contents',async()=>{
 const denied=await setup({authorized:false});assert.equal((await denied.send({...metadata,content_base64:b64('Scope')})).status,401);
 assert.equal(denied.getRecord(),null);assert.equal(denied.uploads.length,0);
 const size=await setup();assert.equal((await size.send({...metadata,content_base64:'a'},{'content-length':'5000000'})).status,413);
 assert.equal(size.getRecord(),null);assert.equal(size.uploads.length,0);
});
