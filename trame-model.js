/* Trame pédagogique SVT : référentiel indépendant des classes.
   Modèle partagé entre la trame, le planning et le cahier enseignant. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.SvtTrame=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const LEVELS=['6e','5e','4e','3e'];
 const CLASS_CODES={
  '6e1':'svt6e1-7kq4','6e2':'svt6e2-m8p2','6e3':'svt6e3-r5x9',
  '6e4':'svt6e4-n3v7','6e5':'svt6e5-t6h2',
  '5e1':'svt5e1-q9w4','5e3':'svt5e3-k2m8','5e5':'svt5e5-p7r3',
  '3e2':'svt3e2-x4n6','3e3':'svt3e3-b8q5','TEST':'test-lab-9x2k'
 };
 function uid(){
  if(typeof crypto!=='undefined'&&crypto.randomUUID)return crypto.randomUUID();
  throw new Error('Identifiant sécurisé indisponible sur ce navigateur.');
 }
 const text=(value,max=180)=>String(value??'').trim().slice(0,max);
 const validId=value=>UUID.test(String(value||''))?String(value):uid();
 function normalize(source){
  const chapters=Array.isArray(source?.chapitres)?source.chapitres:[];
  const seen=new Set();
  function unique(value){
   let id=validId(value);
   while(seen.has(id)){id=uid()}
   seen.add(id);return id;
  }
  return {chapitres:chapters.slice(0,100).map(ch=>({
   id:unique(ch?.id),titre:text(ch?.titre,180),objectif:text(ch?.objectif,1200),
   seances:(Array.isArray(ch?.seances)?ch.seances:[]).slice(0,100).map(se=>({
    id:unique(se?.id),titre:text(se?.titre,180),probleme:text(se?.probleme,1200),
    activites:(Array.isArray(se?.activites)?se.activites:[]).slice(0,100).flatMap(a=>{
     const docId=text(a?.docId,60);
     return UUID.test(docId)?[{id:unique(a?.id),docId,title:text(a?.title,200)}]:[];
    })
   }))
  }))};
 }
 function flatten(content,niveau){
  const data=normalize(content);
  const items=[];
  for(const [chapterIndex,ch] of data.chapitres.entries()){
   for(const [sessionIndex,se] of ch.seances.entries()){
    const parentUid='trame-session:'+se.id;
    const session={uid:parentUid,type:'trame-session',niveau,chapterTitle:ch.titre||'Chapitre',
      sessionTitle:se.titre||'Séance',chapterId:ch.id,sessionId:se.id,
      problem:se.probleme,chapterIndex:800000+chapterIndex,sessionIndex,activities:se.activites.map(a=>({
       uid:'trame-activity:'+se.id+':'+a.docId,type:'trame-activity',niveau,docId:a.docId,
       chapterTitle:ch.titre||'Chapitre',sessionTitle:a.title||'Activité de l’atelier',
       parentSessionTitle:se.titre||'Séance',sessionUid:parentUid,chapterIndex:800000+chapterIndex,sessionIndex
      }))};
    items.push(session,...session.activities);
   }
  }
  return items;
 }
 function levelForClass(className){
  const name=String(className||'');
  return LEVELS.find(level=>name.startsWith(level))||null;
 }
 function findChapter(content,id){
  return normalize(content).chapitres.find(ch=>ch.id===id)||null;
 }
 function findSession(content,id){
  for(const ch of normalize(content).chapitres){
   const se=ch.seances.find(s=>s.id===id);
   if(se)return {chapter:ch,session:se};
  }
  return null;
 }
 function escapeHtml(value){
  return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 }
 function entriesForSession(se,className,includeActivities){
  if(!includeActivities)return [];
  const code=CLASS_CODES[className];
  if(!code)throw new Error('Code du cahier absent pour '+className+'.');
  return se.activites.map((a,i)=>({
   date:'',ordre:i,atelier_document_id:a.docId,pdf:'',
   texte:'<a href="./fiche.html?code='+encodeURIComponent(code)+'&doc='+encodeURIComponent(a.docId)+
    '" target="_blank" rel="noopener noreferrer">'+escapeHtml(a.title||'Activité')+' — Ouvrir la fiche ↗</a>'
  }));
 }
 function toCahierSession(se,className,includeActivities=false){
  return {trame_ref:se.id,titre:escapeHtml(se.titre||'Séance'),problematique:escapeHtml(se.probleme||''),
   activites:entriesForSession(se,className,includeActivities),corrections:[],bilans:[]};
 }
 function toCahierChapter(ch,className,includeActivities=false){
  return {trame_ref:ch.id,titre:escapeHtml(ch.titre||'Chapitre'),problematique:escapeHtml(ch.objectif||''),
   seances:ch.seances.map(se=>toCahierSession(se,className,includeActivities))};
 }
 async function read(sb,userId,niveau){
  if(!LEVELS.includes(niveau))throw new Error('Niveau inconnu.');
  const {data,error}=await sb.from('svt_trames').select('contenu,version,updated_at')
   .eq('owner_id',userId).eq('niveau',niveau).maybeSingle();
  if(error)throw error;
  return {data:normalize(data?.contenu),version:data?.version||0,exists:!!data};
 }
 async function save(sb,userId,niveau,content,version){
  if(!LEVELS.includes(niveau))throw new Error('Niveau inconnu.');
  const contenu=normalize(content);
  if(version===0){
   const {data,error}=await sb.from('svt_trames')
    .insert({owner_id:userId,niveau,contenu,version:1,updated_at:new Date().toISOString()})
    .select('version').maybeSingle();
   if(error)throw error;
   if(data?.version!==1)throw new Error('La trame n’a pas été enregistrée.');
   return 1;
  }
  const {data,error}=await sb.from('svt_trames')
   .update({contenu,version:version+1,updated_at:new Date().toISOString()})
   .eq('owner_id',userId).eq('niveau',niveau).eq('version',version)
   .select('version').maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('La trame a été modifiée dans un autre onglet. Aucune donnée distante écrasée : recharge après avoir conservé tes modifications.');
  return data.version;
 }
 return {LEVELS,CLASS_CODES,normalize,flatten,uid,levelForClass,findChapter,findSession,toCahierChapter,toCahierSession,read,save,escapeHtml};
});
