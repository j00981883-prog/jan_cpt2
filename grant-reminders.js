function grantReminderPeriods(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(now);
  const part = key => parts.find(p=>p.type===key).value;
  const daily = `${part('year')}-${part('month')}-${part('day')}`;
  const monday = new Date(daily+'T12:00:00Z');
  monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
  return {daily,weekly:monday.toISOString().slice(0,10)};
}
function GrantReminders({profile,projects,onOpen}) {
  const [periods,setPeriods]=React.useState(()=>grantReminderPeriods());
  const [done,setDone]=React.useState({});
  const [loaded,setLoaded]=React.useState(false);
  const [error,setError]=React.useState('');
  const [busy,setBusy]=React.useState('');
  const [selected,setSelected]=React.useState('');
  const [note,setNote]=React.useState('');
  const [noUpdates,setNoUpdates]=React.useState(false);
  const [sent,setSent]=React.useState('');
  React.useEffect(()=>{const timer=setInterval(()=>setPeriods(grantReminderPeriods()),60000);return()=>clearInterval(timer);},[]);
  React.useEffect(()=>{
    let live=true;setLoaded(false);setDone({});setError('');
    requestWithTimeout(sb.from('grant_checkins').select('cadence,period_start,completed_at').eq('user_id',profile.id).in('period_start',[periods.daily,periods.weekly]),'Loading grant reminders')
      .then(({data,error})=>{if(!live)return;if(error)throw error;const result={};(data||[]).forEach(r=>{if(r.period_start===periods[r.cadence])result[r.cadence]=r.completed_at;});setDone(result);setLoaded(true);})
      .catch(e=>{if(live)setError(e.message||String(e));});
    return()=>{live=false;};
  },[profile.id,periods.daily,periods.weekly]);
  async function complete(cadence){
    if(busy||!loaded)return;setBusy(cadence);setError('');setSent('');
    try{
      const {data,error}=await requestWithTimeout(sb.from('grant_checkins').upsert({user_id:profile.id,cadence,period_start:periods[cadence],completed_at:new Date().toISOString(),note:note.trim(),no_updates:noUpdates,project_id:selected||null},{onConflict:'user_id,cadence,period_start'}).select('completed_at').single(),'Saving grant check-in');
      if(error)throw error;setDone(d=>({...d,[cadence]:data.completed_at}));setNote('');setNoUpdates(false);setSent('Check-in saved and delivered to your assigned grant-update recipient.');
    }catch(e){setError(e.message||String(e));}finally{setBusy('');}
  }
  const enabled=[profile.grant_daily_reminder&&'daily',profile.grant_weekly_reminder&&'weekly'].filter(Boolean);
  if(!enabled.length)return null;
  const e=React.createElement;
  const grantProjects=(projects||[]).filter(p=>p.meta?.projectCategory!=='internal');
  return e('section',{className:'grant-reminders','aria-label':'Grant update reminders'},
    e('div',{className:'grant-reminders-head'},e('div',null,e('span',{className:'grant-reminders-kicker'},profile.dashboard_designation||'Grants'),e('h2',null,'Your grant reminders')),e('span',{className:'doc-badge review'},loaded?enabled.filter(c=>!done[c]).length+' pending':'Loading…')),
    e('div',{className:'grant-reminder-grid'},enabled.map(c=>e('div',{key:c,className:'grant-reminder-card'+(done[c]?' complete':'')},e('strong',null,c==='daily'?'Daily grant check-in':'Weekly grant updates'),e('p',null,c==='daily'?'Review grant dates, upcoming submissions and items needing attention.':'Update milestone completion dates, reports and grant status for active projects.'),e('small',null,c==='daily'?'Today · '+periods.daily:'Week beginning · '+periods.weekly),done[c]&&e('span',{className:'doc-badge approved'},'✓ Completed'),e('button',{className:'btn btn-primary btn-sm',disabled:!!busy||!loaded,onClick:()=>complete(c)},busy===c?'Saving…':done[c]?'Send another update':'Send check-in / memo')))),
    e('div',{className:'grant-reminder-actions'},e('select',{'aria-label':'Choose grant project',value:selected,onChange:event=>setSelected(event.target.value)},e('option',{value:''},'All grants / general update'),grantProjects.map(p=>e('option',{key:p.id,value:p.id},p.title||p.meta?.title))),e('button',{className:'btn btn-gold btn-sm',disabled:!selected,onClick:()=>onOpen(selected)},'Open project')),
    e('label',{className:'grant-memo-label'},'Memo to leadership',e('textarea',{value:note,onChange:event=>setNote(event.target.value),placeholder:'Type grant updates, upcoming dates, questions or items needing attention…',rows:4,maxLength:10000,disabled:!!busy,'aria-label':'Grant update memo'})),
    e('label',{className:'grant-no-updates'},e('input',{type:'checkbox',checked:noUpdates,onChange:event=>setNoUpdates(event.target.checked),disabled:!!busy}),'There are no updates at this time.'),
    sent&&e('p',{className:'doc-approved',role:'status'},sent),
    e('p',{className:'docs-lf-hint'},'Daily reminders reset each day; weekly reminders reset Monday, using Central time. Check-in completion does not mark project milestones complete.'),error&&e('div',{className:'docs-err',role:'alert'},error));
}

