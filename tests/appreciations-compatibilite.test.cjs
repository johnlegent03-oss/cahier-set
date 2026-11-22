// Stabilisation V1 : préserver les anciennes appréciations avant déploiement.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','appreciations-stockage.js'),'utf8');
const evalJs=fs.readFileSync(path.join(__dirname,'..','evaluations.js'),'utf8');

function makeFixture(initial={}){
 const map=new Map(Object.entries(initial));
 const fields=[];
 const student={id:'eleve-42',nom:'DURAND',prenom:'Ambre',classe:'6e2'};
 const ctx={
  studentsCache:[student], user:{id:'prof-1'},
  studentTrackingStudent:'DURAND Ambre',studentTrackingStudentId:'eleve-42',
  studentTrackingClass:'6e2',studentTrackingPeriod:'t1',
  classTrackingClass:'6e2',classTrackingPeriod:'t1',
  studentDisplayName:s=>s.nom+' '+s.prenom,
  schoolYearStartYear:()=>2026,
  localStorage:{
   getItem:k=>map.has(k)?map.get(k):null,
   setItem:(k,v)=>map.set(k,String(v))
  },
  document:{
   querySelectorAll:()=>fields,
   addEventListener:()=>{},
   createElement:()=>({dataset:{},className:'',textContent:'',setAttribute:()=>{}}),
   getElementById:()=>null,
  },
  window:{addEventListener:()=>{}},
  renderClassTracking:()=>{},
  saveAppreciationDraft:()=>{},
  loadAppreciationDraft:()=>{},
  saveAllClassAppreciations:()=>{},
  loadClassAppreciation:()=>{},
  generateCurrentAppreciation:()=>{},
  generateAllClassAppreciations:()=>{},
  alert:()=>{},confirm:()=>true,console,
 };
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {ctx,map,student,fields};
}
test('lecture ancienne sauvegarde de classe T1 à clé élève sans perte',()=>{
 const key='svt_appreciation_6e2_t1_eleve-42';
 const f=makeFixture({[key]:'Ambre présente un bilan satisfaisant.'});
 assert.equal(f.ctx.loadClassAppreciation(f.student),'Ambre présente un bilan satisfaisant.');
 assert.equal(f.map.get(key),'Ambre présente un bilan satisfaisant.');
});
test('lecture ancienne sauvegarde individuelle, avec nom complet et trimestre',()=>{
 const key='svt_appreciation_6e2_DURAND Ambre_t1';
 const f=makeFixture({[key]:'Le bilan d’Ambre est positif.'});
 assert.equal(f.ctx.loadAppreciationDraft(),'Le bilan d’Ambre est positif.');
 assert.equal(f.map.get(key),'Le bilan d’Ambre est positif.');
});
test('l enregistrement V2 conserve les anciennes clés et leur contenu',()=>{
 const key='svt_appreciation_6e2_t1_eleve-42';
 const f=makeFixture({[key]:'Texte historique'});
 const field={
  dataset:{studentId:'eleve-42'},
  value:'Nouveau texte validé',
  parentElement:{querySelector:()=>null,appendChild:()=>{}}
 };
 f.fields.push(field);
 f.ctx.saveAllClassAppreciations();
 assert.equal(f.map.get(key),'Texte historique');
 const newKey='svt.appreciation.saved.v2:'+JSON.stringify(['prof-1',2026,'eleve-42','t1']);
 assert.equal(JSON.parse(f.map.get(newKey)).text,'Nouveau texte validé');
 assert.equal(f.ctx.loadClassAppreciation(f.student),'Nouveau texte validé');
});
test('aucun v2 ne peut réattribuer une appréciation à un autre utilisateur',()=>{
 const key='svt.appreciation.saved.v2:'+JSON.stringify(['prof-1',2026,'eleve-42','t1']);
 const f=makeFixture({[key]:JSON.stringify({text:'Texte prof 1'})});
 assert.equal(f.ctx.loadClassAppreciation(f.student),'Texte prof 1');
 f.ctx.user.id='prof-2';
 assert.equal(f.ctx.loadClassAppreciation(f.student),'');
});
test('appréciation générale de classe : l ancien format local reste présent',()=>{
 assert.match(evalJs,/svt_appreciation_classe_\$\{classTrackingClass\|\|"toutes"\}_\$\{classTrackingPeriod\}/);
 assert.match(evalJs,/function loadGeneralClassAppreciation\(\).*localStorage\.getItem\(classGeneralAppreciationStorageKey\(\)\)/);
});
