// Contrôle de compatibilité Firefox / WebKit (moteur de Safari) sans données réseau.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {firefox,webkit}=require('playwright-core');

(async()=>{
 for(const [name,engine] of [['Firefox',firefox],['WebKit / Safari',webkit]]){
  const browser=await engine.launch({headless:true});
  try{
   const tab=await browser.newPage({viewport:{width:1440,height:900}});
   tab.on('dialog',dialog=>dialog.accept());
   await tab.route(/^https?:\/\//,route=>route.abort());
   await tab.goto(pathToFileURL(path.resolve(__dirname,'..','atelier.html')).href,
     {waitUntil:'load',timeout:20000});
   await tab.waitForSelector('#stage > .sheet',{timeout:15000});
   const data=await tab.evaluate(()=>{
    const original={
      app:'herbier-libre',version:1,title:'Compatibilité',
      orientation:'landscape',documentType:'activite',graded:false,
      competencies:[],pages:[{objects:[
       object('text',{id:'otexte',x:70,y:100,w:350,h:80,
        label:'Texte',text:'État physique : solide, liquide, gazeux'}),
       object('table',{id:'otableau',x:70,y:300,w:380,h:120,
        label:'Tableau',cells:[['Temps','Température'],['0 min','-2 °C']],
        rowHeights:[60,60],columnWidths:[50,50],cellStyles:{}})
      ]}]
    };
    install(original);
    const n=project.pages[0].objects.length;
    const pages=document.querySelectorAll('#stage > .sheet').length;
    const table=document.querySelector('#stage .editable-table');
    const text=document.querySelector('#stage .object[data-id="otexte"] .content');
    return {n,pages,table:!!table,text:text?.textContent,
      orientation:project.orientation,backup:!!localStorage.getItem(BACKUP_KEY)};
   });
   assert.equal(data.n,2);
   assert.equal(data.pages,1);
   assert.equal(data.table,true);
   assert.equal(data.orientation,'landscape');
   assert.match(data.text,/solide, liquide, gazeux/);
   assert.equal(data.backup,true);
   const editable=tab.locator('#stage .object[data-id="otexte"] .content');
   await editable.click();
   assert.equal(await editable.getAttribute('contenteditable'),'true');
   await tab.keyboard.type(' Attention');
   assert.match(await tab.evaluate(()=>project.pages[0].objects[0].text),/Attention/);
   await tab.evaluate(()=>{undo();});
   assert.doesNotMatch(await tab.evaluate(()=>project.pages[0].objects[0].text),/Attention/);
   await tab.evaluate(()=>redo());
   assert.match(await tab.evaluate(()=>project.pages[0].objects[0].text),/Attention/);
   const bounds=await tab.evaluate(()=>{
     const s=document.querySelector('#stage > .sheet');
     return {w:Number.parseFloat(s.style.width),h:Number.parseFloat(s.style.height)};
   });
   assert.ok(bounds.w>bounds.h,'le mode A4 paysage est bien appliqué');
   console.log('OK '+name+' : ouverture, tableau, saisie, annulation/rétablissement et A4 paysage.');
  }finally{await browser.close()}
 }
})().catch(err=>{console.error(err);process.exitCode=1});
