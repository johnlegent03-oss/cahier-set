/* Modèles personnels SVT v2 — utilise la banque existante, sans nouvelle table. */
(function(){
'use strict';
const themes={'6e':{name:'6e · Vert',ink:'#345b40',pale:'#e8efdf'},'5e':{name:'5e · Bleu',ink:'#325b7b',pale:'#e5eef4'},'3e':{name:'3e · Violet',ink:'#674678',pale:'#eee6f3'}};
const reserved=level=>'MODÈLE PERSONNEL SVT — '+level;
let busy=false;
const clone=x=>JSON.parse(JSON.stringify(x));
function message(text,error=false){if(typeof status==='function')status(text,error);else alert(text);}
function guard(){requireUser();if(cloudBusy)throw Error('Un enregistrement est en cours. Réessaie ensuite.');}
async function findModel(level){
 const {data,error}=await sb.from('atelier_documents').select('id,titre,contenu_html').eq('user_id',user.id).eq('titre',reserved(level)).limit(2);
 if(error)throw error;
 if(data.length>1)throw Error('Plusieurs modèles '+level+' portent le nom réservé. Aucun document n’a été modifié.');
 return data[0]||null;
}
function parseModel(row){
 const doc=new DOMParser().parseFromString(row.contenu_html||'','text/html');
 const node=doc.querySelector('script[type="application/json"][data-herbier-project]');
 if(!node)throw Error('Le modèle personnel n’est pas dans le format modifiable de l’atelier.');
 return validate(JSON.parse(node.textContent));
}
function defaultModel(level){
 const t=themes[level],items=[];
 const add=(type,opts)=>items.push(object(type,Object.assign({font:'Arial,sans-serif',color:t.ink},opts)));
 add('logo',{label:'Logo SVT',x:48,y:28,w:76,h:76});
 add('text',{label:'Niveau',text:level.toUpperCase()+' · SCIENCES DE LA VIE ET DE LA TERRE',x:145,y:34,w:590,h:22,size:11,bold:true});
 add('title',{label:'Nom de l’activité',text:'Nom de l’activité',x:145,y:65,w:590,h:85,size:30,font:'Georgia,serif',bold:true});
 add('skills',{label:'Compétences travaillées',x:48,y:173,w:698,h:130,size:13,transparent:false,bg:t.pale,radius:10});
 [330,670].forEach((y,i)=>{
 add('box',{label:'Cadre document '+(i+1),x:48,y,w:698,h:305,text:'',transparent:false,bg:'#fffdf5',radius:10});
 add('band',{label:'Bandeau document '+(i+1),x:61,y:y+12,w:672,h:39,text:'',transparent:false,bg:t.pale,radius:6});
 add('text',{label:'Titre document '+(i+1),x:75,y:y+21,w:640,h:27,text:'Document '+(i+1)+' — Titre du document',size:15,bold:true});
 add('text',{label:'Texte document '+(i+1),x:75,y:y+70,w:640,h:209,text:'Texte du document à compléter…',size:14,color:'#293b32'});
 });
 add('text',{label:'Slogan',x:48,y:1065,w:698,h:35,text:'La curiosité pour boussole, la nature pour inspiration, la connaissance pour horizon.',size:10,font:'Georgia,serif',italic:true,align:'center'});
 return {app:'herbier-libre',version:1,title:'Nouvelle activité '+level,documentType:'activite',graded:false,competencies:[],pages:[{objects:items}]};
}
async function saveTemplate(level){
 if(busy)return;
 busy=true;
 try{
  guard();finish();metadata();
  const owner=user.id;
  const row=await findModel(level);
  if(!confirm((row?'Remplacer':'Créer')+' ton modèle personnel '+level+' avec la fiche affichée ? Les textes et images actuels feront partie du modèle. Les activités existantes ne seront pas modifiées.'))return;
  const payload={user_id:owner,titre:reserved(level),contenu_html:cloudHTML(),nb_pages:project.pages.length,document_type:project.documentType||'activite',is_graded:!!project.graded,coefficient:project.documentType==='evaluation'?1:.5,updated_at:new Date().toISOString(),classe:null,cahier_id:null,chapitre_index:null,seance_index:null,chapitre_titre:'',seance_titre:''};
  if(user?.id!==owner)throw Error('Le compte a changé. Aucune sauvegarde envoyée.');
  const q=row?sb.from('atelier_documents').update(payload).eq('id',row.id).eq('user_id',owner):sb.from('atelier_documents').insert(payload);
  const {data,error}=await q.select('id').single();
  if(error)throw error;
  if(!data?.id)throw Error('Sauvegarde du modèle non confirmée.');
  await refreshBank();
  message('Modèle personnel '+level+' enregistré. « Nouvelle fiche » pourra le réutiliser.');
 }catch(e){console.error('[Modèle personnel]',e);message(e.message||String(e),true);}
 finally{busy=false;}
}
async function openTemplate(level){
 if(busy)return;
 busy=true;
 try{
  guard();
  const row=await findModel(level);
  const data=row?parseModel(row):defaultModel(level);
  if(!confirm('Créer une nouvelle fiche '+level+' depuis '+(row?'ton modèle personnel':'le modèle de départ')+' ? Enregistre d’abord la fiche affichée si nécessaire.'))return;
  const copy=clone(data);copy.title='Nouvelle activité '+level;
  install(copy,true);
  cloudId=null;cloudOwner=null;persist();
  if(typeof closeHome==='function')closeHome();
  const dlg=document.getElementById('svt-model-choice');if(dlg?.open)dlg.close();
  message('Nouvelle fiche indépendante créée depuis '+(row?'ton modèle personnel ':'le modèle de départ ')+level+'.');
 }catch(e){console.error('[Ouverture modèle]',e);message(e.message||String(e),true);alert(e.message||String(e));}
 finally{busy=false;}
}
function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;return b;}
function init(){
 if(!document.getElementById('stage')||typeof install!=='function'||document.getElementById('svt-modeles-panel'))return;
 const style=document.createElement('style');style.textContent='.svt-modeles-panel{margin:16px 0;padding:12px;border:1px solid #cbd4bf;border-radius:10px;background:#fbf8ee}.svt-modeles-panel h2{margin:0 0 9px}.svt-modele-row{display:grid;gap:6px;margin-bottom:12px;padding-left:8px;border-left:4px solid var(--modele)}.svt-modele-row button{text-align:left}.svt-modele-help{font:11px/1.5 Arial;color:#607456}#svt-model-choice{height:auto;max-width:480px;background:#fbf8ee;color:#34533a}#svt-model-choice h2{font:24px Georgia}#svt-model-choice .choices{display:grid;gap:10px;margin:15px 0}';document.head.append(style);
 const panel=document.createElement('section');panel.id='svt-modeles-panel';panel.className='svt-modeles-panel';
 const h=document.createElement('h2');h.textContent='Mes modèles personnels';panel.append(h);
 Object.entries(themes).forEach(([level,t])=>{
  const row=document.createElement('div');row.className='svt-modele-row';row.style.setProperty('--modele',t.ink);
  row.append(button('Nouvelle fiche '+t.name,()=>openTemplate(level)),button('Définir la fiche comme modèle '+level,()=>saveTemplate(level)));panel.append(row);
 });
 const help=document.createElement('p');help.className='svt-modele-help';help.textContent='Modèles sauvegardés dans ta banque, sur ton compte enseignant. Une nouvelle fiche utilise une copie indépendante.';panel.append(help);
 document.querySelector('.layout>aside')?.prepend(panel);
 const dlg=document.createElement('dialog');dlg.id='svt-model-choice';
 const title=document.createElement('h2');title.textContent='Nouvelle fiche';const choices=document.createElement('div');choices.className='choices';
 Object.entries(themes).forEach(([level,t])=>choices.append(button('Utiliser mon modèle '+t.name,()=>openTemplate(level))));
 dlg.append(title,choices,button('Annuler',()=>dlg.close()));document.body.append(dlg);
 window.startBlank=function(){dlg.showModal();};
 const home=document.querySelector('#atelierHome .home-actions');
 if(home){
  const old=[...home.querySelectorAll('button')].find(b=>(b.getAttribute('onclick')||'').includes('startDemo'));
  Object.entries(themes).forEach(([level,t])=>{
   const b=button('Mon modèle '+t.name,()=>openTemplate(level));b.className='home-action';b.style.borderLeft='5px solid '+t.ink;
   if(old)home.insertBefore(b,old);else home.append(b);
  });old?.remove();
 }
 document.querySelectorAll('button[onclick="resetDemo()"]').forEach(b=>b.hidden=true);
 const blank=document.querySelector('button[onclick="blank()"]');if(blank)blank.textContent='Document vierge (sans modèle)';
 const brand=document.querySelector('header>strong');if(brand)brand.textContent='❧ Atelier pédagogique SVT';
 const intro=document.querySelector('#atelierHome .home-text');if(intro)intro.textContent='Choisis ton modèle personnel de niveau. Tant que tu n’en as pas enregistré un, le modèle de départ est proposé. La connexion enseignant est nécessaire.';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
