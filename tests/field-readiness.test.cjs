const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','JAN_CPT.html'),'utf8');
const field=html.slice(html.indexOf('function FieldProject('),html.indexOf('function FieldPhoto('));
const loadCode=field.slice(field.indexOf('  async function load()'),field.indexOf('  useEffect('));
const endCode=field.slice(field.indexOf('  async function endVisit()'),field.indexOf('  async function toggle('));
function env(failure=false){
 const calls=[],alerts=[];let visit={id:'my-visit'},ending=false,loadError='';
 const context={Date,profile:{id:'me'},projectId:'project',visit,ending,items:[],reports:[],tourStep:null,setTourStep:()=>{},setItems:()=>{},setReports:()=>{},setVisit:v=>{visit=v;},setEnding:v=>{ending=v;},setLoadError:v=>{loadError=v;},alert:v=>alerts.push(v),requestWithTimeout:async p=>p,sb:{from:table=>{
   const call={table,filters:[]};calls.push(call);const q={select(){return q;},eq(k,v){call.filters.push([k,v]);return q;},is(){return q;},order(){return q;},limit(){return q;},single(){return q;},update(value){call.update=value;return q;},then(resolve){return Promise.resolve({data:[],error:failure?{message:'Connection failed'}:null}).then(resolve);}};return q;}}};
 vm.createContext(context);vm.runInContext(loadCode+'\n'+endCode,context);
 return{context,calls,alerts,get:()=>({visit,ending,loadError})};
}
test('resumed walkthrough belongs to the current user and load errors are visible',async()=>{
 const e=env(true);await e.context.load();
 assert.ok(e.calls.find(c=>c.table==='field_visits').filters.some(([k,v])=>k==='walker_id'&&v==='me'));
 assert.equal(e.get().loadError,'Connection failed');
});
test('failed walkthrough finish keeps the active visit and releases Saving state',async()=>{
 const e=env(true);await e.context.endVisit();
 assert.equal(e.get().visit.id,'my-visit');assert.equal(e.get().ending,false);
 assert.match(e.alerts[0],/could not finish: Connection failed/);
 assert.ok(e.calls[0].filters.some(([k,v])=>k==='walker_id'&&v==='me'));
});
test('successful walkthrough finish clears the active visit and reloads project records',async()=>{
 const e=env();await e.context.endVisit();
 assert.equal(e.get().ending,false);assert.equal(e.get().visit,null);
 assert.ok(e.calls.some(c=>c.table==='field_checklist'));assert.deepEqual(e.alerts,[]);
});
