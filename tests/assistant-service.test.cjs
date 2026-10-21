const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const {test}=require('node:test');
const source=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/assistant/index.ts'),'utf8').replace(/^import .*;\r?\n/gm,'');
const script=stripTypeScriptTypes(source);
async function setup({signedIn=true,role='editor',brokenTable=false,providerStatus=200}={}){
 const {evidenceBriefing}=await import('../supabase/functions/assistant/context.mjs');
 let handler;const calls=[],downloads=[],secrets=[];
 const tables={projects:[{id:'p1',title:'Test project',meta:{totalBudget:100},sched:{},grant_info:{}}],weekly_actuals:[],pay_apps:[],
 documents:[{id:'d1',project_id:'p1',label:'Scope',file_name:'Scope.txt',storage_path:'p1/scope.txt',size_bytes:20,review_status:'draft'}],sharepoint_documents:[]};
 const client={auth:{getUser:async()=>signedIn?{data:{user:{id:'u1'}}}:{data:{},error:Error('No session')}},from(table){
  const result={select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},single:async()=>({data:{role}}),
  then(resolve){return Promise.resolve(brokenTable?{error:Error('Unavailable')}:{data:tables[table]||[]}).then(resolve);}};return result;
 },storage:{from:()=>({download:async path=>{downloads.push(path);return{data:new Blob(['Scope says paint two rooms.'])};}})}};
 const c={Request,Response,Blob,Date,JSON,Number,String,Uint8Array,btoa,AbortSignal,evidenceBriefing,console:{error(){}},
 createClient:()=>client,Deno:{env:{get:name=>{secrets.push(name);return name==='ANTHROPIC_API_KEY'?'test-placeholder':'https://test.invalid';}},serve:fn=>{handler=fn;}},
 fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return new Response(JSON.stringify({content:[{type:'text',text:'Reviewed supplied evidence.'}]}),{status:providerStatus});}};
 vm.runInNewContext(script,c);
 return{calls,downloads,secrets,send:async body=>{const response=await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer test-session','content-type':'application/json'},body:JSON.stringify(body)}));return{status:response.status,body:await response.json()};}};
}
test('AI service rejects signed-out and non-editor edit requests before AI calls',async()=>{
 const a=await setup({signedIn:false});assert.equal((await a.send({question:'Hello'})).status,401);assert.equal(a.calls.length,0);
 const b=await setup({role:'viewer'});assert.equal((await b.send({question:'Change budget',mode:'update'})).status,403);assert.equal(b.calls.length,0);
});
test('selected project file is read through caller storage access and supplied as evidence',async()=>{
 const s=await setup();const r=await s.send({question:'Summarize the scope',mode:'ask',targetProject:{id:'p1'},documentId:'d1'});
 assert.equal(r.status,200);assert.deepEqual(s.downloads,['p1/scope.txt']);
 assert.match(s.calls[0].messages[0].content,/paint two rooms/);
 assert.ok(r.body.sources.some(x=>x.kind==='document contents'&&x.name==='Scope.txt'));
 assert.ok(!s.secrets.includes('SUPABASE_SERVICE_ROLE_KEY'));
});
test('missing files and incomplete record queries do not produce guessed AI answers',async()=>{
 const s=await setup();assert.equal((await s.send({question:'Read it',documentId:'not-on-file'})).status,400);assert.equal(s.calls.length,0);
 const broken=await setup({brokenTable:true});assert.equal((await broken.send({question:'What is the budget?'})).status,503);assert.equal(broken.calls.length,0);
});
test('invalid provider credentials produce an actionable error without echoing secrets',async()=>{
 const s=await setup({providerStatus:401});const r=await s.send({question:'Hello'});
 assert.equal(r.status,502);assert.equal(r.body.code,'AI_KEY_INVALID');assert.match(r.body.error,/ANTHROPIC_API_KEY/);
 assert.ok(!r.body.error.includes('test-placeholder'));
});
