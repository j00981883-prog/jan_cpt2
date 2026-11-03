const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const html=fs.readFileSync(require('node:path').join(__dirname,'../JAN_CPT.html'),'utf8');
const source=html.slice(html.indexOf('function CloudApp() {'),html.indexOf('function BootError('));
const deadline=html.slice(html.indexOf('function requestWithTimeout('),html.indexOf('const LOGO ='));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const session=id=>({user:{id,email:id+'@example.test'}});
function setup({sessions=[{data:{session:session('u1')}}],profiles={},loadProject=async()=>({meta:{title:'Test project'}})}={}){
 const slots=[],effects=new Map(),timers=new Map(),calls=[];let cursor=0,queued=[],timerId=0,listener,sessionCalls=0;
 const c={console,Promise,CONFIGURED:true,BOOT_ERROR:'',RECOVERY_URL_SEEN:false,sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  window:{addEventListener(){},removeEventListener(){}},setInterval:()=>1,clearInterval(){},setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
  useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next}]},
  useEffect:(fn,deps)=>{const i=cursor++,old=effects.get(i);if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j]))){effects.set(i,{deps,cleanup:old?.cleanup});queued.push(()=>{old?.cleanup?.();effects.get(i).cleanup=fn();});}},
  sb:{auth:{getSession:()=>{const result=sessions[sessionCalls++];return Promise.resolve(result);},onAuthStateChange:fn=>{listener=fn;return{data:{subscription:{unsubscribe(){if(listener===fn)listener=null;}}}};}},
   from:table=>{let id;return{select(){return this},eq(key,value){id=value;return this},single(){calls.push({table,id});return Promise.resolve(profiles[id]||{data:{id,role:'viewer',full_name:id}})}};}},
  React:{Fragment:'fragment',createElement:(tag,props,...children)=>({tag,props:props||{},children}),useRef:init=>{const i=cursor++;if(!(i in slots))slots[i]={current:init};return slots[i]}},
  AuthScreen:'AuthScreen',ProjectPicker:'ProjectPicker',Assistant:'Assistant',FieldHome:'FieldHome',Tracker:'Tracker',InternalProject:'InternalProject',ResetPasswordScreen:'ResetPasswordScreen',loadProject};
 vm.createContext(c);vm.runInContext(deadline+'\n'+source,c);
 function render(commit=true){cursor=0;queued=[];const tree=c.CloudApp();if(commit)queued.forEach(fn=>fn());return tree.tag===c.CloudLoadError?c.CloudLoadError(tree.props):tree;}
 return{render,calls,slots,emit:(event,value)=>listener(event,value),sessionCalls:()=>sessionCalls,
  expire:()=>{for(const [id,timer]of [...timers]){timers.delete(id);assert.equal(timer.ms,15000);timer.fn();}}};
}
const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...n.children.flatMap(all)]:[];
const text=n=>Array.isArray(n)?n.map(text).join(' '):n&&typeof n==='object'?n.children.map(text).join(' '):String(n??'');
const button=tree=>all(tree).find(n=>n.tag==='button'&&n.children.includes('Try again'));
async function ready(env){env.render();await flush();env.render();await flush();return env.render();}

test('a stalled session reaches a visible retry screen and retry recovers normal sign-in',async()=>{
 const stuck=deferred();const env=setup({sessions:[stuck.promise,{data:{session:session('u1')}}]});
 env.render();await flush();env.expire();await flush();let tree=env.render();
 assert.match(text(tree),/Sign-in could not be checked/);assert.match(text(tree),/timed out/);assert.ok(button(tree));
 button(tree).props.onClick();tree=await ready(env);
 assert.equal(env.sessionCalls(),2);assert.ok(all(tree).some(n=>n.tag==='ProjectPicker'&&n.props.profile.id==='u1'));
 stuck.resolve({data:{session:session('old')}});await flush();env.render();
 assert.equal(env.slots[0].user.id,'u1','A late result from the previous retry cannot change accounts');
});

