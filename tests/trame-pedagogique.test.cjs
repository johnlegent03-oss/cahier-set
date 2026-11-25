// Tests de la Trame pédagogique : aucune connexion à une vraie base de données.
// Lancer : node --test tests/trame-pedagogique.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../trame-model.js');
const K=require('../planning-types.js');
const {plan}=require('../planning-associations.js');

const docId='c9f1a322-4b78-47bc-b960-245ed33c5fd0';
const sample=()=>M.normalize({chapitres:[{
 titre:'La circulation sanguine',objectif:'Comprendre la circulation',
 seances:[
  {titre:'Le cœur',probleme:'Comment fonctionne-t-il ?',activites:[{docId,title:'Dissection du cœur'}]},
  {titre:'La double circulation',probleme:'Quel est le trajet du sang ?',activites:[]}
 ]
}]});

test('la trame génère et conserve des identifiants indépendants du titre',()=>{
 const t=sample(),a=t.chapitres[0],s=a.seances[0];
 const again=M.normalize(t);
 assert.equal(again.chapitres[0].id,a.id);
 assert.equal(again.chapitres[0].seances[0].id,s.id);
 again.chapitres[0].seances[0].titre='Le cœur, notre pompe';
 assert.equal(again.chapitres[0].seances[0].id,s.id);
});

test('le planning reçoit les séances de la trame et les activités liées',()=>{
 const t=sample(),list=M.flatten(t,'5e');
 assert.equal(list.length,3);
 assert.equal(list[0].type,'trame-session');
 assert.equal(list[1].type,'trame-activity');
 assert.equal(list[1].sessionUid,list[0].uid);
 assert.equal(list[1].docId,docId);
 assert.match(list[0].chapterTitle,/Trame/);
 assert.equal(list[2].sessionIndex,1);
});

test('importer sans publication laisse les activités privées, avec références conservées',()=>{
 const t=sample(),ch=t.chapitres[0],published=M.toCahierChapter(ch,'5e3',false);
 assert.equal(published.trame_ref,ch.id);
 assert.equal(published.seances[0].trame_ref,ch.seances[0].id);
 assert.deepEqual(published.seances[0].activites,[]);
 published.seances[0].titre='Mission : explorer le cœur';
 assert.equal(ch.seances[0].titre,'Le cœur','le titre de référence ne change pas');
});

test('les liens de l’atelier ne sont publiés que sur option explicite',()=>{
 const t=sample(),entry=M.toCahierChapter(t.chapitres[0],'5e3',true).seances[0].activites[0];
 assert.equal(entry.atelier_document_id,docId);
 assert.match(entry.texte,/fiche.html\?code=svt5e3-k2m8&doc=/);
 assert.match(entry.texte,/Dissection du cœur/);
 assert.throws(()=>M.toCahierChapter(t.chapitres[0],'classe-inconnue',true));
});

test('le titre et la question sont échappés en HTML lors de l’import',()=>{
 const t=M.normalize({chapitres:[{titre:'<script>test</script>',seances:[{titre:'<b>bonjour</b>',probleme:'2 < 3'}]}]});
 const ch=M.toCahierChapter(t.chapitres[0],'6e1',false);
 assert.ok(ch.titre.includes('&lt;script&gt;'));
 assert.ok(ch.seances[0].titre.includes('&lt;b&gt;'));
 assert.ok(ch.seances[0].problematique.includes('&lt;'));
});

test('les liens de trame sont distincts des identifiants du cahier',()=>{
 const trameUid='trame-session:'+sample().chapitres[0].seances[0].id;
 const notes=K.write('cours','À préparer',[trameUid]);
 assert.deepEqual(K.read(notes).links,[trameUid]);
 const occ=[
  {id:'a',class_name:'5e3',session_date:'2026-11-23',start_time:'09:00:00',end_time:'10:00:00',status:'planned',is_modified:true,notes,cahier_planning_uid:null},
  {id:'b',class_name:'5e3',session_date:'2026-11-24',start_time:'09:00:00',end_time:'10:00:00',status:'planned',is_modified:false,notes:null,cahier_planning_uid:null}
 ];
 const sessions=[{uid:trameUid,chapterIndex:0,sessionIndex:0},{uid:'trame-session:second',chapterIndex:0,sessionIndex:1}];
 const suggestion=plan({occurrences:occ,sessions,className:'5e3',fromDate:'2026-11-23',toDate:'2026-12-01'});
 assert.equal(suggestion.stats.existing,1);
 assert.deepEqual(suggestion.items.map(x=>x.uid),['trame-session:second']);
});

test('les références incomplètes et documents invalides ne contaminent pas la trame',()=>{
 const t=M.normalize({chapitres:[{titre:'Chapitre',seances:[{titre:'Séance',
  activites:[{docId:'pas-un-uuid',title:'À écarter'},{docId,title:'Valide'}]}]}]});
 assert.equal(t.chapitres[0].seances[0].activites.length,1);
 assert.equal(t.chapitres[0].seances[0].activites[0].docId,docId);
});

test('le niveau est dérivé de la classe, sans lier la trame à cette classe',()=>{
 assert.equal(M.levelForClass('6e3'),'6e');
 assert.equal(M.levelForClass('5e5'),'5e');
 assert.equal(M.levelForClass('3e2'),'3e');
 assert.equal(M.levelForClass('UNKNOWN'),null);
});
