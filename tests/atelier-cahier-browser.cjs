// Parcours atelier → cahier → lecture élève, sans requête vers les données réelles.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');

(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
 try{
  const url=name=>pathToFileURL(path.resolve(__dirname,'..',name)).href;
  const editor=await browser.newPage({viewport:{width:1440,height:900}});
  editor.on('dialog',dialog=>dialog.accept());
  await editor.route(/^https?:\/\//,route=>route.abort());
  await editor.goto(url('atelier.html'),{waitUntil:'load',timeout:15000});
  await editor.waitForSelector('#stage > .sheet',{timeout:12000});
  const integrated=await editor.evaluate(async()=>{
   window.confirm=()=>true;
   project={
    app:'herbier-libre',version:1,title:'Transformation de l’eau',
    orientation:'landscape',documentType:'activite',graded:false,
    competencies:[{nom:'Interpréter un résultat',niveau:'6e'}],
    pages:[{objects:[
     object('text',{id:'texte-eau',x:50,y:65,w:390,h:110,label:'Consigne',
       text:'Décris la fusion de la glace.',size:20}),
     object('table',{id:'table-eau',x:55,y:250,w:450,h:180,label:'Relevés',
       cells:[['Temps','Température'],['0 min','-2 °C'],['4 min','0 °C']],
       columnWidths:[50,50],rowHeights:[50,50,50],cellStyles:{}})
    ]}]
   };
   page=0;selection.clear();$('title').value=project.title;
   $('docType').value='activite';$('graded').checked=false;
   render();
   const html=cloudHTML();
   const remote={id:42,contenu:{chapitres:[{
    titre:'Chapitre 1',seances:[{titre:'Séance 1',planning_uid:'uid-test',activites:[]}]
   }]}};
   const calls=[];
   const originalSb=sb,originalUser=user,originalSave=saveCloud;
   try{
    user={id:'prof-test',email:'prof-test@example.invalid'};
    const query={
     select(){return this},eq(){return this},
     async single(){return {data:structuredClone(remote),error:null}}
    };
    sb={
     from(table){if(table!=='Cahier')throw Error('Table inattendue : '+table);return query},
     async rpc(name,args){
      calls.push({name,args});
      if(name!=='svt_cahier_cas_v1')throw Error('RPC inattendue');
      if(JSON.stringify(args.p_original)!==JSON.stringify(remote.contenu))return {data:[],error:null};
      remote.contenu=structuredClone(args.p_nouveau);
      return {data:[{cahier_id:remote.id}],error:null};
     }
    };
    saveCloud=async()=>true;
    cloudId='fiche-test-001';cloudOwner=user.id;cloudUpdatedAt='2026-11-22T11:00:00.000Z';
    cahier={id:42,classe:'6e1',chapitres:structuredClone(remote.contenu.chapitres)};
    $('linkClass').value='6e1';
    $('linkChapter').replaceChildren(new Option('Sans chapitre',''),new Option('Chapitre 1','0'));
    $('linkChapter').value='0';
    $('linkSession').replaceChildren(new Option('Sans séance',''),new Option('Séance 1','0'));
    $('linkSession').value='0';
    await addToSession();
    const first=structuredClone(remote.contenu.chapitres[0].seances[0].activites);
    await addToSession();
    const second=structuredClone(remote.contenu.chapitres[0].seances[0].activites);
    return {html,first,second,rpcCount:calls.length,done:$('linkStatus').textContent};
   }finally{saveCloud=originalSave;sb=originalSb;user=originalUser}
  });
  assert.equal(integrated.rpcCount,1,'un lien déjà présent ne doit pas être ajouté deux fois');
  assert.equal(integrated.first.length,1);
  assert.equal(integrated.second.length,1);
  assert.equal(integrated.first[0].atelier_document_id,'fiche-test-001');
  assert.match(integrated.first[0].texte,/fiche\.html\?code=svt6e1-7kq4&amp;doc=fiche-test-001/);
  assert.match(integrated.first[0].texte,/Transformation de l’eau/);
  assert.match(integrated.html,/data-herbier-project/);

  const student=await browser.newPage({viewport:{width:390,height:844}});
  await student.route(/^https?:\/\//,route=>route.abort());
  await student.addInitScript(({html})=>{
    window.SUPABASE_URL='https://test.invalid';
    window.SUPABASE_PUBLISHABLE_KEY='test-public';
    window.supabase={createClient:()=>({
      rpc:async(name,args)=>{
        if(name!=='svt_lire_fiche_publiee_v1'||args.p_classe!=='6e1')
          return {data:null,error:{message:'RPC inattendue'}};
        return {data:[{contenu_html:html,titre:'Transformation de l’eau'}],error:null};
      }
    })};
  },{html:integrated.html});
  await student.goto(url('fiche.html')+'?code=svt6e1-7kq4&doc=fiche-test-001',
    {waitUntil:'load',timeout:15000});
  await student.locator('#sheet-wrap:not([hidden])').waitFor({timeout:12000});
  const view=await student.evaluate(()=>({
    title:document.querySelector('#title').textContent,
    back:document.querySelector('#back').getAttribute('href'),
    width:document.querySelector('#sheet').style.width,
    transform:document.querySelector('#sheet').style.transform,
    statusHidden:document.querySelector('#status').hidden
  }));
  assert.equal(view.title,'Transformation de l’eau');
  assert.match(view.back,/index\.html\?code=svt6e1-7kq4/);
  assert.equal(view.width,'1147px','A4 paysage = 1123 px + 24 px de marge');
  assert.match(view.transform,/scale\(/);
  assert.equal(view.statusHidden,true);
  await student.frameLocator('#sheet').locator('.paper.herbier-export').waitFor({timeout:10000});
  assert.equal(await student.frameLocator('#sheet').locator('.paper.herbier-export').count(),1);
  assert.equal(await student.frameLocator('#sheet').locator('.herbier-object').count(),2);
  assert.equal(await student.frameLocator('#sheet').locator('table').count(),1);
  assert.match(await student.frameLocator('#sheet').locator('body').innerText(),/fusion de la glace/);
  console.log('OK : insertion unique, lien élève, lecture d’un document A4 paysage et tableau.');

  const index=await browser.newPage({viewport:{width:1200,height:900}});
  await index.route(/^https?:\/\//,route=>route.abort());
  await index.addInitScript(()=>{
    window.SUPABASE_URL='https://test.invalid';
    window.SUPABASE_PUBLISHABLE_KEY='test-public';
    window.supabase={createClient:()=>({from:()=>({
      select(){return this},eq(){return this},
      async maybeSingle(){return {data:{classe:'6e1',contenu:{chapitres:[]}},error:null}}
    })})};
  });
  await index.goto(url('index.html')+'?code=svt6e1-7kq4',{waitUntil:'load',timeout:15000});
  const studentLink=await index.evaluate(entry=>{
    const safe=normalizeEntry(entry);
    const holder=document.createElement('div');
    holder.innerHTML=renderEntries([safe],'Activité');
    const a=holder.querySelector('a');
    return {href:a?.getAttribute('href'),text:a?.textContent,target:a?.target};
  },integrated.first[0]);
  assert.match(studentLink.href,/fiche\.html\?code=svt6e1-7kq4&doc=fiche-test-001/);
  assert.match(studentLink.text,/Ouvrir la fiche/);
  assert.equal(studentLink.target,'_blank');
  console.log('OK : normalisation du cahier et lien sécurisé conservé dans la vue élève.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
