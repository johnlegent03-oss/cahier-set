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
  let sessionQuestionPool = [];
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
      <style>
        #content .qmm-module label{display:block;min-width:0;margin:0}
        #content .qmm-module input:not([type=checkbox]):not([type=radio]),#content .qmm-module select,#content .qmm-module textarea{display:block;width:100%;max-width:100%;min-width:0;box-sizing:border-box;margin-top:5px}
        #content .qmm-module .qmm-fields{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;align-items:end}
        #content .qmm-module .qmm-upload{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;margin-top:12px}
        #content .qmm-module .qmm-options{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
        #content .qmm-module .qmm-options label{display:flex;align-items:center;gap:6px}
        #content .qmm-module .qmm-options input{flex:1;min-width:0}
        #content .qmm-module .qmm-radio{display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;align-items:start;margin-top:8px}
        #content .qmm-module .qmm-chapter-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
        #content .qmm-module .qmm-chapter-option{display:grid!important;grid-template-columns:22px minmax(0,1fr);align-items:center;justify-items:start;gap:8px;padding:9px 12px;border:1px solid #d8ddcf;border-radius:8px;min-width:0}
        #content .qmm-module .qmm-chapter-option input[type=checkbox]{width:16px!important;height:16px!important;margin:0!important;justify-self:center}
        #content .qmm-module .qmm-chapter-option span{display:block;white-space:nowrap}
        #content .qmm-module .qmm-radio input{margin:4px 0 0}
        #content .qmm-module .qmm-radio label{line-height:1.45}
        @media(max-width:760px){#content .qmm-module .qmm-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:480px){#content .qmm-module .qmm-fields,#content .qmm-module .qmm-options{grid-template-columns:1fr}}
      </style>
      <div class="qmm-module">
      <section class="card" style="padding:18px;margin-top:14px">
        <h3>1. Importer la banque de questions</h3>
        <p class="muted">Prépare tes questions dans Excel, puis importe le fichier CSV. La saisie manuelle des questions n'est pas nécessaire.</p>
        <div class="qmm-fields" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <label>Niveau<select id="qmLevel">${levels.map(x=>`<option>${x}</option>`).join("")}</select></label>
          <label>Chapitre<input id="qmChapter" type="number" min="1" value="1"></label>
        </div>
        <label class="qmm-upload">Importer un fichier CSV (colonnes : niveau, chapitre, question, A, B, C, D, correcte)
          <input id="qmCsv" type="file" accept=".csv,text/csv">
        </label>
        <p id="qmBankMsg" class="muted" aria-live="polite"></p>
        <div id="qmBankList"></div>
      </section>
      <section class="card" style="padding:18px;margin-top:14px">
        <h3>2. Créer une session</h3>
        <div class="qmm-fields">
          <label>Niveau<select id="qmSessionLevel">${levels.map(x=>`<option>${x}</option>`).join("")}</select></label>
          <label>Titre<input id="qmTitle" value="Mémorisation active"></label>
        </div>
        <p class="muted" style="margin:8px 0 0">Aucune classe n'est nécessaire à cette étape : tu attribueras les sujets aux classes après leur enregistrement dans la banque.</p>
        <div style="margin-top:10px">
          <strong>Chapitres à inclure</strong>
          <p class="muted" style="margin:4px 0 8px">Tu peux cocher plusieurs chapitres. Les questions de tous les chapitres sélectionnés seront mélangées pour composer les quatre sujets.</p>
          <div id="qmChapterChoices" class="qmm-chapter-grid"></div>
        </div>
        <div style="margin-top:12px;padding:12px;border:1px solid #ddd;border-radius:9px">
          <strong>Mode de génération</strong>
          <div class="qmm-radio"><input type="radio" name="qmGenerationMode" value="auto" checked><label>Génération automatique : les quatre sujets sont composés aléatoirement.</label></div>
          <div class="qmm-radio"><input type="radio" name="qmGenerationMode" value="custom"><label>Génération personnalisée : je choisis les questions communes et celles propres à chaque sujet.</label></div>
        </div>
        <p class="muted">Chaque sujet comporte cinq questions. Une question commune apparaît sur les quatre sujets ; une question spécifique apparaît uniquement sur le ou les sujets cochés.</p>
        <button class="primary" id="qmCreate">Charger les questions et préparer les sujets</button>
        <div id="qmSessionMsg" class="muted" aria-live="polite"></div>
        <div id="qmCustomPicker"></div>
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
        <h3>4. Fiches élèves permanentes</h3>
        <p class="muted">Génère une seule fois les fiches de tous les élèves d'une classe. Le QR code identifie définitivement l'élève et ne dépend d'aucune mémorisation : conserve et plastifie sa fiche pour toute l'année.</p>
        <div class="qmm-fields" style="grid-template-columns:minmax(180px,1fr) auto;align-items:end">
          <label>Classe<select id="qmPermanentClass"><option value="">Chargement des classes…</option></select></label>
          <button class="primary" id="qmPrint" type="button" disabled>Générer les QR codes et grilles de la classe</button>
        </div>
        <p id="qmPermanentMsg" class="muted" aria-live="polite"></p>
        <div id="qmSheets"></div>
        <div style="border-top:1px solid #ddd;margin-top:16px;padding-top:12px">
          <h4>Correction des mémorisations</h4>
          <p class="muted">Sélectionne la classe, la mémorisation et le sujet avant de scanner les fiches permanentes.</p>
          <div class="qmm-fields" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px">
            <label>Classe<select id="qmCorrectionClass"><option value="">Choisir une classe</option></select></label>
            <label>Mémorisation<select id="qmCorrectionMemo" disabled><option value="">Choisir une mémorisation</option></select></label>
            <label>Sujet<select id="qmCorrectionSubject" disabled><option value="">Choisir un sujet</option></select></label>
          </div>
          <p id="qmCorrectionMsg" class="muted" aria-live="polite"></p>
          <div id="qmSubjectRoster" style="margin:10px 0"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button id="qmCameraStart" type="button" disabled>Activer la caméra</button>
            <button id="qmCameraStop" type="button" disabled>Arrêter la caméra</button>
          </div>
          <video id="qmVideo" playsinline muted style="display:none;width:100%;max-width:600px;background:#111;margin-top:10px"></video>
          <button id="qmCapture" type="button" disabled>Lire le QR de la fiche</button>
          <div id="qmReview"></div>
        </div>
      </section>
      <section class="card" style="padding:18px;margin-top:14px">
        <h3>5. Résultats et bilans</h3>
        <p class="muted">Consulte les résultats des quatre sujets pour chaque mémorisation, puis le bilan cumulatif des connaissances par chapitre sur l'année.</p>
        <div class="qmm-fields" style="grid-template-columns:minmax(180px,1fr) auto;align-items:end">
          <label>Classe<select id="qmResultsClass"><option value="">Choisir une classe</option></select></label>
          <button class="primary" id="qmResultsLoad" type="button">Afficher les résultats</button>
        </div>
        <p id="qmResultsMsg" class="muted" aria-live="polite"></p>
        <div id="qmResultsHost"></div>
      </section>
      </div>`;
    $("qmCsv").onchange = importCsv;
    $("qmCreate").onclick = prepareSubjects;
    $("qmMemoSave").onclick = saveMemo;
    $("qmMemoCancel").onclick = cancelMemoEdit;
    $("qmMemoAssignCancel").onclick = closeMemoAssign;
    $("qmMemoAssignGo").onclick = assignMemoToClasses;
    $("qmPrint").onclick = printSheets;
    $("qmPermanentClass").onchange = loadPermanentRoster;
    $("qmCorrectionClass").onchange = loadCorrectionSessions;
    $("qmCorrectionMemo").onchange = loadCorrectionSubjects;
    $("qmCorrectionSubject").onchange = activateCorrectionScanner;
    $("qmCameraStart").onclick = startCamera;
    $("qmCameraStop").onclick = stopCamera;
    $("qmCapture").onclick = captureQr;
    $("qmResultsLoad").onclick = loadResults;
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
    await loadPermanentClasses();
    await loadCorrectionClasses();
    await loadResultsClasses();
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
    host.innerHTML = chapters.map(n => `<label class="qmm-chapter-option">
      <input type="checkbox" class="qm-chapter-choice" value="${n}" ${wanted.has(n) ? "checked" : ""}> <span>Chapitre ${n}</span></label>`).join("");
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
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 8px">
        <button type="button" id="qmExportSubjects">Exporter les 4 sujets en PDF</button>
      </div>
      <p class="muted">Les sujets sont prêts. Enregistre-les dans la banque, puis utilise « Attribuer aux classes » pour créer les sessions et les fiches élèves.</p>`;
    const exportButton = $("qmExportSubjects");
    if (exportButton) exportButton.addEventListener("click", exportSubjectsPdf);

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

  function exportSubjectsPdf() {
    if (!Array.isArray(subjects) || subjects.length !== 4 || subjects.some(a => !Array.isArray(a) || a.length !== 5)) {
      return alert("Prépare d'abord les quatre sujets.");
    }
    const title = $("qmTitle")?.value.trim() || "Mémorisation active";
    const level = $("qmSessionLevel")?.value || "";
    const chapters = selectedSessionChapters();
    const pages = subjects.map((arr, i) => `<article class="subject-page">
      <header><div><h1>${esc(title)}</h1><p>${esc(level)} · ${chapters.length ? `Chapitres ${chapters.join(", ")}` : ""}</p></div><strong>SUJET ${i+1}</strong></header>
      <ol>${arr.map(q => `<li><p>${esc(q.question_text)}</p><ul>${["A","B","C","D"].map(k => `<li><b>${k}.</b> ${esc(q.options?.[k] ?? "")}</li>`).join("")}</ul></li>`).join("")}</ol>
    </article>`).join("");
    const w = window.open("", "_blank");
    if (!w) return alert("Autorise les fenêtres pop-up pour exporter les sujets.");
    w.document.open();
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)} — Sujets</title><style>
      @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:11pt Arial,sans-serif;color:#111;margin:0}
      .subject-page{page-break-after:always;break-after:page;min-height:260mm}.subject-page:last-child{page-break-after:auto;break-after:auto}
      header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #333;padding-bottom:8mm;margin-bottom:8mm;gap:10mm}
      h1{font-size:19pt;margin:0 0 4mm}header p{margin:0;color:#555}header strong{font-size:17pt;white-space:nowrap}
      ol{padding-left:8mm;margin:0}ol>li{padding-left:2mm;margin:0 0 8mm;break-inside:avoid}
      ol>li>p{font-weight:600;margin:0 0 3mm;line-height:1.4}ul{list-style:none;padding:0;margin:0 0 0 3mm}
      ul li{margin:2mm 0;line-height:1.35} @media screen{body{background:#eee}.subject-page{background:white;width:210mm;min-height:297mm;margin:12px auto;padding:16mm;box-shadow:0 1px 8px #bbb}}
    </style></head><body>${pages}<script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),350)});<\/script></body></html>`);
    w.document.close();
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
    const row={created_by:window.qcuMemoUserId,nom,niveau:$("qmSessionLevel").value,chapitres:chapters,contenu:memoSnapshot(),updated_at:new Date().toISOString()};
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
    students=[];$("qmCustomPicker").innerHTML="";renderPreparedSubjects();
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
    if(done.length){
      await loadAssignedSessions();
      alert(`Sessions créées pour : ${done.join(", ")}. Chaque classe possède une session indépendante. Tu peux imprimer les fiches de chaque classe depuis « Fiches élèves et correction ».`);
    }
  }

  function renderCustomQuestionPicker() {
    const host = $("qmCustomPicker");
    if (!host) return;
    host.innerHTML = `
      <div style="margin-top:12px;padding:12px;border:1px solid #4386b5;border-radius:10px">
        <h4 style="margin:0 0 6px">Composer les quatre sujets</h4>
        <p class="muted">Pour chaque question, coche « Commune » pour l'imposer aux quatre sujets, ou coche un ou plusieurs sujets pour l'y imposer. Laisse les autres cases vides pour que le logiciel tire les questions au sort.</p>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;min-width:620px">
            <thead><tr><th style="text-align:left;padding:6px">Question</th><th>Commune</th><th>Sujet 1</th><th>Sujet 2</th><th>Sujet 3</th><th>Sujet 4</th></tr></thead>
            <tbody>${sessionQuestionPool.map((q,i)=>`<tr style="border-top:1px solid #ddd">
              <td style="padding:7px;max-width:360px">${esc(q.question_text)}</td>
              <td style="text-align:center"><input type="checkbox" class="qm-force-common" data-q-index="${i}" aria-label="Question commune"></td>
              ${[1,2,3,4].map(n=>`<td style="text-align:center"><input type="checkbox" class="qm-force-subject" data-q-index="${i}" data-subject="${n-1}" aria-label="Imposer au sujet ${n}"></td>`).join("")}
            </tr>`).join("")}</tbody>
          </table>
        </div>
        <p id="qmCustomStatus" class="muted" aria-live="polite"></p>
        <button type="button" class="primary" id="qmComposeCustom">Générer les quatre sujets avec ma sélection</button>
      </div>`;
    host.querySelectorAll('.qm-force-common').forEach(el=>el.addEventListener('change',()=>{
      if(el.checked) host.querySelectorAll(`.qm-force-subject[data-q-index="${el.dataset.qIndex}"]`).forEach(x=>x.checked=false);
    }));
    host.querySelectorAll('.qm-force-subject').forEach(el=>el.addEventListener('change',()=>{
      if(el.checked){const common=host.querySelector(`.qm-force-common[data-q-index="${el.dataset.qIndex}"]`);if(common)common.checked=false;}
    }));
    $("qmComposeCustom").onclick = composeCustomSubjects;
  }

  function composeCustomSubjects() {
    const host=$("qmCustomPicker");
    const commonIndexes=[...host.querySelectorAll('.qm-force-common:checked')].map(x=>Number(x.dataset.qIndex));
    const specific=[0,1,2,3].map(subjectIndex=>[...host.querySelectorAll(`.qm-force-subject[data-subject="${subjectIndex}"]:checked`)].map(x=>Number(x.dataset.qIndex)));
    const fixed=[0,1,2,3].map(i=>[...new Set([...commonIndexes,...specific[i]])]);
    const tooMany=fixed.findIndex(a=>a.length>5);
    if(tooMany>=0){$("qmCustomStatus").textContent=`Le sujet ${tooMany+1} comporte déjà ${fixed[tooMany].length} questions imposées. Cinq au maximum sont possibles.`;return;}
    const result=[];
    for(let i=0;i<4;i++){
      const chosen=fixed[i].map(index=>sessionQuestionPool[index]).filter(Boolean);
      const chosenIds=new Set(chosen.map(q=>String(q.id)));
      const remaining=shuffle(sessionQuestionPool.filter(q=>!chosenIds.has(String(q.id))));
      const needed=5-chosen.length;
      if(remaining.length<needed){$("qmCustomStatus").textContent=`Pas assez de questions différentes pour compléter le sujet ${i+1}. Ajoute des questions à la banque ou retire certaines questions imposées.`;return;}
      result.push([...chosen,...remaining.slice(0,needed)]);
    }
    subjects=result;
    $("qmCustomPicker").innerHTML='<p class="muted">Composition personnalisée générée. Tu peux encore déplacer ou échanger les questions dans les sujets ci-dessous.</p>';
    renderPreparedSubjects();
    $("qmSessionMsg").textContent=`Sujets personnalisés générés : ${commonIndexes.length} question(s) commune(s), avec les questions spécifiques choisies et un complément aléatoire.`;
  }

  async function prepareSubjects() {
    const db=client(), level=$("qmSessionLevel").value, chapters=selectedSessionChapters();
    if(!chapters.length)return alert("Sélectionne au moins un chapitre.");
    if(level!==$("qmLevel").value)return alert("Le niveau de la banque et celui de la session doivent être identiques.");
    const {data:qs,error:qe}=await db.from("qcu_questions").select("*").eq("created_by",window.qcuMemoUserId)
      .eq("niveau",level).in("chapitre",chapters).eq("active",true);
    if(qe)return alert(qe.message);
    if((qs||[]).length<5)return alert(`Il faut au moins 5 questions actives différentes au total dans les chapitres sélectionnés pour composer un sujet de cinq questions. Il y en a ${(qs||[]).length}.`);
    sessionQuestionPool=qs||[];
    students=[];
    session=null;
    $("qmPrint").disabled=true;$("qmCameraStart").disabled=true;
    const mode=document.querySelector('input[name="qmGenerationMode"]:checked')?.value||"auto";
    $("qmSubjects").innerHTML="";
    if(mode==="custom"){
      renderCustomQuestionPicker();
      $("qmSessionMsg").textContent=`Chapitres ${chapters.join(", ")} · ${sessionQuestionPool.length} questions disponibles. Sélectionne les questions à imposer, puis génère les sujets.`;
      return;
    }
    $("qmCustomPicker").innerHTML="";
    const pool=shuffle(sessionQuestionPool);
    subjects=Array.from({length:4},(_,i)=>Array.from({length:5},(_,j)=>pool[(i*5+j)%pool.length]));
    renderPreparedSubjects();
    $("qmSessionMsg").textContent=`Chapitres ${chapters.join(", ")} · ${sessionQuestionPool.length} questions disponibles. Réorganise les questions si nécessaire, puis enregistre les sujets dans la banque.`;
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
      const rows=memoSubjects[i].map((q,j)=>({created_by:user,sujet_id:sub.id,question_id:q.id||null,chapitre_snapshot:Number(q.chapitre)||null,position:j+1,question_text_snapshot:q.question_text,options_snapshot:q.options,correct_option_snapshot:q.correct_option}));
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
  async function loadPermanentClasses() {
    const select=$("qmPermanentClass");
    if(!select)return;
    const {data,error}=await client().from("Eleves").select("classe").order("classe");
    if(error){select.innerHTML='<option value="">Erreur de chargement</option>';$("qmPermanentMsg").textContent="Impossible de charger les classes : "+error.message;return;}
    const classes=[...new Set((data||[]).map(x=>(x.classe||"").trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,"fr",{numeric:true}));
    select.innerHTML='<option value="">Choisir une classe</option>'+classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
    $("qmPrint").disabled=true;
    $("qmPermanentMsg").textContent=classes.length?`${classes.length} classe(s) disponible(s). Sélectionne une classe pour générer les fiches permanentes.`:"Aucune classe trouvée dans la table Eleves.";
  }

  async function loadPermanentRoster() {
    const classe=$("qmPermanentClass").value;
    $("qmSheets").innerHTML="";
    $("qmPrint").disabled=!classe;
    $("qmCameraStart").disabled=!classe;
    if(!classe){students=[];$("qmPermanentMsg").textContent="";return;}
    $("qmPermanentMsg").textContent=`Chargement des élèves de ${classe}…`;
    const {data,error}=await client().from("Eleves").select("id,nom,prenom,classe")
      .eq("classe",classe).order("nom").order("prenom");
    if(error){students=[];$("qmPrint").disabled=true;$("qmPermanentMsg").textContent="Erreur : "+error.message;return;}
    students=data||[];
    $("qmPermanentMsg").textContent=students.length
      ? `${students.length} élève(s) trouvé(s) pour ${classe}. Les QR codes sont permanents : tu peux réimprimer les fiches en cas de perte.`
      : `Aucun élève trouvé pour ${classe}.`;
    $("qmPrint").disabled=!students.length;
  }

  async function printSheets() {
    if(!students.length)return alert("Sélectionne d'abord une classe.");
    try{await ensureQr();}catch(e){return alert(e.message);}
    const chunks=[];
    for(let i=0;i<students.length;i+=4)chunks.push(students.slice(i,i+4));
    const pages=chunks.map(group=>`<section class="print-page">${group.map(st=>`<article class="sheet">
      <div class="head">
        <div><h2>Fiche-réponse personnelle</h2><p><b>${esc(st.prenom)} ${esc(st.nom)}</b></p><p>${esc(st.classe)}</p></div>
        <div class="qr" data-student="${esc(st.id)}"></div>
      </div>
      <div class="subject-line"><b>Sujet :</b>${[1,2,3,4].map(n=>`<span>○ ${n}</span>`).join("")}</div>
      <p class="instruction">Pour chaque question, noircis une seule bulle. Efface tes réponses après la correction.</p>
      <table><thead><tr><th>Question</th>${["A","B","C","D"].map(x=>`<th>${x}</th>`).join("")}</tr></thead>
      <tbody>${[1,2,3,4,5].map(n=>`<tr><th>${n}</th>${[1,2,3,4].map(()=>"<td><i></i></td>").join("")}</tr>`).join("")}</tbody></table>
      <p class="foot">Fiche personnelle à conserver toute l'année</p>
    </article>`).join("")}</section>`).join("");
    const classe=$("qmPermanentClass").value;
    const w=window.open("","_blank");if(!w)return alert("Autorise les fenêtres pop-up pour imprimer.");
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fiches permanentes — ${esc(classe)}</title><style>
      @page{size:A4 portrait;margin:7mm}*{box-sizing:border-box}
      html,body{margin:0;padding:0;font:9pt Arial,sans-serif;color:#111}
      .print-page{width:196mm;height:283mm;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:5mm;page-break-after:always;break-after:page;overflow:hidden}
      .print-page:last-child{page-break-after:auto;break-after:auto}
      .sheet{min-width:0;min-height:0;border:1px dashed #999;border-radius:2mm;padding:5mm;overflow:hidden;display:flex;flex-direction:column}
      .head{display:flex;justify-content:space-between;align-items:flex-start;gap:3mm;min-height:23mm}
      h2{font-size:12pt;margin:0 0 2mm}p{margin:1.5mm 0}.head p{font-size:9pt}
      .qr{width:25mm;height:25mm;flex:0 0 25mm}.qr img,.qr canvas{width:25mm!important;height:25mm!important}
      .subject-line{display:flex;align-items:center;justify-content:space-between;gap:2mm;margin:4mm 0;font-size:10pt}
      .subject-line span{white-space:nowrap}.instruction{font-size:8pt;margin:1mm 0 3mm}
      table{width:100%;border-collapse:collapse;table-layout:fixed;margin:1mm 0}
      th,td{border:1px solid #222;text-align:center;padding:3mm 1mm}th{font-size:9pt}
      td i{display:inline-block;width:5mm;height:5mm;border:1px solid #111;border-radius:50%}
      .foot{margin-top:auto;text-align:center;font-size:7pt;color:#555}
    </style></head><body>${pages}<script>
      window.onload=()=>{document.querySelectorAll('.qr').forEach(el=>new QRCode(el,{text:el.dataset.student,width:160,height:160,correctLevel:QRCode.CorrectLevel.M}));setTimeout(()=>window.print(),1000)};
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
    if($("qmCameraStop"))$("qmCameraStop").disabled=true;if($("qmCapture"))$("qmCapture").disabled=true;if($("qmCameraStart"))$("qmCameraStart").disabled=!students.length;}
  async function captureQr() {
    const video=$("qmVideo");if(!video.videoWidth)return;
    try{
      if(!window.jsQR)await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});
      const canvas=document.createElement("canvas");canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(video,0,0);
      const image=ctx.getImageData(0,0,canvas.width,canvas.height),qr=window.jsQR(image.data,image.width,image.height,{inversionAttempts:"attemptBoth"});
      if(!qr?.data)throw Error("QR non détecté. Cadre toute la fiche, pas uniquement le QR code.");
      const studentId=qr.data.trim();
      if(!session || !$("qmCorrectionSubject").value)throw Error("Sélectionne d'abord la classe, la mémorisation et le sujet à corriger.");
      const st=students.find(s=>String(s.id)===studentId);
      if(!st)throw Error("Ce QR code ne correspond pas à un élève de la classe sélectionnée.");
      const subject=subjects.find(x=>String(x.code)===String(session.selectedSubjectCode));
      const {data:attendance,error:attendanceError}=await client().from("qcu_attributions").select("statut")
        .eq("session_id",session.id).eq("sujet_id",subject.id).eq("eleve_id",studentId).single();
      if(attendanceError)throw Error("Attribution introuvable pour cet élève et ce sujet : "+attendanceError.message);
      if(attendance?.statut==="absent")throw Error("Cet élève est indiqué absent pour ce sujet. Modifie son statut avant de scanner ses réponses.");
      const detected=detectBubbleAnswers(image,qr);
      currentScan={studentId,answers:detected.answers,confidence:detected.confidence,ambiguous:detected.ambiguous};
      renderAnswerReview();
    }catch(e){alert(e.message||"Lecture impossible.");}
  }

  // Transforme les coordonnées normalisées du QR vers l'image grâce à ses quatre coins.
  // Les positions sont calibrées sur la fiche permanente actuelle (QR en haut à droite,
  // grille de 5 lignes et 4 colonnes en dessous/à gauche).
  function solveLinearSystem(A,b){
    const n=b.length, M=A.map((r,i)=>r.concat([b[i]]));
    for(let c=0;c<n;c++){
      let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[pivot][c]))pivot=r;
      if(Math.abs(M[pivot][c])<1e-10)throw Error("Perspective de la fiche impossible à calculer.");
      [M[c],M[pivot]]=[M[pivot],M[c]];const d=M[c][c];for(let j=c;j<=n;j++)M[c][j]/=d;
      for(let r=0;r<n;r++)if(r!==c){const f=M[r][c];for(let j=c;j<=n;j++)M[r][j]-=f*M[c][j];}
    }
    return M.map(r=>r[n]);
  }
  function homographyFromQr(qr){
    const loc=qr.location, src=[loc.topLeftCorner,loc.topRightCorner,loc.bottomRightCorner,loc.bottomLeftCorner];
    if(src.some(p=>!p))throw Error("Les coins du QR code n'ont pas pu être localisés.");
    const dst=[[0,0],[1,0],[1,1],[0,1]], A=[],b=[];
    for(let i=0;i<4;i++){
      const [x,y]=dst[i], X=src[i].x,Y=src[i].y;
      A.push([x,y,1,0,0,0,-x*X,-y*X]);b.push(X);
      A.push([0,0,0,x,y,1,-x*Y,-y*Y]);b.push(Y);
    }
    const h=solveLinearSystem(A,b);return (x,y)=>{const d=h[6]*x+h[7]*y+1;return {x:(h[0]*x+h[1]*y+h[2])/d,y:(h[3]*x+h[4]*y+h[5])/d};};
  }
  function detectBubbleAnswers(image,qr){
    const project=homographyFromQr(qr), data=image.data,w=image.width,h=image.height;
    const corners=[qr.location.topLeftCorner,qr.location.topRightCorner,qr.location.bottomRightCorner,qr.location.bottomLeftCorner];
    const qrSize=(Math.hypot(corners[1].x-corners[0].x,corners[1].y-corners[0].y)+Math.hypot(corners[2].x-corners[3].x,corners[2].y-corners[3].y))/2;
    if(qrSize<55)throw Error("Le QR code est trop petit à l'image. Éloigne-toi légèrement et cadre toute la fiche.");
    const xs=[
      [-1.352,-0.6592,0.0078,0.7032],
      [-1.3505,-0.6699,0.0079,0.7064],
      [-1.349,-0.6652,0.0158,0.7258],
      [-1.3556,-0.6683,0.0318,0.7454],
      [-1.3462,-0.6558,0.0559,0.7653]
    ];
    const ys=[2.5334,3.0091,3.4968,4.0279,4.5019];
    const grayAt=(x,y)=>{const ix=Math.round(x),iy=Math.round(y);if(ix<0||iy<0||ix>=w||iy>=h)return null;const k=(iy*w+ix)*4;return .299*data[k]+.587*data[k+1]+.114*data[k+2];};
    const scores=[];
    for(let r=0;r<5;r++){
      const row=[];
      for(let c=0;c<4;c++){
        const pt=project(xs[r][c],ys[r]), radius=Math.max(2,qrSize*.035), ringIn=qrSize*.09,ringOut=qrSize*.14;
        let sum=0,n=0,ringSum=0,ringN=0;
        for(let dy=-ringOut;dy<=ringOut;dy++)for(let dx=-ringOut;dx<=ringOut;dx++){
          const dist=Math.hypot(dx,dy),v=grayAt(pt.x+dx,pt.y+dy);if(v===null)continue;
          if(dist<=radius){sum+=v;n++;}else if(dist>=ringIn&&dist<=ringOut){ringSum+=v;ringN++;}
        }
        if(!n||!ringN)throw Error("La grille de réponses est hors champ. Cadre toute la fiche, QR et tableau compris.");
        const inner=sum/n,ring=ringSum/ringN;
        // Contraste local : l'anneau extérieur mesure le papier autour de la bulle,
        // sans inclure le contour imprimé de la bulle.
        row.push(ring-inner);
      }
      scores.push(row);
    }
    const answers=[],confidence=[],ambiguous=[];
    for(let r=0;r<5;r++){
      const order=scores[r].map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v);
      const best=order[0],second=order[1];
      if(best.v<22){answers.push("");confidence.push("vide");}
      else if(second.v>best.v*.68){answers.push("");confidence.push("ambiguë");ambiguous.push(r+1);}
      else {answers.push(["A","B","C","D"][best.i]);confidence.push(best.v>=45?"bonne":"à vérifier");if(best.v<40)ambiguous.push(r+1);}
    }
    return {answers,confidence,ambiguous,scores};
  }

  async function loadResultsClasses(){
    const sel=$("qmResultsClass"); if(!sel)return;
    const {data,error}=await client().from("Eleves").select("classe").order("classe");
    if(error){sel.innerHTML='<option value="">Erreur de chargement</option>';$("qmResultsMsg").textContent="Impossible de charger les classes : "+error.message;return;}
    const classes=[...new Set((data||[]).map(x=>(x.classe||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr",{numeric:true}));
    sel.innerHTML='<option value="">Choisir une classe</option>'+classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
  }
  const pct20=(correct,total)=>total?Math.round((correct/total)*2000)/100: null;
  function scoreLabel(correct,total){return total?`${correct}/${total} · ${String(pct20(correct,total)).replace(".",",")}/20`:"Non évalué";}
  async function loadResults(){
    const host=$("qmResultsHost"), msg=$("qmResultsMsg"), classe=$("qmResultsClass").value, db=client();
    host.innerHTML=""; if(!classe){msg.textContent="Choisis une classe pour afficher ses résultats.";return;}
    msg.textContent="Calcul des résultats…";
    const {data:sessions,error:se}=await db.from("qcu_sessions").select("id,titre,niveau,trimestre,date_qcu,chapitres").eq("created_by",window.qcuMemoUserId).eq("classe",classe).order("date_qcu",{ascending:true});
    if(se){msg.textContent="Erreur de chargement des mémorisations : "+se.message;return;}
    if(!sessions?.length){msg.textContent=`Aucune mémorisation attribuée à ${classe}.`;return;}
    const {data:roster,error:re}=await db.from("Eleves").select("id,nom,prenom,classe").eq("classe",classe).order("nom").order("prenom");
    if(re){msg.textContent="Erreur de chargement des élèves : "+re.message;return;}
    const names=new Map((roster||[]).map(st=>[String(st.id),`${st.prenom||""} ${st.nom||""}`.trim()]));
    const allChapterRows=[]; let html="";
    for(const ses of sessions){
      const {data:subs,error:sue}=await db.from("qcu_sujets").select("id,code").eq("session_id",ses.id).order("code");
      if(sue){msg.textContent="Erreur de lecture des sujets : "+sue.message;return;}
      const subjectIds=(subs||[]).map(x=>x.id); if(!subjectIds.length)continue;
      const [{data:attrs,error:ae},{data:sqs,error:qe}]=await Promise.all([
        db.from("qcu_attributions").select("id,eleve_id,sujet_id,statut").eq("session_id",ses.id),
        db.from("qcu_sujet_questions").select("id,sujet_id,question_id,chapitre_snapshot,position").in("sujet_id",subjectIds)
      ]);
      if(ae||qe){msg.textContent="Erreur de lecture des attributions ou questions : "+(ae?.message||qe?.message);return;}
      const attrIds=(attrs||[]).map(a=>a.id);
      const {data:answers,error:ansErr}=attrIds.length?await db.from("qcu_reponses").select("attribution_id,sujet_question_id,is_correct").in("attribution_id",attrIds):{data:[],error:null};
      if(ansErr){msg.textContent="Erreur de lecture des réponses : "+ansErr.message;return;}
      const bankIds=[...new Set((sqs||[]).map(q=>q.question_id).filter(Boolean))];
      let bank=[];
      if(bankIds.length){const br=await db.from("qcu_questions").select("id,chapitre").in("id",bankIds);if(br.error){msg.textContent="Impossible de retrouver les chapitres des questions : "+br.error.message;return;}bank=br.data||[];}
      const chapterByQuestion=new Map(bank.map(q=>[String(q.id),Number(q.chapitre)]));
      const qById=new Map((sqs||[]).map(q=>[String(q.id),q]));
      const responseByKey=new Map((answers||[]).map(a=>[`${a.attribution_id}|${a.sujet_question_id}`,a]));
      const attrByStudentSubject=new Map((attrs||[]).map(a=>[`${a.eleve_id}|${a.sujet_id}`,a]));
      const subjByCode=new Map((subs||[]).map(s=>[String(s.code),s]));
      const subjQuestions=new Map((subs||[]).map(s=>[String(s.id),(sqs||[]).filter(q=>String(q.sujet_id)===String(s.id)).sort((a,b)=>a.position-b.position)]));
      const studentRows=(roster||[]).map(st=>{
        let c=0,t=0;const cells=[];
        for(let i=1;i<=4;i++){
          const sub=subjByCode.get(String(i)),a=sub&&attrByStudentSubject.get(`${st.id}|${sub.id}`);
          if(!a||a.statut==="absent"){cells.push("ABS");continue;}
          if(a.statut!=="corrige"){cells.push("—");continue;}
          const qs=subjQuestions.get(String(sub.id))||[];let sc=0,tot=0;
          for(const q of qs){const ans=responseByKey.get(`${a.id}|${q.id}`);if(ans&&ans.is_correct!==null){tot++;if(ans.is_correct===true)sc++;}}
          if(tot){c+=sc;t+=tot;cells.push(scoreLabel(sc,tot));}else cells.push("Non évalué");
        }
        return {st,cells,c,t};
      });
      html+=`<details open style="margin:12px 0;border:1px solid #ddd;border-radius:9px;padding:10px"><summary><strong>${esc(ses.titre||"Mémorisation")}</strong> · ${esc(ses.niveau||"")} · T${esc(ses.trimestre||"")} · ${esc(ses.date_qcu||"")}</summary>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:.92em"><thead><tr><th style="text-align:left">Élève</th><th>Sujet 1</th><th>Sujet 2</th><th>Sujet 3</th><th>Sujet 4</th><th>Total des 4 sujets</th></tr></thead><tbody>
        ${studentRows.map(r=>`<tr><td style="padding:6px;border-top:1px solid #ddd">${esc(names.get(String(r.st.id))||r.st.id)}</td>${r.cells.map(v=>`<td style="padding:6px;border-top:1px solid #ddd;text-align:center">${esc(v)}</td>`).join("")}<td style="padding:6px;border-top:1px solid #ddd;text-align:center"><strong>${r.t?esc(scoreLabel(r.c,r.t)):"Non évalué"}</strong></td></tr>`).join("")}
        </tbody></table></div><p class="muted">ABS = absent à ce sujet (exclu du calcul) · — = pas encore corrigé. Le total est calculé uniquement sur les sujets corrigés.</p></details>`;
      // Cumul par chapitre : seules les réponses effectivement évaluées entrent dans le dénominateur.
      for(const a of (attrs||[])){
        if(a.statut!=="corrige")continue;
        for(const q of (sqs||[]).filter(x=>String(x.sujet_id)===String(a.sujet_id))){
          const ans=responseByKey.get(`${a.id}|${q.id}`); if(!ans||ans.is_correct===null)continue;
          const chapter=Number(q.chapitre_snapshot)||chapterByQuestion.get(String(q.question_id))||null;
          allChapterRows.push({studentId:String(a.eleve_id),chapter,correct:ans.is_correct===true?1:0,total:1});
        }
      }
    }
    if(!html){msg.textContent="Aucun sujet exploitable n'a été trouvé.";return;}
    const chapters=[...new Set(allChapterRows.map(x=>x.chapter).filter(Number.isFinite))].sort((a,b)=>a-b);
    const chapterTotals=new Map();
    for(const r of allChapterRows){if(!Number.isFinite(r.chapter))continue;const key=`${r.studentId}|${r.chapter}`;const v=chapterTotals.get(key)||{studentId:r.studentId,chapter:r.chapter,correct:0,total:0};v.correct+=r.correct;v.total+=r.total;chapterTotals.set(key,v);}
    const chapterHtml=chapters.length?`<section style="margin-top:18px"><h3>Bilan cumulatif par chapitre — ${esc(classe)}</h3><p class="muted">Les résultats se cumulent sur toutes les mémorisations de l'année. Seules les réponses effectivement corrigées sont prises en compte ; les absences et sujets non réalisés ne valent pas zéro.</p><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.92em"><thead><tr><th style="text-align:left">Élève</th>${chapters.map(c=>`<th>Chap. ${c}</th>`).join("")}<th>Total</th></tr></thead><tbody>${(roster||[]).map(st=>{let c=0,t=0;const cells=chapters.map(ch=>{const v=chapterTotals.get(`${st.id}|${ch}`);if(!v)return "—";c+=v.correct;t+=v.total;return scoreLabel(v.correct,v.total);});return `<tr><td style="padding:6px;border-top:1px solid #ddd">${esc(names.get(String(st.id))||st.id)}</td>${cells.map(v=>`<td style="padding:6px;border-top:1px solid #ddd;text-align:center">${esc(v)}</td>`).join("")}<td style="padding:6px;border-top:1px solid #ddd;text-align:center"><strong>${t?esc(scoreLabel(c,t)):"Non évalué"}</strong></td></tr>`;}).join("")}</tbody></table></div></section>`:`<p class="muted">Aucun résultat par chapitre n'est encore disponible.</p>`;
    host.innerHTML=html+chapterHtml;
    msg.textContent=`Bilan chargé pour ${classe} : ${sessions.length} mémorisation(s), ${roster?.length||0} élève(s).`;
  }

  async function loadCorrectionClasses(){
    const sel=$("qmCorrectionClass");if(!sel)return;
    const {data,error}=await client().from("Eleves").select("classe").order("classe");
    if(error){$("qmCorrectionMsg").textContent="Chargement des classes impossible : "+error.message;return;}
    const classes=[...new Set((data||[]).map(x=>(x.classe||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr",{numeric:true}));
    sel.innerHTML='<option value="">Choisir une classe</option>'+classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
  }
  async function loadCorrectionSessions(){
    const classe=$("qmCorrectionClass").value,sel=$("qmCorrectionMemo");session=null;students=[];
    $("qmCorrectionSubject").innerHTML='<option value="">Choisir un sujet</option>';
    $("qmCorrectionSubject").disabled=true;sel.disabled=true;sel.innerHTML='<option value="">Chargement…</option>';
    if(!classe){sel.innerHTML='<option value="">Choisir une mémorisation</option>';return;}
    const {data,error}=await client().from("qcu_sessions").select("id,classe,titre,niveau,trimestre,date_qcu").eq("created_by",window.qcuMemoUserId).eq("classe",classe).order("date_qcu",{ascending:false});
    if(error){sel.innerHTML='<option value="">Erreur</option>';$("qmCorrectionMsg").textContent="Impossible de charger les mémorisations : "+error.message;return;}
    sel.innerHTML='<option value="">Choisir une mémorisation</option>'+(data||[]).map(x=>`<option value="${esc(x.id)}">${esc(x.titre||"Mémorisation")} · ${esc(x.niveau||"")} · T${esc(x.trimestre||"")}</option>`).join("");sel.disabled=!(data||[]).length;
    $("qmCorrectionMsg").textContent=(data||[]).length?`${data.length} mémorisation(s) trouvée(s) pour ${classe}.`:`Aucune mémorisation attribuée à ${classe}.`;
  }
  async function loadCorrectionSubjects(){
    const id=$("qmCorrectionMemo").value,sel=$("qmCorrectionSubject");session=null;students=[];sel.disabled=true;sel.innerHTML='<option value="">Chargement…</option>';
    if(!id){sel.innerHTML='<option value="">Choisir un sujet</option>';return;}
    const db=client();const [sr,rr]=await Promise.all([
      db.from("qcu_sessions").select("*").eq("id",id).eq("created_by",window.qcuMemoUserId).single(),
      db.from("qcu_sujets").select("id,code").eq("session_id",id).order("code")
    ]);
    if(sr.error||rr.error){sel.innerHTML='<option value="">Erreur de chargement</option>';$("qmCorrectionMsg").textContent=sr.error?.message||rr.error?.message;return;}
    session=sr.data;subjects=rr.data||[];sel.innerHTML='<option value="">Choisir un sujet</option>'+subjects.map(x=>`<option value="${esc(x.code)}">Sujet ${esc(x.code)}</option>`).join("");sel.disabled=!subjects.length;
    const {data,error}=await db.from("Eleves").select("id,nom,prenom,classe").eq("classe",session.classe).order("nom").order("prenom");
    if(error){$("qmCorrectionMsg").textContent="Impossible de charger les élèves : "+error.message;return;}
    students=data||[];$("qmCameraStart").disabled=true;$("qmCapture").disabled=true;
    $("qmCorrectionMsg").textContent=`${students.length} élève(s) chargés pour ${session.classe}. Choisis le sujet pour activer le scanner.`;
    await loadSubjectRoster();
  }
  async function activateCorrectionScanner(){
    const code=$("qmCorrectionSubject").value;
    if(session&&code){session.selectedSubjectCode=code;$("qmCameraStart").disabled=!students.length;await loadSubjectRoster();}
  }

  async function loadSubjectRoster(){
    const host=$("qmSubjectRoster"), code=$("qmCorrectionSubject").value;
    if(!host)return;
    if(!session||!code||!students.length){host.innerHTML="";return;}
    const db=client(), subject=subjects.find(x=>String(x.code)===String(code));
    if(!subject){host.textContent="Sujet introuvable.";return;}
    const {data,error}=await db.from("qcu_attributions").select("id,eleve_id,statut")
      .eq("session_id",session.id).eq("sujet_id",subject.id);
    if(error){host.textContent="Impossible de charger les statuts : "+error.message;return;}
    const byStudent=new Map((data||[]).map(x=>[String(x.eleve_id),x]));
    host.innerHTML=`<h4>Suivi des élèves — sujet ${esc(code)}</h4>
      <p class="muted">Tu peux signaler une absence pour ce sujet uniquement. L'élève pourra réaliser les autres sujets normalement.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:6px">${students.map(st=>{
        const a=byStudent.get(String(st.id));const absent=a?.statut==="absent";
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid #ddd;border-radius:7px;padding:7px">
          <span>${esc(st.prenom)} ${esc(st.nom)}</span><select data-qm-attendance="${esc(st.id)}" aria-label="Statut de ${esc(st.prenom)} ${esc(st.nom)}">
            <option value="present" ${!absent?"selected":""}>À évaluer / présent</option><option value="absent" ${absent?"selected":""}>Absent</option>
          </select></div>`;
      }).join("")}</div>`;
    host.querySelectorAll("[data-qm-attendance]").forEach(sel=>sel.addEventListener("change",()=>setSubjectAttendance(sel.dataset.qmAttendance,sel.value)));
  }

  async function setSubjectAttendance(studentId,status){
    const subject=subjects.find(x=>String(x.code)===String(session?.selectedSubjectCode));
    if(!session||!subject)return;
    const {data,error}=await client().from("qcu_attributions").update({statut:status==="absent"?"absent":"attribue"})
      .eq("session_id",session.id).eq("sujet_id",subject.id).eq("eleve_id",studentId).select("id").maybeSingle();
    if(error){alert("Impossible d'enregistrer le statut : "+error.message);await loadSubjectRoster();return;}
    if(status==="absent"&&currentScan?.studentId===String(studentId)){currentScan=null;$("qmReview").innerHTML="";}
  }

  async function renderAnswerReview() {
    const st=students.find(s=>String(s.id)===currentScan.studentId), selected=$("qmCorrectionSubject").value;
    const quality=currentScan.confidence.map((v,i)=>v==="vide"?`Q${i+1} vide`:v==="ambiguë"?`Q${i+1} ambiguë`:v==="à vérifier"?`Q${i+1} à vérifier`:null).filter(Boolean);
    $("qmReview").innerHTML=`<h3>Réponses détectées — ${esc(st.prenom)} ${esc(st.nom)}</h3>
      <p><b>Sujet sélectionné :</b> ${esc(selected)}</p>
      ${quality.length?`<p style="color:#9a5b00">À vérifier : ${quality.join(", ")}. Corrige les cases si nécessaire.</p>`:'<p style="color:#287447">Les cinq réponses ont été détectées. Vérifie-les avant enregistrement.</p>'}
      ${[1,2,3,4,5].map((n,i)=>`<label>Question ${n}<select data-qm-answer="${n}"><option value="">Sans réponse</option>${["A","B","C","D"].map(v=>`<option ${currentScan.answers[i]===v?"selected":""}>${v}</option>`).join("")}</select></label>`).join("")}
      <button class="primary" id="qmSaveAttempt">Enregistrer les réponses</button><p id="qmSaveMsg" class="muted"></p>`;
    $("qmSaveAttempt").onclick=saveAttempt;
  }
  async function saveAttempt() {
    const db=client(), user=window.qcuMemoUserId, n=Number(session?.selectedSubjectCode), st=students.find(s=>String(s.id)===currentScan.studentId);
    if(!session || !session.selectedSubjectCode)return $("qmSaveMsg").textContent="Sélectionne le sujet à corriger avant l'enregistrement.";
    const subjectId=await db.from("qcu_sujets").select("id").eq("session_id",session.id).eq("code",String(session.selectedSubjectCode||n)).single();
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
    await db.from("qcu_attributions").update({statut:"corrige"}).eq("id",attr.data.id);
    const score=rows.filter(r=>r.is_correct===true).length;
    await loadSubjectRoster();
    $("qmSaveMsg").textContent=`Tentative enregistrée : ${score}/5. Les réponses sont enregistrées dans l'attribution de ce sujet, sans photo.`;
    currentScan=null;
  }

  window.openQcuMemo=open;
  window.addEventListener("pagehide",stopCamera);

  // L'espace professeur peut être construit après le chargement initial
  // (connexion asynchrone). On surveille donc l'arrivée de l'onglet
  // « Évaluer » et on ajoute la carte dès que son conteneur existe.
  function watchHome() {
    addCard();
    if (!document.documentElement || window.qcuMemoHomeObserver) return;
    const observer = new MutationObserver(() => {
      if (!$("qcuMemoHomeCard")) addCard();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.qcuMemoHomeObserver = observer;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchHome, { once: true });
  } else {
    watchHome();
  }
})();