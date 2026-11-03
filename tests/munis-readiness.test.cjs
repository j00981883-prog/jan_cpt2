const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','JAN_CPT.html'),'utf8');
const src=html.slice(html.indexOf('function munisPreviewRows('),html.indexOf('function Dashboard('));
const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...n.children.flatMap(all)]:[];
const text=n=>Array.isArray(n)?n.map(text).join(' '):n&&typeof n==='object'?text(n.children):typeof n==='string'||typeof n==='number'?String(n):'';
function env(result,projectId=null){
 let slots=[],cursor=0,effects=[],timer,cleanups=[],calls=[];
 const q={select(){return this;},contains(column,value){calls.push(['contains',column,value]);return this;},order(){return this;},limit(n){calls.push(['limit',n]);return this;},then(resolve,reject){return Promise.resolve(result).then(resolve,reject);}};
 const c={Date,JSON,Array,isNaN,fmtMoney:n=>'$'+n,useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=init;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useEffect:fn=>effects.push(fn),setInterval:fn=>{timer=fn;return 1;},clearInterval:()=>{},requestWithTimeout:async q=>q,sb:{from:()=>q},React:{createElement:(tag,props,...children)=>({tag,props:props||{},children})}};
 vm.createContext(c);vm.runInContext(src,c);
 const render=()=>{cursor=0;return c.MunisUpdateStatus({projectId});};
 return{c,calls,render,async load(){render();cleanups.push(effects.shift()());await new Promise(setImmediate);},async poll(next){result=next;await timer();},close(){cleanups.forEach(fn=>fn());}};
}
const run={id:'r',status:'preview',created_at:'2026-11-03T16:30:00Z',report_name:'test.csv',row_count:1,matched_count:1,preview:[{projectId:'p',budgetChanged:true,currentBudget:0,budget:50,title:'Runway'}]};
test('preview stays explicitly unapplied with collapsed report details and Central time',async()=>{
 const e=env({data:[run],error:null});await e.load();const tree=e.render();
 assert.match(text(tree),/Preview only/);assert.match(text(tree),/Project amounts have not changed/);assert.match(text(tree),/10:30 AM CT/);
 assert.equal(all(tree).find(n=>n.tag==='details').props.open,undefined);assert.match(text(tree),/\$0/);e.close();
});
test('project filtering occurs before limiting latest report and omits unrelated changes',async()=>{
 const e=env({data:[{...run,preview:[...run.preview,{projectId:'other',budgetChanged:true,title:'Other',budget:999}]}],error:null},'p');await e.load();
 assert.equal(e.calls[0][0],'contains');assert.equal(typeof e.calls[0][2],'string');assert.equal(JSON.parse(e.calls[0][2])[0].projectId,'p');assert.equal(e.calls[1][0],'limit');
 assert.doesNotMatch(text(e.render()),/Other|999/);e.close();
});
test('query errors show a retryable status rather than claiming there are no reports',async()=>{
 const e=env({data:null,error:{message:'network failed'}});await e.load();
 assert.match(text(e.render()),/Couldn't check MUNIS reports/);assert.equal(all(e.render()).find(n=>n.tag==='button').props.disabled,false);
 await e.poll({data:[run],error:null});assert.match(text(e.render()),/Preview only/);assert.doesNotMatch(text(e.render()),/Couldn't/);e.close();
});
test('malformed preview data and unknown status cannot crash or imply applied changes',async()=>{
 const e=env({data:[{...run,status:'unexpected',preview:'{"x":1}'}],error:null});await e.load();
 assert.match(text(e.render()),/Not applied/);assert.equal(e.c.munisPreviewRows({preview:'broken'}).length,0);e.close();
});
test('unmatched report does not claim a successful no-change sync',async()=>{
 const e=env({data:[{...run,matched_count:0,preview:[]}],error:null});await e.load();assert.match(text(e.render()),/No matching projects/);e.close();
});
