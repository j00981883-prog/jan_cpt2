const GRANT_MILESTONES = [
  "Pre-Application for Federal Assistance Submitted",
  "FAA Funding Consideration Letter Received (\u201cGo Letter\u201d)",
  "Submit Signed Engineering Agreement to FAA",
  "Submit Environmental Determination to FAA",
  "Submit 90% Engineer\u2019s Report, Plans, and Specifications, and safety plan (CSPP) to FAA",
  "Engineer\u2019s Report, Plans, and Specification, and safety plan (CSPP), approved by FAA",
  "JMAA Board Approval to Advertise for Bids, approve project budget, and award the project to the lowest and best bidder after receipt of the bids",
  "Advertise for Bids",
  "Pre-Bid Conference",
  "Bid Opening",
  "Application for Federal Assistance Submitted",
  "Sponsor Certification and Lobbying Certification Submitted",
  "Grant Award Received",
  "Grant Award Accepted by the JMAA Board & City of Jackson",
  "Executed Grant Agreement",
  "Contract Executed",
  "SCPD Approved by Consultant & JMAA",
  "Notification to Proceed \u2013 Construction Services",
  "1st Quarter Southern Region Quarterly AIP Grant Performance Report",
  "1st Quarter Construction Progress Report",
  "FAA Form 5100-140, Annual Performance Report Submitted",
  "2nd Quarter Southern Region Quarterly AIP Grant Performance Report",
  "2nd Quarter FAA Form 5370-1, Construction Progress & Inspection Report",
  "3rd Quarter Southern Region Quarterly AIP Grant Performance Report",
  "3rd Quarter FAA Form 5370-1, Construction Progress & Inspection Report",
  "4th Quarter Southern Region Quarterly AIP Grant Performance Report",
  "4th Quarter FAA Form 5370-1, Construction Progress & Inspection Report",
  "Substantial Completion \u2013 Construction Services",
  "Final Acceptance",
  "Project Closeout Package Submitted",
  "Project Record (As-Built) Drawings Submitted",
  "Final Invoice Received",
  "Final Invoice Processed",
  "Grant Closeout Documents Submission to FAA Complete",
  "Final Grant Closeout Correspondence Received from FAA"
];

// A project can carry several grants, each with its own checklist — two FAA AIG
// grants plus an MDOT matching grant, for example, and MDOT does not require
// sponsor certifications or quarterly reports. Sections are per-project data,
// not a fixed list, so each grant is tracked separately.
const MDOT_MILESTONES = ["Grant Awarded", "Grant Executed", "Quarterly Reports Submitted", "Final Inspection Complete", "Closeout Package Submitted"];

// Quarterly reports are submitted four times a year, so they are tracked
// individually rather than as one checkbox — this is what the quarterly
// reporting cycle actually looks like.
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const GRANT_TEMPLATES = {
  "FAA AIP": GRANT_MILESTONES,
  "FAA AIG": GRANT_MILESTONES,
  "MDOT AIP-Matching": MDOT_MILESTONES,
  "Custom": []
};

const LEGACY_FAA_MILESTONES = {
  "Application Submitted": "Application for Federal Assistance Submitted",
  "Grant Awarded": "Grant Award Received",
  "Grant Executed": "Executed Grant Agreement",
  "Sponsor Certifications Submitted": "Sponsor Certification and Lobbying Certification Submitted",
  "Final Acceptance Letter": "Final Acceptance",
  "Closeout Package Submitted": "Project Closeout Package Submitted",
  "Closeout Approved": "Final Grant Closeout Correspondence Received from FAA"
};

function currentFaaSection(section) {
  if (!section || !/^FAA A(?:IP|IG)$/i.test(section.type || "")) return section;
  const done = { ...(section.done || {}) };
  const completionDates = { ...(section.completionDates || {}) };
  Object.entries(LEGACY_FAA_MILESTONES).forEach(([oldName, newName]) => {
    if (done[oldName] && done[newName] == null) done[newName] = true;
    if (completionDates[oldName] && !completionDates[newName]) completionDates[newName] = completionDates[oldName];
  });
  return { ...section, items: GRANT_MILESTONES, done, completionDates };
}

// Older projects stored a single flat { milestones: {...} } map. Convert that to
// one FAA section so nothing already entered is lost.
function grantSections(grant) {
  if (grant && Array.isArray(grant.sections) && grant.sections.length) return grant.sections.map(currentFaaSection);
  const legacy = grant && grant.milestones || {};
  return [{
    id: "faa-1",
    name: "FAA AIG Grant Administration",
    type: "FAA AIG",
    items: GRANT_MILESTONES,
    done: legacy,
    completionDates: grant && grant.milestoneDates || {},
    grantNo: "",
    popEnd: ""
  }];
}

