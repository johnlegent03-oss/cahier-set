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
  let scanTimer = null;
  let scanBusy = false;
  let scanCanvas = null;
  let scanContext = null;
  let savedMemos = [];
  let editingMemoId = null;
  let assigningMemo = null;
  let qcuImportPreview = null;

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
            <button id="qmDeleteSession" type="button" disabled style="align-self:end;color:#a12622;border:1px solid #c66">Supprimer la session sélectionnée</button>
            <label>Sujet<select id="qmCorrectionSubject" disabled><option value="">Choisir un sujet</option></select></label>
          </div>
          <p id="qmCorrectionMsg" class="muted" aria-live="polite"></p>
          <div id="qmSubjectRoster" style="margin:10px 0"></div>
          <section style="margin:12px 0;padding:14px;border:1px solid #c8d2df;border-radius:10px;background:#f8fafc">
            <h4 style="margin-top:0">Importer les résultats d'un ancien questionnaire</h4>
            <p class="muted">Importe un fichier Excel (.xlsx) ou CSV avec une colonne Nom et quatre colonnes Sujet 1 à Sujet 4. Les réponses seront associées aux élèves et aux sujets de la mémorisation sélectionnée.</p>
            <label>Fichier de résultats (.xlsx ou .csv)<input id="qmResultsFile" type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled></label>
            <p class="muted" style="margin:8px 0 4px">Corrigé des quatre sujets — modifiable pour chaque import :</p>
            <div class="qmm-fields">
              <label>Sujet 1<input id="qmImportKey1" value="A C B D D" autocomplete="off"></label>
              <label>Sujet 2<input id="qmImportKey2" value="B B B B D" autocomplete="off"></label>
              <label>Sujet 3<input id="qmImportKey3" value="D A C B B" autocomplete="off"></label>
              <label>Sujet 4<input id="qmImportKey4" value="B B D B B" autocomplete="off"></label>
            </div>
            <label style="display:flex;align-items:center;gap:8px;margin-top:10px"><input id="qmImportReplace" type="checkbox"> Remplacer les résultats déjà enregistrés pour les élèves/sujets concernés</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
              <button id="qmImportPreviewBtn" type="button" disabled>Analyser le fichier</button>
              <button id="qmImportConfirmBtn" class="primary" type="button" disabled>Importer les résultats</button>
            </div>
            <p id="qmImportMsg" class="muted" aria-live="polite"></p>
            <div id="qmImportPreviewHost"></div>
          </section>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button id="qmCameraStart" type="button" disabled>Activer la caméra</button>
            <button id="qmCameraStop" type="button" disabled>Arrêter la caméra</button>
          </div>
          <video id="qmVideo" playsinline muted autoplay style="display:none;width:100%;max-width:600px;background:#111;margin-top:10px;border-radius:10px"></video>
          <p id="qmScanStatus" class="muted" aria-live="polite">Après activation, place une fiche entière dans le cadre : la lecture se déclenchera automatiquement.</p>
          <button id="qmCapture" type="button" disabled>Scanner maintenant</button>
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
        <div style="border-top:1px solid #ddd;margin-top:18px;padding-top:14px">
          <h3>Statistiques des questions</h3>
          <p class="muted">Fréquence d'apparition de chaque question dans les sujets préparés : vue cumulée par mémorisation et détail par session.</p>
          <button id="qmQuestionStatsLoad" type="button">Calculer les fréquences des questions</button>
          <p id="qmQuestionStatsMsg" class="muted" aria-live="polite"></p>
          <div id="qmQuestionStatsHost"></div>
        </div>
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
    $("qmDeleteSession").onclick = deleteSelectedSession;
    $("qmCorrectionSubject").onchange = activateCorrectionScanner;
    $("qmResultsFile").onchange = handleResultsImportFile;
    $("qmImportPreviewBtn").onclick = buildResultsImportPreview;
    $("qmImportConfirmBtn").onclick = confirmResultsImport;
    $("qmImportReplace").onchange = () => { if(qcuImportPreview) renderResultsImportPreview(); };
    $("qmCameraStart").onclick = startCamera;
    $("qmCameraStop").onclick = stopCamera;
    $("qmCapture").onclick = captureQr;
    $("qmResultsLoad").onclick = loadResults;
    $("qmQuestionStatsLoad").onclick = loadQuestionStats;
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
    // 2 fiches grand format par page A4 : 18 × 13 cm, adaptées aux boîtes.
    const chunks=[];
    for(let i=0;i<students.length;i+=2)chunks.push(students.slice(i,i+2));
    const pages=chunks.map(group=>`<section class="print-page">${group.map(st=>`<article class="sheet">
      <svg class="omr-markers" viewBox="0 0 1800 1300" aria-hidden="true">
        <rect x="19" y="19" width="22" height="22" fill="#000"/>
        <rect x="1759" y="19" width="22" height="22" fill="#000"/>
        <rect x="1759" y="1259" width="22" height="22" fill="#000"/>
        <rect x="19" y="1259" width="22" height="22" fill="#000"/>
      </svg>
      <div class="head">
        <div class="identity"><h2>FICHE-RÉPONSE</h2><p class="student"><b>${esc(st.prenom)} ${esc(st.nom)}</b></p><p class="class">${esc(st.classe)}</p></div>
        <div class="qr" data-student="${esc(st.id)}"></div>
      </div>
      <div class="subject-line"><b>Sujet :</b>${[1,2,3,4].map(n=>`<span>○ ${n}</span>`).join("")}</div>
      <table><thead><tr><th>Q</th>${["A","B","C","D"].map(x=>`<th>${x}</th>`).join("")}</tr></thead>
      <tbody>${[1,2,3,4,5].map(n=>`<tr><th>${n}</th>${[1,2,3,4].map(()=>"<td><i></i></td>").join("")}</tr>`).join("")}</tbody></table>
    </article>`).join("")}</section>`).join("");
    const classe=$("qmPermanentClass").value;
    const w=window.open("","_blank");if(!w)return alert("Autorise les fenêtres pop-up pour imprimer.");
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fiches permanentes — ${esc(classe)}</title><style>
      @page{size:A4 portrait;margin:7mm}
      *{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
      html,body{margin:0;padding:0;font:7pt Arial,sans-serif;color:#111}
      .print-page{width:196mm;height:283mm;display:grid;grid-template-columns:180mm;grid-template-rows:repeat(2,130mm);gap:5mm;justify-content:center;align-content:center;page-break-after:always;break-after:page;overflow:hidden}
      .print-page:last-child{page-break-after:auto;break-after:auto}
      .sheet{width:180mm;height:130mm;border:0.35mm solid #555;border-radius:1.2mm;padding:2mm 2.5mm;overflow:hidden;display:flex;flex-direction:column;position:relative;break-inside:avoid}
      .omr-markers{position:absolute;inset:0;width:100%;height:100%;z-index:10;pointer-events:none;overflow:visible}
      .omr-markers rect{fill:#000!important;stroke:none!important}
      @media print{
        html,body,.print-page,.sheet,.omr-markers{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        .omr-markers rect{fill:#000!important;opacity:1!important}
      }
      .head{height:36mm;min-height:36mm;display:flex;justify-content:space-between;align-items:flex-start;gap:2mm}
      .identity{min-width:0;flex:1;padding-top:2mm;padding-left:8mm}h2{font-size:15pt;letter-spacing:.3pt;margin:0 0 1mm}.student{font-size:16pt;margin:0 0 .5mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.class{font-size:13pt;margin:0}
      .qr{width:24mm;height:24mm;flex:0 0 24mm;margin-right:6mm;margin-top:1mm}.qr img,.qr canvas{width:24mm!important;height:24mm!important;display:block}
      .subject-line{height:13mm;min-height:13mm;display:flex;align-items:center;justify-content:flex-start;gap:10mm;font-size:14pt;margin:0 0 1mm}.subject-line span{white-space:nowrap}
      table{width:100%;height:62mm;border-collapse:collapse;table-layout:fixed;margin:0}
      th,td{border:.25mm solid #333;text-align:center;padding:0;height:10mm}th{font-size:14pt;font-weight:700}th:first-child{width:26mm}
      td i{display:inline-block;width:7mm;height:7mm;border:.6mm solid #111;border-radius:50%;vertical-align:middle}
    </style></head><body>${pages}<script>
      window.onload=()=>{document.querySelectorAll('.qr').forEach(el=>new QRCode(el,{text:el.dataset.student,width:220,height:220,correctLevel:QRCode.CorrectLevel.M}));setTimeout(()=>window.print(),1000)};
    <\/script><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script></body></html>`);
    w.document.close();
  }
  async function ensureJsQr() {
    if (window.jsQR) return;
    if (window.qmJsQrPromise) return window.qmJsQrPromise;
    window.qmJsQrPromise = new Promise((resolve,reject)=>{
      const s=document.createElement("script");
      s.src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
      s.onload=()=>window.jsQR?resolve():reject(Error("La librairie de lecture QR n'a pas pu démarrer."));
      s.onerror=()=>reject(Error("Impossible de charger la librairie de lecture QR."));
      document.head.appendChild(s);
    });
    return window.qmJsQrPromise;
  }
  async function startCamera() {
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error("La caméra nécessite une connexion sécurisée HTTPS et un navigateur compatible.");
      if(!session || !$("qmCorrectionSubject").value)throw Error("Sélectionne d'abord la classe, la mémorisation et le sujet à corriger.");
      $("qmScanStatus").textContent="Préparation de la caméra…";
      await ensureJsQr();
      camera=await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{
          facingMode:{ideal:"environment"},
          width:{ideal:1920},height:{ideal:1080},
          frameRate:{ideal:24,max:30}
        }
      });
      const video=$("qmVideo");
      video.setAttribute("playsinline","");
      video.muted=true;
      video.srcObject=camera;
      video.style.display="block";
      await video.play();
      scanCanvas=document.createElement("canvas");
      scanContext=scanCanvas.getContext("2d",{willReadFrequently:true});
      $("qmCameraStop").disabled=false;
      $("qmCapture").disabled=false;
      $("qmCameraStart").disabled=true;
      $("qmScanStatus").textContent="Caméra active : présente une fiche entière avec ses quatre repères noirs visibles. Le QR code et les réponses seront analysés automatiquement.";
      scheduleQrScan(150);
    }catch(e){
      stopCamera();
      if($("qmScanStatus"))$("qmScanStatus").textContent=e.message||"Impossible d'activer la caméra.";
      alert("Caméra inaccessible : "+(e.message||e));
    }
  }
  function stopCamera(){
    if(scanTimer!==null){clearTimeout(scanTimer);scanTimer=null;}
    if(camera)camera.getTracks().forEach(t=>t.stop());
    camera=null;scanBusy=false;scanCanvas=null;scanContext=null;
    if($("qmVideo")){$("qmVideo").pause();$("qmVideo").srcObject=null;$("qmVideo").style.display="none";}
    if($("qmCameraStop"))$("qmCameraStop").disabled=true;
    if($("qmCapture"))$("qmCapture").disabled=true;
    if($("qmCameraStart"))$("qmCameraStart").disabled=!students.length;
    if($("qmScanStatus"))$("qmScanStatus").textContent="Caméra arrêtée.";
  }
  function scheduleQrScan(delay=320){
    if(!camera || scanTimer!==null)return;
    scanTimer=setTimeout(runQrScan,delay);
  }
  async function runQrScan(){
    scanTimer=null;
    const video=$("qmVideo");
    if(!camera || !video || !video.videoWidth)return scheduleQrScan(400);
    if(scanBusy || currentScan)return scheduleQrScan(400);
    try{
      if(!scanCanvas || scanCanvas.width!==video.videoWidth || scanCanvas.height!==video.videoHeight){
        scanCanvas=document.createElement("canvas");
        scanCanvas.width=video.videoWidth;scanCanvas.height=video.videoHeight;
        scanContext=scanCanvas.getContext("2d",{willReadFrequently:true});
      }
      scanContext.drawImage(video,0,0,scanCanvas.width,scanCanvas.height);
      const image=scanContext.getImageData(0,0,scanCanvas.width,scanCanvas.height);
      const qr=window.jsQR(image.data,image.width,image.height,{inversionAttempts:"attemptBoth"});
      if(qr?.data){
        scanBusy=true;
        $("qmScanStatus").textContent="Fiche détectée : lecture du QR code et analyse des cinq lignes…";
        await processQrCapture(image,qr,true);
      }else{
        $("qmScanStatus").textContent="En attente d'une fiche… Garde les quatre repères noirs, le QR code et les réponses dans le cadre.";
      }
    }catch(e){
      if($("qmScanStatus"))$("qmScanStatus").textContent=e.message||"Lecture impossible. Replace la fiche et réessaie.";
    }finally{
      scanBusy=false;
      scheduleQrScan(currentScan?500:320);
    }
  }
  async function captureQr(){
    const video=$("qmVideo");if(!video?.videoWidth)return;
    if(scanBusy)return;
    try{
      await ensureJsQr();
      const canvas=document.createElement("canvas");canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(video,0,0);
      const image=ctx.getImageData(0,0,canvas.width,canvas.height);
      const qr=window.jsQR(image.data,image.width,image.height,{inversionAttempts:"attemptBoth"});
      if(!qr?.data)throw Error("QR non détecté. Cadre la fiche entière, QR code et tableau compris.");
      scanBusy=true;
      await processQrCapture(image,qr,false);
    }catch(e){alert(e.message||"Lecture impossible.");}
    finally{scanBusy=false;}
  }
  async function processQrCapture(image,qr,automatic){
    try{
      const studentId=qr.data.trim();
      if(!session || !$("qmCorrectionSubject").value)throw Error("Sélectionne d'abord la classe, la mémorisation et le sujet à corriger.");
      const st=students.find(s=>String(s.id)===studentId);
      if(!st)throw Error("Ce QR code ne correspond pas à un élève de la classe sélectionnée.");
      const subject=subjects.find(x=>String(x.code)===String(session.selectedSubjectCode));
      if(!subject)throw Error("Le sujet sélectionné est introuvable.");
      const {data:attendance,error:attendanceError}=await client().from("qcu_attributions").select("statut")
        .eq("session_id",session.id).eq("sujet_id",subject.id).eq("eleve_id",studentId).single();
      if(attendanceError)throw Error("Attribution introuvable pour cet élève et ce sujet : "+attendanceError.message);
      if(attendance?.statut==="absent")throw Error("Cet élève est indiqué absent pour ce sujet. Modifie son statut avant de scanner ses réponses.");
      const detected=detectBubbleAnswers(image,qr);
      currentScan={studentId,answers:detected.answers,confidence:detected.confidence,ambiguous:detected.ambiguous};
      renderAnswerReview();
      if($("qmScanStatus"))$("qmScanStatus").textContent=`Fiche de ${st.prenom} ${st.nom} capturée. Vérifie les réponses puis enregistre pour passer à la suivante.`;
    }catch(e){
      if(automatic){
        if($("qmScanStatus"))$("qmScanStatus").textContent=(e.message||"Lecture impossible.")+" Replace la fiche pour continuer.";
      }else throw e;
    }
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
  // Lecture optique par quatre repères : redressement de perspective, puis mesure
  // du noircissement au centre de chaque bulle par rapport au papier environnant.
  function detectBubbleAnswers(image,qr){
    const w=image.width,h=image.height,data=image.data;
    const scale=Math.max(1,Math.ceil(Math.max(w,h)/1000));
    const sw=Math.floor(w/scale),sh=Math.floor(h/scale),gray=new Uint8Array(sw*sh);
    for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){const k=(Math.min(h-1,y*scale)*w+Math.min(w-1,x*scale))*4;gray[y*sw+x]=(data[k]*77+data[k+1]*150+data[k+2]*29)>>8;}
    const iw=sw+1,integ=new Uint32Array(iw*(sh+1));
    for(let y=0;y<sh;y++){let row=0;for(let x=0;x<sw;x++){row+=gray[y*sw+x];integ[(y+1)*iw+x+1]=integ[y*iw+x+1]+row;}}
    const rad=Math.max(5,Math.round(Math.min(sw,sh)/90)),mask=new Uint8Array(sw*sh);
    for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){const x0=Math.max(0,x-rad),x1=Math.min(sw,x+rad+1),y0=Math.max(0,y-rad),y1=Math.min(sh,y+rad+1);const sum=integ[y1*iw+x1]-integ[y0*iw+x1]-integ[y1*iw+x0]+integ[y0*iw+x0];const mean=sum/((x1-x0)*(y1-y0));if(gray[y*sw+x]<Math.min(150,mean*.58))mask[y*sw+x]=1;}
    const blobs=[],stack=new Int32Array(sw*sh);
    for(let i=0;i<mask.length;i++){if(mask[i]!==1)continue;let sp=0;stack[sp++]=i;mask[i]=2;let area=0,sx=0,sy=0,minX=sw,maxX=0,minY=sh,maxY=0;while(sp){const j=stack[--sp],x=j%sw,y=(j-x)/sw;area++;sx+=x;sy+=y;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;const ns=[x>0?j-1:-1,x<sw-1?j+1:-1,y>0?j-sw:-1,y<sh-1?j+sw:-1];for(const n of ns)if(n>=0&&mask[n]===1){mask[n]=2;stack[sp++]=n;}}const bw=maxX-minX+1,bh=maxY-minY+1;if(area<18||area>sw*sh*.0015||bw<5||bh<5||bw/bh<.68||bw/bh>1.47||area/(bw*bh)<.62)continue;blobs.push({x:(sx/area+.5)*scale,y:(sy/area+.5)*scale,area});}
    const cand=blobs.sort((a,b)=>b.area-a.area).slice(0,32);if(cand.length<4)throw Error('Les quatre repères noirs ne sont pas visibles. Cadre toute la fiche et garde ses quatre coins dégagés.');
    const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);let chosen=null,chosenScore=Infinity;
    for(let a=0;a<cand.length-3;a++)for(let b=a+1;b<cand.length-2;b++)for(let c=b+1;c<cand.length-1;c++)for(let d=c+1;d<cand.length;d++){
      const pts=[cand[a],cand[b],cand[c],cand[d]],areas=pts.map(p=>p.area);if(Math.max(...areas)/Math.min(...areas)>2.2)continue;
      const tl=pts.reduce((m,p)=>p.x+p.y<m.x+m.y?p:m),br=pts.reduce((m,p)=>p.x+p.y>m.x+m.y?p:m),tr=pts.reduce((m,p)=>p.x-p.y>m.x-m.y?p:m),bl=pts.find(p=>p!==tl&&p!==br&&p!==tr);if(!bl||new Set([tl,tr,br,bl]).size!==4)continue;
      const top=dist(tl,tr),bottom=dist(bl,br),left=dist(tl,bl),right=dist(tr,br),ratio=(top+bottom)/(left+right);if(ratio<1.25||ratio>1.55)continue;if(Math.max(top,bottom)/Math.min(top,bottom)>1.55||Math.max(left,right)/Math.min(left,right)>1.55)continue;
      const score=Math.abs(Math.log(ratio/(180/130)))+Math.abs(Math.log(top/bottom))+Math.abs(Math.log(left/right))+(Math.max(...areas)/Math.min(...areas)-1)*.18;if(score<chosenScore){chosenScore=score;chosen=[tl,tr,br,bl];}
    }
    if(!chosen)throw Error('Impossible de retrouver les quatre coins. Pose la fiche à plat et cadre-la entièrement.');
    const src=[[3,3],[177,3],[177,127],[3,127]],dst=chosen.map(p=>[p.x,p.y]),A=[],B=[];
    for(let i=0;i<4;i++){const [x,y]=src[i],[u,v]=dst[i];A.push([x,y,1,0,0,0,-u*x,-u*y]);B.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);B.push(v);}
    const M=A.map((r,i)=>r.concat(B[i]));for(let col=0;col<8;col++){let pivot=col;for(let r=col+1;r<8;r++)if(Math.abs(M[r][col])>Math.abs(M[pivot][col]))pivot=r;if(Math.abs(M[pivot][col])<1e-10)throw Error('Perspective trop déformée. Reprends la photo au-dessus de la fiche.');[M[col],M[pivot]]=[M[pivot],M[col]];const z=M[col][col];for(let j=col;j<=8;j++)M[col][j]/=z;for(let r=0;r<8;r++)if(r!==col){const f=M[r][col];for(let j=col;j<=8;j++)M[r][j]-=f*M[col][j];}}
    const H=M.map(r=>r[8]).concat(1),project=(x,y)=>{const z=H[6]*x+H[7]*y+1;return{x:(H[0]*x+H[1]*y+H[2])/z,y:(H[3]*x+H[4]*y+H[5])/z};};
    const grayAt=(x,y)=>{const ix=Math.round(x),iy=Math.round(y);if(ix<0||iy<0||ix>=w||iy>=h)return 255;const k=(iy*w+ix)*4;return(data[k]*77+data[k+1]*150+data[k+2]*29)/256;};
    // Géométrie imprimée : tableau de x=2.5 à 87.5 mm, première colonne 13 mm,
    // quatre colonnes de 18 mm ; centre des bulles à y=28,32,36,40,44 mm.
    const xs=[49,85,121,157],answers=[],confidence=[],ambiguous=[],scores=[];
    for(let r=0;r<5;r++){const row=[],yy=72.8+10.4*r;for(let c=0;c<4;c++){const p=project(xs[c],yy),px=project(xs[c]+1,yy),mmScale=Math.hypot(px.x-p.x,px.y-p.y);const innerR=Math.max(2,mmScale*1.05),ringIn=mmScale*1.95,ringOut=mmScale*2.65,cx=Math.round(p.x),cy=Math.round(p.y);let si=0,ni=0,sr=0,nr=0;const step=Math.max(1,Math.round(scale*.45));for(let dy=-ringOut;dy<=ringOut;dy+=step)for(let dx=-ringOut;dx<=ringOut;dx+=step){const d=Math.hypot(dx,dy),v=grayAt(cx+dx,cy+dy);if(d<=innerR){si+=v;ni++;}else if(d>=ringIn&&d<=ringOut){sr+=v;nr++;}}if(!ni||!nr)throw Error('Grille partiellement hors champ. Cadre toute la fiche.');row.push(sr/nr-si/ni);}scores.push(row);const order=row.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v),best=row[order[0].i],second=row[order[1].i];if(best<24){answers.push('');confidence.push('vide');}else if(second>best*.72){answers.push('');confidence.push('ambiguë');ambiguous.push(r+1);}else{answers.push(['A','B','C','D'][order[0].i]);confidence.push(best>=48?'bonne':'à vérifier');if(best<38)ambiguous.push(r+1);}}
    return{answers,confidence,ambiguous,scores,method:'repères + perspective'};
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

  async function loadQuestionStats(){
    const msg=$("qmQuestionStatsMsg"),host=$("qmQuestionStatsHost"),classe=$("qmResultsClass").value,db=client();
    host.innerHTML="";
    if(!classe){msg.textContent="Choisis d'abord une classe.";return;}
    msg.textContent="Calcul des fréquences…";
    const {data:sessions,error:se}=await db.from("qcu_sessions").select("id,titre,niveau,trimestre,date_qcu").eq("created_by",window.qcuMemoUserId).eq("classe",classe).order("date_qcu",{ascending:true});
    if(se){msg.textContent="Erreur de chargement des sessions : "+se.message;return;}
    if(!sessions?.length){msg.textContent="Aucune session trouvée pour cette classe.";return;}
    const sessionData=[];const allQuestionIds=new Set();
    for(const ses of sessions){
      const {data:subs,error:sue}=await db.from("qcu_sujets").select("id,code").eq("session_id",ses.id).order("code");
      if(sue){msg.textContent="Erreur de lecture des sujets : "+sue.message;return;}
      const ids=(subs||[]).map(x=>x.id);if(!ids.length)continue;
      const {data:rows,error:qe}=await db.from("qcu_sujet_questions").select("id,sujet_id,question_id,position,chapitre_snapshot").in("sujet_id",ids).order("position");
      if(qe){msg.textContent="Erreur de lecture des questions : "+qe.message;return;}
      for(const r of (rows||[]))if(r.question_id)allQuestionIds.add(String(r.question_id));
      sessionData.push({session:ses,subjects:subs||[],rows:rows||[]});
    }
    const qids=[...allQuestionIds];let bank=[];
    if(qids.length){const {data,error}=await db.from("qcu_questions").select("id,question_text,niveau,chapitre").in("id",qids);if(error){msg.textContent="Impossible de charger les intitulés des questions : "+error.message;return;}bank=data||[];}
    const questionById=new Map(bank.map(q=>[String(q.id),q]));
    const groups=new Map();
    for(const item of sessionData){
      const ses=item.session;const key=[ses.titre||"Mémorisation",ses.niveau||"",ses.trimestre||""].join("|");
      if(!groups.has(key))groups.set(key,{title:ses.titre||"Mémorisation",level:ses.niveau||"",term:ses.trimestre||"",sessions:[],counts:new Map()});
      const g=groups.get(key),perSession=new Map();
      for(const row of item.rows){
        if(!row.question_id)continue;
        const qid=String(row.question_id);perSession.set(qid,(perSession.get(qid)||0)+1);
        const bySubject=g.counts.get(qid)||new Map();const sub=item.subjects.find(x=>String(x.id)===String(row.sujet_id));const code=String(sub?.code||"?");bySubject.set(code,(bySubject.get(code)||0)+1);g.counts.set(qid,bySubject);
      }
      g.sessions.push({date:ses.date_qcu||"Date inconnue",perSession,subjects:item.subjects});
    }
    if(!groups.size){msg.textContent="Aucune question trouvée dans les sujets de cette classe.";return;}
    const fmt=(n)=>n===0?"—":String(n);
    let html="";
    for(const g of groups.values()){
      const codes=[...new Set(g.sessions.flatMap(x=>x.subjects.map(s=>String(s.code))))].sort((a,b)=>a.localeCompare(b,"fr",{numeric:true}));
      const rows=[...g.counts.entries()].sort((a,b)=>{
        const qa=questionById.get(a[0]),qb=questionById.get(b[0]);return (Number(qa?.chapitre)||0)-(Number(qb?.chapitre)||0)||String(qa?.question_text||"").localeCompare(String(qb?.question_text||""),"fr");
      });
      html+=`<section style="margin:14px 0;padding:12px;border:1px solid #ddd;border-radius:10px"><h4>${esc(g.title)} · ${esc(g.level)} · T${esc(g.term)}</h4><p class="muted">${g.sessions.length} session(s) cumulée(s). Une apparition correspond à une question placée dans un sujet, indépendamment du nombre d'élèves.</p><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.9em"><thead><tr><th style="text-align:left">Question</th>${codes.map(c=>`<th>Sujet ${esc(c)}</th>`).join("")}<th>Total</th></tr></thead><tbody>${rows.map(([qid,counts])=>{const q=questionById.get(qid),total=[...counts.values()].reduce((a,b)=>a+b,0);return `<tr><td style="padding:7px;border-top:1px solid #ddd;min-width:220px">${esc(q?.question_text||"Question indisponible")}${q?.chapitre?`<small class="muted"> · Chapitre ${esc(q.chapitre)}</small>`:""}</td>${codes.map(c=>`<td style="padding:7px;border-top:1px solid #ddd;text-align:center">${fmt(counts.get(c)||0)}</td>`).join("")}<td style="padding:7px;border-top:1px solid #ddd;text-align:center"><strong>${total}</strong></td></tr>`;}).join("")}</tbody></table></div><details style="margin-top:10px"><summary>Détail par session</summary>${g.sessions.map((ss,i)=>`<p style="margin:7px 0"><strong>Session ${i+1}</strong> · ${esc(ss.date)} : ${[...ss.perSession.values()].reduce((a,b)=>a+b,0)} apparition(s)</p>`).join("")}</details></section>`;
    }
    host.innerHTML=html;
    msg.textContent=`Statistiques calculées pour ${classe} : ${allQuestionIds.size} question(s) distincte(s), ${sessionData.length} session(s).`;
  }



  async function deleteSelectedSession(){
    const id=$("qmCorrectionMemo").value;
    if(!id){alert("Sélectionne d'abord une session à supprimer.");return;}
    const selected=$("qmCorrectionMemo").selectedOptions?.[0];
    const label=selected?.textContent||"cette session";
    const ok=confirm(`Supprimer définitivement ${label} ?\n\nCette opération supprimera aussi les attributions, les réponses, les sujets et les questions copiées dans les sujets. Les questions originales de la banque seront conservées. Cette suppression est irréversible.`);
    if(!ok)return;
    const btn=$("qmDeleteSession");btn.disabled=true;$("qmCorrectionMsg").textContent="Suppression de la session et de ses données…";
    const db=client();
    try{
      const {data:subs,error:subErr}=await db.from("qcu_sujets").select("id").eq("session_id",id);
      if(subErr)throw subErr;
      const subjectIds=(subs||[]).map(x=>x.id);
      const {data:attrs,error:attrErr}=await db.from("qcu_attributions").select("id").eq("session_id",id);
      if(attrErr)throw attrErr;
      const attributionIds=(attrs||[]).map(x=>x.id);
      if(attributionIds.length){
        // Les réponses référencent éventuellement les scans : supprimer d'abord les réponses,
        // puis les lignes de scan, avant les attributions qui les portent.
        const {error:deleteResponsesErr}=await db.from("qcu_reponses").delete().in("attribution_id",attributionIds);
        if(deleteResponsesErr)throw deleteResponsesErr;
        const {error:deleteScansErr}=await db.from("qcu_scans").delete().in("attribution_id",attributionIds);
        if(deleteScansErr)throw deleteScansErr;
      }
      const {error:deleteAttrErr}=await db.from("qcu_attributions").delete().eq("session_id",id);
      if(deleteAttrErr)throw deleteAttrErr;
      if(subjectIds.length){const {error}=await db.from("qcu_sujet_questions").delete().in("sujet_id",subjectIds);if(error)throw error;}
      const {error:deleteSubsErr}=await db.from("qcu_sujets").delete().eq("session_id",id);
      if(deleteSubsErr)throw deleteSubsErr;
      const {error:deleteSessionErr}=await db.from("qcu_sessions").delete().eq("id",id).eq("created_by",window.qcuMemoUserId);
      if(deleteSessionErr)throw deleteSessionErr;
      session=null;students=[];$("qmCorrectionSubject").innerHTML='<option value="">Choisir un sujet</option>';$("qmCorrectionSubject").disabled=true;$("qmSubjectRoster").innerHTML="";$("qmReview").innerHTML="";
      await loadCorrectionSessions();
      $("qmCorrectionMsg").textContent="Session supprimée avec ses résultats et ses sujets. Les questions originales sont conservées.";
    }catch(error){
      $("qmCorrectionMsg").textContent="La suppression n'a pas pu être terminée : "+(error?.message||String(error))+". Certaines étapes ont éventuellement déjà été effectuées ; vérifie les données avant de recommencer.";
      btn.disabled=!$("qmCorrectionMemo").value;
    }
  }

  async function loadCorrectionClasses(){
    const sel=$("qmCorrectionClass");if(!sel)return;
    const {data,error}=await client().from("Eleves").select("classe").order("classe");
    if(error){$("qmCorrectionMsg").textContent="Chargement des classes impossible : "+error.message;return;}
    const classes=[...new Set((data||[]).map(x=>(x.classe||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr",{numeric:true}));
    sel.innerHTML='<option value="">Choisir une classe</option>'+classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
  }
  async function loadCorrectionSessions(){
    const classe=$("qmCorrectionClass").value,sel=$("qmCorrectionMemo");session=null;students=[];$("qmDeleteSession").disabled=true;
    $("qmCorrectionSubject").innerHTML='<option value="">Choisir un sujet</option>';
    $("qmCorrectionSubject").disabled=true;sel.disabled=true;sel.innerHTML='<option value="">Chargement…</option>';
    if(!classe){sel.innerHTML='<option value="">Choisir une mémorisation</option>';return;}
    const {data,error}=await client().from("qcu_sessions").select("id,classe,titre,niveau,trimestre,date_qcu").eq("created_by",window.qcuMemoUserId).eq("classe",classe).order("date_qcu",{ascending:false});
    if(error){sel.innerHTML='<option value="">Erreur</option>';$("qmCorrectionMsg").textContent="Impossible de charger les mémorisations : "+error.message;return;}
    sel.innerHTML='<option value="">Choisir une mémorisation</option>'+(data||[]).map(x=>`<option value="${esc(x.id)}">${esc(x.titre||"Mémorisation")} · ${esc(x.niveau||"")} · T${esc(x.trimestre||"")}</option>`).join("");sel.disabled=!(data||[]).length;
    $("qmCorrectionMsg").textContent=(data||[]).length?`${data.length} mémorisation(s) trouvée(s) pour ${classe}.`:`Aucune mémorisation attribuée à ${classe}.`;
  }
  async function loadCorrectionSubjects(){
    const id=$("qmCorrectionMemo").value,sel=$("qmCorrectionSubject");session=null;students=[];$("qmDeleteSession").disabled=true;sel.disabled=true;sel.innerHTML='<option value="">Chargement…</option>';
    if(!id){sel.innerHTML='<option value="">Choisir un sujet</option>';return;}
    const db=client();const [sr,rr]=await Promise.all([
      db.from("qcu_sessions").select("*").eq("id",id).eq("created_by",window.qcuMemoUserId).single(),
      db.from("qcu_sujets").select("id,code").eq("session_id",id).order("code")
    ]);
    if(sr.error||rr.error){sel.innerHTML='<option value="">Erreur de chargement</option>';$("qmCorrectionMsg").textContent=sr.error?.message||rr.error?.message;return;}
    session=sr.data;subjects=rr.data||[];sel.innerHTML='<option value="">Choisir un sujet</option>'+subjects.map(x=>`<option value="${esc(x.code)}">Sujet ${esc(x.code)}</option>`).join("");sel.disabled=!subjects.length;
    // La suppression concerne la session sélectionnée, pas le choix du sujet.
    $("qmDeleteSession").disabled=false;
    qcuImportPreview=null;$("qmResultsFile").disabled=!subjects.length;$("qmImportPreviewBtn").disabled=true;$("qmImportConfirmBtn").disabled=true;$("qmImportPreviewHost").innerHTML="";$("qmImportMsg").textContent="";
    const {data,error}=await db.from("Eleves").select("id,nom,prenom,classe").eq("classe",session.classe).order("nom").order("prenom");
    if(error){$("qmCorrectionMsg").textContent="Impossible de charger les élèves : "+error.message;return;}
    students=data||[];$("qmCameraStart").disabled=true;$("qmCapture").disabled=true;
    $("qmCorrectionMsg").textContent=`${students.length} élève(s) chargés pour ${session.classe}. Choisis le sujet pour activer le scanner.`;
    await loadSubjectRoster();
  }
  function normalizeImportName(value){
    return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
  }
  function parseImportAnswers(value){
    const raw=String(value??"").trim();
    if(!raw)return {kind:"empty",answers:[]};
    const normalized=raw.toLocaleUpperCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
    if(/^(ABSENT|ABSENTE|ABS)$/.test(normalized))return {kind:"absent",answers:[]};
    if(/^(NON EVALUE|NON EVALU[EÉ]|NE|N E)$/.test(normalized))return {kind:"not_evaluated",answers:[]};
    const answers=raw.toLocaleUpperCase("fr").match(/[ABCD]/g)||[];
    if(answers.length!==5 || raw.replace(/[ABCD\s,;|\-]/gi,"")!=="")return {kind:"invalid",answers};
    return {kind:"answers",answers};
  }
  async function ensureXlsxLibrary(){
    if(window.XLSX)return;
    if(window.qcuXlsxLoading)return window.qcuXlsxLoading;
    window.qcuXlsxLoading=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      script.onload=()=>window.XLSX?resolve():reject(new Error("La bibliothèque Excel n'a pas pu être initialisée."));
      script.onerror=()=>reject(new Error("Impossible de charger le lecteur Excel. Vérifie ta connexion internet puis réessaie."));
      document.head.appendChild(script);
    });
    return window.qcuXlsxLoading;
  }
  async function readResultsImportFile(file){
    const ext=(file.name.split(".").pop()||"").toLowerCase();
    let rows=[];
    if(ext==="xlsx"){
      await ensureXlsxLibrary();
      const bytes=await file.arrayBuffer();
      const wb=window.XLSX.read(bytes,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      rows=window.XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:false});
    }else if(ext==="csv"){
      const raw=(await file.text()).replace(/^\uFEFF/,"");
      const lines=raw.split(/\r?\n/).filter(x=>x.trim());
      if(!lines.length)throw new Error("Le fichier CSV est vide.");
      const first=lines.slice(0,5);
      const delimiter=first.some(x=>x.includes(";"))?";":",";
      rows=lines.map(line=>parseCsvLine(line,delimiter));
    }else throw new Error("Format non pris en charge. Utilise un fichier .xlsx ou .csv exporté depuis Numbers.");
    const normHeader=x=>normalizeImportName(x).replace(/ /g,"");
    let headerIndex=-1,headers=[];
    for(let i=0;i<Math.min(rows.length,8);i++){
      const h=(rows[i]||[]).map(normHeader);
      const hasName=h.some(x=>["nom","eleve","nomprenom","eleve(s)"].includes(x));
      const hasSubjects=[1,2,3,4].every(n=>h.some(x=>["sujet"+n,"sujet"+n+"reponses","sujet"+n+"réponses"].includes(x)));
      if(hasName&&hasSubjects){headerIndex=i;headers=h;break;}
    }
    if(headerIndex<0)throw new Error("En-têtes non reconnus. Il faut une colonne Nom et quatre colonnes Sujet 1, Sujet 2, Sujet 3 et Sujet 4.");
    const find=(...names)=>headers.findIndex(h=>names.includes(h));
    const nameCol=find("nom","eleve","nomprenom");
    const subjectCols=[1,2,3,4].map(n=>find("sujet"+n,"sujet"+n+"reponses"));
    const result=[];
    for(let i=headerIndex+1;i<rows.length;i++){
      const row=rows[i]||[],name=String(row[nameCol]??"").trim();
      if(!name)continue;
      result.push({line:i+1,name,values:subjectCols.map(c=>row[c]??"")});
    }
    if(!result.length)throw new Error("Aucune ligne d'élève n'a été trouvée dans le fichier.");
    return result;
  }
  async function handleResultsImportFile(ev){
    const file=ev.target.files?.[0];qcuImportPreview=null;
    $("qmImportPreviewBtn").disabled=!file||!session||!students.length;
    $("qmImportConfirmBtn").disabled=true;$("qmImportPreviewHost").innerHTML="";
    $("qmImportMsg").textContent=file?`Fichier sélectionné : ${file.name}. Clique sur « Analyser le fichier » pour vérifier les correspondances.`:"";
  }
  function renderResultsImportPreview(){
    const host=$("qmImportPreviewHost");if(!host||!qcuImportPreview)return;
    const replace=$("qmImportReplace").checked;
    const rows=qcuImportPreview.rows;
    const counts={ok:0,absent:0,notEvaluated:0,unmatched:0,invalid:0,existing:0};
    rows.forEach(r=>{if(r.status==="ok"){counts.ok++;if(r.hasExisting&&!replace)counts.existing++;}else if(r.status==="absent")counts.absent++;else if(r.status==="not_evaluated")counts.notEvaluated++;else if(r.status==="unmatched")counts.unmatched++;else counts.invalid++;});
    host.innerHTML=`<div style="margin:10px 0;padding:10px;background:#fff;border:1px solid #ddd;border-radius:8px"><strong>Aperçu de l'import</strong><p>${rows.length} élève(s) · ${counts.ok} ligne(s) avec réponses · ${counts.absent} absence(s) · ${counts.notEvaluated} non évalué(s) · ${counts.unmatched} élève(s) non reconnu(s) · ${counts.invalid} ligne(s) à corriger.</p>${counts.existing?`<p style="color:#9a5b00">${counts.existing} résultat(s) existent déjà et seront ignorés. Coche l'option de remplacement si tu souhaites les écraser.</p>`:""}<div style="max-height:300px;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.88em"><thead><tr><th>Élève du fichier</th><th>Correspondance</th><th>Sujet 1</th><th>Sujet 2</th><th>Sujet 3</th><th>Sujet 4</th></tr></thead><tbody>${rows.map(r=>`<tr style="border-top:1px solid #ddd"><td>${esc(r.name)}</td><td>${esc(r.student?`${r.student.prenom||""} ${r.student.nom||""}`.trim():r.status==="unmatched"?"Non reconnu":"—")}</td>${r.subjects.map(x=>`<td>${esc(x.label)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
    const canImport=counts.unmatched===0&&counts.invalid===0&&(counts.ok>0||counts.absent>0);
    $("qmImportConfirmBtn").disabled=!canImport;
    $("qmImportMsg").textContent=canImport?"Vérifie l'aperçu puis valide l'import. Les lignes NON ÉVALUÉ restent inchangées.":"Corrige les élèves ou les réponses signalés avant de pouvoir importer.";
  }
  async function buildResultsImportPreview(){
    const file=$("qmResultsFile").files?.[0];
    if(!file||!session||!students.length)return $("qmImportMsg").textContent="Choisis d'abord une classe et une mémorisation, puis un fichier.";
    const btn=$("qmImportPreviewBtn");btn.disabled=true;$("qmImportMsg").textContent="Lecture du fichier et vérification des élèves…";
    try{
      const rawRows=await readResultsImportFile(file);
      const studentMap=new Map();
      for(const st of students){
        const candidates=[`${st.nom||""} ${st.prenom||""}`,`${st.prenom||""} ${st.nom||""}`].map(normalizeImportName).filter(Boolean);
        for(const key of candidates){if(!studentMap.has(key))studentMap.set(key,[]);studentMap.get(key).push(st);}
      }
      const keys=[1,2,3,4].map(n=>parseImportAnswers($("qmImportKey"+n).value));
      if(keys.some(k=>k.kind!=="answers"||k.answers.length!==5))throw new Error("Chaque corrigé doit contenir exactement cinq lettres A, B, C ou D.");
      const subjectRows=[];
      for(let n=1;n<=4;n++){
        const sub=subjects.find(x=>String(x.code)===String(n));
        if(!sub)throw new Error(`Le sujet ${n} est absent de cette mémorisation.`);
        const {data,error}=await client().from("qcu_sujet_questions").select("id,position").eq("sujet_id",sub.id).order("position");
        if(error)throw error;
        if((data||[]).length!==5)throw new Error(`Le sujet ${n} doit contenir cinq questions dans la mémorisation sélectionnée (actuellement ${(data||[]).length}).`);
        subjectRows.push({subject:sub,questions:data});
      }
      const rows=[];
      for(const source of rawRows){
        let matches=studentMap.get(normalizeImportName(source.name))||[];
        // Certains anciens exports abrègent le nom de famille (ex. « ARENAS H. »)
        // ou ajoutent un second élément au prénom : on tente alors une correspondance
        // prudente sur le prénom exact et le début du nom, uniquement si elle est unique.
        if(!matches.length){
          const sourceNorm=normalizeImportName(source.name),sourceWords=sourceNorm.split(" ");
          matches=students.filter(st=>{
            const first=normalizeImportName(st.prenom),last=normalizeImportName(st.nom).split(" ")[0];
            return first&&last&&sourceWords.includes(first)&&sourceWords[0]===last;
          });
        }
        const student=matches.length===1?matches[0]:null;
        const subjectsPreview=source.values.map((value,i)=>{
          const parsed=parseImportAnswers(value);
          if(parsed.kind==="answers"){
            const score=parsed.answers.reduce((sum,a,j)=>sum+(a===keys[i].answers[j]?1:0),0);
            return {kind:"answers",answers:parsed.answers,score,label:`${score}/5`};
          }
          if(parsed.kind==="absent")return {kind:"absent",label:"Absent"};
          if(parsed.kind==="not_evaluated")return {kind:"not_evaluated",label:"Non évalué"};
          return {kind:parsed.kind,label:parsed.kind==="empty"?"Vide":"Réponses invalides"};
        });
        let status=!student?"unmatched":subjectsPreview.some(x=>x.kind==="invalid"||x.kind==="empty")?"invalid":"ok";
        if(matches.length>1)status="unmatched";
        rows.push({line:source.line,name:source.name,student,status,subjects:subjectsPreview});
      }
      const studentIds=rows.filter(r=>r.student).map(r=>r.student.id);
      const existingByStudentSubject=new Set();
      if(studentIds.length){
        const subjectIds=subjectRows.map(x=>x.subject.id);
        const {data:attrs,error:ae}=await client().from("qcu_attributions").select("id,eleve_id,sujet_id").eq("session_id",session.id).in("eleve_id",studentIds).in("sujet_id",subjectIds);
        if(ae)throw ae;
        const attrIds=(attrs||[]).map(a=>a.id);
        if(attrIds.length){const {data:responses,error:re}=await client().from("qcu_reponses").select("attribution_id").in("attribution_id",attrIds);if(re)throw re;
          const responseAttrIds=new Set((responses||[]).map(x=>String(x.attribution_id)));
          for(const a of (attrs||[]))if(responseAttrIds.has(String(a.id)))existingByStudentSubject.add(`${a.eleve_id}|${a.sujet_id}`);
        }
      }
      for(const row of rows){
        if(!row.student)continue;
        row.subjects.forEach((sp,i)=>{const sub=subjectRows[i].subject;sp.hasExisting=existingByStudentSubject.has(`${row.student.id}|${sub.id}`);});
      }
      qcuImportPreview={rows,subjectRows,keys};renderResultsImportPreview();
    }catch(error){$("qmImportMsg").textContent="Analyse impossible : "+(error?.message||String(error));qcuImportPreview=null;$("qmImportConfirmBtn").disabled=true;}
    finally{btn.disabled=false;}
  }
  async function confirmResultsImport(){
    if(!qcuImportPreview||!session)return;
    const replace=$("qmImportReplace").checked;
    const btn=$("qmImportConfirmBtn");btn.disabled=true;$("qmImportPreviewBtn").disabled=true;
    const db=client(),user=window.qcuMemoUserId;let imported=0,absences=0,skipped=0,errors=[];
    try{
      for(const row of qcuImportPreview.rows){
        if(!row.student){skipped++;continue;}
        for(let i=0;i<4;i++){
          const sp=row.subjects[i],sub=qcuImportPreview.subjectRows[i];
          if(sp.kind==="not_evaluated"){skipped++;continue;}
          const {data:attr,error:ae}=await db.from("qcu_attributions").select("id,statut").eq("session_id",session.id).eq("sujet_id",sub.subject.id).eq("eleve_id",row.student.id).maybeSingle();
          if(ae){errors.push(`${row.name}, sujet ${i+1} : ${ae.message}`);continue;}
          if(!attr){errors.push(`${row.name}, sujet ${i+1} : attribution introuvable`);continue;}
          if(sp.kind==="absent"){
            const {error}=await db.from("qcu_attributions").update({statut:"absent"}).eq("id",attr.id);
            if(error)errors.push(`${row.name}, sujet ${i+1} : ${error.message}`);else absences++;
            continue;
          }
          if(sp.kind!=="answers"){skipped++;continue;}
          if(sp.hasExisting&&!replace){skipped++;continue;}
          const now=new Date().toISOString();
          const answerRows=sub.questions.map((q,j)=>({created_by:user,attribution_id:attr.id,sujet_id:sub.subject.id,sujet_question_id:q.id,scan_id:null,selected_options:[sp.answers[j]],statut:sp.answers[j]===qcuImportPreview.keys[i].answers[j]?"correct":"incorrect",is_correct:sp.answers[j]===qcuImportPreview.keys[i].answers[j],verification_manuelle:true,reviewed_by:user,reviewed_at:now}));
          const {error:upErr}=await db.from("qcu_reponses").upsert(answerRows,{onConflict:"attribution_id,sujet_question_id"});
          if(upErr){errors.push(`${row.name}, sujet ${i+1} : ${upErr.message}`);continue;}
          const {error:atErr}=await db.from("qcu_attributions").update({statut:"corrige"}).eq("id",attr.id);
          if(atErr){errors.push(`${row.name}, sujet ${i+1} : réponses enregistrées mais statut non actualisé (${atErr.message})`);continue;}
          imported++;
        }
      }
      await loadSubjectRoster();
      $("qmImportMsg").textContent=`Import terminé : ${imported} sujet(s) importé(s), ${absences} absence(s) enregistrée(s), ${skipped} élément(s) ignoré(s). ${errors.length?`${errors.length} erreur(s) : ${errors.slice(0,4).join(" ; ")}`:"Aucune erreur."}`;
      if(errors.length)console.error("Erreurs import QCU",errors);
      $("qmImportConfirmBtn").disabled=true;
    }catch(error){$("qmImportMsg").textContent="Import interrompu : "+(error?.message||String(error));btn.disabled=false;}
    finally{$("qmImportPreviewBtn").disabled=false;}
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
    if($("qmScanStatus"))$("qmScanStatus").textContent="Réponses enregistrées. Présente la fiche suivante devant la caméra.";
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