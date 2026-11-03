const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','JAN_CPT.html'),'utf8');
const cloud=html.slice(html.indexOf('window.JMAA_CLOUD = {'),html.indexOf('// ---------------------------------------------------------------------------\n//  SIGN IN'));
function cloudEnv(failTable,failAction){
 const calls=[];
 const sb={from(table){let action='select';const q={select(){return q;},single(){return q;},eq(){return q;},not(){return q;},update(){action='update';return q;},upsert(){action='upsert';return q;},delete(){action='delete';return q;},then(resolve){calls.push({table,action});return Promise.resolve({data:table==='projects'?{id:'p',meta:{title:'Project'},grant_info:{docs:{}}}:[],error:table===failTable&&action===failAction?{message:'Network unavailable'}:null}).then(resolve);}};return q;}};
 const c={window:{},sb,requestWithTimeout:async p=>p,console};vm.createContext(c);vm.runInContext(cloud,c);
 return{c,calls};
}
test('project loading rejects failed financial queries rather than returning an empty snapshot',async()=>{
 for(const table of ['projects','weekly_actuals','pay_apps']){
  const {c}=cloudEnv(table,'select');await assert.rejects(c.loadProject('p'),/Network unavailable/);
 }
 const {c}=cloudEnv();const p=await c.loadProject('p');assert.equal(p.meta.title,'Project');assert.equal(p.payApps.length,0);
});
test('save reports failed removals and stops later financial writes',async()=>{
 for(const table of ['weekly_actuals','pay_apps']){
  const {c,calls}=cloudEnv(table,'delete');
  const result=await c.window.JMAA_CLOUD.saveProject('p',{actuals:{},grant:{},payApps:[],sched:{},meta:{title:'Project'}});
  assert.equal(result.ok,false);assert.match(result.error,/Network unavailable/);
  if(table==='weekly_actuals')assert.equal(calls.some(x=>x.table==='pay_apps'),false);
 }
});
test('no financial rows are removed when a replacement pay application fails',async()=>{
 const {c,calls}=cloudEnv('pay_apps','upsert');
 const result=await c.window.JMAA_CLOUD.saveProject('p',{actuals:{},grant:{},payApps:[{number:1}],sched:{},meta:{title:'Project'}});
 assert.equal(result.ok,false);assert.equal(calls.some(x=>x.action==='delete'),false);
});
test('a recorded zero reimbursement remains zero; a blank amount uses the expected share',()=>{
 const c={useMemo:fn=>fn(),meta:{},DEFAULT_RETAINAGE:0.05,reimbShare:()=>0.9,Date,
  parseISO:s=>new Date(s+'T12:00:00'),daysBetween:(a,b)=>Math.round((b-a)/86400000),payApps:[{number:1,workCompleted:1000,retainagePct:0,paid:'2026-10-01',reimbReceived:'2026-10-03',reimbAmount:0}]};
 vm.createContext(c);vm.runInContext('function calculate(){'+html.slice(html.indexOf('  const pay = useMemo('),html.indexOf('  /* executive summary'))+'return pay;}',c);
 assert.equal(c.calculate().cumReimb,0);assert.equal(c.calculate().exposure,1000);
 c.payApps[0].reimbAmount='';assert.equal(c.calculate().cumReimb,900);
});
test('grant execution recognizes current and legacy checklist labels',()=>{
 const c={expandItems:items=>items};vm.createContext(c);
 const start=html.indexOf('    const sectionIsExecuted = sec =>');
 vm.runInContext(html.slice(start,html.indexOf('    const grantsExecuted',start))+'globalThis.executed=sectionIsExecuted;',c);
 for(const label of ['Executed Grant Agreement','Grant Executed']){
  assert.equal(c.executed({items:[label,'Closeout'],done:{[label]:true}}),true);
  assert.equal(c.executed({items:[label,'Closeout'],done:{Closeout:true}}),false);
 }
});
test('budget edits immediately update the scheduled weekly projection',()=>{
 let cached,deps;
 const c={sched:{startISO:'2026-11-01',days:21,fyStartMonth:10},meta:{totalBudget:300},
  useMemo(fn,next){if(!deps||next.some((v,i)=>v!==deps[i])){cached=fn();deps=next;}return cached;},
  parseISO:s=>new Date(s+'T12:00:00'),addDays:(d,n)=>new Date(d.getTime()+n*86400000),fmtDateShort:d=>d.toISOString().slice(0,10),fyTag:()=>'',daysBetween:(a,b)=>Math.round((b-a)/86400000)};
 vm.createContext(c);
 const source=html.slice(html.indexOf('  const cal = useMemo('),html.indexOf('  // Data arrives already loaded'));
 vm.runInContext('function calendar(){'+source+'return cal;}',c);
 assert.equal(c.calendar().weeklyProjection,100);
 c.meta={totalBudget:600};assert.equal(c.calendar().weeklyProjection,200);assert.equal(c.calendar().nWeeks,3);
});
test('animated figures show real amounts immediately and finish subsequent changes',()=>{
 let slots=[],cursor=0,effects=[],frame;
 const c={window:{matchMedia:()=>({matches:false})},performance:{now:()=>0},
  useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=init;return[slots[i],v=>slots[i]=v];},
  useEffect:fn=>effects.push(fn),requestAnimationFrame:fn=>{frame=fn;return 1;},cancelAnimationFrame:()=>{},
  React:{useRef:init=>{const i=cursor++;if(!(i in slots))slots[i]={current:init};return slots[i];},createElement:(tag,props,...children)=>({children})}};
 vm.createContext(c);vm.runInContext(html.slice(html.indexOf('function CountUp('),html.indexOf('const Field =')),c);
 const render=value=>{cursor=0;return c.CountUp({value});};
 assert.equal(render(192216).children[0],192216);effects.pop()();frame(700);
 render(200000);effects.pop()();frame(700);assert.equal(render(200000).children[0],200000);
});
function queueEnv(save){
 const timers=new Map(),statuses=[];let seq=0;
 const c={setTimeout:fn=>{const id=++seq;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),requestWithTimeout:async p=>p};
 vm.createContext(c);vm.runInContext(html.slice(html.indexOf('function createProjectSaveQueue('),html.indexOf('function Tracker(')),c);
 return {q:c.createProjectSaveQueue(save,s=>statuses.push(s)),timers,statuses};
}
test('back flushes the latest edit without waiting for debounce',async()=>{
 const writes=[],{q,timers}=queueEnv(async data=>{writes.push(data);return{ok:true};});
 q.schedule({value:1});q.schedule({value:2});assert.equal(q.hasPending(),true);
 await q.flush();assert.equal(writes.length,1);assert.equal(writes[0].value,2);assert.equal(q.hasPending(),false);assert.equal(timers.size,0);
});
test('edits during an in-flight save are serialized and back waits for both',async()=>{
 const writes=[],releases=[];const {q}=queueEnv(data=>{writes.push(data.value);return new Promise(resolve=>releases.push(resolve));});
 q.schedule({value:1});const first=q.flush();await new Promise(resolve=>setImmediate(resolve));
 q.schedule({value:2});let finished=false;const back=q.flush().then(()=>finished=true);
 assert.deepEqual(writes,[1]);assert.equal(finished,false);releases.shift()({ok:true});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(writes,[1,2]);assert.equal(finished,false);releases.shift()({ok:true});await Promise.all([first,back]);
 assert.equal(finished,true);assert.equal(q.hasPending(),false);
});
test('failed save retains the latest snapshot for a visible retry',async()=>{
 let attempts=0;const {q,statuses}=queueEnv(async()=>++attempts===1?{ok:false,error:'Offline'}:{ok:true});
 q.schedule({value:1});await assert.rejects(q.flush(),/Offline/);assert.equal(q.hasPending(),true);
 assert.ok(statuses.some(s=>s==='Save failed — Offline'));await q.flush();assert.equal(q.hasPending(),false);
});
test('back keeps the project open on a save failure',async()=>{
 let wentBack=false;const c={leavingProject:false,isEditor:true,setLeavingProject:v=>c.leavingProject=v,onBack:()=>wentBack=true,saveQueue:{current:{flush:async()=>{throw Error('Offline');}}}};
 vm.createContext(c);const start=html.indexOf('  async function leaveProject()');
 vm.runInContext(html.slice(start,html.indexOf('  async function retrySave()',start)),c);
 await c.leaveProject();assert.equal(wentBack,false);assert.equal(c.leavingProject,false);
 c.saveQueue.current.flush=async()=>{};await c.leaveProject();assert.equal(wentBack,true);
});
