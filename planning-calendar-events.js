/* Projection locale des événements personnels dans la semaine du planning.
   Fonction pure, indépendante de Supabase et de l'interface professeur. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PlanningCalendarEvents=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 function isoLocal(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 }
 function hhmm(d){
  return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
 }
 function weekCells(events,weekStart,days=5){
  const timed=[],allDay=[];
  const base=new Date(weekStart);
  if(!Number.isFinite(base.getTime()))return {timed,allDay};
  base.setHours(0,0,0,0);
  for(let i=0;i<days;i++){
   const begin=new Date(base);begin.setDate(begin.getDate()+i);
   const finish=new Date(begin);finish.setDate(finish.getDate()+1);
   const day=isoLocal(begin);
   for(const ev of events||[]){
    const start=new Date(ev.start_at),end=new Date(ev.end_at);
    if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start)continue;
    if(start>=finish||end<=begin)continue;
    const from=new Date(Math.max(start.getTime(),begin.getTime()));
    const to=new Date(Math.min(end.getTime(),finish.getTime()));
    const copy={id:ev.id,day,title:ev.title||'Événement',description:ev.description||'',
     class_name:ev.class_name||'',event_type:ev.event_type||'other',status:ev.status||'',
     from:hhmm(from),to:to.getTime()===finish.getTime()?'24:00':hhmm(to)};
    if(ev.all_day)allDay.push(copy);
    else timed.push(copy);
   }
  }
  timed.sort((a,b)=>a.day.localeCompare(b.day)||a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
  return {timed,allDay};
 }
 return {weekCells};
});
