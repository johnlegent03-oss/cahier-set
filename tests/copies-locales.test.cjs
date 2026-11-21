// Tests sans réseau : protection de la récupération des copies locales.
// Exécution : node --test tests/copies-locales.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','prof.html'),'utf8');
const from=source.indexOf('function recoverLocalChapterBackup(index){');
const to=source.indexOf('  function requireTeacher(){',from);
assert.ok(from>=0&&to>from,'Fonction de récupération introuvable');
const recoveryScript=new vm.Script(source.slice(from,to));

function setup({choice=true}={}){
  const online={titre:'Chapitre TEST SAUVEGARDE A',seances:[],problematique:'Version A'};
  const local={titre:'Chapitre TEST SAUVEGARDE B',seances:[],problematique:'Version B'};
  const store=new Map([['backup',JSON.stringify({classe:'TEST',index:0,savedAt:Date.now(),chapter:local})]]);
  const actions={};
  const body=[];
  const fakeElement=(tag)=>({
    tag,id:'',style:{},innerHTML:'',hidden:false,attributes:{},
    children:{},setAttribute(k,v){this.attributes[k]=v;},
    querySelector(selector){
      if(!this.children[selector]){
        this.children[selector]={hidden:selector==='#svtBackupComparison',handlers:{},
          addEventListener(event,fn){this.handlers[event]=fn;},
          click(){this.handlers.click?.();},focus(){}};
      }
      return this.children[selector];
    },
    remove(){const i=body.indexOf(this);if(i>=0)body.splice(i,1);},
    click(){actions.download=this.download;}
  });
  const doc={
    body:{appendChild(el){body.push(el);}},
    createElement:fakeElement,
    getElementById(id){return body.find(el=>el.id===id)||null;}
  };
  const data={contenu:{chapitres:[structuredClone(online)]}};
  const ctx={
    classe:'TEST',currentClassData:data,hasUnsavedChanges:false,
    localStorage:{getItem:key=>store.get(key)||null,removeItem:key=>store.delete(key)},
    localBackupKey:()=> 'backup',
    normalizeChapter:ch=>ch,
    stripHtml:s=>String(s??'').replace(/<[^>]+>/g,''),
    esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
    document:doc,
    confirm:()=>choice,
    editChapter:(index,skip)=>actions.edit={index,skip},
    setSaveStatus:(state,msg)=>actions.status={state,msg},
    Blob,URL:{createObjectURL:()=> 'blob:backup',revokeObjectURL:()=>{}},
    setTimeout:fn=>fn(),
    console:{warn:(...args)=>{actions.warning=args;}}
  };
  vm.createContext(ctx);recoveryScript.runInContext(ctx);
  ctx.recoverLocalChapterBackup(0);
  return {ctx,store,online,local,actions,overlay:doc.getElementById('svtLocalRecovery'),body};
}

test('une copie divergente affiche un dialogue et conserve la version en ligne',()=>{
  const x=setup();
  assert.ok(x.overlay,'Le dialogue de comparaison est affiché');
  assert.match(x.overlay.innerHTML,/Comparer les versions/);
  assert.match(x.overlay.innerHTML,/Version en ligne/);
  assert.match(x.overlay.innerHTML,/Version A/);
  assert.match(x.overlay.innerHTML,/Version B/);
  assert.deepEqual(x.ctx.currentClassData.contenu.chapitres[0],x.online);
  assert.equal(x.store.has('backup'),true,'La sauvegarde locale ne doit pas être effacée');
});
test('afficher la comparaison ne modifie aucune version',()=>{
  const x=setup();
  x.overlay.querySelector('#svtCompareCopies').click();
  assert.equal(x.overlay.querySelector('#svtBackupComparison').hidden,false);
  assert.equal(x.ctx.currentClassData.contenu.chapitres[0].titre,x.online.titre);
  assert.equal(x.store.has('backup'),true);
});
test('un refus de suppression conserve la copie locale',()=>{
  const x=setup({choice:false});
  x.overlay.querySelector('#svtKeepOnline').click();
  assert.equal(x.store.has('backup'),true);
  assert.ok(x.body.includes(x.overlay));
});
test('un choix explicite de garder en ligne efface uniquement la copie',()=>{
  const x=setup();
  x.overlay.querySelector('#svtKeepOnline').click();
  assert.equal(x.store.has('backup'),false);
  assert.deepEqual(x.ctx.currentClassData.contenu.chapitres[0],x.online);
  assert.equal(x.body.includes(x.overlay),false);
});
test('restaurer sans confirmation ne modifie pas le chapitre',()=>{
  const x=setup({choice:false});
  x.overlay.querySelector('#svtRestoreBackup').click();
  assert.deepEqual(x.ctx.currentClassData.contenu.chapitres[0],x.online);
  assert.equal(x.store.has('backup'),true);
  assert.equal(x.actions.edit,undefined);
});
test('restauration confirmée : pas de sauvegarde serveur implicite et copie retenue',()=>{
  const x=setup();
  x.overlay.querySelector('#svtRestoreBackup').click();
  assert.deepEqual(x.ctx.currentClassData.contenu.chapitres[0],x.local);
  assert.equal(x.store.has('backup'),true,'Ne supprimer la copie qu’après sauvegarde serveur réussie');
  assert.equal(x.ctx.hasUnsavedChanges,true);
  assert.deepEqual(x.actions.edit,{index:0,skip:true});
  assert.match(x.actions.status.msg,/NON enregistrée/);
});
test('télécharger la copie ne la supprime pas',()=>{
  const x=setup();
  x.overlay.querySelector('#svtDownloadCopy').click();
  assert.match(x.actions.download,/copie-locale-TEST-chapitre-1\.json/);
  assert.equal(x.store.has('backup'),true);
});
test('récupération seulement après le rendu de l’éditeur',()=>{
  const beginning=source.indexOf('function editChapter(i,skipLocalRecovery=false){');
  const ending=source.indexOf('async function ',beginning+20);
  const block=source.slice(beginning,ending);
  assert.ok(beginning>=0);
  assert.ok(block.indexOf('content.innerHTML=')>=0);
  assert.ok(block.indexOf('if(!skipLocalRecovery)recoverLocalChapterBackup(i);')>block.indexOf('content.innerHTML='));
});
