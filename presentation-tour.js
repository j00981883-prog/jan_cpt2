const JAN_PRESENTATION_STEPS = [
  {title:'One place for the department',view:'portfolio',time:'30 seconds',say:'JAN CPT brings capital and internal projects into one workspace. The goal is to make project status easier to find and discuss.',show:'Point out the project cards and the Capital / Internal tabs.',note:'Introduce this as the current working dashboard. Some records still need verification.'},
  {title:'The leadership overview',view:'display',time:'40 seconds',say:'Display mode gives leadership a quick visual overview of the portfolio, budget allocation, and recorded cash exposure.',show:'Point out the portfolio charts and project cards.',note:'Green status reflects entered records. Missing weekly logs do not prove that work is on schedule.'},
  {title:'Inside one project',view:'project',tab:'dashboard',time:'45 seconds',say:'Each project has an executive summary, budget and schedule information, and a consistent set of tabs.',show:'Walk through the summary and the budget / schedule charts. Allow the saved data to finish loading.',note:'Confirm actual dollar amounts and dates with the project owner before treating them as official figures.'},
  {title:'Record progress consistently',view:'project',tab:'log',time:'30 seconds',say:'Weekly logs provide the progress and spending evidence used in the dashboard. Staff can keep a clear record of what happened each week.',show:'Point out the weekly rows and notes. Describe the workflow without changing a real record.',note:'Zero recorded spend means nothing has been logged here; it is not necessarily zero actual spending.'},
  {title:'Grant administration',view:'project',tab:'grant',time:'50 seconds',say:'Grant staff can track the detailed administration checklist, record completion dates, and review each funding source.',show:'Show one checklist section, its date fields, and the funding breakdown.',note:'A checklist supports administration; it is not an FAA approval or compliance determination.'},
  {title:'Payments and reimbursement',view:'project',tab:'pay',time:'35 seconds',say:'Pay applications help organize submissions, payment dates, retainage, and reimbursement information for each project.',show:'Point out the payment workflow and fields. Keep real records unchanged during the tour.',note:'MUNIS currently shows report previews. Do not present it as an active automatic financial feed.'},
  {title:'Documents and SharePoint',view:'project',tab:'docs',time:'50 seconds',say:'The project document area holds uploaded files, links, and revision history. A saved SharePoint link opens the original project folder.',show:'Show an uploaded file, Controls / history, and Open SharePoint folder. Entries without attachments need a file or link.',note:'OneDrive sync is connected locally. Importing into JAN CPT is manual. Automatic SharePoint delivery is still pending Microsoft billing.'},
  {title:'A project-aware AI assistant',view:'ai',time:'50 seconds',say:'JAN AI can analyze saved project records, flag missing information, draft updates, and read a selected uploaded PDF. Proposed edits are reviewed before application.',show:'Open Read a project document or ask: “Which budgets or funding figures need checking?” Run a question only if you want a live AI demonstration.',note:'The tour never sends an AI request itself. Direct SharePoint file-content access is not active; download and attach those files.'},
  {title:'Field work on a phone',view:'field',time:'40 seconds',say:'Field view gives staff a simpler workspace for project checklists, walkthroughs, reports, and photos.',show:'Show the project selector. Explain the walkthrough process; starting a real walkthrough creates a visit record.',note:'The presentation stops at project selection so it does not create a demonstration visit in production.'},
  {title:'Simple internal projects',view:'internal',time:'35 seconds',say:'Internal and maintenance projects use a simpler view focused on the location, key details, walkthroughs, and documents.',show:'Point out the simplified project details. Use this for work that does not need the full capital-project interface.',note:'If an internal project is not available, this step stays at the portfolio.'},
  {title:'What is ready, and what comes next',view:'portfolio',time:'40 seconds',say:'Today, the team can manage projects, grants, documents, and field reports. Next priorities are validating real project records and completing the automated integrations.',show:'Summarize the current workflow and invite feedback about the department’s most useful next feature.',note:'Ask leadership for a pilot project, a project owner to validate its records, and IT support for integration licensing.'}
];