function GrantUpdateInbox({profile,onOpen}) {
  const [items,setItems]=React.useState([]);
  const [error,setError]=React.useState('');
  const [busy,setBusy]=React.useState('');
  React.useEffect(()=>{
    let live=true;
    async function load(){
      try{const{data,error}=await requestWithTimeout(sb.from('grant_update_notifications').select('*').eq('recipient_id',profile.id).order('created_at',{ascending:false}).limit(30),'Loading grant update notices');if(error)throw error;if(live){setItems(data||[]);setError('');}}
      catch(e){if(live)setError(e.message||String(e));}
    }
    load();const timer=setInterval(load,30000);return()=>{live=false;clearInterval(timer);};
  },[profile.id]);
  async function read(id){
    if(busy)return;setBusy(id);
    try{const time=new Date().toISOString();const{error}=await requestWithTimeout(sb.from('grant_update_notifications').update({read_at:time}).eq('id',id).eq('recipient_id',profile.id).select('id').single(),'Marking grant notice read');if(error)throw error;setItems(rows=>rows.map(r=>r.id===id?{...r,read_at:time}:r));}
    catch(e){setError(e.message||String(e));}finally{setBusy('');}
  }
  const e=React.createElement;
  return e('section',{className:'grant-reminders','aria-label':'Grant updates from staff'},e('div',{className:'grant-reminders-head'},e('h2',null,'Grant updates from staff'),e('span',{className:'doc-badge review'},items.filter(r=>!r.read_at).length,' unread')),
    error&&e('div',{className:'docs-err',role:'alert'},error),!items.length&&e('p',null,'Grant updates and check-in memos will appear here when submitted.'),
    items.map(r=>e('article',{key:r.id,className:'grant-notice'+(r.read_at?' read':'')},e('strong',null,r.sender_name,' · ',r.event_type==='no_updates'?'No updates at this time':r.event_type==='grant_change'?'Grant information updated':'Grant check-in'),
      e('div',{className:'grant-notice-time'},new Date(r.created_at).toLocaleString('en-US',{timeZone:'America/Chicago'}),' CT',r.project_title?' · '+r.project_title:''),e('p',{className:'grant-notice-memo'},r.memo),
      e('div',{className:'grant-reminder-actions'},r.project_id&&e('button',{className:'btn btn-ghost btn-sm',onClick:()=>onOpen(r.project_id)},'Open project'),!r.read_at&&e('button',{className:'btn btn-primary btn-sm',disabled:!!busy,onClick:()=>read(r.id)},busy===r.id?'Saving…':'Mark read')))));
}

