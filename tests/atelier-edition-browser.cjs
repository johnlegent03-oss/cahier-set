// Recette Chromium de l'éditeur texte et tableau, sans Supabase ni données d'élèves.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
  try{
    const tab=await browser.newPage({viewport:{width:1550,height:950}});
    tab.on('dialog',dialog=>dialog.accept());
    await tab.route(/^https?:\/\//,route=>route.abort());
    await tab.goto(pathToFileURL(path.resolve(__dirname,'..','atelier.html')).href,
      {waitUntil:'load',timeout:15000});
    await tab.waitForSelector('#stage > .sheet',{timeout:12000});
    await tab.evaluate(()=>{
      project={
        app:'herbier-libre',version:1,title:'Recette texte-tableau',
        orientation:'portrait',documentType:'activite',graded:false,competencies:[],
        pages:[{objects:[
          object('text',{id:'otexte',x:80,y:130,w:260,h:36,
            label:'Texte à ajuster',
            text:'La matière se transforme dans plusieurs états physiques. '.repeat(15)}),
          object('table',{id:'otableau',x:80,y:550,w:350,h:80,
            label:'Tableau à ajuster',
            cells:[['Observation','Résultat'],['Température mesurée au cours du temps '.repeat(12),'Glace en fusion']],
            columnWidths:[50,50],rowHeights:[38,38],cellStyles:{}})
        ]}]
      };
      page=0;selection.clear();past=[];future=[];render();syncHistory();
    });
    const before=await tab.evaluate(()=>{
      const el=document.querySelector('#stage .object[data-id="otexte"]');
      return {overflow:contentIsOverflowing(el),height:project.pages[0].objects[0].h};
    });
    assert.equal(before.overflow,true,'le texte long doit être signalé coupé');
    await tab.locator('#stage .object[data-id="otexte"] .content').click();
    const focus=await tab.evaluate(()=>{
      const el=document.querySelector('#stage .object[data-id="otexte"] .content');
      return {editable:el.isContentEditable,focused:document.activeElement===el};
    });
    assert.deepEqual(focus,{editable:true,focused:true},'l’édition du texte fonctionne au clic');
    await tab.keyboard.type(' Fin.');
    const typed=await tab.evaluate(()=>({
      text:project.pages[0].objects[0].text,undo:past.length
    }));
    assert.ok(typed.text.includes('Fin.'),'la saisie doit être persistée dans le modèle');
    assert.equal(typed.undo,1,'une session de saisie ne produit qu’une étape d’annulation');
    await tab.locator('.prop-tab[data-ptab="texte"]').click();
    await tab.locator('#fitTextHeightBtn').click();
    const fitted=await tab.evaluate(()=>{
      const o=project.pages[0].objects[0];
      const el=document.querySelector('#stage .object[data-id="otexte"]');
      return {h:o.h,overflow:contentIsOverflowing(el),undo:past.length};
    });
    assert.ok(fitted.h>before.height,'le bloc de texte doit être agrandi');
    assert.equal(fitted.overflow,false,'tout le texte doit redevenir visible');
    assert.equal(fitted.undo,2,'l’ajustement est annulable');
    await tab.evaluate(()=>undo());
    assert.equal(await tab.evaluate(()=>project.pages[0].objects[0].h),before.height);
    await tab.evaluate(()=>redo());
    assert.equal(await tab.evaluate(()=>project.pages[0].objects[0].h),fitted.h);

    await tab.evaluate(()=>choose(0,['otableau']));
    await tab.locator('.prop-tab[data-ptab="tableau"]').click();
    const prior=await tab.evaluate(()=>{
      const o=project.pages[0].objects[1];
      return {height:o.h,rows:o.rowHeights.slice(),overflow:contentIsOverflowing(
        document.querySelector('#stage .object[data-id="otableau"]'))};
    });
    assert.equal(prior.overflow,true,'une cellule trop longue doit déclencher l’avertissement');
    await tab.locator('#fitTableRowsBtn').click();
    const after=await tab.evaluate(()=>{
      const o=project.pages[0].objects[1];
      return {height:o.h,rows:o.rowHeights.slice(),overflow:contentIsOverflowing(
        document.querySelector('#stage .object[data-id="otableau"]')),
        text:o.cells[1][0]};
    });
    assert.ok(after.height>prior.height,'le tableau doit grandir');
    assert.ok(after.rows[1]>prior.rows[1],'la ligne contenant le texte doit grandir');
    assert.equal(after.overflow,false,'le texte des cellules doit être visible');
    assert.ok(after.text.includes('Température mesurée'),'aucune donnée de cellule perdue');
    console.log('OK : édition au clic, session d’annulation, ajustement texte et tableau.');
  }finally{
    await browser.close();
  }
})().catch(err=>{console.error(err);process.exitCode=1;});
