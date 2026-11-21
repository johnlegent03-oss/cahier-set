// À charger APRÈS evaluations.js, dans un script classique (non module).
(function(){
 'use strict';
 const dirty=new WeakSet();
 function context(id,cls,period){
  const student=studentsCache.find(s=>String(s.id)===String(id));
  if(!id||!user?.id)throw new Error('Élève ou compte professeur non identifié.');
  return {id:String(id),cls:String(student?.classe||cls||''),period:String(period||'year'),name:student?studentDisplayName(student):String(studentTrackingStudent||''),year:schoolYearStartYear(new Date()),owner:String(user.id)};
 }
 function key(c){return 'svt.appreciation.saved.v2:'+JSON.stringify([c.owner,c.year,c.id,c.period]);}
 function status(el,text){
  if(!el)return;
  let target=el.parentElement.querySelector('[data-app-save-status]');
  if(!target){target=document.createElement('div');target.dataset.appSaveStatus='1';target.className='small-note';target.setAttribute('role','status');el.insertAdjacentElement('afterend',target);}
  target.textContent=text;
 }
 function save(c,value){
  const record={version:2,text:String(value||''),savedAt:new Date().toISOString(),...c};
  localStorage.setItem(key(c),JSON.stringify(record));
  const check=JSON.parse(localStorage.getItem(key(c))||'null');
  if(!check||check.text!==record.text)throw new Error('La sauvegarde locale n’a pas pu être confirmée.');
  return record;
 }
 function read(c,view){
  const raw=localStorage.getItem(key(c));
  if(raw!==null){const record=JSON.parse(raw);return record.text||'';}
  // Ne pas attribuer silencieusement les anciens textes à un compte ou une année.
  const classKeys=[`svt_appreciation_${c.cls}_${c.period}_${c.id}`,`svt_appreciation__${c.period}_${c.id}`];
  const individualKeys=[`svt_appreciation_${c.cls}_${c.name}_${c.period}`,`svt_appreciation__${c.name}_${c.period}`];
  const keys=view==='individual'?[...individualKeys,...classKeys]:[...classKeys,...individualKeys];
  for(const oldKey of keys){const old=localStorage.getItem(oldKey);if(old!==null)return old;}
  return '';
 }
 saveAppreciationDraft=function(){
  const el=document.getElementById('generatedAppreciation');if(!el)return;
  try{save(context(studentTrackingStudentId,studentTrackingClass,studentTrackingPeriod),el.value);dirty.delete(el);status(el,'Enregistré sur ce navigateur.');}
  catch(error){status(el,'Échec de l’enregistrement : '+error.message);alert(error.message);}
 };
 loadAppreciationDraft=function(){try{return read(context(studentTrackingStudentId,studentTrackingClass,studentTrackingPeriod),'individual');}catch(error){console.error(error);return '';}};
 saveAllClassAppreciations=function(){
  const fields=Array.from(document.querySelectorAll('.class-appreciation'));
  let done=0;
  for(const field of fields){
   try{save(context(field.dataset.studentId,classTrackingClass,classTrackingPeriod),field.value);dirty.delete(field);status(field,'Enregistré sur ce navigateur.');done++;}
   catch(error){status(field,'Échec : '+error.message);}
  }
  alert(done+' appréciations enregistrées sur ce navigateur sur '+fields.length+'.');
 };
 loadClassAppreciation=function(student){try{return read(context(student.id,student.classe||classTrackingClass,classTrackingPeriod),'class');}catch(error){console.error(error);return '';}};
 const generateIndividual=generateCurrentAppreciation;
 generateCurrentAppreciation=function(){
  const field=document.getElementById('generatedAppreciation');
  if(field?.value.trim()&&!confirm('Remplacer le texte affiché par une nouvelle proposition ? La version enregistrée reste conservée tant que tu ne cliques pas sur Enregistrer.'))return field.value;
  const text=generateIndividual();
  if(field){dirty.add(field);status(field,'Nouvelle proposition non enregistrée.');}
  return text;
 };
 const generateClass=generateAllClassAppreciations;
 generateAllClassAppreciations=function(){
  const fields=Array.from(document.querySelectorAll('.class-appreciation'));
  if(fields.some(f=>f.value.trim())&&!confirm('Remplacer toutes les appréciations affichées ? Les versions enregistrées restent conservées tant que tu ne cliques pas sur Enregistrer toutes.'))return;
  generateClass();fields.forEach(f=>{dirty.add(f);status(f,'Nouvelle proposition non enregistrée.');});
 };
 document.addEventListener('input',event=>{const el=event.target;if(el?.matches?.('#generatedAppreciation,.class-appreciation')){dirty.add(el);status(el,'Modifications non enregistrées.');}});
 function hasChanges(){return Array.from(document.querySelectorAll('#generatedAppreciation,.class-appreciation')).some(el=>dirty.has(el));}
 window.addEventListener('beforeunload',event=>{if(hasChanges()){event.preventDefault();event.returnValue='';}});
 // Protéger une édition contre le réaffichage différé des QCU de la même vue.
 const renderClass=renderClassTracking;
 renderClassTracking=function(){
  const fields=Array.from(document.querySelectorAll('.class-appreciation'));
  const snapshots=fields.filter(f=>dirty.has(f)).map(f=>({id:f.dataset.studentId,text:f.value}));
  const oldClass=document.querySelector('[data-app-view-context]')?.dataset.appViewContext;
  const current=JSON.stringify([classTrackingClass,classTrackingPeriod]);
  renderClass();
  const first=document.querySelector('.class-appreciation');
  if(first){first.dataset.appViewContext=current;}
  if(oldClass===current)for(const snapshot of snapshots){
   const field=Array.from(document.querySelectorAll('.class-appreciation')).find(f=>f.dataset.studentId===snapshot.id);
   if(field){field.value=snapshot.text;dirty.add(field);status(field,'Modifications non enregistrées.');const counter=field.parentElement.querySelector('.appreciation-count');if(counter)counter.textContent=field.value.length;}
  }
 };
})();
