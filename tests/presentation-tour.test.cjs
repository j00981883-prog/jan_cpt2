const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const{test}=require('node:test');
test('presentation visits each intended screen and exits without writing records',async()=>{
 const slots=[],listeners=new Map(),events=[];let cursor=0,effects=[];
 const c={CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},
 window:{addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),dispatchEvent:event=>{events.push(event);listeners.get(event.type)?.(event);}},
 setTimeout:fn=>{fn();return 1;},clearTimeout:()=>{},requestWithTimeout:async p=>p,
 sb:{from:table=>{assert.equal(table,'projects');return{select:()=>({order:async()=>({data:[{id:'capital',title:'Threshold Lighting',meta:{}},{id:'internal',title:'Maintenance',meta:{projectCategory:'internal'}}]})})};}},
 React:{createElement:(tag,props,...children)=>({tag,props:props||{},children}),Fragment:'fragment',
 useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=init;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
 useEffect:(fn,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>d!==old.deps[j])){effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});}}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../presentation-tour.js'),'utf8'),c);
 const render=()=>{cursor=0;effects=[];const tree=c.PresentationTour();effects.forEach(fn=>fn());return tree;};
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...n.children.flatMap(all)]:[];
 assert.equal(render(),null);await listeners.get('jan-presentation-start')();
 let tree=render();
 for(let i=0;i<10;i++){all(tree).find(n=>n.tag==='button'&&n.children.includes('Next →')).props.onClick();tree=render();}
 const nav=events.filter(e=>e.type==='jan-presentation-nav');
 assert.deepEqual(nav.map(e=>e.detail.view),['portfolio','display','project','project','project','project','project','portfolio','field','project','portfolio']);
 assert.deepEqual(nav.filter(e=>e.detail.view==='project').map(e=>e.detail.tab),['dashboard','log','grant','pay','docs','dashboard']);
 assert.equal(nav.find(e=>e.detail.view==='field').detail.active,true);
 all(tree).find(n=>n.tag==='button'&&n.children.includes('Finish tour')).props.onClick();assert.equal(render(),null);
 assert.equal(events.filter(e=>e.type==='jan-presentation-nav').at(-1).detail.active,false);
});
