/* Type de créneau : métadonnée optionnelle dans notes, sans migration SQL. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PlanningKinds=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const TYPES=[
  {value:'cours',label:'Cours / séance du cahier',icon:'📘'},
  {value:'evaluation',label:'Évaluation',icon:'📝'},
  {value:'intervention',label:'Intervention',icon:'🎤'},
  {value:'sortie',label:'Sortie / voyage scolaire',icon:'🚌'},
  {value:'absence',label:'Absence / déplacement',icon:'🚫'},
  {value:'autre',label:'Autre activité',icon:'📌'}
 ];
 const byKey=new Map(TYPES.map(item=>[item.value,item]));
 const PREFIX='[SVT:CRENEAU:v1:';
 const pattern=/^\[SVT:CRENEAU:v1:(evaluation|intervention|sortie|absence|autre)\](?:\r?\n|$)/;
 function read(value){
  const raw=String(value??'');
  const match=raw.match(pattern);
  return {kind:match?match[1]:'cours',detail:match?raw.slice(match[0].length):raw};
 }
 function write(kind,detail){
  if(!byKey.has(kind))throw new Error('Type de créneau inconnu');
  const text=String(detail??'');
  return kind==='cours'?text:PREFIX+kind+']'+(text?'\n'+text:'');
 }
 function descriptor(kind){return byKey.get(kind)||byKey.get('cours')}
 function isSpecial(notes){return read(notes).kind!=='cours'}
 return {types:TYPES,read,write,descriptor,isSpecial};
});
