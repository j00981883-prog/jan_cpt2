const {test}=require('node:test');
const assert=require('node:assert/strict');
const ready=import('../supabase/functions/assistant/context.mjs');
test('AI evidence uses full FAA milestones, funding gaps and missing-progress warnings',async()=>{
 const {projectEvidence,grantSections}=await ready;
 const p={id:'p1',title:'Lights',meta:{totalBudget:100,funding:[{source:'FAA',amount:75}]},sched:{startISO:'2026-09-01',days:10},grant_info:{milestones:{'Application Submitted':true}}};
 const facts=projectEvidence(p,[],[],[{project_id:'p1',label:'Unattached plan'}],[],'2026-10-21');
 assert.equal(facts.grantSections[0].total,35);
 // Frontend currently preserves legacy flat maps as-is. Do not invent extra completed items.
 assert.equal(grantSections(p.grant_info)[0].items.length,35);
 assert.equal(facts.calculations.costVariance,null);
 assert.ok(facts.warnings.some(w=>w.includes('No weekly actuals')));
 assert.ok(facts.warnings.some(w=>w.includes('$25.00')));
 assert.ok(facts.warnings.some(w=>w.includes('completion date has passed')));
 assert.ok(facts.warnings.some(w=>w.includes('no file or URL')));
 assert.match(facts.sharepoint.contentAccess,/No Microsoft file contents/);
});
test('AI evidence counts named sections accurately and aligns variance to logged rows',async()=>{
 const {projectEvidence}=await ready;
 const p={id:'p1',title:'Test',meta:{totalBudget:100,lengthWeeks:10},grant_info:{sections:[{id:'g',name:'Custom',type:'Custom',items:['A','B'],done:{A:true,Unrelated:true},completionDates:{A:'2026-10-20'}}]}};
 const facts=projectEvidence(p,[{project_id:'p1',week_no:1,spend:10},{project_id:'p1',week_no:5,spend:10}],[],[],[],'2026-10-21');
 assert.equal(facts.grantSections[0].completed,1);assert.equal(facts.grantSections[0].total,2);
 assert.equal(facts.grantSections[0].items[0].date,'2026-10-20');
 assert.equal(facts.calculations.costVariance,0);
});
test('open-project evidence is first and file metadata never claims contents were read',async()=>{
 const {evidenceBriefing}=await ready;
 const p=[{id:'a',title:'One'},{id:'b',title:'Two',sharepoint_folder_url:'https://example.sharepoint.com/folder'}];
 const result=evidenceBriefing(p,[],[],[],[{project_id:'b',file_name:'Contract.pdf',modified_at:'2026-10-01'}],'b','2026-10-21');
 assert.equal(result.sources[0].id,'project:b');
 assert.ok(result.text.includes('Contract.pdf'));assert.ok(result.text.includes('No Microsoft file contents'));
 assert.ok(result.text.indexOf('[SOURCE project:b]')<result.text.indexOf('[SOURCE project:a]'));
});
