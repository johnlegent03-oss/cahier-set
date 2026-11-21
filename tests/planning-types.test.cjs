// Tests purs du type de créneau (aucun accès Supabase).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {types,read,write,isSpecial,descriptor}=require('../planning-types.js');

test('le planning propose les catégories de la vie scolaire',()=>{
 assert.deepEqual(types.map(t=>t.value),['cours','evaluation','intervention','sortie','absence','autre']);
});
test('les notes anciennes demeurent inchangées pour un cours ordinaire',()=>{
 const original='Travail en groupe\nNe pas oublier le matériel.';
 assert.deepEqual(read(original),{kind:'cours',detail:original});
 assert.equal(write('cours',original),original);
 assert.equal(isSpecial(original),false);
});
test('une évaluation conserve son intitulé et sa catégorie après rechargement',()=>{
 const raw=write('evaluation','Évaluation chapitre 2');
 assert.equal(read(raw).kind,'evaluation');
 assert.equal(read(raw).detail,'Évaluation chapitre 2');
 assert.equal(isSpecial(raw),true);
});
test('intervention, voyage et déplacement sont reconnus',()=>{
 for(const kind of ['intervention','sortie','absence','autre']){
  const raw=write(kind,'Projet scientifique');
  assert.equal(read(raw).kind,kind);
  assert.equal(read(raw).detail,'Projet scientifique');
  assert.ok(descriptor(kind).label.length>3);
 }
});
test('le marqueur seul n’affiche pas de notes artificielles',()=>{
 const raw=write('absence','');
 assert.equal(read(raw).detail,'');
});
test('les notes qui ne contiennent pas le marqueur exact restent du texte libre',()=>{
 const raw='[SVT:CRENEAU:v1:inventaire]\nAtelier';
 assert.deepEqual(read(raw),{kind:'cours',detail:raw});
});
test('type inconnu refusé sans écriture ambiguë',()=>{
 assert.throws(()=>write('erreur','notes'),/inconnu/);
});
test('l’interface affiche les types et ne lie pas une absence au cahier',()=>{
 const js=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'..','planning.html'),'utf8');
 assert.match(html,/planning-types\.js/);
 assert.match(js,/name="kind"/);
 assert.match(js,/kind==='cours'\?\(f\.get\('cahier_planning_uid'\)\|\|null\):null/);
 assert.match(js,/window\.PlanningKinds\.write\(kind,f\.get\('notes'\)\)/);
 assert.match(js,/planning-special-title/);
 assert.match(js,/kind:'\+esc\(t\.value\)/);
});