// "Quarterly Reports Submitted" expands into four separate checkboxes so each
// submission is tracked on its own.
function expandItems(items) {
  const out = [];
  (items || []).forEach(m => {
    if (/^quarterly reports submitted$/i.test(m)) {
      QUARTERS.forEach(q => out.push(`Quarterly Report — ${q}`));
    } else out.push(m);
  });
  return out;
}


export { grantSections, expandItems };

const number=value=>value==null||typeof value==='boolean'||String(value).trim()===''?null:Number.isFinite(Number(value))?Number(value):null;
const sumKnown=values=>values.length&&values.every(value=>value!==null)?values.reduce((sum,value)=>sum+value,0):null;
const META_KEYS=['title','projectNo','munisProjectNo','aipNo','garverProjectNo','projectCategory','projectManager','owner','location','scope','primeContractor','engineerOfRecord','subEngineer','totalBudget','primeBudget','engineeringBudget','funding','fundingTotal','reimbursableSources','budgetVarianceLimit','timeVarianceLimitPerWeek','lengthDays','lengthWeeks','startDate','fiscalYear','fy'];
// Bound fields deliberately, then serialize a complete object. Cutting JSON text
// could hide warnings or leave an unfinished record for the model to interpret.
function compact(value) {
  const limits=[...(value.contextLimits||[])];
  function bounded(v,depth=0) {
    if(typeof v==='string'&&v.length>1500){limits.push('Long text fields shortened to 1,500 characters.');return v.slice(0,1500)+' [text shortened]';}
    if(v==null||typeof v!=='object')return v;
    if(depth>6){limits.push('Deeply nested details omitted.');return '[nested details omitted]';}
    if(Array.isArray(v)){if(v.length>100)limits.push('Lists limited to 100 entries.');return v.slice(0,100).map(item=>bounded(item,depth+1));}
    const entries=Object.entries(v);
    if(entries.length>100)limits.push('Large record maps limited to 100 fields.');
    return Object.fromEntries(entries.slice(0,100).map(([key,item])=>[key,bounded(item,depth+1)]));
  }
  const facts=bounded(value);
  const encode=()=>JSON.stringify({...facts,contextLimits:[...new Set(limits)]});
  if(encode().length>18000){
    facts.weeklyActuals=facts.weeklyActuals.slice(-5);facts.payApplications=facts.payApplications.slice(-5);
    facts.documentIndex=facts.documentIndex.slice(0,10);facts.legacyDocumentIndex=facts.legacyDocumentIndex.slice(0,10);facts.sharepoint.indexedFiles=facts.sharepoint.indexedFiles.slice(0,10);
    limits.push('Detailed weekly, payment and document lists shortened; calculations still use all eligible saved records.');
  }
  if(encode().length>18000){
    facts.grantSections=facts.grantSections.map(s=>({...s,items:s.items.filter(i=>i.done||i.date).slice(0,5)}));
    facts.meta=Object.fromEntries(META_KEYS.filter(key=>key in facts.meta).map(key=>[key,facts.meta[key]]));
    limits.push('Grant milestone detail shortened; completed and total counts retain the full checklist.');
  }
  if(encode().length>18000){
    facts.meta=Object.fromEntries(['projectNo','munisProjectNo','aipNo','projectCategory','totalBudget','primeBudget','engineeringBudget','fiscalYear','fy'].filter(key=>key in facts.meta).map(key=>[key,facts.meta[key]]));
    facts.schedule=Object.fromEntries(['startISO','days','fyStartMonth'].filter(key=>key in facts.schedule).map(key=>[key,facts.schedule[key]]));
    facts.grant={};facts.grantSections=facts.grantSections.slice(0,20).map(s=>({id:String(s.id||'').slice(0,100),name:String(s.name||'').slice(0,200),grantNo:String(s.grantNo||'').slice(0,100),completed:s.completed,total:s.total}));
    facts.weeklyActuals=[];facts.payApplications=[];facts.documentIndex=[];facts.legacyDocumentIndex=[];facts.sharepoint.indexedFiles=[];
    limits.push('Only core identifiers, calculations and grant summaries fit for this project.');
  }
  if(encode().length>18000){
    facts.meta={};facts.schedule={};facts.grantSections=[];facts.sharepoint.folder=null;
    facts.projectId=String(facts.projectId||'').slice(0,128);facts.title=String(facts.title||'').slice(0,256);
    limits.push('Remaining oversized metadata omitted; ask about this project separately for more detail.');
  }
  return encode();
}
export function projectEvidence(p,weekly,payapps,documents,sharepoint,today) {
  const meta=p.meta||{},sched=p.sched||{},grant=p.grant_info||{};
  const rows=weekly.filter(w=>w.project_id===p.id);
  const total=number(meta.totalBudget)??number(meta.primeBudget);
  const days=number(sched.days)>0?Math.max(7,number(sched.days)):null;
  const weeks=days===null?null:Math.ceil(days/7);
  const logged=rows.filter(r=>number(r.spend)!==null&&number(r.week_no)>0&&(weeks===null||number(r.week_no)<=weeks));
  const spend=sumKnown(logged.map(r=>number(r.spend)));
  const daysLost=sumKnown(logged.map(r=>number(r.days_lost)));
  const projected=days!==null&&total!==null&&logged.length?total/(days/7)*logged.length:null;
  const variance=projected>0&&spend!==null?(spend-projected)/projected:null;
  const sections=grantSections(grant).map(s=>{
    const items=expandItems(s.items);
    return {id:s.id,name:s.name,grantNo:s.grantNo||'',periodEnds:s.popEnd||'',
      completed:items.filter(name=>s.done?.[name]===true).length,total:items.length,
      items:items.map(name=>({name,done:s.done?.[name]===true,date:s.completionDates?.[name]||''}))};
  });
  const funding=sumKnown((meta.funding||[]).map(f=>number(f.amount)));
  const applications=payapps.filter(a=>a.project_id===p.id);
  const net=a=>number(a.work_completed)!==null&&number(a.retainage_pct)!==null?number(a.work_completed)*(1-number(a.retainage_pct)):null;
  const paid=applications.length?sumKnown(applications.map(a=>a.paid?net(a):0)):null;
  const received=applications.filter(a=>a.reimb_received);
  const reimbursed=applications.length?sumKnown(applications.map(a=>a.reimb_received?number(a.reimb_amount):0)):null;
  const reimbursable=(meta.funding||[]).filter(f=>(meta.reimbursableSources||[]).includes(f.source));
  const eligibleFunding=reimbursable.length?sumKnown(reimbursable.map(f=>number(f.amount))):Array.isArray(meta.reimbursableSources)?0:null;
  const fundingTotal=number(meta.fundingTotal)>0?number(meta.fundingTotal):funding;
  const share=fundingTotal>0&&eligibleFunding!==null?eligibleFunding/fundingTotal:null;
  const estimated=received.filter(a=>number(a.reimb_amount)===null);
  const displayedReimbursement=applications.length?sumKnown(applications.map(a=>!a.reimb_received?0:number(a.reimb_amount)??(share!==null&&net(a)!==null?net(a)*share:null))):null;
  const docs=documents.filter(d=>d.project_id===p.id);
  const legacyDocs=Object.entries(grant.docs||{}).flatMap(([name,value])=>(Array.isArray(value)?value:[value]).flatMap((url,index)=>typeof url==='string'&&/^https?:\/\//i.test(url.trim())?[{name:name+(index?' ('+(index+1)+')':''),url:url.trim(),readableInApp:false,contentAvailable:false}]:[]));
  const sp=sharepoint.filter(d=>d.project_id===p.id);
  const warnings=[];
  if(!grant.sections?.length&&!Object.keys(grant.milestones||{}).length)warnings.push('No saved grant checklist entries. The default checklist is a template; grant applicability and status have not been verified.');
  if(total===null)warnings.push('No usable project budget recorded. The budget is unknown, not zero.');
  else if(number(meta.totalBudget)===null)warnings.push('Budget falls back to the recorded prime contract amount; a separate engineering budget may not be included.');
  if(days===null)warnings.push('No usable schedule duration recorded. Cost variance cannot be verified from the calendar.');
  if(!logged.length)warnings.push('No weekly actuals recorded with a spend value. Actual spend and progress are unknown, not confirmed zero.');
  if(logged.length&&Math.max(...logged.map(r=>number(r.week_no)))>logged.length)warnings.push('Weekly logs contain gaps. Variance compares only logged rows; missing weeks are not verified.');
  if(rows.some(r=>number(r.spend)===null))warnings.push('Weekly rows without spend values are excluded from reported spend and variance.');
  if(weeks!==null&&rows.some(r=>number(r.week_no)>weeks))warnings.push('Weekly rows beyond the displayed schedule are excluded, matching the project dashboard.');
  if(logged.length&&daysLost===null)warnings.push('Days lost are missing from one or more logged weeks; total schedule delay is unknown.');
  if(funding===null)warnings.push('The funding list is missing or incomplete. A funding gap cannot be verified.');
  else if(total!==null&&total>funding)warnings.push('Recorded funding is below the budget by $'+(total-funding).toFixed(2)+'. Verify whether the funding list is complete.');
  if(!applications.length)warnings.push('No pay applications recorded. Actual payments and reimbursements are not established.');
  if(estimated.length)warnings.push(estimated.length+' received reimbursement record(s) have no explicit amount. The dashboard uses expected reimbursement where funding data allows; this is an estimate, not a recorded receipt amount.');
  if(sched.startISO&&meta.startDate)warnings.push('Use schedule.startISO for the displayed baseline; meta.startDate is a separate stored value and may be stale.');
  if(sched.startISO&&number(sched.days)>0){
    const end=new Date(sched.startISO+'T12:00:00Z');
    if(Number.isFinite(end.getTime())){
      end.setUTCDate(end.getUTCDate()+number(sched.days)-1);
      if(end.toISOString().slice(0,10)<today)warnings.push('Displayed baseline completion date has passed. Actual completion has not been established by this calculation.');
    }
  }
  const missing=docs.filter(d=>!d.storage_path&&!d.url).length;
  if(missing)warnings.push(missing+' document records have no file or URL attached.');
  const grantSummary=Object.fromEntries(Object.entries(grant).filter(([key])=>!['sections','milestones','milestoneDates','docs'].includes(key)));
  return {projectId:p.id,title:p.title,meta,schedule:sched,grant:grantSummary,
    calculations:{budget:total,recordedFunding:funding,scheduleDays:days,scheduleWeeks:weeks,weeklyRows:rows.length,loggedSpendRows:logged.length,reportedSpend:spend,reportedDaysLost:daysLost,costVariance:variance,paidAfterRetainage:paid,recordedReimbursement:reimbursed,displayedReimbursement,reimbursementUsesEstimate:estimated.length>0,carrying:paid!==null&&displayedReimbursement!==null?paid-displayedReimbursement:null},
    grantSections:sections,warnings,
    recordCounts:{weeklyActuals:rows.length,payApplications:applications.length,documents:docs.length,legacyDocuments:legacyDocs.length,sharepointIndexedFiles:sp.length},
    contextLimits:[...(rows.length>30||applications.length>30?['Weekly and payment detail limited to the most recent 30 records; calculations use all eligible records.']:[]),...(docs.length>100||legacyDocs.length>100||sp.length>40?['Document indexes are excerpts, not a complete list.']:[])],
    weeklyActuals:rows.slice(-30),payApplications:payapps.filter(a=>a.project_id===p.id).slice(-30),
    documentIndex:docs.slice(0,100).map(d=>({id:d.id,name:d.label||d.file_name,category:d.category,status:d.review_status,revision:d.revision_no,
      readableInApp:!!d.storage_path&&/\.(pdf|txt|md|csv|json)$/i.test(d.file_name||''),hasAttachment:!!(d.storage_path||d.url)})),
    legacyDocumentIndex:legacyDocs.slice(0,100),
    sharepoint:{folder:p.sharepoint_folder_url||null,indexedFiles:sp.slice(0,40).map(d=>({name:d.file_name,modified:d.modified_at,received:d.received_at})),
      contentAccess:'SharePoint links and indexed metadata only. No Microsoft file contents are available through a folder URL. A selected uploaded file or user attachment may be read separately.'}};
}

export function evidenceBriefing(projects,weekly,payapps,documents,sharepoint,targetId,today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'})) {
  // Keep the open project first; every project still contributes a bounded summary.
  const sorted=[...projects].sort((a,b)=>Number(b.id===targetId)-Number(a.id===targetId));
  const sources=[];let text='Authoritative saved project records. Today (America/Chicago): '+today+'.\n';
  for(const p of sorted){
    const facts=projectEvidence(p,weekly,payapps,documents,sharepoint,today);
    if(p.id!==targetId){facts.weeklyActuals=facts.weeklyActuals.slice(-5);facts.documentIndex=facts.documentIndex.slice(0,20);facts.legacyDocumentIndex=facts.legacyDocumentIndex.slice(0,20);facts.grantSections=facts.grantSections.map(s=>({...s,items:s.items.filter(i=>i.done||i.date).slice(0,10)}));facts.contextLimits.push('Other-project details are summarized: up to 5 weekly rows, 20 documents per index and 10 completed or dated milestones per grant.');}
    const block='\n[SOURCE project:'+p.id+']\n'+compact(facts)+'\n';
    if(text.length+block.length>95000){text+='Additional project details omitted to keep the request bounded.\n';break;}
    text+=block;sources.push({id:'project:'+p.id,name:p.title,kind:'project records'});
  }
  return {text,sources};
}
