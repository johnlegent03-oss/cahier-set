// Recette de sauvegarde et réouverture d'une fiche de l'atelier.
// Toutes les réponses Supabase sont simulées en mémoire.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');

(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
 try{
  const tab=await browser.newPage({viewport:{width:1440,height:900}});
  tab.on('dialog',d=>d.accept());
  await tab.route(/^https?:\/\//,route=>route.abort());
  await tab.goto(pathToFileURL(path.resolve(__dirname,'..','atelier.html')).href,
    {waitUntil:'load',timeout:15000});
  await tab.waitForSelector('#stage > .sheet',{timeout:12000});
  const result=await tab.evaluate(async()=>{
   window.confirm=()=>true;
   user={id:'enseignant-test',email:'test@example.invalid'};
   const chapter={
    titre:'Chapitre 1 : l’eau',
    seances:[{titre:'Séance 1',planning_uid:'id-seance'}]
   };
   let remote=null,writes=0;
   function makeQuery(name,action,payload){
    const filters={};
    return {
     select(){return this},
     eq(k,v){filters[k]=v;return this},
     async single(){
      if(name==='atelier_documents'&&action==='select')
       return {data:structuredClone(remote),error:null};
      throw Error('Lecture inattendue '+name+' '+action);
     },
     async maybeSingle(){
      if(name==='Cahier')return {data:{
       id:42,classe:'6e1',contenu:{chapitres:[chapter]}
      },error:null};
      if(name!=='atelier_documents')throw Error('Table inattendue');
      if(action==='insert'){
       remote={...structuredClone(payload),id:'fiche-test-123'};
       writes++;return {data:{id:remote.id,updated_at:remote.updated_at},error:null};
      }
      if(action==='update'){
       if(remote.updated_at!==filters.updated_at)return {data:null,error:null};
       remote={...remote,...structuredClone(payload)};writes++;
       return {data:{id:remote.id,updated_at:remote.updated_at},error:null};
      }
      throw Error('Action inattendue');
     }
    };
   }
   sb={from(name){
    return {
     insert:payload=>makeQuery(name,'insert',payload),
     update:payload=>makeQuery(name,'update',payload),
     select:()=>makeQuery(name,'select')
    };
   }};
   // La banque est simulée, et aucune vraie requête n'est autorisée.
   refreshBank=async()=>{};
   controls=()=>{};
   cahier={id:42,classe:'6e1',chapitres:[chapter]};
   $('linkClass').value='6e1';
   $('linkChapter').replaceChildren(new Option('Sans chapitre',''),new Option('Chapitre 1','0'));
   $('linkChapter').value='0';
   $('linkSession').replaceChildren(new Option('Sans séance',''),new Option('Séance 1','0'));
   $('linkSession').value='0';
   project={
    app:'herbier-libre',version:1,title:'Transformations physiques',
    orientation:'landscape',documentType:'activite',graded:false,
    competencies:[{nom:'Interpréter',niveau:'6e'}],
    pages:[{objects:[
     object('text',{id:'o-texte',label:'Consigne',x:80,y:90,w:340,h:120,
       text:'Que devient la glace lors de la fusion ?',size:18}),
     object('table',{id:'o-table',label:'Mesures',x:80,y:300,w:450,h:150,
       cells:[['Temps','Température'],['0 min','-2 °C'],['4 min','0 °C']],
       rowHeights:[50,50,50],columnWidths:[50,50],cellStyles:{'2:1':{color:'#294536'}}})
    ]}]
   };
   page=0;selection.clear();
   $('title').value=project.title;$('docType').value='activite';render();
   const created=await saveCloud(true);
   const saved=JSON.parse(remote.contenu_html.match(/<script[^>]*data-herbier-project[^>]*>([\s\S]*?)<\/script>/)[1]);
   // Modifier le document local pour vérifier que la réouverture le restaure.
   project.pages[0].objects[0].text='Ce texte ne doit pas subsister';
   project.pages[0].objects[1].cells[2][1]='Erreur temporaire';
   project.title='Fiche temporaire';$('title').value=project.title;render();
   await loadCloud('fiche-test-123');
   const restored={
    title:project.title,
    text:project.pages[0].objects[0].text,
    cells:structuredClone(project.pages[0].objects[1].cells),
    rowHeights:structuredClone(project.pages[0].objects[1].rowHeights),
    classes:$('linkClass').value,
    chapter:$('linkChapter').value,
    session:$('linkSession').value,
    orientation:project.orientation,
    version:cloudUpdatedAt,
    cloudId
   };
   project.pages[0].objects[0].text='Version révisée';
   // Une modification accidentelle de la sélection de classe ne doit jamais
   // déplacer le document publié : les anciens liens élèves en dépendent.
   $('linkClass').value='5e1';
   render();
   const revised=await saveCloud(false);
   const revisedStored=remote.contenu_html.includes('Version révisée');
   const assignmentPreserved=remote.classe==='6e1'&&remote.chapitre_index===0&&remote.seance_index===0&&String(remote.cahier_id)==='42';
   return {created,revised,saved,restored,writes,revisedStored,assignmentPreserved,remoteId:remote.id};
  });
  assert.equal(result.created,true);
  assert.equal(result.revised,true);
  assert.equal(result.writes,2,'une création et une mise à jour');
  assert.equal(result.remoteId,'fiche-test-123');
  assert.equal(result.saved.pages.length,1);
  assert.equal(result.saved.pages[0].objects.length,2);
  assert.equal(result.restored.title,'Transformations physiques');
  assert.equal(result.restored.text,'Que devient la glace lors de la fusion ?');
  assert.equal(result.restored.cells[2][1],'0 °C');
  assert.deepEqual(result.restored.rowHeights,[50,50,50]);
  assert.equal(result.restored.classes,'6e1');
  assert.equal(result.restored.chapter,'0');
  assert.equal(result.restored.session,'0');
  assert.equal(result.restored.orientation,'landscape');
  assert.equal(result.restored.cloudId,'fiche-test-123');
  assert.ok(result.restored.version);
  assert.equal(result.revisedStored,true);
  assert.equal(result.assignmentPreserved,true,'l’affectation publiée doit rester inchangée même si la sélection a changé');
  console.log('OK : création, réouverture, restitution des tableaux et contexte de classe, mise à jour.');
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
