const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const{test}=require('node:test');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','grant-reminders.js'),'utf8');
const context=vm.createContext({Date,Intl});vm.runInContext(source,context);
test('grant periods use Central time and Monday weeks, including year boundaries',()=>{
 const a=context.grantReminderPeriods(new Date('2026-10-13T02:00:00Z'));
 assert.equal(a.daily,'2026-10-12');assert.equal(a.weekly,'2026-10-12');
 const b=context.grantReminderPeriods(new Date('2027-01-01T18:00:00Z'));
 assert.equal(b.daily,'2027-01-01');assert.equal(b.weekly,'2026-12-28');
 const c=context.grantReminderPeriods(new Date('2026-11-01T07:30:00Z'));
 assert.equal(c.daily,'2026-11-01');assert.equal(c.weekly,'2026-10-26');
});
test('completed daily check-in stays completed while weekly check-in remains due',async()=>{
 let slots=[],cursor=0,effects=[],calls=[];
 const periods=context.grantReminderPeriods();
 const query={select(){return this;},eq(){return this;},in(){return this;},single(){return this;},upsert(row){calls.push(row);return this;},then(resolve){return Promise.resolve({data:calls.length?{completed_at:'2026-10-12T15:00:00Z'}:[{cadence:'daily',period_start:periods.daily,completed_at:'2026-10-12T14:00:00Z'}],error:null}).then(resolve);}};
 const c=vm.createContext({Date,Intl,setInterval:()=>1,clearInterval:()=>{},requestWithTimeout:async p=>p,sb:{from:()=>query},React:{
  useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
  useEffect:fn=>effects.push(fn),createElement:(tag,props,...children)=>({tag,props:props||{},children})}});
 vm.runInContext(source,c);
 const render=()=>{cursor=0;return c.GrantReminders({profile:{id:'joyce',grant_daily_reminder:true,grant_weekly_reminder:true},projects:[],onOpen:()=>{}});};
 render();effects.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...n.children.flatMap(all)]:[];
 let nodes=all(render());assert.ok(nodes.find(n=>n.tag==='span'&&n.children[0]==='✓ Completed'));
 nodes.find(n=>n.tag==='textarea').props.onChange({target:{value:'Waiting on FAA review.'}});
 nodes.find(n=>n.tag==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
 await all(render()).find(n=>n.tag==='button'&&n.children[0]==='Send check-in / memo').props.onClick();
 assert.equal(calls[0].user_id,'joyce');assert.equal(calls[0].cadence,'weekly');assert.equal(calls[0].period_start,periods.weekly);
 assert.equal(calls[0].note,'Waiting on FAA review.');assert.equal(calls[0].no_updates,true);
 assert.equal(all(render()).filter(n=>n.tag==='span'&&n.children[0]==='✓ Completed').length,2);
});

test('failed grant reminder loading offers retry, recovers check-ins, and preserves the memo',async()=>{
 let slots=[],cursor=0,effectCursor=0,queued=[],requests=0;const effects=[];
 const query={select(){return this;},eq(){return this;},in(){return this;},then(resolve){requests++;return Promise.resolve(requests===1?{error:Error('Network unavailable')}:{data:[],error:null}).then(resolve);}};
 const c=vm.createContext({Date,Intl,setInterval:()=>1,clearInterval:()=>{},requestWithTimeout:async p=>p,sb:{from:()=>query},React:{
  useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
  useEffect:(fn,deps)=>{const i=effectCursor++,old=effects[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j]))){effects[i]={deps};queued.push(()=>{old?.cleanup?.();effects[i].cleanup=fn();});}},
  createElement:(tag,props,...children)=>({tag,props:props||{},children})}});
 vm.runInContext(source,c);
 const render=()=>{cursor=0;effectCursor=0;queued=[];const tree=c.GrantReminders({profile:{id:'joyce',grant_daily_reminder:true,grant_weekly_reminder:true},projects:[],onOpen:()=>{}});queued.forEach(fn=>fn());return tree;};
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...n.children.flatMap(all)]:[];
 render();await new Promise(resolve=>setImmediate(resolve));let nodes=all(render());
 assert.ok(nodes.some(n=>n.children.includes('Unavailable')));assert.ok(!nodes.some(n=>n.children.includes('Loading…')));
 assert.ok(nodes.filter(n=>n.tag==='button'&&n.children.includes('Send check-in / memo')).every(n=>n.props.disabled));
 nodes.find(n=>n.tag==='textarea').props.onChange({target:{value:'Pending FAA response.'}});
 nodes.find(n=>n.tag==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
 nodes.find(n=>n.tag==='button'&&n.children.includes('Retry reminders')).props.onClick();render();
 await new Promise(resolve=>setImmediate(resolve));nodes=all(render());
 assert.equal(requests,2);assert.ok(nodes.some(n=>n.children.includes('2 pending')));
 assert.ok(nodes.filter(n=>n.tag==='button'&&n.children.includes('Send check-in / memo')).every(n=>!n.props.disabled));
 assert.equal(nodes.find(n=>n.tag==='textarea').props.value,'Pending FAA response.');
 assert.equal(nodes.find(n=>n.tag==='input'&&n.props.type==='checkbox').props.checked,true);
 assert.ok(!nodes.some(n=>n.props.role==='alert'));
});
