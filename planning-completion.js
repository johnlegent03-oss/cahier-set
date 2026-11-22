/* Phase 8 — prédicats de confirmation explicite, sans modification des données. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PlanningCompletion=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const dateOk=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s);
 const special=/^\[SVT:CRENEAU:v1:(evaluation|intervention|sortie|absence|autre)\](?:\r?\n|$)/;
 function eligible(row,today){
  return !!(row&&row.id&&dateOk(today)&&dateOk(row.session_date)&&
   row.session_date<=today&&row.status==='planned'&&!special.test(String(row.notes||'')));
 }
 function conditions(row,ownerId,periodId,today){
  if(!eligible(row,today)||!ownerId||!periodId)throw new Error('Ce créneau ne peut pas être confirmé comme effectué.');
  const fields=[
   ['id','eq',row.id],
   ['owner_id','eq',ownerId],
   ['period_id','eq',periodId],
   ['class_name','eq',row.class_name],
   ['session_date','eq',row.session_date],
   ['start_time','eq',row.start_time],
   ['end_time','eq',row.end_time],
   ['status','eq','planned']
  ];
  // Verrouiller aussi les notes : une intervention modifiée ailleurs
  // ne doit pas pouvoir être validée comme un cours classique.
  fields.push(row.notes==null?['notes','is',null]:['notes','eq',String(row.notes)]);
  return fields;
 }
 return {eligible,conditions};
});
