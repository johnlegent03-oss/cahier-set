// Tests ciblés de l'éditeur sans dépendance navigateur ni données Supabase.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','atelier.html'),'utf8');

test('tous les scripts intégrés à l’atelier restent syntaxiquement valides',()=>{
  const scripts=[...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length>=2,'scripts intégrés introuvables');
  for(let i=0;i<scripts.length;i++){
    if(/type=["']application\/json/.test(scripts[i][1]))continue;
    assert.doesNotThrow(()=>new vm.Script(scripts[i][2],{filename:'atelier-inline-'+i+'.js'}));
  }
});

test('le changement de page ne déplace que le défilement de l’éditeur',()=>{
  const m=source.match(/function scrollStageToPage\(index\)\{([\s\S]*?)\n\}/);
  assert.ok(m,'fonction de navigation localisée absente');
  const scrollStageToPage=new Function('$','index',m[1]);
  let target=null,selector='';
  const sheet={getBoundingClientRect:()=>({top:530})};
  const stage={
    scrollTop:320,
    getBoundingClientRect:()=>({top:100}),
    querySelector:(s)=>{selector=s;return sheet},
    scrollTo:(options)=>{target=options}
  };
  scrollStageToPage(id=>id==='stage'?stage:null,2);
  assert.equal(selector,'.sheet[data-page="2"]');
  assert.deepEqual(target,{top:738,behavior:'auto'});
  assert.ok(!source.includes("scrollIntoView({behavior:'smooth',block:'start'})"),
    'le défilement global a été réintroduit');
});

test('la saisie crée une seule étape d’annulation par session, puis réarme à la prochaine',()=>{
  const marker="$('stage').addEventListener('beforeinput',e=>{";
  const begin=source.indexOf(marker);
  assert.ok(begin>0,'gestion du début de saisie absente');
  const end=source.indexOf('},true);',begin);
  assert.ok(end>begin);
  const body=source.slice(begin+marker.length,end);
  const run=new Function('e','textEditCheckpoints','project','checkpoint',body);
  const tracked=new WeakSet();
  const obj={id:'o123',locked:false};
  const sheet={dataset:{page:'0'}};
  const element={dataset:{id:'o123'},closest:(selector)=>selector==='.sheet'?sheet:null};
  const editable={
    closest:(selector)=>selector==='.object'?element:null
  };
  let counter=0;
  const event={target:{closest:(selector)=>selector==='[contenteditable="true"]'?editable:null}};
  const project={pages:[{objects:[obj]}]};
  const fire=()=>run(event,tracked,project,()=>counter++);
  fire();fire();assert.equal(counter,1,'une frappe par caractère ne doit pas saturer l’historique');
  tracked.delete(editable);fire();assert.equal(counter,2,'une nouvelle session doit être annulable');
  obj.locked=true;tracked.delete(editable);fire();assert.equal(counter,2,'un objet verrouillé ne doit pas produire d’historique');
});

test('les gestes immobiles ne créent pas de faux états dans l’historique',()=>{
  assert.match(source,/if\(control\)\{if\(!mutable\(\)\)return;finish\(\);let rotating=/);
  assert.match(source,/if\(!mutable\(\)\)return;finish\(\);gesture=\{type:'move'/);
  assert.match(source,/if\(Math\.hypot\([^;]+<6\)return;g\.dragStarted=true;checkpoint\(\)/);
});

test('Ctrl/Cmd + S sauvegarde le brouillon sur l’appareil',()=>{
  assert.ok(source.includes("e.key.toLowerCase()==='s'){e.preventDefault();persistNow();return}"));
});

test('les miniatures A4 sont construites à la demande sans perdre le défilement',()=>{
  assert.ok(source.includes("thumbnailObserver=new IntersectionObserver("),
    'l’observateur de visibilité des miniatures doit être présent');
  assert.ok(source.includes("root:host,rootMargin:'180px'"),
    'les miniatures proches de la zone visible doivent être anticipées');
  assert.ok(source.includes("if(thumbnailObserver)thumbnailObserver.observe(frame);"),
    'les miniatures ne doivent pas toutes être clonées immédiatement');
  assert.ok(source.includes("const priorLeft=host.scrollLeft,priorTop=host.scrollTop;"));
  assert.ok(source.includes("host.scrollLeft=priorLeft;host.scrollTop=priorTop;"));
});
