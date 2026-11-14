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
  let savedMemos = [];
  let editingMemoId = null;
  let assigningMemo = null;

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
        <div style="margin-top:10px">
          <strong>Chapitres à inclure</strong>
          <p class="muted" style="margin:4px 0 8px">Tu peux cocher plusieurs chapitres. Les questions de tous les chapitres sélectionnés seront mélangées pour composer les quatre sujets.</p>
          <div id="qmChapterChoices" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:6px"></div>
        </div>
        <p class="muted">Le générateur répartit les questions sélectionnées dans quatre sujets de cinq questions. Il faut au moins dix questions actives au total.</p>
        <button class="primary" id="qmCreate">Charger les questions et préparer les sujets</button>
        <div id="qmSessionMsg" class="muted" aria-live="polite"></div>
        <div id="qmSubjects"></div>
      </section>
      <section class="card" style="padding:18px;margin-top:14px">
        <h3>3. Banque de mémorisations enregistrées</h3>
        <p class="muted">Enregistre les quatre sujets préparés pour les réutiliser, les modifier ou les attribuer à plusieurs classes. Une attribution crée une session indépendante par classe.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input id="qmMemoName" placeholder="Nom de la mémorisation (ex. Mémo 1 – 6e)" style="flex:1;min-width:220px">
          <button class="primary" id="qmMemoSave" type="button" disabled>Enregistrer les sujets préparés</button>
          <button id="qmMemoCancel" type="button" style="display:none">Annuler la modification</button>
        </div>
        <p id="qmMemoMsg" class="muted" aria-live="polite"></p>
        <div id="qmMemoList"></div>
        <div id="qmMemoAssign" style="display:none;margin-top:12px;padding:12px;border:1px solid #bbb;border-radius:10px">
          <h4 id="qmAssignTitle">Attribuer aux classes</h4>
          <p class="muted">Sélectionne une ou plusieurs classes. Chaque classe recevra sa propre session, ses propres fiches et ses propres résultats.</p>
          <div id="qmClassChoices" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:6px"></div>
          <label>Trimestre<select id="qmMemoTerm"><option>1</option><option>2</option><option>3</option></select></label>
          <button class="primary" id="qmMemoAssignGo" type="button">Créer les sessions pour les classes sélectionnées</button>
          <button id="qmMemoAssignCancel" type="button">Fermer</button>
          <p id="qmAssignMsg" class="muted" aria-live="polite"></p>
        </div>
      </section>
      <section class="card" style="padding:18px;margin-top:14px">
        <h3>4. Fiches élèves et correction</h3>
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
    $("qmMemoSave").onclick = saveMemo;
    $("qmMemoCancel").onclick = cancelMemoEdit;
    $("qmMemoAssignCancel").onclick = closeMemoAssign;
    $("qmMemoAssignGo").onclick = assignMemoToClasses;
    $("qmPrint").onclick = printSheets;
    $("qmCameraStart").onclick = startCamera;
    $("qmCameraStop").onclick = stopCamera;
    $("qmCapture").onclick = captureQr;
    $("qmLevel").onchange = loadBank;
    $("qmChapter").onchange = loadBank;
    $("qmSessionLevel").onchange = async () => {
      $("qmLevel").value = $("qmSessionLevel").value;
      await loadBank();
      await loadSessionChapters();
    };
    await loadBank();
    await loadSessionChapters();
    await loadMemos();
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
  function parseCsvLine(line, delimiter) {
    const out=[]; let s="", quoted=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"' && line[i+1]==='"' && quoted){s+='"';i++;}
      else if(c==='"') quoted=!quoted;
      else if(c===delimiter && !quoted){out.push(s);s="";}
      else s+=c;
    }
    out.push(s); return out.map(x=>x.trim());
  }
  async function importCsv(ev) {
    const file=ev.target.files?.[0]; if(!file)return;
    try {
      const raw=(await file.text()).replace(/^\uFEFF/,"");
      const lines=raw.split(/\r?\n/).filter(x=>x.trim());
      if(!lines.length) return alert("Le fichier CSV est vide.");

      // Excel en français exporte généralement avec des points-virgules.
      // On repère la ligne d'en-tête même si Excel a ajouté une première ligne vide.
      let headerLine=-1, delimiter=";";
      for(let i=0;i<Math.min(lines.length,8);i++){
        const sem=parseCsvLine(lines[i],";").map(x=>x.toLowerCase());
        const comma=parseCsvLine(lines[i],",").map(x=>x.toLowerCase());
        const hasHeader=a=>["niveau","chapitre","question","a","b","c","d"].every(k=>a.includes(k));
        if(hasHeader(sem)){headerLine=i;delimiter=";";break;}
        if(hasHeader(comma)){headerLine=i;delimiter=",";break;}
      }
      if(headerLine<0) return alert("En-têtes non reconnus. Attendu : Niveau ; Chapitre ; Question ; A ; B ; C ; D ; Correcte.");
      const headers=parseCsvLine(lines[headerLine],delimiter).map(x=>x.toLowerCase());
      const index=(...names)=>headers.findIndex(h=>names.includes(h));
      const cols={level:index("niveau"),chapter:index("chapitre"),question:index("question"),A:index("a"),B:index("b"),C:index("c"),D:index("d"),correct:index("correcte","correct","bonne réponse","bonne reponse")};
      if(Object.values(cols).some(v=>v<0))return alert("Colonnes attendues : niveau, chapitre, question, A, B, C, D, correcte.");

      const rows=[]; let lastLevel="", lastChapter="";
      for(let lineNo=headerLine+1;lineNo<lines.length;lineNo++){
        const v=parseCsvLine(lines[lineNo],delimiter);
        if(v.every(x=>!x)) continue;
        // Les cellules Niveau et Chapitre peuvent être laissées vides après la première question :
        // on reprend alors les dernières valeurs renseignées (format courant d'Excel).
        if(v[cols.level]) lastLevel=v[cols.level];
        if(v[cols.chapter]) lastChapter=v[cols.chapter];
        const level=lastLevel, chapter=Number(lastChapter), q=v[cols.question];
        const options={A:v[cols.A],B:v[cols.B],C:v[cols.C],D:v[cols.D]};
        const correct=(v[cols.correct]||"").toUpperCase();
        if(!levels.includes(level)||!Number.isInteger(chapter)||chapter<1||!q||
           Object.values(options).some(x=>!x)||!["A","B","C","D"].includes(correct)){
          return alert(`Import annulé : ligne ${lineNo+1} invalide. Vérifie le niveau, le chapitre, la question, les quatre propositions et la bonne réponse.`);
        }
        rows.push({created_by:window.qcuMemoUserId,niveau:level,chapitre:chapter,question_text:q,options,correct_option:correct,active:true});
      }
      if(!rows.length)return alert("Aucune question exploitable trouvée dans le fichier.");
      const {error}=await client().from("qcu_questions").insert(rows);
      if(error)alert("Import impossible : "+error.message);
      else {
        alert(`${rows.length} questions importées avec succès.`);
        if($("qmLevel"))$("qmLevel").value=rows[0].niveau;
        if($("qmChapter"))$("qmChapter").value=String(rows[0].chapitre);
        await loadBank();
      }
    } catch(err) {
      alert("Lecture du CSV impossible : "+(err.message||err));
    } finally {
      ev.target.value="";
    }
  }

  async function loadSessionChapters(selected = []) {
    const host = $("qmChapterChoices");
    if (!host) return;
    const level = $("qmSessionLevel")?.value;
    const {data, error} = await client().from("qcu_questions")
      .select("chapitre").eq("created_by", window.qcuMemoUserId)
      .eq("niveau", level).eq("active", true).order("chapitre");
    if (error) {
      host.innerHTML = `<p class="muted">Impossible de charger les chapitres : ${esc(error.message)}</p>`;
      return;
    }
    const chapters = [...new Set((data || []).map(x => Number(x.chapitre)).filter(Number.isInteger))]
      .sort((a,b) => a-b);
    if (!chapters.length) {
      host.innerHTML = '<p class="muted">Aucun chapitre avec des questions actives pour ce niveau.</p>';
      return;
    }
    const wanted = new Set((selected || []).map(Number));
    host.innerHTML = chapters.map((n,i) => `<label style="display:flex;gap:6px;align-items:center;padding:5px;border:1px solid #ddd;border-radius:7px">
      <input type="checkbox" class="qm-chapter-choice" value="${n}" ${wanted.has(n) ? "checked" : ""}> Chapitre ${n}</label>`).join("");
  }

  function selectedSessionChapters() {
    return [...document.querySelectorAll("#qmChapterChoices .qm-chapter-choice:checked")]
      .map(el => Number(el.value)).filter(Number.isInteger).sort((a,b)=>a-b);
  }

  function shuffle(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function renderPreparedSubjects() {
    const host = $("qmSubjects");
    $("qmMemoSave").disabled = !Array.isArray(subjects) || subjects.length !== 4 || subjects.some(a=>!Array.isArray(a)||a.length!==5);
    host.innerHTML = `
      <p class="muted" style="margin:12px 0">Déplace une question sur une autre pour la réordonner ou l’échanger entre deux sujets. Les quatre sujets conservent chacun cinq questions.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
        ${subjects.map((arr,i)=>`<article data-qm-subject="${i}" style="border:1px solid #bbb;border-radius:10px;padding:10px;margin:0;min-width:0">
          <h4 style="margin:4px 0 10px">Sujet ${i+1}</h4>
          <ol style="padding-left:28px;margin:0">${arr.map((q,j)=>`<li draggable="true" data-qm-subject="${i}" data-qm-question="${j}" style="padding:8px 6px;margin:5px 0;border:1px solid #ddd;border-radius:7px;background:var(--card-bg, #fff);cursor:grab;touch-action:pan-y">
            <span>${esc(q.question_text)}</span>
            <small style="display:block;color:var(--muted,#666);margin-top:4px">Glisser pour déplacer</small>
          </li>`).join("")}</ol>
        </article>`).join("")}
      </div>
      <div style="margin:16px 0 8px;padding:12px;border:2px solid #4386b5;border-radius:10px;background:var(--card-bg,#fff);position:relative;z-index:2">
        <button class="primary" type="button" id="qmValidateSubjects" style="display:block;min-height:44px;width:100%;cursor:pointer">
          Valider les sujets et créer les fiches
        </button>
      </div>`;
    const validate = $("qmValidateSubjects");
    if (validate) validate.addEventListener("click", createSession);

    host.querySelectorAll("li[draggable='true']").forEach(item => {
      item.addEventListener("dragstart", ev => {
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", `${item.dataset.qmSubject}:${item.dataset.qmQuestion}`);
        item.style.opacity = ".45";
      });
      item.addEventListener("dragend", () => { item.style.opacity = "1"; });
      item.addEventListener("dragover", ev => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        item.style.outline = "2px dashed #4386b5";
      });
      item.addEventListener("dragleave", () => { item.style.outline = ""; });
      item.addEventListener("drop", ev => {
        ev.preventDefault();
        item.style.outline = "";
        const raw = ev.dataTransfer.getData("text/plain");
        const [fromSubject, fromQuestion] = raw.split(":").map(Number);
        const toSubject = Number(item.dataset.qmSubject);
        const toQuestion = Number(item.dataset.qmQuestion);
        if (![fromSubject,fromQuestion,toSubject,toQuestion].every(Number.isInteger)) return;
        if (!subjects[fromSubject] || !subjects[toSubject] ||
            !subjects[fromSubject][fromQuestion] || !subjects[toSubject][toQuestion]) return;
        if (fromSubject === toSubject && fromQuestion === toQuestion) return;

        if (fromSubject === toSubject) {
          const [moved] = subjects[fromSubject].splice(fromQuestion,1);
          subjects[toSubject].splice(toQuestion,0,moved);
        } else {
          [subjects[fromSubject][fromQuestion], subjects[toSubject][toQuestion]] =
            [subjects[toSubject][toQuestion], subjects[fromSubject][fromQuestion]];
        }
        renderPreparedSubjects();
      });
    });
  }

  function memoSnapshot() {
    return subjects.map((arr,i)=>arr.map((q,j)=>({
      id:q.id ?? null, question_text:q.question_text, options:q.options,
      correct_option:q.correct_option, position:j+1, subject:i+1
    })));
  }
  function validMemoContent(content) {
    return Array.isArray(content) && content.length===4 && content.every(a=>Array.isArray(a)&&a.length===5&&a.every(q=>q&&typeof q.question_text==="string"&&q.options&&typeof q.correct_option==="string"));
  }
  async function loadMemos() {
    const {data,error}=await client().from("qcu_memos").select("id,nom,niveau,chapitres,contenu,created_at,updated_at").eq("created_by",window.qcuMemoUserId).order("updated_at",{ascending:false});
    if(error){$("qmMemoMsg").textContent="Banque de mémorisations indisponible : "+error.message+". Vérifie que le script SQL a été exécuté.";return;}
    savedMemos=data||[]; renderMemos();
  }
  function renderMemos() {
    const host=$("qmMemoList"); if(!host)return;
    if(!savedMemos.length){host.innerHTML='<p class="muted">Aucune mémorisation enregistrée pour le moment.</p>';return;}
    host.innerHTML=savedMemos.map(m=>`<article style="border:1px solid #ddd;border-radius:9px;padding:10px;margin:8px 0">
      <strong>${esc(m.nom)}</strong> <span class="muted">· ${esc(m.niveau)} · ${esc((m.chapitres||[]).join(", "))} · 4 sujets / 20 questions</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button type="button" data-memo-open="${esc(m.id)}">Ouvrir / modifier</button>
        <button type="button" data-memo-duplicate="${esc(m.id)}">Dupliquer</button>
        <button type="button" data-memo-assign="${esc(m.id)}">Attribuer aux classes</button>
        <button type="button" data-memo-delete="${esc(m.id)}">Supprimer</button>
      </div></article>`).join("");
    host.querySelectorAll("[data-memo-open]").forEach(b=>b.onclick=()=>openMemo(b.dataset.memoOpen));
    host.querySelectorAll("[data-memo-duplicate]").forEach(b=>b.onclick=()=>duplicateMemo(b.dataset.memoDuplicate));
    host.querySelectorAll("[data-memo-assign]").forEach(b=>b.onclick=()=>showMemoAssign(b.dataset.memoAssign));
    host.querySelectorAll("[data-memo-delete]").forEach(b=>b.onclick=()=>deleteMemo(b.dataset.memoDelete));
  }
  async function saveMemo() {
    if(!validMemoContent(subjects))return alert("Prépare d'abord quatre sujets de cinq questions.");
    const nom=$("qmMemoName").value.trim(); if(!nom)return alert("Donne un nom à cette mémorisation.");
    const chapters=selectedSessionChapters();
    if(!chapters.length)return alert("Sélectionne au moins un chapitre pour cette mémorisation.");
    const row={created_by:window.qcuMemoUserId,nom,niveau:$("qmSessionLevel").value,chapitres,contenu:memoSnapshot(),updated_at:new Date().toISOString()};
    let result;
    if(editingMemoId) result=await client().from("qcu_memos").update(row).eq("id",editingMemoId).eq("created_by",window.qcuMemoUserId);
    else result=await client().from("qcu_memos").insert(row);
    if(result.error)return alert("Enregistrement impossible : "+result.error.message);
    $("qmMemoMsg").textContent=editingMemoId?"Modifications enregistrées.":"Mémorisation ajoutée à la banque.";
    editingMemoId=null;$("qmMemoName").value="";$("qmMemoCancel").style.display="none";$("qmMemoSave").textContent="Enregistrer les sujets préparés";
    await loadMemos();
  }
  function cancelMemoEdit(){editingMemoId=null;$("qmMemoName").value="";$("qmMemoCancel").style.display="none";$("qmMemoSave").textContent="Enregistrer les sujets préparés";$("qmMemoMsg").textContent="Modification annulée.";}
  async function openMemo(id) {
    const m=savedMemos.find(x=>x.id===id);if(!m)return;
    if(!validMemoContent(m.contenu))return alert("Le contenu de cette mémorisation est incomplet ou incompatible.");
    subjects=m.contenu.map(a=>a.map(q=>({...q})));
    $("qmSessionLevel").value=m.niveau;$("qmLevel").value=m.niveau;
    if(m.chapitres?.length)$("qmChapter").value=m.chapitres[0];
    await loadSessionChapters(m.chapitres || [Number($("qmChapter").value)]);
    $("qmMemoName").value=m.nom;editingMemoId=m.id;
    $("qmMemoCancel").style.display="inline-block";$("qmMemoSave").textContent="Enregistrer les modifications";
    students=[];renderPreparedSubjects();
    $("qmSessionMsg").textContent="Mémorisation chargée. Tu peux déplacer les questions puis enregistrer les modifications ou l'attribuer aux classes.";
    $("qmMemoMsg").textContent="Tu modifies une copie de travail : l'original ne change qu'après avoir cliqué sur Enregistrer les modifications.";
  }
  async function duplicateMemo(id) {
    const m=savedMemos.find(x=>x.id===id);if(!m)return;
    const name=prompt("Nom de la copie :",m.nom+" (copie)");if(!name?.trim())return;
    const {error}=await client().from("qcu_memos").insert({created_by:window.qcuMemoUserId,nom:name.trim(),niveau:m.niveau,chapitres:m.chapitres||[],contenu:m.contenu});
    if(error)return alert("Duplication impossible : "+error.message);
    await loadMemos();
  }
  async function deleteMemo(id) {
    const m=savedMemos.find(x=>x.id===id);if(!m||!confirm(`Supprimer définitivement « ${m.nom} » ? Les sessions déjà créées ne seront pas supprimées.`))return;
    const {error}=await client().from("qcu_memos").delete().eq("id",id).eq("created_by",window.qcuMemoUserId);
    if(error)return alert("Suppression impossible : "+error.message);
    await loadMemos();
  }
  async function showMemoAssign(id) {
    const m=savedMemos.find(x=>x.id===id);if(!m)return;
    if(!validMemoContent(m.contenu))return alert("Contenu de mémorisation invalide.");
    assigningMemo=m;$("qmAssignTitle").textContent="Attribuer « "+m.nom+" » aux classes";$("qmAssignMsg").textContent="Chargement des classes…";$("qmMemoAssign").style.display="block";
    const {data,error}=await client().from("Eleves").select("classe").order("classe");
    if(error){$("qmAssignMsg").textContent="Impossible de charger les classes : "+error.message;return;}
    const classes=[...new Set((data||[]).map(x=>(x.classe||"").trim()).filter(c=>c && c.toLowerCase().startsWith(m.niveau.toLowerCase())))].sort((a,b)=>a.localeCompare(b,"fr",{numeric:true}));
    if(!classes.length){$("qmClassChoices").innerHTML="";$("qmAssignMsg").textContent="Aucune classe trouvée dans la table Eleves.";return;}
    $("qmClassChoices").innerHTML=classes.map((c,i)=>`<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" value="${esc(c)}" id="qmClassPick${i}"> ${esc(c)}</label>`).join("");
    $("qmAssignMsg").textContent=`${classes.length} classe(s) disponibles.`;
  }
  function closeMemoAssign(){assigningMemo=null;$("qmMemoAssign").style.display="none";}
  async function assignMemoToClasses() {
    const m=assigningMemo;if(!m)return;
    const chosen=[...$("qmClassChoices").querySelectorAll("input:checked")].map(x=>x.value);
    if(!chosen.length)return alert("Sélectionne au moins une classe.");
    const btn=$("qmMemoAssignGo");btn.disabled=true;$("qmAssignMsg").textContent="Préparation des sessions…";
    const rosters=[];
    for(const classe of chosen){const {data,error}=await client().from("Eleves").select("id,nom,prenom,classe").eq("classe",classe).order("nom").order("prenom");if(error){$("qmAssignMsg").textContent=`Erreur pour ${classe} : ${error.message}`;btn.disabled=false;return;}if(!data?.length){$("qmAssignMsg").textContent=`Aucun élève trouvé pour ${classe}. Aucune session créée.`;btn.disabled=false;return;}rosters.push({classe,students:data});}
    const done=[],failed=[];
    for(const r of rosters){const res=await createSessionForClass(r.classe,r.students,m.contenu,m.niveau,m.chapitres,Number($("qmMemoTerm").value),m.nom);if(res.error)failed.push(`${r.classe} : ${res.error}`);else done.push(r.classe);}
    $("qmAssignMsg").textContent=`Sessions créées : ${done.join(", ")||"aucune"}. ${failed.length?"Échecs : "+failed.join(" ; "):"Toutes les classes ont été traitées."}`;
    btn.disabled=false;
    if(done.length)alert(`Sessions créées pour : ${done.join(", ")}. Chaque classe possède une session indépendante.`);
  }

  async function prepareSubjects() {
    const db=client(), classe=$("qmClass").value.trim(), level=$("qmSessionLevel").value, chapters=selectedSessionChapters();
    if(!classe)return alert("Indique la classe.");
    if(!chapters.length)return alert("Sélectionne au moins un chapitre.");
    if(level!==$("qmLevel").value)return alert("Le niveau de la banque et celui de la session doivent être identiques.");
    const {data:qs,error:qe}=await db.from("qcu_questions").select("*").eq("created_by",window.qcuMemoUserId)
      .eq("niveau",level).in("chapitre",chapters).eq("active",true);
    if(qe)return alert(qe.message);
    if((qs||[]).length<10)return alert(`Il faut au moins 10 questions actives au total dans les chapitres sélectionnés. Il y en a ${(qs||[]).length}.`);
    const pool=shuffle(qs);
    subjects=Array.from({length:4},(_,i)=>Array.from({length:5},(_,j)=>pool[(i*5+j)%pool.length]));
    const {data:es,error:ee}=await db.from("Eleves").select("id,nom,prenom,classe").eq("classe",classe).order("nom").order("prenom");
    if(ee)return alert(ee.message); if(!es?.length)return alert("Aucun élève trouvé pour cette classe.");
    students=es;
    renderPreparedSubjects();
    $("qmSessionMsg").textContent=`${students.length} élèves chargés · chapitres ${chapters.join(", ")} · ${(qs||[]).length} questions disponibles. Réorganise les questions si nécessaire, puis valide les sujets.`;
  }

  async function createSession() {
    const classe=$("qmClass").value.trim(), level=$("qmSessionLevel").value;
    if(!classe)return alert("Indique la classe.");
    if(!students.length)return alert("Charge d'abord les élèves de la classe.");
    const chapters=selectedSessionChapters();
    if(!chapters.length)return alert("Sélectionne au moins un chapitre.");
    const res=await createSessionForClass(classe,students,subjects,level,chapters,Number($("qmTerm").value),$("qmTitle").value.trim()||"Mémorisation active");
    if(res.error)return alert("Création de session impossible : "+res.error);
    session=res.session;
    $("qmPrint").disabled=false;$("qmCameraStart").disabled=false;
    $("qmSheets").innerHTML=`<p><strong>Session créée :</strong> ${students.length} élèves · 4 sujets chacun · 20 réponses possibles.</p>
      <p>Le QR code imprimé identifie l'élève (identifiant permanent de la table Eleves). Le numéro de sujet est coché sur la fiche à chaque passage.</p>`;
    alert("Session créée. Tu peux imprimer les fiches A4.");
  }
  async function createSessionForClass(classe, roster, memoSubjects, level, chapters, term, title) {
    const db=client(),user=window.qcuMemoUserId;
    const {data:s,error:se}=await db.from("qcu_sessions").insert({created_by:user,classe,trimestre:term,titre:title,date_qcu:new Date().toISOString().slice(0,10),statut:"brouillon",niveau:level,chapitres:chapters||[]}).select().single();
    if(se)return {error:se.message};
    const subjectIds=[];
    for(let i=0;i<4;i++){
      const code=String(i+1);
      const {data:sub,error}=await db.from("qcu_sujets").insert({created_by:user,session_id:s.id,code,titre:"Sujet "+code}).select().single();
      if(error)return {error:`${error.message} (session ${classe} déjà créée)`};
      subjectIds.push(sub.id);
      const rows=memoSubjects[i].map((q,j)=>({created_by:user,sujet_id:sub.id,question_id:q.id||null,position:j+1,question_text_snapshot:q.question_text,options_snapshot:q.options,correct_option_snapshot:q.correct_option}));
      const {error:qe}=await db.from("qcu_sujet_questions").insert(rows);
      if(qe)return {error:`${qe.message} (session ${classe} partiellement créée)`};
    }
    const attrs=[];
    for(const student of roster)for(let i=0;i<4;i++)attrs.push({created_by:user,session_id:s.id,sujet_id:subjectIds[i],eleve_id:student.id,classe,statut:"attribue"});
    const {error:ae}=await db.from("qcu_attributions").insert(attrs);
    if(ae)return {error:`${ae.message} (sujets créés mais attributions non terminées pour ${classe})`};
    return {session:s};
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