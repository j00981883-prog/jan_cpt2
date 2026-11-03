const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'..','JAN_CPT.html'),'utf8');
const source=html.slice(html.indexOf('function ExecutiveSummary('),html.indexOf('function Dashboard('));
const all=node=>Array.isArray(node)?node.flatMap(all):node&&typeof node==='object'?[node,...(node.children||[]).flatMap(all)]:[];
function setup(low=false){
  let state=false,focused=0;
  const navigated=[],buttonRef={current:{focus:()=>focused++}};
  const detail={label:'Reimbursements',kind:'amber',status:'No reimbursements requested',reason:'No request is recorded.',action:'Review whether a request is needed.',tab:'pay',actionLabel:'Review pay applications'};
  const riskDetails={kind:low?'green':'amber',level:low?'Low':'Moderate',summary:low?'No warning indicators.':'One category needs review.',rule:'Any red indicator makes the rating High; otherwise amber makes it Moderate.',attention:low?[]:[detail],checks:low?[{...detail,kind:'green',status:'Requests processed'}]:[]};
  const execSum={rows:[['Budget','green','On budget'],['Reimbursements',low?'green':'amber',low?'Requests processed':'No reimbursements requested'],['Risk Level',riskDetails.kind,riskDetails.level]]};
  const context={useState:()=>[state,next=>{state=typeof next==='function'?next(state):next;}],React:{useRef:()=>buttonRef,createElement:(tag,props,...children)=>({tag,props:props||{},children})}};
  vm.createContext(context);vm.runInContext(source,context);
  const render=()=>context.ExecutiveSummary({execSum,riskDetails,projectId:'p1',onNavigate:tab=>navigated.push(tab)});
  const toggle=tree=>all(tree).find(node=>node.tag==='button'&&String(node.props['aria-label']||'').startsWith('Risk Level:'));
  return{render,toggle,navigated,focused:()=>focused};
}
test('risk card is a native toggle that exposes an explanation without altering other summary cards',()=>{
  const env=setup(),before=env.render(),button=env.toggle(before);
  assert.equal(button.props.type,'button');assert.equal(button.props['aria-expanded'],false);
  assert.equal(all(before).some(node=>node.props.role==='region'),false);
  assert.equal(all(before).filter(node=>node.props.className?.startsWith('exec-cell rise')).length,3);
  button.props.onClick();const after=env.render(),panel=all(after).find(node=>node.props.role==='region');
  assert.equal(env.toggle(after).props['aria-expanded'],true);
  assert.equal(panel.props.id,button.props['aria-controls']);
  assert.equal(all(after).some(node=>node.children.includes('What needs attention')),true);
  assert.equal(all(after).some(node=>node.children.includes('Review whether a request is needed.')),true);
  env.toggle(after).props.onClick();assert.equal(all(env.render()).some(node=>node.props.role==='region'),false);
});
test('attention action opens the corresponding review tab; Escape and Close return focus to the risk card',()=>{
  const env=setup();env.toggle(env.render()).props.onClick();let tree=env.render();
  all(tree).find(node=>node.tag==='button'&&node.children.includes('Review pay applications')).props.onClick();
  assert.deepEqual(env.navigated,['pay']);
  let prevented=false;all(tree).find(node=>node.props.role==='region').props.onKeyDown({key:'Escape',preventDefault:()=>{prevented=true;},stopPropagation:()=>{}});
  assert.equal(prevented,true);assert.equal(env.focused(),1);assert.equal(env.toggle(env.render()).props['aria-expanded'],false);
  env.toggle(env.render()).props.onClick();tree=env.render();all(tree).find(node=>node.props['aria-label']==='Close risk explanation').props.onClick();
  assert.equal(env.focused(),2);assert.equal(env.toggle(env.render()).props['aria-expanded'],false);
});
test('Low risk explains the clear result and reveals the checks instead of inventing attention items',()=>{
  const env=setup(true);env.toggle(env.render()).props.onClick();const tree=env.render();
  assert.equal(all(tree).some(node=>node.children.includes('No flagged items')),true);
  assert.equal(all(tree).some(node=>node.props.className==='risk-attention-grid'),false);
  assert.equal(all(tree).find(node=>node.tag==='details').props.open,true);
  assert.equal(all(tree).some(node=>node.children.includes('Requests processed')),true);
});
