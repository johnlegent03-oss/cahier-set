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
 const DRAFTS_PREFIX='[SVT:PREVISIONS:v1:';
 const draftsPattern=/^\[SVT:PREVISIONS:v1:([^\]\r\n]+)\](?:\r?\n|$)/;
 function normalizeLinks(values){
  const seen=new Set();
  return (Array.isArray(values)?values:[]).map(x=>String(x||'').trim()).filter(x=>{
   if(!x||x.length>160||seen.has(x))return false;
   seen.add(x);return true;
  }).slice(0,100);
 }
 function normalizeDrafts(values){
  return (Array.isArray(values)?values:[]).slice(0,60).map(item=>{
   const title=String(item?.title||'').trim().slice(0,160);
   const type=item?.type==='activite'?'activite':'seance';
   const detail=String(item?.detail||'').trim().slice(0,1500);
   return {type,title,detail};
  }).filter(item=>item.title);
 }
 function read(value){
  const raw=String(value??'');
  const match=raw.match(pattern);
  let detail=match?raw.slice(match[0].length):raw;
  let links=[],drafts=[];
  // Deux marqueurs éventuels (liens du cahier et préparations privées)
  // peuvent coexister sans toucher au texte libre ni aux anciennes données.
  for(let index=0;index<2;index++){
   const linked=detail.match(linksPattern);
   if(linked){
    try{links=normalizeLinks(JSON.parse(decodeURIComponent(linked[1])))}catch(_){links=[]}
    detail=detail.slice(linked[0].length);continue;
   }
   const draftTag=detail.match(draftsPattern);
   if(draftTag){
    try{drafts=normalizeDrafts(JSON.parse(decodeURIComponent(draftTag[1])))}catch(_){drafts=[]}
    detail=detail.slice(draftTag[0].length);continue;
   }
   break;
  }
  return {kind:match?match[1]:'cours',detail,links,drafts};
 }
 function write(kind,detail,links=[],drafts=[]){
  if(!byKey.has(kind))throw new Error('Type de créneau inconnu');
  const parts=[],ids=normalizeLinks(links),preparations=normalizeDrafts(drafts);
  if(ids.length)parts.push(LINKS_PREFIX+encodeURIComponent(JSON.stringify(ids))+']');
  if(preparations.length)parts.push(DRAFTS_PREFIX+encodeURIComponent(JSON.stringify(preparations))+']');
  const note=String(detail??'');
  if(note)parts.push(note);
  const tagged=parts.join('\n');
  return kind==='cours'?tagged:PREFIX+kind+']'+(tagged?'\n'+tagged:'');
 }
 function linkedIds(row){
  const primary=String(row?.cahier_planning_uid||'').trim();
  const links=read(row?.notes).links;
  return normalizeLinks([...links,...(primary&&!links.includes(primary)?[primary]:[])]);
 }
 function descriptor(kind){return byKey.get(kind)||byKey.get('cours')}
 function isSpecial(notes){return read(notes).kind!=='cours'}
 return {types:TYPES,read,write,linkedIds,normalizeLinks,normalizeDrafts,descriptor,isSpecial};
});