// Phase 7 : calcul du suivi pédagogique, sans requête ni écriture Supabase.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {summarize}=require('../planning-followup.js');
const occ=(id,date,status='planned',extras={})=>({
 id,class_name:'6e2',session_date:date,start_time:'10:40:00',end_time:'11:30:00',
 status,cahier_planning_uid:null,notes:null,...extras
});
const calc=(occurrences,extra={})=>summarize({occurrences,today:'2026-11-22',...extra});
test('un cours passé mais prévu ne devient jamais effectué automatiquement',()=>{
 const {counts,rows}=calc([occ('old','2026-11-18')]);
 assert.equal(counts.completed,0);
 assert.equal(counts.toConfirm,1);
 assert.equal(counts.missing,1);
 assert.equal(rows[0].stage,'toConfirm');
});
test('seul le statut completed confirme un cours effectivement réalisé',()=>{
 const {counts,rows}=calc([occ('done','2026-11-17','completed',{cahier_planning_uid:'uid-4'})]);
 assert.equal(counts.completed,1);
 assert.equal(counts.linked,1);
 assert.equal(counts.missing,0);
 assert.equal(rows[0].stage,'completed');
});
test('les cours futurs sont à venir, qu’ils soient associés ou non',()=>{
 const {counts}=calc([occ('tomorrow','2026-11-24'),occ('today','2026-11-22')]);
 assert.equal(counts.upcoming,2);
 assert.equal(counts.missing,2);
});
test('les évaluations, interventions et déplacements ne sont pas signalés comme séances manquantes',()=>{
 const specials=['evaluation','intervention','sortie','absence','autre'];
 const {counts}=calc(specials.map((kind,i)=>occ('sp'+i,'2026-11-20','completed',{
  notes:'[SVT:CRENEAU:v1:'+kind+']\nÉvénement',cahier_planning_uid:null
 })));
 assert.equal(counts.special,5);
 assert.equal(counts.missing,0);
 assert.equal(counts.completed,0);
});
test('les cours annulés et reportés ne polluent pas les tâches sans liaison',()=>{
 const {counts}=calc([occ('cancelled','2026-11-23','cancelled'),occ('postponed','2026-11-23','postponed')]);
 assert.equal(counts.cancelled,1);
 assert.equal(counts.postponed,1);
 assert.equal(counts.missing,0);
});
test('l’état et l’absence de liaison se comptent indépendamment',()=>{
 const {counts}=calc([
  occ('1','2026-11-23','planned',{cahier_planning_uid:'uid'}),
  occ('2','2026-11-20','completed'),
  occ('3','2026-11-19','planned')
 ]);
 assert.equal(counts.total,3);
 assert.equal(counts.linked,1);
 assert.equal(counts.missing,2);
 assert.equal(counts.completed,1);
 assert.equal(counts.toConfirm,1);
});
test('filtrage de la classe et des dates de période',()=>{
 const {counts,rows}=calc([
  occ('one','2026-11-24','planned',{class_name:'6e1'}),
  occ('two','2026-11-25','planned',{class_name:'6e2'}),
  occ('outside','2027-07-10','planned',{class_name:'6e2'})
 ],{className:'6e2',fromDate:'2026-09-01',toDate:'2027-07-03'});
 assert.equal(counts.total,1);
 assert.equal(rows[0].id,'two');
});
test('une séance du cahier utilisée deux fois ne compte qu’une fois comme placée',()=>{
 const {sessions}=calc([
  occ('1','2026-11-24','planned',{cahier_planning_uid:'uid-1'}),
  occ('2','2026-11-25','planned',{cahier_planning_uid:'uid-1'})
 ],{className:'6e2',sessions:[
  {uid:'uid-1',chapterTitle:'Chapitre 1',sessionTitle:'Séance 1'},
  {uid:'uid-2',chapterTitle:'Chapitre 1',sessionTitle:'Séance 2'}
 ]});
 assert.equal(sessions.total,2);
 assert.equal(sessions.placed,1);
 assert.deepEqual(sessions.unplaced.map(s=>s.uid),['uid-2']);
});
test('la liste des séances non placées n’est pas inventée pour toutes les classes',()=>{
 const r=calc([occ('1','2026-11-23')],{sessions:[{uid:'uid-1'}]});
 assert.equal('sessions' in r,false);
});
test('le calcul est pur et ne modifie ni les créneaux ni le cahier source',()=>{
 const original=[occ('1','2026-11-23','planned',{notes:'Notes précédentes'})];
 const copy=JSON.stringify(original);
 const r=calc(original);
 assert.equal(JSON.stringify(original),copy);
 assert.equal(r.counts.missing,1);
});
test('une date de référence invalide est refusée',()=>{
 assert.throws(()=>summarize({occurrences:[],today:'aujourd’hui'}),/invalide/);
});
test('l’interface propose la lecture seule et un accès volontaire à chaque cours',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','planning.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
 assert.match(html,/data-tab="followup"/);
 assert.match(html,/planning-followup\.js/);
 assert.match(html,/id="planningFollowupClass"/);
 assert.match(html,/id="planningFollowupFilter"/);
 assert.match(js,/window\.PlanningFollowup\.summarize/);
 assert.match(js,/function renderFollowup\(\)/);
 assert.match(js,/loadFollowupCahier\(className\)/);
 assert.match(js,/data-followup-occ/);
 assert.match(js,/if\(item\)editOccurrence\(item\.dataset\.followupOcc\)/);
 assert.doesNotMatch(js.match(/function renderFollowup\(\)[\s\S]*?async function loadFollowupCahier/)[0],/\.update\(|\.insert\(|\.upsert\(/);
});


test('rendu réel : l’onglet affiche ses compteurs et les cours non liés',()=>{
 const vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
 const start=source.indexOf('function renderFollowup(){');
 const end=source.indexOf('async function loadFollowupCahier(',start);
 assert.ok(start>0&&end>start);
 const elements={};
 for(const id of ['planningFollowupView','planningFollowupClass','planningFollowupFilter',
  'planningFollowupSummary','planningFollowupList','planningFollowupSessions']){
  elements['#'+id]={innerHTML:'',textContent:'',value:''};
 }
 const state={
  followupClass:'',followupFilter:'missing',followupLoadedClass:'',
  followupSessions:null,followupLoading:false,followupError:'',
  period:{start_date:'2026-09-01',end_date:'2027-07-03'},
  occurrences:[
   occ('one','2026-11-23','planned'),
   occ('two','2026-11-17','completed',{cahier_planning_uid:'uid-1'}),
   occ('three','2026-11-18','planned'),
   occ('four','2026-11-19','completed',{notes:'[SVT:CRENEAU:v1:evaluation]\nContrôle'})
  ],cahierSessionsByUid:{'uid-1':{chapterTitle:'Chapitre 1',sessionTitle:'Séance 1'}}
 };
 const ctx={
  state,CLASSES:['6e2'],window:{PlanningFollowup:require('../planning-followup.js')},
  $:id=>elements[id]||null,iso:()=> '2026-11-22',
  esc:v=>String(v??'').replace(/[&<>]/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]))
 };
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 ctx.renderFollowup();
 assert.match(elements['#planningFollowupSummary'].innerHTML,/Sans séance associée/);
 assert.match(elements['#planningFollowupSummary'].innerHTML,/>2<\/strong>/);
 assert.match(elements['#planningFollowupList'].innerHTML,/data-followup-occ="one"/);
 assert.match(elements['#planningFollowupList'].innerHTML,/data-followup-occ="three"/);
 assert.doesNotMatch(elements['#planningFollowupList'].innerHTML,/data-followup-occ="four"/);
 assert.match(elements['#planningFollowupSessions'].innerHTML,/Choisis une classe/);
});


