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

const number=value=>Number.isFinite(Number(value))?Number(value):0;
const compact=value=>JSON.stringify(value).slice(0,18000);
export function projectEvidence(p,weekly,payapps,documents,sharepoint,today) {
  const meta=p.meta||{},sched=p.sched||{},grant=p.grant_info||{};
  const rows=weekly.filter(w=>w.project_id===p.id);
  const total=number(meta.totalBudget)||number(meta.primeBudget);
  const weeks=number(meta.lengthWeeks)||Math.ceil(number(sched.days||meta.lengthDays)/7);
  const spend=rows.reduce((sum,r)=>sum+number(r.spend),0);
  const daysLost=rows.reduce((sum,r)=>sum+number(r.days_lost),0);
  const projected=weeks>0?total/weeks*rows.length:0;
  const variance=projected>0?(spend-projected)/projected:null;
  const sections=grantSections(grant).map(s=>{
    const items=expandItems(s.items);
    return {id:s.id,name:s.name,grantNo:s.grantNo||'',periodEnds:s.popEnd||'',
      completed:items.filter(name=>s.done?.[name]===true).length,total:items.length,
      items:items.map(name=>({name,done:s.done?.[name]===true,date:s.completionDates?.[name]||''}))};
  });
  const funding=(meta.funding||[]).reduce((sum,f)=>sum+number(f.amount),0);
  const applications=payapps.filter(a=>a.project_id===p.id);
  const paid=applications.reduce((sum,a)=>sum+(a.paid?number(a.work_completed)*(1-number(a.retainage_pct)):0),0);
  const reimbursed=applications.reduce((sum,a)=>sum+number(a.reimb_amount),0);
  const docs=documents.filter(d=>d.project_id===p.id);
  const sp=sharepoint.filter(d=>d.project_id===p.id);
  const warnings=[];
  if(!rows.length)warnings.push('No weekly actuals recorded. Zero spend/variance does not verify current progress or an on-schedule status.');
  if(rows.length&&Math.max(...rows.map(r=>number(r.week_no)))>rows.length)warnings.push('Weekly logs contain gaps. Variance compares only logged rows; missing weeks are not verified.');
  if(total>funding)warnings.push('Recorded funding is below the budget by $'+(total-funding).toFixed(2)+'. Verify whether the funding list is complete.');
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
  return {projectId:p.id,title:p.title,meta,schedule:sched,grant,
    calculations:{budget:total,recordedFunding:funding,weeklyRows:rows.length,reportedSpend:spend,reportedDaysLost:daysLost,costVariance:variance,paidAfterRetainage:paid,recordedReimbursement:reimbursed,carrying:paid-reimbursed},
    grantSections:sections,warnings,
    weeklyActuals:rows.slice(-30),payApplications:payapps.filter(a=>a.project_id===p.id).slice(-30),
    documentIndex:docs.slice(0,100).map(d=>({id:d.id,name:d.label||d.file_name,category:d.category,status:d.review_status,revision:d.revision_no,
      readableInApp:!!d.storage_path&&/\.(pdf|txt|md|csv|json)$/i.test(d.file_name||''),hasAttachment:!!(d.storage_path||d.url)})),
    sharepoint:{folder:p.sharepoint_folder_url||null,indexedFiles:sp.slice(0,40).map(d=>({name:d.file_name,modified:d.modified_at,received:d.received_at})),
      contentAccess:'SharePoint links and indexed metadata only. No Microsoft file contents are available through a folder URL. A selected uploaded file or user attachment may be read separately.'}};
}

export function evidenceBriefing(projects,weekly,payapps,documents,sharepoint,targetId,today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'})) {
  // Keep the open project first; every project still contributes a bounded summary.
  const sorted=[...projects].sort((a,b)=>Number(b.id===targetId)-Number(a.id===targetId));
  const sources=[];let text='Authoritative saved project records. Today (America/Chicago): '+today+'.\n';
  for(const p of sorted){
    const facts=projectEvidence(p,weekly,payapps,documents,sharepoint,today);
    if(p.id!==targetId){facts.weeklyActuals=facts.weeklyActuals.slice(-5);facts.documentIndex=facts.documentIndex.slice(0,20);facts.grantSections=facts.grantSections.map(s=>({...s,items:s.items.filter(i=>i.done||i.date).slice(0,10)}));}
    const block='\n[SOURCE project:'+p.id+']\n'+compact(facts)+'\n';
    if(text.length+block.length>95000){text+='Additional project details omitted to keep the request bounded.\n';break;}
    text+=block;sources.push({id:'project:'+p.id,name:p.title,kind:'project records'});
  }
  return {text,sources};
}
