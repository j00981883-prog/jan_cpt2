const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','JAN_CPT.html'),'utf8');
const src=html.slice(html.indexOf('// DOCUMENT_CONTROLS_START'),html.indexOf('// ============================================================================\n//  AI ASSISTANT'));
const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...n.children.flatMap(all)]:[];
function env({grant={},fail=false}={}){
 let cursor=0,slots=[],alerts=[],inserted=[];
 const query={select(){return this;},eq(){return this;},order(){return this;},insert(row){inserted.push(row);return this;},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};
 const c={console,Date,Map,Set,SharePointFolder:()=>null,crypto:require('node:crypto').webcrypto,window:{},alert:message=>alerts.push(message),setTimeout:()=>{},requestWithTimeout:async p=>{if(fail)throw Error('Request timed out');return p;},useEffect:()=>{},useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=init;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},React:{createElement:(tag,props,...children)=>({tag,props:props||{},children}),useRef:()=>({current:null})},sb:{from:()=>query}};
 vm.createContext(c);vm.runInContext(src,c);
 const render=()=>{cursor=0;return c.Documents({projectId:'p',isEditor:true,grant,setGrant:()=>{}});};
 return{render,alerts,inserted,button:(label)=>all(render()).find(n=>n.tag==='button'&&n.children.includes(label)),input:(placeholder)=>all(render()).find(n=>n.tag==='input'&&n.props.placeholder===placeholder)};
}
test('several grant documentation links render as separate usable URLs, including after blank rows',async()=>{
 const e=env({grant:{docs:{'Executed Grant':['https://example.com/a','','https://example.com/b'],'Board Memo':'https://example.com/c'}}});
 await e.button('Refresh').props.onClick();
 const links=all(e.render()).filter(n=>n.tag==='a'&&n.children.includes('Open')).map(n=>n.props.href);
 assert.deepEqual(links,['https://example.com/a','https://example.com/b','https://example.com/c']);
 assert.equal(all(e.render()).some(n=>n.children.includes('No documents yet.')),false);
});
test('document load failures leave a visible error and stop the loading indicator',async()=>{
 const e=env({fail:true});await e.button('Refresh').props.onClick();
 assert.ok(all(e.render()).some(n=>n.children.includes('Request timed out')));
 assert.equal(all(e.render()).some(n=>n.children.includes('Loading…')),false);
});
test('failed Add link releases the busy button and preserves the entered URL for retry',async()=>{
 const e=env({fail:true});
 const toggle=all(e.render()).find(n=>n.tag==='button'&&n.children.some(x=>typeof x==='string'&&/Add link/.test(x)));
 assert.ok(toggle);toggle.props.onClick();
 e.input('Document name').props.onChange({target:{value:'Meeting memo'}});
 e.input('https://...').props.onChange({target:{value:' https://example.com/memo '}});
 await e.button('Add').props.onClick();
 assert.equal(e.button('Add').props.disabled,false);
 assert.equal(e.input('https://...').props.value,' https://example.com/memo ');
 assert.match(e.alerts[0],/timed out/);
 assert.equal(e.inserted[0].url,'https://example.com/memo');
});
test('legacy removal targets one original link and keeps sibling links and other records',async()=>{
 let grant={docs:{'Executed Grant':['https://example.com/a','https://example.com/b'],'Board Memo':'https://example.com/c'}};
 const prompts=[];
 const context={busy:false,isEditor:true,confirm:message=>{prompts.push(message);return true;},setGrant:fn=>{grant=fn(grant);}};
 vm.createContext(context);
 vm.runInContext(src.slice(src.indexOf('  async function remove(d)'),src.indexOf('  async function restore(d)')),context);
 await context.remove({legacy:true,legacyName:'Executed Grant',legacyIndex:1,label:'Executed Grant (2)',url:'https://example.com/b'});
 assert.equal(grant.docs['Executed Grant'],'https://example.com/a');
 assert.equal(grant.docs['Board Memo'],'https://example.com/c');
 assert.equal(Object.hasOwn(grant.docs,'Executed Grant (2)'),false);
 assert.match(prompts[0],/original file is unaffected/);
 assert.doesNotMatch(prompts[0],/Archived filter/);
});