test('démarrage de la page : tous les onglets sont branchés avant le chargement des données',()=>{
 const vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
 const start=source.indexOf('function bind(){');
 const end=source.lastIndexOf('})();');
 assert.ok(start>0&&end>start);
 const tabButtons=[
  {dataset:{tab:'planning'},onclick:null},
  {dataset:{tab:'events'},onclick:null},
  {dataset:{tab:'followup'},onclick:null},
  {dataset:{tab:'settings'},onclick:null}
 ];
 const nodes=new Map();
 const one=selector=>{
  if(!nodes.has(selector))nodes.set(selector,{onclick:null,addEventListener(){}});
  return nodes.get(selector);
 };
 const state={tab:'planning',followupClass:'',followupLoadedClass:'',followupLoading:false};
 let initCalls=0,renderCalls=0;
 const context={state};
 // Un bouton simple (querySelector) n'a pas .forEach : une régression
 // dans le sélecteur empêche bind(), puis init(), de s'exécuter.
 context.$=one;
 context.$$=selector=>selector==='.planning-tabs button'?tabButtons:[];
 context.document={addEventListener:(event,handler)=>{if(event==='DOMContentLoaded')handler();}};
 context.window={addEventListener(){}};
 context.init=()=>{initCalls++};
 context.render=()=>{renderCalls++};
 context.savePlanningNav=()=>{};
 context.addEvent=()=>{};
 context.openPlanningBulk=()=>{};
 context.closeModal=()=>{};
 context.loadFollowupCahier=()=>{};
 vm.createContext(context);
 vm.runInContext(source.slice(start,end),context);
 assert.equal(initCalls,1,'L’initialisation doit être déclenchée');
 assert.ok(tabButtons.every(button=>typeof button.onclick==='function'),
  'Chaque onglet doit réagir au clic');
 tabButtons[2].onclick();
 assert.equal(state.tab,'followup');
 assert.equal(renderCalls,1);
});
