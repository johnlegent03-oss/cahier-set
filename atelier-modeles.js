/* Modèles de fiches SVT — extension de présentation uniquement. */
(function(){
'use strict';
const themes={
 '6e':{name:'6e · Vert',ink:'#345b40',pale:'#e8efdf'},
 '5e':{name:'5e · Bleu',ink:'#325b7b',pale:'#e5eef4'},
 '3e':{name:'3e · Violet',ink:'#674678',pale:'#eee6f3'}
};
const slogan='La curiosité pour boussole, la nature pour inspiration, la connaissance pour horizon.';
function createModel(level){
 const t=themes[level];
 if(!t||typeof object!=='function'||typeof install!=='function'){
  alert('Les modèles nécessitent l’atelier SVT connecté.');return;
 }
 if(!confirm('Créer une nouvelle fiche '+level+' ? La fiche affichée sera remplacée dans l’éditeur. Enregistre-la d’abord si nécessaire.'))return;
 const items=[];
 function add(type,options){const o=object(type,Object.assign({font:'Arial,sans-serif',color:t.ink},options));items.push(o);return o;}
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
 add('text',{label:'Slogan',x:48,y:1065,w:698,h:35,text:slogan,size:10,font:'Georgia,serif',italic:true,align:'center'});
 install({app:'herbier-libre',version:1,title:'Nouvelle activité '+level,documentType:'activite',graded:false,competencies:[],pages:[{objects:items}]});
 if(typeof closeHome==='function')closeHome();
 if(typeof status==='function')status('Modèle '+t.name+' créé. Choisis les compétences et complète la fiche.');
}
function init(){
 if(!document.getElementById('stage')||typeof install!=='function')return;
 if(document.getElementById('svt-modeles-panel'))return;
 const style=document.createElement('style');
 style.textContent='.svt-modeles-panel{margin:16px 0;padding:12px;border:1px solid #cbd4bf;border-radius:10px;background:#fbf8ee}.svt-modeles-panel h2{margin:0 0 9px}.svt-modele-actions{display:grid;gap:7px}.svt-modele-btn{border-left:5px solid var(--modele);text-align:left;background:var(--pale)}.svt-modele-btn:focus-visible{outline:3px solid var(--modele);outline-offset:2px}';
 document.head.appendChild(style);
 const aside=document.querySelector('.layout>aside');
 const panel=document.createElement('section');panel.id='svt-modeles-panel';panel.className='svt-modeles-panel';
 const heading=document.createElement('h2');heading.textContent='Mes modèles SVT';panel.appendChild(heading);
 const actions=document.createElement('div');actions.className='svt-modele-actions';
 Object.entries(themes).forEach(([level,t])=>{
  const button=document.createElement('button');button.type='button';button.className='svt-modele-btn';button.style.setProperty('--modele',t.ink);button.style.setProperty('--pale',t.pale);button.textContent='Nouvelle fiche '+t.name;button.onclick=()=>createModel(level);actions.appendChild(button);
 });panel.appendChild(actions);if(aside)aside.prepend(panel);
 const home=document.querySelector('#atelierHome .home-actions');
 if(home){
  const old=[...home.querySelectorAll('button')].find(b=>(b.getAttribute('onclick')||'').includes('startDemo'));
  Object.entries(themes).forEach(([level,t])=>{
   const button=document.createElement('button');button.type='button';button.className='home-action';button.style.borderLeft='5px solid '+t.ink;
   const title=document.createElement('strong');title.textContent='Modèle '+t.name;
   const text=document.createElement('span');text.textContent='Logo, titre, compétences, deux cadres de documents et slogan.';
   button.append(title,text);button.onclick=()=>createModel(level);
   if(old)home.insertBefore(button,old);else home.appendChild(button);
  });if(old)old.remove();
 }
 document.querySelectorAll('button[onclick="resetDemo()"]').forEach(b=>{b.hidden=true;});
 const title=document.querySelector('header>strong');if(title)title.textContent='❧ Atelier pédagogique SVT';
 const intro=document.querySelector('#atelierHome .home-text');if(intro)intro.textContent='Crée une fiche vierge ou utilise ton modèle de niveau : vert en 6e, bleu en 5e, violet en 3e. Chaque modèle crée une nouvelle fiche indépendante.';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
