// Test réel de l'export PDF A4 dans Chromium, lancé uniquement par la CI dédiée.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');

function pagesInPdf(buffer){
  // Les catalogues Chromium actuels écrivent une entrée /Type /Page par feuille.
  const text=buffer.toString('latin1');
  return (text.match(/\/Type\s*\/Page\b/g)||[]).length;
}
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    // Le test est entièrement local : aucun accès aux données Supabase.
    await page.route(/^https?:\/\//,route=>route.abort());
    await page.goto(pathToFileURL(path.resolve(__dirname,'..','atelier.html')).href,
      {waitUntil:'load',timeout:15000});
    await page.waitForSelector('#stage > .sheet',{timeout:12000});

    await page.evaluate(()=>{
      window.confirm=()=>true;
      window.print=()=>{};
      project={
        app:'herbier-libre',version:1,title:'Test impression',
        orientation:'portrait',documentType:'activite',graded:false,competencies:[],
        pages:[
          {objects:[object('text',{label:'Page 1',x:80,y:100,w:320,h:90,text:'Document 1 — Première feuille'})]},
          {objects:[object('text',{label:'Page 2',x:80,y:100,w:320,h:90,text:'Document 2 — Deuxième feuille'})]}
        ]
      };
      page=0;
      selection.clear();
      render();
      printDoc();
    });
    await page.emulateMedia({media:'print'});
    const checkSize=async(expectW,expectH)=>{
      const measured=await page.evaluate(()=>{
        const sheet=document.querySelector('#stage > .sheet');
        const rect=sheet.getBoundingClientRect();
        const style=getComputedStyle(sheet);
        return {
          width:rect.width,height:rect.height,
          stageVisible:getComputedStyle(document.querySelector('main#stage')).display!=='none',
          headerHidden:getComputedStyle(document.querySelector('header.app-header')).display==='none',
          breakAfter:style.breakAfter
        };
      });
      assert.ok(measured.stageVisible&&measured.headerHidden,'les contrôles de l’éditeur doivent être masqués');
      assert.ok(Math.abs(measured.width-expectW)<2,
        'largeur A4 incorrecte : '+JSON.stringify(measured));
      assert.ok(Math.abs(measured.height-expectH)<2,
        'hauteur A4 incorrecte : '+JSON.stringify(measured));
      return measured;
    };

    await checkSize(794,1123);
    const portrait=await page.pdf({preferCSSPageSize:true,printBackground:true});
    assert.equal(pagesInPdf(portrait),2,'deux pages A4 portrait attendues, sans feuille blanche');

    await page.evaluate(()=>{
      project.orientation='landscape';
      render();
      printDoc();
    });
    await checkSize(1123,794);
    const landscape=await page.pdf({preferCSSPageSize:true,printBackground:true});
    assert.equal(pagesInPdf(landscape),2,'deux pages A4 paysage attendues, sans feuille blanche');

    console.log('OK : PDF Chromium A4 portrait et paysage, deux pages chacun.');
  }finally{
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
