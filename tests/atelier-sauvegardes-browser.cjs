// Recette navigateur : copies locales et conflits entre onglets sans vraie connexion.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
  try{
    const tab=await browser.newPage({viewport:{width:1440,height:900}});
    await tab.route(/^https?:\/\//,route=>route.abort());
    await tab.goto(pathToFileURL(path.resolve(__dirname,'..','atelier.html')).href,
      {waitUntil:'load',timeout:15000});
    await tab.waitForSelector('#stage > .sheet',{timeout:12000});
    const local=await tab.evaluate(()=>{
      window.confirm=()=>true;
      const old={
        app:'herbier-libre',version:1,title:'Fiche de départ',
        orientation:'portrait',documentType:'activite',graded:false,competencies:[],
        pages:[{objects:[object('text',{id:'oSauve',text:'Original',x:80,y:100,w:300,h:90})]}]
      };
      const next={...old,title:'Nouvelle fiche',pages:[{objects:[]}]};
      install(old);
      persistNow();
      const replaced=install(next);
      const snapshot=JSON.parse(localStorage.getItem(BACKUP_KEY));
      const oldIsBackup=snapshot.project.title==='Fiche de départ'&&
        snapshot.project.pages[0].objects[0].text==='Original';
      const recovered=restoreAtelierBackup();
      const restored=project.title==='Fiche de départ'&&
        project.pages[0].objects[0].text==='Original';
      const newIsBackup=JSON.parse(localStorage.getItem(BACKUP_KEY)).project.title==='Nouvelle fiche';
      const updated=JSON.parse(localStorage.getItem(KEY)).project.title;
      return {replaced,oldIsBackup,recovered,restored,newIsBackup,updated};
    });
    assert.deepEqual(local,{
      replaced:true,oldIsBackup:true,recovered:true,
      restored:true,newIsBackup:true,updated:'Fiche de départ'
    },'la récupération locale doit être réversible');

    const cloud=await tab.evaluate(async()=>{
      user={id:'enseignant-test',email:'test@example.net'};
      const oldStamp='2026-11-21T10:00:00.000Z';
      const newerStamp='2026-11-22T11:00:00.000Z';
      const state={stamp:newerStamp,html:'sans modification',id:'document-test'};
      const calls=[];
      const query=(kind,payload)=>{
        const filters={};
        return {
          eq(key,value){filters[key]=value;return this},
          select(columns){
            calls.push({kind,columns,filters:{...filters}});
            return {
              async maybeSingle(){
                if(kind==='update'){
                  if(filters.updated_at!==state.stamp)return {data:null,error:null};
                  state.html=payload.contenu_html;state.stamp=payload.updated_at;
                  return {data:{id:state.id,updated_at:state.stamp},error:null};
                }
                state.id='nouveau-document';state.html=payload.contenu_html;
                state.stamp=payload.updated_at;
                return {data:{id:state.id,updated_at:state.stamp},error:null};
              }
            }
          }
        }
      };
      sb={from(name){
        if(name!=='atelier_documents')throw Error('Table inattendue');
        return {update:payload=>query('update',payload),insert:payload=>query('insert',payload)}
      }};
      refreshBank=async()=>{};
      controls=()=>{};
      cloudId='document-test';cloudOwner=user.id;cloudUpdatedAt=oldStamp;
      const conflicted=await saveCloud(false);
      const afterConflict={conflicted,unchanged:state.html==='sans modification',
        versionUnchanged:cloudUpdatedAt===oldStamp,calls:calls.slice()};
      const copied=await saveCloud(true);
      const afterCopy={copied,newId:cloudId,newVersion:cloudUpdatedAt===state.stamp,
        dataRetained:state.html.includes('herbier-project')};
      return {afterConflict,afterCopy};
    });
    assert.equal(cloud.afterConflict.conflicted,false);
    assert.equal(cloud.afterConflict.unchanged,true);
    assert.equal(cloud.afterConflict.versionUnchanged,true);
    assert.equal(cloud.afterConflict.calls.length,1);
    assert.equal(cloud.afterConflict.calls[0].filters.updated_at,'2026-11-21T10:00:00.000Z');
    assert.equal(cloud.afterCopy.copied,true);
    assert.equal(cloud.afterCopy.newId,'nouveau-document');
    assert.equal(cloud.afterCopy.newVersion,true);
    assert.equal(cloud.afterCopy.dataRetained,true);
    const multiTab=await tab.evaluate(()=>{
      const before=localStorage.getItem(KEY);
      const external=JSON.stringify({project:{title:'Version autre onglet'},timestamp:999});
      localStorage.setItem(KEY,external);
      const saved=persistNow();
      const untouched=localStorage.getItem(KEY)===external;
      const conflict=localDraftConflict;
      const warning=$('localStatus').textContent.includes('Autre onglet');
      // Rétablir l'environnement de test sans persister le document factice.
      localStorage.setItem(KEY,before);
      localDraftConflict=false;
      lastSavedRaw=before;
      return {saved,untouched,conflict,warning};
    });
    assert.deepEqual(multiTab,{saved:false,untouched:true,conflict:true,warning:true},
      'deux onglets ne doivent pas se réécrire silencieusement');
    console.log('OK : récupération locale, version cloud et protection du brouillon entre onglets.');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
