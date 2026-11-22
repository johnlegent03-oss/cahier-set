// Stabilisation V1 : alignement des deux options au-dessus des appréciations.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const css=fs.readFileSync(path.join(root,'evaluations.css'),'utf8');
const evaluations=fs.readFileSync(path.join(root,'evaluations.js'),'utf8');
const engine=fs.readFileSync(path.join(root,'appreciations-moteur.js'),'utf8');
const html=fs.readFileSync(path.join(root,'evaluations.html'),'utf8');

test('les deux options utilisent la même classe CSS et gardent leurs identifiants de sauvegarde',()=>{
 assert.match(evaluations,/function svtAccommodationControl\(studentId\)/);
 assert.match(evaluations,/<label class="appreciation-option"><input type="checkbox" data-svt-accommodation=/);
 assert.match(evaluations,/<span>Mentionner les aménagements dans l’appréciation<\/span>/);
 assert.match(engine,/label\.className='appreciation-option'/);
 assert.match(engine,/check\.dataset\.cycleChoice=String\(id\)/);
 assert.match(engine,/wording\.textContent='Mentionner que les difficultés/);
 assert.match(engine,/label\.append\(check,wording\)/);
});

test('les cases des appréciations ont une taille fixe et ne prennent pas width:100% du formulaire',()=>{
 const index=css.indexOf('.appreciation-box label.appreciation-option > input[type="checkbox"]');
 assert.ok(index>=0,'règle checkbox appréciations absente');
 const style=css.slice(index,css.indexOf('}',index)+1);
 assert.match(style,/width:18px\s*!important/);
 assert.match(style,/height:18px\s*!important/);
 assert.match(style,/flex:0 0 18px\s*!important/);
 assert.match(css,/\.appreciation-box label\.appreciation-option\s*\{/);
 assert.match(css,/\.appreciation-box label\.appreciation-option > span/);
});

test('les fichiers changés sont rechargés par la page évaluations sans ancien cache',()=>{
 assert.match(html,/evaluations\.css\?v=20261122-appreciations-layout/);
 assert.match(html,/evaluations\.js\?v=20261122-appreciations-layout/);
 assert.match(html,/appreciations-moteur\.js\?v=20261122-appreciations-layout/);
});
