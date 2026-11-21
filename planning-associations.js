/* Planification prudente : aperçu pur, sans aucune écriture en base. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PlanningBatch=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const schedulable=new Set(['planned','completed']);
  const dateOk=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
  const text=value=>String(value??'').trim();

  function plan({occurrences=[],sessions=[],className,fromDate,toDate,firstUid='',limit=40}={}){
    if(!text(className)||!dateOk(fromDate)||!dateOk(toDate)||fromDate>toDate)
      throw new Error('Choisis une classe et une période valide.');
    if(!Number.isInteger(limit)||limit<1||limit>100)
      throw new Error('Nombre maximal d’associations invalide.');
    const classRows=occurrences.filter(o=>o.class_name===className);
    const sorted=classRows.filter(o=>dateOk(o.session_date)&&o.session_date>=fromDate&&o.session_date<=toDate)
      .slice().sort((a,b)=>a.session_date.localeCompare(b.session_date)
        ||text(a.start_time).localeCompare(text(b.start_time))
        ||text(a.end_time).localeCompare(text(b.end_time))
        ||text(a.id).localeCompare(text(b.id)));
    const orderedSessions=sessions.filter(s=>text(s.uid))
      .slice().sort((a,b)=>(Number(a.chapterIndex)||0)-(Number(b.chapterIndex)||0)
        ||(Number(a.sessionIndex)||0)-(Number(b.sessionIndex)||0));
    const uids=new Set(),unique=[];
    for(const session of orderedSessions){
      if(uids.has(session.uid))throw new Error('Identifiants de séances dupliqués dans le cahier. Aucune association proposée.');
      uids.add(session.uid);unique.push(session);
    }
    const byUid=new Map(unique.map((s,i)=>[s.uid,i]));
    if(firstUid&&!byUid.has(firstUid))throw new Error('La séance de départ n’existe plus dans le cahier.');
    const alreadyLinked=new Set(classRows.map(o=>text(o.cahier_planning_uid)).filter(Boolean));
    let index=firstUid?byUid.get(firstUid):0;
    const items=[];
    const stats={existing:0,modified:0,cancelled:0,noMore:0,exceptions:0,alreadyUsed:alreadyLinked.size,candidates:unique.length};
    for(const occ of sorted){
      if(text(occ.cahier_planning_uid)){
        stats.existing++;
        const linkedIndex=byUid.get(occ.cahier_planning_uid);
        if(linkedIndex!==undefined)index=Math.max(index,linkedIndex+1);
        continue;
      }
      if(!schedulable.has(occ.status)){stats.cancelled++;continue;}
      if(/^\[SVT:CRENEAU:v1:(evaluation|intervention|sortie|absence|autre)\]/.test(text(occ.notes))){stats.exceptions++;continue;}
      // Par sécurité, ne jamais toucher aux créneaux déjà adaptés manuellement.
      if(occ.is_modified!==false){stats.modified++;continue;}
      if(!occ.id||!occ.start_time||!occ.end_time)continue;
      while(index<unique.length&&alreadyLinked.has(unique[index].uid))index++;
      if(index>=unique.length)stats.noMore++;
      if(items.length>=limit)break;
      const session=index<unique.length?unique[index++]:null;
      items.push({
        id:occ.id,class_name:className,session_date:occ.session_date,
        start_time:occ.start_time,end_time:occ.end_time,status:occ.status,
        uid:session?.uid||'',chapterTitle:session?.chapterTitle||'',
        sessionTitle:session?.sessionTitle||'',kind:'cours',detail:String(occ.notes??''),
        originalNotes:occ.notes??null
      });
    }
    return {items,stats,fromDate,toDate,className,firstUid,limit};
  }
  return {plan};
});