function PresentationTour(){
  const e=React.createElement;
  const [step,setStep]=React.useState(null),[projects,setProjects]=React.useState([]),[projectId,setProjectId]=React.useState('');
  const [collapsed,setCollapsed]=React.useState(false),[showNotes,setShowNotes]=React.useState(true),[error,setError]=React.useState('');
  React.useEffect(()=>{
    let live=true;
    async function launch(){
      setError('');setCollapsed(false);setStep(0);
      try{const{data,error}=await requestWithTimeout(sb.from('projects').select('id,title,meta').order('created_at'),'Loading presentation projects');if(error)throw error;
        if(live){const all=data||[];setProjects(all);const capital=all.filter(p=>p.meta?.projectCategory!=='internal');setProjectId((capital.find(p=>/threshold lighting/i.test(p.title))||capital[0])?.id||'');}}
      catch(err){if(live)setError(err.message||String(err));}
    }
    window.addEventListener('jan-presentation-start',launch);
    return()=>{live=false;window.removeEventListener('jan-presentation-start',launch);};
  },[]);
  function close(){setStep(null);window.dispatchEvent(new CustomEvent('jan-presentation-nav',{detail:{view:'portfolio',active:false}}));window.dispatchEvent(new CustomEvent('jan-presentation-ai',{detail:false}));}
  React.useEffect(()=>{
    if(step===null)return;
    const item=JAN_PRESENTATION_STEPS[step];
    const internal=projects.find(p=>p.meta?.projectCategory==='internal');
    const view=item.view==='ai'?'portfolio':item.view==='internal'?(internal?'project':'portfolio'):item.view;
    window.dispatchEvent(new CustomEvent('jan-presentation-nav',{detail:{view,tab:item.tab||'dashboard',projectId:item.view==='internal'?internal?.id:projectId,active:true}}));
    const timer=setTimeout(()=>window.dispatchEvent(new CustomEvent('jan-presentation-ai',{detail:item.view==='ai'})),300);
    return()=>clearTimeout(timer);
  },[step,projectId]);
  React.useEffect(()=>{
    if(step===null)return;
    const key=event=>{
      if(event.target?.closest?.('input,textarea,select,[contenteditable=true]'))return;
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='ArrowRight'){event.preventDefault();setStep(n=>Math.min(n+1,JAN_PRESENTATION_STEPS.length-1));}
      if(event.key==='ArrowLeft'){event.preventDefault();setStep(n=>Math.max(0,n-1));}
    };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[step]);
  if(step===null)return null;
  const item=JAN_PRESENTATION_STEPS[step],last=step===JAN_PRESENTATION_STEPS.length-1;
  return e('aside',{className:'presentation-tour'+(collapsed?' is-collapsed':''),'aria-label':'Presentation tour'},
    e('div',{className:'presentation-head'},e('span',null,'10:30 PRESENTATION · '+(step+1)+' / '+JAN_PRESENTATION_STEPS.length),
      e('div',null,e('button',{type:'button',onClick:()=>setCollapsed(v=>!v),'aria-label':collapsed?'Expand presentation tour':'Minimize presentation tour'},collapsed?'＋':'−'),e('button',{type:'button',onClick:close,'aria-label':'Exit presentation tour'},'×'))),
    e('div',{className:'presentation-progress'},e('span',{style:{width:((step+1)/JAN_PRESENTATION_STEPS.length*100)+'%'}})),
    !collapsed&&e(React.Fragment,null,
      e('div',{className:'presentation-copy',key:step},e('small',null,item.time+' · About 7–8 minutes total'),e('h2',null,item.title),e('p',null,item.say),e('div',{className:'presentation-show'},e('strong',null,'Show the room'),e('p',null,item.show)),
        showNotes&&e('div',{className:'presentation-note'},e('strong',null,'Presenter reminder'),e('p',null,item.note)),
        error&&e('p',{role:'alert'},error),
        step===0&&e('label',null,'Demo project',e('select',{value:projectId,onChange:event=>setProjectId(event.target.value)},projects.filter(p=>p.meta?.projectCategory!=='internal').map(p=>e('option',{value:p.id,key:p.id},p.title)))),
        e('button',{className:'presentation-notes-toggle',type:'button',onClick:()=>setShowNotes(v=>!v)},showNotes?'Hide presenter reminders':'Show presenter reminders')),
      e('nav',{'aria-label':'Presentation steps'},e('button',{type:'button',disabled:step===0,onClick:()=>setStep(n=>n-1)},'← Back'),e('button',{type:'button',onClick:last?close:()=>setStep(n=>n+1)},last?'Finish tour':'Next →'))));
}
