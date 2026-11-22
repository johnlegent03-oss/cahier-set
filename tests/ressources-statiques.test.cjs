// Recette V1 — vérifier les dépendances statiques réellement référencées.
// Les ressources CDN ou les chemins dynamiques ne sont pas testés ici.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const pages=fs.readdirSync(root).filter(f=>f.endsWith('.html'));
function attribute(tag,name){
 const m=tag.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(["\\x27])([^"\\x27]*)\\1','i'));
 return m?m[2]:'';
}
function localPath(src){
 if(!src||/^(?:https?:|\/\/|data:|blob:|mailto:|#)/i.test(src))return null;
 if(/[{}$]/.test(src))return null; // références générées en JS ou templating
 const file=src.split(/[?#]/,1)[0].replace(/^\.\//,'');
 if(!file||file.startsWith('/')||file.startsWith('../'))return null;
 return file;
}
test('toutes les dépendances JavaScript et CSS locales déclarées par les pages existent',()=>{
 assert.ok(pages.length>=5,'pages HTML non trouvées');
 const missing=[],checked=[];
 for(const html of pages){
  const source=fs.readFileSync(path.join(root,html),'utf8');
  const tags=source.match(/<(?:script|link)\b[^>]*>/gi)||[];
  for(const tag of tags){
   const script=/^<script\b/i.test(tag);
   if(!script&&attribute(tag,'rel').toLowerCase()!=='stylesheet')continue;
   const relative=localPath(attribute(tag,script?'src':'href'));
   if(!relative)continue;
   const file=path.join(root,path.dirname(html),relative);
   checked.push(html+' → '+relative);
   if(!fs.existsSync(file))missing.push(html+' → '+relative);
  }
 }
 assert.ok(checked.length>=15,'le test ne trouve pas les références attendues');
 assert.deepEqual(missing,[],'dépendances locales introuvables');
});
