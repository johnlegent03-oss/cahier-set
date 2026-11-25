/* Phase 7 — suivi pédagogique calculé localement, aucune écriture réseau. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PlanningFollowup=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const dateOk=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s);
 const special=/^\[SVT:CRENEAU:v1:(evaluation|intervention|sortie|absence|autre)\](?:\r?\n|$)/;
 const linkedIds=row=>{
  const primary=String(row?.cahier_planning_uid||'').trim();
  const prefix=String(row?.notes||'').replace(special,'');
  const match=prefix.match(/^\[SVT:LIENS:v1:([^\]\r\n]+)\](?:\r?\n|$)/);
  let ids=[];
  if(match){try{const value=JSON.parse(decodeURIComponent(match[1]));if(Array.isArray(value))ids=value.filter(x=>typeof x==='string'&&x.length<=160)}catch(_){}}
  return [...new Set([...ids,...(primary?[primary]:[])])];
 };
 const draftPreview=notes=>{
  let text=String(notes||'').replace(special,'');
  const links=text.match(/^\[SVT:LIENS:v1:([^\]\r\n]+)\](?:\r?\n|$)/);
  if(links)text=text.slice(links[0].length);
  const tag=text.match(/^\[SVT:PREVISIONS:v1:([^\]\r\n]+)\](?:\r?\n|$)/);
  if(!tag)return [];
  try{
   const values=JSON.parse(decodeURIComponent(tag[1]));
   return Array.isArray(values)?values.filter(item=>item&&typeof item.title==='string'&&item.title.trim()).slice(0,60):[];
  }catch(_){return []}
 };
 const kindFor=notes=>{
  const match=String(notes||'').match(special);
  return match?match[1]:'cours';
 };
 function summarize({occurrences=[],className='',today,fromDate='',toDate='',sessions=null}={}){
  if(!dateOk(today))throw new Error('Date de référence invalide pour le suivi pédagogique.');
  if(fromDate&&!dateOk(fromDate)||toDate&&!dateOk(toDate))
   throw new Error('Période du suivi invalide.');
  const counts={total:0,completed:0,upcoming:0,toConfirm:0,missing:0,linked:0,
   special:0,prepared:0,postponed:0,cancelled:0};
  const rows=[];
  for(const row of occurrences){
   if(!row||(!row.id)||!dateOk(row.session_date)||className&&row.class_name!==className)continue;
   if(fromDate&&row.session_date<fromDate||toDate&&row.session_date>toDate)continue;
   const kind=kindFor(row.notes);
   const status=String(row.status||'');
   let stage='';
   if(kind!=='cours')stage='special';
   else if(status==='cancelled')stage='cancelled';
   else if(status==='postponed')stage='postponed';
   else if(status==='completed')stage='completed';
   else if(status==='planned'&&row.session_date<today)stage='toConfirm';
   else if(status==='planned')stage='upcoming';
   else stage='toConfirm';
   counts.total++;counts[stage]++;
   const linked=linkedIds(row).length>0;
   if(linked)counts.linked++;
   const drafts=draftPreview(row.notes);
   const prepared=drafts.length>0;
   if(prepared)counts.prepared++;
   const missing=kind==='cours'&&['planned','completed',''].includes(status)&&!linked&&!prepared;
   if(missing)counts.missing++;
   rows.push({
    id:row.id,class_name:row.class_name,session_date:row.session_date,
    start_time:String(row.start_time||'').slice(0,5),
    end_time:String(row.end_time||'').slice(0,5),
    stage,kind,status,linked,missing,prepared,draftTitle:prepared?String(drafts[0].title).trim():'',draftCount:drafts.length,
    uid:linked?linkedIds(row)[0]:'',notes:String(row.notes||'')
   });
  }
  rows.sort((a,b)=>a.session_date.localeCompare(b.session_date)||
   a.start_time.localeCompare(b.start_time)||a.class_name.localeCompare(b.class_name)||String(a.id).localeCompare(String(b.id)));
  const report={counts,rows};
  if(Array.isArray(sessions)&&className){
   const linkedSessionIds=new Set(occurrences.filter(o=>o.class_name===className)
    .flatMap(o=>linkedIds(o)));
   const unique=new Map();
   for(const session of sessions){
    const uid=String(session?.uid||'').trim();
    if(uid&&!unique.has(uid))unique.set(uid,session);
   }
   report.sessions={total:unique.size,
    placed:[...unique.values()].filter(s=>linkedSessionIds.has(String(s.uid))).length,
    unplaced:[...unique.values()].filter(s=>!linkedSessionIds.has(String(s.uid)))};
  }
  return report;
 }
 return {summarize,kindFor};
});
