const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('walkthrough gallery reads project reports, supports scrolling and expands notes without writes',async()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../JAN_CPT.html'),'utf8');
 const source=html.slice(html.indexOf('function WalkthroughGallery('),html.indexOf('function LastWalkthrough('));
 let cursor=0,effects=[],slots=[],query=[],scroll;
 const rows=[{id:'r1',note:'Inspect roof',category:'Progress',created_at:'2026-10-21T15:00:00Z',photo_path:'field/p/photo.jpg',visit_id:'v1'},{id:'r2',note:'No photo note',created_at:'2026-10-20T15:00:00Z'}];
 const chain={select(){return this},eq(k,v){query.push([k,v]);return this},order(){return this},range:async(a,b)=>{query.push([a,b]);return{data:rows}}};
 const context={window:{matchMedia:()=>({matches:false})},sb:{from:t=>{assert.equal(t,'field_reports');return chain}},checklistCommentData:()=>null,FieldPhoto:'FieldPhoto',
 React:{useRef:()=>({current:{scrollBy:arg=>scroll=arg}}),createElement:(tag,props,...children)=>({tag,props:props||{},children})},
 useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=init;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]},
 useEffect:(fn,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old[j])){slots[i]=deps;effects.push(fn)}}};
 vm.createContext(context);vm.runInContext(source,context);
 const render=()=>{cursor=0;effects=[];const tree=context.WalkthroughGallery({projectId:'p'});effects.forEach(f=>f());return tree};
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...n.children.flatMap(all)]:[];
 render();await new Promise(resolve=>setImmediate(resolve));const tree=render(),nodes=all(tree);
 assert.ok(query.some(v=>v[0]==='project_id'&&v[1]==='p'));
 assert.equal(nodes.filter(n=>n.tag==='article').length,2);
 assert.equal(nodes.filter(n=>n.tag==='FieldPhoto')[0].props.path,'field/p/photo.jpg');
 assert.ok(nodes.some(n=>n.tag==='details'));
 nodes.find(n=>n.props['aria-label']==='Next field reports').props.onClick();assert.equal(scroll.left,300);
 assert.equal(nodes.find(n=>n.props.role==='region').props.tabIndex,0);
});
