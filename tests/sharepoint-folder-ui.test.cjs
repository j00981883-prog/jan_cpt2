const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('folder button submits only project ID and viewers cannot request folders',async()=>{
 const file=fs.readFileSync(require('node:path').join(__dirname,'../grant-reminders.js'),'utf8');
 const source=file.slice(file.indexOf('function JanCptProjectFolder('),file.indexOf('function SharePointUploadStatus('));
 let slots=[],cursor=0,effects=[],requests=[];
 const chain={select(){return this},eq(){return this},maybeSingle:async()=>({data:null}),insert:async row=>{requests.push(row);return{error:null}}};
 const c={requestWithTimeout:async p=>p,sb:{from:t=>{assert.equal(t,'sharepoint_project_folders');return chain}},setInterval:()=>1,clearInterval:()=>{},React:{
 createElement:(tag,props,...children)=>({tag,props:props||{},children}),useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=init;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]},
 useEffect:(fn,deps)=>{const i=cursor++;if(!slots[i]){slots[i]=deps;effects.push(fn)}}}};
 vm.createContext(c);vm.runInContext(source,c);
 const render=editor=>{cursor=0;effects=[];const tree=c.JanCptProjectFolder({projectId:'p',isEditor:editor});effects.forEach(f=>f());return tree};
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...n.children.flatMap(all)]:[];
 render(true);await new Promise(r=>setImmediate(r));let tree=render(true);
 const create=all(tree).find(n=>n.tag==='button'&&n.children.includes('Create project folder in SharePoint'));assert.ok(create);
 assert.equal(all(render(false)).some(n=>n.tag==='button'&&n.children.includes('Create project folder in SharePoint')),false);
 await create.props.onClick();assert.deepEqual(JSON.parse(JSON.stringify(requests)),[{project_id:'p'}]);
 assert.ok(all(render(true)).some(n=>n.props.role==='status'));
});
