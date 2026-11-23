/* Types de créneaux et liens multiples vers les éléments du cahier.
   Stockage rétrocompatible dans notes : aucun changement de schéma SQL. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PlanningKinds=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const TYPES=[
  {value:'cours',label:'Cours / activité du cahier',icon:'📘'},
  {value:'evaluation',label:'Évaluation',icon:'📝'},
  {value:'intervention',label:'Intervention',icon:'🎤'},
  {value:'sortie',label:'Sortie / voyage scolaire',icon:'🚌'},
  {value:'absence',label:'Absence / déplacement',icon:'🚫'},
  {value:'autre',label:'Autre activité',icon:'📌'}
 ];
 const byKey=new Map(TYPES.map(item=>[item.value,item]));
 const PREFIX='[SVT:CRENEAU:v1:';
 const pattern=/^\[SVT:CRENEAU:v1:(evaluation|intervention|sortie|absence|autre)\](?:\r?\n|$)/;
 const LINKS_PREFIX='[SVT:LIENS:v1:';
 const linksPattern=/^\[SVT:LIENS:v1:([^\]\r\n]+)\](?:\r?\n|$)/;
 function normalizeLinks(values){
  const seen=new Set();
  return (Array.isArray(values)?values:[]).map(x=>String(x||'').trim()).filter(x=>{
   if(!x||x.length>160||seen.has(x))return false;
   seen.add(x);return true;
  }).slice(0,100);
 }
 function read(value){
  const raw=String(value??'');
  const match=raw.match(pattern);
  let detail=match?raw.slice(match[0].length):raw;
  let links=[];
  const matchLinks=detail.match(linksPattern);
  if(matchLinks){
   try{links=normalizeLinks(JSON.parse(decodeURIComponent(matchLinks[1])))}catch(_){links=[]}
   detail=detail.slice(matchLinks[0].length);
  }
  return {kind:match?match[1]:'cours',detail,links};
 }
 function write(kind,detail,links=[]){
  if(!byKey.has(kind))throw new Error('Type de créneau inconnu');
  const text=String(detail??'');
  const ids=normalizeLinks(links);
  const tagged=ids.length?LINKS_PREFIX+encodeURIComponent(JSON.stringify(ids))+']'+(text?'\n'+text:''):text;
  return kind==='cours'?tagged:PREFIX+kind+']'+(tagged?'\n'+tagged:'');
 }
 function linkedIds(row){
  const primary=String(row?.cahier_planning_uid||'').trim();
  const links=read(row?.notes).links;
  return normalizeLinks([...links,...(primary&&!links.includes(primary)?[primary]:[])]);
 }
 function descriptor(kind){return byKey.get(kind)||byKey.get('cours')}
 function isSpecial(notes){return read(notes).kind!=='cours'}
 return {types:TYPES,read,write,linkedIds,normalizeLinks,descriptor,isSpecial};
});