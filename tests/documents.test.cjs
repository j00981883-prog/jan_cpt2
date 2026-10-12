const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','JAN_CPT.html'),'utf8');
const src=html.slice(html.indexOf('// DOCUMENT_CONTROLS_START'),html.indexOf('// ============================================================================\n//  AI ASSISTANT'));
const rows=[
 {id:'a',label:'Runway plans',file_name:'plans-v1.pdf',category:'Drawings',revision_no:1,review_status:'approved',kind:'file',storage_path:'p/v1'},
 {id:'b',revision_parent_id:'a',label:'Runway plans',file_name:'plans-v2.pdf',category:'Drawings',revision_no:2,review_status:'draft',revision_note:'Added conduit',kind:'file',storage_path:'p/v2'},
 {id:'c',label:'Archive test',category:'Contract',review_status:'archived',revision_no:1},
 {id:'d',label:'Site photo',category:'Photos',review_status:'draft',revision_no:1,kind:'file',storage_path:'field/p/photo.jpg'}
];
function env(editor=true){
 let cursor=0,slots=[];
 const actions=[];
 const query={select(){return this;},eq(){return this;},in(){return this;},order(){return this;},single(){return this;},then(resolve){return Promise.resolve({data:rows,error:null}).then(resolve);},update(p){actions.push({type:'update',payload:p});return this;},insert(p){actions.push({type:'insert',payload:p});return this;}};
 const c={console,Date,Map,Set,crypto:require('node:crypto').webcrypto,window:{},confirm:()=>true,alert:()=>{},setTimeout:()=>{},requestWithTimeout:async p=>p,
 useEffect:()=>{},useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=init;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
 React:{createElement:(tag,props,...children)=>({tag,props:props||{},children}),useRef:()=>({current:null})},sb:{from:()=>query}};
 vm.createContext(c);vm.runInContext(src,c);
 const render=()=>{cursor=0;return c.Documents({projectId:'p',isEditor:editor,grant:{},setGrant:()=>{}});};
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...n.children.flatMap(all)]:[];
 const button=(tree,label)=>all(tree).find(n=>n.tag==='button'&&n.children.includes(label));
 return{c,render,all,button,actions};
}
test('latest draft preserves an older current approved revision',()=>{
 const{c}=env();const list=c.documentFamilies(rows);const plans=list.find(d=>d.id==='b');
 assert.equal(list.length,3);assert.equal(plans.approved.id,'a');assert.equal(plans.versions.length,2);
 assert.equal(c.filterDocumentFamilies(list,'','all','approved')[0].id,'b');
});
test('search finds prior filenames and revision notes, respects category and archive filters',()=>{
 const{c}=env();const list=c.documentFamilies(rows);
 assert.equal(c.filterDocumentFamilies(list,'plans-v1','all','all').length,1);
 assert.equal(c.filterDocumentFamilies(list,'conduit','Drawings','draft').length,1);
 assert.equal(c.filterDocumentFamilies(list,'conduit','Photos','all').length,0);
 assert.equal(c.filterDocumentFamilies(list,'','all','all').length,2);
 assert.equal(c.filterDocumentFamilies(list,'','all','archived')[0].id,'c');
});
test('editor gets controls, approved open link and archive; viewer gets read-only history',async()=>{
 for(const editor of[true,false]){
  const e=env(editor);await e.button(e.render(),'Refresh').props.onClick();const tree=e.render();
  assert.ok(e.button(tree,'Open approved'));
  assert.equal(!!e.button(tree,'Archive'),editor);
  assert.ok(e.button(tree,editor?'Controls / history':'History'));
  await e.button(tree,editor?'Controls / history':'History').props.onClick();
  const panel=e.render();assert.equal(!!e.button(panel,'Save controls'),editor);
  assert.equal(!!e.button(panel,'Save new revision'),editor);
 }
});
test('archive updates status of all revisions without deleting stored files',async()=>{
 const e=env();await e.button(e.render(),'Refresh').props.onClick();
 await e.button(e.render(),'Archive').props.onClick();
 assert.equal(e.actions[0].type,'update');assert.equal(e.actions[0].payload.review_status,'archived');
});
