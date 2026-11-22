// Contrôles d'impression de l'atelier (sans lancer de PDF ni charger Supabase).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','atelier.html'),'utf8');

function sourceBetween(start,end){
  const a=src.indexOf(start),b=src.indexOf(end,a);
  assert.ok(a>=0&&b>a,'fonction introuvable : '+start);
  return src.slice(a,b);
}
const geometry=new Function(sourceBetween('function printGeometryIssues(', 'function inspectPrintDocument(')+';return printGeometryIssues;')();

test('l’impression repose sur une feuille A4 exacte et masque les éléments de navigation',()=>{
  assert.ok(!src.includes('height: 295mm'),'ancienne hauteur de 295 mm présente');
  assert.match(src,/--print-page-w/);
  assert.match(src,/--print-page-h/);
  assert.ok(src.includes('height:var(--print-page-h,297mm)!important'));
  assert.ok(src.includes('width:var(--print-page-w,210mm)!important'));
  assert.ok(src.includes('page-break-after:auto!important'));
  assert.ok(src.includes('.sheet::before { display:none!important; }'));
  assert.ok(src.includes("style.textContent='@page{size:A4 '+"));
  assert.ok(src.includes("project.orientation==='landscape'?'landscape':'portrait'"));
});

test('un élément dans les limites A4 ne déclenche aucune alerte',()=>{
  const input={pages:[{objects:[
    {label:'Titre',x:50,y:100,w:500,h:80,angle:0},
    {label:'Image',x:60,y:300,w:300,h:500,angle:0},
    {label:'Masqué',hidden:true,x:-800,y:-200,w:300,h:500,angle:0}
  ]}]};
  assert.deepEqual(geometry(input,794,1123),[]);
});

test('les éléments hors page et rotations sont détectés, page par page',()=>{
  const input={pages:[
    {objects:[{label:'Bandeau',x:760,y:10,w:80,h:50,angle:0}]},
    {objects:[{label:'Flèche',x:0,y:0,w:100,h:100,angle:45}]},
    {objects:[{label:'Photo',x:50,y:50,w:150,h:200,angle:0}]}
  ]};
  const issues=geometry(input,794,1123);
  assert.equal(issues.length,2);
  assert.ok(issues[0].includes('Page 1'));
  assert.ok(issues[1].includes('Page 2'));
});

test('le contrôle des débordements accepte aussi le paysage',()=>{
  const input={pages:[{objects:[{label:'Large bandeau',x:950,y:10,w:170,h:100,angle:0}]}]};
  assert.deepEqual(geometry(input,1123,794),[]);
  assert.equal(geometry(input,794,1123).length,1);
});

test('les textes coupés et images non chargées sont signalés',()=>{
  const project={pages:[{objects:[
    {id:'t',type:'text',label:'Conclusion',x:50,y:50,w:120,h:70,angle:0},
    {id:'i',type:'image',label:'Photographie',x:210,y:50,w:120,h:70,angle:0}
  ]}]};
  const textEl={dataset:{id:'t'},hidden:false,querySelector:()=>({
    scrollHeight:99,clientHeight:70,scrollWidth:100,clientWidth:120
  })};
  const imgEl={dataset:{id:'i'},hidden:false,querySelector:()=>({complete:false,naturalWidth:0})};
  const stage={querySelectorAll:()=>[textEl,imgEl]};
  const fakeDocument={querySelectorAll:(selector)=>selector==='#stage > .sheet'?[stage]:[]};
  const inspect=new Function('project','pageWidth','pageHeight','document','printGeometryIssues',
    sourceBetween('function inspectPrintDocument(', 'function printDoc(')+';return inspectPrintDocument;'
  )(project,()=>794,()=>1123,fakeDocument,geometry);
  const issues=inspect();
  assert.equal(issues.length,2);
  assert.ok(issues.some(x=>x.includes('contenu potentiellement coupé')));
  assert.ok(issues.some(x=>x.includes('image non chargée')));
});