function SharePointFolder({projectId,isEditor}) {
  const [url,setUrl]=React.useState('');
  const [saved,setSaved]=React.useState('');
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  React.useEffect(()=>{
    let live=true;
    requestWithTimeout(sb.from('projects').select('sharepoint_folder_url').eq('id',projectId).single(),'Loading SharePoint folder').then(({data,error})=>{if(!live)return;if(error)throw error;setUrl(data.sharepoint_folder_url||'');setSaved(data.sharepoint_folder_url||'');}).catch(e=>{if(live)setError(e.message||String(e));});
    return()=>{live=false;};
  },[projectId]);
  async function save(){
    if(!isEditor||busy)return;setError('');
    let next=url.trim();
    try{if(next){const link=new URL(next);if(link.protocol!=='https:'||!link.hostname.endsWith('.sharepoint.com')||link.username||link.password)throw Error('Enter a valid HTTPS SharePoint folder link.');next=link.href;}}catch(e){setError(e.message);return;}
    setBusy(true);
    try{const{error}=await requestWithTimeout(sb.from('projects').update({sharepoint_folder_url:next||null}).eq('id',projectId).select('id').single(),'Saving SharePoint folder');if(error)throw error;setSaved(next);setUrl(next);}catch(e){setError(e.message||String(e));}finally{setBusy(false);}
  }
  const e=React.createElement;
  return e('section',{className:'sharepoint-folder','aria-label':'SharePoint folder connection'},e('strong',null,'SharePoint project folder'),
    saved&&e('a',{className:'btn btn-ghost btn-sm',href:saved,target:'_blank',rel:'noopener noreferrer'},'Open SharePoint folder'),
    isEditor&&e('div',{className:'grant-reminder-actions'},e('input',{value:url,onChange:event=>setUrl(event.target.value),placeholder:'Paste this project’s SharePoint folder link','aria-label':'SharePoint folder URL',disabled:busy}),e('button',{className:'btn btn-primary btn-sm',onClick:save,disabled:busy},busy?'Saving…':'Save folder connection')),
    e('p',{className:'docs-lf-hint'},'Open the folder to work with the original files in SharePoint. Automatic deliveries appear below once the Microsoft flow is enabled. Import synced folder remains available for manual uploads.'),error&&e('div',{className:'docs-err',role:'alert'},error),
    e(SharePointDocuments,{key:projectId,projectId,folderLinked:!!saved}));
}

function SharePointDocuments({projectId,folderLinked}) {
  const e=React.createElement;
  const [rows,setRows]=React.useState([]),[error,setError]=React.useState('');
  const [loaded,setLoaded]=React.useState(false),[search,setSearch]=React.useState('');
  const [limit,setLimit]=React.useState(100),[more,setMore]=React.useState(false);
  React.useEffect(()=>{
    let live=true,running=false;
    async function refresh(){
      if(running)return;running=true;
      try{
        const {data,error}=await requestWithTimeout(sb.from('sharepoint_documents').select('*').eq('project_id',projectId).order('received_at',{ascending:false}).order('source_id').range(0,limit),'Loading SharePoint documents');
        if(error)throw error;
        if(live){setRows((data||[]).slice(0,limit));setMore((data||[]).length>limit);setError('');setLoaded(true);}
      }catch(err){if(live){setError(err.message||String(err));setLoaded(true);}}
      finally{running=false;}
    }
    refresh();const timer=setInterval(refresh,30000);
    return()=>{live=false;clearInterval(timer);};
  },[projectId,limit]);
  const visible=rows.filter(row=>row.file_name.toLowerCase().includes(search.toLowerCase()));
  const fmt=value=>new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'short'})+' CT';
  return e('div',{className:'sp-files'},
    e('div',{className:'sp-files-heading'},e('strong',null,'Files from SharePoint'),e('span',{className:'doc-badge'},rows.length?'Updates received':folderLinked?'Awaiting first delivery':'Folder not linked')),
    rows.length>0&&e('p',{className:'docs-lf-hint'},'Last delivery: '+fmt(rows[0].received_at)+'. Files open with your Microsoft permissions.'),
    error&&e('p',{className:'docs-err',role:'alert'},'Unable to check SharePoint deliveries: '+error),
    !loaded?e('p',null,'Checking document updates…'):!rows.length&&!error&&e('p',{className:'docs-lf-hint'},folderLinked?'No automatic deliveries received yet. Your folder link works independently of automatic sync.':'Save the matching project folder above to prepare this project.'),
    rows.length>0&&e('input',{className:'sp-file-search',type:'search',value:search,placeholder:'Find a SharePoint file…','aria-label':'Search delivered SharePoint files',onChange:ev=>setSearch(ev.target.value)}),
    e('div',{className:'sp-file-list'},visible.map(row=>e('div',{className:'sp-file-row',key:row.source_id},
      e('a',{href:row.url,target:'_blank',rel:'noopener noreferrer'},row.file_name),
      e('small',null,'Modified '+fmt(row.modified_at)+(row.source_version?' · Version '+row.source_version:''))))),
    rows.length>0&&!visible.length&&e('p',null,'No matching files in the loaded results.'),
    more&&e('button',{className:'btn btn-ghost btn-sm',onClick:()=>setLimit(n=>n+100)},'Load more SharePoint files'));
}
