const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../JAN_CPT.html'),'utf8');
const helpers=html.slice(html.indexOf('const GRANT_MILESTONES ='),html.indexOf('function localTodayISO()'));
const exportSource=html.slice(html.indexOf('  const exportCSV = () => {'),html.indexOf('  const importJSON = file => {'));

// Parse records rather than split on newlines: names and notes can contain
// quoted commas, quotes, or line breaks in an otherwise valid CSV document.
function records(csv){
 const result=[];let row=[],field='',quoted=false;
 for(let i=0;i<csv.length;i++){
  const c=csv[i];
  if(c==='"'){
   if(quoted&&csv[i+1]==='"'){field+='"';i++;}else quoted=!quoted;
  }else if(c===','&&!quoted){row.push(field);field='';}
  else if((c==='\n'||c==='\r')&&!quoted){row.push(field);result.push(row);row=[];field='';if(c==='\r'&&csv[i+1]==='\n')i++;}
  else field+=c;
 }
 row.push(field);result.push(row);return result;
}
function runExport(grant,extra={}){
 let saved;
 const context={grant,rows:[],pay:{list:[]},cal:{weeklyProjection:100},fmtDate:date=>date.toISOString().slice(0,10),
  download:(content,name,mime)=>{saved={content,name,mime};},say:()=>{},...extra};
 vm.runInNewContext(helpers+exportSource+'exportCSV();',context);
 const data=records(saved.content),start=data.findIndex(row=>row[0]==='GRANT MILESTONES');
 return {...saved,data,grantRows:data.slice(start+2),grantHeader:data[start+1]};
}

test('CSV exports each grant section with its own number, status and completion date',()=>{
 const milestone='Application for Federal Assistance Submitted';
 const result=runExport({milestones:{[milestone]:true},sections:[
  {id:'a',name:'FAA, AIP "2026"',type:'FAA AIP',grantNo:'3-28-001',done:{[milestone]:true},completionDates:{[milestone]:'2026-10-31'}},
  {id:'b',name:'FAA AIG',type:'FAA AIG',grantNo:'3-28-002',done:{[milestone]:false},completionDates:{}},
  {id:'c',name:'Local\rGrant',type:'Custom',grantNo:'L,1',items:['Site, ready','Quarterly Reports Submitted'],done:{'Site, ready':true,'Quarterly Report — Q2':true},completionDates:{'Site, ready':'2026-11-01','Quarterly Report — Q2':'2026-07-01'}}
 ]});
 assert.deepEqual(result.grantHeader,['Grant','GrantNumber','Milestone','Status','CompletionDate']);
 assert.deepEqual(result.grantRows.find(row=>row[0]==='FAA, AIP "2026"'&&row[2]===milestone),['FAA, AIP "2026"','3-28-001',milestone,'Complete','2026-10-31']);
 assert.deepEqual(result.grantRows.find(row=>row[0]==='FAA AIG'&&row[2]===milestone),['FAA AIG','3-28-002',milestone,'Pending','']);
 assert.deepEqual(result.grantRows.find(row=>row[2]==='Site, ready'),['Local\rGrant','L,1','Site, ready','Complete','2026-11-01']);
 assert.deepEqual(result.grantRows.find(row=>row[2]==='Quarterly Report — Q2'),['Local\rGrant','L,1','Quarterly Report — Q2','Complete','2026-07-01']);
 assert.equal(result.grantRows.filter(row=>row[2]?.startsWith('Quarterly Report —')).length,4);
 assert.equal(result.mime,'text/csv');
});

test('CSV retains legacy completion dates through shared migration helpers and respects removed grants',()=>{
 const legacy=runExport({milestones:{'Application Submitted':true},milestoneDates:{'Application Submitted':'2026-09-14'}});
 assert.deepEqual(legacy.grantRows.find(row=>row[2]==='Application for Federal Assistance Submitted'),['FAA AIG Grant Administration','','Application for Federal Assistance Submitted','Complete','2026-09-14']);
 const removed=runExport({sections:[],milestones:{'Application Submitted':true}});
 assert.equal(removed.grantRows.length,0);
});

test('grant export changes preserve weekly log and pay application CSV values',()=>{
 const result=runExport({sections:[]},{
  cal:{weeklyProjection:4000},
  rows:[{n:1,start:new Date('2026-10-01T12:00:00Z'),end:new Date('2026-10-07T12:00:00Z'),fyA:'FY27',fyB:'FY27',hasActual:true,spend:2800,weekVariance:-0.3,cumActual:2800,cumVariance:-0.3,daysLost:1,note:'Rain, then\nwind'}],
  pay:{list:[{number:1,periodEnd:'2026-10-31',work:1200,retPct:0.05,retainage:60,netPayable:1140,submitted:'2026-11-01',certified:'',paid:'',reimbRequested:'',reimbReceived:'',lagDays:null}]}
 });
 assert.deepEqual(result.data[2],['1','2026-10-01','2026-10-07','FY27','4000.00','2800','-30.00%','2800.00','-30.00%','1','Rain, then\nwind']);
 const payStart=result.data.findIndex(row=>row[0]==='PAY APPLICATIONS');
 assert.deepEqual(result.data[payStart+2],['1','2026-10-31','1200.00','5.0%','60.00','1140.00','2026-11-01','','','','','','']);
});
