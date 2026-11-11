/* QCU automatique — module indépendant du QCU historique.
   Déploiement pilote : Mémo 1, chapitre 1, classe 5e1. */
(function(){
  'use strict';
  const QUESTIONS = [
    {key:'digestion_types',text:'Quels sont les deux types de digestion ?',options:{A:'Mécanique et chimique',B:'Physique et biologique',C:'Chimique et énergétique',D:'Mécanique et énergétique'},correct:'A'},
    {key:'digestion_mecanique',text:'Quel organe assure une digestion mécanique ?',options:{A:'L’œsophage',B:'L’intestin grêle',C:'La bouche',D:'Le sang'},correct:'C'},
    {key:'enzyme_definition',text:'Qu’est-ce qu’une enzyme ?',options:{A:'Une cellule qui absorbe les nutriments',B:'Une molécule qui assure la digestion chimique',C:'Un organe du système digestif',D:'Une molécule qui transporte les nutriments'},correct:'B'},
    {key:'groupes_aliments',text:'Combien existe-t-il de groupes d’aliments ?',options:{A:'4',B:'5',C:'6',D:'7'},correct:'C'},
    {key:'absorption',text:'Où sont absorbés les nutriments ?',options:{A:'Dans la bouche',B:'Dans l’estomac',C:'Dans le sang',D:'Dans l’intestin grêle'},correct:'D'},
    {key:'trajet_nutriments',text:'Quel est le trajet des nutriments jusqu’aux cellules ?',options:{A:'Bouche → estomac → cellules',B:'Intestin grêle → sang → cellules',C:'Estomac → intestin → cellules',D:'Sang → intestin grêle → cellules'},correct:'B'},
    {key:'digestion_chimique',text:'Quel organe assure une digestion chimique ?',options:{A:'L’œsophage',B:'L’estomac',C:'Le sang',D:'L’intestin grêle'},correct:'B'},
    {key:'roles_nutriments',text:'Quels sont les trois rôles des nutriments ?',options:{A:'Digestif, mécanique et chimique',B:'Bâtisseur, énergétique et fonctionnel',C:'Énergétique, digestif et bâtisseur',D:'Fonctionnel, mécanique et énergétique'},correct:'B'}
  ];
  const SUBJECTS = {
    A:['digestion_types','digestion_mecanique','enzyme_definition','groupes_aliments','absorption'],
    B:['trajet_nutriments','digestion_chimique','roles_nutriments','enzyme_definition','groupes_aliments'],
    C:['absorption','digestion_types','digestion_mecanique','roles_nutriments','enzyme_definition'],
    D:['digestion_chimique','trajet_nutriments','absorption','roles_nutriments','enzyme_definition']
  };
  const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const getClient = () => { try { return sb; } catch(e) { return window.sb || null; } };
  function addHomeCard(){
    const main=document.querySelector('main#content');
    if(!main || document.getElementById('qcuAutoHomeCard')) return;
    const section=[...main.querySelectorAll('section')].find(s=>/Évaluer/.test(s.innerText||''));
    const grid=section?.querySelector('.grid');
    if(!grid) return;
    const card=document.createElement('article'); card.className='card'; card.id='qcuAutoHomeCard';
    card.innerHTML='<span class="tag">Nouveau module</span><h3>📷 QCU – Correction automatique</h3><p class="muted">Banque de questions, sujets A à D, fiches individuelles avec QR code et correction par photo.</p><button type="button" class="primary" onclick="openQcuAuto()">Préparer le test pilote</button>';
    grid.appendChild(card);
  }
  async function openQcuAuto(){
    if(typeof correctionAllowLeave==='function' && !correctionAllowLeave()) return;
    const client=getClient(); if(!client){alert('Connexion Supabase introuvable. Recharge la page et reconnecte-toi.');return;}
    const content=document.getElementById('content'); if(!content)return;
    if(typeof saveEvalNav==='function') saveEvalNav({view:'qcuAuto'});
    const {data:auth}=await client.auth.getUser();
    if(!auth?.user){alert('Tu dois être connecté à ton espace professeur.');return;}
    window.qcuAutoUserId=auth.user.id;
    content.innerHTML=`<button type="button" onclick="home()">← Accueil</button>
      <section class="hero" style="margin-top:14px"><span class="eyebrow">Nouveau module · test pilote</span><h2>📷 QCU – Correction automatique</h2><p class="muted">Mémo 1 · Chapitre 1 · 5e1</p><p>Choisis entre 5 et 10 élèves. Le module attribuera les sujets A, B, C et D et créera une fiche-réponse individuelle avec QR code.</p></section>
      <section class="card" style="padding:18px;margin-top:16px"><h3>1. Sélection des élèves de 5e1</h3><div id="qcuAutoStudents">Chargement de la liste…</div><p id="qcuAutoMsg" class="muted" aria-live="polite"></p><button class="primary" id="qcuAutoCreate" type="button" disabled onclick="qcuAutoCreateSession()">Créer la session et les fiches</button></section>
      <section id="qcuAutoResult"></section>`;
    await loadStudents(client);
  }
  async function loadStudents(client){
    const host=document.getElementById('qcuAutoStudents');
    const {data,error}=await client.from('Eleves').select('id,nom,prenom,classe').eq('classe','5e1').order('nom').order('prenom');
    if(error){host.innerHTML='<p class="error">Impossible de charger les élèves : '+esc(error.message)+'</p>';return;}
    if(!data?.length){host.innerHTML='<p>Aucun élève trouvé dans la classe 5e1. Vérifie l’intitulé exact de la classe dans ta banque d’élèves.</p>';return;}
    host.innerHTML=`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px"><button type="button" onclick="qcuAutoSelect(5)">Sélectionner les 5 premiers</button><button type="button" onclick="qcuAutoSelect(10)">Sélectionner les 10 premiers</button><button type="button" onclick="qcuAutoClear()">Tout désélectionner</button></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px">${data.map((e,i)=>`<label style="display:flex;gap:8px;align-items:center;padding:9px;border:1px solid #dce2cb;border-radius:7px"><input type="checkbox" class="qcu-auto-student" value="${esc(e.id)}"><span>${esc(e.prenom)} ${esc(e.nom)}</span></label>`).join('')}</div><p class="muted">${data.length} élève(s) trouvé(s) · coche 5 à 10 élèves pour le test.</p>`;
    document.querySelectorAll('.qcu-auto-student').forEach(x=>x.addEventListener('change',updateCount));
  }
  function selected(){return [...document.querySelectorAll('.qcu-auto-student:checked')].map(x=>x.value)}
  function updateCount(){const n=selected().length;const b=document.getElementById('qcuAutoCreate');if(b)b.disabled=n<5||n>10;const m=document.getElementById('qcuAutoMsg');if(m)m.textContent=n+' élève(s) sélectionné(s) — '+(n>=5&&n<=10?'prêt pour le test':'il en faut entre 5 et 10');}
  function qcuAutoSelect(n){document.querySelectorAll('.qcu-auto-student').forEach((x,i)=>x.checked=i<n);updateCount()}
  function qcuAutoClear(){document.querySelectorAll('.qcu-auto-student').forEach(x=>x.checked=false);updateCount()}
  async function qcuAutoCreateSession(){
    const client=getClient(), ids=selected(), btn=document.getElementById('qcuAutoCreate'), msg=document.getElementById('qcuAutoMsg'), result=document.getElementById('qcuAutoResult');
    if(ids.length<5||ids.length>10){alert('Sélectionne entre 5 et 10 élèves.');return;}
    btn.disabled=true;btn.textContent='Création en cours…';msg.textContent='Création de la banque de questions, des sujets et des attributions…';
    try{
      const userId=window.qcuAutoUserId;
      const {data:session,error:se}=await client.from('qcu_sessions').insert({created_by:userId,classe:'5e1',trimestre:1,titre:'Mémo 1 – Chapitre 1',date_qcu:new Date().toISOString().slice(0,10),statut:'brouillon'}).select().single();
      if(se)throw se;
      const questionIds={};
      for(const q of QUESTIONS){
        const {data:existing,error:qe}=await client.from('qcu_questions').select('id').eq('created_by',userId).eq('chapitre',1).eq('question_text',q.text).limit(1);
        if(qe)throw qe;
        if(existing?.length){questionIds[q.key]=existing[0].id;continue;}
        const {data:created,error:ie}=await client.from('qcu_questions').insert({created_by:userId,chapitre:1,question_text:q.text,options:q.options,correct_option:q.correct,active:true}).select('id').single();
        if(ie)throw ie; questionIds[q.key]=created.id;
      }
      const subjectIds={};
      for(const code of ['A','B','C','D']){
        const {data:s,error:su}=await client.from('qcu_sujets').insert({created_by:userId,session_id:session.id,code,titre:'Sujet '+code}).select('id').single();
        if(su)throw su; subjectIds[code]=s.id;
        const rows=SUBJECTS[code].map((key,i)=>{const q=QUESTIONS.find(x=>x.key===key);return {created_by:userId,sujet_id:s.id,question_id:questionIds[key],position:i+1,question_text_snapshot:q.text,options_snapshot:q.options,correct_option_snapshot:q.correct};});
        const {error:qi}=await client.from('qcu_sujet_questions').insert(rows); if(qi)throw qi;
      }
      const {data:students,error:st}=await client.from('Eleves').select('id,nom,prenom,classe').in('id',ids); if(st)throw st;
      const attrs=[];
      for(let i=0;i<students.length;i++){
        const e=students[i],code=['A','B','C','D'][i%4];
        attrs.push({created_by:userId,session_id:session.id,sujet_id:subjectIds[code],eleve_id:e.id,classe:'5e1',statut:'attribue'});
      }
      const {data:createdAttrs,error:ae}=await client.from('qcu_attributions').insert(attrs).select('id,sujet_id,eleve_id'); if(ae)throw ae;
      const byId=Object.fromEntries(students.map(s=>[s.id,s]));
      const cards=createdAttrs.map(a=>{const e=byId[a.eleve_id],code=Object.keys(subjectIds).find(k=>subjectIds[k]===a.sujet_id);return {id:a.id,name:e.prenom+' '+e.nom,code};});
      window.qcuAutoPrintCards=cards;
      result.innerHTML=`<section class="hero" style="margin-top:16px"><h3>Session créée</h3><p>${cards.length} fiches individuelles créées pour la 5e1. Répartition des sujets A, B, C et D.</p><p><strong>Important :</strong> cette première version prépare la session et les fiches QR. La lecture photographique et la correction automatique seront ajoutées après validation de l'impression.</p><button class="primary" onclick="qcuAutoPrint()">Imprimer les fiches-réponses</button></section><div id="qcuAutoPrintArea" class="qcu-auto-print">${cards.map(c=>`<article class="qcu-auto-sheet"><div class="qcu-auto-sheet-head"><div><h2>Fiche-réponse · Mémo 1</h2><p>Chapitre 1 · 5e1 · Sujet ${c.code}</p><p>Élève : <strong>${esc(c.name)}</strong></p></div><div class="qcu-auto-qr" data-id="${c.id}"></div></div><p>Pour chaque question, noircis complètement le cercle correspondant à une seule réponse. Utilise un stylo noir ou bleu foncé. Ne coche pas plusieurs réponses.</p><table><thead><tr><th>Question</th><th>A</th><th>B</th><th>C</th><th>D</th></tr></thead><tbody>${[1,2,3,4,5].map(n=>`<tr><th>${n}</th>${['A','B','C','D'].map(v=>`<td><span class="qcu-auto-bubble" aria-label="Réponse ${v}"></span></td>`).join('')}</tr>`).join('')}</tbody></table><small>Code individuel : ${c.id}</small></article>`).join('')}</div>`;
      if(!document.getElementById('qcuAutoQrLib')){const sc=document.createElement('script');sc.id='qcuAutoQrLib';sc.src='https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';sc.onload=drawQR;document.head.appendChild(sc);}else drawQR();
      msg.textContent='Session créée avec succès.';
    }catch(e){console.error(e);msg.textContent='Erreur : '+(e.message||String(e));btn.disabled=false;btn.textContent='Réessayer';}
  }
  function drawQR(){if(!window.QRCode)return;document.querySelectorAll('.qcu-auto-qr').forEach(el=>{if(el.dataset.done)return;new QRCode(el,{text:el.dataset.id,width:105,height:105,correctLevel:QRCode.CorrectLevel.M});el.dataset.done='1';});}
  function qcuAutoPrint(){
    drawQR();
    const source=document.getElementById('qcuAutoPrintArea');
    if(!source){alert('Les fiches-réponses sont introuvables.');return;}
    const printWindow=window.open('','_blank');
    if(!printWindow){alert('La fenêtre d’impression a été bloquée. Autorise les fenêtres pop-up pour ce site puis réessaie.');return;}
    const sheets=source.innerHTML;
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fiches-réponses · Mémo 1</title><style>
      @page{size:A4 portrait;margin:10mm}
      *{box-sizing:border-box}
      html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif}
      .qcu-auto-sheet{width:100%;min-height:270mm;padding:4mm 0;background:#fff;color:#111;page-break-after:always;break-after:page}
      .qcu-auto-sheet:last-child{page-break-after:auto;break-after:auto}
      .qcu-auto-sheet-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12mm}
      .qcu-auto-sheet h2{font-family:Georgia,serif;font-size:21pt;margin:0 0 8mm;color:#244a32}
      .qcu-auto-sheet p{font-size:11pt;margin:0 0 7mm}
      .qcu-auto-qr{width:30mm;height:30mm;min-width:30mm;min-height:30mm}
      .qcu-auto-qr img{width:30mm!important;height:30mm!important;display:block}
      .qcu-auto-sheet table{width:100%;border-collapse:collapse;margin:8mm 0}
      .qcu-auto-sheet th,.qcu-auto-sheet td{border:1px solid #222;text-align:center;padding:10mm 3mm;font-size:13pt}
      .qcu-auto-sheet tbody th{font-size:14pt;font-weight:700}
      .qcu-auto-sheet thead th{padding:6mm 3mm}
      .qcu-auto-sheet thead th{background:#edf2e2}
      .qcu-auto-bubble{display:inline-block;width:11mm;height:11mm;border:1.6px solid #111;border-radius:50%;vertical-align:middle;background:#fff}
      .qcu-auto-sheet small{font-size:7pt;overflow-wrap:anywhere}
      @media screen{body{padding:12mm;background:#eee}.qcu-auto-sheet{max-width:190mm;margin:0 auto 12mm;padding:10mm;background:#fff;box-shadow:0 1px 5px #999}}
    </style></head><body>${sheets}<script>window.onload=()=>{setTimeout(()=>window.print(),400)};<\/script></body></html>`);
    printWindow.document.close();
  }
  const style=document.createElement('style');style.textContent=`@media print{body *{visibility:hidden!important}#qcuAutoPrintArea,#qcuAutoPrintArea *{visibility:visible!important}#qcuAutoPrintArea{position:absolute;left:0;top:0;width:100%}.qcu-auto-sheet{page-break-after:always;break-after:page;padding:10mm;color:#111;background:#fff!important}.qcu-auto-sheet:last-child{page-break-after:auto}.qcu-auto-sheet table{width:100%;border-collapse:collapse;margin:22px 0}.qcu-auto-sheet th,.qcu-auto-sheet td{border:1px solid #222!important;text-align:center;padding:13px}.qcu-auto-sheet-head{display:flex;justify-content:space-between;align-items:center}.qcu-auto-bubble{display:inline-flex;width:25px;height:25px;border:1.5px solid #111;border-radius:50%;align-items:center;justify-content:center;font-size:12px}.qcu-auto-sheet small{font-size:7px;overflow-wrap:anywhere}}.qcu-auto-sheet{background:#fff;color:#222;padding:16px;margin:12px 0;border:1px solid #ccc}.qcu-auto-sheet table{width:100%;border-collapse:collapse}.qcu-auto-sheet th,.qcu-auto-sheet td{border:1px solid #444;padding:12px;text-align:center}.qcu-auto-sheet-head{display:flex;justify-content:space-between;align-items:center}.qcu-auto-qr{min-width:105px;min-height:105px}.qcu-auto-bubble{display:inline-flex;width:25px;height:25px;border:1px solid #333;border-radius:50%;align-items:center;justify-content:center}`;document.head.appendChild(style);
  window.openQcuAuto=openQcuAuto;window.qcuAutoSelect=qcuAutoSelect;window.qcuAutoClear=qcuAutoClear;window.qcuAutoCreateSession=qcuAutoCreateSession;window.qcuAutoPrint=qcuAutoPrint;
  const originalHome=window.home;
  if(typeof originalHome==='function')window.home=async function(){const r=await originalHome.apply(this,arguments);addHomeCard();return r;};
  document.addEventListener('DOMContentLoaded',addHomeCard);setTimeout(addHomeCard,500);
})();
