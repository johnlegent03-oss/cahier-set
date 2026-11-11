/* QCU mémorisation — module indépendant.
   Ne modifie pas evaluations.js ni le QCU historique.
   QR permanent = Eleves.id ; une attribution distincte est créée par sujet. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const client = () => window.sb || (typeof sb !== "undefined" ? sb : null);
  const levels = ["6e","5e","4e","3e"];
  let questions = [];
  let students = [];
  let subjects = [];
  let session = null;
  let qrPromise = null;
  let camera = null;
  let currentScan = null;

  function addCard() {
    const main = document.querySelector("main#content");
    if (!main || $("qcuMemoHomeCard")) return;
    const section = [...main.querySelectorAll("section")].find(s => /Évaluer/.test(s.innerText || ""));
    const grid = section?.querySelector(".grid");
    if (!grid) return;
    const card = document.createElement("article");
    card.className = "card"; card.id = "qcuMemoHomeCard";
    card.innerHTML = `<span class="tag">Mémorisation active</span>
      <h3>QCU — Banque et sessions</h3>
      <p class="muted">Questions par niveau et chapitre, quatre sujets et suivi individuel.</p>
      <button class="primary" type="button" id="qcuMemoOpen">Ouvrir le module</button>`;
    grid.appendChild(card);
    $("qcuMemoOpen").onclick = open;
  }

  async function open() {
    if (typeof correctionAllowLeave === "function" && !correctionAllowLeave()) return;
    const db = client();
    if (!db) return alert("Connexion Supabase introuvable.");
    const { data: auth } = await db.auth.getUser();
    if (!auth?.user) return alert("Connecte-toi à ton espace professeur.");
    window.qcuMemoUserId = auth.user.id;
    const host = $("content");
    if (!host) return;
    if (typeof saveEvalNav === "function") saveEvalNav({view:"qcuMemo"});
    host.innerHTML = `
      <button type="button" onclick="home()">← Accueil</button>
      <section class="hero" style="margin-top:14px">
        <span class="eyebrow">Mémorisation active</span><h2>QCU — Banque de questions</h2>
        <p>Prépare une banque commune, puis crée une session de quatre sujets de cinq questions.</p>
      </section>
      <section class="card" style="padding:18px;margin-top:14px">
        <h3>1. Banque de questions</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:9px">
          <label>Niveau<select id="qmLevel">${levels.map(x=>`<option>${x}</option>`).join("")}</select></label>
          <label>Chapitre<input id="qmChapter" type="number" min="1" value="1"></label>
        </div>
        <label>Question<textarea id="qmText" rows="2" placeholder="Écris la question"></textarea></label>
        <div class="qmm-options">${["A","B","C","D"].map(x=>`<label>${x}<input id="qmOpt${x}" placeholder="Proposition ${x}"></label>`).join("")}</div>
        <label>Bonne réponse<select id="qmCorrect"><option>A</option><option>B</option><option>C</option><option>D</option></select></label>
        <button class="primary" id="qmAdd">Ajouter la question</button>
        <label style="display:block;margin-top:12px">Importer un fichier CSV (export Excel : colonnes niveau, chapitre, question, A, B, C, D, correcte)
          <input id="qmCsv" type="file" accept=".csv,text/csv">
        </label>
        <p id="qmBankMsg" class="muted" aria-live="polite"></p>
        <div id="qmBankList"></div>
      </section>
      <section class="card" style="padding:18px;margin-top:14px">
        <h3>2. Créer une session</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:9px">
          <label>Classe<input id="qmClass" placeholder="Ex. 5e1"></label>
          <label>Niveau<select id="qmSessionLevel">${levels.map(x=>`<option>${x}</option>`).join("")}</select></label>
          <label>Trimestre<select id="qmTerm"><option>1</option><option>2</option><option>3</option></select></label>
          <label>Titre<input id="qmTitle" value="Mémorisation active"></label>
        </div>
        <p class="muted">Le générateur répartit les questions du chapitre dans quatre sujets de cinq questions. Il faut au moins dix questions actives dans la sélection.</p>
        <button class="primary" id="qmCreate">Charger les questions et préparer les sujets</button>
        <div id="qmSessionMsg" class="muted" aria-live="polite"></div>
        <div id="qmSubjects"></div>
      </section>
      <section class="card" style="padding:18px;margin-top:14px">
        <h3>3. Fiches élèves et correction</h3>
        <div id="qmSheets"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="qmPrint" type="button" disabled>Imprimer les fiches A4</button>
          <button id="qmCameraStart" type="button" disabled>Activer la caméra</button>
          <button id="qmCameraStop" type="button" disabled>Arrêter la caméra</button>
        </div>
        <video id="qmVideo" playsinline muted style="display:none;width:100%;max-width:600px;background:#111;margin-top:10px"></video>
        <button id="qmCapture" type="button" disabled>Lire le QR de la fiche</button>
        <div id="qmReview"></div>
      </section>`;
    $("qmAdd").onclick = addQuestion;
    $("qmCsv").onchange = importCsv;
    $("qmCreate").onclick = prepareSubjects;
    $("qmPrint").onclick = printSheets;
    $("qmCameraStart").onclick = startCamera;
    $("qmCameraStop").onclick = stopCamera;
    $("qmCapture").onclick = captureQr;
    $("qmLevel").onchange = loadBank;
    $("qmChapter").onchange = loadBank;
    await loadBank();
  }

  async function loadBank() {
    const db = client(), level = $("qmLevel")?.value, chapter = Number($("qmChapter")?.value);
    if (!db || !level || !Number.isInteger(chapter)) return;
    $("qmBankMsg").textContent = "Chargement…";
    const {data,error} = await db.from("qcu_questions")
      .select("id,niveau,chapitre,question_text,options,correct_option,active")
      .eq("created_by",window.qcuMemoUserId).eq("niveau",level).eq("chapitre",chapter)
      .eq("active",true).order("created_at");
    if (error) { $("qmBankMsg").textContent = "Erreur : "+error.message; return; }
    questions = data || [];
    $("qmBankMsg").textContent = `${questions.length} question(s) active(s) pour ${level}, chapitre ${chapter}.`;
    $("qmBankList").innerHTML = questions.map((q,i)=>`<details style="padding:8px;border-bottom:1px solid #ddd">
      <summary>${i+1}. ${esc(q.question_text)}</summary>
      <p>${["A","B","C","D"].map(k=>`${k}. ${esc(q.options?.[k]||"")}`).join(" · ")}</p>
      <small>Bonne réponse : ${esc(q.correct_option)}</small>
      <button type="button" data-qdel="${esc(q.id)}">Désactiver</button></details>`).join("");
    $("qmBankList").querySelectorAll("[data-qdel]").forEach(b=>b.onclick=()=>deactivateQuestion(b.dataset.qdel));
  }

  async function addQuestion() {
    const options = Object.fromEntries(["A","B","C","D"].map(k=>[k,$("qmOpt"+k).value.trim()]));
    const text = $("qmText").value.trim(), correct = $("qmCorrect").value;
    if (!text || Object.values(options).some(v=>!v)) return alert("Complète la question et les quatre propositions.");
    const row = {created_by:window.qcuMemoUserId,niveau:$("qmLevel").value,chapitre:Number($("qmChapter").value),
      question_text:text,options,correct_option:correct,active:true};
    const {error} = await client().from("qcu_questions").insert(row);
    if(error) return alert("Ajout impossible : "+error.message);
    $("qmText").value="";["A","B","C","D"].forEach(k=>$("qmOpt"+k).value="");
    await loadBank();
  }
  async function deactivateQuestion(id) {
    if(!confirm("Désactiver cette question ? Les sujets déjà créés conservent leur copie.")) return;
    const {error}=await client().from("qcu_questions").update({active:false}).eq("id",id).eq("created_by",window.qcuMemoUserId);
    if(error) alert(error.message); else loadBank();
  }
  function parseCsvLine(line) {
    const out=[]; let s="", quoted=false;
    for(let i=0;i<line.length;i++){const c=line[i]; if(c==='"'&&line[i+1]==='"'&&quoted){s+='"';i++;}
      else if(c==='"')quoted=!quoted; else if(c===","&&!quoted){out.push(s);s="";} else s+=c;}
    out.push(s); return out.map(x=>x.trim());
  }
  async function importCsv(ev) {
    const file=ev.target.files?.[0]; if(!file)return;
    const lines=(await file.text()).replace(/^\uFEFF/,"").split(/\r?\n/).filter(x=>x.trim());
    if(lines.length<2)return alert("Le CSV ne contient aucune ligne de question.");
    const headers=parseCsvLine(lines.shift()).map(x=>x.toLowerCase());
    const index=(...names)=>headers.findIndex(h=>names.includes(h));
    const cols={level:index("niveau"),chapter:index("chapitre"),question:index("question"),A:index("a"),B:index("b"),C:index("c"),D:index("d"),correct:index("correcte","correct","bonne réponse","bonne reponse")};
    if(Object.values(cols).some(v=>v<0))return alert("Colonnes attendues : niveau, chapitre, question, A, B, C, D, correcte.");
    const rows=[];
    for(const line of lines){const v=parseCsvLine(line),level=v[cols.level],chapter=Number(v[cols.chapter]),q=v[cols.question];
      const options={A:v[cols.A],B:v[cols.B],C:v[cols.C],D:v[cols.D]},correct=v[cols.correct].toUpperCase();
      if(!levels.includes(level)||!Number.isInteger(chapter)||chapter<1||!q||Object.values(options).some(x=>!x)||!["A","B","C","D"].includes(correct))
        return alert("Import annulé : une ligne contient un niveau, chapitre, choix ou corrigé invalide.");
      rows.push({created_by:window.qcuMemoUserId,niveau:level,chapitre:chapter,question_text:q,options,correct_option:correct,active:true});
    }
    const {error}=await client().from("qcu_questions").insert(rows);
    if(error)alert("Import impossible : "+error.message); else {alert(`${rows.length} questions importées.`);await loadBank();}
    ev.target.value="";
  }

  function shuffle(a){const x=a.slice();for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x;}
  async function prepareSubjects() {
    const db=client(), classe=$("qmClass").value.trim(), level=$("qmSessionLevel").value, chapter=Number($("qmChapter").value);
    if(!classe)return alert("Indique la classe.");
    if(level!==$("qmLevel").value)return alert("Le niveau de la banque et celui de la session doivent être identiques.");
    const {data:qs,error:qe}=await db.from("qcu_questions").select("*").eq("created_by",window.qcuMemoUserId)
      .eq("niveau",level).eq("chapitre",chapter).eq("active",true);
    if(qe)return alert(qe.message);
    if((qs||[]).length<10)return alert(`Il faut au moins 10 questions actives. Il y en a ${(qs||[]).length}.`);
    const pool=shuffle(qs);
    subjects=Array.from({length:4},(_,i)=>Array.from({length:5},(_,j)=>pool[(i*5+j)%pool.length]));
    const {data:es,error:ee}=await db.from("Eleves").select("id,nom,prenom,classe").eq("classe",classe).order("nom").order("prenom");
    if(ee)return alert(ee.message); if(!es?.length)return alert("Aucun élève trouvé pour cette classe.");
    students=es;
    $("qmSubjects").innerHTML=subjects.map((arr,i)=>`<article style="border:1px solid #ddd;padding:10px;margin:8px 0"><h4>Sujet ${i+1}</h4><ol>${arr.map(q=>`<li>${esc(q.question_text)}</li>`).join("")}</ol></article>`).join("");
    $("qmSessionMsg").textContent=`${students.length} élèves chargés. Vérifie la composition des quatre sujets avant de créer la session.`;
    const confirmBtn=document.createElement("button");confirmBtn.className="primary";confirmBtn.textContent="Valider les sujets et créer les fiches";confirmBtn.onclick=createSession;
    $("qmSubjects").appendChild(confirmBtn);
  }

  async function createSession() {
    const db=client(), user=window.qcuMemoUserId, level=$("qmSessionLevel").value, classe=$("qmClass").value.trim();
    const {data:s,error:se}=await db.from("qcu_sessions").insert({created_by:user,classe,trimestre:Number($("qmTerm").value),
      titre:$("qmTitle").value.trim()||"Mémorisation active",date_qcu:new Date().toISOString().slice(0,10),statut:"brouillon",
      niveau:level,chapitres:[Number($("qmChapter").value)]}).select().single();
    if(se)return alert("Création de session impossible : "+se.message); session=s;
    const subjectIds=[];
    for(let i=0;i<4;i++){
      const code=String(i+1);
      const {data:sub,error}=await db.from("qcu_sujets").insert({created_by:user,session_id:s.id,code,titre:"Sujet "+code}).select().single();
      if(error)return alert(error.message); subjectIds.push(sub.id);
      const rows=subjects[i].map((q,j)=>({created_by:user,sujet_id:sub.id,question_id:q.id,position:j+1,
        question_text_snapshot:q.question_text,options_snapshot:q.options,correct_option_snapshot:q.correct_option}));
      const {error:qe}=await db.from("qcu_sujet_questions").insert(rows); if(qe)return alert(qe.message);
    }
    const attrs=[];
    for(const student of students)for(let i=0;i<4;i++)attrs.push({created_by:user,session_id:s.id,sujet_id:subjectIds[i],
      eleve_id:student.id,classe,statut:"attribue"});
    const {error:ae}=await db.from("qcu_attributions").insert(attrs);
    if(ae)return alert("Les sujets sont créés mais les attributions ont échoué : "+ae.message);
    $("qmPrint").disabled=false;$("qmCameraStart").disabled=false;
    $("qmSheets").innerHTML=`<p><strong>Session créée :</strong> ${students.length} élèves · 4 sujets chacun · 20 réponses possibles.</p>
      <p>Le QR code imprimé identifie l'élève (identifiant permanent de la table Eleves). Le numéro de sujet est coché sur la fiche à chaque passage.</p>`;
    alert("Session créée. Tu peux imprimer les fiches A4.");
  }

  function ensureQr() {
    if(window.QRCode)return Promise.resolve();
    if(qrPromise)return qrPromise;
    qrPromise=new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
      s.onload=()=>window.QRCode?resolve():reject(Error("Librairie QR indisponible"));s.onerror=()=>reject(Error("Impossible de charger la librairie QR"));document.head.appendChild(s);});
    return qrPromise;
  }
  async function printSheets() {
    if(!session||!students.length)return;
    try{await ensureQr();}catch(e){return alert(e.message);}
    const pages=students.map(st=>`<article class="sheet"><div class="head"><div><h1>Fiche-réponse QCU</h1><p>${esc(session.titre)} · ${esc(st.classe)}</p><p><b>${esc(st.prenom)} ${esc(st.nom)}</b></p></div><div class="qr" data-student="${esc(st.id)}"></div></div>
      <h3>SUJET : entoure un seul numéro</h3><div class="subject">${[1,2,3,4].map(n=>`<span>○ ${n}</span>`).join("")}</div>
      <p>Pour chaque question, noircis une seule bulle. Efface complètement les réponses avant le sujet suivant.</p>
      <table><thead><tr><th>Question</th>${["A","B","C","D"].map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>${[1,2,3,4,5].map(n=>`<tr><th>${n}</th>${[1,2,3,4].map(()=>"<td><i></i></td>").join("")}</tr>`).join("")}</tbody></table>
      <small>Cette fiche est personnelle et réutilisable pour les quatre sujets.</small></article>`).join("");
    const w=window.open("","_blank");if(!w)return alert("Autorise les fenêtres pop-up pour imprimer.");
    w.document.write(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Fiches QCU</title><style>
      @page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font:12pt Arial;color:#111}
      .sheet{width:210mm;height:297mm;padding:18mm;page-break-after:always;break-after:page}
      .sheet:last-child{page-break-after:auto}.head{display:flex;justify-content:space-between;gap:12mm}
      h1{font-size:22pt;margin:0 0 8mm}p{margin:4mm 0}.qr{width:35mm;height:35mm}
      .qr img{width:35mm!important;height:35mm!important}.subject{display:flex;justify-content:space-around;font-size:22pt;margin:12mm 0}
      table{width:100%;border-collapse:collapse;margin:12mm 0}th,td{border:1px solid #222;text-align:center;padding:12mm 4mm}
      td i{display:inline-block;width:10mm;height:10mm;border:1.5px solid #111;border-radius:50%}
      small{font-size:9pt}
    </style><body>${pages}<script>
      window.onload=()=>{document.querySelectorAll('.qr').forEach(el=>new QRCode(el,{text:el.dataset.student,width:140,height:140,correctLevel:QRCode.CorrectLevel.M}));setTimeout(()=>window.print(),700)};
    <\/script><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script></body></html>`);
    w.document.close();
  }

  async function startCamera() {
    try{
      camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
      $("qmVideo").srcObject=camera;$("qmVideo").style.display="block";await $("qmVideo").play();
      $("qmCameraStop").disabled=false;$("qmCapture").disabled=false;$("qmCameraStart").disabled=true;
    }catch(e){alert("Caméra inaccessible : "+e.message);}
  }
  function stopCamera(){if(camera)camera.getTracks().forEach(t=>t.stop());camera=null;if($("qmVideo"))$("qmVideo").srcObject=null;
    if($("qmCameraStop"))$("qmCameraStop").disabled=true;if($("qmCapture"))$("qmCapture").disabled=true;if($("qmCameraStart"))$("qmCameraStart").disabled=!session;}
  async function captureQr() {
    const video=$("qmVideo");if(!video.videoWidth)return;
    try{
      if(!window.jsQR)await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});
      const canvas=document.createElement("canvas");canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(video,0,0);
      const image=ctx.getImageData(0,0,canvas.width,canvas.height),qr=window.jsQR(image.data,image.width,image.height,{inversionAttempts:"attemptBoth"});
      if(!qr?.data)throw Error("QR non détecté. Cadre la fiche entière.");
      const studentId=qr.data.trim();
      if(!students.some(s=>String(s.id)===studentId))throw Error("Ce QR code ne correspond pas à un élève de cette session.");
      currentScan={studentId,answers:{}};
      renderAnswerReview();
    }catch(e){alert(e.message||"Lecture impossible.");}
  }
  async function renderAnswerReview() {
    const st=students.find(s=>String(s.id)===currentScan.studentId);
    $("qmReview").innerHTML=`<h3>Correction de ${esc(st.prenom)} ${esc(st.nom)}</h3>
      <label>Sujet passé<select id="qmAttemptSubject">${[1,2,3,4].map(n=>`<option value="${n}">Sujet ${n}</option>`).join("")}</select></label>
      <p class="muted">Le QR identifie l'élève. Saisis ici les réponses lues sur la fiche : la détection automatique des bulles sera ajoutée dans une étape dédiée.</p>
      ${[1,2,3,4,5].map(n=>`<label>Question ${n}<select data-qm-answer="${n}"><option value="">Sans réponse</option>${["A","B","C","D"].map(v=>`<option>${v}</option>`).join("")}</select></label>`).join("")}
      <button class="primary" id="qmSaveAttempt">Enregistrer cette tentative</button><p id="qmSaveMsg" class="muted"></p>`;
    $("qmSaveAttempt").onclick=saveAttempt;
  }
  async function saveAttempt() {
    const db=client(), user=window.qcuMemoUserId, n=Number($("qmAttemptSubject").value), st=students.find(s=>String(s.id)===currentScan.studentId);
    const subjectId=await db.from("qcu_sujets").select("id").eq("session_id",session.id).eq("code",String(n)).single();
    if(subjectId.error)return $("qmSaveMsg").textContent=subjectId.error.message;
    const attr=await db.from("qcu_attributions").select("id,sujet_id").eq("session_id",session.id).eq("eleve_id",st.id).eq("sujet_id",subjectId.data.id).single();
    if(attr.error)return $("qmSaveMsg").textContent=attr.error.message;
    const qs=await db.from("qcu_sujet_questions").select("id,position,correct_option_snapshot").eq("sujet_id",subjectId.data.id).order("position");
    if(qs.error)return $("qmSaveMsg").textContent=qs.error.message;
    const answers=[...$("qmReview").querySelectorAll("[data-qm-answer]")].map(x=>x.value);
    const rows=qs.data.map((q,i)=>({created_by:user,attribution_id:attr.data.id,sujet_id:subjectId.data.id,sujet_question_id:q.id,
      scan_id:null,selected_options:answers[i]?[answers[i]]:[],statut:!answers[i]?"sans_reponse":answers[i]===q.correct_option_snapshot?"correct":"incorrect",
      is_correct:answers[i]?answers[i]===q.correct_option_snapshot:null,verification_manuelle:true,reviewed_by:user,reviewed_at:new Date().toISOString()}));
    const {error}=await db.from("qcu_reponses").upsert(rows,{onConflict:"attribution_id,sujet_question_id"});
    if(error)return $("qmSaveMsg").textContent="Enregistrement impossible : "+error.message;
    const score=rows.filter(r=>r.is_correct===true).length;
    $("qmSaveMsg").textContent=`Tentative enregistrée : ${score}/5. Les réponses sont enregistrées dans l'attribution de ce sujet, sans photo.`;
    currentScan=null;
  }

  window.openQcuMemo=open;
  window.addEventListener("pagehide",stopCamera);
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",addCard);else addCard();
  setTimeout(addCard,700);
})();