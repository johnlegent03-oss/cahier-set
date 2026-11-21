// Tests sûrs du calcul des associations : aucune connexion à la vraie base.
// node --test tests/planning-associations.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {plan}=require('../planning-associations.js');
const row=(id,date,className='6e1',extra={})=>({
 id,class_name:className,session_date:date,start_time:'09:00:00',end_time:'10:00:00',
 status:'planned',cahier_planning_uid:null,is_modified:false,...extra
});
const session=(n)=>({
 uid:'uid-'+n,chapterIndex:Math.floor((n-1)/3),sessionIndex:(n-1)%3,
 chapterTitle:'Chapitre '+(Math.floor((n-1)/3)+1),sessionTitle:'Séance '+n
});
const options=(occurrences,sessions=Array.from({length:6},(_,i)=>session(i+1)),extra={})=>({
 className:'6e1',fromDate:'2026-11-23',toDate:'2027-03-30',occurrences,sessions,...extra
});
test('classe filtrée, dates et créneaux classés chronologiquement',()=>{
 const p=plan(options([row('c','2026-12-01'),row('other','2026-11-23','5e1'),
  row('b','2026-11-25'),row('a','2026-11-23')]));
 assert.deepEqual(p.items.map(i=>i.id),['a','b','c']);
 assert.deepEqual(p.items.map(i=>i.uid),['uid-1','uid-2','uid-3']);
});
test('un lien préexistant est conservé, sa séance n’est pas réattribuée',()=>{
 const occ=[row('1','2026-11-23'),row('2','2026-11-24','6e1',{cahier_planning_uid:'uid-2'}),
  row('3','2026-11-25')];
 const p=plan(options(occ));
 assert.deepEqual(p.items.map(i=>i.id),['1','3']);
 assert.deepEqual(p.items.map(i=>i.uid),['uid-1','uid-3']);
 assert.equal(occ[1].cahier_planning_uid,'uid-2','Le modèle ne modifie pas les données sources');
});
test('une séance déjà liée hors période reste réservée',()=>{
 const p=plan(options([row('old','2026-10-01','6e1',{cahier_planning_uid:'uid-1'}),row('new','2026-11-25')]));
 assert.equal(p.items[0].uid,'uid-2');
});
test('les cours manuellement ajustés, annulés et reportés sont exclus',()=>{
 const p=plan(options([
  row('a','2026-11-23','6e1',{is_modified:true}),
  row('b','2026-11-24','6e1',{status:'cancelled'}),
  row('c','2026-11-25','6e1',{status:'postponed'}),
  row('d','2026-11-26','6e1',{status:'completed'}),
  row('e','2026-11-27','6e1',{is_modified:false})
 ]));
 assert.deepEqual(p.items.map(i=>i.id),['d','e']);
 assert.equal(p.stats.modified,1);
 assert.equal(p.stats.cancelled,2);
});
test('le choix de la séance de départ est respecté',()=>{
 const p=plan(options([row('a','2026-11-23'),row('b','2026-11-24')],undefined,{firstUid:'uid-4'}));
 assert.deepEqual(p.items.map(i=>i.uid),['uid-4','uid-5']);
});
test('la limite empêche une répartition massive non visualisée',()=>{
 const occ=Array.from({length:80},(_,i)=>row('o'+i,'2026-11-23','6e1',{start_time:String(8+Math.floor(i/10)).padStart(2,'0')+':00:00'}));
 // dates identiques : la limite s’applique aux propositions, pas à la base.
 const p=plan(options(occ,Array.from({length:80},(_,i)=>session(i+1)),{limit:40}));
 assert.equal(p.items.length,40);
});
test('relancer un aperçu après application n’ajoute pas de doublon',()=>{
 const occ=[row('1','2026-11-23'),row('2','2026-11-24')];
 const first=plan(options(occ));
 for(const proposed of first.items){
  const original=occ.find(x=>x.id===proposed.id);original.cahier_planning_uid=proposed.uid;original.is_modified=true;
 }
 const again=plan(options(occ));
 assert.equal(again.items.length,0);
});
test('un UID en doublon dans le cahier bloque toute proposition',()=>{
 assert.throws(()=>plan(options([row('1','2026-11-23')],[session(1),session(1)])),/dupliqués/);
});
test('date invalide ou séance absente bloque la proposition',()=>{
 assert.throws(()=>plan(options([],undefined,{fromDate:'2027-04-01'})),/période valide/);
 assert.throws(()=>plan(options([row('1','2026-11-23')],undefined,{firstUid:'uid-inconnu'})),/n’existe plus/);
});
test('l’interface dispose d’un aperçu et préserve les lignes modifiées entre deux onglets',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
 const page=fs.readFileSync(path.join(__dirname,'..','planning.html'),'utf8');
 assert.match(page,/id="planningBulkLink"/);
 assert.match(page,/planning-associations\.js/);
 assert.match(source,/planningBulkSignature\(now\)!==proposed\.baseSignature/);
 assert.match(source,/class="planning-select planning-bulk-choice"/);
 assert.match(source,/proposed\?\.items\.filter\(item=>item\.uid\)/);
 assert.match(source,/entry\.uid=selected\?\.uid\|\|''/);
 assert.match(source,/const knownUids=new Set\(sessions\.map\(session=>session\.uid\)\)/);
 assert.match(source,/\.is\('cahier_planning_uid',null\)/);
 assert.match(source,/\.eq\('is_modified',false\)/);
 assert.match(source,/const \{data,error\}=await client\(\)\.from\('planning_session_occurrences'\)/);
 assert.doesNotMatch(source,/openPlanningBulk\s*\(\s*\)\s*\{[^]*?\bupsert\(/);
});
