/* Espace professeur — trame pédagogique libre et privée. */
(function(){
 'use strict';
 const $=selector=>document.querySelector(selector);
 const M=window.SvtTrame,client=window.sb;
 const state={user:null,niveau:'6e',data:{chapitres:[]},version:0,dirty:false,ready:false,busy:false,
  bank:null,bankLoading:false,bankError:'',target:null};
 const esc=M.escapeHtml;
 function notice(message,error=false){
  const el=$('#trameNotice');
  el.textContent=message;el.hidden=!message;el.classList.toggle('error',!!error);
 }
 function refreshHeader(){
  const ch=state.data.chapitres;
  $('#trameStats').textContent=ch.length+' chapitre(s) · '+ch.reduce((n,x)=>n+x.seances.length,0)+' séance(s)';
  $('#trameSave').disabled=!state.ready||!state.dirty||state.busy;
  $('#trameAddChapter').disabled=!state.ready||state.busy;
 }
 function dirty(){
  state.dirty=true;refreshHeader();
  notice('Modifications non enregistrées : clique sur « Enregistrer les modifications ».');
 }
 function findChapter(id){return state.data.chapitres.find(ch=>ch.id===id)}
 function findSession(ch,id){return ch?.seances.find(se=>se.id===id)}
 const actionButton=(action,icon,title,attrs='')=>'<button type="button" class="trame-btn" data-action="'+action+'" '+attrs+' title="'+title+'">'+icon+'</button>';
 function render(){
  const root=$('#trameChapters');
  if(!state.ready){
   root.innerHTML='<div class="trame-empty"><strong>Trame indisponible.</strong> Connecte-toi depuis l’espace professeur et vérifie la configuration Supabase.</div>';
   refreshHeader();return;
  }
  root.innerHTML=state.data.chapitres.length?state.data.chapitres.map((ch,ci)=>{
   const chapterAttrs='data-chapter="'+esc(ch.id)+'"';
   return '<article class="trame-chapter" '+chapterAttrs+'><div class="trame-chapter-head"><strong>📚 Chapitre '+(ci+1)+'</strong><div class="trame-actions">'
    +actionButton('chapter-up','↑','Monter le chapitre',chapterAttrs+(ci===0?' disabled':''))
    +actionButton('chapter-down','↓','Descendre le chapitre',chapterAttrs+(ci===state.data.chapitres.length-1?' disabled':''))
    +actionButton('chapter-delete','✕','Supprimer le chapitre',chapterAttrs)
    +'</div></div><div class="trame-chapter-body">'
    +'<label class="trame-field">Titre théorique du chapitre<input class="trame-input" maxlength="180" data-field="chapter-title" '+chapterAttrs+' value="'+esc(ch.titre)+'" placeholder="Ex. La circulation sanguine"></label>'
    +'<label class="trame-field">Objectif ou problématique de référence (facultatif)<textarea class="trame-input" rows="2" maxlength="1200" data-field="chapter-objective" '+chapterAttrs+' placeholder="Idée générale du chapitre…">'+esc(ch.objectif)+'</textarea></label>'
    +(ch.seances.length?ch.seances.map((se,si)=>{
     const attrs=chapterAttrs+' data-session="'+esc(se.id)+'"';
     return '<section class="trame-session" '+attrs+'><div class="trame-session-head"><strong>📖 Séance '+(si+1)+'</strong><div class="trame-actions">'
      +actionButton('session-up','↑','Monter la séance',attrs+(si===0?' disabled':''))
      +actionButton('session-down','↓','Descendre la séance',attrs+(si===ch.seances.length-1?' disabled':''))
      +actionButton('session-delete','✕','Supprimer la séance',attrs)
      +'</div></div>'
      +'<label class="trame-field">Titre de référence<input class="trame-input" maxlength="180" data-field="session-title" '+attrs+' value="'+esc(se.titre)+'" placeholder="Ex. Organisation du cœur"></label>'
      +'<label class="trame-field">Question / objectif (facultatif)<textarea class="trame-input" rows="2" maxlength="1200" data-field="session-problem" '+attrs+' placeholder="Ex. Comment le cœur permet-il la circulation ?">'+esc(se.probleme)+'</textarea></label>'
      +'<div class="trame-muted"><strong>Activités associées depuis l’atelier</strong></div>'
      +'<div class="trame-activity-list">'+(se.activites.length?se.activites.map((act,ai)=>{
       const actAttrs=attrs+' data-activity="'+esc(act.id)+'"';
       return '<div class="trame-activity"><span>🧪 <strong>'+esc(act.title||'Activité')+'</strong>'
        +' <a href="atelier.html?doc='+encodeURIComponent(act.docId)+'" target="_blank" rel="noopener">ouvrir dans l’atelier ↗</a></span><div class="trame-actions">'
        +actionButton('activity-up','↑','Monter',actAttrs+(ai===0?' disabled':''))
        +actionButton('activity-down','↓','Descendre',actAttrs+(ai===se.activites.length-1?' disabled':''))
        +actionButton('activity-delete','✕','Retirer le lien',actAttrs)
        +'</div></div>';
      }).join(''):'<small class="trame-muted">Aucune activité liée pour l’instant.</small>')+'</div>'
      +'<p><button type="button" class="trame-btn" data-action="activity-add" '+attrs+'>＋ Choisir une activité de l’atelier</button></p></section>';
    }).join(''):'<p class="trame-muted">Aucune séance. Ajoute une séance théorique pour commencer.</p>')
    +'<button class="trame-btn" type="button" data-action="session-add" '+chapterAttrs+'>＋ Ajouter une séance</button>'
    +'</div></article>';
  }).join(''):'<div class="trame-empty"><h2>Ta trame '+esc(state.niveau)+' est vide</h2><p>Commence par ajouter un chapitre. Tu pourras ensuite y ranger tes séances et retrouver directement les activités de ton atelier.</p></div>';
  refreshHeader();
 }
 async function load(niveau){
  state.ready=false;state.busy=true;state.niveau=niveau;state.dirty=false;
  $('#trameLevel').value=niveau;render();notice('Chargement de la trame '+niveau+'…');
  try{
   const result=await M.read(client,state.user.id,niveau);
   state.data=result.data;state.version=result.version;state.ready=true;
   notice(result.exists?'Trame '+niveau+' chargée.':'Trame '+niveau+' vide : ajoute un chapitre, puis enregistre.');
  }catch(error){
   console.error('[Trame] Lecture',error);
   notice('Impossible de charger la trame Supabase : '+(error.message||error)+
    '. Si la table svt_trames n’existe pas encore, exécute le script propositions-sql/svt_trames.sql dans Supabase > SQL Editor.',true);
  }finally{state.busy=false;render()}
 }
 async function save(){
  if(!state.ready||state.busy||!state.dirty)return;
  state.busy=true;refreshHeader();
  try{
   const payload=M.normalize(state.data),version=await M.save(client,state.user.id,state.niveau,payload,state.version);
   state.data=payload;state.version=version;state.dirty=false;
   notice('Trame '+state.niveau+' enregistrée dans Supabase ✓');render();
  }catch(error){
   notice('Enregistrement refusé : '+(error.message||error)+'. Tes modifications restent affichées.',true);
   console.error('[Trame] Enregistrement',error);
  }finally{state.busy=false;refreshHeader()}
 }
 async function bank(){
  if(state.bank)return state.bank;
  if(state.bankLoading)return [];
  state.bankLoading=true;state.bankError='';
  try{
   const rows=[],size=500;
   for(let start=0;start<3000;start+=size){
    const {data,error}=await client.from('atelier_documents')
     .select('id,titre,classe,chapitre_titre,document_type,updated_at')
     .eq('user_id',state.user.id).order('updated_at',{ascending:false})
     .range(start,start+size-1);
    if(error)throw error;
    const page=data||[];
    rows.push(...page);
    if(page.length<size)break;
   }
   state.bank=rows;return rows;
  }catch(e){state.bankError=e.message||String(e);throw e}
  finally{state.bankLoading=false}
 }
 function bankResults(){
  const root=$('#trameBankResults');
  const query=$('#trameBankSearch').value.toLocaleLowerCase('fr-FR').trim();
  const ch=findChapter(state.target?.chapter),se=findSession(ch,state.target?.session);
  if(!se){root.innerHTML='<p>La séance n’est plus accessible.</p>';return}
  const docs=(state.bank||[]).filter(d=>!se.activites.some(a=>a.docId===d.id));
  const filtered=docs.filter(d=>!query||[d.titre,d.classe,d.chapitre_titre,d.document_type].some(v=>String(v||'').toLocaleLowerCase('fr-FR').includes(query)));
  const shown=filtered.slice(0,60);
  root.innerHTML='<p class="trame-muted">'+filtered.length+' document(s) correspondants'+(filtered.length>60?' · 60 premiers affichés':'')+'</p>'
   +(shown.length?shown.map(d=>'<div class="trame-bank-result"><div><strong>'+esc(d.titre||'Document sans titre')+'</strong>'
     +'<small>'+esc([d.document_type,d.classe,d.chapitre_titre].filter(Boolean).join(' · ')||'Sans classement')+'</small></div>'
     +'<button type="button" class="trame-btn" data-choose-doc="'+esc(d.id)+'">＋ Associer</button></div>').join('')
    :'<p class="trame-muted">Aucun document trouvé. Vérifie la banque de ton atelier.</p>');
 }
 async function openBank(chapterId,sessionId){
  state.target={chapter:chapterId,session:sessionId};
  $('#trameBankModal').hidden=false;
  $('#trameBankSearch').value='';
  $('#trameBankResults').textContent='Chargement de la banque…';
  try{await bank();if(!$('#trameBankModal').hidden)bankResults()}
  catch(e){$('#trameBankResults').textContent='Banque indisponible : '+(e.message||e)}
 }
 function closeBank(){$('#trameBankModal').hidden=true;state.target=null}
 function move(list,index,direction){
  const to=index+direction;
  if(index<0||to<0||to>=list.length)return false;
  [list[index],list[to]]=[list[to],list[index]];return true;
 }
 function chooseAction(button){
  const action=button.dataset.action,chapterId=button.dataset.chapter;
  const ch=findChapter(chapterId),se=findSession(ch,button.dataset.session);
  if(action==='session-add'&&ch){
   if(ch.seances.length>=100)return notice('Limite de 100 séances par chapitre.',true);
   ch.seances.push({id:M.uid(),titre:'',probleme:'',activites:[]});dirty();render();return;
  }
  if(action==='activity-add'&&se){openBank(chapterId,se.id);return;}
  if(!ch)return;
  const chapterIndex=state.data.chapitres.indexOf(ch);
  if(action==='chapter-delete'){
   if(!confirm('Supprimer ce chapitre et ses séances de la trame ? Les cahiers et l’atelier ne seront pas modifiés.'))return;
   state.data.chapitres.splice(chapterIndex,1);
  }else if(action==='chapter-up'||action==='chapter-down'){
   if(!move(state.data.chapitres,chapterIndex,action==='chapter-up'?-1:1))return;
  }else if(se){
   const sessionIndex=ch.seances.indexOf(se);
   if(action==='session-delete'){
    if(!confirm('Supprimer cette séance de la trame ? Les cahiers déjà créés restent inchangés.'))return;
    ch.seances.splice(sessionIndex,1);
   }else if(action==='session-up'||action==='session-down'){
    if(!move(ch.seances,sessionIndex,action==='session-up'?-1:1))return;
   }else{
    const index=se.activites.findIndex(a=>a.id===button.dataset.activity);
    if(index<0)return;
    if(action==='activity-delete')se.activites.splice(index,1);
    else if(!move(se.activites,index,action==='activity-up'?-1:1))return;
   }
  }else{return}
  dirty();render();
 }
 function bind(){
  $('#trameAddChapter').onclick=()=>{
   if(!state.ready)return;
   if(state.data.chapitres.length>=100)return notice('Maximum 100 chapitres par niveau.',true);
   state.data.chapitres.push({id:M.uid(),titre:'',objectif:'',seances:[]});
   dirty();render();
  };
  $('#trameSave').onclick=save;
  $('#trameLevel').onchange=async e=>{
   const requested=e.target.value;
   if(requested===state.niveau)return;
   if(state.dirty&&!confirm('Des changements ne sont pas enregistrés. Quitter ce niveau et les abandonner ?')){
    e.target.value=state.niveau;return;
   }
   await load(requested);
   const url=new URL(location.href);url.searchParams.set('niveau',requested);history.replaceState(null,'',url);
  };
  $('#trameChapters').addEventListener('input',e=>{
   const f=e.target.closest('[data-field]');
   if(!f)return;
   const ch=findChapter(f.dataset.chapter),se=findSession(ch,f.dataset.session);
   if(!ch)return;
   const map={'chapter-title':()=>{ch.titre=f.value},'chapter-objective':()=>{ch.objectif=f.value},
    'session-title':()=>{if(se)se.titre=f.value},'session-problem':()=>{if(se)se.probleme=f.value}};
   if(map[f.dataset.field]){map[f.dataset.field]();dirty()}
  });
  $('#trameChapters').addEventListener('click',e=>{
   const btn=e.target.closest('[data-action]');
   if(btn)chooseAction(btn);
  });
  $('#trameBankClose').onclick=closeBank;
  $('#trameBankModal').addEventListener('click',e=>{if(e.target===$('#trameBankModal'))closeBank()});
  $('#trameBankSearch').addEventListener('input',bankResults);
  $('#trameBankResults').addEventListener('click',e=>{
   const button=e.target.closest('[data-choose-doc]');if(!button||!state.target)return;
   const doc=state.bank.find(x=>x.id===button.dataset.chooseDoc);
   const se=findSession(findChapter(state.target.chapter),state.target.session);
   if(!doc||!se||se.activites.some(a=>a.docId===doc.id))return;
   if(se.activites.length>=100)return notice('Limite de 100 activités par séance.',true);
   se.activites.push({id:M.uid(),docId:doc.id,title:String(doc.titre||'Activité').trim().slice(0,200)});
   dirty();closeBank();render();
  });
  window.addEventListener('beforeunload',e=>{
   if(state.dirty){e.preventDefault();e.returnValue=''}
  });
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#trameBankModal').hidden)closeBank()});
 }
 async function init(){
  bind();
  $('#trameAddChapter').disabled=true;
  const params=new URLSearchParams(location.search),level=params.get('niveau');
  if(M.LEVELS.includes(level))state.niveau=level;
  $('#trameLevel').value=state.niveau;
  if(!client||!M){notice('Configuration du site incomplète.',true);return}
  try{
   const {data,error}=await client.auth.getUser();if(error)throw error;
   if(!data?.user){notice('Connecte-toi dans l’espace professeur, puis rouvre la trame.',true);render();return}
   state.user=data.user;await load(state.niveau);
   const sessionId=params.get('session');
   if(sessionId&&M.findSession(state.data,sessionId)){
    const target=$('[data-session="'+sessionId+'"]');
    target?.scrollIntoView({behavior:'smooth',block:'center'});
   }
  }catch(error){notice('Connexion impossible : '+(error.message||error),true);render()}
 }
 init();
})();
