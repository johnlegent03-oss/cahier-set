/* Phase 9 — indicateurs des observations de comportement, sans élèves identifiables. */
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
 const isDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s);
 function summarize(rows,{className='',classes=[],fromDate='',toDate=''}={}){
  const counts={total:0,bavardage:0,materiel:0,travail:0,autres:0,participation:0};
  const allowed=new Set(classes.map(x=>String(x||'').trim()).filter(Boolean));
  for(const row of Array.isArray(rows)?rows:[]){
   if(!row)continue;
   const cls=String(row.classe||'').trim();
   if(!cls||className&&cls!==className||allowed.size&&!allowed.has(cls))continue;
   const date=String(row.date||'').slice(0,10);
   if(!isDate(date)||fromDate&&date<fromDate||toDate&&date>toDate)continue;
   const type=String(row.type||'');
   if(type==='participation'||type==='effort_progres'){counts.participation++;continue;}
   const category=known[type];
   if(category){counts[category]++;counts.total++;}
   // Ne pas compter les marqueurs d'envoi de mots et mentions,
   // ni les types inconnus comme des remarques négatives.
  }
  return counts;
 }
 return {summarize};
});
