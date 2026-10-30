const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','JAN_CPT.html'),'utf8');
const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...n.children.flatMap(all)]:[];
function setup(editor=true){
 let grant={docs:{Letter:'https://example.com/first'},sections:[{id:'a',name:'FAA AIP',grantNo:'001',done:{Submitted:true},completionDates:{Submitted:'2026-10-01'}},{id:'b',name:'FAA AIG',grantNo:'002'}]};
 const c={React:{createElement:(tag,props,...children)=>({tag,props:props||{},children})},grantSections:g=>g.sections};
 vm.createContext(c);vm.runInContext(html.slice(html.indexOf('function GrantNumberEditor('),html.indexOf('function GrantTab(')),c);
 const setGrant=next=>{grant=typeof next==='function'?next(grant):next;};
 return {c,get:()=>grant,render:()=>c.GrantNumberEditor({grant,setGrant,isEditor:editor}),setGrant};
}
test('dashboard grant editing preserves other grants, checklist dates and document links',()=>{
 const e=setup();all(e.render()).find(n=>n.tag==='input').props.onChange({target:{value:'3-28-0037-054-2026'}});
 assert.equal(e.get().sections[0].grantNo,'3-28-0037-054-2026');
 assert.equal(e.get().sections[1].grantNo,'002');
 assert.equal(e.get().sections[0].completionDates.Submitted,'2026-10-01');
 assert.equal(e.get().docs.Letter,'https://example.com/first');
});
test('viewers can read grant numbers but cannot edit them',()=>{
 const e=setup(false),input=all(e.render()).find(n=>n.tag==='input');
 assert.equal(input.props.readOnly,true);input.props.onChange({target:{value:'changed'}});
 assert.equal(e.get().sections[0].grantNo,'001');
});
test('documentation supports adding, filling and removing several link rows',()=>{
 let grant={docs:{Letter:'https://example.com/first'},sections:[]};
 const src=html.slice(html.indexOf('  // A document record may hold one link'),html.indexOf('  const cos = grant.changeOrders'));
 const c={grant,set:patch=>{grant={...grant,...patch};c.grant=grant;}};
 vm.createContext(c);vm.runInContext(src+'\nglobalThis.add=addDoc;globalThis.change=setDocAt;globalThis.remove=removeDocAt;globalThis.links=docLinks;',c);
 c.add('Letter');assert.deepEqual(Array.from(c.links(grant,'Letter')),['https://example.com/first','']);
 c.change('Letter',1,'https://example.com/second');c.add('Letter');c.change('Letter',2,'https://example.com/third');
 c.remove('Letter',1);assert.deepEqual(Array.from(c.links(grant,'Letter')),['https://example.com/first','https://example.com/third']);
 c.remove('Letter',1);assert.equal(grant.docs.Letter,'https://example.com/first');
});
