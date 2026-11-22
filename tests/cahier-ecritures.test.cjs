// Empêche le retour des anciennes écritures directes dans Cahier.
// Exécution : node --test tests/cahier-ecritures.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const files=fs.readdirSync(root,{withFileTypes:true})
  .filter(item=>item.isFile() && /\.(js|html)$/.test(item.name))
  .map(item=>item.name);
test('aucune ancienne interface ne réintroduit un UPDATE/UPSERT/DELETE direct sur Cahier',()=>{
  const bad=[];
  const direct=/\.from\s*\(\s*(['"])Cahier\1\s*\)\s*\.\s*(?:update|upsert|delete)\s*\(/ig;
  for(const file of files){
    const body=fs.readFileSync(path.join(root,file),'utf8');
    if(direct.test(body))bad.push(file);
    direct.lastIndex=0;
  }
  assert.deepEqual(bad,[],'Ces fichiers contournent la sauvegarde atomique : '+bad.join(', '));
});
test('le module de mise en page ne remplace plus le lien de l’atelier au cahier',()=>{
 const source=fs.readFileSync(path.join(root,'atelier-mise-en-page.js'),'utf8');
 assert.doesNotMatch(source,/window\.addToSession\s*=/);
 assert.match(source,/sanitizeRichHtml/);
});
