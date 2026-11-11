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
      result.innerHTML=`<section class="hero" style="margin-top:16px"><h3>Session créée</h3><p>${cards.length} fiches individuelles créées pour la 5e1. Répartition des sujets A, B, C et D.</p><button class="primary" onclick="qcuAutoPrint()">Imprimer les fiches-réponses</button></section>
      <section class="card" style="padding:18px;margin-top:16px">
        <h3>2. Scanner les fiches-réponses</h3>
        <p class="muted">Prends une photo de la fiche remplie ou importe une image. Vérifie l’aperçu avant de l’envoyer.</p>
        <p><strong>Importe plusieurs fiches en une seule fois.</strong> Le QR code permettra d'identifier automatiquement chaque élève.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label class="primary" for="qcuAutoCamera" style="display:inline-block;padding:10px 14px;border-radius:8px;cursor:pointer">📷 Prendre une photo</label>
          <input id="qcuAutoCamera" type="file" accept="image/*" capture="environment" style="display:none" onchange="qcuAutoPreviewScan(this)">
          <label class="secondary" for="qcuAutoFile" style="display:inline-block;padding:10px 14px;border:1px solid #999;border-radius:8px;cursor:pointer">🖼️ Importer plusieurs photos</label>
          <input id="qcuAutoFile" type="file" accept="image/*" multiple style="display:none" onchange="qcuAutoPreviewScan(this)">
        </div>
        <div id="qcuAutoScanPreview" style="display:none;margin-top:14px">
          <div id="qcuAutoScanInfo" class="muted"></div>
          <div id="qcuAutoScanThumbs" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin:12px 0"></div>
          <button type="button" class="primary" id="qcuAutoUploadButton" onclick="qcuAutoAnalyzeScan()">Analyser les fiches</button>
        </div>
        <p id="qcuAutoScanMessage" class="muted" aria-live="polite"></p>
      </section>
      <div id="qcuAutoPrintArea" class="qcu-auto-print">${cards.map(c=>`<article class="qcu-auto-sheet" style="position:relative"><span class="qcu-auto-marker qcu-auto-marker-tl"></span><span class="qcu-auto-marker qcu-auto-marker-tr"></span><span class="qcu-auto-marker qcu-auto-marker-bl"></span><span class="qcu-auto-marker qcu-auto-marker-br"></span><div class="qcu-auto-sheet-head"><div><h2>Fiche-réponse · Mémo 1</h2><p>Chapitre 1 · 5e1 · Sujet ${c.code}</p><p>Élève : <strong>${esc(c.name)}</strong></p></div><div class="qcu-auto-qr" data-id="${c.id}"></div></div><p>Pour chaque question, noircis complètement le cercle correspondant à une seule réponse. Utilise un stylo noir ou bleu foncé. Ne coche pas plusieurs réponses.</p><table><thead><tr><th>Question</th><th>A</th><th>B</th><th>C</th><th>D</th></tr></thead><tbody>${[1,2,3,4,5].map(n=>`<tr><th>${n}</th>${['A','B','C','D'].map(v=>`<td><span class="qcu-auto-bubble" aria-label="Réponse ${v}"></span></td>`).join('')}</tr>`).join('')}</tbody></table><small>Code individuel : ${c.id}</small></article>`).join('')}</div>`;
      if(!document.getElementById('qcuAutoQrLib')){const sc=document.createElement('script');sc.id='qcuAutoQrLib';sc.src='https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';sc.onload=drawQR;document.head.appendChild(sc);}else drawQR();
      msg.textContent='Session créée avec succès.';
    }catch(e){console.error(e);msg.textContent='Erreur : '+(e.message||String(e));btn.disabled=false;btn.textContent='Réessayer';}
  }
  let qcuAutoSelectedScanFiles=[];
  let qcuAutoScanPreviewUrls=[];
  function qcuAutoPreviewScan(input){
    const files=Array.from(input?.files||[]);
    if(!files.length)return;
    const msg=document.getElementById('qcuAutoScanMessage');
    const valid=files.filter(f=>f.type.startsWith('image/')&&f.size<=15*1024*1024);
    const rejected=files.length-valid.length;
    if(!valid.length){if(msg)msg.textContent='Aucune image valide. Formats image uniquement, 15 Mo maximum par photo.';input.value='';return;}
    qcuAutoSelectedScanFiles=valid;
    qcuAutoScanPreviewUrls.forEach(URL.revokeObjectURL);
    qcuAutoScanPreviewUrls=valid.map(f=>URL.createObjectURL(f));
    const panel=document.getElementById('qcuAutoScanPreview');
    const info=document.getElementById('qcuAutoScanInfo');
    const thumbs=document.getElementById('qcuAutoScanThumbs');
    if(panel)panel.style.display='block';
    if(info)info.textContent=`${valid.length} photo(s) sélectionnée(s)${rejected?` · ${rejected} fichier(s) ignoré(s)`:''}. Chaque fiche doit montrer clairement son QR code.`;
    if(thumbs)thumbs.innerHTML=valid.map((f,i)=>`<div style="font-size:12px;overflow-wrap:anywhere"><img src="${qcuAutoScanPreviewUrls[i]}" alt="Aperçu ${i+1}" style="width:100%;height:110px;object-fit:contain;border:1px solid #bbb;border-radius:6px"><div>${esc(f.name)}</div></div>`).join('');
    if(msg)msg.textContent='Les QR codes identifieront les élèves ; le moteur analysera les cercles avant toute correction.';
    const otherId=input.id==='qcuAutoCamera'?'qcuAutoFile':'qcuAutoCamera';
    const other=document.getElementById(otherId);if(other)other.value='';
  }
  function qcuAutoLoadQrDecoder(){
    if(typeof window.jsQR==='function')return Promise.resolve();
    if(window.qcuAutoQrDecoderPromise)return window.qcuAutoQrDecoderPromise;
    window.qcuAutoQrDecoderPromise=new Promise((resolve,reject)=>{
      const sc=document.createElement('script');
      sc.src='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
      sc.onload=()=>typeof window.jsQR==='function'?resolve():reject(new Error('Le lecteur QR n’a pas pu être initialisé.'));
      sc.onerror=()=>reject(new Error('Impossible de charger le lecteur QR. Vérifie ta connexion internet.'));
      document.head.appendChild(sc);
    });
    return window.qcuAutoQrDecoderPromise;
  }
  async function qcuAutoReadQr(file){
    await qcuAutoLoadQrDecoder();
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();img.src=url;
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Photo illisible'));});
      const max=1800,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      const result=window.jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'attemptBoth'});
      if(!result?.data)throw new Error('QR code non détecté. Reprends la photo en cadrant toute la fiche.');
      const id=result.data.trim();
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        throw new Error('Le QR code ne contient pas un identifiant de fiche reconnu.');
      return id;
    }finally{URL.revokeObjectURL(url);}
  }
  let qcuAutoPendingAnalyses=[];
  function qcuAutoLoadCv(){
    if(window.cv && window.cv.Mat)return Promise.resolve(window.cv);
    if(window.qcuAutoCvPromise)return window.qcuAutoCvPromise;
    window.qcuAutoCvPromise=new Promise((resolve,reject)=>{
      const finish=()=>{if(window.cv&&window.cv.Mat)resolve(window.cv);else reject(new Error('OpenCV n’a pas pu démarrer. Recharge la page puis réessaie.'));};
      const sc=document.createElement('script');sc.async=true;sc.src='https://docs.opencv.org/4.x/opencv.js';
      sc.onload=()=>{if(window.cv&&window.cv.Mat)finish();else if(window.cv)window.cv.onRuntimeInitialized=finish;else reject(new Error('Bibliothèque de lecture indisponible.'));};
      sc.onerror=()=>reject(new Error('Impossible de charger le moteur de lecture. Vérifie la connexion internet.'));
      document.head.appendChild(sc);
    });
    return window.qcuAutoCvPromise;
  }
  function qcuAutoLoadImage(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Photo illisible.'));};img.src=url;});}
  function qcuAutoDetectAnswers(cv, image){
    const maxSide=2200,scale=Math.min(1,maxSide/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
    let src=cv.imread(canvas),gray=new cv.Mat(),binary=new cv.Mat(),contours=new cv.MatVector(),hierarchy=new cv.Mat();
    let warped=new cv.Mat(),warpGray=new cv.Mat(),blurred=new cv.Mat(),circles=new cv.Mat();
    try{
      cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);cv.threshold(gray,binary,75,255,cv.THRESH_BINARY_INV);
      cv.findContours(binary,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      const W=canvas.width,H=canvas.height,cand=[];
      for(let i=0;i<contours.size();i++){
        const c=contours.get(i),area=cv.contourArea(c),r=cv.boundingRect(c);c.delete();
        if(area<120||area>5000||Math.min(r.width,r.height)<10)continue;
        const ar=r.width/r.height,fill=area/(r.width*r.height);
        if(ar<.58||ar>1.55||fill<.32)continue;
        cand.push({x:r.x+r.width/2,y:r.y+r.height/2,area,fill});
      }
      const zones={tl:[],tr:[],bl:[],br:[]};
      cand.forEach(p=>{
        if(p.x<W*.48&&p.y<H*.55)zones.tl.push(p);
        if(p.x>W*.52&&p.y<H*.55)zones.tr.push(p);
        if(p.x<W*.48&&p.y>H*.55)zones.bl.push(p);
        if(p.x>W*.52&&p.y>H*.55)zones.br.push(p);
      });
      Object.values(zones).forEach(a=>a.sort((x,y)=>y.area-x.area));
      const tl=zones.tl.slice(0,18),tr=zones.tr.slice(0,18),bl=zones.bl.slice(0,18),br=zones.br.slice(0,18);
      let best=null;
      for(const a of tl)for(const b of tr)for(const c of bl)for(const d of br){
        const top=Math.hypot(b.x-a.x,b.y-a.y),bottom=Math.hypot(d.x-c.x,d.y-c.y),left=Math.hypot(c.x-a.x,c.y-a.y),right=Math.hypot(d.x-b.x,d.y-b.y);
        const width=(top+bottom)/2,height=(left+right)/2,ratio=width/height;
        if(width<W*.35||height<H*.50||ratio<.55||ratio>.85)continue;
        const parallel=Math.hypot((a.x+d.x)-(b.x+c.x),(a.y+d.y)-(b.y+c.y))/(width+height);
        if(parallel>.20)continue;
        const areas=[a.area,b.area,c.area,d.area],mean=areas.reduce((s,v)=>s+v,0)/4;
        const variation=Math.sqrt(areas.reduce((s,v)=>s+(v-mean)**2,0)/4)/mean;
        const score=Math.abs(ratio-.707)+parallel*1.2+variation*.10;
        if(!best||score<best.score)best={score,points:[a,b,c,d]};
      }
      if(!best)throw new Error('Les quatre repères noirs ne sont pas détectés. Reprends la photo en cadrant toute la fiche.');
      const srcPts=cv.matFromArray(4,1,cv.CV_32FC2,best.points.flatMap(p=>[p.x,p.y]));
      const dstPts=cv.matFromArray(4,1,cv.CV_32FC2,[40,40,960,40,40,1360,960,1360]);
      const M=cv.getPerspectiveTransform(srcPts,dstPts);cv.warpPerspective(src,warped,M,new cv.Size(1000,1400),cv.INTER_LINEAR,cv.BORDER_REPLICATE,new cv.Scalar());
      cv.cvtColor(warped,warpGray,cv.COLOR_RGBA2GRAY);cv.medianBlur(warpGray,blurred,5);
      cv.HoughCircles(blurred,circles,cv.HOUGH_GRADIENT,1.2,55,100,24,12,28);
      srcPts.delete();dstPts.delete();M.delete();
      const found=[];
      for(let i=0;i<circles.cols;i++){
        const x=Math.round(circles.data32F[i*3]),y=Math.round(circles.data32F[i*3+1]),r=Math.round(circles.data32F[i*3+2]);
        if(y<300||y>1250||x<220||x>950)continue;
        let inner=0,innerN=0,ring=0,ringN=0;
        for(let yy=Math.max(0,y-r);yy<Math.min(1400,y+r);yy++)for(let xx=Math.max(0,x-r);xx<Math.min(1000,x+r);xx++){
          const dist=Math.hypot(xx-x,yy-y),v=warpGray.ucharAt(yy,xx);
          if(dist<r*.42){innerN++;if(v<135)inner++;}
          else if(dist>r*.65&&dist<r*.95){ringN++;if(v<135)ring++;}
        }
        const innerDark=innerN?inner/innerN:0,ringDark=ringN?ring/ringN:0;
        found.push({x,y,r,fill:innerDark,ring:ringDark});
      }
      found.sort((a,b)=>a.y-b.y);
      const rows=[];
      for(const p of found){let row=rows[rows.length-1];if(!row||p.y-row.meanY>55){row={items:[],meanY:p.y};rows.push(row);}row.items.push(p);row.meanY=row.items.reduce((s,v)=>s+v.y,0)/row.items.length;}
      if(rows.length!==5||rows.some(r=>r.items.length!==4))throw new Error(`Lecture incomplète : ${found.length} cercles repérés, répartis en ${rows.length} ligne(s). La fiche doit être vérifiée manuellement.`);
      const answers=[],scores=[];
      rows.forEach((row,qi)=>{
        row.items.sort((a,b)=>a.x-b.x);const sorted=row.items;
        const vals=sorted.map(p=>p.fill),order=vals.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v);
        const bestFill=order[0].v,second=order[1].v,diff=bestFill-second;
        let answer='',status='a_verifier',confidence=Math.max(0,Math.min(1,diff));
        if(bestFill>=.32&&diff>=.18){answer='ABCD'[order[0].i];status=bestFill>=.55?'detectee':'a_verifier';}
        else if(bestFill<.32){status='sans_reponse';}
        else{status='multiple';}
        answers.push({position:qi+1,answer,status,confidence,fillScores:vals});
        scores.push(vals);
      });
      return {answers,quality:best.score,preview:canvas.toDataURL('image/jpeg',.75)};
    }finally{src.delete();gray.delete();binary.delete();contours.delete();hierarchy.delete();warped.delete();warpGray.delete();blurred.delete();circles.delete();}
  }
  async function qcuAutoAnalyzeScan(){
    const files=qcuAutoSelectedScanFiles.slice(),msg=document.getElementById('qcuAutoScanMessage'),btn=document.getElementById('qcuAutoUploadButton');
    if(!files.length){if(msg)msg.textContent='Prends ou importe au moins une photo.';return;}
    if(btn){btn.disabled=true;btn.textContent='Analyse des fiches…';}
    qcuAutoPendingAnalyses=[];
    try{
      await qcuAutoLoadQrDecoder();const cv=await qcuAutoLoadCv(),client=getClient();
      for(let i=0;i<files.length;i++){
        const file=files[i];if(msg)msg.textContent=`Analyse de la fiche ${i+1}/${files.length} : QR code et réponses…`;
        const attributionId=await qcuAutoReadQr(file),img=await qcuAutoLoadImage(file),detection=qcuAutoDetectAnswers(cv,img);
        const {data:attr,error:ae}=await client.from('qcu_attributions').select('id,sujet_id,eleve_id,classe').eq('id',attributionId).single();if(ae)throw new Error(`QR reconnu mais attribution introuvable (${file.name}) : ${ae.message}`);
        const [{data:student,error:se},{data:subject,error:sue},{data:questions,error:qe}]=await Promise.all([
          client.from('Eleves').select('prenom,nom,classe').eq('id',attr.eleve_id).single(),
          client.from('qcu_sujets').select('code').eq('id',attr.sujet_id).single(),
          client.from('qcu_sujet_questions').select('id,position,correct_option_snapshot').eq('sujet_id',attr.sujet_id).order('position')
        ]);
        if(se)throw se;if(sue)throw sue;if(qe)throw qe;if(!questions||questions.length!==5)throw new Error(`Le sujet ${subject?.code||''} ne contient pas cinq questions.`);
        const ordered=questions.map(q=>({...q,detected:detection.answers.find(a=>a.position===q.position)}));
        qcuAutoPendingAnalyses.push({file,attributionId,attr,student,subject,questions:ordered,detection,manual:{}});
      }
      qcuAutoRenderReview();if(msg)msg.textContent=`Analyse terminée : ${qcuAutoPendingAnalyses.length} fiche(s). Vérifie les réponses avant l’enregistrement.`;
    }catch(e){console.error(e);if(msg)msg.textContent='Analyse interrompue : '+(e.message||String(e));}
    finally{if(btn){btn.disabled=false;btn.textContent='Analyser les fiches';}}
  }
  function qcuAutoRenderReview(){
    const panel=document.getElementById('qcuAutoScanPreview');if(!panel)return;
    let host=document.getElementById('qcuAutoReview');if(!host){host=document.createElement('div');host.id='qcuAutoReview';host.style.marginTop='16px';panel.appendChild(host);}
    host.innerHTML=`<h3>3. Vérification des réponses détectées</h3><p class="muted">Les réponses incertaines restent à vérifier. Tu peux corriger chaque choix avant d’enregistrer.</p>${qcuAutoPendingAnalyses.map((a,i)=>`<article class="card" style="margin:12px 0;padding:14px"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><img src="${a.detection.preview}" alt="Fiche redressée" style="width:100px;max-height:140px;object-fit:contain;border:1px solid #ddd"><div><strong>${esc(a.student.prenom)} ${esc(a.student.nom)}</strong><div>Sujet ${esc(a.subject.code)} · ${esc(a.file.name)}</div></div></div><table style="width:100%;border-collapse:collapse;margin-top:10px"><thead><tr><th>Question</th><th>Réponse détectée</th><th>Corrigé</th><th>État</th></tr></thead><tbody>${a.questions.map((q,j)=>`<tr><td>${q.position}</td><td><select data-scan="${i}" data-question="${j}" class="qcu-auto-answer"><option value="">— Aucune —</option>${['A','B','C','D'].map(v=>`<option value="${v}" ${q.detected?.answer===v?'selected':''}>${v}</option>`).join('')}</select></td><td>${esc(q.correct_option_snapshot||'—')}</td><td>${q.detected?.status==='detectee'?'Détectée':q.detected?.status==='sans_reponse'?'Vide':q.detected?.status==='multiple'?'Ambiguë':'À vérifier'} · ${Math.round((q.detected?.confidence||0)*100)}%</td></tr>`).join('')}</tbody></table><p class="qcu-auto-score" data-score="${i}" style="font-weight:700;margin:8px 0">Score provisoire : ${a.questions.filter(q=>q.detected?.answer&&q.detected.answer===q.correct_option_snapshot).length}/5</p></article>`).join('')}<button type="button" class="primary" id="qcuAutoConfirmButton" onclick="qcuAutoConfirmScans()">Valider et enregistrer les corrections</button>`;
    host.querySelectorAll('.qcu-auto-answer').forEach(el=>el.addEventListener('change',()=>{const i=+el.dataset.scan,j=+el.dataset.question;qcuAutoPendingAnalyses[i].manual[j]=el.value;qcuAutoUpdateScores();}));
  }
  function qcuAutoUpdateScores(){document.querySelectorAll('.qcu-auto-score').forEach(el=>{const i=+el.dataset.score,a=qcuAutoPendingAnalyses[i];const n=a.questions.filter((q,j)=>{const v=Object.prototype.hasOwnProperty.call(a.manual,j)?a.manual[j]:q.detected?.answer;return v&&v===q.correct_option_snapshot;}).length;el.textContent=`Score provisoire : ${n}/5`;});}
  async function qcuAutoConfirmScans(){
    const client=getClient(),btn=document.getElementById('qcuAutoConfirmButton'),msg=document.getElementById('qcuAutoScanMessage');if(!client||!qcuAutoPendingAnalyses.length)return;
    if(btn){btn.disabled=true;btn.textContent='Enregistrement…';}
    let done=0;
    try{
      for(const a of qcuAutoPendingAnalyses){
        const userId=window.qcuAutoUserId,ext=(a.file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
        const path=`${userId}/${a.attributionId}/${Date.now()}-${done}.${ext}`;
        const {error:up}=await client.storage.from('qcu-copies').upload(path,a.file,{contentType:a.file.type||'image/jpeg',upsert:false});if(up)throw up;
        const uncertain=a.questions.some((q,j)=>{const manual=Object.prototype.hasOwnProperty.call(a.manual,j),v=manual?a.manual[j]:q.detected?.answer;return !v||(!manual&&q.detected?.status!=='detectee');});
        const {data:scan,error:se}=await client.from('qcu_scans').insert({attribution_id:a.attributionId,storage_path:path,statut:uncertain?'a_verifier':'traite',details_traitement:{methode:'opencv_hough_v1',sujet:a.subject.code,answers:a.questions.map((q,j)=>({position:q.position,answer:Object.prototype.hasOwnProperty.call(a.manual,j)?a.manual[j]:q.detected?.answer||null,confidence:q.detected?.confidence||0}))}}).select('id').single();
        if(se){await client.storage.from('qcu-copies').remove([path]);throw se;}
        const rows=a.questions.map((q,j)=>{
          const manual=Object.prototype.hasOwnProperty.call(a.manual,j),answer=manual?a.manual[j]:(q.detected?.answer||'');
          const status=!answer?(q.detected?.status==='multiple'&&!manual?'multiple':'sans_reponse'):(!manual&&q.detected?.status!=='detectee'?'a_verifier':(answer===q.correct_option_snapshot?'correct':'incorrect'));
          const resolved=status==='correct'||status==='incorrect';
          return {created_by:userId,attribution_id:a.attributionId,sujet_id:a.attr.sujet_id,sujet_question_id:q.id,scan_id:scan.id,selected_options:answer?[answer]:[],statut:status,is_correct:resolved?(answer===q.correct_option_snapshot):null,confiance:manual?1:(q.detected?.confidence||0),verification_manuelle:manual,reviewed_by:manual?userId:null,reviewed_at:manual?new Date().toISOString():null};
        });
        const {error:re}=await client.from('qcu_reponses').upsert(rows,{onConflict:'attribution_id,sujet_question_id'});if(re){await client.from('qcu_scans').delete().eq('id',scan.id);await client.storage.from('qcu-copies').remove([path]);throw re;}
        done++;
      }
      if(msg)msg.textContent=`Enregistrement terminé : ${done}/${qcuAutoPendingAnalyses.length} fiche(s) corrigée(s).`;
      qcuAutoPendingAnalyses=[];const host=document.getElementById('qcuAutoReview');if(host)host.innerHTML='';
      qcuAutoSelectedScanFiles=[];qcuAutoScanPreviewUrls.forEach(URL.revokeObjectURL);qcuAutoScanPreviewUrls=[];
      const thumbs=document.getElementById('qcuAutoScanThumbs');if(thumbs)thumbs.innerHTML='';const panel=document.getElementById('qcuAutoScanPreview');if(panel)panel.style.display='none';
      const camera=document.getElementById('qcuAutoCamera'),picker=document.getElementById('qcuAutoFile');if(camera)camera.value='';if(picker)picker.value='';
    }catch(e){console.error(e);if(msg)msg.textContent=`Enregistrement interrompu après ${done} fiche(s) : ${e.message||String(e)}. Les fiches déjà enregistrées ne sont pas à renvoyer.`;}
    finally{if(btn){btn.disabled=false;btn.textContent='Valider et enregistrer les corrections';}}
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
      @page{size:A4 portrait;margin:0}
      *{box-sizing:border-box}
      html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif}
      .qcu-auto-sheet{position:relative;width:210mm;height:297mm;min-height:297mm;margin:0;padding:15mm 14mm 12mm;background:#fff;color:#111;overflow:hidden;page-break-after:always;break-after:page}
      .qcu-auto-sheet:last-child{page-break-after:auto;break-after:auto}
      .qcu-auto-marker{position:absolute;display:block;width:6mm;height:6mm;background:#000!important;print-color-adjust:exact;-webkit-print-color-adjust:exact;z-index:10}
      .qcu-auto-marker-tl{top:8mm;left:8mm}
      .qcu-auto-marker-tr{top:8mm;right:8mm}
      .qcu-auto-marker-bl{bottom:8mm;left:8mm}
      .qcu-auto-marker-br{bottom:8mm;right:8mm}
      .qcu-auto-sheet-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12mm}
      .qcu-auto-sheet h2{font-family:Georgia,serif;font-size:21pt;margin:0 0 8mm;color:#244a32}
      .qcu-auto-sheet p{font-size:11pt;margin:0 0 7mm}
      .qcu-auto-qr{width:30mm;height:30mm;min-width:30mm;min-height:30mm}
      .qcu-auto-qr img{width:30mm!important;height:30mm!important;display:block}
      .qcu-auto-sheet table{width:100%;border-collapse:collapse;margin:8mm 0}
      .qcu-auto-sheet th,.qcu-auto-sheet td{border:1px solid #222;text-align:center;padding:10mm 3mm;font-size:13pt}
      .qcu-auto-sheet tbody th{font-size:14pt;font-weight:700}
      .qcu-auto-sheet thead th{padding:6mm 3mm;background:#edf2e2}
      .qcu-auto-bubble{display:inline-block;width:11mm;height:11mm;border:1.6px solid #111;border-radius:50%;vertical-align:middle;background:#fff}
      .qcu-auto-sheet small{font-size:7pt;overflow-wrap:anywhere}
      @media screen{body{padding:12mm;background:#eee}.qcu-auto-sheet{margin:0 auto 12mm;box-shadow:0 1px 5px #999}}
    </style></head><body>${sheets}<script>window.onload=()=>{setTimeout(()=>window.print(),400)};<\\/script></body></html>`);
    printWindow.document.close();
  }
  const style=document.createElement('style');style.textContent=`@media print{body *{visibility:hidden!important}#qcuAutoPrintArea,#qcuAutoPrintArea *{visibility:visible!important}#qcuAutoPrintArea{position:absolute;left:0;top:0;width:100%}.qcu-auto-sheet{page-break-after:always;break-after:page;padding:10mm;color:#111;background:#fff!important}.qcu-auto-sheet:last-child{page-break-after:auto}.qcu-auto-sheet table{width:100%;border-collapse:collapse;margin:22px 0}.qcu-auto-sheet th,.qcu-auto-sheet td{border:1px solid #222!important;text-align:center;padding:13px}.qcu-auto-sheet-head{display:flex;justify-content:space-between;align-items:center}.qcu-auto-bubble{display:inline-flex;width:25px;height:25px;border:1.5px solid #111;border-radius:50%;align-items:center;justify-content:center;font-size:12px}.qcu-auto-sheet small{font-size:7px;overflow-wrap:anywhere}}.qcu-auto-sheet{background:#fff;color:#222;padding:16px;margin:12px 0;border:1px solid #ccc}.qcu-auto-sheet table{width:100%;border-collapse:collapse}.qcu-auto-sheet th,.qcu-auto-sheet td{border:1px solid #444;padding:12px;text-align:center}.qcu-auto-sheet-head{display:flex;justify-content:space-between;align-items:center}.qcu-auto-qr{min-width:105px;min-height:105px}.qcu-auto-bubble{display:inline-flex;width:25px;height:25px;border:1px solid #333;border-radius:50%;align-items:center;justify-content:center}`;document.head.appendChild(style);
  window.openQcuAuto=openQcuAuto;window.qcuAutoSelect=qcuAutoSelect;window.qcuAutoClear=qcuAutoClear;window.qcuAutoCreateSession=qcuAutoCreateSession;window.qcuAutoPrint=qcuAutoPrint;window.qcuAutoPreviewScan=qcuAutoPreviewScan;window.qcuAutoAnalyzeScan=qcuAutoAnalyzeScan;window.qcuAutoConfirmScans=qcuAutoConfirmScans;
  const originalHome=window.home;
  if(typeof originalHome==='function')window.home=async function(){const r=await originalHome.apply(this,arguments);addHomeCard();return r;};
  document.addEventListener('DOMContentLoaded',addHomeCard);setTimeout(addHomeCard,500);
})();
