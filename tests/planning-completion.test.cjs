// Phase 8 : validation volontaire d’un cours, sans appel réseau réel.
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const vm=require('node:vm');
const Completion=require('../planning-completion.js');
const course=(id='cours-1',overrides={})=>({
 id,class_name:'6e2',session_date:'2026-11-17',start_time:'10:40:00',
 end_time:'11:30:00',status:'planned',notes:null,
 cahier_planning_uid:'stable-uid',is_modified:false,...overrides
});
const now='2026-11-22';
test('seul un vrai cours prévu, aujourd’hui ou dans le passé, est éligible',()=>{
 assert.equal(Completion.eligible(course(),now),true);
 assert.equal(Completion.eligible(course('today',{session_date:now}),now),true);
 assert.equal(Completion.eligible(course('future',{session_date:'2026-11-23'}),now),false);
 assert.equal(Completion.eligible(course('done',{status:'completed'}),now),false);
 assert.equal(Completion.eligible(course('canceled',{status:'cancelled'}),now),false);
 assert.equal(Completion.eligible(course('postponed',{status:'postponed'}),now),false);
 assert.equal(Completion.eligible(course('bad',{id:''}),now),false);
});
test('ni une évaluation, ni une intervention, ni une sortie, ni une absence ne sont confirmables comme cours',()=>{
 for(const kind of ['evaluation','intervention','sortie','absence','autre']){
  assert.equal(Completion.eligible(course(kind,{notes:'[SVT:CRENEAU:v1:'+kind+']\nDescription'}),now),false,kind);
 }
 assert.equal(Completion.eligible(course('ordinary',{notes:'Notes pédagogiques libres'}),now),true);
});
test('l’écriture exige propriétaire, période, identité, horaires, statut initial et notes nulles',()=>{
 const fields=Completion.conditions(course(),'professeur','periode',now);
 assert.deepEqual(fields,[
  ['id','eq','cours-1'],['owner_id','eq','professeur'],['period_id','eq','periode'],
  ['class_name','eq','6e2'],['session_date','eq','2026-11-17'],
  ['start_time','eq','10:40:00'],['end_time','eq','11:30:00'],
  ['status','eq','planned'],['notes','is',null]
 ]);
});
test('la modification des notes entre deux clics est bloquée par une comparaison exacte',()=>{
 const fields=Completion.conditions(course('x',{notes:'Test de leçon'}),'prof','annee',now);
 assert.deepEqual(fields.at(-1),['notes','eq','Test de leçon']);
});
test('les confirmations impossibles échouent avant toute construction de filtre',()=>{
 assert.throws(()=>Completion.conditions(course('future',{session_date:'2026-11-23'}),'prof','annee',now),/ne peut pas/);
 assert.throws(()=>Completion.conditions(course(),'','annee',now),/ne peut pas/);
 assert.throws(()=>Completion.conditions(course(),'prof','',now),/ne peut pas/);
});
function browser(occurrences=[course()],write=async()=>[{id:'cours-1'}]){
 const source=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
 const start=source.indexOf('function openQuickCompletion(id){');
 const end=source.indexOf('async function editOccurrence(id){',start);
 assert.ok(start>0&&end>start,'La fonction de confirmation doit être présente');
 let modalCount=0,closeCount=0,renderCount=0,reloadCount=0;
 const writes=[],messages=[];
 const controls=new Map();
 function $(selector){
  if(!controls.has(selector))controls.set(selector,{disabled:false,hidden:true,textContent:'',onclick:null});
  return controls.get(selector);
 }
 const state={occurrences,user:{id:'prof'},period:{id:'periode'},quickDoneBusy:false};
 const context={
  state,window:{PlanningCompletion:Completion},iso:()=>now,Date,
  esc:x=>String(x).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])),
  $,openModal:(_title,body)=>{modalCount++;controls.set('#modalText',{textContent:body})},
  closeModal:()=>{closeCount++},notify:(msg,error)=>messages.push({msg,error}),
  query:async(...args)=>{writes.push(args);return write(...args)},
  loadPeriod:async()=>{reloadCount++},render:()=>{renderCount++}
 };
 vm.createContext(context);
 vm.runInContext(source.slice(start,end),context);
 return {context,controls,writes,messages,state,open:id=>context.openQuickCompletion(id),
  counts:()=>({modalCount,closeCount,renderCount,reloadCount})};
}
test('un clic affiche une confirmation ; aucun écrit Supabase avant validation',()=>{
 const b=browser();b.open('cours-1');
 assert.equal(b.counts().modalCount,1);
 assert.equal(b.writes.length,0);
 assert.match(b.controls.get('#modalText').textContent,/6e2/);
 assert.match(b.controls.get('#modalText').textContent,/stable|10:40/);
 b.controls.get('#quickDoneCancel').onclick();
 assert.equal(b.counts().closeCount,1);
 assert.equal(b.writes.length,0);
});
test('confirmer ne met à jour que le statut, puis recharge la période',async()=>{
 const b=browser();b.open('cours-1');
 await b.controls.get('#quickDoneConfirm').onclick();
 assert.equal(b.writes.length,1);
 const [table,method,payload,filters]=b.writes[0];
 assert.equal(table,'planning_session_occurrences');
 assert.equal(method,'update');
 assert.deepEqual(JSON.parse(JSON.stringify(payload)),{status:'completed'});
 assert.equal(filters.length,9);
 assert.equal(b.counts().closeCount,1);
 assert.equal(b.counts().reloadCount,1);
 assert.equal(b.counts().renderCount,1);
 assert.match(b.messages.at(-1).msg,/sauvegardé/);
});
test('en cas de refus, le statut n’est pas présenté comme enregistré et la modale reste ouverte',async()=>{
 const b=browser([course()],async()=>{throw new Error('Aucune ligne modifiée');});
 b.open('cours-1');
 await b.controls.get('#quickDoneConfirm').onclick();
 assert.equal(b.counts().closeCount,0);
 assert.equal(b.counts().reloadCount,0);
 assert.equal(b.controls.get('#quickDoneConfirm').disabled,false);
 assert.equal(b.controls.get('#quickDoneError').hidden,false);
 assert.match(b.controls.get('#quickDoneError').textContent,/Aucune ligne modifiée/);
 assert.equal(b.state.quickDoneBusy,false);
});
test('un événement particulier et un cours futur ne présentent jamais la confirmation',()=>{
 const b=browser([
  course('future',{session_date:'2026-11-23'}),
  course('trip',{notes:'[SVT:CRENEAU:v1:sortie]\nMusée'})
 ]);
 b.open('future');b.open('trip');
 assert.equal(b.counts().modalCount,0);
 assert.equal(b.writes.length,0);
 assert.equal(b.messages.length,2);
});
test('les deux vues offrent une action rapide, les cours faits ne la proposent pas',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'..','planning.html'),'utf8');
 assert.match(html,/planning-completion\.js\?v=1/);
 assert.ok(html.indexOf('planning-completion.js')<html.indexOf('planning.js'));
 assert.match(source,/window\.PlanningCompletion\?\.eligible\(o,iso\(new Date\(\)\)\)/);
 assert.match(source,/data-quick-done/);
 assert.match(source,/\$\$\('#planningGrid \[data-quick-done\]'\)/);
 assert.match(source,/const done=e\.target\.closest\('\[data-quick-done\]'\)/);
 assert.match(source,/query\('planning_session_occurrences','update',\{status:'completed'\},conditions\)/);
 assert.match(source,/op==='is'\?q\.is\(k,v\)/);
});
