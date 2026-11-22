/* Phase 10 — remarques associées à leur vraie date scolaire (Europe/Paris).
   Calcul local et lecture seule : aucune création de données ni identification d’élèves. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PlanningRemarks=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const known={
  bavardage:'bavardage',oubli_materiel:'materiel',travail_non_fait:'travail',
  devoir_oublie:'autres',manque_ecoute:'autres',non_respect_consignes:'autres'
 };
 const datePattern=/^\d{4}-\d{2}-\d{2}$/;
 const blank=()=>({total:0,bavardage:0,materiel:0,travail:0,autres:0,participation:0});
 // La colonne date est un timestamptz. La date de cours doit être celle
 // du calendrier français (et non la date UTC de l'enregistrement).
 function frenchDate(value){
  const raw=String(value||'').trim();
  if(datePattern.test(raw))return raw;
  if(!raw)return '';
  const instant=new Date(raw);
  if(!Number.isFinite(instant.getTime()))return '';
  const parts=new Intl.DateTimeFormat('en-GB',{
   timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(instant);
  const get=type=>parts.find(p=>p.type===type)?.value||'';
  const day=get('day'),month=get('month'),year=get('year');
  return year&&month&&day?year+'-'+month+'-'+day:'';
 }
 function category(type){
  if(type==='participation'||type==='effort_progres')return 'participation';
  return known[type]||'';
 }
 function filtered(rows,{className='',classes=[],fromDate='',toDate=''}={}){
  const allowed=new Set(classes.map(x=>String(x||'').trim()).filter(Boolean));
  const result=[];
  for(const row of Array.isArray(rows)?rows:[]){
   if(!row)continue;
   const cls=String(row.classe||'').trim();
   if(!cls||className&&cls!==className||allowed.size&&!allowed.has(cls))continue;
   const day=frenchDate(row.date);
   if(!datePattern.test(day)||fromDate&&day<fromDate||toDate&&day>toDate)continue;
   const kind=category(String(row.type||''));
   if(!kind)continue; // ni mot envoyé ni mention, ni type inconnu
   result.push({classe:cls,date:day,category:kind});
  }
  return result;
 }
 function increment(counts,categoryName){
  counts[categoryName]++;
  if(categoryName!=='participation')counts.total++;
 }
 function summarize(rows,options={}){
  const counts=blank();
  for(const x of filtered(rows,options))increment(counts,x.category);
  return counts;
 }
 // Un agrégat distinct par couple date + classe : aucune attribution
 // fictive à un cours ou à un horaire lorsqu'il y en a plusieurs.
 function byDate(rows,options={}){
  const groups=new Map();
  for(const x of filtered(rows,options)){
   const key=x.date+'|'+x.classe;
   if(!groups.has(key))groups.set(key,{date:x.date,classe:x.classe,counts:blank()});
   increment(groups.get(key).counts,x.category);
  }
  return [...groups.values()].sort((a,b)=>
   b.date.localeCompare(a.date)||a.classe.localeCompare(b.classe,'fr',{numeric:true,sensitivity:'base'})
  );
 }
 // Couvrir l'intervalle Paris sans perdre les événements proches de minuit UTC.
 // L'exclusion exacte se fait ensuite à l'aide de frenchDate.
 function utcFetchBounds(fromDate,toDate){
  if(!datePattern.test(fromDate)||!datePattern.test(toDate)||fromDate>toDate)
   throw new Error('Dates de période invalides.');
  const begin=new Date(fromDate+'T00:00:00Z');
  begin.setUTCDate(begin.getUTCDate()-1);
  const end=new Date(toDate+'T00:00:00Z');
  end.setUTCDate(end.getUTCDate()+1);
  return {from:begin.toISOString(),toExclusive:end.toISOString()};
 }
 return {summarize,byDate,frenchDate,utcFetchBounds};
});
