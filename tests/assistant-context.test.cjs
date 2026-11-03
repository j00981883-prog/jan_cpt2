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
 const p={id:'p1',title:'Test',meta:{totalBudget:100,lengthWeeks:10},sched:{days:70},grant_info:{sections:[{id:'g',name:'Custom',type:'Custom',items:['A','B'],done:{A:true,Unrelated:true},completionDates:{A:'2026-10-20'}}]}};
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
test('AI preserves recorded zero and labels absent financial values unknown',async()=>{
 const {projectEvidence}=await ready;
 const unknown=projectEvidence({id:'p',title:'Missing'},[],[],[],[],'2026-11-03');
 for(const key of ['budget','reportedSpend','recordedFunding','paidAfterRetainage','recordedReimbursement','carrying'])assert.equal(unknown.calculations[key],null,key);
 const zero=projectEvidence({id:'p',meta:{totalBudget:0,primeBudget:99,funding:[{amount:0}]},sched:{days:7}},[{project_id:'p',week_no:1,spend:0,days_lost:0}],[],[],[],'2026-11-03');
 assert.equal(zero.calculations.budget,0);assert.equal(zero.calculations.reportedSpend,0);assert.equal(zero.calculations.recordedFunding,0);
 assert.equal(zero.calculations.reportedDaysLost,0);
});
test('AI calendar variance matches Tracker days rather than rounded or stale lengthWeeks',async()=>{
 const {projectEvidence}=await ready;
 const p={id:'p',meta:{totalBudget:700,lengthWeeks:9},sched:{days:10}};
 const facts=projectEvidence(p,[{project_id:'p',week_no:1,spend:490,days_lost:0},{project_id:'p',week_no:2,spend:null},{project_id:'p',week_no:3,spend:100}],[],[],[],'2026-11-03');
 assert.equal(facts.calculations.costVariance,0);assert.equal(facts.calculations.reportedSpend,490);
 assert.equal(facts.calculations.loggedSpendRows,1);assert.equal(facts.calculations.scheduleWeeks,2);
 assert.ok(facts.warnings.some(w=>w.includes('beyond the displayed schedule')));
});
test('AI only counts received reimbursements and identifies dashboard estimates',async()=>{
 const {projectEvidence}=await ready;
 const p={id:'p',meta:{funding:[{source:'FAA',amount:80},{source:'Local',amount:20}],reimbursableSources:['FAA']}};
 const a={project_id:'p',paid:'2026-11-01',work_completed:100,retainage_pct:0,reimb_amount:90,reimb_received:null};
 const pending=projectEvidence(p,[],[a],[],[],'2026-11-03');
 assert.equal(pending.calculations.recordedReimbursement,0);assert.equal(pending.calculations.carrying,100);
 const estimated=projectEvidence(p,[],[{...a,reimb_received:'2026-11-02',reimb_amount:null}],[],[],'2026-11-03');
 assert.equal(estimated.calculations.recordedReimbursement,null);assert.equal(estimated.calculations.displayedReimbursement,80);
 assert.equal(estimated.calculations.carrying,20);assert.equal(estimated.calculations.reimbursementUsesEstimate,true);
 assert.ok(estimated.warnings.some(w=>w.includes('estimate, not a recorded receipt amount')));
 const zero=projectEvidence(p,[],[{...a,reimb_received:'2026-11-02',reimb_amount:0}],[],[],'2026-11-03');
 assert.equal(zero.calculations.displayedReimbursement,0);assert.equal(zero.calculations.reimbursementUsesEstimate,false);
});
test('large evidence remains valid JSON and retains warnings and calculations',async()=>{
 const {evidenceBriefing}=await ready;
 const long='x'.repeat(4000);
 const project={id:'p',title:'Large',meta:{notes:long},grant_info:{sections:Array.from({length:30},(_,i)=>({id:String(i),name:long,type:'Custom',items:Array.from({length:100},(_,j)=>long+j),done:{}}))}};
 const result=evidenceBriefing([project],[],[],Array.from({length:100},(_,i)=>({project_id:'p',id:String(i),label:long})),[],'p','2026-11-03');
 const block=result.text.split('[SOURCE project:p]\n')[1].trim();
 const facts=JSON.parse(block);
 assert.ok(block.length<18000);assert.equal(facts.calculations.budget,null);
 assert.ok(facts.warnings.some(w=>w.includes('budget is unknown')));
 assert.ok(facts.warnings.some(w=>w.includes('no file or URL')));
 assert.ok(facts.contextLimits.length);assert.equal(facts.grantSections[0].total,100);
});
test('legacy grant links remain discoverable metadata and MUNIS identifiers survive compact summaries',async()=>{
 const {projectEvidence,evidenceBriefing}=await ready;
 const p={id:'p',title:'Test',meta:{munisProjectNo:'008-23',notes:'x'.repeat(2000)},grant_info:{docs:{'Executed grant':['https://example.com/grant.pdf','https://example.com/amendment.pdf'],Invalid:'javascript:alert(1)'}}};
 const facts=projectEvidence(p,[],[],[],[],'2026-11-03');
 assert.equal(facts.legacyDocumentIndex.length,2);assert.equal(facts.recordCounts.legacyDocuments,2);
 assert.equal(facts.legacyDocumentIndex[1].name,'Executed grant (2)');
 assert.equal(facts.legacyDocumentIndex[0].url,'https://example.com/grant.pdf');
 assert.equal(facts.legacyDocumentIndex[0].readableInApp,false);assert.equal(facts.legacyDocumentIndex[0].contentAvailable,false);
 const result=evidenceBriefing([p],[],[],[],[],'p','2026-11-03');
 assert.equal(JSON.parse(result.text.split('[SOURCE project:p]\n')[1]).meta.munisProjectNo,'008-23');
});
test('pathological escaped metadata cannot exceed the per-project JSON budget',async()=>{
 const {evidenceBriefing}=await ready;
 const long='\u0000'.repeat(4000);
 const p={id:'p',title:long,meta:Object.fromEntries(['projectNo','munisProjectNo','aipNo','projectCategory','totalBudget','primeBudget','engineeringBudget','fiscalYear','fy'].map(key=>[key,long])),grant_info:{sections:Array.from({length:100},(_,i)=>({id:long,name:long,grantNo:long,type:'Custom',items:[long],done:{}}))}};
 const result=evidenceBriefing([p],[],[],[],[],'p','2026-11-03');
 const block=result.text.split('[SOURCE project:p]\n')[1].trim();
 assert.ok(block.length<18000);assert.ok(JSON.parse(block).warnings.length);
});
