// Moteur local validé par le tableur — charger après evaluations.js.
(function(){
 let used=null;
 const number=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
 function flagKey(id){return 'svt.appreciation.cycle-not-assessable.v1:'+String(user?.id||'')+':'+String(id);}
 function explicitFlag(id){try{return !!id&&localStorage.getItem(flagKey(id))==='1';}catch(e){return false;}}
 function adapted(id){try{return typeof svtAccommodationEnabled==='function'&&svtAccommodationEnabled(id);}catch(e){return false;}}
 function select(seed,key,arr){return svtAppPick(seed,key,arr);}
 function build(d,attempt){
  const seed=String(d.seed||'')+'|'+attempt,avg=number(d.average);
  const level=avg===null?null:avg>=18?'excellent':avg>=16?'très bon':avg>=12?'bon':avg>=10?'correct':avg>=6?'fragile':'inquiétant';
  const name=String(d.name||'').trim();
  let opening='Les résultats disponibles ne permettent pas encore d’établir un bilan suffisamment précis.';
  if(level){
   if(level==='inquiétant')opening='Les résultats obtenus ce trimestre sont très insuffisants.';
   else {
    const options={excellent:['Un excellent trimestre, marqué par des résultats très satisfaisants.','Le bilan de ce trimestre est excellent.'], 'très bon':['Un très bon trimestre, avec des résultats particulièrement satisfaisants.','Le travail réalisé ce trimestre aboutit à un très bon bilan.'], bon:['Un bon trimestre dans l’ensemble.','Le bilan de ce trimestre est satisfaisant.'], correct:['Les résultats sont convenables, mais peuvent encore progresser.','Le bilan est correct, même si certains acquis restent à consolider.'], fragile:['Le bilan de ce trimestre reste fragile.','Les résultats demeurent fragiles ce trimestre.']};
    opening=select(seed,'opening',options[level]||['Le bilan de ce trimestre reste à préciser.']);
   }
  }
  const values=(d.competencies||[]).map(x=>number(x.average)).filter(x=>x!==null&&x>=1&&x<=4);
  const mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const weak=values.filter(x=>x<2.5).length;
  const singleHigh=avg!==null&&avg>=16&&values.length>1&&weak===1;
  let mastery;
  if(d.cycleNotAssessable)mastery='Les difficultés ne permettent pas d’évaluer les compétences du cycle.';
  else if(!values.length)mastery='';
  else if(singleHigh)mastery='Les compétences sont globalement maîtrisées.';
  else if(values.every(x=>x>=3.5))mastery='L’ensemble des compétences évaluées est très bien maîtrisé.';
  else if(mean>=2.7&&!weak)mastery='Les compétences évaluées sont globalement bien maîtrisées.';
  else if(mean>=2.7)mastery='Les compétences sont globalement maîtrisées, avec quelques points encore à consolider.';
  else if(mean>=2)mastery=select(seed,'mastery',['La maîtrise des compétences reste inégale.','Des acquis sont présents, mais plusieurs compétences restent à consolider.']);
  else mastery='Les compétences évaluées restent à consolider.';
  // Les aménagements sont pris en compte dans l'analyse, sans être exposés inutilement dans le bulletin.
  // Une appréciation ne doit pas signaler leur existence si cela n'apporte rien au bilan pédagogique.
  const counts={};for(const e of d.events||[]){const t=String(e.type||'');if(t.startsWith('message_envoye')||t.startsWith('mention_envoyee'))continue;counts[t]=(counts[t]||0)+1;}
  const p=counts.participation||0;
  const participation=p>=3?'La participation en classe est régulière et constructive.':'';
  const actions=[];
  if((counts.bavardage||0)>=2)actions.push('limiter les bavardages et se concentrer davantage en classe');
  if((counts.travail_non_fait||0)+(counts.devoir_oublie||0)>=2)actions.push('réaliser régulièrement les travaux demandés');
  if((counts.manque_ecoute||0)>=2||(counts.non_respect_consignes||0)>=2)actions.push('mieux suivre les consignes');
  if((counts.oubli_materiel||0)>=3)actions.push('apporter le matériel nécessaire');
  const join=a=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+' et '+a[a.length-1];
  const qcu=number(d.qcuAverage);
  let advice;
  if(actions.length)advice='Il faudra toutefois '+join(actions)+'.';
  else if(d.cycleNotAssessable)advice='Il convient de poursuivre les apprentissages avec un accompagnement adapté.';
  else if(singleHigh)advice='Ce très bon bilan récompense un travail sérieux ; il faut poursuivre dans cette voie.';
  else if(weak)advice=select(seed,'advice',['Un entraînement régulier permettra de consolider les acquis encore fragiles.','La reprise des exercices corrigés et un travail régulier aideront à mieux mobiliser les notions étudiées.']);
  else if(qcu!==null&&qcu<10)advice='Des révisions régulières et espacées sont nécessaires pour mieux mémoriser les connaissances.';
  else if(avg===null&&!values.length)advice='Les prochaines évaluations permettront de mieux apprécier les acquis.';
  else advice=avg!==null&&avg>=16?'Ce très bon bilan témoigne d’un travail de qualité, à poursuivre.':'';
  const effort=(counts.effort_progres||0)>=2?'Les efforts fournis et les progrès constatés sont encourageants.':'';
  let parts=select(seed,'order',[false,true])?[opening,participation,mastery,effort,advice]:[opening,mastery,participation,effort,advice];
  const pack=a=>a.filter(Boolean).join(' ');
  if(pack(parts).length<=400)return pack(parts);
  parts=parts.filter(x=>x!==effort);
  if(pack(parts).length<=400)return pack(parts);
  const shortIntro=level?(level==='inquiétant'?'Résultats très insuffisants.':`Bilan ${level}.`):'Bilan encore incomplet.';
  const shortAdvice=actions.length?'Il faudra '+join(actions)+'.':singleHigh?'Ce très bon bilan est à poursuivre.':d.cycleNotAssessable?'Les apprentissages sont à poursuivre avec un accompagnement adapté.':weak?'Un entraînement régulier aidera à consolider les acquis.':advice;
  const short=pack([shortIntro,mastery,participation,shortAdvice]);
  if(short.length<=400)return short;
  // Compacter sans supprimer les seuils comportementaux ou la mention d’aménagements.
  const compactActions=actions.map(x=>x.replace('limiter les bavardages et se concentrer davantage en classe','réduire les bavardages et mieux se concentrer').replace('réaliser régulièrement les travaux demandés','faire les travaux demandés').replace('apporter le matériel nécessaire','apporter le matériel'));
  const compactAdvice=compactActions.length?'Il faudra '+join(compactActions)+'.':shortAdvice;
  const result=pack([shortIntro,mastery,participation,compactAdvice]);
  if(result.length<=400)return result;
  return pack([mastery,participation,compactAdvice]);
 }
 svtAppCompose=function(data){
  let best=build(data,0),least=Infinity;
  if(used){for(let i=0;i<64;i++){
   const candidate=build(data,i),key=data.name?candidate.split(String(data.name)).join('[élève]'):candidate;
   const count=used.get(key)||0;if(count<least){least=count;best=candidate;}if(count===0)break;
  }const key=data.name?best.split(String(data.name)).join('[élève]'):best;used.set(key,(used.get(key)||0)+1);}
  return best;
 };
 const oldData=svtAppData;
 svtAppData=function(rows,qcu,events,seed,name){const data=oldData(rows,qcu,events,seed,name);const id=String(seed||'').split('|')[0];return {...data,accommodations:adapted(id),cycleNotAssessable:explicitFlag(id)};};
 const oldIndividual=behaviorGenerateAppreciation;
 // Le choix explicite fonctionne aussi si le point d’entrée individuel ne passe pas l’identifiant dans seed.
 behaviorGenerateAppreciation=function(events,competencies,rows,qcu){
  const student=studentsCache.find(x=>String(x.id)===String(studentTrackingStudentId));
  const data=svtAppData(rows||[],qcu||[],events||[],String(studentTrackingStudentId)+'|'+studentTrackingPeriod,student?.prenom||'');
  data.competencies=competencies||[];data.cycleNotAssessable=explicitFlag(studentTrackingStudentId);data.accommodations=adapted(studentTrackingStudentId);return svtAppCompose(data);
 };
 const oldBatch=generateAllClassAppreciations;
 generateAllClassAppreciations=function(){used=new Map();try{return oldBatch();}finally{used=null;}};
 function controls(){
  const fields=[...document.querySelectorAll('.class-appreciation'),...document.querySelectorAll('#generatedAppreciation')];
  fields.forEach(field=>{
   const id=field.dataset.studentId||(field.id==='generatedAppreciation'?studentTrackingStudentId:'');if(!id||field.parentElement.querySelector('[data-cycle-choice]'))return;
   const label=document.createElement('label');label.style.cssText='display:flex;gap:7px;align-items:center;margin:7px 0;font-weight:normal';
   const check=document.createElement('input');check.type='checkbox';check.dataset.cycleChoice=String(id);check.checked=explicitFlag(id);
   check.addEventListener('change',()=>{try{localStorage.setItem(flagKey(id),check.checked?'1':'0');}catch(error){check.checked=!check.checked;alert('Impossible de mémoriser le choix sur ce navigateur.');}});
   label.append(check,document.createTextNode('Mentionner que les difficultés ne permettent pas d’évaluer les compétences du cycle'));
   field.insertAdjacentElement('beforebegin',label);
  });
 }
 for(const name of ['renderStudentTracking','renderClassTracking']){
  if(name==='renderStudentTracking'){const old=renderStudentTracking;renderStudentTracking=function(){const result=old.apply(this,arguments);controls();return result;};}
  else {const old=renderClassTracking;renderClassTracking=function(){const result=old.apply(this,arguments);controls();return result;};}
 }
 controls();
})();