test('returned and thrown session errors release loading without an unhandled rejection',async()=>{
 for(const makeResult of [()=>({data:{session:null},error:Error('Session unavailable')}),()=>Promise.reject(Error('Session unavailable'))]){
  const result=makeResult();if(result?.catch)result.catch(()=>{});
  const env=setup({sessions:[result]});env.render();await flush();const tree=env.render();
  assert.match(text(tree),/Session unavailable/);assert.ok(button(tree));
 }
});

test('a signed-in auth event wins over an older getSession response',async()=>{
 const old=deferred();const env=setup({sessions:[old.promise]});env.render();await flush();
 env.emit('SIGNED_IN',session('u2'));env.render();await flush();
 old.resolve({data:{session:session('u1')}});await flush();const tree=env.render();
 assert.equal(env.slots[0].user.id,'u2');assert.ok(all(tree).some(n=>n.tag==='ProjectPicker'&&n.props.profile.id==='u2'));
});

test('late profile results after sign-out or account change cannot restore the previous profile',async()=>{
 const old=deferred();const env=setup({profiles:{u1:old.promise}});env.render();await flush();env.render();await flush();
 env.emit('SIGNED_OUT',null);env.render();old.resolve({data:{id:'u1',role:'editor'}});await flush();
 assert.equal(env.render().tag,'AuthScreen');assert.equal(env.slots[2],null);
 const late=deferred();const switched=setup({profiles:{u1:late.promise}});switched.render();await flush();switched.render();await flush();
 switched.emit('SIGNED_IN',session('u2'));switched.render();await flush();late.resolve({data:{id:'u1',role:'editor'}});await flush();
 const tree=switched.render();assert.equal(switched.slots[2].id,'u2');assert.ok(all(tree).some(n=>n.tag==='ProjectPicker'&&n.props.profile.role==='viewer'));
});

test('profile read failure shows retry and never substitutes an incorrect viewer role',async()=>{
 const result=deferred(),profiles={u1:result.promise};const env=setup({profiles});env.render();await flush();env.render();await flush();
 result.resolve({data:null,error:Error('Profile connection failed')});await flush();let tree=env.render();
 assert.match(text(tree),/Account could not be loaded/);assert.equal(env.slots[2],null);assert.ok(button(tree));
 profiles.u1={data:{id:'u1',role:'editor'}};button(tree).props.onClick();env.render();await flush();tree=env.render();
 assert.ok(all(tree).some(n=>n.tag==='ProjectPicker'&&n.props.profile.role==='editor'));
});

test('token refresh keeps the current profile and open project mounted',async()=>{
 const env=setup();let tree=await ready(env);const picker=all(tree).find(n=>n.tag==='ProjectPicker');
 await picker.props.onOpen('p1');tree=env.render();const before=env.slots[2],calls=env.calls.length;
 assert.ok(all(tree).some(n=>n.tag==='Tracker'));
 env.emit('TOKEN_REFRESHED',{...session('u1'),access_token:'refreshed'});env.render();await flush();tree=env.render();
 assert.equal(env.slots[2],before);assert.equal(env.calls.length,calls);assert.ok(all(tree).some(n=>n.tag==='Tracker'&&n.props.projectId==='p1'));
});

test('sign-out/account change clears cached projects and ignores a late project response',async()=>{
 const pending=deferred();const env=setup({loadProject:()=>pending.promise});let tree=await ready(env);
 const opening=all(tree).find(n=>n.tag==='ProjectPicker').props.onOpen('private-old-project');env.render();
 env.emit('SIGNED_OUT',null);env.render();assert.equal(env.slots[3],null);assert.equal(env.slots[4],null);
 env.emit('SIGNED_IN',session('u2'));env.render();await flush();
 pending.resolve({meta:{title:'Previous account project'}});await opening;await flush();tree=env.render();
 assert.equal(env.slots[3],null);assert.equal(env.slots[4],null);assert.ok(all(tree).some(n=>n.tag==='ProjectPicker'&&n.props.profile.id==='u2'));
 assert.ok(!all(tree).some(n=>n.tag==='Tracker'));
});
