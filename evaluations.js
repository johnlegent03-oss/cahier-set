function getMasteryFromValidatedCriteria(validatedCount){
  const n=Number(validatedCount)||0;
  if(n>=4)return {code:"TBM",label:"Très bonne maîtrise",cls:"tbm"};
  if(n===3)return {code:"MS",label:"Maîtrise satisfaisante",cls:"ms"};
  if(n===2)return {code:"MF",label:"Maîtrise fragile",cls:"mf"};
  return {code:"MI",label:"Maîtrise insuffisante",cls:"mi"};
}
;
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,storage:window.sessionStorage}});
let mfaBusy = false;
let mfaCheckPromise = null;
let mfaAuthGeneration = 0;

function mfaRender(title, html) {
  label.textContent = "Espace professeur";
  logoutBtn?.classList.add("hidden");
  globalHome?.classList.remove("show");
  content.innerHTML = `
    <section class="hero login">
      <span class="eyebrow">Espace sécurisé</span>
      <h2>${title}</h2>
      ${html}
      <div style="margin-top:12px"><button id="mfaLogoutBtn" type="button">Se déconnecter</button></div>
    </section>
  `;
  document.getElementById("mfaLogoutBtn")?.addEventListener("click", mfaSignOut);
}

function mfaIsCurrent(generation, userId) {
  return generation === mfaAuthGeneration && String(user?.id || "") === String(userId || "");
}

function mfaHideProfSpace() {
  logoutBtn?.classList.add("hidden");
  globalHome?.classList.remove("show");
}

function mfaShowFailure(error, generation = mfaAuthGeneration) {
  if (generation !== mfaAuthGeneration) return;
  console.error("Vérification MFA impossible :", error);
  mfaRender("Vérification en deux étapes impossible", `
    <p class="muted">${esc(error?.message || String(error) || "Une erreur inconnue est survenue.")}</p>
    <p class="small-note">L’espace Évaluations reste verrouillé. Tu peux réessayer ou te déconnecter.</p>
    <button id="mfaRetryBtn" class="primary" type="button">Réessayer</button>
  `);
  const retry = document.getElementById("mfaRetryBtn");
  retry?.addEventListener("click", () => {
    if (mfaCheckPromise) return;
    retry.disabled = true;
    retry.textContent = "Vérification…";
    openProfSpaceIfMfaReady();
  });
}

function mfaRequestLogin(message = "Aucune session active ou session expirée. Reconnecte-toi pour continuer.") {
  user = null;
  mfaHideProfSpace();
  login(message);
}

async function mfaSignOut() {
  if (!correctionAllowLeave()) return;
  mfaAuthGeneration++;
  mfaCheckPromise = null;
  try {
    const { error } = await sb.auth.signOut();
    if (error) throw error;
    user = null;
    mfaHideProfSpace();
    login("Tu es déconnecté. Connecte-toi pour continuer.");
  } catch (error) {
    mfaShowFailure(error);
  }
}

async function mfaHandleVerificationError(error, status, button, generation, userId) {
  let sessionResult;
  try {
    sessionResult = await sb.auth.getSession();
  } catch (sessionError) {
    if (mfaIsCurrent(generation, userId)) mfaRequestLogin("Ta session n’a pas pu être vérifiée. Reconnecte-toi pour continuer.");
    return;
  }
  if (!mfaIsCurrent(generation, userId)) return;
  if (sessionResult.error || !sessionResult.data?.session?.user || String(sessionResult.data.session.user.id) !== String(userId)) {
      mfaRequestLogin("Aucune session active ou session expirée. Reconnecte-toi pour continuer.");
    return;
  }
  status.textContent = "Code incorrect ou vérification indisponible : " + (error?.message || String(error)) + " Tu peux réessayer sans te déconnecter.";
  button.disabled = false;
}

async function mfaGetAal() {
  const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new Error(error.message);
  return data;
}

async function mfaGetVerifiedFactor() {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  return (data?.totp || []).find(f => f.status === "verified") || null;
}

function mfaEnterProfSpace(generation, userId) {
  if (!mfaIsCurrent(generation, userId)) return;
  logoutBtn?.classList.remove("hidden");
  globalHome?.classList.add("show");
  // À chaque nouvelle ouverture de session, repartir de l’accueil.
  // Les données pédagogiques et les brouillons restent conservés séparément.
  home();
}

async function mfaShowEnrollment(generation, userId) {
  if (mfaBusy) return;
  mfaBusy = true;

  try {
    const { data, error } = await sb.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Espace professeur"
    });
    if (error) throw new Error(error.message);
    if (!mfaIsCurrent(generation, userId)) return;

    const qr = data?.totp?.qr_code || "";
    const secret = data?.totp?.secret || "";
    const factorId = data?.id;

    mfaRender("Active la double validation", `
      <p class="muted">Scanne ce QR code avec Google Authenticator, Authy ou l’application Authenticator de ton téléphone.</p>
      <div style="text-align:center;margin:16px 0;">
        ${qr ? `<img src="${qr}" alt="QR code MFA" style="max-width:240px;width:100%;background:#fff;padding:10px;border-radius:12px;">` : ""}
      </div>
      ${secret ? `<p class="small-note">Si tu ne peux pas scanner, entre cette clé dans l’application :<br><code>${secret}</code></p>` : ""}
      <div class="editbox">
        <label>Code à 6 chiffres</label>
        <input id="mfaCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">
        <button id="mfaVerifyBtn" class="primary" style="width:100%;margin-top:5px;">Valider</button>
      </div>
      <div id="mfaStatus" class="status" style="margin-top:10px;"></div>
    `);

    document.getElementById("mfaVerifyBtn").onclick = async () => {
      const code = document.getElementById("mfaCode").value.trim();
      const status = document.getElementById("mfaStatus");
      const btn = document.getElementById("mfaVerifyBtn");

      if (!/^\d{6}$/.test(code)) {
        status.textContent = "Entre les 6 chiffres affichés par l’application.";
        return;
      }

      btn.disabled = true;
      status.textContent = "Vérification…";

      try {
        const { error } = await sb.auth.mfa.challengeAndVerify({
          factorId,
          code
        });
        if (error) throw new Error(error.message);

        status.textContent = "Double validation activée.";
        mfaEnterProfSpace(generation, userId);
      } catch (e) {
        await mfaHandleVerificationError(e, status, btn, generation, userId);
      }
    };
  } catch (e) {
    mfaShowFailure(e, generation);
  } finally {
    mfaBusy = false;
  }
}

async function mfaShowChallenge(factor, generation, userId) {
  if (!factor) {
    await mfaShowEnrollment(generation, userId);
    return;
  }

  mfaRender("Validation en deux étapes", `
    <p class="muted">Entre le code à 6 chiffres généré par ton application d’authentification.</p>
    <div class="editbox">
      <label>Code à 6 chiffres</label>
      <input id="mfaCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">
      <button id="mfaVerifyBtn" class="primary" style="width:100%;margin-top:5px;">Valider</button>
    </div>
    <div id="mfaStatus" class="status" style="margin-top:10px;"></div>
  `);

  document.getElementById("mfaVerifyBtn").onclick = async () => {
    const code = document.getElementById("mfaCode").value.trim();
    const status = document.getElementById("mfaStatus");
    const btn = document.getElementById("mfaVerifyBtn");

    if (!/^\d{6}$/.test(code)) {
      status.textContent = "Entre les 6 chiffres affichés par l’application.";
      return;
    }

    btn.disabled = true;
    status.textContent = "Vérification…";

    try {
      const { error } = await sb.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code
      });
      if (error) throw new Error(error.message);

      mfaEnterProfSpace(generation, userId);
    } catch (e) {
      await mfaHandleVerificationError(e, status, btn, generation, userId);
    }
  };
}

async function checkProfSpaceIfMfaReady(generation) {
  let data, error;
  try {
    ({ data, error } = await sb.auth.getSession());
  } catch (sessionError) {
    if (generation === mfaAuthGeneration) mfaRequestLogin("Ta session n’a pas pu être vérifiée. Reconnecte-toi pour continuer.");
    return;
  }
  if (generation !== mfaAuthGeneration) return;
  const currentUser = data?.session?.user || null;
  if (error || !currentUser) {
    mfaRequestLogin("Ta session a expiré ou n’est plus disponible. Reconnecte-toi pour continuer.");
    return;
  }
  user = currentUser;
  const userId = currentUser.id;

  try {
    const factor = await mfaGetVerifiedFactor();
    if (!mfaIsCurrent(generation, userId)) return;

    if (!factor) {
      await mfaShowEnrollment(generation, userId);
      return;
    }

    const aal = await mfaGetAal();
    if (!mfaIsCurrent(generation, userId)) return;

    if (aal.currentLevel !== "aal2") {
      await mfaShowChallenge(factor, generation, userId);
      return;
    }

    mfaEnterProfSpace(generation, userId);
  } catch (e) {
    mfaShowFailure(e, generation);
  }
}

function openProfSpaceIfMfaReady() {
  if (mfaCheckPromise) return mfaCheckPromise;
  const generation = mfaAuthGeneration;
  const request = checkProfSpaceIfMfaReady(generation).finally(() => {
    if (mfaCheckPromise === request) mfaCheckPromise = null;
  });
  mfaCheckPromise = request;
  return request;
}
const CLASSES={"6e":["6e1","6e2","6e3","6e4","6e5"],"5e":["5e1","5e3","5e5"],"3e":["3e2","3e3"]};
const content=document.getElementById("content"),label=document.getElementById("label"),logoutBtn=document.getElementById("logoutBtn"),globalHome=document.getElementById("globalHome");
let user=null;
let currentCorrectionEvaluation=null;
  function masteryForCompetencyQuestions(criteria, criteriaStats){
  const questions={};
  (criteria||[]).forEach(cr=>{
    const questionKey=String(
      cr.questionId ||
      `q${cr.questionNumero||1}`
    );
    if(!questions[questionKey]){
      questions[questionKey]={
        questionNumero:Number(cr.questionNumero||1),
        criteres:[]
      };
    }
    questions[questionKey].criteres.push(cr);
  });
  const occurrences=Object.values(questions).map(q=>{
    const validated=q.criteres.filter(cr=>
      !!criteriaStats?.[cr.id]?.validated
    ).length;
    const mastery=getMasteryFromValidatedCriteria(validated);
    return {
      questionNumero:q.questionNumero,
      validated,
      total:q.criteres.length,
      mastery
    };
  });
  const values=occurrences
    .map(x=>masteryValue(x.mastery.code))
    .filter(Number.isFinite);
  const average=values.length
    ?values.reduce((a,b)=>a+b,0)/values.length
    :null;
  return {
    occurrences,
    average,
    mastery:masteryFromAverage(average)
  };
}
const EVAL_NAV_KEY="cahierSVT.prof.evaluations.navigation.v1";
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const safe=v=>v==null?"":String(v);
function jsArg(v){
  const x=String(v??"")
    .replace(/\\/g,"\\\\")
    .replace(/\r/g,"\\r")
    .replace(/\n/g,"\\n")
    .replace(/\t/g,"\\t")
    .replace(/'/g,"\\'");
  return "&#39;"+x.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")+"&#39;";
}
function showError(msg){content.innerHTML='<section class="hero error"><h2>⚠️ Une erreur est survenue</h2><p>'+esc(msg)+'</p><button onclick="restoreLastPosition()">Retour</button></section>'}
document.addEventListener("input",e=>{if(e.target.matches(".pp-grade[data-discipline=\"Physique-Chimie\"],.pp-grade[data-discipline=\"SVT\"]"))ppUpdateScienceAverage()});
/* =========================================================
   MODULE ÉVALUATIONS / CORRECTIONS — V1
   Les données de correction utilisent des tables Supabase
   séparées du cahier. L'interface reste uniquement dans
   prof.html : aucune donnée n'est exposée à l'interface élève.
   ========================================================= */
let evaluationsCache=[];
let studentTrackingCache=[];
let studentTrackingQCUCache=[];
let studentTrackingQCUError="";
let studentTrackingClass="";
let studentTrackingReturnToClass=false;
let studentTrackingStudent="";
let studentTrackingStudentId="";
let studentTrackingPeriod="year";
let behaviorEventsCache=[];
function behaviorUnavailable(){alert("Le suivi comportemental n'est pas disponible : vérifie le chargement de behavior-supabase.js. Aucune observation n'a été enregistrée.");}
window.loadBehaviorEvents=()=>behaviorEventsCache;
window.addBehaviorEvent=behaviorUnavailable;
window.addBehaviorEventToSelected=behaviorUnavailable;
window.deleteBehaviorEvent=behaviorUnavailable;
let behaviorStudentsCache=[];
let classTrackingPeriod="year";
let classTrackingClass="";
function classAverageInclusionKey(studentId){return `svt_class_average_include_${String(studentId||"")}`;}
function classAverageStudentIncluded(studentId){
  if(!studentId)return true;
  try{return localStorage.getItem(classAverageInclusionKey(studentId))!=="0";}catch(e){return true;}
}
function saveClassAverageInclusion(checkbox){
  const studentId=String(checkbox?.dataset?.studentId||"");
  if(!studentId)return;
  try{localStorage.setItem(classAverageInclusionKey(studentId),checkbox.checked?"1":"0");}
  catch(e){alert("Impossible d'enregistrer ce réglage sur cet appareil : "+(e?.message||e));return;}
  updateClassAverageInView();
}
function updateClassAverageInView(){
  const tableRows=[...document.querySelectorAll(".class-tracking-row")];
  const included=tableRows.filter(row=>row.querySelector(".class-average-include")?.checked)
    .map(row=>row.dataset.studentAverage===""?null:Number(row.dataset.studentAverage)).filter(Number.isFinite);
  const average=included.length?included.reduce((a,b)=>a+b,0)/included.length:null;
  const output=document.getElementById("class-tracking-average");
  if(output)output.textContent=average===null?"—":`${average.toFixed(2).replace(".",",")} / 20`;
  tableRows.forEach(row=>{
    const checkbox=row.querySelector(".class-average-include");
    const cell=row.querySelector(".class-tracking-position");
    const value=row.dataset.studentAverage===""?null:Number(row.dataset.studentAverage);
    if(!cell)return;
    if(!checkbox?.checked){cell.textContent="Non comptabilisé";return;}
    if(!Number.isFinite(value)||average===null){cell.textContent="—";return;}
    cell.textContent=value>average+0.05?"🟢 Au-dessus":value<average-0.05?"🔴 En dessous":"⚪ Dans la moyenne";
  });
  updateClassQuarterReport();
}
let studentsCache=[];
let competenciesCache=[];
let currentCorrectionGroupIds=[];
function isHistoricalEvaluation(e){
  return !!(e && Array.isArray(e.exercices) && e.exercices.some(x=>x&&x.historique===true));
}
function historicalMeta(e){
  const x=(Array.isArray(e?.exercices)?e.exercices:[]).find(v=>v&&v.historique===true)||{};
  return {
    date:x.date||e?.created_at||null,
    competence:safe(x.competence||"Compétence non renseignée")
  };
}
function evalNormalize(e){
  const x=e&&typeof e==="object"?e:{};
  const meta=Array.isArray(x.exercices)
    ?x.exercices.find(v=>v&&v.__evaluationMeta)
    :null;
  const assignedClasses=(()=>{
    const a=Array.isArray(meta?.classes)
      ?meta.classes
          .map(v=>String(v||"").trim())
          .filter(Boolean)
      :[];
    return [...new Set(
      a.length
        ?a
        :[safe(x.classe||"")].filter(Boolean)
    )];
  })();
  /*
   * Nouvelle structure :
   * les questions sont enregistrées dans __evaluationMeta.questions.
   *
   * Si elles existent, on les reconstruit à partir des critères
   * enregistrés avec leur questionId / questionNumero.
   */
  let competences=[];
  if(Array.isArray(meta?.questions) && meta.questions.length){
    const criteres=Array.isArray(x.criteres)
      ?x.criteres
      :[];
    competences=meta.questions.map((q,qi)=>{
      const questionId=String(
        q.id||`comp${qi+1}`
      );
      const questionCriteres=criteres
        .filter(cr=>String(
          cr.questionId||cr.competenceId||""
        )===questionId)
        .map(cr=>({
          ...cr,
          competenceId:questionId,
          competenceNom:safe(
            cr.competenceNom||q.nom||""
          )
        }));
      return {
        id:questionId,
        nom:safe(
          q.nom||"Compétence non renseignée"
        ),
        bankId:q.bankId||null,
        questionNumero:Number(
          q.questionNumero||qi+1
        ),
        criteres:questionCriteres
      };
    });
  }else if(Array.isArray(x.competences) && x.competences.length){
    /*
     * Compatibilité avec les évaluations déjà enregistrées
     * avec l'ancienne structure.
     */
    competences=x.competences;
  }else{
    /*
     * Compatibilité avec les anciennes évaluations
     * qui ne possédaient pas encore de tableau competences.
     */
    const crits=Array.isArray(x.criteres)
      ?x.criteres
      :[];
    const groups={};
    crits.forEach(cr=>{
      const id=cr.competenceId||"comp1";
      if(!groups[id]){
        groups[id]={
          id,
          nom:cr.competenceNom||"Compétence évaluée",
          criteres:[]
        };
      }
      groups[id].criteres.push(cr);
    });
    competences=Object.values(groups);
  }
  return {
  id:x.id||null,
  titre:safe(x.titre||"Nouvelle évaluation"),
  classe:safe(x.classe||""),
  assignedClasses,
  evaluationGroupId:safe(meta?.evaluationGroupId||""),
  atelierDocumentId:meta?.atelierDocumentId||null,
  // Informations pédagogiques de l'évaluation
  chapitre:Number(meta?.chapitre||0),
  typeEvaluation:safe(meta?.typeEvaluation||"evaluation"),
  coefficient:Number(
    meta?.coefficient ??
    (["activite","exercice"].includes(meta?.typeEvaluation) ? 0.5 : 1)
  ),
  total:Number(x.total||0),
    // Nouvelle structure question par question
    competences,
    // Conservation des critères pour compatibilité
    criteres:Array.isArray(x.criteres)
      ?x.criteres
      :[],
    exercices:Array.isArray(x.exercices)
      ?x.exercices
      :[],
    created_at:x.created_at||null
  };
}
function criterionDefaults(){
  return [
    {id:"c1",nom:"Choix adaptés",indicateurs:[]},
    {id:"c2",nom:"Qualité du travail",indicateurs:[]},
    {id:"c3",nom:"Travail complet",indicateurs:[]},
    {id:"c4",nom:"Respect des consignes",indicateurs:[]}
  ];
}
function normalizeCriteria(ev){
  let crits=Array.isArray(ev.criteres)?ev.criteres:[];
  if(!crits.length) crits=criterionDefaults();
  return crits.map((c,i)=>({
    id:safe(c.id)||`c${i+1}`,
    nom:safe(c.nom)||`Critère ${i+1}`,
    /*
     * Informations permettant de rattacher
     * le critère à sa question.
     */
    questionId:safe(c.questionId||""),
    questionNumero:Number(c.questionNumero||0),
    competenceId:safe(c.competenceId||"comp1"),
    competenceNom:safe(c.competenceNom||""),
    indicateurs:
      Array.isArray(c.indicateurs)
        ?c.indicateurs
        :[]
  }));
}
function criteriaFromLegacy(ev){
  // Migration douce de la V1 : les anciens éléments/exercices sont convertis
  // en indicateurs rattachés à leur critère quand leur identifiant est connu.
  const crits=normalizeCriteria(ev);
  if(crits.some(c=>c.indicateurs.length)) return crits;
  const oldMap={choix:0,qualite:1,completude:2,consignes:3};
  const legacy=Array.isArray(ev.exercices)?ev.exercices:[];
  legacy.forEach(ex=>{
    (Array.isArray(ex.items)?ex.items:[]).forEach(it=>{
      const ids=Array.isArray(it.criteres)?it.criteres:[];
      const target=ids.map(id=>oldMap[id]).filter(i=>Number.isInteger(i));
      const indices=target.length?target:[0];
      indices.forEach((ci)=>{
        if(crits[ci]) crits[ci].indicateurs.push({nom:safe(it.nom),points:Number(it.points||0)});
      });
    });
  });
  return crits;
}
// Cache court + mutualisation des chargements : évite de relancer les mêmes requêtes
// quand on ouvre plusieurs fois les vues de suivi en peu de temps.
let studentTrackingLoadPromise=null;
let studentTrackingLoadedAt=0;
let studentTrackingQCULoadPromise=null;
let studentTrackingQCULoadedAt=0;
const TRACKING_CACHE_TTL=60000;
async function loadStudentTracking(){
  if(studentTrackingCache.length && Date.now()-studentTrackingLoadedAt<TRACKING_CACHE_TTL) return studentTrackingCache;
  if(studentTrackingLoadPromise) return studentTrackingLoadPromise;
  studentTrackingLoadPromise=loadStudentTrackingFresh();
  try{
    const result=await studentTrackingLoadPromise;
    studentTrackingLoadedAt=Date.now();
    return result;
  }finally{studentTrackingLoadPromise=null;}
}
async function loadStudentTrackingFresh(){
  // Supabase limite chaque réponse ; charger toutes les corrections par pages.
  const data=[];
  const pageSize=1000;
  for(let from=0;;from+=pageSize){
    const {data:page,error}=await sb.from("EvaluationCorrections")
      .select("id,evaluation_id,eleve,eleve_id,resultat,created_at")
      .order("created_at",{ascending:true})
      .order("id",{ascending:true})
      .range(from,from+pageSize-1);
    if(error)throw new Error(error.message);
    const batch=page||[];
    data.push(...batch);
    if(batch.length<pageSize)break;
  }
  if(!studentsCache.length){
    const {data:students,error:studentsError}=await sb.from("Eleves").select("id,classe,nom,prenom,created_at").order("nom").order("prenom");
    if(studentsError)throw new Error(studentsError.message);
    studentsCache=students||[];
  }
  const studentById=new Map(studentsCache.map(st=>[String(st.id),st]));
  const normalizeStudentName=(value)=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[-']/g," ").replace(/\s+/g," ").trim().toLocaleLowerCase("fr");
  const studentAliases=new Map();
  studentsCache.forEach(st=>{
    const nom=safe(st?.nom||"").trim(), prenom=safe(st?.prenom||"").trim();
    const aliases=[`${nom} ${prenom}`,`${prenom} ${nom}`,nom,prenom].map(normalizeStudentName).filter(Boolean);
    aliases.forEach(a=>{if(a&&!studentAliases.has(a))studentAliases.set(a,st);});
  });
  const byId={};
  evaluationsCache.forEach(e=>byId[String(e.id)]=e);
  studentTrackingCache=(data||[]).map(c=>{
    let st=c.eleve_id?studentById.get(String(c.eleve_id)):null;
    const fallback=safe(c.eleve||"Élève").trim()||"Élève";
    if(!st){
      const evalClass=String(byId[String(c.evaluation_id)]?.classe||"").trim();
      const candidate=studentAliases.get(normalizeStudentName(fallback));
      if(candidate && (!evalClass || String(candidate.classe||"").trim()===evalClass)) st=candidate;
    }
    const nom=safe(st?.nom||"").trim();
    const prenom=safe(st?.prenom||"").trim();
    const display=nom ? `${nom} ${prenom}`.trim() : fallback;
    return {
      id:c.id,
      evaluationId:c.evaluation_id,
      eleve:display,
      eleveId:c.eleve_id||null,
      nom,
      prenom,
      sortKey:nom ? `${nom} ${prenom}`.toLocaleLowerCase("fr") : fallback.toLocaleLowerCase("fr"),
      resultat:c.resultat||{},
      created_at:c.created_at||null,
      evaluation:byId[String(c.evaluation_id)]||null
    };
  }).filter(x=>x.evaluation);
  return studentTrackingCache;
}
function evaluationAppliesToClass(ev,classe){
  const target=String(classe||"").trim();
  if(!target)return true;
  const assigned=Array.isArray(ev?.assignedClasses)
    ? ev.assignedClasses.map(v=>String(v||"").trim()).filter(Boolean)
    : [];
  return assigned.length
    ? assigned.includes(target)
    : String(ev?.classe||"").trim()===target;
}
  function correctionAppliesToClass(c,classe){
  const target=String(classe||"").trim();
  if(!target)return true;
  const studentId=String(c?.eleveId||"").trim();
  if(studentId){
    const student=studentsCache.find(
      s=>String(s?.id||"").trim()===studentId
    );
    if(student){
      return String(student.classe||"").trim()===target;
    }
  }
  return evaluationAppliesToClass(c?.evaluation,target);
}
function trackingPeriodLabel(period){
  return period==="t1"?"Trimestre 1":period==="t2"?"Trimestre 2":period==="t3"?"Trimestre 3":"Année";
}
function trackingRecordDate(c){
  return isHistoricalEvaluation(c?.evaluation)?historicalMeta(c.evaluation).date:(c?.created_at||null);
}
function trackingEvaluationGroupId(ev){
  const meta=(Array.isArray(ev?.exercices)?ev.exercices:[]).find(x=>x&&x.__evaluationMeta);
  return String(ev?.evaluationGroupId||meta?.evaluationGroupId||`item_${ev?.id||"unknown"}`);
}
function trackingUniqueGroupedRows(rows){
  const selected=new Map();
  (rows||[]).forEach(c=>{
    const student=String(c?.eleveId||c?.eleve||"").trim();
    const key=`${student}::${trackingEvaluationGroupId(c?.evaluation)}`;
    const previous=selected.get(key);
    const currentTime=new Date(c?.created_at||0).getTime()||0;
    const previousTime=new Date(previous?.created_at||0).getTime()||0;
    // Si plusieurs versions alternatives ont été corrigées pour le même élève,
    // une seule note est retenue : la correction la plus récente.
    if(!previous||currentTime>=previousTime)selected.set(key,c);
  });
  return [...selected.values()];
}
function trackingScore20(c){
  const r=c?.resultat||{}, ev=c?.evaluation||{};
  // Une valeur absente, null ou vide n'est jamais une note de zéro.
  // En revanche, le nombre 0 explicitement enregistré reste une vraie note.
  const rawNote=r.note;
  if(rawNote===null || rawNote===undefined || rawNote==="")return null;
  const note=Number(rawNote);
  if(!Number.isFinite(note))return null;
  const total=Number(ev.total||0);
  if(total>0)return note/total*20;
  return null;
}
function trackingNoteLabel(c){
  const r=c?.resultat||{}, ev=c?.evaluation||{};
  const note=Number(r.note);
  if(!Number.isFinite(note))return "—";
  const total=Number(ev.total||0);
  return total>0 ? `${note} / ${total}` : `${note}`;
}
function formatAverage20(values){
  const nums=values.filter(v=>Number.isFinite(v));
  if(!nums.length)return "—";
  const avg=nums.reduce((a,b)=>a+b,0)/nums.length;
  return `${avg.toFixed(2).replace(".",",")} / 20`;
}
function normalizeTrackingDate(dateValue){
  if(!dateValue)return null;
  const s=String(dateValue).trim();
  const m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if(m){
    const dd=String(m[1]).padStart(2,"0"),mm=String(m[2]).padStart(2,"0"),yyyy=m[3];
    return `${yyyy}-${mm}-${dd}T12:00:00`;
  }
  return s;
}
function schoolYearStartYear(dateValue=new Date()){
  const d=dateValue instanceof Date?dateValue:new Date(dateValue);
  if(Number.isNaN(d.getTime()))return new Date().getFullYear()-(new Date().getMonth()+1<9?1:0);
  const y=d.getFullYear(),m=d.getMonth()+1;
  return m>=9?y:y-1;
}
// Calendrier scolaire centralisé : les bornes sont inclusives.
const SVT_TRIMESTER_CALENDAR = Object.freeze({
  t1:{startMonth:9,startDay:1,endMonth:11,endDay:20},
  t2:{startMonth:11,startDay:21,endMonth:2,endDay:12},
  t3:{startMonth:2,startDay:13,endMonth:6,endDay:30}
});
window.SVT_TRIMESTER_CALENDAR = SVT_TRIMESTER_CALENDAR;
function trackingPeriodRange(period,dateValue=new Date()){
  if(period==="year")return {start:null,end:null};
  const y=schoolYearStartYear(dateValue);
  const p=SVT_TRIMESTER_CALENDAR[period];
  if(!p)return {start:null,end:null};
  const startYear=p.startMonth>=9?y:y+1;
  const endYear=p.endMonth>=9?y:y+1;
  return {
    start:new Date(startYear,p.startMonth-1,p.startDay,0,0,0,0),
    end:new Date(endYear,p.endMonth-1,p.endDay,23,59,59,999)
  };
}
function trackingPeriodForDate(dateValue){
  if(!dateValue)return "year";
  const d=new Date(normalizeTrackingDate(dateValue));
  if(Number.isNaN(d.getTime()))return "year";
  for(const period of ["t1","t2","t3"]){
    const range=trackingPeriodRange(period,d);
    if(d>=range.start&&d<=range.end)return period;
  }
  return "year";
}
window.SVT_periodForDate=trackingPeriodForDate;
function trackingPeriodMatch(dateValue,period){
  if(period==="year")return true;
  if(!dateValue)return false;
  const d=new Date(normalizeTrackingDate(dateValue));
  if(Number.isNaN(d.getTime()))return false;
  const range=trackingPeriodRange(period,new Date());
  return (!range.start||d>=range.start)&&(!range.end||d<=range.end);
}
function trackingDate(dateValue){
  if(!dateValue)return "Date non renseignée";
  const d=new Date(normalizeTrackingDate(dateValue));
  if(Number.isNaN(d.getTime()))return "Date non renseignée";
  return d.toLocaleDateString("fr-FR");
}
function trackingRows(){
  return trackingUniqueGroupedRows(studentTrackingCache.filter(c=>{
    const date=trackingRecordDate(c);
    return correctionAppliesToClass(c,studentTrackingClass)
      &&(!studentTrackingStudentId ? (!studentTrackingStudent||c.eleve===studentTrackingStudent) : String(c.eleveId||"")===String(studentTrackingStudentId))
      &&trackingPeriodMatch(date,studentTrackingPeriod);
  })).sort((a,b)=>{
    const ad=trackingRecordDate(a),bd=trackingRecordDate(b);
    const da=ad?new Date(ad).getTime():0,db=bd?new Date(bd).getTime():0;
    return da-db;
  });
}
function trackingStudentOptions(){
  const out=new Map();
  const targetClass=String(studentTrackingClass||"").trim();
  studentsCache.filter(s=>!targetClass||String(s.classe||"").trim()===targetClass).forEach(s=>{
    if(!s?.id)return;
    out.set(String(s.id),{id:String(s.id),name:studentDisplayName(s)});
  });
  studentTrackingCache.filter(c=>correctionAppliesToClass(c,targetClass)).forEach(c=>{
    const id=c.eleveId?String(c.eleveId):"";
    if(id&&!out.has(id))out.set(id,{id,name:c.eleve||"Élève"});
  });
  return [...out.values()].filter(x=>x.name).sort((a,b)=>a.name.localeCompare(b.name,"fr",{numeric:true,sensitivity:"base"}));
}
function normalizeTrackingStudentName(value){
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[-']/g," ").replace(/\s+/g," ").trim().toLocaleLowerCase("fr");
}
function trackingCompetencyRows(rows){
  const out=[];
  rows.forEach(c=>{
    const ev=c.evaluation, stats=c.resultat?.criteriaStats||{};
    if(isHistoricalEvaluation(ev)){
      const meta=historicalMeta(ev);
      const masteryCode=c.resultat?.masteryCode||"";
      const mastery=masteryCode?getMasteryByCode(masteryCode):null;
      if(mastery){
        out.push({date:meta.date,evaluation:ev.titre,competence:meta.competence||"Compétence non renseignée",validated:null,total:null,mastery});
      }
      return;
    }
    const crits=criteriaFromLegacy(ev), groups={};
    crits.forEach(cr=>{
      const gid=cr.competenceId||"comp1";
      if(!groups[gid])groups[gid]={nom:cr.competenceNom||"Compétence évaluée",total:0,validated:0};
      groups[gid].total++;
      if(stats[cr.id]?.validated)groups[gid].validated++;
    });
    Object.values(groups).forEach(g=>{
      const mastery=getMasteryFromValidatedCriteria(g.validated);
      out.push({date:c.created_at,evaluation:ev.titre,competence:g.nom,validated:g.validated,total:g.total,mastery});
    });
  });
  return out;
}
function masteryValue(code){
  return ({TBM:4,MS:3,MF:2,MI:1})[String(code||"").toUpperCase()]||null;
}
function masteryFromAverage(value){
  const n=Number(value);
  if(!Number.isFinite(n))return null;
  if(n>=3.5)return getMasteryByCode("TBM");
  if(n>=2.5)return getMasteryByCode("MS");
  if(n>=1.5)return getMasteryByCode("MF");
  return getMasteryByCode("MI");
}
function formatMasteryAverage(value){
  const n=Number(value);
  return Number.isFinite(n)?`${n.toFixed(2).replace(".",",")} / 4`:"—";
}
function trackingSummary(rows){
  const total=rows.length;
  const competencies=trackingCompetencyRows(rows);
  const counts={TBM:0,MS:0,MF:0,MI:0};
  competencies.forEach(x=>counts[x.mastery.code]=(counts[x.mastery.code]||0)+1);
  const byComp={};
  competencies.forEach(x=>{
    const key=String(x.competence||"Compétence non renseignée");
    if(!byComp[key])byComp[key]=[];
    byComp[key].push(x);
  });
  const competencySummaries=Object.entries(byComp).map(([competence,items])=>{
    const values=items.map(x=>masteryValue(x.mastery?.code)).filter(Number.isFinite);
    const average=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
    const ordered=[...items].sort((a,b)=>{
      const da=a.date?new Date(normalizeTrackingDate(a.date)).getTime():0;
      const db=b.date?new Date(normalizeTrackingDate(b.date)).getTime():0;
      return da-db;
    });
    const latest=ordered[ordered.length-1]||items[items.length-1];
    return {competence,evaluations:items.length,average,averageMastery:masteryFromAverage(average),latest};
  }).sort((a,b)=>a.competence.localeCompare(b.competence,"fr"));
  return {total,competencies,counts,competencySummaries};
}
async function loadBehaviorStudents(){
  // Toujours recharger la liste depuis Supabase : le suivi du comportement
  // peut être ouvert directement, sans être passé par la banque d'élèves.
  // Dans ce cas, studentsCache est vide et aucun élève ne serait affiché.
  const {data,error}=await sb.from("Eleves")
    .select("id,classe,nom,prenom")
    .order("classe").order("nom").order("prenom");
  if(error)throw new Error("Chargement des élèves impossible : "+error.message);
  studentsCache=data||[];

  // Source unique : la table Eleves (pas l'ancienne banque ProfessorStudents).
  const byId=new Map();
  (studentsCache||[]).forEach(s=>{
    if(!s?.id)return;
    const id=String(s.id);
    if(byId.has(id))return;
    byId.set(id,{
      id:s.id,
      classe:String(s.classe||"").trim(),
      nom:studentDisplayName(s)
    });
  });
  behaviorStudentsCache=[...byId.values()].sort((a,b)=>{
    const c=String(a.classe||"").localeCompare(String(b.classe||""),"fr",{numeric:true,sensitivity:"base"});
    return c||String(a.nom||"").localeCompare(String(b.nom||""),"fr",{numeric:true,sensitivity:"base"});
  });
  return behaviorStudentsCache;
}
const BEHAVIOR_TYPES=[
 {code:"bavardage",label:"Bavardage",icon:"💬",negative:true},
 {code:"oubli_materiel",label:"Oubli de matériel",icon:"🎒",negative:true},
 {code:"travail_non_fait",label:"Travail non fait",icon:"📚",negative:true},
 {code:"participation",label:"Participation",icon:"⭐",negative:false}
];
function behaviorMeta(code){
 const known=BEHAVIOR_TYPES.find(x=>x.code===code);if(known)return known;
 if(code==="message_envoye_bavardage")return {code,label:"Mot envoyé — bavardages",icon:"✉️",negative:false};
 if(code==="message_envoye_travail_materiel")return {code,label:"Mot envoyé — travail / matériel",icon:"✉️",negative:false};
 if(code==="mention_envoyee_participation")return {code,label:"Mention positive transmise",icon:"🌟",negative:false};
 return BEHAVIOR_TYPES[BEHAVIOR_TYPES.length-1];
}
function behaviorEventsForStudent(name,classe,period,studentId=""){
  return behaviorEventsCache.filter(e=>
    (!studentId ? e.student===name : (e.studentId&&String(e.studentId)===String(studentId))) &&
    (!classe||String(e.classe||"").trim()===String(classe||"").trim()) &&
    (period==="year"||trackingPeriodMatch(e.date,period))
  ).sort((a,b)=>new Date(b.date)-new Date(a.date));
}
function behaviorStudentsForClass(classe){
  const target=String(classe||"").trim();
  return behaviorStudentsCache.filter(s=>String(s.classe||"").trim()===target).sort((a,b)=>String(a.nom||"").localeCompare(String(b.nom||""),"fr",{numeric:true,sensitivity:"base"}));
}
function toggleAllBehaviorStudents(checked){document.querySelectorAll('.behavior-student-check').forEach(el=>{el.checked=checked;});}
function behaviorCounts(events){const out={};events.forEach(e=>out[e.type]=(out[e.type]||0)+1);return out;}
function behaviorSummary(events){const actual=events.filter(e=>!String(e.type||"").startsWith("message_envoye_")&&e.type!=="mention_envoyee_participation");const negative=actual.filter(e=>behaviorMeta(e.type).negative).length;return {negative,positive:actual.length-negative,total:actual.length};}
function behaviorDateInputValue(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function behaviorDateValue(value){const raw=String(value||behaviorDateInputValue()).trim();return /^\d{4}-\d{2}-\d{2}$/.test(raw)?`${raw}T12:00:00`:raw;}
function behaviorPeriodForDate(value){const d=new Date(behaviorDateValue(value));if(Number.isNaN(d.getTime()))return "year";for(const period of ["t1","t2","t3"]){const r=trackingPeriodRange(period,d);if(d>=r.start&&d<=r.end)return period;}return "year";}
const BEHAVIOR_MESSAGE_TYPES={bavardage:"message_envoye_bavardage",travail_materiel:"message_envoye_travail_materiel",participation:"mention_envoyee_participation"};
function behaviorCategory(type){if(type==="bavardage")return "bavardage";if(type==="oubli_materiel"||type==="travail_non_fait")return "travail_materiel";if(type==="participation")return "participation";return "";}
function behaviorEventOrder(event){
 const value=event?.createdAt||event?.created_at||event?.date;
 const time=new Date(value||0).getTime();
 return Number.isFinite(time)?time:0;
}
function behaviorThresholdForClass(classe,category){
 // Les observations négatives déclenchent un mot dès 3, quel que soit le niveau.
 if(category!=="participation")return 3;
 // Les participations positives restent proportionnées au temps de cours.
 const value=String(classe||"").toLocaleLowerCase("fr").replace(/\s+/g,"");
 if(/(^|[^0-9])(?:5|3)(?:e|eme|ème)/i.test(value))return 3;
 return 5; // 6e et classe non identifiée : seuil prudent de 5.
}
function behaviorStudentDashboard(student){
 const all=behaviorEventsCache.filter(e=>String(e.studentId)===String(student.id));
 const categories=["bavardage","travail_materiel","participation"];
 const labels={bavardage:"Bavardages",travail_materiel:"Travail / matériel",participation:"Participations positives"};
 return categories.map(category=>{
  const markerType=BEHAVIOR_MESSAGE_TYPES[category];
  const markers=all.filter(e=>e.type===markerType).sort((a,b)=>behaviorEventOrder(b)-behaviorEventOrder(a));
  const lastMarker=markers[0]||null;
  const observations=all.filter(e=>behaviorCategory(e.type)===category);
  // Le cycle repart après l'enregistrement de la communication, même si
  // l'observation et l'envoi portent la même date scolaire.
  const markerOrder=lastMarker?behaviorEventOrder(lastMarker):0;
  const since=observations.filter(e=>!lastMarker||behaviorEventOrder(e)>markerOrder);
  const threshold=behaviorThresholdForClass(student.classe,category);
  return {category,label:labels[category],total:observations.length,since:since.length,lastMarker,threshold};
 });
}
function prepareBehaviorMessage(studentId,category){
 const student=behaviorStudentsCache.find(s=>String(s.id)===String(studentId));
 if(!student){alert("Élève introuvable.");return;}
 const drafts={
  bavardage:`Bonjour,\n\nJe souhaite vous informer que ${student.nom} a atteint le seuil de ${behaviorThresholdForClass(student.classe,"bavardage")} observations pour des bavardages répétés en classe. Nous lui demandons de veiller davantage à son attention afin de favoriser son travail et celui du groupe.\n\nCordialement,`,
  travail_materiel:`Bonjour,\n\nJe souhaite vous informer que ${student.nom} a atteint le seuil de ${behaviorThresholdForClass(student.classe,"travail_materiel")} observations concernant le travail non fait ou le matériel oublié. Une attention particulière est nécessaire pour que le travail en classe puisse être réalisé dans de bonnes conditions.\n\nCordialement,`,
  participation:`${student.nom} s'est distingué(e) par ses participations positives et son investissement en classe. Nous tenions à souligner cette attitude encourageante.`
 };
 const title=category==="participation"?"Proposition de mention positive":"Proposition de mot aux parents";
 prompt(`${title} — tu peux sélectionner et copier le texte :`,drafts[category]||"");
}
async function recordBehaviorMessage(studentId,category){
 const student=behaviorStudentsCache.find(s=>String(s.id)===String(studentId));
 if(!student){alert("Élève introuvable.");return;}
 const date=document.getElementById("behaviorEventDate")?.value||behaviorDateInputValue();
 const type=BEHAVIOR_MESSAGE_TYPES[category];
 if(!type)return;
 const label=category==="participation"?"Mention positive transmise":"Mot envoyé aux parents";
 if(!confirm(`${label} pour ${student.nom} à la date du ${trackingDate(behaviorDateValue(date))} ?`))return;
 if(typeof window.addBehaviorMessageEvent!=="function"){
  alert("Enregistrement indisponible : vérifie le chargement du suivi comportemental.");
  return;
 }
 await window.addBehaviorMessageEvent(student,type,date,category==="participation"?"Mention positive transmise":"Mot envoyé sur École Directe");
 renderBehaviorTracking();
}
function behaviorPeriodName(period){return period==="t1"?"du 1er trimestre":period==="t2"?"du 2e trimestre":period==="t3"?"du 3e trimestre":"de l'année";}
function behaviorGenerateAppreciationLegacy(events,competencySummaries,rows=[],qcuRows=[]){
 const actual=(events||[]).filter(e=>!String(e.type||"").startsWith("message_envoye_")&&e.type!=="mention_envoyee_participation");
 const parts=[];
 const weightedAverage=studentTrackingScienceAverageDetails(rows||[],qcuRows||[],studentTrackingClass).final;
 const average=Number.isFinite(weightedAverage)?weightedAverage:null;
 const cs=(competencySummaries||[]).filter(x=>Number.isFinite(Number(x.average)));
 const masteryAverage=cs.length?cs.reduce((a,x)=>a+Number(x.average),0)/cs.length:null;
 const qcuAverage=studentTrackingQCUOverallAverage(qcuRows||[]);

 // Accroche fondée d'abord sur les résultats réellement disponibles.
 if(average!==null){
   if(average>=16)parts.push("Très bon trimestre.");
   else if(average>=14)parts.push("Bon trimestre.");
   else if(average>=12)parts.push("Trimestre satisfaisant.");
   else if(average>=10)parts.push("Trimestre assez satisfaisant, mais des progrès restent possibles.");
   else parts.push("Trimestre encore fragile.");
 }else if(masteryAverage!==null){
   if(masteryAverage>=3.5)parts.push("Très bon trimestre.");
   else if(masteryAverage>=2.7)parts.push("Trimestre satisfaisant.");
   else parts.push("Les acquis restent à consolider.");
 }

 // Synthèse globale de la maîtrise, sans citer de compétence particulière.
 if(masteryAverage!==null){
   if(masteryAverage>=3.5)parts.push("Les compétences scientifiques sont très bien maîtrisées.");
   else if(masteryAverage>=2.7)parts.push("Les compétences scientifiques sont globalement maîtrisées.");
   else if(masteryAverage>=2)parts.push("La maîtrise des compétences scientifiques reste inégale.");
   else parts.push("La maîtrise des compétences scientifiques demeure fragile.");
 }

 // La mémorisation est un indicateur complémentaire. Une session suffit pour
 // commenter le résultat, mais jamais pour conclure à une régularité de révision.
 if(qcuAverage!==null){
   if(qcuAverage>=16)parts.push("Les résultats en mémorisation active sont très satisfaisants.");
   else if(qcuAverage>=12)parts.push("Les résultats en mémorisation active sont encourageants.");
   else if(qcuAverage<10)parts.push("La mémorisation des connaissances évaluées reste à renforcer.");
 }

 const count=type=>actual.filter(e=>e.type===type).length;
 const participation=count("participation");
 const chatter=count("bavardage");
 const material=count("oubli_materiel");
 const workNotDone=count("travail_non_fait")+count("devoir_oublie");
 const efforts=count("effort_progres");
 if(participation>0)parts.push("La participation en classe est appréciable.");
 else parts.push("Une participation plus active en classe permettrait de valoriser davantage le travail et le raisonnement scientifique.");
 if(efforts>0)parts.push("Les efforts et les progrès sont à souligner.");
 if(chatter>=3)parts.push("Une attention plus régulière est attendue afin de limiter les bavardages.");
 if(material>=3)parts.push("Il faudra penser à apporter le matériel nécessaire avec davantage de régularité.");
 if(workNotDone>=3)parts.push("Le travail personnel doit gagner en régularité.");
 if(count("manque_ecoute")>=3)parts.push("Une meilleure attention aux consignes est attendue.");
 if(count("non_respect_consignes")>=3)parts.push("Les consignes doivent être davantage respectées.");

 // Conseil final individualisé, priorisant les fragilités objectivement observées.
 let advice="Poursuis ainsi en approfondissant tes raisonnements scientifiques.";
 const language=cs.find(x=>/ma[iî]trise de la langue/i.test(String(x.competence||"")));
 if(language&&Number(language.average)<2.5)advice="Reste attentif(ve) à la qualité de tes rédactions.";
 else if(masteryAverage!==null&&masteryAverage<2.5)advice="Consolide progressivement les notions étudiées et entraîne-toi à les mobiliser.";
 else if(average!==null&&average<12)advice="Un travail plus régulier et des révisions suivies t'aideront à progresser.";
 else if(qcuAverage!==null&&qcuAverage<10)advice="Revois régulièrement les connaissances pour mieux les mémoriser.";
 else if(participation===0)advice="N'hésite pas à prendre davantage la parole pour expliquer tes démarches.";
 else if(chatter>=3||material>=3||workNotDone>=3)advice="Veille à adopter une attitude plus régulière et mieux organisée face au travail.";
 parts.push(advice);

 // Limite stricte de 400 caractères, espaces compris. On retire d'abord les
 // compléments les moins prioritaires plutôt que de tronquer une phrase.
 const unique=[...new Set(parts)].join(" ").replace(/\s+/g," ").trim();
 if(unique.length<=400)return unique;
 const priority=[parts[0],parts.find(x=>/compétences scientifiques/.test(x)),parts.find(x=>/mémorisation/.test(x)),parts.find(x=>/participation/.test(x)),advice].filter(Boolean);
 let result="";
 for(const sentence of [...new Set(priority)]){
   const candidate=(result?result+" ":"")+sentence;
   if(candidate.length<=400)result=candidate;
 }
 if(result.length<=400)return result;
 return result.slice(0,397).replace(/[ ,;:.!?-]+$/g,"")+"…";
}

function generateCurrentAppreciation(){
  try{
    const rows=trackingRows();
    const summary=trackingSummary(rows);
    const qcuRows=studentTrackingQCURows();
    const events=studentTrackingStudent?behaviorEventsForStudent(studentTrackingStudent,studentTrackingClass,studentTrackingPeriod,studentTrackingStudentId):[];
    return behaviorGenerateAppreciation(events,summary.competencySummaries,rows,qcuRows);
  }catch(e){alert("Impossible de générer l’appréciation : "+e.message);return "";}
}

function saveAppreciationDraft(){const el=document.getElementById("generatedAppreciation");if(!el)return;try{localStorage.setItem("svt_appreciation_"+studentTrackingClass+"_"+studentTrackingStudent+"_"+studentTrackingPeriod,el.value);alert("Appréciation enregistrée sur cet appareil.");}catch(e){alert("Impossible d'enregistrer l'appréciation : "+e.message);}}
function loadAppreciationDraft(){try{return localStorage.getItem("svt_appreciation_"+studentTrackingClass+"_"+studentTrackingStudent+"_"+studentTrackingPeriod)||"";}catch(e){return "";}}

async function loadStudentTrackingQCU(){
  if(studentTrackingQCUCache.length && Date.now()-studentTrackingQCULoadedAt<TRACKING_CACHE_TTL) return studentTrackingQCUCache;
  if(studentTrackingQCULoadPromise) return studentTrackingQCULoadPromise;
  studentTrackingQCULoadPromise=loadStudentTrackingQCUFresh();
  try{
    const result=await studentTrackingQCULoadPromise;
    studentTrackingQCULoadedAt=Date.now();
    return result;
  }finally{studentTrackingQCULoadPromise=null;}
}
async function loadStudentTrackingQCUFresh(){
  studentTrackingQCUError="";
  studentTrackingQCUCache=[];
  try{
    const {data:authData,error:authError}=await sb.auth.getUser();
    if(authError)throw authError;
    const userId=authData?.user?.id;
    if(!userId)throw new Error("Professeur non connecté : impossible de charger les sessions de mémorisation.");
    const {data:sessions,error:sessionError}=await sb.from("qcu_sessions")
      .select("id,classe,titre,niveau,trimestre,date_qcu,chapitres")
      .eq("created_by",userId)
      .order("date_qcu",{ascending:true});
    if(sessionError)throw sessionError;

    const sessionsForTracking=[];
    // Charger jusqu'à quatre sessions en parallèle : moins d'attente
    // sans ouvrir une requête concurrente pour chaque session.
    const trackingSessions=sessions||[];
    for(let offset=0;offset<trackingSessions.length;offset+=4){
      const batch=await Promise.all(trackingSessions.slice(offset,offset+4).map(async ses=>{
      const {data:subjects,error:subjectsError}=await sb.from("qcu_sujets")
        .select("id,code,titre").eq("session_id",ses.id).order("code");
      if(subjectsError)throw subjectsError;
      const subjectIds=(subjects||[]).map(x=>x.id);
      if(!subjectIds.length)return null;

      const [{data:attrs,error:attrsError},{data:subjectQuestions,error:questionsError}]=await Promise.all([
        sb.from("qcu_attributions").select("id,eleve_id,sujet_id,statut")
          .eq("session_id",ses.id),
        sb.from("qcu_sujet_questions")
          .select("id,sujet_id,question_id,chapitre_snapshot,position,question_text_snapshot")
          .in("sujet_id",subjectIds).order("position")
      ]);
      if(attrsError)throw attrsError;
      if(questionsError)throw questionsError;

      const attributionIds=(attrs||[]).map(a=>a.id);
      const {data:answers,error:answersError}=attributionIds.length
        ? await sb.from("qcu_reponses").select("attribution_id,sujet_question_id,is_correct")
            .in("attribution_id",attributionIds)
        : {data:[],error:null};
      if(answersError)throw answersError;

      const bankIds=[...new Set((subjectQuestions||[]).map(q=>q.question_id).filter(Boolean).map(String))];
      let bankQuestions=[];
      if(bankIds.length){
        const {data,error}=await sb.from("qcu_questions")
          .select("id,question_text,chapitre").in("id",bankIds);
        if(error)throw error;
        bankQuestions=data||[];
      }
      const bankById=new Map(bankQuestions.map(q=>[String(q.id),q]));
      const answerByKey=new Map((answers||[]).map(a=>[
        `${a.attribution_id}|${a.sujet_question_id}`,a
      ]));
      const questionsBySubject=new Map((subjects||[]).map(subject=>[
        String(subject.id),(subjectQuestions||[])
          .filter(q=>String(q.sujet_id)===String(subject.id))
          .sort((a,b)=>Number(a.position)-Number(b.position))
      ]));
      const studentScores={};
      const classQuestionStats=new Map();

      for(const attr of (attrs||[])){
        if(String(attr.statut||"").toLowerCase()!=="corrige")continue;
        const studentId=String(attr.eleve_id||"");
        if(!studentId)continue;
        const questions=questionsBySubject.get(String(attr.sujet_id))||[];
        if(!studentScores[studentId]){
          studentScores[studentId]={correct:0,total:0,subjects:0,chapterStats:{},questionResults:[]};
        }
        const student=studentScores[studentId];
        student.subjects++;
        for(const question of questions){
          const answer=answerByKey.get(`${attr.id}|${question.id}`);
          if(!answer||answer.is_correct===null||answer.is_correct===undefined)continue;
          const correct=answer.is_correct===true;
          student.total++;
          if(correct)student.correct++;
          const bank=bankById.get(String(question.question_id))||{};
          const chapter=Number(question.chapitre_snapshot)||Number(bank.chapitre)||null;
          if(chapter!==null){
            const chapterKey=String(chapter);
            if(!student.chapterStats[chapterKey])student.chapterStats[chapterKey]={chapter,correct:0,total:0};
            student.chapterStats[chapterKey].total++;
            if(correct)student.chapterStats[chapterKey].correct++;
          }
          const questionText=question.question_text_snapshot||bank.question_text||`Question ${question.position||""}`;
          student.questionResults.push({chapter,question:questionText,correct});
          const qKey=String(question.question_id||question.id);
          if(!classQuestionStats.has(qKey)){
            classQuestionStats.set(qKey,{key:qKey,chapter,question:questionText,correct:0,total:0});
          }
          const stat=classQuestionStats.get(qKey);
          stat.total++;
          if(correct)stat.correct++;
        }
      }

      const chapters=Array.isArray(ses.chapitres)?ses.chapitres:
        (ses.chapitres!==null&&ses.chapitres!==undefined?[ses.chapitres]:[]);
      return {
        id:ses.id,classe:ses.classe,titre:ses.titre||"Mémorisation active",
        niveau:ses.niveau,trimestre:Number(ses.trimestre)||null,date_qcu:ses.date_qcu,
        chapters,studentScores,
        questionStats:[...classQuestionStats.values()].map(x=>({
          ...x,successRate:x.total?x.correct/x.total*100:null
        }))
      };
      }));
      // Promise.all conserve l'ordre des sessions malgré des réponses asynchrones.
      sessionsForTracking.push(...batch.filter(Boolean));
    }
    studentTrackingQCUCache=sessionsForTracking;
    return sessionsForTracking;
  }catch(error){
    studentTrackingQCUCache=[];
    studentTrackingQCUError=error?.message||"Erreur inconnue";
    console.error("Chargement des résultats de la banque et des sessions impossible :",error);
    return [];
  }
}
function studentTrackingQCURowsFor(studentId,classe,period,studentName){
  const id=String(studentId||"");
  const cls=String(classe||"").trim();
  const selectedPeriod=period||"year";
  if(!id)return [];
  return (studentTrackingQCUCache||[]).filter(session=>{
    if(cls&&String(session.classe||"").trim().toLocaleLowerCase("fr")!==cls.toLocaleLowerCase("fr"))return false;
    const trimester=Number(session.trimestre);
    return selectedPeriod==="year"||trimester===Number(String(selectedPeriod).replace("t",""));
  }).map(session=>{
    const score=session.studentScores?.[id]||{correct:0,total:0,subjects:0,chapterStats:{},questionResults:[]};
    const valid=score.total>0;
    const chapterStats=Object.values(score.chapterStats||{}).map(x=>({
      ...x,successRate:x.total?x.correct/x.total*100:null
    })).sort((a,b)=>a.chapter-b.chapter);
    return {
      id:session.id,titre:session.titre,classe:session.classe,date_qcu:session.date_qcu,
      trimestre:session.trimestre,chapters:session.chapters||[],
      chapitre:(session.chapters||[]).join(", "),
      correct:score.correct,total:score.total,
      score:valid?score.correct/score.total*20:null,
      successRate:valid?score.correct/score.total*100:null,
      hasScore:valid,subjects:score.subjects,chapterStats,
      questionResults:score.questionResults||[],
      questionStats:session.questionStats||[]
    };
  });
}
function studentTrackingQCURows(){
  return studentTrackingQCURowsFor(studentTrackingStudentId,studentTrackingClass,studentTrackingPeriod,studentTrackingStudent);
}
function studentTrackingQCUOverallAverage(qcuRows){
  const valid=(qcuRows||[]).filter(q=>q&&q.hasScore&&Number.isFinite(Number(q.score)));
  if(!valid.length)return null;
  // Même règle que le bilan cumulatif de la banque : toutes les réponses
  // effectivement corrigées sont additionnées, sans donner le même poids
  // à deux sessions qui n'ont pas nécessairement le même nombre de réponses.
  const correct=valid.reduce((sum,q)=>sum+(Number(q.correct)||0),0);
  const total=valid.reduce((sum,q)=>sum+(Number(q.total)||0),0);
  if(total>0)return correct/total*20;
  // Compatibilité avec d'anciennes sessions qui n'auraient pas le détail des réponses.
  return valid.reduce((sum,q)=>sum+Number(q.score),0)/valid.length;
}

function studentTrackingRoundMemorisationGrade(value){
  const n=Number(value);
  if(!Number.isFinite(n))return null;
  const lower=Math.floor(n);
  const decimal=n-lower;
  // On conserve exactement la demi-note ; en dessous on retient l'entier inférieur,
  // au-dessus on passe à l'entier supérieur.
  if(Math.abs(decimal-0.5)<1e-9)return lower+0.5;
  return decimal<0.5?lower:lower+1;
}
function studentTrackingAverageDetails(rows,qcuRows){
  const weighted=[];
  trackingUniqueGroupedRows(rows).forEach(c=>{
    const score=trackingScore20(c);
    if(!Number.isFinite(score))return;
    const coefficient=Number(c.evaluation?.coefficient);
    weighted.push({score,coefficient:Number.isFinite(coefficient)&&coefficient>0?coefficient:1});
  });
  const baseWeight=weighted.reduce((n,x)=>n+x.coefficient,0);
  const base=baseWeight>0?weighted.reduce((n,x)=>n+x.score*x.coefficient,0)/baseWeight:null;
  const validQcu=(qcuRows||[]).filter(q=>q&&q.hasScore&&Number.isFinite(Number(q.score)));
  if(!validQcu.length)return {base,final:base,qcuAverage:null,qcuCount:0,qcuIncluded:false};
  const rawQcuAverage=studentTrackingQCUOverallAverage(validQcu);
  const qcuAverage=studentTrackingRoundMemorisationGrade(rawQcuAverage);
  if(qcuAverage===null||base!==null&&qcuAverage<=base)
    return {base,final:base,qcuAverage,qcuRawAverage:rawQcuAverage,qcuCount:validQcu.length,qcuIncluded:false};
  // La moyenne de l'ensemble des QCU constitue une seule note de théorie,
  // de coefficient 1, quel que soit le nombre de QCU réalisés.
  const qcuWeight=1;
  const totalWeight=baseWeight+qcuWeight;
  const final=(weighted.reduce((n,x)=>n+x.score*x.coefficient,0)+qcuAverage*qcuWeight)/totalWeight;
  return {base,final,qcuAverage,qcuRawAverage:rawQcuAverage,qcuCount:qcuWeight,qcuIncluded:true};
}
function studentTrackingIsSixthGrade(classe){
  return /^6e(?:\s|\d|$)/i.test(String(classe||"").trim());
}
function studentTrackingScienceAverageDetails(rows,qcuRows,classe){
  if(!studentTrackingIsSixthGrade(classe))return studentTrackingAverageDetails(rows,qcuRows);
  const unique=trackingUniqueGroupedRows(rows||[]);
  const experimentalRows=unique.filter(c=>["activite","exercice"].includes(String(c.evaluation?.typeEvaluation||"")));
  const theoryRows=unique.filter(c=>! ["activite","exercice"].includes(String(c.evaluation?.typeEvaluation||"")));
  const experimentalDetails=studentTrackingAverageDetails(experimentalRows,[]);
  const theoryDetails=studentTrackingAverageDetails(theoryRows,qcuRows||[]);
  const experimental=experimentalDetails.base;
  const theory=theoryDetails.final;
  const available=[experimental,theory].filter(Number.isFinite);
  const final=available.length?available.reduce((a,b)=>a+b,0)/available.length:null;
  const baseAvailable=[experimental,theoryDetails.base].filter(Number.isFinite);
  const base=baseAvailable.length?baseAvailable.reduce((a,b)=>a+b,0)/baseAvailable.length:null;
  return {
    base,final,experimental,theory,
    experimentalBase:experimental,
    theoryBase:theoryDetails.base,
    qcuAverage:theoryDetails.qcuAverage??null,
    qcuRawAverage:theoryDetails.qcuRawAverage??null,
    qcuCount:theoryDetails.qcuCount||0,
    qcuIncluded:!!theoryDetails.qcuIncluded,
    isSixthGrade:true
  };
}
function studentTrackingFormatCategoryAverage(value){
  return Number.isFinite(value)?`${value.toFixed(2).replace(".",",")} / 20`:"—";
}

function studentTrackingBehaviorSummary(events){
  const counts={};
  let messages=0,mentions=0;
  (events||[]).forEach(e=>{
    const type=String(e.type||"");
    if(type.startsWith("message_envoye_")){messages++;return;}
    if(type.startsWith("mention_envoyee_")){mentions++;return;}
    counts[type]=(counts[type]||0)+1;
  });
  return {counts,messages,mentions};
}
function studentTrackingBehaviorLabel(type){
  const known=Array.isArray(BEHAVIOR_TYPES)?BEHAVIOR_TYPES.find(x=>x.code===type):null;
  if(known?.label)return known.label;
  const labels={
    devoir_oublie:"Devoir oublié",
    manque_ecoute:"Manque d’écoute",
    non_respect_consignes:"Non-respect des consignes",
    effort_progres:"Effort / progrès"
  };
  return labels[type]||String(type||"Observation").replace(/_/g," ").replace(/^./,c=>c.toLocaleUpperCase("fr"));
}
function studentTrackingCombinedAverage(rows,qcuRows,classe){
  const details=studentTrackingScienceAverageDetails(rows,qcuRows,classe);
  return details.final===null?"—":`${details.final.toFixed(2).replace(".",",")} / 20`;
}
function studentTrackingDateForQCU(q){
  return q.date_qcu?trackingDate(q.date_qcu):"Date non renseignée";
}

function renderStudentTracking(){
  if(loadEvalNav().view==='behaviorTracking'){renderBehaviorTracking();return;}
  label.textContent="Suivi d’un élève";
  saveEvalNav({view:"tracking",classe:studentTrackingClass,student:studentTrackingStudent,studentId:studentTrackingStudentId,period:studentTrackingPeriod});
  const studentOptions=trackingStudentOptions();
  if(studentTrackingStudentId&&!studentOptions.some(x=>x.id===String(studentTrackingStudentId)))studentTrackingStudentId="";
  if(!studentTrackingStudentId&&studentTrackingStudent){
    const found=studentOptions.find(x=>x.name===studentTrackingStudent);
    if(found)studentTrackingStudentId=found.id;
  }
  if(studentTrackingStudentId){
    const found=studentOptions.find(x=>x.id===String(studentTrackingStudentId));
    studentTrackingStudent=found?.name||"";
  }else if(studentTrackingStudent&&!studentOptions.some(x=>x.name===studentTrackingStudent)){
    studentTrackingStudent="";
  }

  const rows=trackingRows();
  const summary=trackingSummary(rows);
  const qcuRows=studentTrackingQCURows();
  const qcuScoredRows=qcuRows.filter(q=>q.hasScore);
  const allScores=rows.map(trackingScore20).filter(Number.isFinite);
  const averageDetails=studentTrackingScienceAverageDetails(rows,qcuScoredRows,studentTrackingClass);
  const averageEvaluations=averageDetails.base===null?"—":`${averageDetails.base.toFixed(2).replace(".",",")} / 20`;
  const overallQCUAverage=studentTrackingQCUOverallAverage(qcuScoredRows);
  const averageQCU=formatAverage20(overallQCUAverage===null?[]:[overallQCUAverage]);
  const combinedAverage=studentTrackingCombinedAverage(rows,qcuScoredRows,studentTrackingClass);
  const categoryAverageHtml=averageDetails.isSixthGrade?`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px"><div style="padding:10px;border:1px solid #b7e4cc;border-radius:10px;background:#f0faf4"><span style="display:block;font-size:12px;font-weight:800;color:#18794e">🧪 EXPÉRIMENTALE</span><strong style="font-size:1.25rem">${studentTrackingFormatCategoryAverage(averageDetails.experimental)}</strong></div><div style="padding:10px;border:1px solid #bfdbfe;border-radius:10px;background:#f2f7ff"><span style="display:block;font-size:12px;font-weight:800;color:#1d4ed8">📘 THÉORIE</span><strong style="font-size:1.25rem">${studentTrackingFormatCategoryAverage(averageDetails.theory)}</strong></div></div>`:"";
  const classes=[...new Set([
    ...studentTrackingCache.flatMap(c=>
      Array.isArray(c.evaluation?.assignedClasses)&&c.evaluation.assignedClasses.length
        ? c.evaluation.assignedClasses : [c.evaluation?.classe]
    ),
    ...behaviorStudentsCache.map(s=>s.classe)
  ].map(c=>String(c||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr",{numeric:true,sensitivity:"base"}));

  const behaviorEvents=studentTrackingStudent
    ? behaviorEventsForStudent(studentTrackingStudent,studentTrackingClass,studentTrackingPeriod,studentTrackingStudentId)
    : [];
  const behaviorSummaryData=studentTrackingBehaviorSummary(behaviorEvents);
  const behaviorRows=Object.entries(behaviorSummaryData.counts)
    .sort((a,b)=>a[0].localeCompare(b[0],"fr"))
    .map(([type,count])=>{
      return `<div class="tracking-mini-stat"><strong>${count}</strong><span>${esc(studentTrackingBehaviorLabel(type))}</span></div>`;
    }).join("");
  const communicationRows=`
    <div class="tracking-mini-stat"><strong>${behaviorSummaryData.messages}</strong><span>Mot(s) envoyé(s)</span></div>
    <div class="tracking-mini-stat"><strong>${behaviorSummaryData.mentions}</strong><span>Mention(s) envoyée(s)</span></div>`;

  const competencyHtml=summary.competencySummaries.length
    ? summary.competencySummaries.map(x=>{
        const mastery=x.averageMastery;
        return `<div class="tracking-competency tracking-competency-summary">
          <div class="tracking-competency-name"><strong>${esc(x.competence)}</strong>
            <div class="small-note">${x.evaluations} évaluation(s) · Moyenne de maîtrise : <strong>${formatMasteryAverage(x.average)}</strong></div>
          </div>
          <div>${mastery?`<span class="mastery-result ${mastery.cls}">${esc(mastery.code)} — ${esc(mastery.label)}</span>`:"—"}</div>
        </div>`;
      }).join("")
    : `<p class="muted">Aucune compétence évaluée pendant cette période.</p>`;

  const evaluationRows=rows.map(c=>{
    const date=trackingRecordDate(c);
    const coeff=Number(c.evaluation?.coefficient);
    const coefficient=Number.isFinite(coeff)&&coeff>0?coeff:1;
    const score=trackingNoteLabel(c);
    const score20=trackingScore20(c);
    return `<tr>
      <td>${esc(trackingDate(date))}</td>
      <td><strong>${esc(c.evaluation?.titre||"Évaluation")}</strong><div class="small-note">Coefficient ${coefficient.toLocaleString("fr-FR")}</div></td>
      <td>${esc(score)}${Number.isFinite(score20)?`<div class="small-note">${score20.toFixed(2).replace(".",",")} / 20</div>`:""}</td>
      <td><button type="button" class="tracking-link-button" onclick="openStudentEvaluationGrid(${jsArg(c.evaluationId)},${jsArg(studentTrackingClass||c.evaluation?.classe||"")},${jsArg(studentTrackingStudentId)})">Ouvrir la grille</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" class="muted">Aucune note enregistrée pour cette période.</td></tr>`;

  const qcuTable=qcuRows.map(q=>`<tr>
    <td>${esc(studentTrackingDateForQCU(q))}</td>
    <td><strong>${esc(q.titre||"Mémorisation active")}</strong><div class="small-note">${q.chapters?.length?`Chapitre(s) ${esc(q.chapters.join(", "))}`:"Chapitres non précisés"}</div></td>
    <td>${q.hasScore?`${q.correct} / ${q.total}`:"Non corrigé"}</td>
    <td>${q.hasScore?`<strong>${q.successRate.toLocaleString("fr-FR",{maximumFractionDigits:1})} %</strong>`:"—"}</td>
    <td>${q.hasScore?`${q.score.toFixed(2).replace(".",",")} / 20`:"—"}</td>
  </tr>`).join("") || `<tr><td colspan="5" class="muted">Aucune mémorisation active trouvée pour cette classe et cette période.</td></tr>`;

  const qcuChapterMap=new Map();
  qcuRows.forEach(q=>(q.chapterStats||[]).forEach(ch=>{
    const key=String(ch.chapter);
    if(!qcuChapterMap.has(key))qcuChapterMap.set(key,{chapter:ch.chapter,correct:0,total:0});
    const target=qcuChapterMap.get(key);target.correct+=ch.correct;target.total+=ch.total;
  }));
  const qcuChapterRows=[...qcuChapterMap.values()].sort((a,b)=>a.chapter-b.chapter);
  const qcuChapterHtml=qcuChapterRows.length?`
    <h4>Réussite par chapitre pour cet élève</h4>
    <div class="tracking-table-wrap"><table class="mastery-table student-report-table">
      <thead><tr><th>Chapitre</th><th>Bonnes réponses</th><th>Réussite</th></tr></thead>
      <tbody>${qcuChapterRows.map(ch=>`<tr><td>Chapitre ${esc(ch.chapter)}</td><td>${ch.correct} / ${ch.total}</td><td><strong>${(ch.correct/ch.total*100).toLocaleString("fr-FR",{maximumFractionDigits:1})} %</strong></td></tr>`).join("")}</tbody>
    </table></div>`:`<p class="muted">Aucun résultat QCU corrigé par chapitre pour cet élève.</p>`;

  const qcuQuestionMap=new Map();
  qcuRows.forEach(q=>(q.questionStats||[]).forEach(st=>{
    if(!st.total)return;
    const key=String(st.key||st.question);
    if(!qcuQuestionMap.has(key))qcuQuestionMap.set(key,{...st,correct:0,total:0});
    const target=qcuQuestionMap.get(key);target.correct+=st.correct;target.total+=st.total;
  }));
  const qcuDifficultQuestions=[...qcuQuestionMap.values()]
    .map(st=>({...st,rate:st.total?st.correct/st.total*100:0}))
    .sort((a,b)=>a.rate-b.rate).slice(0,10);
  const qcuDifficultHtml=qcuDifficultQuestions.length?`
    <h4>Questions les moins réussies dans la classe</h4>
    <p class="small-note">Taux calculé sur les réponses corrigées de tous les élèves de la classe, pour les mémorisations de la période sélectionnée.</p>
    <div class="tracking-table-wrap"><table class="mastery-table student-report-table">
      <thead><tr><th>Chapitre</th><th>Question</th><th>Réussite classe</th><th>Correctes</th></tr></thead>
      <tbody>${qcuDifficultQuestions.map(st=>`<tr><td>${st.chapter?`Chapitre ${esc(st.chapter)}`:"—"}</td><td>${esc(st.question)}</td><td><strong>${st.rate.toLocaleString("fr-FR",{maximumFractionDigits:1})} %</strong></td><td>${st.correct} / ${st.total}</td></tr>`).join("")}</tbody>
    </table></div>`:`<p class="muted">Pas encore assez de réponses corrigées pour établir les questions les moins réussies.</p>`;

  const qcuWrongRows=qcuRows.flatMap(q=>(q.questionResults||[])
    .filter(x=>!x.correct).map(x=>({date:studentTrackingDateForQCU(q),titre:q.titre,chapter:x.chapter,question:x.question})));
  const qcuWrongHtml=qcuWrongRows.length?`
    <details class="qcu-wrong-questions"><summary>Voir les ${qcuWrongRows.length} question(s) manquée(s) par cet élève</summary>
      <ul>${qcuWrongRows.map(x=>`<li>${esc(x.date)} · ${x.chapter?`Chapitre ${esc(x.chapter)} · `:""}${esc(x.question)}</li>`).join("")}</ul>
    </details>`:`<p class="muted">Aucune réponse incorrecte enregistrée pour cet élève sur cette période.</p>`;

  const classesOptions=classes.map(c=>`<option value="${esc(c)}" ${c===studentTrackingClass?"selected":""}>${esc(c)}</option>`).join("");
  content.innerHTML=`<button type="button" onclick="${studentTrackingReturnToClass?"returnToClassTracking()":"home()"}">${studentTrackingReturnToClass?"← Retour au suivi de classe":"← Accueil"}</button>
    <section class="hero tracking-header" style="margin-top:14px">
      <span class="eyebrow">Synthèse individuelle</span>
      <h2>📊 Suivi d’un élève</h2>
      <p class="muted">Sélectionne une classe, un élève et une période pour afficher sa fiche récapitulative.</p>
      <div class="tracking-filters">
        <div><label for="trackingClass">Classe</label><select id="trackingClass" onchange="studentTrackingClass=this.value;studentTrackingStudent='';studentTrackingStudentId='';renderStudentTracking()"><option value="">Toutes les classes</option>${classesOptions}</select></div>
        <div><label for="trackingStudent">Élève</label><select id="trackingStudent" onchange="studentTrackingStudentId=this.value;studentTrackingStudent=(trackingStudentOptions().find(x=>x.id===String(this.value))||{}).name||'';renderStudentTracking()"><option value="">${studentOptions.length?"Sélectionner un élève":"Aucun élève disponible"}</option>${studentOptions.map(o=>`<option value="${esc(o.id)}" ${String(o.id)===String(studentTrackingStudentId)?"selected":""}>${esc(o.name)}</option>`).join("")}</select></div>
        <div><label for="trackingPeriod">Période</label><select id="trackingPeriod" onchange="studentTrackingPeriod=this.value;renderStudentTracking()"><option value="year" ${studentTrackingPeriod==="year"?"selected":""}>Année</option><option value="t1" ${studentTrackingPeriod==="t1"?"selected":""}>Trimestre 1</option><option value="t2" ${studentTrackingPeriod==="t2"?"selected":""}>Trimestre 2</option><option value="t3" ${studentTrackingPeriod==="t3"?"selected":""}>Trimestre 3</option></select></div>
      </div>
    </section>
    ${studentTrackingStudent?`
    <div class="student-report" id="studentTrackingReport">
      <section class="hero student-report-heading">
        <div><span class="eyebrow">${esc(studentTrackingClass||"Classe non précisée")}</span><h2>👤 ${esc(studentTrackingStudent)}</h2><p class="muted">${esc(trackingPeriodLabel(studentTrackingPeriod))}</p></div>
        <div class="student-report-average"><span>${averageDetails.isSixthGrade?"Moyenne générale de sciences":"Moyenne trimestrielle"}</span><strong>${combinedAverage}</strong><small>${averageDetails.qcuIncluded?"QCU intégrés à la moyenne de théorie (ils l'augmentent)":"QCU non comptabilisés dans la moyenne"} · moyenne des QCU comptée comme une note de coefficient 1</small></div>
        ${categoryAverageHtml}
      </section>

      <section class="hero student-report-section">
        <h3>📝 Résultats des évaluations</h3>
        <div class="tracking-summary">
          <div class="tracking-stat"><strong>${summary.total}</strong><span>Évaluation(s)</span></div>
          <div class="tracking-stat"><strong>${averageEvaluations}</strong><span>Moyenne des évaluations</span></div>
          <div class="tracking-stat"><strong>${rows.filter(c=>Number.isFinite(trackingScore20(c))).length}</strong><span>Notes prises en compte</span></div>
        </div>
        <div class="tracking-table-wrap"><table class="mastery-table student-report-table"><thead><tr><th>Date</th><th>Évaluation</th><th>Note</th><th>Grille</th></tr></thead><tbody>${evaluationRows}</tbody></table></div>
      </section>

      <section class="hero student-report-section">
        <h3>🧠 QCU — Mémorisation active</h3><p class="small-note">Les pourcentages sont affichés pour chaque QCU, même lorsque son résultat n'est pas retenu dans la moyenne.</p>
        <div class="tracking-summary">
          <div class="tracking-stat"><strong>${qcuScoredRows.length} / ${qcuRows.length}</strong><span>QCU avec score retrouvé</span></div>
          <div class="tracking-stat"><strong>${averageQCU}</strong><span>Moyenne QCU /20</span></div>
        </div>
        ${studentTrackingQCUError?`<p class="tracking-warning" role="alert">Les résultats des QCU n’ont pas pu être chargés : ${esc(studentTrackingQCUError)}</p>`:""}
        <div class="tracking-table-wrap"><table class="mastery-table student-report-table"><thead><tr><th>Date</th><th>Mémorisation / chapitres</th><th>Bonnes réponses</th><th>Réussite</th><th>Note /20</th></tr></thead><tbody>${qcuTable}</tbody></table></div>
        ${qcuChapterHtml}
        ${qcuWrongHtml}
        ${qcuDifficultHtml}
      </section>

      <section class="hero student-report-section">
        <h3>📈 Maîtrise des compétences</h3>
        <p class="small-note">Pour chaque compétence, le niveau moyen est calculé à partir de toutes ses évaluations sur la période : TBM = 4, MS = 3, MF = 2, MI = 1.</p>
        <div class="tracking-competency-list">${competencyHtml}</div>
      </section>

      <section class="hero student-report-section">
        <h3>💬 Bilan du comportement et des communications</h3>
        <p class="small-note">Nombre d’observations et de communications sur la période, sans afficher les dates.</p>
        <div class="tracking-mini-grid">${behaviorRows||'<p class="muted">Aucune observation de comportement enregistrée.</p>'}${communicationRows}</div>
      </section>

      <section class="hero student-report-section appreciation-box">
        <div class="entry-head tracking-appreciation-head"><div><h3 style="margin:0">✨ Appréciation trimestrielle</h3><p class="small-note">Elle pourra être générée puis modifiée et enregistrée ici.</p></div>
          <div class="row tracking-appreciation-actions"><button type="button" class="primary" onclick="document.getElementById('generatedAppreciation').value=generateCurrentAppreciation()">✨ Générer</button><button type="button" onclick="saveAppreciationDraft()">💾 Enregistrer</button></div>
        </div>
        ${svtAccommodationControl(studentTrackingStudentId)}
        <textarea id="generatedAppreciation" rows="4" maxlength="400" placeholder="L’appréciation apparaîtra ici…">${esc(loadAppreciationDraft())}</textarea>
      </section>
      <div class="row tracking-report-actions"><button type="button" onclick="openBehaviorTracking(${jsArg(studentTrackingClass)},${jsArg(studentTrackingStudentId)},${jsArg(studentTrackingPeriod)})">📝 Ouvrir le suivi détaillé du comportement</button><button type="button" class="primary" onclick="exportStudentTrackingPDF()">📄 Exporter la fiche en PDF</button></div>
    </div>`:`<section class="hero" style="margin-top:14px"><h3>👤 Sélectionne un élève</h3><p class="muted">La fiche récapitulative apparaîtra ici après la sélection d’un élève.</p></section>`}`;

  if(!document.getElementById("studentTrackingLayoutStyles")){
    const style=document.createElement("style");
    style.id="studentTrackingLayoutStyles";
    style.textContent=`
      .student-report{display:grid;gap:14px;margin-top:14px;min-width:0}
      .student-report .hero{box-sizing:border-box;min-width:0}
      .student-report-heading{display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap}
      .student-report-heading h2{overflow-wrap:anywhere}
      .student-report-average{display:flex;flex-direction:column;gap:4px;padding:14px 18px;border:1px solid #cbd5e1;border-radius:12px;min-width:190px;max-width:100%;box-sizing:border-box}
      .student-report-average strong{font-size:1.65rem;line-height:1.2;overflow-wrap:anywhere}
      .student-report-average small{color:var(--muted,#64748b)}
      .student-report-section h3{margin:0 0 10px}
      .tracking-table-wrap{width:100%;max-width:100%;overflow-x:auto;overscroll-behavior-x:contain}
      .student-report-table{width:100%;min-width:560px;border-collapse:collapse}
      .student-report-table th,.student-report-table td{padding:9px 10px;vertical-align:middle;text-align:left;overflow-wrap:anywhere}
      .tracking-link-button{white-space:normal;max-width:100%}
      .tracking-competency-list{display:grid;gap:8px}
      .tracking-competency-summary{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:10px;border:1px solid #dbe2ea;border-radius:10px;min-width:0}
      .tracking-competency-name{min-width:0;flex:1 1 240px;overflow-wrap:anywhere}
      .tracking-mini-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:9px}
      .tracking-mini-stat{display:flex;flex-direction:column;gap:3px;min-width:0;padding:11px;border:1px solid #dbe2ea;border-radius:10px;overflow-wrap:anywhere}
      .tracking-mini-stat strong{font-size:1.35rem}
      .tracking-mini-stat span{font-size:.9rem}
      .tracking-appreciation-head{align-items:flex-start;flex-wrap:wrap}
      .tracking-appreciation-actions{flex-wrap:wrap}
      #generatedAppreciation{display:block;box-sizing:border-box;width:100%;max-width:100%;min-height:110px;resize:vertical}
      .tracking-report-actions{justify-content:flex-start;flex-wrap:wrap}
      .tracking-warning{padding:10px;border-left:3px solid #d97706;background:rgba(217,119,6,.08);overflow-wrap:anywhere}
      @media(max-width:600px){.student-report-average{width:100%}.student-report-heading{align-items:stretch}.student-report-table{min-width:520px}.tracking-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media print{
        body *{visibility:hidden!important}
        #studentTrackingReport,#studentTrackingReport *{visibility:visible!important}
        #studentTrackingReport{position:absolute!important;left:0!important;top:0!important;width:100%!important;margin:0!important;padding:0!important;display:block!important}
        #studentTrackingReport>.hero{break-inside:avoid;page-break-inside:avoid;margin:0 0 10px!important;box-shadow:none!important}
        #studentTrackingReport .tracking-report-actions{display:none!important}
        #studentTrackingReport .tracking-table-wrap{overflow:visible!important}
        #studentTrackingReport .student-report-table{min-width:0!important;font-size:9pt!important}
        #studentTrackingReport .student-report-table th,#studentTrackingReport .student-report-table td{padding:5px!important}
        #generatedAppreciation{border:1px solid #aaa!important;min-height:70px!important}
      }
    `;
    document.head.appendChild(style);
  }
}
async function openStudentEvaluationGrid(evaluationId,classe,studentId){
  const targetId=String(studentId||"");
  try{
    await openCorrection(evaluationId,classe);
    if(loadEvalNav().view!=="correction" || !copiesBoardState)return;
    const row=(copiesBoardState.rows||[]).find(r=>String(r.student?.id)===targetId);
    if(!row){
      alert("La grille de cet élève n’a pas été retrouvée dans le tableau des copies.");
      return;
    }
    await copiesBoardOpenStudent(targetId);
  }catch(e){
    alert("Impossible d’ouvrir la grille de cet élève : "+(e?.message||e));
  }
}

function classTrackingRows(){
  const rows=trackingUniqueGroupedRows(studentTrackingCache.filter(c=>{
    const date=trackingRecordDate(c);
    const studentName=String(c?.eleve||"").trim();
    // Ne pas afficher les corrections orphelines sans identité comme un faux élève.
    // Les données restent en base : seule leur apparition dans le suivi de classe est écartée.
    return studentName
      && studentName.toLocaleLowerCase("fr")!=="élève"
      && correctionAppliesToClass(c,classTrackingClass)
      &&trackingPeriodMatch(date,classTrackingPeriod);
  }));
  const byStudent={};
  rows.forEach(c=>{
    const name=c.eleve||"Élève";
    const studentKey=c.eleveId?String(c.eleveId):name;
    if(!byStudent[studentKey])byStudent[studentKey]={id:c.eleveId?String(c.eleveId):"",name,sortKey:c.sortKey||name.toLocaleLowerCase("fr"),evaluations:[],competencies:[]};
    byStudent[studentKey].evaluations.push(c);
    const stats=c.resultat?.criteriaStats||{};
    if(isHistoricalEvaluation(c.evaluation)){
      const meta=historicalMeta(c.evaluation);
      const mastery=getMasteryByCode(c.resultat?.masteryCode||"");
      if(mastery){
        byStudent[studentKey].competencies.push({competence:meta.competence||"Compétence non renseignée",validated:null,total:null,mastery});
      }
    }else{
      const crits=criteriaFromLegacy(c.evaluation),groups={};
      crits.forEach(cr=>{
        const gid=cr.competenceId||"comp1";
        if(!groups[gid])groups[gid]={nom:cr.competenceNom||"Compétence évaluée",total:0,validated:0};
        groups[gid].total++;
        if(stats[cr.id]?.validated)groups[gid].validated++;
      });
      Object.values(groups).forEach(g=>{
        byStudent[studentKey].competencies.push({
          competence:g.nom,
          validated:g.validated,
          total:g.total,
          mastery:getMasteryFromValidatedCriteria(g.validated)
        });
      });
    }
  });
  // Ajoute les résultats QCU aux élèves de la classe, sans les mélanger aux évaluations.
  const roster=behaviorStudentsCache.filter(st=>!classTrackingClass||String(st.classe||"").trim()===String(classTrackingClass).trim());
  roster.forEach(st=>{
    const id=String(st.id||"");
    const qcu=studentTrackingQCURowsFor(id,st.classe,classTrackingPeriod);
    if(!qcu.length)return;
    const key=id||studentDisplayName(st);
    if(!byStudent[key])byStudent[key]={id,name:studentDisplayName(st),sortKey:(st.nom||"").toLocaleLowerCase("fr"),evaluations:[],competencies:[],qcu:[]};
    byStudent[key].qcu=qcu;
  });
  return Object.values(byStudent).sort((a,b)=>{
    const ak=(a.sortKey||a.name||"").toLocaleLowerCase("fr");
    const bk=(b.sortKey||b.name||"").toLocaleLowerCase("fr");
    return ak.localeCompare(bk,"fr",{numeric:true});
  });
}
function appreciationStorageKey(studentId){
  return `svt_appreciation_${classTrackingClass}_${classTrackingPeriod}_${studentId}`;
}
function appreciationStudentRows(student){
  const id=String(student?.id||"");
  const fullName=studentDisplayName(student);
  const normalized=normalizeTrackingStudentName(fullName);
  return studentTrackingCache.filter(c=>{
    const date=trackingRecordDate(c);
    if(!trackingPeriodMatch(date,classTrackingPeriod))return false;
    if(String(c.eleveId||"")===id)return true;
    if(c.eleveId)return false;
    return normalizeTrackingStudentName(c.eleve)===normalized;
  });
}
function appreciationBehaviorSentence(events){
  const actual=(events||[]).filter(e=>
    !String(e.type||"").startsWith("message_envoye_") &&
    e.type!=="mention_envoyee_participation"
  );
  const count=type=>actual.filter(e=>e.type===type).length;

  // Une observation isolée ne suffit pas à caractériser une difficulté récurrente.
  const alerts=[];
  if(count("bavardage")>=3)alerts.push("des bavardages encore trop fréquents");
  if(count("oubli_materiel")>=3)alerts.push("des oublis de matériel récurrents");
  if(count("travail_non_fait")+count("devoir_oublie")>=2)alerts.push("un travail personnel qui manque de régularité");
  if(count("manque_ecoute")>=2)alerts.push("une écoute qui doit être plus attentive");
  if(count("non_respect_consignes")>=2)alerts.push("une meilleure prise en compte des consignes");

  const positives=[];
  if(count("participation")>=1)positives.push("une participation appréciable");
  if(count("effort_progres")>=1)positives.push("des efforts et des progrès");

  if(alerts.length){
    let sentence=`Son attitude appelle encore de la vigilance concernant ${alerts.join(", ")}`;
    if(positives.length)sentence+=`, même si ${positives.join(" et ")} sont à souligner`;
    return sentence+".";
  }
  if(positives.length)return `Son attitude est positive, notamment grâce à ${positives.join(" et ")}.`;
  return "";
}

function appreciationAdvice(average,masteryPercent,events,qcuAverage,languageAverage){
  const actual=(events||[]).filter(e=>
    !String(e.type||"").startsWith("message_envoye_") &&
    e.type!=="mention_envoyee_participation"
  );
  const chatter=actual.filter(e=>e.type==="bavardage").length;
  const material=actual.filter(e=>e.type==="oubli_materiel").length;
  const unfinished=actual.filter(e=>["travail_non_fait","devoir_oublie"].includes(e.type)).length;
  const listening=actual.filter(e=>["manque_ecoute","non_respect_consignes"].includes(e.type)).length;

  if(chatter>=3||material>=3||unfinished>=2||listening>=2)
    return "Une meilleure concentration et un travail plus régulier permettront de progresser.";
  if(languageAverage!==null&&languageAverage<2.5)
    return "Une attention particulière à la qualité de la rédaction l'aidera à mieux communiquer ses raisonnements.";
  if(masteryPercent!==null&&masteryPercent<30)
    return "La reprise régulière des notions et des entraînements permettra de consolider les acquis.";
  if(qcuAverage!==null&&qcuAverage<10)
    return "Des révisions régulières l'aideront à mieux mémoriser les connaissances.";
  if(average!==null&&average<10)
    return "Un travail plus régulier et des entraînements fréquents lui permettront de progresser.";
  if(average!==null&&average>=16&&masteryPercent!==null&&masteryPercent>=80)
    return "Félicitations pour ce trimestre ; cette dynamique est à poursuivre.";
  if(average!==null&&average>=16)
    return "La poursuite des efforts permettra d'approfondir encore les raisonnements.";
  if(masteryPercent!==null&&masteryPercent<60)
    return "Les acquis encore fragiles devront être consolidés par un travail régulier.";
  return "La poursuite des efforts avec régularité permettra de consolider les acquis.";
}

function appreciationVariation(studentId,options){
  if(!options.length)return "";
  const value=String(studentId||"");
  let hash=0;
  for(let i=0;i<value.length;i++)hash=(hash*31+value.charCodeAt(i))>>>0;
  return options[hash%options.length];
}

function generateClassAppreciationLegacy(student){
  const sourceStudent=studentsCache.find(s=>String(s.id)===String(student?.id))||student;
  const firstName=String(sourceStudent?.prenom||sourceStudent?.nom||"Élève").trim().split(/\s+/)[0];
  const rows=appreciationStudentRows(sourceStudent);

  // Les résultats QCU sont déjà regroupés par session : un même passage ne
  // doit pas être artificiellement compté plusieurs fois.
  const qcuRows=studentTrackingQCURowsFor(
    sourceStudent.id,sourceStudent.classe,classTrackingPeriod,studentDisplayName(sourceStudent)
  );
  const scoredQcu=qcuRows.filter(q=>q?.hasScore&&Number.isFinite(Number(q.score)));
  const qcuAverage=studentTrackingQCUOverallAverage(scoredQcu);

  const average=studentTrackingScienceAverageDetails(rows,scoredQcu,sourceStudent.classe).final;
  const competencyRows=trackingCompetencyRows(rows).filter(x=>x.mastery?.code);
  const values=competencyRows.map(x=>masteryValue(x.mastery.code)).filter(Number.isFinite);
  const masteryAverage=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const masteryPercent=values.length
    ?values.reduce((sum,value)=>sum+({4:100,3:67,2:33,1:0}[value]??0),0)/values.length
    :null;

  const languageRows=competencyRows.filter(x=>/ma[iî]trise de la langue/i.test(String(x.competence||"")));
  const languageValues=languageRows.map(x=>masteryValue(x.mastery?.code)).filter(Number.isFinite);
  const languageAverage=languageValues.length
    ?languageValues.reduce((a,b)=>a+b,0)/languageValues.length
    :null;

  // 1. Niveau du trimestre : seuils conformes au barème demandé.
  let firstSentence;
  if(average===null){
    firstSentence=`${firstName} ne dispose pas encore de résultats suffisants pour situer son trimestre.`;
  }else if(average>=18){
    firstSentence=`${firstName} réalise un excellent trimestre.`;
  }else if(average>=16){
    firstSentence=`${firstName} réalise un très bon trimestre.`;
  }else if(average>=12){
    firstSentence=`${firstName} réalise un bon trimestre.`;
  }else if(average>=10){
    firstSentence=`${firstName} réalise un trimestre correct.`;
  }else if(average>=6){
    firstSentence=`${firstName} réalise un trimestre fragile.`;
  }else{
    firstSentence=`${firstName} réalise un trimestre inquiétant.`;
  }

  // 2. Bilan de l'ensemble des compétences, sans citer leurs intitulés.
  let masterySentence="";
  if(masteryAverage!==null){
    if(masteryAverage>=3.5)masterySentence="L'ensemble des compétences est très bien maîtrisé.";
    else if(masteryAverage>=2.7)masterySentence="Les compétences sont globalement bien maîtrisées, malgré quelques points à consolider.";
    else if(masteryAverage>=2)masterySentence="Les acquis sont inégaux et plusieurs compétences restent à consolider.";
    else masterySentence="La maîtrise de plusieurs compétences demeure fragile.";
  }

  // 3. Attitude : seules les observations récurrentes sont signalées.
  const events=behaviorEventsForStudent(
    studentDisplayName(sourceStudent),sourceStudent.classe,classTrackingPeriod,sourceStudent.id
  );
  const behaviorSentence=appreciationBehaviorSentence(events);

  // En l'absence d'observation comportementale, rester factuel et parler du
  // travail évalué sans inventer de comportement ou de participation.
  let workSentence="";
  if(!behaviorSentence){
    if(qcuAverage!==null&&qcuAverage>=16)
      workSentence="Les résultats obtenus en mémorisation sont très satisfaisants.";
    else if(qcuAverage!==null&&qcuAverage<10)
      workSentence="La mémorisation des connaissances demande encore à être renforcée.";
    else if(rows.length)
      workSentence="Le travail évalué permet de faire le point sur les acquis du trimestre.";
  }

  // La mémorisation et la rédaction peuvent apporter une précision utile,
  // mais ne doivent pas remplacer le bilan global des compétences.
  let precisionSentence="";
  if(languageAverage!==null&&languageAverage<2.5)
    precisionSentence="La qualité de la rédaction reste à améliorer.";
  else if(qcuAverage!==null&&qcuAverage>=12&&qcuAverage<16)
    precisionSentence="Les résultats en mémorisation sont encourageants.";

  // 4. Conseil cohérent avec les difficultés effectivement observées.
  const advice=appreciationAdvice(average,masteryPercent,events,qcuAverage,languageAverage);

  // Construire dans l'ordre demandé, sans couper une phrase ni dépasser 400
  // caractères. Les phrases facultatives sont écartées avant le conseil.
  const candidates=[firstSentence,masterySentence,behaviorSentence||workSentence,precisionSentence,advice];
  const selected=[];
  for(const sentence of candidates){
    if(!sentence)continue;
    const candidate=[...selected,sentence].join(" ").replace(/\s+/g," ").trim();
    if(candidate.length<=400)selected.push(sentence);
  }

  // Le conseil doit rester présent : si nécessaire, retirer la précision
  // facultative puis raccourcir la formulation du bilan des compétences.
  if(!selected.includes(advice)){
    const withoutPrecision=selected.filter(x=>x!==precisionSentence);
    const candidate=[...withoutPrecision,advice].filter(Boolean).join(" ").replace(/\s+/g," ").trim();
    if(candidate.length<=400){
      selected.splice(0,selected.length,...withoutPrecision,advice);
    }
  }
  return selected.join(" ").replace(/\s+/g," ").trim().slice(0,400).trim();
}
function classGeneralAppreciationStorageKey(){
  return `svt_appreciation_classe_${classTrackingClass||"toutes"}_${classTrackingPeriod}`;
}
function generateGeneralClassAppreciation(){
  const roster=behaviorStudentsCache.filter(st=>!classTrackingClass||String(st.classe||"").trim()===String(classTrackingClass).trim());
  if(!roster.length)return "Aucun élève n'est disponible pour établir le bilan de cette classe.";
  const averages=[],masteries=[],qcuScores=[];
  let participating=0,chatterStudents=0,materialStudents=0,workStudents=0;
  roster.forEach(st=>{
    const source=studentsCache.find(x=>String(x.id)===String(st.id))||st;
    const rows=appreciationStudentRows(source);
    const comp=trackingCompetencyRows(rows).filter(x=>x.mastery?.code);
    comp.forEach(x=>{const v=masteryValue(x.mastery.code);if(Number.isFinite(v))masteries.push(v);});
    const qcus=studentTrackingQCURowsFor(st.id,st.classe,classTrackingPeriod,studentDisplayName(source)).filter(q=>q?.hasScore&&Number.isFinite(Number(q.score)));
    const avg=studentTrackingScienceAverageDetails(rows,qcus,st.classe).final;
    if(Number.isFinite(avg)&&classAverageStudentIncluded(st.id))averages.push(avg);
    const studentQcuAverage=studentTrackingQCUOverallAverage(qcus);
    if(Number.isFinite(studentQcuAverage))qcuScores.push(studentQcuAverage);
    const events=behaviorEventsForStudent(studentDisplayName(source),source.classe,classTrackingPeriod,source.id)||[];
    const actual=events.filter(e=>!String(e.type||"").startsWith("message_envoye_")&&e.type!=="mention_envoyee_participation");
    if(actual.some(e=>e.type==="participation"))participating++;
    if(actual.filter(e=>e.type==="bavardage").length>=3)chatterStudents++;
    if(actual.filter(e=>e.type==="oubli_materiel").length>=3)materialStudents++;
    if(actual.some(e=>["travail_non_fait","devoir_oublie"].includes(e.type)))workStudents++;
  });
  const avg=averages.length?averages.reduce((a,b)=>a+b,0)/averages.length:null;
  const mastery=masteries.length?masteries.reduce((a,b)=>a+b,0)/masteries.length:null;
  const qcu=qcuScores.length?qcuScores.reduce((a,b)=>a+b,0)/qcuScores.length:null;
  const parts=[];
  if(avg!==null)parts.push(avg>=16?"Les résultats de la classe sont très satisfaisants.":avg>=14?"Les résultats de la classe sont satisfaisants.":avg>=10?"Les résultats sont dans l'ensemble corrects.":"Les résultats restent fragiles et nécessitent un travail régulier.");
  if(mastery!==null)parts.push(mastery>=3.4?"Les compétences scientifiques sont globalement bien maîtrisées.":mastery>=2.6?"La maîtrise des compétences est dans l'ensemble satisfaisante.":mastery>=1.8?"La maîtrise des compétences demeure hétérogène.":"La maîtrise des compétences doit être renforcée.");
  if(qcu!==null)parts.push(qcu>=16?"Les résultats aux activités de mémorisation sont très encourageants.":qcu>=12?"Les résultats en mémorisation sont encourageants.":qcu<10?"La mémorisation des connaissances reste à consolider.":"");
  if(participating>0)parts.push(`La participation est présente chez ${participating} élève(s) sur ${roster.length}.`);
  else parts.push("Une participation orale plus active de la classe favoriserait les échanges scientifiques.");
  const alerts=[];
  if(chatterStudents)alerts.push(`${chatterStudents} élève(s) présentent des bavardages récurrents`);
  if(materialStudents)alerts.push(`${materialStudents} élève(s) oublient régulièrement leur matériel`);
  if(workStudents)alerts.push(`${workStudents} élève(s) ont des travaux non réalisés ou oubliés`);
  if(alerts.length)parts.push("Une vigilance collective reste nécessaire : "+alerts.join(" ; ")+".");
  let advice=mastery!==null&&mastery<2.6?"Il faudra consolider les notions et s'entraîner à les mobiliser.":qcu!==null&&qcu<10?"Des révisions régulières aideront à mieux retenir les connaissances.":"La poursuite d'un travail régulier et d'une participation active permettra de progresser.";
  parts.push(advice);
  let result="";
  for(const part of parts.filter(Boolean)){
    const candidate=(result?result+" ":"")+part;
    if(candidate.length<=400)result=candidate;
  }
  return result||"Le bilan de la classe ne comporte pas encore suffisamment de données.";
}
function loadGeneralClassAppreciation(){try{return localStorage.getItem(classGeneralAppreciationStorageKey())||"";}catch(e){return "";}}
function generateAndDisplayGeneralClassAppreciation(){
  const field=document.getElementById("general-class-appreciation");
  if(!field)return;
  field.value=generateGeneralClassAppreciation();
  const counter=document.getElementById("general-class-appreciation-count");
  if(counter)counter.textContent=field.value.length;
}
function saveGeneralClassAppreciation(){
  const field=document.getElementById("general-class-appreciation");
  if(!field)return;
  field.value=String(field.value||"").slice(0,400);
  try{localStorage.setItem(classGeneralAppreciationStorageKey(),field.value);alert("Appréciation générale de la classe enregistrée sur cet appareil.");}
  catch(e){alert("Enregistrement impossible : "+e.message);}
}
function generateAllClassAppreciations(){
  const roster=behaviorStudentsCache.filter(student=>!classTrackingClass||String(student.classe||"").trim()===String(classTrackingClass).trim());
  roster.forEach(student=>{
    const field=[...document.querySelectorAll(".class-appreciation")].find(el=>String(el.dataset.studentId)===String(student.id));
    if(field){field.value=generateClassAppreciation(student);const counter=field.parentElement.querySelector(".appreciation-count");if(counter)counter.textContent=field.value.length;}
  });
}
function saveAllClassAppreciations(){
  const fields=[...document.querySelectorAll(".class-appreciation")];
  try{
    fields.forEach(field=>{
      const value=String(field.value||"").slice(0,400);
      field.value=value;
      localStorage.setItem(appreciationStorageKey(field.dataset.studentId),value);
    });
    alert(`${fields.length} appréciation(s) enregistrée(s) sur cet appareil.`);
  }catch(e){alert("Enregistrement impossible : "+e.message);}
}
function loadClassAppreciation(student){
  try{return localStorage.getItem(appreciationStorageKey(student.id))||"";}catch(e){return "";}
}
function classAppreciationExportRows(){
  const roster=behaviorStudentsCache.filter(student=>!classTrackingClass||String(student.classe||"").trim()===String(classTrackingClass).trim());
  return roster.map(student=>{
    const source=studentsCache.find(s=>String(s.id)===String(student.id))||student;
    const field=[...document.querySelectorAll(".class-appreciation")].find(el=>String(el.dataset.studentId)===String(student.id));
    const display=studentDisplayName(source);
    return {
      nom:String(source.nom||display).trim(),
      prenom:String(source.prenom||"").trim(),
      classe:String(source.classe||student.classe||classTrackingClass||"").trim(),
      periode:({year:"Année",t1:"Trimestre 1",t2:"Trimestre 2",t3:"Trimestre 3"})[classTrackingPeriod]||classTrackingPeriod,
      appreciation:String(field?field.value:loadClassAppreciation(student)).trim()
    };
  });
}
function exportClassAppreciationsPDF(){
  const rows=classAppreciationExportRows();
  if(!rows.length){alert("Aucune appréciation à exporter pour cette classe.");return;}
  const popup=window.open("","_blank");
  if(!popup){alert("Le navigateur a bloqué la fenêtre d'export. Autorise les fenêtres surgissantes pour ce site puis réessaie.");return;}
  const safe=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const body=rows.map(r=>`<tr><td>${safe(r.nom)}</td><td>${safe(r.prenom)}</td><td>${safe(r.appreciation||"—")}</td></tr>`).join("");
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Appréciations ${safe(classTrackingClass||"classe")}</title><style>
    @page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{font:11pt Arial,sans-serif;color:#111}h1{font-size:17pt;margin:0 0 5px}p{margin:0 0 16px;color:#444;font-size:10pt}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #999;padding:7px;vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:#eee}th:nth-child(1){width:23%}th:nth-child(2){width:20%}th:nth-child(3){width:57%}tr{break-inside:avoid;page-break-inside:avoid}td{line-height:1.35}@media screen{body{max-width:900px;margin:25px auto}}
    </style></head><body><h1>Appréciations — ${safe(classTrackingClass||"Toutes les classes")}</h1><p>${safe(({year:"Année",t1:"Trimestre 1",t2:"Trimestre 2",t3:"Trimestre 3"})[classTrackingPeriod]||classTrackingPeriod)} · ${rows.length} élève(s)</p><table><thead><tr><th>Nom</th><th>Prénom</th><th>Appréciation</th></tr></thead><tbody>${body}</tbody></table><script>window.onload=()=>{window.focus();window.print();};</script></body></html>`);
  popup.document.close();
}
function exportClassAppreciationsCSV(){
  const rows=classAppreciationExportRows();
  if(!rows.length){alert("Aucune appréciation à exporter pour cette classe.");return;}
  // CSV UTF-8 avec séparateur français et guillemets échappés.
  // Numbers et Excel ouvrent les 5 colonnes sans dépendance supplémentaire.
  const cell=value=>{
    let text=String(value??"");
    // Empêcher l'interprétation d'un texte saisi comme formule de tableur.
    if(/^\s*[=+@-]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  const lines=[
    ["Nom","Prénom","Classe","Période","Appréciation"],
    ...rows.map(r=>[r.nom,r.prenom,r.classe,r.periode,r.appreciation])
  ].map(values=>values.map(cell).join(";"));
  const blob=new Blob(["\ufeff",lines.join("\r\n")+"\r\n"],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  const fileClass=(classTrackingClass||"toutes_les_classes").replace(/[^a-z0-9_-]+/gi,"_");
  a.href=url;a.download=`appreciations_${fileClass}_${classTrackingPeriod}.csv`;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
// Devoirs notés : une ligne par devoir, même si plusieurs sujets alternatifs existent.
function classQuarterGradedWorks(rows){
  const works=new Map();
  (rows||[]).forEach(student=>{
    const studentKey=String(student.id||student.name||"").trim();
    if(!studentKey)return;
    const included=classAverageStudentIncluded(student.id);
    (student.evaluations||[]).forEach(c=>{
      const ev=c?.evaluation;
      if(!ev)return;
      const score=trackingScore20(c);
      // Ne pas convertir une absence ou une note manquante en zéro.
      if(!Number.isFinite(score))return;
      const id=trackingEvaluationGroupId(ev);
      if(!id||id==="item_unknown")return;
      if(!works.has(id))works.set(id,{
        id,titles:new Set(),type:String(ev.typeEvaluation||"evaluation"),
        coefficient:Number(ev.coefficient)>0?Number(ev.coefficient):1,
        scores:new Map(),allStudents:new Set(),date:null
      });
      const work=works.get(id);
      const title=String(ev.titre||"Devoir sans titre").trim();
      if(title)work.titles.add(title);
      work.allStudents.add(studentKey);
      const rawDate=trackingRecordDate(c);
      const time=rawDate?new Date(normalizeTrackingDate(rawDate)).getTime():NaN;
      if(Number.isFinite(time)&&(!work.date||time<work.date.getTime()))work.date=new Date(time);
      if(included)work.scores.set(studentKey,score);
    });
  });
  return [...works.values()].map(work=>{
    const grades=[...work.scores.values()];
    const average=grades.length?grades.reduce((sum,n)=>sum+n,0)/grades.length:null;
    const titles=[...work.titles];
    return {
      id:work.id,title:titles[0]||"Devoir sans titre",subjects:titles.length,
      type:work.type,coefficient:work.coefficient,date:work.date,
      recorded:work.allStudents.size,graded:grades.length,average
    };
  }).sort((a,b)=>(a.date?.getTime()||0)-(b.date?.getTime()||0)||
    a.title.localeCompare(b.title,"fr",{numeric:true,sensitivity:"base"}));
}
function classQuarterGradedWorkType(type){
  if(type==="activite")return "Activité";
  if(type==="exercice")return "Exercice";
  return "Évaluation";
}
function classQuarterGradedWorkTableHTML(works){
  if(!works.length)return '<p class="small-note">Aucun devoir avec note enregistrée pour cette période.</p>';
  const fmt=n=>Number.isFinite(n)?n.toFixed(2).replace(".",",")+" /20":"—";
  const date=x=>x instanceof Date&&Number.isFinite(x.getTime())?x.toLocaleDateString("fr-FR"):"—";
  return '<div style="overflow-x:auto"><table class="mastery-table" style="width:100%;min-width:630px">'+
    '<thead><tr><th>Devoir noté</th><th>Type</th><th>1re note saisie</th><th>Coeff.</th><th>Notes retenues</th><th>Moyenne de classe</th></tr></thead>'+
    '<tbody>'+works.map(w=>'<tr><td><strong>'+esc(w.title)+'</strong>'+
      (w.subjects>1?'<div class="small-note">'+w.subjects+' versions de sujet</div>':"")+
      '</td><td>'+esc(classQuarterGradedWorkType(w.type))+'</td><td>'+esc(date(w.date))+
      '</td><td>'+String(w.coefficient).replace(".",",")+'</td><td>'+w.graded+
      '</td><td><strong>'+fmt(w.average)+'</strong></td></tr>').join("")+
    '</tbody></table></div>';
}

// Bilan du trimestre : lecture seule, mêmes notes et mêmes règles d'exclusion que le suivi.
function classQuarterBand(score){
  if(!Number.isFinite(score)||score<0||score>20)return null;
  if(score>=16)return "high";
  if(score>=10)return "middle";
  if(score>=5)return "low";
  return "veryLow";
}
function classQuarterReportData(rows){
  const bins={high:0,middle:0,low:0,veryLow:0};
  const mastery={TBM:0,MS:0,MF:0,MI:0};
  const evaluations=new Set();
  const competencyBreakdown=new Map();
  let evaluated=0;
  const names=new Set();
  (rows||[]).forEach(student=>{
    // Une évaluation est comptée une fois, même avec plusieurs copies corrigées.
    (student.evaluations||[]).forEach(c=>{
      if(!c.evaluation)return;
      const key=trackingEvaluationGroupId(c.evaluation);
      if(key&&key!=="item_unknown")evaluations.add(key);
    });
    if(!classAverageStudentIncluded(student.id))return;
    const avg=studentTrackingScienceAverageDetails(student.evaluations,student.qcu||[],classTrackingClass).final;
    const bucket=classQuarterBand(avg);
    if(bucket){bins[bucket]++;evaluated++;}
    // Une compétence n'est comptée qu'une fois par élève : dernière maîtrise connue du trimestre.
    const latest=new Map();
    (student.competencies||[]).forEach(item=>{
      const code=String(item.mastery?.code||"").toUpperCase();
      if(!Object.hasOwn(mastery,code))return;
      const name=String(item.competence||"Compétence non renseignée").trim();
      latest.set(name,code);
    });
    latest.forEach((code,name)=>{
      mastery[code]++;names.add(name);
      if(!competencyBreakdown.has(name))competencyBreakdown.set(name,{TBM:0,MS:0,MF:0,MI:0});
      competencyBreakdown.get(name)[code]++;
    });
  });
  const events=(behaviorEventsCache||[]).filter(e=>
    (!classTrackingClass||String(e.classe||"").trim()===String(classTrackingClass).trim()) &&
    (classTrackingPeriod==="year"||trackingPeriodMatch(e.date,classTrackingPeriod))
  );
  const messages=events.filter(e=>String(e.type||"").startsWith("message_envoye_")).length;
  const remarks=events.filter(e=>{
    const type=String(e.type||"");
    return type&&!type.startsWith("message_envoye_")&&!type.startsWith("mention_envoyee_")&&
      type!=="participation"&&type!=="effort_progres";
  }).length;
  const masteryTotal=Object.values(mastery).reduce((sum,n)=>sum+n,0);
  const gradedWorks=classQuarterGradedWorks(rows);
  const byCompetency=[...competencyBreakdown.entries()].map(([name,counts])=>{
    const total=Object.values(counts).reduce((sum,n)=>sum+n,0);
    const satisfactory=counts.TBM+counts.MS;
    return {name,...counts,total,satisfactory,rate:total?100*satisfactory/total:null};
  }).sort((a,b)=>a.name.localeCompare(b.name,"fr",{sensitivity:"base"}));
  return {bins,evaluated,evaluationCount:evaluations.size,gradedWorks,byCompetency,withoutScore:Math.max(0,(behaviorStudentsCache||[]).filter(st=>
      (!classTrackingClass||String(st.classe||"").trim()===String(classTrackingClass).trim())&&
      classAverageStudentIncluded(st.id)).length-evaluated),
    mastery,masteryTotal,masteryRate:masteryTotal?100*(mastery.TBM+mastery.MS)/masteryTotal:null,
    competenceCount:names.size,remarks,messages};
}
function classQuarterReportHTML(rows){
  const d=classQuarterReportData(rows);
  const label=({year:"Bilan annuel",t1:"Bilan du trimestre 1",t2:"Bilan du trimestre 2",t3:"Bilan du trimestre 3"})[classTrackingPeriod]||"Bilan de la période";
  const bands=[
    ["high","16 à 20 /20"],
    ["middle","10 à 15,99 /20"],
    ["low","5 à 9,99 /20"],
    ["veryLow","Moins de 5 /20"]
  ];
  const tile=(number,title,description="")=>'<div class="tracking-stat" style="padding:14px 12px;min-width:0"><strong>'+number+'</strong><span>'+title+'</span>'+(description?'<small class="small-note">'+description+'</small>':"")+'</div>';
  const percent=n=>d.masteryTotal?((100*n/d.masteryTotal).toFixed(1).replace(".",",")+" %"):"—";
  const masteryLabels=[["TBM","Très bonne maîtrise"],["MS","Maîtrise satisfaisante"],["MF","Maîtrise fragile"],["MI","Maîtrise insuffisante"]];
  const detailRows=d.byCompetency.map(c=>'<tr><td>'+esc(c.name)+'</td><td>'+c.total+'</td><td>'+c.TBM+'</td><td>'+c.MS+'</td><td>'+c.MF+'</td><td>'+c.MI+'</td><td><strong>'+(c.rate===null?"—":c.rate.toFixed(1).replace(".",",")+" %")+'</strong></td></tr>').join("");
  return '<h3 style="margin:0 0 6px">📊 '+label+' — résultats et suivi</h3>'+
    '<p class="small-note" style="margin:0 0 14px">Résultats calculés avec les moyennes réellement retenues, QCU compris selon les règles habituelles. Les élèves exclus du calcul de la moyenne de classe ne figurent pas dans la répartition des notes ni des maîtrises.</p>'+
    '<div class="tracking-summary" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:8px">'+
    tile(d.evaluationCount,"Évaluations distinctes","Avec au moins une correction dans la période")+
    tile(d.gradedWorks.length,"Devoirs notés","Avec une note numérique enregistrée")+
    tile(d.competenceCount,"Compétences évaluées")+
    tile(d.masteryTotal,"Résultats élève–compétence","Un résultat par élève et par compétence")+
    '</div>'+
    '<h4 style="margin:12px 0 7px">Répartition des moyennes des élèves</h4>'+
    '<div class="tracking-summary" style="grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin-top:8px">'+
    bands.map(([key,title])=>tile(d.bins[key],title,d.evaluated?(100*d.bins[key]/d.evaluated).toFixed(1).replace(".",",")+" % des "+d.evaluated+" évalués":"Aucune moyenne")).join("")+
    '</div>'+
    '<p class="small-note" style="margin:9px 0 18px">Moins de 10 /20 : <strong>'+(d.bins.low+d.bins.veryLow)+'</strong> élève(s), dont <strong>'+d.bins.veryLow+'</strong> sous 5 /20. Sans moyenne : '+d.withoutScore+' élève(s) inclus dans la classe.</p>'+
    '<h4 style="margin:10px 0 8px">Devoirs notés et moyennes par devoir</h4>'+
    '<p class="small-note" style="margin:0 0 8px">Évaluations, activités et exercices du trimestre. Les sujets alternatifs d’un même devoir sont regroupés ; chaque note est ramenée sur 20. La moyenne du devoir est calculée sur les élèves comptabilisés dans la moyenne de classe. Les QCU sont gérés séparément dans le calcul des moyennes.</p>'+
    classQuarterGradedWorkTableHTML(d.gradedWorks)+
    '<h4 style="margin:10px 0 8px">Maîtrise globale des compétences évaluées</h4>'+
    '<div class="tracking-summary" style="grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin-top:8px">'+
    masteryLabels.map(([code,title])=>tile(d.mastery[code],title,percent(d.mastery[code]))).join("")+
    '</div>'+
    '<p class="small-note" style="margin:9px 0 12px">Maîtrises satisfaisantes (TBM + MS) : <strong>'+(d.masteryRate===null?"—":d.masteryRate.toFixed(1).replace(".",",")+" %")+'</strong>. Les '+d.masteryTotal+' résultats représentent des couples élève–compétence, et non des évaluations. Dernière maîtrise connue du trimestre pour chaque élève et chaque compétence.</p>'+
    '<h4 style="margin:12px 0 8px">Détail par compétence évaluée</h4>'+
    '<div style="overflow-x:auto"><table class="mastery-table" style="width:100%;min-width:610px"><thead><tr><th>Compétence</th><th>Élèves</th><th>TBM</th><th>MS</th><th>MF</th><th>MI</th><th>TBM + MS</th></tr></thead><tbody>'+detailRows+'</tbody></table></div>'+
    '<p class="small-note" style="margin:7px 0 16px">Chaque ligne représente une compétence distincte, avec un résultat par élève concerné. Les pourcentages sont calculés parmi les élèves évalués dans cette compétence.</p>'+
    '<h4 style="margin:12px 0 8px">Observations et communications</h4>'+
    '<div class="tracking-summary" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:8px">'+
    tile(d.remarks,"Remarques enregistrées")+tile(d.messages,"Mots envoyés")+
    '</div>'+
    '<p class="small-note" style="margin:9px 0 0">Les remarques excluent les participations positives et les traces de messages. Les mots envoyés sont comptés uniquement lorsqu’une trace d’envoi est enregistrée, sans compter les mentions positives.</p>';
}
// Export A4 autonome : ne passe pas par l'overlay d'impression des grilles.
function exportClassQuarterReportPDF(){
  // Ouvrir la fenêtre dès le clic pour éviter le blocage des popups.
  const popup=window.open("about:blank","_blank");
  if(!popup){alert("Le navigateur a bloqué l'export PDF. Autorise les fenêtres surgissantes pour ce site.");return;}
  try{
    const rows=classTrackingRows();
    const d=classQuarterReportData(rows);
    const eligible=rows.filter(s=>classAverageStudentIncluded(s.id));
    const averages={all:[],experimental:[],theory:[]};
    eligible.forEach(student=>{
      const x=studentTrackingScienceAverageDetails(student.evaluations,student.qcu||[],classTrackingClass);
      if(Number.isFinite(x.final))averages.all.push(x.final);
      if(Number.isFinite(x.experimental))averages.experimental.push(x.experimental);
      if(Number.isFinite(x.theory))averages.theory.push(x.theory);
    });
    const sixth=studentTrackingIsSixthGrade(classTrackingClass);
    const roster=behaviorStudentsCache.filter(st=>!classTrackingClass||String(st.classe||"").trim()===String(classTrackingClass).trim());
    const correctionCount=rows.reduce((sum,student)=>sum+student.evaluations.length,0);
    const periodName=({year:"Année scolaire",t1:"Trimestre 1",t2:"Trimestre 2",t3:"Trimestre 3"})[classTrackingPeriod]||"Période sélectionnée";
    const schoolYear=schoolYearStartYear();
    const range=trackingPeriodRange(classTrackingPeriod);
    const periodDates=range.start&&range.end?"Du "+range.start.toLocaleDateString("fr-FR")+" au "+range.end.toLocaleDateString("fr-FR"):"Du 1er septembre au 30 juin";
    const className=classTrackingClass||"Toutes les classes";
    const asText=value=>esc(String(value??""));
    const percent=(n,total)=>total?(100*n/total).toFixed(1).replace(".",",")+" %":"—";
    const bandRows=[
      ["16 à 20 /20",d.bins.high],
      ["10 à 15,99 /20",d.bins.middle],
      ["5 à 9,99 /20",d.bins.low],
      ["Moins de 5 /20",d.bins.veryLow]
    ];
    const masteryRows=[
      ["Très bonne maîtrise (TBM)",d.mastery.TBM],
      ["Maîtrise satisfaisante (MS)",d.mastery.MS],
      ["Maîtrise fragile (MF)",d.mastery.MF],
      ["Maîtrise insuffisante (MI)",d.mastery.MI]
    ];
    const tableRows=(items,total)=>items.map(([label,count])=>
      "<tr><td>"+asText(label)+"</td><td class='num'>"+count+"</td><td class='num'>"+percent(count,total)+"</td></tr>"
    ).join("");
    const stat=(value,label)=>'<div class="stat"><strong>'+asText(value)+'</strong><span>'+asText(label)+'</span></div>';
    const generalAppreciation=String(document.getElementById("general-class-appreciation")?.value||"").trim();
    const title="Bilan "+className+" - "+periodName+" - "+schoolYear;
    const html='<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>'+asText(title)+'</title><style>'+
      '@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#283b32;background:#fff;font-size:10pt;line-height:1.35}'+
      '.toolbar{display:flex;align-items:center;justify-content:space-between;background:#edf3ec;padding:12px 15px;margin-bottom:15px;gap:10px}.toolbar button{border:0;border-radius:6px;background:#3c674b;color:white;padding:9px 14px;font-size:10pt;cursor:pointer}'+
      'h1{font-family:Georgia,serif;color:#31573c;font-size:19pt;margin:0 0 4px}h2{font-family:Georgia,serif;color:#31573c;font-size:12pt;margin:14px 0 7px;padding-bottom:4px;border-bottom:1px solid #cbd8c6}'+
      '.meta{color:#64746c;font-size:9pt;margin:0 0 12px}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:0 0 12px}.stat{background:#f2f6ef;border:1px solid #dbe5d8;border-radius:6px;padding:9px 6px;text-align:center;min-height:58px}.stat strong{font-size:14pt;color:#31573c;display:block;white-space:nowrap}.stat span{font-size:7.5pt;color:#56675c;display:block;margin-top:4px}'+
      '.cols{display:grid;grid-template-columns:1fr 1fr;gap:15px;align-items:start}table{width:100%;border-collapse:collapse;margin:0 0 5px}th,td{border-bottom:1px solid #dce4d9;padding:6px 5px;text-align:left;font-size:9pt}th{background:#eaf1e8;color:#31573c}td.num,th.num{text-align:right;white-space:nowrap}tr{break-inside:avoid}'+
      '.note{font-size:8pt;color:#69746e;margin:6px 0 10px}.foot{font-size:8pt;color:#68786d;border-top:1px solid #d5dfd2;margin-top:15px;padding-top:8px}.appreciation{background:#f7faf5;padding:9px 12px;border-left:3px solid #719275;white-space:pre-wrap;overflow-wrap:anywhere;font-size:9pt}'+
      '@media print{.toolbar{display:none!important}h2,.stats,.cols,.appreciation{break-inside:avoid-page;page-break-inside:avoid}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'+
      '</style></head><body>'+
      '<div class="toolbar"><strong>Prévisualisation du bilan</strong><button type="button" onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>'+
      '<h1>Bilan trimestriel — '+asText(className)+'</h1>'+
      '<p class="meta">'+asText(periodName)+' · '+asText(schoolYear+"-"+(schoolYear+1))+' · '+asText(periodDates)+'</p>'+
      '<div class="stats">'+stat(formatAverage20(averages.all),"Moyenne générale /20")+
      (sixth?stat(formatAverage20(averages.experimental),"Expérimentale /20")+stat(formatAverage20(averages.theory),"Théorie /20"):"")+
      stat(roster.length,"Élèves inscrits")+stat(correctionCount,"Corrections")+
      stat(d.evaluationCount,"Évaluations distinctes")+stat(d.gradedWorks.length,"Devoirs notés")+stat(d.competenceCount,"Compétences évaluées")+
      stat(d.masteryTotal,"Résultats élève–compétence")+'</div>'+
      '<div class="cols"><section><h2>Répartition des résultats</h2>'+
      '<table><thead><tr><th>Moyenne</th><th class="num">Élèves</th><th class="num">Part</th></tr></thead><tbody>'+
      tableRows(bandRows,d.evaluated)+'</tbody></table>'+
      '<p class="note"><strong>'+d.evaluated+'</strong> élève(s) avec moyenne · <strong>'+d.withoutScore+'</strong> sans moyenne · <strong>'+(d.bins.low+d.bins.veryLow)+'</strong> sous 10 /20, dont '+d.bins.veryLow+' sous 5 /20.</p></section>'+
      '<section><h2>Maîtrise des compétences</h2>'+
      '<table><thead><tr><th>Niveau</th><th class="num">Résultats</th><th class="num">Part</th></tr></thead><tbody>'+
      tableRows(masteryRows,d.masteryTotal)+'</tbody></table>'+
      '<p class="note"><strong>'+(d.masteryRate===null?"—":d.masteryRate.toFixed(1).replace(".",",")+" %")+'</strong> TBM ou MS · '+d.masteryTotal+' résultats élève–compétence, non '+d.masteryTotal+' évaluations.</p></section></div>'+
      '<h2>Devoirs notés et moyennes par devoir</h2>'+
      '<table><thead><tr><th>Devoir</th><th>Type</th><th class="num">Notes</th><th class="num">Moyenne /20</th></tr></thead><tbody>'+
      (d.gradedWorks.length?d.gradedWorks.map(w=>'<tr><td>'+asText(w.title)+(w.subjects>1?' ('+w.subjects+' sujets)':'')+'</td><td>'+asText(classQuarterGradedWorkType(w.type))+'</td><td class="num">'+w.graded+'</td><td class="num">'+(w.average===null?"—":w.average.toFixed(2).replace(".",","))+'</td></tr>').join(""):'<tr><td colspan="4">Aucun devoir noté dans la période</td></tr>')+
      '</tbody></table>'+
      '<p class="note">Notes normalisées sur 20 ; sujets alternatifs regroupés. Moyennes calculées sur les élèves retenus dans la moyenne de classe. Les QCU sont pris en compte séparément selon la règle habituelle.</p>'+
      '<h2>Détail par compétence évaluée</h2>'+
      '<table><thead><tr><th>Compétence</th><th class="num">Élèves</th><th class="num">TBM</th><th class="num">MS</th><th class="num">MF</th><th class="num">MI</th><th class="num">TBM+MS</th></tr></thead><tbody>'+
      d.byCompetency.map(c=>'<tr><td>'+asText(c.name)+'</td><td class="num">'+c.total+'</td><td class="num">'+c.TBM+'</td><td class="num">'+c.MS+'</td><td class="num">'+c.MF+'</td><td class="num">'+c.MI+'</td><td class="num">'+percent(c.satisfactory,c.total)+'</td></tr>').join("")+
      '</tbody></table>'+
      '<h2>Comportement et communications</h2>'+
      '<div class="stats">'+stat(d.remarks,"Remarques enregistrées")+stat(d.messages,"Mots envoyés")+'</div>'+
      (generalAppreciation?'<h2>Appréciation générale de la classe</h2><div class="appreciation">'+asText(generalAppreciation)+'</div>':"")+
      '<p class="foot">Bilan généré depuis le suivi de classe. Notes calculées selon les règles du site, avec exclusion des élèves non comptabilisés dans la moyenne de classe. Maîtrise : dernière observation du trimestre par élève et compétence. Les mots envoyés sont distincts des remarques, et les mentions positives ne sont pas comptées parmi les mots.</p>'+
      '<script>window.addEventListener("load",function(){window.focus();window.print();},{once:true});<\/script></body></html>';
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
  }catch(e){
    if(popup&&!popup.closed)popup.close();
    alert("Impossible de générer le bilan PDF : "+(e?.message||e));
  }
}

function updateClassQuarterReport(){
  const target=document.getElementById("class-quarter-report");
  if(target)target.innerHTML=classQuarterReportHTML(classTrackingRows());
}

// Onglets du suivi de classe : présentation uniquement, sans modifier les calculs.
let classTrackingActiveTab = "bilan";
function setClassTrackingTab(tab){
  if(!["bilan","eleves","appreciations"].includes(tab))return;
  classTrackingActiveTab=tab;
  document.querySelectorAll("[data-class-tracking-panel]").forEach(panel=>{
    panel.classList.toggle("hidden",panel.dataset.classTrackingPanel!==tab);
  });
  document.querySelectorAll("[data-class-tracking-tab]").forEach(button=>{
    const selected=button.dataset.classTrackingTab===tab;
    button.classList.toggle("primary",selected);
    button.setAttribute("aria-pressed",String(selected));
  });
}
function installClassTrackingTabs(){
  const sections=Array.from(content.children).filter(el=>el.tagName==="SECTION"&&el.classList.contains("hero"));
  if(sections.length<4)return;
  const [intro,details,general,appreciations]=sections;
  const summary=details.querySelector(".tracking-summary");
  if(!summary)return;
  const legend=details.nextElementSibling?.classList.contains("criteria-box")?details.nextElementSibling:null;

  const tabs=document.createElement("nav");
  tabs.className="row";
  tabs.style.cssText="gap:8px;margin:14px 0 18px;";
  tabs.setAttribute("aria-label","Rubriques du suivi de classe");
  tabs.innerHTML='<button type="button" data-class-tracking-tab="bilan" onclick="setClassTrackingTab(\'bilan\')">📊 Bilan général</button>'+
    '<button type="button" data-class-tracking-tab="eleves" onclick="setClassTrackingTab(\'eleves\')">👥 Élèves</button>'+
    '<button type="button" data-class-tracking-tab="appreciations" onclick="setClassTrackingTab(\'appreciations\')">💬 Appréciations</button>';

  const makePanel=key=>{const panel=document.createElement("div");panel.dataset.classTrackingPanel=key;return panel;};
  const bilanPanel=makePanel("bilan");
  const elevesPanel=makePanel("eleves");
  const appreciationsPanel=makePanel("appreciations");
  intro.insertAdjacentElement("afterend",tabs);
  tabs.insertAdjacentElement("afterend",bilanPanel);
  bilanPanel.insertAdjacentElement("afterend",elevesPanel);
  elevesPanel.insertAdjacentElement("afterend",appreciationsPanel);

  const summarySection=document.createElement("section");
  summarySection.className="hero";
  summarySection.style.marginTop="14px";
  summarySection.appendChild(summary);
  bilanPanel.appendChild(summarySection);
  const report=document.createElement("section");
  report.className="hero";
  report.style.marginTop="14px";
  const actions=document.createElement("div");
  actions.className="row";
  actions.style.cssText="margin:0 0 12px;justify-content:flex-end";
  const pdfButton=document.createElement("button");
  pdfButton.type="button";
  pdfButton.className="primary";
  pdfButton.textContent="📄 Exporter le bilan en PDF";
  pdfButton.addEventListener("click",exportClassQuarterReportPDF);
  actions.appendChild(pdfButton);
  report.appendChild(actions);
  const reportBody=document.createElement("div");
  reportBody.id="class-quarter-report";
  reportBody.innerHTML=classQuarterReportHTML(classTrackingRows());
  report.appendChild(reportBody);
  bilanPanel.appendChild(report);
  bilanPanel.appendChild(general);
  elevesPanel.appendChild(details);
  if(legend)elevesPanel.appendChild(legend);
  appreciationsPanel.appendChild(appreciations);
  setClassTrackingTab(classTrackingActiveTab);
}
function renderClassTracking(){
  if(loadEvalNav().view==='behaviorTracking'){renderBehaviorTracking();return;}
  label.textContent="Suivi de classe";
  saveEvalNav({view:"classTracking",classe:classTrackingClass,period:classTrackingPeriod});
  loadBehaviorEvents();
  const classes=[...new Set([
    ...Object.values(CLASSES).flat(),
    ...studentsCache.map(s=>s.classe),
    ...studentTrackingCache.flatMap(c=>
  Array.isArray(c.evaluation?.assignedClasses)&&c.evaluation.assignedClasses.length
    ? c.evaluation.assignedClasses
    : [c.evaluation?.classe]
),
    ...behaviorStudentsCache.map(s=>s.classe),
    ...behaviorEventsCache.map(e=>e.classe)
  ].map(x=>String(x||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr",{numeric:true,sensitivity:"base"}));
  if(classTrackingClass && !classes.includes(classTrackingClass))classTrackingClass=classes[0]||"";
  const rows=classTrackingRows();
  const roster=behaviorStudentsCache.filter(s=>!classTrackingClass||String(s.classe||"").trim()===String(classTrackingClass).trim());
  const allCompetencies=[...new Set(rows.flatMap(s=>s.competencies.map(x=>x.competence)))]
    .sort((a,b)=>a.localeCompare(b,"fr"));
  let totalEvaluations=0;
  const distribution={TBM:0,MS:0,MF:0,MI:0};
  const classScores=[];
  const classExperimentalScores=[];
  const classTheoryScores=[];
  const isSixthGradeClass=studentTrackingIsSixthGrade(classTrackingClass);
  rows.forEach(s=>{
    totalEvaluations+=s.evaluations.length;
    const details=studentTrackingScienceAverageDetails(s.evaluations,s.qcu||[],classTrackingClass);
    if(classAverageStudentIncluded(s.id)){
      if(Number.isFinite(details.final))classScores.push(details.final);
      if(isSixthGradeClass&&Number.isFinite(details.experimental))classExperimentalScores.push(details.experimental);
      if(isSixthGradeClass&&Number.isFinite(details.theory))classTheoryScores.push(details.theory);
    }
    s.competencies.forEach(x=>distribution[x.mastery.code]=(distribution[x.mastery.code]||0)+1);
  });
  const classAverage=formatAverage20(classScores);
  const classExperimentalAverage=formatAverage20(classExperimentalScores);
  const classTheoryAverage=formatAverage20(classTheoryScores);
  const rosterRows=roster.map(s=>{
    const events=behaviorEventsForStudent(s.nom,s.classe,classTrackingPeriod,s.id);
    const counts=behaviorCounts(events);
    return `<label class="behavior-roster-row" style="display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 10px;border-bottom:1px solid #eee;cursor:pointer"><input type="checkbox" class="behavior-student-check" value="${esc(s.id)}"><span style="min-width:0"><strong>${esc(s.nom||"Élève")}</strong></span><span class="small-note">${events.length?`${events.length} observation(s)`:"—"}</span></label>`;
  }).join("");
  const behaviorButtons=BEHAVIOR_TYPES.map(m=>`<button type="button" onclick="addBehaviorEventToSelected('${esc(m.code)}')">${m.icon} ${esc(m.label)}</button>`).join("");
  const studentRows=rows.map(s=>{
    const latest={};
    s.competencies.forEach(x=>{
      latest[x.competence]=x;
    });
    const scores=s.evaluations
      .map(trackingScore20)
      .filter(v=>v!==null && Number.isFinite(v));
    const averageDetails=studentTrackingScienceAverageDetails(s.evaluations,s.qcu||[],classTrackingClass);
    const avg=averageDetails.final;
    const classAvg=classScores.length
      ? classScores.reduce((a,b)=>a+b,0)/classScores.length
      : null;
    const includedInClassAverage=classAverageStudentIncluded(s.id);
    const position=!includedInClassAverage
      ? "Non comptabilisé"
      : avg===null || classAvg===null
        ? "—"
        : avg>classAvg+0.05
          ? "🟢 Au-dessus"
          : avg<classAvg-0.05
            ? "🔴 En dessous"
            : "⚪ Dans la moyenne";
    const mastered=[];
    const fragile=[];
    const notEvaluated=[];
    allCompetencies.forEach(name=>{
      const x=latest[name];
      if(!x){
        notEvaluated.push(name);
        return;
      }
      const code=x.mastery?.code||"";
      const label=x.mastery?.label||code||"Non renseignée";
      const item=`${name} (${label})`;
      if(code==="TBM"||code==="MS"){
        mastered.push(item);
      }else if(code==="MF"||code==="MI"){
        fragile.push(item);
      }else{
        notEvaluated.push(item);
      }
    });
    const competencySummary=`
      ${mastered.length?`
        <div style="margin-bottom:6px">
          <strong style="color:#247447">✓ Maîtrisées</strong>
          <div>${mastered.map(esc).join("<br>")}</div>
        </div>`:""}
      ${fragile.length?`
        <div style="margin-bottom:6px">
          <strong style="color:#a34b36">⚠ À retravailler</strong>
          <div>${fragile.map(esc).join("<br>")}</div>
        </div>`:""}
      ${notEvaluated.length?`
        <details style="margin-top:5px">
          <summary style="cursor:pointer;color:#666">
            Non évaluées ou non renseignées (${notEvaluated.length})
          </summary>
          <div style="margin-top:5px">
            ${notEvaluated.map(esc).join("<br>")}
          </div>
        </details>`:""}
      ${!mastered.length&&!fragile.length&&!notEvaluated.length
        ?"—":""}
    `;
    return `<tr class="class-tracking-row" data-student-average="${avg===null?"":avg}">
      <td><button type="button" class="class-student-link" onclick="openStudentTrackingFromClass(${jsArg(s.id)},${jsArg(s.name)},${jsArg(classTrackingClass)},${jsArg(classTrackingPeriod)})" aria-label="Ouvrir le suivi individuel de ${esc(s.name)}" style="border:0;background:transparent;padding:2px 0;color:var(--link,#2563eb);font:inherit;font-weight:700;text-decoration:underline;text-underline-offset:3px;cursor:pointer;text-align:left">${esc(s.name)}</button></td>
      <td><label style="display:flex;align-items:center;gap:6px;white-space:nowrap;font-weight:normal"><input type="checkbox" class="class-average-include" data-student-id="${esc(s.id||"")}" ${includedInClassAverage?"checked":""} ${s.id?"":"disabled"} onchange="saveClassAverageInclusion(this)"><span>Inclure</span></label></td>
      <td>${scores.length}${(s.qcu||[]).length?`<div class="small-note">${s.qcu.length} QCU · ${averageDetails.qcuIncluded?"comptabilisés en théorie":"non comptabilisés"}</div>`:""}</td>
      ${isSixthGradeClass?`<td style="white-space:nowrap;color:#18794e;font-weight:700">${studentTrackingFormatCategoryAverage(averageDetails.experimental)}</td><td style="white-space:nowrap;color:#1d4ed8;font-weight:700">${studentTrackingFormatCategoryAverage(averageDetails.theory)}</td>`:""}
      <td style="white-space:nowrap;font-weight:700">
        ${avg===null?"—":avg.toLocaleString("fr-FR",{
          minimumFractionDigits:2,
          maximumFractionDigits:2
        })+" /20"}
      </td>
      <td class="class-tracking-position" style="white-space:nowrap">${position}</td>
      <td style="min-width:230px">
        ${competencySummary||"—"}
      </td>
    </tr>`;
  }).join("");
  const competencyLegend=allCompetencies.length?`<div class="criteria-box" style="margin-top:16px"><h3 style="margin-top:0">🎯 Compétences suivies</h3><div class="small-note">${allCompetencies.map(x=>`<strong style="display:inline-block;margin:3px 12px 3px 0">${esc(x)}</strong>`).join("")}</div></div>`:"";
  content.innerHTML=`<button type="button" onclick="home()">← Accueil</button>
    <section class="hero" style="margin-top:14px"><span class="eyebrow">Suivi des acquis</span><h2>🏫 Suivi de classe</h2><p class="muted">Consulte les résultats, les moyennes et la maîtrise des compétences. Décoche « Inclure » pour exclure un élève du calcul de la moyenne de classe (par exemple un élève ULIS), sans modifier sa moyenne individuelle. Ce réglage est mémorisé sur cet appareil.</p>
      <div class="tracking-filters"><div><label>Classe</label><select onchange="classTrackingClass=this.value;renderClassTracking()"><option value="">Toutes les classes</option>${classes.map(c=>`<option value="${esc(c)}" ${c===classTrackingClass?"selected":""}>${esc(c)}</option>`).join("")}</select></div><div><label>Période</label><select onchange="classTrackingPeriod=this.value;renderClassTracking()"><option value="year" ${classTrackingPeriod==="year"?"selected":""}>Année</option><option value="t1" ${classTrackingPeriod==="t1"?"selected":""}>Trimestre 1</option><option value="t2" ${classTrackingPeriod==="t2"?"selected":""}>Trimestre 2</option><option value="t3" ${classTrackingPeriod==="t3"?"selected":""}>Trimestre 3</option></select></div></div>
    </section>
    <section class="hero" style="margin-top:14px"><div class="tracking-summary"><div class="tracking-stat"><strong>${roster.length}</strong><span>élève(s)</span></div>
${isSixthGradeClass?`<div class="tracking-stat"><strong style="color:#18794e">${classExperimentalAverage}</strong><span>moyenne de classe · Expérimentale</span></div><div class="tracking-stat"><strong style="color:#1d4ed8">${classTheoryAverage}</strong><span>moyenne de classe · Théorie</span></div>`:""}
<div class="tracking-stat"><strong id="class-tracking-average">${classAverage}</strong><span>${isSixthGradeClass?"moyenne générale de sciences":"moyenne de classe"} /20</span></div><div class="tracking-stat"><strong>${totalEvaluations}</strong><span>correction(s)</span></div></div>
      ${rows.length?`<div style="overflow:auto">

<table class="mastery-table" style="width:100%;table-layout:auto">
  <thead>
    <tr>
      <th>Nom de l’élève</th>
      <th>Dans la moyenne de classe</th>
      <th>Nombre d’évaluations</th>
      ${isSixthGradeClass?`<th>Expérimentale /20</th><th>Théorie /20</th>`:""}
      <th>${isSixthGradeClass?"Moyenne générale de sciences /20":"Moyenne /20"}</th>
      <th>Position par rapport à la moyenne de classe</th>
      <th>Maîtrise des compétences</th>
    </tr>
  </thead>
  <tbody>${studentRows}</tbody>
</table>
</div>`:`<p class="muted">Aucune correction enregistrée pour cette sélection.</p>`}</section>${competencyLegend}
    <section class="hero" style="margin-top:14px">
      <div class="entry-head"><div><h3 style="margin:0">🏫 Appréciation générale de la classe</h3><p class="small-note">Bilan collectif fondé sur les résultats, les compétences, la mémorisation et les observations de la classe. 400 caractères maximum.</p></div><div class="row" style="margin:0;flex-wrap:wrap"><button type="button" class="primary" onclick="generateAndDisplayGeneralClassAppreciation()">✨ Générer l'appréciation générale</button><button type="button" onclick="saveGeneralClassAppreciation()">💾 Enregistrer</button></div></div>
      <textarea id="general-class-appreciation" maxlength="400" rows="4" style="width:100%;margin-top:10px">${esc(loadGeneralClassAppreciation())}</textarea><div class="small-note" style="text-align:right"><span id="general-class-appreciation-count">${loadGeneralClassAppreciation().length}</span> / 400 caractères</div>
    </section>
    <section class="hero" style="margin-top:14px">
      <div class="entry-head"><div><h3 style="margin:0">💬 Appréciations de la classe</h3><p class="small-note">Quatre phrases, 400 caractères maximum par élève. Les textes restent modifiables et enregistrés comme auparavant.</p></div><div class="row" style="margin:0;flex-wrap:wrap"><button type="button" class="primary" onclick="generateAllClassAppreciations()">✨ Générer pour la classe</button><button type="button" onclick="saveAllClassAppreciations()">💾 Enregistrer toutes</button><button type="button" onclick="exportClassAppreciationsPDF()">📄 Exporter en PDF</button><button type="button" onclick="exportClassAppreciationsCSV()">📊 Exporter en CSV</button></div></div>
      ${roster.length?`<div style="display:grid;gap:14px">${roster.map(student=>`<div class="appreciation-box"><label for="class-app-${esc(student.id)}"><strong>${esc(student.nom||"Élève")}</strong></label>${svtAccommodationControl(student.id)}<textarea id="class-app-${esc(student.id)}" class="class-appreciation" data-student-id="${esc(student.id)}" maxlength="400" rows="4" style="width:100%;margin-top:7px">${esc(loadClassAppreciation(student))}</textarea><div class="small-note" style="text-align:right"><span class="appreciation-count">${loadClassAppreciation(student).length}</span> / 400 caractères</div></div>`).join("")}</div>`:`<p class="muted">Aucun élève dans cette classe.</p>`}
    </section>`;
  installClassTrackingTabs();
  document.querySelectorAll(".class-appreciation").forEach(field=>field.addEventListener("input",()=>{const counter=field.parentElement.querySelector(".appreciation-count");if(counter)counter.textContent=field.value.length;}));
  const generalField=document.getElementById("general-class-appreciation");
  if(generalField)generalField.addEventListener("input",()=>{const counter=document.getElementById("general-class-appreciation-count");if(counter)counter.textContent=generalField.value.length;});
}
let classTrackingOpenRequest=0;
async function openClassTracking(){
  if(!correctionAllowLeave())return;
  classTrackingActiveTab="bilan";
  const request=++classTrackingOpenRequest;
  try{
    try{localStorage.setItem(EVAL_NAV_KEY,JSON.stringify({view:"classTracking",classe:classTrackingClass,period:classTrackingPeriod}))}catch(e){}
    if(!evaluationsCache.length)evaluationsCache=await loadEvaluations();
    // Afficher le suivi principal sans attendre les nombreuses requêtes QCU.
    await Promise.all([
      loadStudentTracking(),
      (async()=>{if(typeof window.loadBehaviorEventsAsync==="function")await window.loadBehaviorEventsAsync();else loadBehaviorEvents();})(),
      loadBehaviorStudents()
    ]);
    if(request!==classTrackingOpenRequest)return;
    renderClassTracking();
    // Les résultats QCU complètent ensuite le suivi et actualisent les moyennes.
    loadStudentTrackingQCU().then(()=>{
      if(request===classTrackingOpenRequest && loadEvalNav().view==="classTracking")renderClassTracking();
    }).catch(error=>console.error("Chargement QCU du suivi de classe :",error));
  }catch(e){if(request===classTrackingOpenRequest)showError(e.message)}
}

function exportStudentTrackingPDF(){
  const report=document.getElementById("studentTrackingReport");
  if(!report){alert("Sélectionne un élève avant d’exporter sa fiche.");return;}
  // Ouvrir l'onglet dès le clic : évite le blocage des fenêtres surgissantes.
  const printTab=window.open("about:blank","_blank");
  if(!printTab){alert("Le navigateur a bloqué l’ouverture du nouvel onglet. Autorise les fenêtres surgissantes pour ce site puis réessaie.");return;}
  try{
    const studentName=String(studentTrackingStudent||"Élève");
    const period=String(trackingPeriodLabel(studentTrackingPeriod)||"Période");
    const title=`Suivi élève — ${studentName} — ${period}`;
    const body=report.outerHTML;
    const css=`
      .student-report{display:block!important;margin:0!important}
      .student-report>.hero{margin:0 0 10px!important;box-shadow:none!important;break-inside:avoid;page-break-inside:avoid}
      .student-report-heading{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:12px!important}
      .student-report-average{min-width:170px!important}
      .tracking-table-wrap{overflow:visible!important}
      .student-report-table{width:100%!important;min-width:0!important;table-layout:fixed!important;font-size:9pt!important}
      .student-report-table th,.student-report-table td{padding:5px!important;overflow-wrap:anywhere!important}
      .tracking-report-actions,.tracking-appreciation-actions{display:none!important}
      #generatedAppreciation{width:100%!important;min-height:70px!important;border:1px solid #aaa!important}
      @page{size:A4 portrait;margin:10mm}
      @media print{
        body{background:#fff!important}
        .print-preview-toolbar{display:none!important}
        .print-preview-wrap{width:100%!important;max-width:none!important;box-shadow:none!important;border-radius:0!important}
        .print-preview-page{font-size:10pt!important}
        .student-report-section{break-inside:avoid-page}
        .student-report-table tr{break-inside:avoid;page-break-inside:avoid}
      }
    `;
    printHtmlInCurrentWindow(title,body,css,printTab);
  }catch(e){
    if(!printTab.closed)printTab.close();
    alert("Export de la fiche impossible : "+e.message);
  }
}
async function openStudentTrackingFromClass(studentId,studentName,classe,period){
  studentTrackingReturnToClass=true;
  studentTrackingClass=String(classe||"");
  studentTrackingStudentId=String(studentId||"");
  studentTrackingStudent=String(studentName||"");
  studentTrackingPeriod=String(period||"year");
  await openStudentTracking();
}
async function returnToClassTracking(){
  studentTrackingReturnToClass=false;
  await openClassTracking();
  setClassTrackingTab("eleves");
}
let studentTrackingOpenRequest=0;
async function openStudentTracking(){
  if(!correctionAllowLeave())return;
  const request=++studentTrackingOpenRequest;
  try{
    try{localStorage.setItem(EVAL_NAV_KEY,JSON.stringify({view:"tracking",classe:studentTrackingClass,student:studentTrackingStudent,studentId:studentTrackingStudentId,period:studentTrackingPeriod}))}catch(e){}

    // Afficher immédiatement la fiche à partir des caches déjà constitués
    // dans le suivi de classe. Les données complémentaires arrivent ensuite.
    renderStudentTracking();

    const backgroundLoads=[
      (async()=>{if(!evaluationsCache.length)evaluationsCache=await loadEvaluations();})(),
      loadStudentTracking(),
      (async()=>{if(!behaviorStudentsCache.length)await loadBehaviorStudents();})(),
      (async()=>{if(typeof window.loadBehaviorEventsAsync==="function")await window.loadBehaviorEventsAsync();else loadBehaviorEvents();})(),
      loadStudentTrackingQCU()
    ];
    const results=await Promise.allSettled(backgroundLoads);
    if(request!==studentTrackingOpenRequest||loadEvalNav().view!=="tracking")return;
    const failed=results.find(x=>x.status==="rejected");
    if(failed)console.error("Chargement complémentaire du suivi individuel :",failed.reason);
    renderStudentTracking();
  }catch(e){
    if(request===studentTrackingOpenRequest)showError(e.message);
  }
}
function flattenIndicators(ev){
  const crits=criteriaFromLegacy(ev),items=[];
  crits.forEach((c,ci)=>{
    (c.indicateurs||[]).forEach((it,ii)=>items.push({criterionId:c.id,ci,ii,nom:safe(it.nom),points:Number(it.points||0)}));
  });
  return {crits,items};
}
async function loadEvaluations(){
  const rows=[];
  const pageSize=1000;
  for(let from=0;;from+=pageSize){
    const {data,error}=await sb.from("Evaluations")
      .select("id,titre,classe,total,criteres,exercices,created_at")
      .order("created_at",{ascending:false})
      .order("id",{ascending:true})
      .range(from,from+pageSize-1);
    if(error)throw new Error(error.message);
    const page=data||[];
    rows.push(...page);
    if(page.length<pageSize)break;
  }
  return rows.map(evalNormalize);
}
async function saveEvaluationObject(ev){
  const questions=Array.isArray(ev.competences)
    ? ev.competences
    : [];
  const flatCriteres=questions.flatMap((question,qi)=>
    (question.criteres||[]).map((cr,ci)=>({
      ...cr,
      competenceId:question.bankId||question.id||`comp${qi+1}`,
      competenceNom:question.nom||"Compétence non renseignée",
      questionNumero:Number(question.questionNumero||qi+1),
      questionId:question.id||`comp${qi+1}`
    }))
  );
  const existingExercises=Array.isArray(ev.exercices)
    ? ev.exercices.filter(x=>!(x&&x.__evaluationMeta))
    : [];
  const meta={
    __evaluationMeta:true,
    chapitre:Number(ev.chapitre||0),
typeEvaluation:
  ["activite","exercice"].includes(ev.typeEvaluation)
    ?ev.typeEvaluation
    :"evaluation",
coefficient:
  ["activite","exercice"].includes(ev.typeEvaluation)
    ?0.5
    :1,
    evaluationGroupId:ev.evaluationGroupId||null,
    atelierDocumentId:ev.atelierDocumentId||null,
    classes:Array.isArray(ev.assignedClasses)
      ? [...new Set(
          ev.assignedClasses
            .map(v=>String(v||"").trim())
            .filter(Boolean)
        )]
      : (ev.classe
          ? [String(ev.classe).trim()]
          : []),
    // Nouvelle structure : on conserve les questions séparément.
    questions:questions.map((question,qi)=>({
      id:question.id||`comp${qi+1}`,
      questionNumero:Number(question.questionNumero||qi+1),
      bankId:question.bankId||null,
      nom:question.nom||"Compétence non renseignée"
    }))
  };
  const payload={
    titre:ev.titre,
    classe:ev.classe,
    total:Number(ev.total||0),
    criteres:flatCriteres,
    exercices:[meta,...existingExercises]
  };
  if(ev.id){
    const {data,error}=await sb
      .from("Evaluations")
      .update(payload)
      .eq("id",ev.id)
      .select()
      .maybeSingle();
    if(error)throw new Error(error.message);
    return evalNormalize(data);
  }
  const {data,error}=await sb
    .from("Evaluations")
    .insert(payload)
    .select()
    .maybeSingle();
  if(error)throw new Error(error.message);
  return evalNormalize(data);
}

/*
 * Lorsqu'un barème est modifié, les copies déjà corrigées doivent conserver
 * les indicateurs cochés, mais leurs points et statistiques doivent être
 * recalculés avec les nouveaux points de l'évaluation.
 */
function evaluationRubricSignature(ev){
  return JSON.stringify({
    total:Number(ev?.total||0),
    indicators:criteriaFromLegacy(ev||{}).map(cr=>({
      id:String(cr.id||""),
      indicators:(cr.indicateurs||[]).map(it=>({
        points:Number(it?.points||0)
      }))
    }))
  });
}
function recalculateStoredCorrection(ev,resultat){
  const previous=resultat&&typeof resultat==="object"?resultat:{};
  const selected=previous.points&&typeof previous.points==="object"
    ?previous.points:{};
  const points={...selected};
  const criteriaStats={};
  let score=0;
  criteriaFromLegacy(ev||{}).forEach(cr=>{
    const cid=String(cr.id||"");
    (cr.indicateurs||[]).forEach((it,ii)=>{
      const key=`${cid}_${ii}`;
      const checked=!!selected[key];
      const p=Number(it?.points||0);
      if(checked)score+=p;
      if(!criteriaStats[cid]){
        criteriaStats[cid]={got:0,total:0,checked:0,validated:false,count:0};
      }
      const st=criteriaStats[cid];
      st.count+=1;
      if(checked){
        st.checked+=1;
        st.got+=p;
      }
    });
  });
  Object.values(criteriaStats).forEach(st=>{
    st.percent=st.count?Math.round(st.checked/st.count*100):0;
    st.validated=st.count>0&&(st.checked/st.count)>=(2/3);
  });
  return {...previous,note:score,points,criteriaStats};
}
async function recalculateEvaluationCorrections(ev){
  const {data,error}=await sb.from("EvaluationCorrections")
    .select("id,resultat")
    .eq("evaluation_id",ev.id);
  if(error)throw new Error("Lecture des copies impossible : "+error.message);
  const rows=data||[];
  let updated=0;
  for(const row of rows){
    const resultat=recalculateStoredCorrection(ev,row.resultat);
    const {error:updateError}=await sb.from("EvaluationCorrections")
      .update({resultat})
      .eq("id",row.id);
    if(updateError){
      throw new Error(`Mise à jour interrompue après ${updated}/${rows.length} copie(s) : ${updateError.message}`);
    }
    updated++;
  }
  return updated;
}
function loadEvalNav(){
  try{
    const raw=JSON.parse(localStorage.getItem(EVAL_NAV_KEY)||"null");
    return raw&&typeof raw==="object"?raw:{view:"list",classe:"",evaluationId:null,correctionId:null};
  }catch(e){return {view:"list",classe:"",evaluationId:null,correctionId:null};}
}
function saveEvalNav(patch={}){
  const current=loadEvalNav();
  const next={...current,...patch};
  try{localStorage.setItem(EVAL_NAV_KEY,JSON.stringify(next));}catch(e){}
  return next;
}
function evalCurrentListContext(){
  const nav=loadEvalNav();
  const selected=(document.getElementById("evaluationClassSelect")?.value||nav.classe||localStorage.getItem("EVAL_SELECTED_CLASS")||"").trim();
  return {classe:selected,};
}
function evalReturnToList(extra={}){
  const ctx=evalCurrentListContext();
  saveEvalNav({view:"list",classe:extra.classe!==undefined?extra.classe:ctx.classe,evaluationId:null,correctionId:null});
  if(extra.classe!==undefined){try{localStorage.setItem("EVAL_SELECTED_CLASS",String(extra.classe||""));}catch(e){}}
  return openEvaluations();
}
function evalRememberFromEvaluation(ev,view,extra={}){
  const current=loadEvalNav();
  return saveEvalNav({
    view,
    classe:String(extra.classe!==undefined?extra.classe:(ev?.classe||current.classe||"")).trim(),
    evaluationId:extra.evaluationId!==undefined?extra.evaluationId:(ev?.id||current.evaluationId||null),
    correctionId:extra.correctionId!==undefined?extra.correctionId:(current.correctionId||null)
  });
}
async function openEvaluations(options={}){
  if(!correctionAllowLeave())return;
  const previous=loadEvalNav();
  const requestedClass=options.classe!==undefined?String(options.classe||"").trim():String(previous.classe||localStorage.getItem("EVAL_SELECTED_CLASS")||"").trim();
  saveEvalNav({view:"list",classe:requestedClass,evaluationId:null,correctionId:null});
  try{localStorage.setItem("EVAL_SELECTED_CLASS",requestedClass);}catch(e){}
  label.textContent="Évaluations";
  content.innerHTML=`
    <div class="eval-nav">
      <div class="row"><button type="button" onclick="home()">🏠 Accueil</button></div>
      <div class="row">
        <button type="button" class="primary" onclick="newEvaluation()">＋ Nouvelle évaluation</button>
      </div>
    </div>
    <section class="hero">
      <span class="eyebrow">Évaluations</span>
      <h2>📝 Mes évaluations</h2>
      <p class="muted">Choisis une classe pour afficher les évaluations qui lui sont attribuées.</p>
      <div style="max-width:320px;margin-top:16px">
        <label for="evaluationClassSelect" style="display:block;font-weight:800;margin-bottom:6px">Classe</label>
        <select id="evaluationClassSelect" style="width:100%;padding:11px 13px;border:1px solid var(--b);border-radius:10px;background:#fff;font:inherit">
          <option value="">Choisir une classe…</option>
        </select>
      </div>
      <div class="eval-toolbar" style="margin-top:16px">
        <button class="primary" onclick="newEvaluation()">＋ Nouvelle évaluation</button>
        <button type="button" onclick="newHistoricalEvaluation()">🕘 Ajouter une évaluation antérieure</button>
      </div>
    </section>
    <div id="evaluationList">
      <section class="hero"><p class="muted" style="margin:0">Sélectionne une classe pour afficher ses évaluations.</p></section>
    </div>`;
  try{
    evaluationsCache=await loadEvaluations();
    const select=document.getElementById("evaluationClassSelect");
    if(!select)return;
    const evalClasses=evaluationsCache.map(e=>String(e.classe||"").trim()).filter(Boolean);
    const knownClasses=typeof CLASSES!=="undefined" ? Object.values(CLASSES).flat().filter(Boolean) : [];
    const classes=[...new Set([...knownClasses,...evalClasses])].sort((a,b)=>a.localeCompare(b,"fr",{numeric:true}));
    select.innerHTML='<option value="">Choisir une classe…</option>'+classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
    const nav=loadEvalNav();
    const savedClass=String(options.classe!==undefined?options.classe:(nav.classe||localStorage.getItem("EVAL_SELECTED_CLASS")||"")).trim();
  if(savedClass && classes.includes(savedClass)){
  select.value=savedClass;
  saveEvalNav({
    view:"list",
    classe:savedClass,
    evaluationId:null,
    correctionId:null
  });
  try{
    localStorage.setItem("EVAL_SELECTED_CLASS",savedClass);
  }catch(e){}
  evaluationStatisticsCache =
    await loadEvaluationStatistics(
      evaluationsCache,
      savedClass
    );
  renderEvaluationClass(savedClass);
}
 select.addEventListener("change",async ()=>{
  const selected=select.value||"";
  saveEvalNav({
    view:"list",
    classe:selected,
    evaluationId:null,
    correctionId:null
  });
  try{
    localStorage.setItem("EVAL_SELECTED_CLASS",selected);
  }catch(e){}
  evaluationStatisticsCache={};
  if(selected){
    try{
      evaluationStatisticsCache =
        await loadEvaluationStatistics(evaluationsCache,selected);
    }catch(e){
      console.error("Erreur statistiques évaluations :",e);
      evaluationStatisticsCache={};
    }
  }
  renderEvaluationClass(selected);
});
  }catch(e){showError(e.message)}
}
async function loadEvaluationStatistics(evaluations, classe){
  const selectedClass = String(classe || "").trim();
  if(!selectedClass){
    return {};
  }
  /*
   * =========================================================
   * 1. Récupérer uniquement les élèves de la classe sélectionnée
   * =========================================================
   */
  const studentsQ = await sb
    .from("Eleves")
    .select("id,classe,nom,prenom")
    .eq("classe", selectedClass);
  if(studentsQ.error){
    throw new Error(studentsQ.error.message);
  }
  const students = studentsQ.data || [];
  const studentIds = new Set(
    students.map(s => String(s.id))
  );
  /*
   * =========================================================
   * 2. Garder uniquement les évaluations de chapitre
   * =========================================================
   */
  const normalEvaluations = evaluations.filter(e =>
    !isHistoricalEvaluation(e) &&
    Array.isArray(e.assignedClasses) &&
    e.assignedClasses.includes(selectedClass) &&
    ["evaluation", "activite", "exercice"].includes(
      String(e.typeEvaluation || "evaluation")
    ) &&
    Number(e.chapitre || 0) > 0
  );
  if(!normalEvaluations.length){
    return {};
  }
  const ids = normalEvaluations.map(e => e.id);
  /*
   * =========================================================
   * 3. Récupérer toutes les corrections de ces évaluations
   * =========================================================
   */
  const {data,error} = await sb
    .from("EvaluationCorrections")
    .select(
      "id,evaluation_id,eleve,eleve_id,resultat,created_at"
    )
    .in("evaluation_id", ids);
  if(error){
    throw new Error(error.message);
  }
  /*
   * =========================================================
   * 4. FILTRE ESSENTIEL :
   *    on ne garde que les copies des élèves de la classe
   * =========================================================
   */
  const correctionsByEval = {};
  (data || []).forEach(c => {
    if(!c.eleve_id){
      return;
    }
    const studentId = String(c.eleve_id);
    if(!studentIds.has(studentId)){
      return;
    }
    const evaluationId = String(c.evaluation_id);
    if(!correctionsByEval[evaluationId]){
      correctionsByEval[evaluationId] = [];
    }
    correctionsByEval[evaluationId].push(c);
  });
  /*
   * =========================================================
   * 5. Calcul des statistiques
   * =========================================================
   */
  const result = {};
  normalEvaluations.forEach(ev => {
    const corrections =
      correctionsByEval[String(ev.id)] || [];
    /*
     * -----------------------------
     * Moyenne de la classe
     * -----------------------------
     */
    const scores = corrections
      .map(c =>
        trackingScore20({
          evaluation: ev,
          resultat: c.resultat
        })
      )
      .filter(Number.isFinite);
    const average = scores.length
      ? scores.reduce((a,b)=>a+b,0) / scores.length
      : null;
    /*
     * -----------------------------
     * Regroupement des critères
     * par compétence
     * -----------------------------
     */
    const criteria = criteriaFromLegacy(ev);
    const groups = {};
    criteria.forEach(cr => {
      const gid = cr.competenceId || "comp1";
      if(!groups[gid]){
        groups[gid] = {
          nom: cr.competenceNom || "Compétence évaluée",
          criteres: []
        };
      }
      groups[gid].criteres.push(cr);
    });
    /*
     * -----------------------------
     * Pourcentage de réussite
     * par compétence
     * -----------------------------
     */
    const competencies = {};
    Object.entries(groups).forEach(([gid,comp]) => {
      const values = [];
      corrections.forEach(c => {
        const stats =
          c.resultat?.criteriaStats || {};
        const r = masteryForCompetencyQuestions(
          comp.criteres,
          stats
        );
        if(r.mastery){
          values.push({
            studentId: c.eleve_id
              ? String(c.eleve_id)
              : String(c.eleve || ""),
            value: masteryValue(r.mastery.code),
            mastery: r.mastery
          });
        }
      });
      /*
       * Réussite = MS ou TBM
       */
      const success = values.filter(x =>
        x.mastery.code === "TBM" ||
        x.mastery.code === "MS"
      ).length;
      competencies[gid] = {
        nom: comp.nom,
        total: values.length,
        success,
        percentage: values.length
          ? success / values.length * 100
          : null
      };
    });
    /*
     * -----------------------------
     * Résultat final du sujet
     * -----------------------------
     */
    result[String(ev.id)] = {
      evaluation: ev,
      corrected: corrections.length,
      evaluated: scores.length,
      average,
      competencies
    };
  });
  return result;
}
function evaluationChapterSummaryCard(chapterEvaluations, classe, chapitre){
  const statsList = chapterEvaluations
    .map(e => evaluationStatisticsCache[String(e.id)])
    .filter(Boolean);
  // Les sujets regroupés sont des versions alternatives : chaque copie
  // corrigée correspond à un élève et chaque sujet est pondéré par son effectif.
  // Utiliser explicitement le nombre de copies corrigées affiché dans la carte.
  const weightedStats=statsList
    .filter(s=>Number(s.corrected||0)>0 && Number.isFinite(Number(s.average)))
    .map(s=>({average:Number(s.average),count:Number(s.corrected||0)}));
  const totalEvaluated=weightedStats.reduce((n,x)=>n+x.count,0);
  const chapterAverage=totalEvaluated>0
    ?weightedStats.reduce((n,x)=>n+x.average*x.count,0)/totalEvaluated
    :null;
  const correctedCopies=statsList.reduce((total,s)=>total+Number(s.corrected||0),0);
  const competencyMap={};
  statsList.forEach(stats=>Object.values(stats.competencies||{}).forEach(comp=>{
    if(!Number.isFinite(Number(comp.total))||Number(comp.total)<=0)return;
    const key=String(comp.nom||"Compétence évaluée").trim().toLowerCase();
    if(!competencyMap[key])competencyMap[key]={nom:comp.nom||"Compétence évaluée",success:0,total:0};
    competencyMap[key].success+=Number(comp.success||0);
    competencyMap[key].total+=Number(comp.total||0);
  }));
  const competencyHtml=Object.values(competencyMap).length
    ?Object.values(competencyMap).map(comp=>{
      const percentage=comp.total?comp.success/comp.total*100:null;
      return `<span class="tag">${esc(comp.nom)} : ${percentage!==null?Math.round(percentage)+" %":"—"}</span>`;
    }).join(" ")
    :`<span class="small-note">Aucune compétence corrigée</span>`;
  const averageText =
    chapterAverage !== null
      ? chapterAverage.toFixed(2).replace(".",",") + " /20"
      : "—";
  return `
    <section
      class="eval-card"
      style="
        margin-bottom:18px;
        border:2px solid var(--accent,#2b8a78);
      "
    >

      <div class="entry-head">

        <div>

          <span class="tag">
            ${esc(classe)}
          </span>

          <h3 style="margin-top:7px">
            📊 Évaluation de chapitre ${chapitre}
          </h3>

          <p class="small-note">
            ${chapterEvaluations.length}
            sujet${chapterEvaluations.length>1 ? "s" : ""}
            ·
            ${correctedCopies}
            copie${correctedCopies>1 ? "s" : ""}
            corrigée${correctedCopies>1 ? "s" : ""}
          </p>

        </div>

      </div>

      <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
        <button type="button" onclick="generateEvaluationSummaryPDF(${jsArg(chapterEvaluations[0]?.id)})">📊 Récapitulatif PDF</button>
        <button type="button" onclick="openIndicatorReport(${jsArg(chapterEvaluations[0]?.id)},${jsArg(classe)})">🎯 Bilan des indicateurs</button>
        <button type="button" onclick="openEvaluationAbsences(${jsArg(chapterEvaluations[0]?.id)},${jsArg(classe)})">Absences / non évalués</button>
      </div>

      <div
        class="small-note"
        style="
          margin-top:12px;
          padding:10px 12px;
          background:var(--surface,#f7faf9);
          border-radius:10px;
        "
      >

        <strong>📊 Résultats de l'évaluation</strong>

        · Moyenne :
        <strong>${averageText}</strong>

        ·
        ${correctedCopies}
        copie${correctedCopies>1 ? "s" : ""}
        corrigée${correctedCopies>1 ? "s" : ""}

      </div>

      <div
        class="row"
        style="
          margin-top:10px;
          gap:6px;
          flex-wrap:wrap;
        "
      >

        ${competencyHtml}

      </div>

      <details open style="margin-top:16px">

        <summary
          style="
            cursor:pointer;
            font-weight:800;
            padding:8px 0;
          "
        >
          📝 Sujets de l'évaluation
          (${chapterEvaluations.length})
        </summary>

        <div style="margin-top:10px">

          ${chapterEvaluations
            .map(e => evaluationCard(e, {showSummaryActions:false}))
            .join("")}

        </div>

      </details>

    </section>
  `;
}
async function printAllBlankChapterGrids(chapitre, classe){
  try{
    const selectedClass = String(classe || "").trim();
    const chapterNumber = Number(chapitre || 0);
    if(!selectedClass || !chapterNumber){
      alert("Classe ou chapitre introuvable.");
      return;
    }
    /*
     * =========================================================
     * 1. Récupérer les sujets du chapitre pour cette classe
     * =========================================================
     */
    const chapterEvaluations = evaluationsCache
      .filter(e => {
        const classes =
          Array.isArray(e.assignedClasses)
            ? e.assignedClasses
            : String(e.classe || "")
                .split(",")
                .map(x => x.trim())
                .filter(Boolean);
        return (
          classes.includes(selectedClass) &&
          Number(e.chapitre || 0) === chapterNumber &&
          String(e.typeEvaluation || "") === "evaluation" &&
          !isHistoricalEvaluation(e)
        );
      })
      .sort((a,b) =>
        String(a.titre || "").localeCompare(
          String(b.titre || ""),
          "fr",
          {
            numeric:true,
            sensitivity:"base"
          }
        )
      );
    if(!chapterEvaluations.length){
      alert(
        `Aucune évaluation trouvée pour ${selectedClass}, chapitre ${chapterNumber}.`
      );
      return;
    }
    /*
     * =========================================================
     * 2. Élèves de la classe sélectionnée
     * =========================================================
     */
    const studentsQ = await sb
      .from("Eleves")
      .select("id,classe,nom,prenom")
      .eq("classe",selectedClass)
      .order("nom")
      .order("prenom");
    if(studentsQ.error){
      throw new Error(studentsQ.error.message);
    }
    const students = studentsQ.data || [];
    const studentById = new Map(
      students.map(s => [
        String(s.id),
        s
      ])
    );
    const studentIds = new Set(
      students.map(s => String(s.id))
    );
    /*
     * =========================================================
     * 3. Récupérer toutes les corrections des sujets
     * =========================================================
     */
    const evaluationIds =
      chapterEvaluations.map(e => e.id);
    const correctionsQ = await sb
      .from("EvaluationCorrections")
      .select(
        "id,evaluation_id,eleve,eleve_id,resultat,created_at"
      )
      .in("evaluation_id",evaluationIds)
      .order("created_at",{ascending:true});
    if(correctionsQ.error){
      throw new Error(correctionsQ.error.message);
    }
    /*
     * UNIQUEMENT les corrections des élèves
     * de la classe sélectionnée.
     */
    const corrections =
      (correctionsQ.data || [])
        .filter(c =>
          c.eleve_id &&
          studentIds.has(String(c.eleve_id))
        )
        .map(c => {
          const student =
            studentById.get(String(c.eleve_id));
          return {
            ...c,
            eleve:
              student
                ? studentDisplayName(student)
                : String(c.eleve || "Élève"),
            classe:selectedClass
          };
        });
    if(!corrections.length){
      alert(
        `Aucune grille corrigée pour ${selectedClass} dans le chapitre ${chapterNumber}.`
      );
      return;
    }
    /*
     * =========================================================
     * 4. Construire les grilles corrigées
     * =========================================================
     */
    const pages = [];
    chapterEvaluations.forEach(ev => {
      const evaluationCorrections =
        corrections.filter(c =>
          String(c.evaluation_id) ===
          String(ev.id)
        );
      /*
       * Rien de corrigé pour ce sujet :
       * on ne met pas de page vide.
       */
      if(!evaluationCorrections.length){
        return;
      }
      evaluationCorrections.forEach(c => {
        pages.push(
          correctionGridHtml(
            ev,
            c,
            selectedClass
          )
        );
      });
    });
    if(!pages.length){
      alert(
        `Aucune grille corrigée trouvée pour ${selectedClass} dans le chapitre ${chapterNumber}.`
      );
      return;
    }
    /*
     * =========================================================
     * 5. Un seul PDF contenant toutes les corrections
     * =========================================================
     */
    printHtmlInCurrentWindow(
      `Grilles corrigées — Chapitre ${chapterNumber} — ${selectedClass}`,
      pages.join("")
    );
  }catch(e){
    alert(
      "Génération des grilles corrigées impossible : " +
      e.message
    );
  }
}
async function groupChapterEvaluations(chapitre, classe, type = "evaluation"){
  try{
    const selectedClass=String(classe||"").trim();
    const chapterNumber=Number(chapitre||0);
    const selectedType=["evaluation","activite","exercice"].includes(String(type))?String(type):"evaluation";
    const labels={evaluation:"évaluation de chapitre",activite:"activité",exercice:"exercice"};
    const typeLabel=labels[selectedType];
    if(!selectedClass || !chapterNumber){alert("Classe ou chapitre introuvable.");return;}
    const items=evaluationsCache.filter(e=>{
      const classes=Array.isArray(e.assignedClasses)?e.assignedClasses:String(e.classe||"").split(",").map(x=>x.trim()).filter(Boolean);
      return classes.includes(selectedClass) && Number(e.chapitre||0)===chapterNumber && String(e.typeEvaluation||"evaluation")===selectedType && !isHistoricalEvaluation(e);
    }).sort((a,b)=>String(a.titre||"").localeCompare(String(b.titre||""),"fr",{numeric:true,sensitivity:"base"}));
    if(items.length<2){alert(`Il faut au moins deux sujets de type ${typeLabel} pour les regrouper.`);return;}
    const existing=document.getElementById("groupChapterModal");
    if(existing)existing.remove();
    const modal=document.createElement("div");
    modal.id="groupChapterModal";
    modal.className="pp-modal";
    modal.innerHTML=`<div class="pp-modal-card" style="max-width:720px">
      <div class="section-heading"><div><span class="eyebrow">${esc(typeLabel)}</span><h3 style="margin:4px 0 0">🔗 Regrouper les sujets</h3></div><button type="button" onclick="document.getElementById('groupChapterModal')?.remove()">✕</button></div>
      <p class="muted">Coche uniquement les versions qui correspondent au même travail. Les autres sujets resteront indépendants.</p>
      <div style="display:grid;gap:8px;margin:14px 0">${items.map(e=>`<label style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--b);border-radius:10px;background:#fff"><input type="checkbox" class="group-chapter-check" value="${esc(e.id)}" checked style="width:auto"><span>${esc(e.titre||"Sans titre")}</span></label>`).join("")}</div>
      <div class="row" style="justify-content:flex-end;margin-top:18px"><button type="button" onclick="document.getElementById('groupChapterModal')?.remove()">Annuler</button><button type="button" class="primary" id="confirmGroupChapter">🔗 Regrouper les sujets</button></div>
    </div>`;
    document.body.appendChild(modal);
    document.getElementById("confirmGroupChapter").onclick=async()=>{
      const ids=[...document.querySelectorAll(".group-chapter-check:checked")].map(x=>String(x.value));
      if(ids.length<2){alert("Sélectionne au moins deux sujets à regrouper.");return;}
      const groupId=`${selectedType}group_${Date.now()}`;
      try{
        for(const id of ids){
          const q=await sb.from("Evaluations").select("id,exercices").eq("id",id).maybeSingle();
          if(q.error)throw new Error(q.error.message);
          if(!q.data)throw new Error("Sujet introuvable.");
          const old=Array.isArray(q.data.exercices)?q.data.exercices:[];
          const previousMeta=old.find(x=>x&&x.__evaluationMeta)||{};
          const exercises=old.filter(x=>!(x&&x.__evaluationMeta));
          const meta={...previousMeta,__evaluationMeta:true,evaluationGroupId:groupId,typeEvaluation:selectedType};
          const upd=await sb.from("Evaluations").update({exercices:[meta,...exercises]}).eq("id",id);
          if(upd.error)throw new Error(upd.error.message);
        }
        evaluationsCache=await loadEvaluations();
        modal.remove();
        await openEvaluations({classe:selectedClass});
        alert(`Les ${ids.length} sujets ont été regroupés dans un même travail (${typeLabel}).`);
      }catch(e){alert("Regroupement impossible : "+e.message);}
    };
  }catch(e){alert("Regroupement impossible : "+e.message);}
}
async function generateChapterBilanPDF(chapitre, classe){
  try{
    const selectedClass=String(classe||"").trim();
    const chapterNumber=Number(chapitre||0);
    if(!selectedClass || !chapterNumber){
      alert("Classe ou chapitre introuvable.");
      return;
    }
    const chapterItems=evaluationsCache.filter(e=>{
      const classes=Array.isArray(e.assignedClasses)
        ?e.assignedClasses
        :String(e.classe||"").split(",").map(x=>x.trim()).filter(Boolean);
      return classes.includes(selectedClass)
        && Number(e.chapitre||0)===chapterNumber
        && !isHistoricalEvaluation(e)
        && ["evaluation","activite","exercice"].includes(String(e.typeEvaluation||""));
    });
    if(!chapterItems.length){
      alert(`Aucun élément évalué pour ${selectedClass}, chapitre ${chapterNumber}.`);
      return;
    }
    /*
     * On réutilise les statistiques déjà affichées dans l'onglet
     * Évaluations afin que le bilan du chapitre donne exactement
     * les mêmes taux de réussite que le récapitulatif.
     */
    const stats=await loadEvaluationStatistics(chapterItems,selectedClass);
    Object.assign(evaluationStatisticsCache,stats);
    const studentsQ=await sb.from("Eleves")
      .select("id,classe,nom,prenom")
      .eq("classe",selectedClass)
      .order("nom").order("prenom");
    if(studentsQ.error)throw new Error(studentsQ.error.message);
    const students=studentsQ.data||[];
    const studentIds=new Set(students.map(s=>String(s.id)));
    const ids=chapterItems.map(e=>e.id);
    const correctionsQ=await sb.from("EvaluationCorrections")
      .select("id,evaluation_id,eleve,eleve_id,resultat,created_at")
      .in("evaluation_id",ids)
      .order("created_at",{ascending:true});
    if(correctionsQ.error)throw new Error(correctionsQ.error.message);
    const corrections=(correctionsQ.data||[])
      .filter(c=>c.eleve_id && studentIds.has(String(c.eleve_id)));
    const getGroupId=e=>{
      const meta=(Array.isArray(e.exercices)?e.exercices:[])
        .find(x=>x&&x.__evaluationMeta);
      return String(
        e.evaluationGroupId ||
        meta?.evaluationGroupId ||
        `item_${e.id}`
      );
    };
    const groups={};
    chapterItems.forEach(e=>{
      const gid=getGroupId(e);
      if(!groups[gid])groups[gid]={id:gid,type:e.typeEvaluation,items:[]};
      groups[gid].items.push(e);
    });
    const groupRows=[];
    const competencyMap={};
    const allGroupAverages=[];
    Object.values(groups).forEach(group=>{
      const itemStats=group.items
        .map(e=>evaluationStatisticsCache[String(e.id)])
        .filter(Boolean);
      // Calcul direct sur les notes réellement renseignées : les absents,
      // non-évalués et corrections sans note ne participent pas à la moyenne.
      // Une note explicitement égale à 0 reste bien prise en compte.
      const groupCorrections=corrections.filter(c=>
        group.items.some(e=>String(e.id)===String(c.evaluation_id))
      );
      const latestByStudent=new Map();
      groupCorrections.forEach(c=>{
        const score=trackingScore20({
          evaluation:group.items.find(e=>String(e.id)===String(c.evaluation_id)),
          resultat:c.resultat
        });
        if(!Number.isFinite(score))return;
        const studentId=String(c.eleve_id);
        const previous=latestByStudent.get(studentId);
        const currentTime=new Date(c.created_at||0).getTime()||0;
        const previousTime=new Date(previous?.created_at||0).getTime()||0;
        if(!previous||currentTime>=previousTime)latestByStudent.set(studentId,{studentId,score,created_at:c.created_at});
      });
      const validGroupScores=[...latestByStudent.values()];
      const average=validGroupScores.length
        ?validGroupScores.reduce((sum,x)=>sum+x.score,0)/validGroupScores.length
        :null;
      const evaluatedStudents=new Set(validGroupScores.map(x=>x.studentId)).size;
      const coefficient=["activite","exercice"].includes(group.type)?0.5:1;
      if(average!==null)allGroupAverages.push({average,coefficient});
      /*
       * Une occurrence = une question portant la compétence.
       * Elle ne dépend donc jamais du nombre d'élèves.
       */
      group.items.forEach(ev=>{
        const criteria=criteriaFromLegacy(ev);
        const compGroups={};
        criteria.forEach(cr=>{
          const key=String(cr.competenceId||"comp1");
          if(!compGroups[key]){
            compGroups[key]={
              nom:cr.competenceNom||"Compétence évaluée",
              criteres:[]
            };
          }
          compGroups[key].criteres.push(cr);
        });
        Object.values(compGroups).forEach(comp=>{
          const key=String(comp.nom||"Compétence évaluée").trim().toLowerCase();
          const questionCount=new Set(
            comp.criteres.map(cr=>String(cr.questionId||`q${cr.questionNumero||1}`))
          ).size;
          if(!competencyMap[key]){
            competencyMap[key]={
              nom:comp.nom||"Compétence évaluée",
              occurrenceCount:0,
              successCount:0,
              successTotal:0,
              masteryValues:[]
            };
          }
          competencyMap[key].occurrenceCount+=questionCount;
          const subjectStats=evaluationStatisticsCache[String(ev.id)];
          const subjectComp=subjectStats
            ?Object.values(subjectStats.competencies||{})
              .find(x=>String(x.nom||"").trim().toLowerCase()===key)
            :null;
          if(subjectComp && Number(subjectComp.total)>0){
            competencyMap[key].successCount+=Number(subjectComp.success||0);
            competencyMap[key].successTotal+=Number(subjectComp.total||0);
          }
          corrections
            .filter(c=>String(c.evaluation_id)===String(ev.id))
            .forEach(c=>{
              const m=masteryForCompetencyQuestions(
                comp.criteres,
                c.resultat?.criteriaStats||{}
              ).mastery;
              if(m)competencyMap[key].masteryValues.push(masteryValue(m.code));
            });
        });
      });
      const corrected=evaluatedStudents;
      groupRows.push({
        label:group.type==="activite"?"🧪 Activité":group.type==="exercice"?"✏️ Exercice":"📝 Évaluation",
        title:group.items.length===1
          ?group.items[0].titre
          :`Évaluation de chapitre — ${group.items.length} sujets`,
        average,
        corrected,
        evaluated:evaluatedStudents,
        classSize:students.length
      });
    });
    /* Moyenne pondérée du bilan : activité/exercice = 0,5 ; évaluation = 1. */
    const totalPondere=allGroupAverages.reduce((s,x)=>s+x.average*x.coefficient,0);
    const totalCoefficients=allGroupAverages.reduce((s,x)=>s+x.coefficient,0);
    const chapterAverage=totalCoefficients>0
      ?totalPondere/totalCoefficients
      :null;
    const competencyRows=Object.values(competencyMap)
      .map(comp=>{
        const success=comp.successTotal>0
          ?comp.successCount/comp.successTotal*100
          :null;
        const avg=comp.masteryValues.length
          ?comp.masteryValues.reduce((a,b)=>a+b,0)/comp.masteryValues.length
          :null;
        return {
          nom:comp.nom,
          count:comp.occurrenceCount,
          success,
          mastery:masteryFromAverage(avg)
        };
      })
      .sort((a,b)=>String(a.nom).localeCompare(String(b.nom),"fr"));
    const escPrint=v=>String(v??"").replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]||m));
    const groupHtml=groupRows.map(g=>`
      <tr>
        <td>${escPrint(g.label)} — ${escPrint(g.title)}</td>
        <td style="text-align:center">${g.evaluated} / ${g.classSize}</td>
        <td style="text-align:center">${g.average!==null?g.average.toFixed(2).replace(".",",")+" /20":"—"}</td>
      </tr>
    `).join("");
    const competencyHtml=competencyRows.length
      ?competencyRows.map(c=>`
        <tr>
          <td>${escPrint(c.nom)}</td>
          <td style="text-align:center">${c.count}</td>
          <td style="text-align:center">${c.success!==null?Math.round(c.success)+" %":"—"}</td>
          <td style="text-align:center"><strong>${c.mastery?escPrint(c.mastery.code):"—"}</strong>${c.mastery?` — ${escPrint(c.mastery.label)}`:""}</td>
        </tr>
      `).join("")
      :`<tr><td colspan="4" style="text-align:center">Aucune compétence corrigée.</td></tr>`;
    const body=`
      <div class="print-page">
        <h1>🧠 Bilan du chapitre ${chapterNumber}</h1>
        <p><strong>Classe :</strong> ${escPrint(selectedClass)} — ${students.length} élève(s) inscrit(s)</p>
        <p class="small-note">Les moyennes sont calculées uniquement à partir des notes effectivement renseignées. Les élèves absents, non évalués ou sans note sont exclus du calcul ; une note de 0 explicitement attribuée est conservée.</p>
        <div class="total" style="font-size:16px">
          Moyenne du chapitre :
          <strong>${chapterAverage!==null?chapterAverage.toFixed(2).replace(".",",")+" /20":"—"}</strong>
        </div>
        <h2>📚 Éléments évalués</h2>
        <table>
          <thead><tr><th>Élément</th><th>Élèves évalués</th><th>Moyenne</th></tr></thead>
          <tbody>${groupHtml}</tbody>
        </table>
        <h2>🎯 Maîtrise des compétences</h2>
        <table>
          <thead><tr><th>Compétence</th><th>Nombre de questions évaluées</th><th>Réussite (MS/TBM)</th><th>Maîtrise moyenne</th></tr></thead>
          <tbody>${competencyHtml}</tbody>
        </table>
      </div>`;
    printHtmlInCurrentWindow(`Bilan du chapitre ${chapterNumber} — ${selectedClass}`,body);
  }catch(e){
    alert("Génération du bilan du chapitre impossible : " + e.message);
  }
}
async function openChapterAnalysis(chapitre, classe){
  if(!correctionAllowLeave())return;
  const selectedClass=String(classe||'').trim();
  const chapterNumber=Number(chapitre||0);
  if(!selectedClass||!chapterNumber){alert('Classe ou chapitre introuvable.');return;}
  content.innerHTML='<section class="hero"><p>Chargement de l’analyse du chapitre…</p></section>';
  try{
    const items=(evaluationsCache||[]).filter(e=>
      evaluationAppliesToClass(e,selectedClass)&&
      Number(e.chapitre||0)===chapterNumber&&
      !isHistoricalEvaluation(e)&&
      ['evaluation','activite','exercice'].includes(String(e.typeEvaluation||''))
    );
    if(!items.length)throw new Error('Aucun élément évalué dans ce chapitre.');
    const ids=items.map(e=>e.id);
    const [sq,cq,aq]=await Promise.all([
      sb.from('Eleves').select('id,classe,nom,prenom').eq('classe',selectedClass).order('nom').order('prenom'),
      sb.from('EvaluationCorrections').select('id,evaluation_id,eleve,eleve_id,resultat,created_at').in('evaluation_id',ids).order('created_at',{ascending:true}),
      sb.from('EvaluationSubjectAssignments').select('eleve_id,evaluation_id,travail_id').eq('classe',selectedClass).in('evaluation_id',ids)
    ]);
    if(sq.error)throw new Error(sq.error.message);
    if(cq.error)throw new Error(cq.error.message);
    const students=sortStudents(sq.data||[]);
    const studentById=new Map(students.map(st=>[String(st.id),st]));
    const assignedByStudent=new Map();
    (aq.error?[]:(aq.data||[])).forEach(a=>{
      const sid=String(a.eleve_id||'');
      if(!sid)return;
      if(!assignedByStudent.has(sid))assignedByStudent.set(sid,new Set());
      assignedByStudent.get(sid).add(String(a.evaluation_id));
    });
    // Une seule correction retenue par élève et sujet : la plus récente.
    const latest=new Map();
    (cq.data||[]).forEach(c=>{
      const sid=String(c.eleve_id||'');
      if(!sid||!studentById.has(sid))return;
      const assigned=assignedByStudent.get(sid);
      if(assigned&&assigned.size&&!assigned.has(String(c.evaluation_id)))return;
      latest.set(`${sid}::${c.evaluation_id}`,c);
    });
    const indicatorMap=new Map();
    const competencyMap=new Map();
    let usableCorrections=0;
    latest.forEach((correction,key)=>{
      const evaluation=items.find(e=>String(e.id)===String(correction.evaluation_id));
      if(!evaluation)return;
      let correctionUsed=false;
      criteriaFromLegacy(evaluation).forEach((cr,ci)=>{
        const indicators=Array.isArray(cr.indicateurs)?cr.indicateurs:[];
        if(!indicators.length)return;
        const result=correction.resultat||{};
        const points=result.points;
        const stats=result.criteriaStats?.[cr.id];
        const usable=points&&typeof points==='object'&&!Array.isArray(points)&&stats&&Number(stats.count)===indicators.length;
        if(!usable)return;
        correctionUsed=true;
        const competence=String(cr.competenceNom||'Compétence non renseignée').trim();
        const compKey=indicatorNameKey(competence)||'competence-non-renseignee';
        if(!competencyMap.has(compKey))competencyMap.set(compKey,{nom:competence,success:0,total:0,students:new Set()});
        const comp=competencyMap.get(compKey);
        indicators.forEach((it,ii)=>{
          const name=String(typeof it==='string'?it:(it.nom||`Indicateur ${ii+1}`)).trim();
          const criterion=String(cr.nom||`Critère ${ci+1}`).trim();
          const keyName=[compKey,indicatorNameKey(criterion),indicatorNameKey(name)].join('|');
          if(!indicatorMap.has(keyName))indicatorMap.set(keyName,{competence,criterion,indicator:name,success:0,total:0,students:new Map(),missedStudents:new Map(),subjects:new Set()});
          const row=indicatorMap.get(keyName);
          row.total++;
          row.subjects.add(evaluation.titre||'Sujet sans titre');
          const student=studentById.get(String(correction.eleve_id));
          row.students.set(String(student.id),student);
          const ok=Boolean(points[`${cr.id}_${ii}`]);
          if(ok){row.success++;comp.success++;}
          else row.missedStudents.set(String(student.id),student);
          comp.total++;
          comp.students.add(String(student.id));
        });
      });
      if(correctionUsed)usableCorrections++;
    });
    const rows=[...indicatorMap.values()].map(r=>({...r,percentage:r.total?Math.round(r.success/r.total*100):null})).sort((a,b)=>(a.percentage??101)-(b.percentage??101)||a.indicator.localeCompare(b.indicator,'fr'));
    const competencies=[...competencyMap.values()].map(c=>({...c,percentage:c.total?Math.round(c.success/c.total*100):null})).sort((a,b)=>(a.percentage??101)-(b.percentage??101)||a.nom.localeCompare(b.nom,'fr'));
    const escA=v=>esc(String(v??''));
    const competencyHtml=competencies.map(c=>`<tr><td><strong>${escA(c.nom)}</strong></td><td>${c.success} / ${c.total}</td><td><strong>${c.percentage}%</strong></td><td>${c.students.size} élève(s) concerné(s)</td></tr>`).join('');
    const weakRows=rows.filter(r=>r.total>0).slice(0,10);
    const weakHtml=weakRows.map(r=>`<tr><td>${escA(r.competence)}</td><td>${escA(r.criterion)}</td><td>${escA(r.indicator)}</td><td>${r.success} / ${r.total}</td><td><strong>${r.percentage}%</strong></td><td><details><summary>${r.missedStudents.size} élève(s) à accompagner</summary>${indicatorStudentList([...r.missedStudents.values()])}</details></td></tr>`).join('');
    const typeCounts={evaluation:items.filter(e=>String(e.typeEvaluation)==='evaluation').length,activite:items.filter(e=>String(e.typeEvaluation)==='activite').length,exercice:items.filter(e=>String(e.typeEvaluation)==='exercice').length};
    saveEvalNav({view:'chapterAnalysis',chapitre:chapterNumber,classe:selectedClass});
    label.textContent='Analyse du chapitre';
    content.innerHTML=`<div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" onclick="openEvaluations({classe:${jsArg(selectedClass)}})">← Mes évaluations</button><button type="button" onclick="openChapterAnalysis(${chapterNumber},${jsArg(selectedClass)})">Actualiser</button><button type="button" class="primary" onclick="printIndicatorReport()">📄 Exporter en PDF</button></div>
      <section class="hero" id="indicatorReportPrint"><span class="eyebrow">${escA(selectedClass)} · Chapitre ${chapterNumber}</span><h2>🔎 Analyse des résultats du chapitre ${chapterNumber}</h2>
      <p>${items.length} élément(s) analysé(s) : ${typeCounts.evaluation} évaluation(s), ${typeCounts.activite} activité(s), ${typeCounts.exercice} exercice(s).</p>
      <p>${students.length} élève(s) inscrit(s) · ${usableCorrections} correction(s) exploitable(s) · ${students.length?Math.max(0,students.length-new Set([...latest.keys()].map(k=>k.split('::')[0])).size):0} élève(s) sans correction retenue.</p>
      <p class="small-note">Les pourcentages sont calculés uniquement sur les indicateurs effectivement renseignés. Les absences, travaux non rendus et résultats non exploitables ne sont pas considérés comme des échecs. Un indicateur répété dans plusieurs travaux contribue à chaque occurrence observée.</p>
      <h3 style="margin-top:20px">🎯 Réussite par compétence</h3><div style="overflow-x:auto"><table class="mastery-table"><thead><tr><th>Compétence</th><th>Indicateurs réussis</th><th>Réussite</th><th>Élèves concernés</th></tr></thead><tbody>${competencyHtml||'<tr><td colspan="4">Aucune donnée exploitable.</td></tr>'}</tbody></table></div>
      <h3 style="margin-top:20px">🚩 Principales difficultés à travailler</h3><p class="small-note">Les indicateurs sont classés du taux de réussite le plus faible au plus élevé. La liste d’élèves correspond aux élèves ayant une réponse exploitable sur cet indicateur.</p><div style="overflow-x:auto"><table class="mastery-table"><thead><tr><th>Compétence</th><th>Critère</th><th>Indicateur</th><th>Réussites</th><th>Taux</th><th>Élèves</th></tr></thead><tbody>${weakHtml||'<tr><td colspan="6">Aucune difficulté calculable pour le moment.</td></tr>'}</tbody></table></div></section>`;
  }catch(e){showError('Analyse du chapitre : '+e.message);}
}
async function generateChapterSummaryPDF(chapitre, classe){
  const selectedClass =
    String(classe || "").trim();
  const chapterNumber =
    Number(chapitre || 0);
  const evaluation =
    evaluationsCache.find(e => {
      const classes =
        Array.isArray(e.assignedClasses)
          ? e.assignedClasses
          : String(e.classe || "")
              .split(",")
              .map(x => x.trim())
              .filter(Boolean);
      return (
        classes.includes(selectedClass) &&
        Number(e.chapitre || 0) === chapterNumber &&
        String(e.typeEvaluation || "") === "evaluation" &&
        !isHistoricalEvaluation(e)
      );
    });
  if(!evaluation){
    alert(
      `Aucune évaluation de chapitre ${chapterNumber} pour ${selectedClass}.`
    );
    return;
  }
  /*
   * La fonction existante construit déjà le
   * récapitulatif complet du chapitre et filtre
   * les élèves de la classe sélectionnée.
   */
  await generateEvaluationSummaryPDF(
    evaluation.id,
    true
  );
}
function switchChapterContentTab(button, panelId){
  const container = button && button.closest('.chapter-tab-container');
  if(!container) return;
  container.querySelectorAll('.chapter-tab-button').forEach(tab=>{
    const active = tab === button;
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.style.background = active ? 'var(--primary, #2563eb)' : 'transparent';
    tab.style.color = active ? '#fff' : 'var(--text, inherit)';
    tab.style.borderColor = active ? 'var(--primary, #2563eb)' : 'var(--b, #ddd)';
  });
  container.querySelectorAll('.chapter-tab-panel').forEach(panel=>{
    panel.hidden = panel.id !== panelId;
  });
}

function renderEvaluationChapter(chapter, classe){
  const evaluations = chapter.evaluations || [];
  const activities = chapter.activities || [];
  const exercises = chapter.exercises || [];
  const chapterKey = `ch${String(chapter.numero).replace(/[^a-zA-Z0-9_-]/g,'_')}_${String(classe).replace(/[^a-zA-Z0-9_-]/g,'_')}`;
  const tabs = [];
  const panels = [];

  const addTab = (key, label, content) => {
    const panelId = `${chapterKey}_${key}`;
    tabs.push(`<button type="button" class="chapter-tab-button" role="tab" aria-selected="${key === 'overview' ? 'true' : 'false'}" onclick="switchChapterContentTab(this,'${panelId}')" style="padding:9px 13px;border:1px solid var(--b,#ddd);border-radius:8px;background:${key === 'overview' ? 'var(--primary, #2563eb)' : 'transparent'};color:${key === 'overview' ? '#fff' : 'var(--text, inherit)'};font-weight:700;cursor:pointer">${label}</button>`);
    panels.push(`<section id="${panelId}" class="chapter-tab-panel" role="tabpanel" ${key === 'overview' ? '' : 'hidden'} style="padding-top:14px">${content}</section>`);
  };

  let overview = `<p class="small-note">${evaluations.length} évaluation(s) · ${activities.length} activité(s) · ${exercises.length} exercice(s)</p>`;
  if(evaluations.length){
    overview += `<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px">
      <button type="button" onclick="event.preventDefault();event.stopPropagation();printAllBlankChapterGrids(${chapter.numero},'${esc(classe)}')">📥 Toutes les grilles</button>
      <button type="button" class="primary" onclick="event.preventDefault();event.stopPropagation();generateChapterSummaryPDF(${chapter.numero},'${esc(classe)}')">📊 Récapitulatif</button>
      <button type="button" onclick="event.preventDefault();event.stopPropagation();openChapterStudentGrids(${chapter.numero},'${esc(classe)}')">📥 Grilles des élèves</button>
      <button type="button" onclick="event.preventDefault();event.stopPropagation();groupChapterEvaluations(${chapter.numero},'${esc(classe)}')">🔗 Regrouper les sujets</button>
      <button type="button" onclick="event.preventDefault();event.stopPropagation();generateChapterBilanPDF(${chapter.numero},'${esc(classe)}')">🧠 Bilan du chapitre</button>
      <button type="button" onclick="event.preventDefault();event.stopPropagation();openChapterAnalysis(${chapter.numero},'${esc(classe)}')">🔎 Analyser les résultats</button>
    </div>`;
  }
  addTab('overview','📖 Chapitre',overview);

  if(evaluations.length){
    addTab('evaluations',`📝 Évaluations (${evaluations.length})`,renderChapterEvaluationGroup(evaluations,classe,chapter.numero));
  }
  if(activities.length){
    addTab('activities',`🧪 Activités (${activities.length})`,activities.map(evaluationCard).join(''));
  }
  if(exercises.length){
    const groupButton = exercises.length>1 ? `<button type="button" onclick="event.preventDefault();event.stopPropagation();groupChapterEvaluations(${chapter.numero},'${esc(classe)}','exercice')">🔗 Regrouper les exercices</button>` : '';
    addTab('exercises',`✏️ Exercices (${exercises.length})`,`${groupButton}<div style="margin-top:10px">${renderGroupedExercises(exercises)}</div>`);
  }

  return `<details class="eval-card" style="margin-bottom:16px;padding:0;overflow:hidden" open>
    <summary style="cursor:pointer;list-style:none;padding:18px;font-size:17px;font-weight:900">📖 Chapitre ${chapter.numero}</summary>
    <div class="chapter-tab-container" style="padding:0 18px 18px;border-top:1px solid var(--b)">
      <div role="tablist" aria-label="Contenu du chapitre ${chapter.numero}" style="display:flex;gap:8px;flex-wrap:wrap;padding-top:14px">${tabs.join('')}</div>
      ${panels.join('')}
    </div>
  </details>`;
}
function renderChapterEvaluationGroup(
  evaluations,
  classe,
  chapitre
){
  /*
   * On garde le regroupement des différents sujets
   * dans une seule "Évaluation de chapitre".
   */
  return evaluationChapterSummaryCard(
    evaluations,
    classe,
    chapitre
  );
}
function renderGroupedExercises(exercises){
  const groups=new Map();
  (exercises||[]).forEach(e=>{
    const groupId=String(e.evaluationGroupId||"").trim();
    const key=groupId?`group:${groupId}`:`single:${e.id}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(e);
  });
  return [...groups.values()].map(items=>{
    if(items.length===1)return evaluationCard(items[0], {showSummaryActions:true});
    const first=items[0];
    const firstTitle=String(first.titre||"Exercice");
    const baseTitle=firstTitle.replace(/\s*:\s*Sujet\s*\d+\s*$/i,"").trim()||firstTitle;
    const statsList=items.map(e=>evaluationStatisticsCache[String(e.id)]).filter(Boolean);
    const correctedCopies=statsList.reduce((sum,stats)=>sum+Number(stats.corrected||0),0);
    // Pondération par le nombre réel de copies corrigées de chaque version.
    const weightedStats=statsList
      .filter(stats=>Number(stats.corrected||0)>0 && Number.isFinite(Number(stats.average)))
      .map(stats=>({average:Number(stats.average),count:Number(stats.corrected||0)}));
    const evaluatedCopies=weightedStats.reduce((sum,x)=>sum+x.count,0);
    const average=evaluatedCopies>0
      ?weightedStats.reduce((sum,x)=>sum+x.average*x.count,0)/evaluatedCopies
      :null;
    const averageText=average!==null?average.toFixed(2).replace(".",",")+" /20":"—";
    const competencyMap=new Map();
    statsList.forEach(stats=>Object.values(stats.competencies||{}).forEach(comp=>{
      if(comp.percentage===null||!Number.isFinite(Number(comp.percentage)))return;
      const key=String(comp.nom||"Compétence évaluée").trim().toLowerCase();
      if(!Number.isFinite(Number(comp.total))||Number(comp.total)<=0)return;
      if(!competencyMap.has(key))competencyMap.set(key,{nom:comp.nom||"Compétence évaluée",success:0,total:0});
      competencyMap.get(key).success+=Number(comp.success||0);
      competencyMap.get(key).total+=Number(comp.total||0);
    }));
    const competencyHtml=competencyMap.size
      ?[...competencyMap.values()].map(comp=>{
          const percentage=comp.total?comp.success/comp.total*100:null;
          return `<span class="tag">${esc(comp.nom)} : ${percentage!==null?Math.round(percentage)+" %":"—"}</span>`;
        }).join(" ")
      :'<span class="small-note">Aucune compétence corrigée</span>';
    return `
      <article class="eval-card" style="margin-bottom:14px;border:2px solid var(--accent,#2b8a78)">
        <div class="entry-head">
          <div>
            <span class="tag">${esc(loadEvalNav().classe||first.classe||"Classe")}</span>
            <h3 style="margin-top:7px">✏️ ${esc(baseTitle)} — ${items.length} sujets</h3>
            <p class="small-note">Versions regroupées du même exercice · ${correctedCopies} copie(s) corrigée(s)</p>
          </div>
        </div>
        <div class="small-note" style="margin-top:12px;padding:10px 12px;background:var(--surface,#f7faf9);border-radius:10px">
          <strong>📊 Résultats de l'exercice</strong> · Moyenne : <strong>${averageText}</strong> · ${correctedCopies} copie(s) corrigée(s)
        </div>
        <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">${competencyHtml}</div>
        <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
          <button type="button" onclick="generateEvaluationSummaryPDF(${jsArg(first.id)})">📊 Récapitulatif PDF</button>
          <button type="button" onclick="openIndicatorReport(${jsArg(first.id)},${jsArg(loadEvalNav().classe||first.classe||"")})">🎯 Bilan des indicateurs</button>
          <button type="button" onclick="openEvaluationAbsences(${jsArg(first.id)},${jsArg(loadEvalNav().classe||first.classe||"")})">Absences / non évalués</button>
        </div>
        <details style="margin-top:10px">
          <summary style="cursor:pointer;font-weight:700">Afficher les ${items.length} sujets</summary>
          <div style="display:grid;gap:10px;margin-top:12px">
            ${items.map(e=>evaluationCard(e,{showSummaryActions:false})).join("")}
          </div>
        </details>
      </article>
    `;
  }).join("");
}
function renderEvaluationClass(selectedClass){
  const target =
    document.getElementById("evaluationList");
  if(!target)return;
  if(!selectedClass){
    target.innerHTML = `
      <section class="hero">

        <p class="muted" style="margin:0">
          Sélectionne une classe pour afficher les évaluations.
        </p>

      </section>
    `;
    return;
  }
  const cls =
    String(selectedClass).trim();
  /*
   * =========================================================
   * Toutes les évaluations/activités de la classe
   * =========================================================
   */
  const classItems =
    evaluationsCache.filter(e =>
      Array.isArray(e.assignedClasses) &&
      e.assignedClasses.includes(cls)
    );
  if(!classItems.length){
    target.innerHTML = `
      <section class="hero">

        <h3>
          Aucune évaluation pour ${esc(cls)}
        </h3>

        <p class="muted">
          Crée une nouvelle évaluation et
          attribue-la à cette classe.
        </p>

        <button
          class="primary"
          onclick="newEvaluation()"
        >
          ＋ Nouvelle évaluation
        </button>

      </section>
    `;
    return;
  }
  /*
   * =========================================================
   * ORGANISATION PAR CHAPITRE
   * =========================================================
   */
  const chapters = {};
  const withoutChapter = [];
  classItems.forEach(e => {
    const chapitre =
      Number(e.chapitre || 0);
    /*
     * Les éléments sans numéro de chapitre
     * restent en dehors des chapitres.
     */
    if(chapitre <= 0){
      withoutChapter.push(e);
      return;
    }
    const key =
      String(chapitre);
    if(!chapters[key]){
      chapters[key] = {
        numero: chapitre,
        evaluations: [],
        activities: [],
        exercises: []
      };
    }
    /*
     * =======================================================
     * ÉVALUATION DE CHAPITRE
     * =======================================================
     */
    if(
      String(e.typeEvaluation || "") === "evaluation" &&
      !isHistoricalEvaluation(e)
    ){
      chapters[key].evaluations.push(e);
      return;
    }
    /*
     * =======================================================
     * ACTIVITÉ
     * =======================================================
     */
    if(String(e.typeEvaluation || "") === "activite"){
      chapters[key].activities.push(e);
      return;
    }
    if(String(e.typeEvaluation || "") === "exercice"){
      chapters[key].exercises.push(e);
      return;
    }
    /*
     * Les évaluations antérieures ou autres éléments
     * restent dans le chapitre mais dans les activités/
     * éléments disponibles.
     */
    chapters[key].activities.push(e);
  });
  /*
   * =========================================================
   * AFFICHAGE DES CHAPITRES
   * =========================================================
   */
  let html = "";
  Object.values(chapters)
    .sort((a,b) =>
      a.numero - b.numero
    )
    .forEach(chapter => {
      html += renderEvaluationChapter(
        chapter,
        cls
      );
    });
  /*
   * =========================================================
   * ÉLÉMENTS SANS CHAPITRE
   * =========================================================
   */
  if(withoutChapter.length){
    html += `
      <details
        class="eval-card"
        style="
          margin-bottom:16px;
          padding:0;
          overflow:hidden;
        "
      >

        <summary
          style="
            cursor:pointer;
            list-style:none;
            padding:18px;
            font-size:17px;
            font-weight:900;
          "
        >
          📁 Sans chapitre
        </summary>

        <div
          style="
            padding:0 18px 18px;
            border-top:1px solid var(--b);
          "
        >

          ${withoutChapter
            .map(evaluationCard)
            .join("")}

        </div>

      </details>
    `;
  }
  target.innerHTML = html;
  target.querySelectorAll("details").forEach(details => {
  details.removeAttribute("open");
});
}
async function getEvaluationById(evalId){
  const cached=evaluationsCache.find(x=>String(x.id)===String(evalId));
  if(cached)return cached;
  const {data,error}=await sb.from("Evaluations").select("*").eq("id",evalId).maybeSingle();
  if(error)throw new Error(error.message);
  if(!data)return null;
  const ev=evalNormalize(data);
  const idx=evaluationsCache.findIndex(x=>String(x.id)===String(evalId));
  if(idx>=0)evaluationsCache[idx]=ev;else evaluationsCache.push(ev);
  return ev;
}
/* Logo dans les documents exportés, indépendant du décor de l'écran. */
function addExportLogos(root){
  if(!root)return;
  const source=document.querySelector('.brand .logo img');
  if(!source?.src)return;
  let targets=[...root.querySelectorAll('.print-page,.correction-student-page,.print-cover')];
  targets=targets.filter(el=>!targets.some(parent=>parent!==el&&parent.contains(el)));
  if(!targets.length)targets=[root.querySelector('.print-preview-page')||root];
  targets.forEach(target=>{
    if(target.querySelector('.svt-export-brand'))return;
    const title=target.querySelector('h1');
    const brand=document.createElement('div');brand.className='svt-export-brand';
    const image=document.createElement('img');image.src=source.src;image.alt='Logo SVT';image.width=48;image.height=48;image.loading='eager';
    brand.appendChild(image);
    if(title){title.parentNode.insertBefore(brand,title);brand.appendChild(title);}
    else{const text=document.createElement('span');text.textContent='SVT · John Legent';brand.appendChild(text);target.insertBefore(brand,target.firstChild);}
  });
}
async function printDocumentWithLogo(root,prepare){
  try{
    addExportLogos(root);
    await Promise.all([...root.querySelectorAll('.svt-export-brand img')].map(image=>image.decode?image.decode():new Promise((resolve,reject)=>{
      if(image.complete){image.naturalWidth?resolve():reject(new Error('Logo non chargé.'));return;}
      image.onload=resolve;image.onerror=()=>reject(new Error('Logo non chargé.'));
    })));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(prepare&&prepare()===false)return false;
    window.print();return true;
  }catch(e){alert('Impression non lancée : '+e.message);return false;}
}
function printHtmlInCurrentWindow(title,bodyHtml,extraCss="",targetWindow=null){
  const overlay=document.getElementById("printOverlay");
  if(!overlay){alert("Zone d'impression introuvable.");return;}
  const previousTitle=document.title;
  document.title=title||previousTitle;
  overlay.innerHTML=`
    <div class="print-preview-wrap">
      <div class="print-preview-toolbar">
        <strong>${String(title||"Aperçu PDF").replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]))}</strong>
        <div class="row" style="gap:8px;margin:0">
          <button type="button" class="primary" onclick="printDocumentWithLogo(document.getElementById('printOverlay'),()=>preparePrintPages())">📥 Télécharger / Enregistrer en PDF</button>
          <button type="button" onclick="closePrintPreview()">✖️ Fermer</button>
        </div>
      </div>

      <div class="print-preview-page">
        <style>
          @page{size:A4 portrait;margin:5mm}

          .print-preview-wrap{
            width:min(100%,1100px);
            margin:0 auto;
            background:#fff;
            border-radius:12px;
            box-shadow:0 20px 60px rgba(0,0,0,.25);
            overflow:hidden
          }

          .print-preview-toolbar{
            position:sticky;
            top:0;
            z-index:2;
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:12px;
            padding:12px 16px;
            background:#fff;
            border-bottom:1px solid #ddd
          }

          .print-preview-toolbar .row{
            display:flex;
            align-items:center
          }

          *{box-sizing:border-box}

          .print-preview-page{
            background:#fff;
            font-size:12px;
            line-height:1.34
          }

          .print-preview-page h1{font-size:24px;margin:0 0 7px}
          .print-preview-page h2{font-size:17px;margin:10px 0 6px;border-bottom:2px solid #333;padding-bottom:4px}
          .print-preview-page h3{font-size:15px;margin:9px 0 5px}
          .print-preview-page h4{font-size:14px;margin:0 0 4px}

          .print-preview-page table{
            width:100%;
            border-collapse:collapse;
            table-layout:fixed
          }

          .print-preview-page th,
          .print-preview-page td{
            border:1px solid #555;
            padding:7px;
            vertical-align:top
          }

          .print-preview-page th{
            background:#f0f0f0;
            text-align:left
          }

          .print-preview-page .points{font-size:10px;color:#555}
          .print-preview-page .ipt{float:right;color:#555;font-size:10px}
          .print-preview-page .scoreline{margin-bottom:8px}
          .print-preview-page .total{margin-top:10px;border:1px solid #555;padding:8px;font-weight:bold}
          .print-preview-page .blank{margin-top:10px;border:1px solid #555;padding:8px;min-height:25mm}
          .print-preview-page .footer{margin-top:8px;font-size:9px;color:#666}

          .print-preview-page .criterion{
            border:1px solid #d8dfdc;
            border-radius:7px;
            padding:9px;
            margin:8px 0
          }

          .print-preview-page .criterion ul{
            list-style:none;
            padding:0;
            margin:5px 0
          }

          .print-preview-page .criterion li{padding:3px 0}
          .print-preview-page .criterion li span{float:right;color:#667085}
          .print-preview-page .checked{font-weight:600}
          .print-preview-page .unchecked{color:#777}

          .print-preview-page .mastery{
            background:#f3f6f5;
            border-radius:7px;
            padding:9px;
            margin-top:8px
          }
/* =========================================================
   GRILLES CORRIGÉES — 1 TABLEAU PAR QUESTION
   2 CRITÈRES PAR LIGNE
   ========================================================= */
























          /* Une grille corrigée = une feuille A4 */
          

          

          

          /* Réduction de la grille : elle reste lisible tout en tenant sur A4 */
          

          

          

          

          

          

          

          

          

          

          

          ${extraCss}

          @media  print{
            html,body{
              margin:0!important;
              padding:0!important;
              background:#fff!important
            }

            /* Safari : masquer explicitement l'interface, sans sélecteur :not() */
            body > header,
            body > main,
            body > footer{
              display:none!important;
            }

            body > #printOverlay{
              display:block!important;
              visibility:visible!important;
              opacity:1!important;
              position:static!important;
              inset:auto!important;
              width:100%!important;
              height:auto!important;
              min-height:0!important;
              margin:0!important;
              padding:0!important;
              background:#fff!important;
              overflow:visible!important;
              color:#111!important;
            }

            #printOverlay,
            #printOverlay *{
              visibility:visible!important;
              opacity:1!important;
            }

            .print-preview-wrap{
              width:100%!important;
              margin:0!important;
              padding:0!important;
              box-shadow:none!important;
              border-radius:0!important;
              overflow:visible!important
            }

            .print-preview-toolbar{
              display:none!important
            }

            .print-preview-page{
              width:100%!important;
              margin:0!important;
              padding:0!important;
              background:#fff!important;
              -webkit-print-color-adjust:exact;
              print-color-adjust:exact
            }

            



            
          }
        </style>

        <style>
.print-preview-page .svt-a4-grid{width:200mm!important;min-height:0!important;height:auto!important;padding:2mm!important;margin:0 auto 8mm!important;background:white;box-sizing:border-box;font:11pt/1.18 Arial,sans-serif!important;color:#111}
.svt-a4-grid *{overflow-wrap:anywhere}
.print-preview-page .svt-a4-grid h1{font-size:16pt!important;margin:0 0 3mm!important}
.print-preview-page .svt-a4-grid h2{font-size:11pt!important;border:0!important;background:#edf2ef;padding:1.2mm!important;margin:2mm 0 1mm!important}
.print-preview-page .svt-a4-grid small{font-size:10pt!important}
/* Bordures explicites pour conserver le quadrillage dans Firefox à l’impression */
.print-preview-page .svt-a4-grid table{width:100%!important;table-layout:fixed!important;border-collapse:separate!important;border-spacing:0!important;font-size:inherit!important;print-color-adjust:exact!important;-webkit-print-color-adjust:exact!important}
.print-preview-page .svt-a4-grid table th,
.print-preview-page .svt-a4-grid table td{padding:1.2mm!important;border:1px solid #333!important;border-style:solid!important;border-color:#333!important;background-clip:padding-box!important;font-size:inherit!important;line-height:inherit!important;print-color-adjust:exact!important;-webkit-print-color-adjust:exact!important}
.print-preview-page .svt-a4-grid table tr{break-inside:avoid!important;page-break-inside:avoid!important}
.print-preview-page .svt-a4-grid .a4-question tbody tr.a4-criterion-row{break-inside:avoid!important;page-break-inside:avoid!important}
.print-preview-page .svt-a4-grid .a4-question tbody tr.a4-criterion-row td{border-top:1px solid #777!important;border-bottom:1px solid #777!important;vertical-align:top!important}
.print-preview-page .svt-a4-grid .criterion-score{display:inline-block;font-weight:700;color:#222;margin:1mm 0}
.svt-a4-grid .a4-identity{display:flex;gap:3mm;flex-wrap:wrap;margin-bottom:2mm}
.svt-a4-grid .a4-summary{margin-bottom:2mm}
.print-preview-page .svt-a4-grid.a4-dense{font-size:10pt!important;line-height:1.12!important}
.print-preview-page .svt-a4-grid.a4-dense td,.print-preview-page .svt-a4-grid.a4-dense th{padding:.7mm!important}
@media  print{
.print-preview-page .svt-a4-grid{
  width:200mm!important;
  margin:0!important;
  break-after:page!important;
  page-break-after:always!important;
  break-inside:auto!important;
}
.print-preview-page .svt-a4-grid .a4-recap{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:2mm;
  margin:0 0 2mm;
}

.print-preview-page .svt-a4-grid .a4-recap-box{
  border:1px solid #999;
  padding:1.5mm;
  font-size:10.5pt;
  line-height:1.15;
}

.print-preview-page .svt-a4-grid .a4-ok{
  background:#eef7ef;
}

.print-preview-page .svt-a4-grid .a4-todo{
  background:#fff4e8;
}

.print-preview-page .svt-a4-grid .a4-recap-box strong{
  display:block;
  margin-bottom:1mm;
}

@media  print{
  .print-preview-page .svt-a4-grid .a4-recap{
    break-inside:avoid!important;
    page-break-inside:avoid!important;
  }
}
.print-preview-page .svt-a4-grid .a4-question{
  break-inside:avoid!important;
  page-break-inside:avoid!important;
}

.print-preview-page .svt-a4-grid .a4-summary,
.print-preview-page .svt-a4-grid .a4-identity{
  break-inside:avoid!important;
  page-break-inside:avoid!important;
}

.print-preview-page .svt-a4-grid:last-child{break-after:auto!important;page-break-after:auto!important}
}
</style>
        ${bodyHtml}
      </div>
    </div>`;
  addExportLogos(overlay);
  if(targetWindow && !targetWindow.closed){
    const titleText=String(title||"Aperçu PDF");
    // Les feuilles de style relatives ne se chargent pas correctement depuis about:blank
    // dans Safari. On les convertit en URL absolues et on fixe l'URL de base du document.
    const headAssets=[...document.head.querySelectorAll('style,link[rel="stylesheet"]')]
      .map(node=>{
        if(node.tagName==='LINK')return `<link rel="stylesheet" href="${node.href}">`;
        return node.outerHTML;
      }).join("\n");
    const baseHref=String(document.baseURI||location.href).replace(/[&<>\"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
    const tabContent=overlay.innerHTML
      .replace(/onclick="printDocumentWithLogo\([^\"]*"/,'onclick="window.print()"')
      .replace(/onclick="closePrintPreview\(\)"/,'onclick="window.close()"');
    targetWindow.document.open();
    targetWindow.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${baseHref}"><title>${String(titleText).replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]))}</title>${headAssets}<style>
      html,body{margin:0!important;padding:12px!important;background:#e8e8e8!important}
      #printOverlay{display:block!important;position:static!important;inset:auto!important;background:transparent!important;z-index:auto!important;padding:0!important;overflow:visible!important}
      @media print{
        html,body{display:block!important;visibility:visible!important;width:auto!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;overflow:visible!important;background:#fff!important}
        body{position:static!important}
        body>#printOverlay{display:block!important;visibility:visible!important;position:static!important;inset:auto!important;width:100%!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;overflow:visible!important;background:#fff!important}
        #printOverlay,#printOverlay *{visibility:visible!important;opacity:1!important}
        #printOverlay .print-preview-wrap,#printOverlay .print-preview-page,#printOverlay .svt-a4-grid,#printOverlay .print-page{display:block!important;position:static!important;height:auto!important;min-height:0!important;overflow:visible!important}
        #printOverlay .print-preview-toolbar{display:none!important}
      }
    </style></head><body><div id="printOverlay">${tabContent}</div></body></html>`);
    targetWindow.document.close();
    overlay.innerHTML="";
    overlay.style.display="none";
    overlay.setAttribute("aria-hidden","true");
    document.title=previousTitle;
    return targetWindow;
  }
  overlay.style.display="block";
  overlay.setAttribute("aria-hidden","false");
  window.closePrintPreview=function(){
    overlay.innerHTML="";
    overlay.style.display="none";
    overlay.setAttribute("aria-hidden","true");
    document.title=previousTitle;
  };
  window.preparePrintPages=function(){
    const compactPages=[...overlay.querySelectorAll('.svt-a4-grid')];
if(compactPages.length){
  const limit=285/25.4*96;
  compactPages.forEach(page=>{
    page.classList.remove('a4-dense');
    if(page.scrollHeight>limit){
      page.classList.add('a4-dense');
    }
  });
  return true;
}
    return true;
  };
  // Prépare aussi l'aperçu avant que l'utilisateur clique sur PDF.
  requestAnimationFrame(()=>{
    setTimeout(()=>window.preparePrintPages(),100);
  });
  if(!window.__printPreviewKeyHandler){
    window.__printPreviewKeyHandler=function(e){
      if(e.key==="Escape")window.closePrintPreview?.();
    };
    document.addEventListener(
      "keydown",
      window.__printPreviewKeyHandler
    );
  }
}
async function generateBlankEvaluationGrid(evalId){
  try{
    const ev=await getEvaluationById(evalId);
    if(!ev){alert("Évaluation introuvable.");return;}
    const crits=criteriaFromLegacy(ev);
    if(!crits.length){
      alert("Aucun critère trouvé pour cette évaluation.");
      return;
    }
    const questionGroups={};
    crits.forEach((cr,i)=>{
      const questionNumero=Number(cr.questionNumero||i+1);
      const questionId=String(cr.questionId||`q${questionNumero}`);
      if(!questionGroups[questionId]){
        questionGroups[questionId]={
          id:questionId,
          questionNumero,
          nom:cr.competenceNom||"Compétence évaluée",
          criteres:[]
        };
      }
      questionGroups[questionId].criteres.push(cr);
    });
    const questions=Object.values(questionGroups).sort(
      (a,b)=>a.questionNumero-b.questionNumero
    );
    const escP=v=>String(v??"").replace(
      /[&<>]/g,
      m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m])
    );
    const questionHtml=questions.map(question=>{
      const totalQuestion=question.criteres.reduce(
        (sum,cr)=>sum+(Array.isArray(cr.indicateurs)
          ?cr.indicateurs.reduce(
              (s,it)=>s+Number(it.points||0),0
            )
          :0),
        0
      );
      const criteresHtml=question.criteres.map((cr,i)=>{
        const inds=(cr.indicateurs||[]).filter(x=>x&&x.nom);
        const pts=inds.reduce((a,x)=>a+Number(x.points||0),0);
        return `<div class="blank-criterion" style="border:1px solid #555;padding:7px;margin:0;break-inside:avoid">
          <strong>Critère ${i+1} — ${escP(cr.nom)}</strong>
          <div style="font-size:9px;margin:3px 0">Barème : / ${pts} pt</div>
          <div style="margin:5px 0">
            ${inds.map(x=>`☐ ${escP(x.nom)} <span style="float:right">${Number(x.points||0)} pt</span>`).join("<br>")||"—"}
          </div>
          <div style="border-top:1px solid #aaa;padding-top:5px;margin-top:5px">
            Points : ______ / ${pts} pt
            <br>☐ Critère validé
          </div>
        </div>`;
      }).join("");
      return `<section style="break-inside:avoid">
       
<h2>📝 ${isTransversalLanguageCompetency(question.nom)
  ? "Maîtrise de la langue — Compétence transversale"
  : "Question " + question.questionNumero + " — " + escP(question.nom)}</h2>


        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;align-items:start">
          ${criteresHtml}
        </div>

        <div class="total" style="margin-top:8px">
          
${isTransversalLanguageCompetency(question.nom)
  ? "Total maîtrise de la langue"
  : "Total Question " + question.questionNumero} : ______ / ${totalQuestion} pt

        </div>

        <div class="mastery" style="margin-top:8px">
          
${isTransversalLanguageCompetency(question.nom)
  ? "Maîtrise de la compétence :"
  : "Maîtrise de la question :"}

          ☐ TBM &nbsp;&nbsp; ☐ MS &nbsp;&nbsp; ☐ MF &nbsp;&nbsp; ☐ MI
        </div>
      </section>`;
    }).join("");
    const body=`<div class="print-page">
      <h1>📝 ${escP(ev.titre)}</h1>
      <div class="meta" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0">
        <div style="border-bottom:1px solid #555;padding:5px 2px"><strong>Nom / Prénom :</strong></div>
        <div style="border-bottom:1px solid #555;padding:5px 2px"><strong>Classe :</strong> ${escP(ev.classe||"")}</div>
      </div>
      ${questionHtml}
      <div class="total">Résultat final : __________ / ${Number(ev.total||0)} pt</div>
    </div>`;
    printHtmlInCurrentWindow(`Grille vierge — ${ev.titre}`,body);
  }catch(e){
    alert("Impression impossible : "+e.message);
  }
}
let evaluationStatisticsCache = {};
/* Bilan par indicateur — lecture seule */
function indicatorNameKey(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[-']/g,' ').replace(/\s+/g,' ').trim().toLocaleLowerCase('fr');}
function buildIndicatorReport(evaluations,students,corrections,assignments=[]){
  const evalById=new Map((Array.isArray(evaluations)?evaluations:[evaluations]).filter(Boolean).map(ev=>[String(ev.id),ev]));
  const byId=new Map(students.map(st=>[String(st.id),st]));
  const aliases=new Map();
  students.forEach(st=>{
    const keys=new Set([studentDisplayName(st),`${st.nom||''} ${st.prenom||''}`,`${st.prenom||''} ${st.nom||''}`].map(indicatorNameKey).filter(Boolean));
    keys.forEach(key=>{if(!aliases.has(key))aliases.set(key,st);else if(String(aliases.get(key)?.id)!==String(st.id))aliases.set(key,null);});
  });
  // Quand des sujets sont attribués individuellement, on ne retient que la copie
  // correspondant au sujet réellement attribué à l'élève.
  const assignedByStudent=new Map();
  (assignments||[]).forEach(a=>{
    const sid=String(a.eleve_id||''); const eid=String(a.evaluation_id||'');
    if(!sid||!evalById.has(eid))return;
    assignedByStudent.set(sid,eid);
  });
  const latest=new Map();let excluded=0,duplicates=0;
  const ordered=[...corrections].sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')));
  ordered.forEach(c=>{
    const ev=evalById.get(String(c.evaluation_id));
    if(!ev)return;
    const st=c.eleve_id ? byId.get(String(c.eleve_id)) : aliases.get(indicatorNameKey(c.eleve));
    if(!st){excluded++;return;}
    const id=String(st.id), assigned=assignedByStudent.get(id);
    if(assigned && assigned!==String(c.evaluation_id))return;
    if(latest.has(id))duplicates++;
    latest.set(id,{correction:c,evaluation:ev});
  });
  const aggregate=new Map();
  latest.forEach(({correction,evaluation},studentId)=>{
    criteriaFromLegacy(evaluation).forEach((cr,ci)=>{
      const indicators=Array.isArray(cr.indicateurs)?cr.indicateurs:[];
      indicators.forEach((it,ii)=>{
        const result=correction.resultat||{},stats=result.criteriaStats?.[cr.id],points=result.points;
        const usable=points&&typeof points==='object'&&!Array.isArray(points)&&stats&&Number(stats.count)===indicators.length;
        const question=Number(cr.questionNumero||0);
        const criterion=String(cr.nom||`Critère ${ci+1}`);
        const indicator=String(typeof it==='string'?it:it.nom||'Indicateur sans intitulé');
        const competence=String(cr.competenceNom||'');
        const key=[question,indicatorNameKey(competence),indicatorNameKey(criterion),indicatorNameKey(indicator)].join('|');
        if(!aggregate.has(key))aggregate.set(key,{question,competence,criterion,indicator,success:[],missed:[],unknown:[],subjects:new Set()});
        const row=aggregate.get(key);row.subjects.add(evaluation.titre||'Sujet');
        const st=byId.get(studentId);if(!usable){row.unknown.push(st);return;}
        (points[`${cr.id}_${ii}`]?row.success:row.missed).push(st);
      });
    });
  });
  const rows=[...aggregate.values()].map(row=>{
    const total=row.success.length+row.missed.length;
    return {...row,subjects:[...row.subjects],total,percentage:total?Math.round(row.success.length/total*100):null};
  }).sort((a,b)=>(a.question||999)-(b.question||999)||a.criterion.localeCompare(b.criterion,'fr')||a.indicator.localeCompare(b.indicator,'fr'));
  const questionMap=new Map();
  rows.forEach(row=>{
    const key=String(row.question||'—');
    if(!questionMap.has(key))questionMap.set(key,{question:row.question,success:0,total:0,rows:[]});
    const q=questionMap.get(key);q.success+=row.success.length;q.total+=row.total;q.rows.push(row);
  });
  const questions=[...questionMap.values()].map(q=>({...q,percentage:q.total?Math.round(q.success/q.total*100):null}));
  return {rows,questions,corrected:latest.size,missing:students.filter(st=>!latest.has(String(st.id))),excluded,duplicates,subjects:[...new Set([...evalById.values()].map(e=>e.titre||'Sujet'))]};
}
function indicatorStudentList(students){
  return students.length ? `<ul style="margin:6px 0;padding-left:20px">${students.map(st=>`<li>${esc(studentDisplayName(st))}</li>`).join('')}</ul>` : '<span class="small-note">Aucun élève.</span>';
}
async function openIndicatorReport(evalId,classOverride=''){
  if(!correctionAllowLeave())return;
  const selectedClass=String(classOverride||loadEvalNav().classe||localStorage.getItem('EVAL_SELECTED_CLASS')||'').trim();
  if(!selectedClass){alert('Sélectionne une classe avant d’ouvrir le bilan.');return;}
  content.innerHTML='<section class="hero"><p>Chargement du bilan des indicateurs…</p></section>';
  try{
    const eq=await sb.from('Evaluations').select('*').eq('id',evalId).maybeSingle();
    if(eq.error)throw new Error(eq.error.message);
    if(!eq.data)throw new Error('Évaluation introuvable.');
    const selected=evalNormalize(eq.data);
    if(isHistoricalEvaluation(selected))throw new Error('Cette évaluation antérieure ne possède pas de grille détaillée d’indicateurs.');
    const groupId=String(selected.evaluationGroupId||'');
    let subjects=(evaluationsCache||[]).map(evalNormalize).filter(e=>
      evaluationAppliesToClass(e,selectedClass)&&!isHistoricalEvaluation(e)&&
      String(e.typeEvaluation||'evaluation')===String(selected.typeEvaluation||'evaluation')&&
      Number(e.chapitre||0)===Number(selected.chapitre||0)&&
      (groupId ? String(e.evaluationGroupId||'')===groupId : String(e.id)===String(selected.id))
    );
    if(!subjects.some(e=>String(e.id)===String(selected.id)))subjects.push(selected);
    const ids=subjects.map(e=>e.id);
    const [sq,cq,aq]=await Promise.all([
      sb.from('Eleves').select('id,classe,nom,prenom').eq('classe',selectedClass).order('nom').order('prenom'),
      sb.from('EvaluationCorrections').select('id,evaluation_id,eleve,eleve_id,resultat,created_at').in('evaluation_id',ids).order('created_at',{ascending:true}),
      sb.from('EvaluationSubjectAssignments').select('eleve_id,evaluation_id,travail_id').eq('classe',selectedClass).in('evaluation_id',ids)
    ]);
    if(sq.error)throw new Error(sq.error.message);if(cq.error)throw new Error(cq.error.message);
    // Les attributions ne sont pas obligatoires pour les évaluations sans sujets individualisés.
    const assignments=aq.error?[]:(aq.data||[]);
    const students=sortStudents(sq.data||[]);
    const report=buildIndicatorReport(subjects,students,cq.data||[],assignments);
    saveEvalNav({view:'indicatorReport',evaluationId:evalId,classe:selectedClass});
    label.textContent='Bilan des indicateurs';
    const questionRows=report.questions.map(q=>`<tr><td><strong>${q.question?'Question '+q.question:'Question non numérotée'}</strong></td><td>${q.total?q.success+' / '+q.total:'—'}</td><td><strong>${q.total?q.percentage+' %':'Non calculable'}</strong></td><td>${q.rows.filter(r=>r.percentage!==null).sort((a,b)=>a.percentage-b.percentage).slice(0,3).map(r=>esc(r.indicator)+' ('+r.percentage+' %)').join('<br>')}</td></tr>`).join('');
    const tableRows=report.rows.map(row=>`<tr><td>${row.question?'Q'+row.question:'—'}<div class="small-note">${esc(row.competence)}</div></td><td>${esc(row.criterion)}</td><td>${esc(row.indicator)}</td><td style="white-space:nowrap">${row.total?`${row.success.length} / ${row.total} — ${row.percentage} %`:'Non calculable'}</td><td><details><summary style="cursor:pointer">${row.missed.length} à accompagner</summary>${indicatorStudentList(row.missed)}</details>${row.unknown.length?`<details style="margin-top:6px"><summary style="cursor:pointer">${row.unknown.length} résultat(s) non exploitable(s)</summary>${indicatorStudentList(row.unknown)}</details>`:''}</td></tr>`).join('');
    const weak=report.rows.filter(r=>r.total>0).sort((a,b)=>a.percentage-b.percentage).slice(0,8);
    const weakHtml=weak.length?`<ol>${weak.map(r=>`<li><strong>${r.question?'Q'+r.question+' — ':''}${esc(r.indicator)}</strong> : ${r.percentage}% de réussite (${r.missed.length} élève(s) en difficulté)<details><summary>Voir les élèves</summary>${indicatorStudentList(r.missed)}</details></li>`).join('')}</ol>`:'<p>Aucun résultat exploitable pour identifier les difficultés.</p>';
    content.innerHTML=`<div class="row"><button type="button" onclick="openEvaluations({classe:${jsArg(selectedClass)}})">← Mes évaluations</button><button type="button" onclick="openCorrection(${jsArg(evalId)},${jsArg(selectedClass)})">Voir les copies</button><button type="button" onclick="openIndicatorReport(${jsArg(evalId)},${jsArg(selectedClass)})">Actualiser le bilan</button><button type="button" class="primary" onclick="printIndicatorReport()">📄 Exporter le bilan en PDF</button></div>
      <section class="hero" id="indicatorReportPrint"><span class="eyebrow">${esc(selectedClass)}</span><h2>Bilan des indicateurs — ${esc(selected.titre)}</h2>
      <p><strong>${subjects.length} sujet(s)</strong> analysé(s) : ${report.subjects.map(esc).join(' · ')}</p>
      <p>${students.length} élève(s) dans la classe · ${report.corrected} élève(s) avec une correction retenue · ${report.missing.length} sans correction.</p>
      <h3>Réussite par question</h3><div style="overflow-x:auto"><table class="mastery-table"><thead><tr><th>Question</th><th>Réussites</th><th>Pourcentage</th><th>Indicateurs les moins réussis</th></tr></thead><tbody>${questionRows||'<tr><td colspan="4">Aucun résultat disponible.</td></tr>'}</tbody></table></div>
      <h3 style="margin-top:22px">Priorités de remédiation</h3><p class="small-note">Les indicateurs sont classés du taux de réussite le plus faible au plus élevé. Les élèves listés peuvent être réunis en groupes de travail ciblés.</p>${weakHtml}
      <h3 style="margin-top:22px">Détail par indicateur</h3><div style="overflow-x:auto"><table class="mastery-table"><thead><tr><th>Question / compétence</th><th>Critère</th><th>Indicateur</th><th>Réussite</th><th>Élèves concernés</th></tr></thead><tbody>${tableRows||'<tr><td colspan="5">Aucun indicateur disponible.</td></tr>'}</tbody></table></div>
      <p class="small-note">Une copie absente n'est pas comptée comme un échec. Les résultats non exploitables sont exclus des pourcentages.</p></section>`;
  }catch(e){showError('Bilan des indicateurs : '+e.message);}
}
function printIndicatorReport(){
  const report=document.getElementById('indicatorReportPrint');
  if(!report){alert('Aucun bilan à exporter.');return;}
  const clone=report.cloneNode(true);
  clone.querySelectorAll('button').forEach(x=>x.remove());
  clone.querySelectorAll('details').forEach(x=>x.open=true);
  const css=`<style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial,sans-serif;color:#17212b;font-size:10px}h2{font-size:20px}h3{font-size:14px;margin:16px 0 7px}table{width:100%;border-collapse:collapse;font-size:9px;margin:8px 0 14px}th,td{border:1px solid #aab3bd;padding:5px;text-align:left;vertical-align:top}th{background:#edf2f5}tr{break-inside:avoid}.small-note{font-size:8px;color:#555}ul,ol{margin:4px 0;padding-left:18px}details{display:block}summary{display:none}</style>`;
  printHtmlInCurrentWindow('Bilan des indicateurs',css+clone.outerHTML);
}
function evaluationCard(e, options={}){
  const showSummaryActions = options?.showSummaryActions !== false;
  const stats = evaluationStatisticsCache[String(e.id)] || null;
  const currentEvalClass =
    String(loadEvalNav().classe || e.classe || "").trim();
  if(isHistoricalEvaluation(e)){
    const meta=historicalMeta(e);
    return `<article class="eval-card">
      <div class="entry-head">
        <div>
          <span class="tag">${esc(currentEvalClass||"Classe")}</span>
          <h3>🕘 ${esc(e.titre)}</h3>
          <p class="small-note">
            Évaluation antérieure ·
            ${meta.date ? esc(trackingDate(meta.date)) : "date non renseignée"}
            ${meta.competence ? ` · ${esc(meta.competence)}` : ""}
          </p>
        </div>

        <div class="row" style="margin:0">
          <button type="button"
            class="primary"
            onclick="event.stopPropagation();openHistoricalCorrection('${esc(e.id)}')">
            📊 Renseigner les résultats
          </button>

          <button type="button"
            class="danger"
            onclick="event.stopPropagation();deleteEvaluation('${esc(e.id)}')">
            🗑️ Supprimer
          </button>
        </div>
      </div>
    </article>`;
  }
  const {crits,items}=flattenIndicators(e);
  const count=items.filter(i=>i.nom).length;
  let statsHtml="";
  if(stats){
    const averageText =
      stats.average !== null
        ? stats.average.toFixed(2).replace(".",",")+" /20"
        : "—";
    const competencyEntries =
      Object.values(stats.competencies || {});
    const competencyHtml =
      competencyEntries.length
        ? competencyEntries.map(comp=>{
            const percentage =
              comp.percentage !== null
                ? Math.round(comp.percentage)+" %"
                : "—";
            return `
              <span class="tag">
                ${esc(comp.nom)} : ${percentage}
              </span>
            `;
          }).join(" ")
        : `<span class="small-note">
             Aucune compétence corrigée
           </span>`;
    statsHtml=`
      <div class="small-note" style="margin-top:10px">
        <strong>📊 Résultats</strong> ·
        ${stats.corrected} copie(s) corrigée(s) ·
        Moyenne :
        <strong>${averageText}</strong>
      </div>

      <div class="row" style="margin-top:8px;gap:6px">
        ${competencyHtml}
      </div>
    `;
  }
  return `<article class="eval-card">

    <div class="entry-head">

      <div>
        <span class="tag">
          ${esc(currentEvalClass||"Classe")}
        </span>

        <h3>${esc(e.titre)}</h3>

        <p class="small-note">
          ${crits.length} critère(s) ·
          ${count} indicateur(s) ·
          ${Number(e.total||0)} point(s)
        </p>
      </div>

      <div class="row" style="margin:0">

        <button type="button"
          style="pointer-events:auto;position:relative;z-index:5"
          onclick="event.stopPropagation();editEvaluation('${esc(e.id)}')">
          ✏️ Modifier
        </button>

        <button type="button"
          style="pointer-events:auto;position:relative;z-index:5"
          onclick="event.stopPropagation();duplicateEvaluation('${esc(e.id)}')">
          📋 Dupliquer
        </button>

        <button type="button"
          style="pointer-events:auto;position:relative;z-index:5"
          onclick="event.stopPropagation();generateBlankEvaluationGrid('${esc(e.id)}')">
          📥 Grille vierge PDF
        </button>

        ${showSummaryActions ? `
          <button type="button"
            style="pointer-events:auto;position:relative;z-index:5"
            onclick="event.stopPropagation();generateEvaluationSummaryPDF('${esc(e.id)}')">
            📊 Récapitulatif PDF
          </button>

          <button type="button" style="pointer-events:auto;position:relative;z-index:5"
            onclick="event.stopPropagation();openIndicatorReport(${jsArg(e.id)},${jsArg(currentEvalClass)})">🎯 Bilan des indicateurs</button>
          <button type="button" onclick="event.stopPropagation();openEvaluationAbsences(${jsArg(e.id)},${jsArg(currentEvalClass)})">Absences / non évalués</button>
        ` : ""}

        <button type="button"
          class="primary"
          style="pointer-events:auto;position:relative;z-index:5"
          onclick="event.stopPropagation();openCorrection('${esc(e.id)}')">
          📝 Corriger
        </button>

        <button type="button"
          class="danger"
          style="pointer-events:auto;position:relative;z-index:5"
          onclick="event.stopPropagation();deleteEvaluation('${esc(e.id)}')">
          🗑️ Supprimer
        </button>

      </div>
    </div>

    ${statsHtml}

  </article>`;
}
function newHistoricalEvaluation(){
  const titre=prompt("Titre de l'évaluation antérieure :");
  if(titre===null||!titre.trim())return;
  const classe=prompt("Classe :", "");
  if(classe===null||!classe.trim())return;
  const date=prompt("Date de l'évaluation (JJ/MM/AAAA) :", "");
  if(date===null)return;
  const competence=prompt("Compétence évaluée (facultatif) :", "");
  if(competence===null)return;
  createHistoricalEvaluation({
    titre:titre.trim(),
    classe:classe.trim(),
    date:date.trim(),
    competence:competence.trim()||"Compétence non renseignée"
  });
}
async function createHistoricalEvaluation(meta){
  try{
    const payload={
      titre:meta.titre,
      classe:meta.classe,
      total:0,
      competences:[],
      criteres:[],
      exercices:[{historique:true,date:meta.date,competence:meta.competence}]
    };
    const saved=await saveEvaluationObject(payload);
    evaluationsCache.unshift(saved);
    await openHistoricalCorrection(saved.id);
  }catch(e){alert("Création impossible : "+e.message)}
}
function newEvaluation(){
  const nav=loadEvalNav();
  const selectedClass=String(nav.classe||localStorage.getItem("EVAL_SELECTED_CLASS")||"").trim();
  editEvaluationObject({id:null,titre:"Nouvelle évaluation",classe:selectedClass,assignedClasses:selectedClass?[selectedClass]:[],total:0,competences:[{id:"comp1",nom:"",criteres:criterionDefaults()}],criteres:criterionDefaults(),exercices:[]});
}
async function deleteEvaluation(id){
  const ev=evaluationsCache.find(x=>String(x.id)===String(id));
  if(!ev)return;
  if(!confirm(`Supprimer l'évaluation « ${ev.titre||"Sans titre"} » ?\n\nLes corrections associées seront également supprimées.`))return;
  try{
    const {error:corrError}=await sb.from("EvaluationCorrections").delete().eq("evaluation_id",id);
    if(corrError)throw new Error(corrError.message);
    const {error:evalError}=await sb.from("Evaluations").delete().eq("id",id);
    if(evalError)throw new Error(evalError.message);
    const nav=loadEvalNav();
    evaluationsCache=evaluationsCache.filter(x=>String(x.id)!==String(id));
    await openEvaluations({classe:nav.classe||ev.classe||""});
  }catch(e){
    alert("Suppression impossible : "+e.message);
  }
}
async function duplicateEvaluation(id){
  try{
    const cached=evaluationsCache.find(x=>String(x.id)===String(id));
    let ev=cached;
    if(!ev){
      const q=await sb.from("Evaluations").select("*").eq("id",id).maybeSingle();
      if(q.error)throw new Error(q.error.message);
      if(!q.data)throw new Error("Évaluation introuvable.");
      ev=evalNormalize(q.data);
    }
    const defaultTitle=(ev.titre||"Nouvelle évaluation")+" — Sujet 2";
    const title=prompt("Nom de la nouvelle évaluation / du sujet :",defaultTitle);
    if(title===null)return;
    const titre=title.trim()||defaultTitle;
    // Liste des classes disponibles, avec la classe d'origine présélectionnée.
    const knownClasses=typeof CLASSES!=="undefined"
      ? Object.values(CLASSES).flat().filter(Boolean)
      : [];
    const evaluationClasses=evaluationsCache
      .map(e=>String(e.classe||"").trim())
      .filter(Boolean);
    const classes=[...new Set([...knownClasses,...evaluationClasses,ev.classe||""])]
      .filter(Boolean)
      .sort((a,b)=>a.localeCompare(b,"fr",{numeric:true}));
    const sourceClass=String(ev.classe||"").trim();
    const classOptions=classes.map(c=>
      `<option value="${esc(c)}" ${c===sourceClass?"selected":""}>${esc(c)}</option>`
    ).join("");
    // Petite fenêtre de choix de classe.
    const existing=document.getElementById("duplicateClassModal");
    if(existing)existing.remove();
    const modal=document.createElement("div");
    modal.id="duplicateClassModal";
    modal.className="pp-modal";
    modal.innerHTML=`
      <div class="pp-modal-card" style="max-width:520px">
        <div class="section-heading">
          <div>
            <span class="eyebrow">Duplication</span>
            <h3 style="margin:4px 0 0">📋 Choisir la classe</h3>
          </div>
          <button type="button" onclick="document.getElementById('duplicateClassModal')?.remove()">✕</button>
        </div>
        <p class="muted">Dans quelle classe veux-tu placer cette nouvelle évaluation ?</p>
        <label style="display:block;font-weight:800;margin:12px 0 6px">Classe de destination</label>
        <select id="duplicateClassSelect" style="width:100%;padding:11px;border:1px solid var(--b);border-radius:10px;background:#fff;font:inherit">
          <option value="">Choisir une classe…</option>
          ${classOptions}
        </select>
        <div class="row" style="justify-content:flex-end;margin-top:18px">
          <button type="button" onclick="document.getElementById('duplicateClassModal')?.remove()">Annuler</button>
          <button type="button" class="primary" id="confirmDuplicateClass">Dupliquer</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const destination=await new Promise(resolve=>{
      document.getElementById("confirmDuplicateClass").onclick=()=>{
        const value=document.getElementById("duplicateClassSelect").value;
        if(!value){
          alert("Choisis une classe de destination.");
          return;
        }
        modal.remove();
        resolve(value);
      };
      modal.querySelector('button[onclick*="duplicateClassModal"]')?.addEventListener("click",()=>resolve(null));
    });
    if(destination===null)return;
    const copy={
      titre,
      classe:destination,
      assignedClasses:[destination],
      classe:destination,
      total:Number(ev.total||0),
      competences:Array.isArray(ev.competences)?JSON.parse(JSON.stringify(ev.competences)):[],
      criteres:Array.isArray(ev.criteres)?JSON.parse(JSON.stringify(ev.criteres)):[],
      exercices:Array.isArray(ev.exercices)?JSON.parse(JSON.stringify(ev.exercices)):[]
    };
    delete copy.id;
    // La classe de destination doit être enregistrée explicitement dans Supabase.
    // On vérifie également la valeur réellement retournée par Supabase pour éviter
    // qu'une copie conserve par erreur la classe source.
    copy.classe=String(destination).trim();
    let saved0=await saveEvaluationObject(copy);
    if(String(saved0?.classe||"").trim()!==String(destination).trim()){
      const forced=await sb.from("Evaluations")
        .update({classe:String(destination).trim()})
        .eq("id",saved0.id)
        .select("*")
        .maybeSingle();
      if(forced.error)throw new Error("La classe de destination n'a pas pu être enregistrée : "+forced.error.message);
      if(!forced.data || String(forced.data.classe||"").trim()!==String(destination).trim()){
        throw new Error("La classe de destination n'a pas été enregistrée correctement.");
      }
      saved0=evalNormalize(forced.data);
    }
    const saved=saved0;
    evaluationsCache.unshift(saved);
    alert("Évaluation dupliquée ✓\n\nLa structure, les compétences, les critères, les indicateurs et les points ont été copiés.\nLa nouvelle évaluation appartient maintenant à la classe « "+destination+" ».\nLes corrections des élèves n'ont pas été copiées.");
    // Après duplication, on affiche directement la classe de DESTINATION.
    try{localStorage.setItem("EVAL_SELECTED_CLASS",String(destination));}catch(e){}
    await openEvaluations({classe:destination});
  }catch(e){
    alert("Duplication impossible : "+e.message);
  }
}
async function editEvaluation(id){
  try{
    const cached=evaluationsCache.find(x=>String(x.id)===String(id));
    if(cached){editEvaluationObject(cached);return;}
    const {data,error}=await sb.from("Evaluations").select("*").eq("id",id).maybeSingle();
    if(error)throw new Error(error.message);
    if(!data)throw new Error("Évaluation introuvable.");
    editEvaluationObject(evalNormalize(data));
  }catch(e){alert("Impossible d'ouvrir l'évaluation : "+e.message)}
}

/* Brouillons locaux v1 : aucune écriture automatique dans Supabase. */
let localDraftSession=null;
function localDraftPrefix(){return 'svt.localDraft.v1:'+encodeURIComponent(String(SUPABASE_URL))+':'+encodeURIComponent(String(user?.id||''))+':';}
function localDraftContext(mode,context){return mode==='editor'?'editor:'+String(context.evaluationId||'new'):'correction:'+JSON.stringify([String(context.evalId),String(context.classe||''),context.groupIds?.length?[...context.groupIds].map(String).sort():String(context.eleveId||context.correctionId||context.eleve||'anonymous')]);}
function localDraftCapture(){
  const s=localDraftSession;if(!s||!s.root.isConnected)return null;
  if(s.mode==='correction')return {checks:[...s.root.querySelectorAll('.correction-check')].map(el=>[el.dataset.key,!!el.checked])};
  return {
    titre:document.getElementById('evTitre').value,
    chapitre:document.getElementById('evChapitre').value,
    type:document.getElementById('evType').value,
    classes:[...document.querySelectorAll('#evClasses .ev-class-check:checked')].map(el=>el.value),
    questions:[...document.querySelectorAll('#competenciesEditor .question-editor')].map(box=>({
      id:box.dataset.competencyId,bankId:box.dataset.bankCompetencyId||'',
      nom:box.dataset.competencyName||competenciesCache.find(c=>String(c.id)===String(box.dataset.bankCompetencyId))?.nom||'',
      questionNumero:box.querySelector('.question-number')?.value??null,
      criteres:[...box.querySelectorAll(':scope > .competency-criteria > .criterion-editor')].map(cb=>({
        id:cb.dataset.criterionId,nom:cb.querySelector('.criterion-name').value,
        indicateurs:[...cb.querySelectorAll('.indicator-row')].map(row=>({nom:row.querySelector('.indicator-name').value,points:row.querySelector('.indicator-points').value}))
      }))
    }))
  };
}
function localDraftRead(s){
  const raw=localStorage.getItem(s.key);if(!raw)return {raw:null,record:null};
  const record=JSON.parse(raw);
  if(record.version!==1||record.owner!==s.owner||record.context!==s.context||record.mode!==s.mode||!record.payload||typeof record.base!=='string')throw new Error('Brouillon illisible ou incompatible. Il ne sera pas écrasé automatiquement.');
  return {raw,record};
}
function localDraftDisplay(text,error=false){
  const s=localDraftSession;if(!s?.banner.isConnected)return;
  s.banner.classList.toggle('draft-error',error);
  s.banner.querySelector('.local-draft-message').textContent=text;
}
function localDraftActions(){
  const s=localDraftSession;if(!s)return;
  const pending=!!s.pending;
  s.banner.querySelector('[data-draft-resume]').hidden=!pending||!s.record;
  s.banner.querySelector('[data-draft-delete]').hidden=!pending;
  s.banner.querySelector('[data-draft-export]').hidden=!pending;
}
function localDraftPending(found,message){
  const s=localDraftSession;if(!s)return;
  clearTimeout(s.timer);s.pending=true;s.record=found?.record||null;s.expected=found?.raw??s.expected;
  localDraftDisplay(message||('Un brouillon du '+new Date(s.record.updatedAt).toLocaleString('fr-FR')+' est disponible sur cet appareil. Reprends-le ou supprime-le avant de continuer. Reprendre ne valide rien dans Supabase.'),true);
  localDraftActions();
}
function localDraftFlush(){
  const s=localDraftSession;if(!s||!s.root.isConnected||s.owner!==String(user?.id||''))return false;
  clearTimeout(s.timer);if(s.pending)return false;
  try{
    const payload=localDraftCapture(),fingerprint=JSON.stringify(payload);
    const found=localDraftRead(s);
    if(found.raw!==s.expected){localDraftPending(found,'Un autre onglet a modifié ce brouillon. Sauvegarde automatique suspendue pour éviter de l’écraser. Tu peux exporter le travail de cette fenêtre ou reprendre le brouillon disponible.');return false;}
    if(fingerprint===s.base){
      if(found.raw)localStorage.removeItem(s.key);
      s.expected=null;s.last=fingerprint;
      localDraftDisplay('Aucune modification en attente. Les brouillons sont locaux à cet appareil.');return true;
    }
    if(fingerprint===s.last&&found.raw)return true;
    const record={version:1,owner:s.owner,context:s.context,mode:s.mode,base:s.base,schema:s.schema,updatedAt:new Date().toISOString(),payload};
    const raw=JSON.stringify(record);localStorage.setItem(s.key,raw);
    if(localStorage.getItem(s.key)!==raw)throw new Error('La conservation du brouillon n’a pas été confirmée.');
    s.expected=raw;s.last=fingerprint;
    localDraftDisplay('Brouillon sauvegardé sur cet appareil à '+new Date().toLocaleTimeString('fr-FR')+' — non validé dans Supabase.');return true;
  }catch(e){localDraftDisplay('Brouillon non sauvegardé : '+e.message+' Garde cette page ouverte et utilise l’enregistrement habituel.',true);return false;}
}
function localDraftSchedule(){
  const s=localDraftSession;if(!s||s.pending||s.owner!==String(user?.id||''))return;
  let current;try{current=JSON.stringify(localDraftCapture());}catch(e){localDraftDisplay('Brouillon non sauvegardé : '+e.message,true);return;}
  if(current===s.last)return;
  localDraftDisplay('Modifications en cours — sauvegarde locale…');clearTimeout(s.timer);s.timer=setTimeout(localDraftFlush,650);
}
function localDraftStop(flush=true){
  const s=localDraftSession;if(!s)return;
  if(flush)localDraftFlush();clearTimeout(s.timer);s.observer?.disconnect();s.root.removeEventListener('input',s.listener);s.root.removeEventListener('change',s.listener);
  s.banner?.remove();localDraftSession=null;
}
function localDraftBegin(mode,context,root){
  localDraftStop(true);if(!root)return;
  const banner=document.createElement('aside');banner.className='local-draft-banner';
  banner.innerHTML='<p class="local-draft-message" role="status" aria-live="polite"></p><div class="row local-draft-actions"><button type="button" data-draft-resume hidden onclick="localDraftResume()">Reprendre le brouillon</button><button type="button" data-draft-delete hidden onclick="localDraftDiscard()">Supprimer ce brouillon</button><button type="button" data-draft-export hidden onclick="localDraftExport()">Exporter le travail de cette fenêtre</button></div>';
  root.prepend(banner);
  const owner=String(user?.id||''),scope=localDraftContext(mode,context);
  const s={mode,context:scope,evaluationId:context.evaluationId||null,owner,key:localDraftPrefix()+encodeURIComponent(scope),root,banner,expected:null,last:null,pending:false,record:null,timer:null,schema:mode==='correction'?JSON.stringify(criteriaFromLegacy(currentCorrectionEvaluation)):null};
  localDraftSession=s;
  s.base=JSON.stringify(localDraftCapture());s.last=s.base;
  if(!owner){s.pending=true;localDraftDisplay('Connecte-toi pour activer les brouillons locaux associés à ton compte.',true);return;}
  try{
    const found=localDraftRead(s);s.expected=found.raw;
    if(found.record&&JSON.stringify(found.record.payload)!==s.base)localDraftPending(found);
    else if(found.record){localStorage.removeItem(s.key);s.expected=null;}
    if(!s.pending)localDraftDisplay('Protection locale active : les modifications seront conservées sur cet appareil, sans valider l’évaluation ou la copie.');
  }catch(e){s.pending=e instanceof SyntaxError||/Brouillon illisible/.test(e.message);localDraftDisplay('Brouillon local indisponible : '+e.message+' L’enregistrement habituel reste possible si aucun brouillon à reprendre n’est détecté.',true);localDraftActions();}
  s.listener=()=>localDraftSchedule();root.addEventListener('input',s.listener);root.addEventListener('change',s.listener);
  if(mode==='editor'){
    s.observer=new MutationObserver(localDraftSchedule);
    const area=document.getElementById('competenciesEditor');if(area)s.observer.observe(area,{childList:true,subtree:true});
  }
}
function localDraftBeginEditor(id){localDraftBegin('editor',{evaluationId:id||null},document.getElementById('evTitre')?.closest('section'));}
function localDraftBeginCorrection(){if(correctionSession)localDraftBegin('correction',correctionSession,document.getElementById('correctionSaveControls')?.closest('section'));}
function localDraftResume(){
  const s=localDraftSession;if(!s||!s.record)return;
  try{
    const found=localDraftRead(s);if(found.raw!==s.expected){localDraftPending(found,'Le brouillon a changé dans un autre onglet. Vérifie puis clique de nouveau sur Reprendre.');return;}
    const record=found.record,payload=record.payload;
    if(s.mode==='correction'){
      if(record.schema!==s.schema)throw new Error('La grille a changé depuis ce brouillon. Reprise automatique impossible ; le brouillon est conservé.');
      const current=[...s.root.querySelectorAll('.correction-check')];
      if(!Array.isArray(payload.checks)||payload.checks.length!==current.length||payload.checks.some((v,i)=>v[0]!==current[i].dataset.key||typeof v[1]!=='boolean'))throw new Error('Les indicateurs du brouillon ne correspondent plus à cette grille.');
    }else{
      if(!Array.isArray(payload.questions)||!Array.isArray(payload.classes)||payload.questions.some(q=>!Array.isArray(q.criteres)||q.criteres.some(c=>!Array.isArray(c.indicateurs))))throw new Error('La structure du brouillon est invalide.');
    }
    if(!confirm('Reprendre ce brouillon et remplacer les données actuellement affichées ? Rien ne sera validé dans Supabase.'+(record.base!==s.base?' Attention : la version chargée diffère de celle qui avait servi de départ au brouillon.':'')))return;
    if(s.mode==='correction'){
      const values=new Map(payload.checks);s.root.querySelectorAll('.correction-check').forEach(el=>el.checked=values.get(el.dataset.key));refreshCorrectionScore(correctionSession.evalId);correctionRefreshStatus();
    }else{
      const area=document.getElementById('competenciesEditor');
      area.innerHTML=payload.questions.map((q,i)=>renderCompetencyEditor({...q,questionNumero:q.questionNumero??i+1},i)).join('');
      populateQuestionCompetencyPickers();
      [...area.querySelectorAll('.question-editor')].forEach((box,i)=>{const input=box.querySelector('.question-number');if(input&&payload.questions[i].questionNumero!==null)input.value=payload.questions[i].questionNumero;});
      document.getElementById('evTitre').value=payload.titre??'';document.getElementById('evChapitre').value=payload.chapitre??'';document.getElementById('evType').value=payload.type||'evaluation';
      document.querySelectorAll('#evClasses .ev-class-check').forEach(el=>el.checked=payload.classes.includes(el.value));
      document.getElementById('evType').dispatchEvent(new Event('change',{bubbles:true}));renumberEvaluationQuestions();
      [...area.querySelectorAll('.question-editor')].forEach((box,i)=>{const input=box.querySelector('.question-number');if(input&&payload.questions[i].questionNumero!==null)input.value=payload.questions[i].questionNumero;});
      updateEvaluationTotal();
    }
    s.pending=false;s.record=null;s.last=null;localDraftActions();localDraftFlush();
  }catch(e){localDraftDisplay('Brouillon non repris : '+e.message,true);}
}
function localDraftDiscard(){
  const s=localDraftSession;if(!s?.owner)return;
  if(!confirm('Supprimer définitivement ce brouillon local ? Les données affichées et les enregistrements dans Supabase resteront inchangés.'))return;
  try{
    const raw=localStorage.getItem(s.key);
    if(s.expected!==null&&raw!==s.expected){localDraftPending(localDraftRead(s),'Le brouillon a changé dans un autre onglet. Vérifie avant de le supprimer.');return;}
    localStorage.removeItem(s.key);s.expected=null;s.pending=false;s.record=null;s.last=null;localDraftActions();localDraftFlush();
  }catch(e){localDraftDisplay('Suppression impossible : '+e.message,true);}
}
function localDraftExport(){
  const s=localDraftSession;if(!s)return;
  const blob=new Blob([JSON.stringify({version:1,mode:s.mode,context:s.context,payload:localDraftCapture()},null,2)],{type:'application/json'});
  const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download='brouillon-svt.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function localDraftCanValidate(){
  if(localDraftSession?.pending){alert('Choisis d’abord de reprendre ou supprimer le brouillon proposé. Cela évite de perdre une version de ton travail.');return false;}
  return true;
}
function localDraftBeforeSave(){localDraftFlush();return localDraftSession?{session:localDraftSession,payload:JSON.stringify(localDraftCapture())}:null;}
function localDraftSaved(ticket,newId=null){
  if(!ticket||ticket.session!==localDraftSession)return;
  const s=localDraftSession;
  try{
    if(localStorage.getItem(s.key)!==s.expected){localDraftPending(localDraftRead(s),'Enregistrement dans Supabase confirmé, mais un autre onglet a modifié le brouillon. Il a été conservé.');return;}
    localStorage.removeItem(s.key);s.expected=null;
    if(s.mode==='editor'&&newId){s.evaluationId=newId;s.context=localDraftContext('editor',{evaluationId:newId});s.key=localDraftPrefix()+encodeURIComponent(s.context);}
    s.base=ticket.payload;s.last=null;
    if(JSON.stringify(localDraftCapture())===ticket.payload){s.last=ticket.payload;clearTimeout(s.timer);localDraftDisplay('Enregistrement confirmé dans Supabase. Aucun brouillon en attente.');}
    else localDraftFlush();
  }catch(e){localDraftDisplay('Enregistrement dans Supabase confirmé ; nettoyage du brouillon local impossible : '+e.message,true);}
}
window.addEventListener('pagehide',()=>localDraftFlush());
document.addEventListener('visibilitychange',()=>{if(document.hidden)localDraftFlush();});
window.addEventListener('beforeunload',e=>{
  const s=localDraftSession;if(!s||!s.root.isConnected)return;
  const changed=JSON.stringify(localDraftCapture())!==s.base;
  if(changed&&!localDraftFlush()){e.preventDefault();e.returnValue='';}
});
window.addEventListener('storage',e=>{
  const s=localDraftSession;if(!s||e.key!==s.key)return;
  try{localDraftPending(localDraftRead(s),'Un autre onglet a modifié ou supprimé ce brouillon. Sauvegarde locale suspendue ; exporte ton travail avant de reprendre une autre version.');}
  catch(err){s.pending=true;localDraftDisplay('Brouillon modifié dans un autre onglet : '+err.message,true);localDraftActions();}
});

function renderCriterionEditor(c,i){
  const indicators=Array.isArray(c.indicateurs)?c.indicateurs:[];
  return `<div class="eval-card criterion-editor" data-criterion-id="${esc(c.id||('c'+Date.now()+i))}">
    <div class="row" style="justify-content:space-between;align-items:center"><strong>Critère ${i+1}</strong><button class="danger" onclick="this.closest('.criterion-editor').remove()">Supprimer</button></div>
    <label>Nom du critère</label><input class="criterion-name" value="${esc(c.nom||'')}" placeholder="Ex. Respect des consignes">
    <label>Indicateurs à cocher</label>
    <div class="indicator-editor">${indicators.map(indicatorEditor).join("")}</div>
    <button type="button" class="entry-add" onclick="this.previousElementSibling.insertAdjacentHTML('beforeend',indicatorEditor({nom:'',points:1}))">＋ Ajouter un indicateur</button>
  </div>`;
}
function isTransversalLanguageCompetency(nom){
  const texte = String(nom || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return texte.includes("maitrise de la langue") ||
         texte.includes("maitriser la langue francaise");
}
function renderCompetencyEditor(comp,ci){
  const cs=Array.isArray(comp.criteres)?comp.criteres:[];
  const questionNumero=Number(comp.questionNumero||ci+1);
  return `<div class="eval-card competency-editor question-editor"
    data-competency-id="${esc(comp.id||('comp'+Date.now()+ci))}"
    data-bank-competency-id="${esc(comp.bankId||"")}"
    data-competency-name="${esc(comp.nom||"")}">

    <div class="row" style="justify-content:space-between;align-items:center">
      <strong>📝 ${isTransversalLanguageCompetency(comp.nom) ? "Maîtriser la langue française — Compétence transversale" : "Question " + questionNumero}</strong>
      <button class="danger" type="button"
        onclick="this.closest('.question-editor').remove();renumberEvaluationQuestions()">
        Supprimer
      </button>
    </div>

    
    ${!isTransversalLanguageCompetency(comp.nom) ? `
    <label>Numéro de la question</label>
    <input class="question-number"
      type="number"
      min="1"
      step="1"
      value="${questionNumero}"
      onchange="renumberEvaluationQuestions()">
    ` : ""}

    <label>Compétence évaluée</label>

    <select class="question-bank-select"
      onchange="selectQuestionCompetency(this)">
      <option value="">Choisir une compétence dans la banque…</option>
    </select>

    <div class="grid-template-tools">
      <p class="small-note question-grid-note">Choisis une compétence pour charger sa grille de départ. Les adaptations restent propres à cette question.</p>
      <div class="row"><button type="button" onclick="reloadQuestionGrid(this)">↻ Recharger le modèle</button><button type="button" onclick="saveQuestionAsCompetencyGrid(this)">💾 Utiliser cette grille comme modèle</button></div>
    </div>
    <label>Critères de cette question — à préciser pour cet exercice</label>

    <div class="competency-criteria">
      ${cs.map(renderCriterionEditor).join("")}
    </div>

    <button type="button"
      class="entry-add"
      onclick="addCriterionToCompetency(this)">
      ＋ Ajouter un critère
    </button>

  </div>`;
}
function addCriterionToCompetency(btn){
  const box=btn.previousElementSibling;const n=box.querySelectorAll('.criterion-editor').length;
  box.insertAdjacentHTML('beforeend',renderCriterionEditor({id:'c'+Date.now()+n,nom:'',indicateurs:[]},n));
}
function addCompetencyEditor(){
  const box=document.getElementById("competenciesEditor");
  if(!box)return;
  const n=box.querySelectorAll(".question-editor").length;
  box.insertAdjacentHTML(
    "beforeend",
    renderCompetencyEditor({
      id:"comp"+Date.now(),
      nom:"",
      bankId:"",
      questionNumero:n+1,
      criteres:[]
    },n)
  );
  populateQuestionCompetencyPickers();
}
  function populateQuestionCompetencyPickers(){
  const options='<option value="">Choisir une compétence dans la banque…</option>'+
    competenciesCache.map(c=>
      `<option value="${esc(c.id)}">${esc(c.niveau||"Tous niveaux")} · ${esc(c.nom)}</option>`
    ).join("");
  document.querySelectorAll(".question-bank-select").forEach(sel=>{
    const current=sel.closest(".question-editor")?.dataset.bankCompetencyId||"";
    sel.innerHTML=options;
    if(current){
      if(![...sel.options].some(option=>option.value===String(current))){
        const name=sel.closest('.question-editor')?.dataset.competencyName||'Compétence enregistrée';
        sel.add(new Option(name+' (absente de la banque)',String(current)));
      }
      sel.value=String(current);
    }
    updateQuestionGridNote(sel.closest(".question-editor"));
  });
}

/* Grilles de référence : copiées dans les questions, jamais liées aux anciennes copies. */
const COMPETENCY_GRID_PROFILES=[["protocole|experiment|manipul", [["Pertinence", ["Le protocole répond au problème posé.", "Le matériel choisi permet de réaliser le test.", "Les conditions à comparer sont identifiées."]], ["Exactitude", ["Les quantités, durées ou mesures sont adaptées.", "Les étapes sont réalisées sans erreur technique.", "Les observations sont relevées fidèlement."]], ["Complétude", ["Les étapes nécessaires sont toutes présentes.", "Les conditions expérimentales utiles sont précisées.", "Les résultats nécessaires sont recueillis."]], ["Conformité", ["Les étapes suivent un ordre cohérent.", "Les consignes de sécurité sont respectées.", "Le matériel est utilisé selon les consignes."]]]], ["graph|courbe|diagramme", [["Pertinence", ["Le type de représentation convient aux données.", "Les grandeurs sont placées sur les axes adaptés.", "Le titre indique ce que représente le graphique."]], ["Exactitude", ["Les valeurs sont reportées correctement.", "Les unités sont exactes.", "Les graduations respectent une échelle régulière."]], ["Complétude", ["Les données demandées sont toutes représentées.", "Les axes comportent leur nom et leur unité.", "La légende nécessaire est présente."]], ["Conformité", ["La représentation respecte les consignes.", "Les tracés sont lisibles et soignés.", "La légende permet de distinguer les séries."]]]], ["interpret|resultat|conclu", [["Pertinence", ["Les résultats retenus répondent au problème posé.", "La comparaison porte sur les conditions utiles.", "La conclusion répond à la question."]], ["Exactitude", ["Les données sont relevées sans erreur.", "Les comparaisons respectent les résultats observés.", "Les connaissances mobilisées sont scientifiquement exactes."]], ["Complétude", ["Les résultats utiles sont tous pris en compte.", "La réponse cite les données qui soutiennent la conclusion.", "Le lien entre les résultats et la conclusion est explicité."]], ["Conformité", ["La réponse distingue observation et interprétation.", "Le vocabulaire scientifique attendu est utilisé.", "La réponse suit la forme demandée."]]]], ["hypothes|demarche|probleme", [["Pertinence", ["Le problème est lié à la situation étudiée.", "L’hypothèse propose une réponse au problème.", "Le test proposé permet de vérifier l’hypothèse."]], ["Exactitude", ["L’hypothèse est compatible avec les connaissances disponibles.", "Les facteurs étudiés sont correctement identifiés.", "Le résultat attendu est cohérent avec l’hypothèse."]], ["Complétude", ["Le problème est clairement formulé.", "L’hypothèse est explicitement énoncée.", "La vérification et le résultat attendu sont précisés."]], ["Conformité", ["L’hypothèse est formulée de façon testable.", "Les étapes du raisonnement sont organisées.", "Le vocabulaire attendu est employé."]]]], ["dessin|schema|represent", [["Pertinence", ["Les éléments représentés correspondent au sujet.", "La représentation met en évidence les relations utiles.", "Le titre précise l’objet représenté."]], ["Exactitude", ["Les éléments sont représentés sans erreur scientifique.", "Les légendes désignent les bons éléments.", "Les relations ou proportions attendues sont respectées."]], ["Complétude", ["Tous les éléments demandés sont présents.", "Les légendes nécessaires sont présentes.", "Les indications attendues sont renseignées."]], ["Conformité", ["La représentation respecte les conventions demandées.", "Les traits et les légendes sont lisibles.", "La présentation est organisée et soignée."]]]], ["oral|communiquer oral|expos", [["Expression", ["La voix est audible.", "Le débit permet de suivre le propos.", "Les mots sont prononcés clairement."]], ["Organisation", ["L’introduction présente le sujet.", "Les idées suivent un ordre cohérent.", "La conclusion répond au sujet."]], ["Pertinence", ["Les informations répondent à la consigne.", "Les explications sont scientifiquement exactes.", "Les exemples ou supports éclairent le propos."]], ["Attitude", ["Le regard s’adresse à l’auditoire.", "La prise de parole ne se limite pas à lire le support.", "La posture favorise la communication."]]]], ["langue|redig|texte|ecrit", [["Pertinence", ["Le texte répond à la consigne.", "Les idées retenues sont utiles au sujet.", "Les exemples soutiennent l’explication."]], ["Exactitude", ["Le vocabulaire est employé correctement.", "Les phrases sont compréhensibles.", "Les accords et l’orthographe sont vérifiés."]], ["Complétude", ["Les éléments demandés sont tous présents.", "Les liens entre les idées sont explicités.", "La conclusion ou la réponse finale est formulée."]], ["Conformité", ["Le texte respecte la forme demandée.", "Les idées sont organisées en phrases et paragraphes.", "La présentation et la ponctuation facilitent la lecture."]]]], ["argument|justifi|raisonn|expliqu", [["Pertinence", ["La réponse traite la question posée.", "Les arguments soutiennent la réponse proposée.", "Les exemples choisis sont utiles au raisonnement."]], ["Exactitude", ["Les connaissances utilisées sont exactes.", "Les données citées sont fidèles aux documents.", "Les relations de cause à effet sont correctes."]], ["Complétude", ["Les arguments nécessaires sont présents.", "Chaque argument s’appuie sur une donnée ou une connaissance.", "La conclusion est reliée aux arguments."]], ["Conformité", ["Le raisonnement suit un ordre logique.", "Des connecteurs rendent les liens explicites.", "Le vocabulaire scientifique attendu est employé."]]]], ["inform|document|extraire|recherch|lire", [["Pertinence", ["Les informations sélectionnées répondent à la question.", "Les documents utiles sont identifiés.", "Les informations hors sujet sont écartées."]], ["Exactitude", ["Les données sont relevées sans déformation.", "Les valeurs et unités sont exactes.", "Le sens des documents est respecté."]], ["Complétude", ["Les informations nécessaires sont toutes relevées.", "Les documents demandés sont tous exploités.", "Les références utiles sont précisées."]], ["Conformité", ["Les informations sont organisées de façon lisible.", "La réponse respecte la forme demandée.", "La formulation permet de comprendre les données retenues."]]]], ["class|identifier|observ|compar", [["Pertinence", ["Les éléments retenus correspondent à la consigne.", "Les caractères utilisés sont adaptés à la tâche.", "La réponse permet d’identifier ou de distinguer les éléments."]], ["Exactitude", ["Les caractères sont repérés sans erreur.", "Les ressemblances et différences sont correctement décrites.", "Les termes scientifiques sont utilisés à bon escient."]], ["Complétude", ["Tous les éléments demandés sont étudiés.", "Les caractères nécessaires sont renseignés.", "La réponse finale est explicitement formulée."]], ["Conformité", ["La méthode ou la clé demandée est respectée.", "La présentation facilite la lecture des observations.", "Le vocabulaire et les conventions attendus sont respectés."]]]]];
const COMPETENCY_GRID_GENERIC=[["Pertinence", ["Le travail répond à la consigne.", "La démarche choisie est adaptée au problème.", "Les éléments retenus sont utiles à la réponse."]], ["Exactitude", ["Les informations utilisées sont exactes.", "Les termes scientifiques sont employés correctement.", "Les résultats ou affirmations ne comportent pas d’erreur."]], ["Complétude", ["Les éléments demandés sont tous présents.", "Les étapes ou explications nécessaires sont détaillées.", "La réponse finale est formulée."]], ["Conformité", ["La forme demandée est respectée.", "Le travail est organisé et lisible.", "Les conventions et consignes sont respectées."]]];
let competencyGridModalState=null;
function competencyGridKey(text){return String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function competencyStarterGrid(comp){
  const key=competencyGridKey(comp?.nom);
  const profile=COMPETENCY_GRID_PROFILES.find(p=>new RegExp(p[0]).test(key));
  return {version:1,criteres:(profile?profile[1]:COMPETENCY_GRID_GENERIC).map(([nom,items])=>({nom,indicateurs:items.map(text=>({nom:text,points:1}))}))};
}
function competencyGridModel(comp){
  const stored=comp?.grid_template;
  return stored&&stored.version===1&&Array.isArray(stored.criteres)&&stored.criteres.length
    ?JSON.parse(JSON.stringify(stored)):competencyStarterGrid(comp);
}
function competencyGridIsSaved(comp){return !!(comp?.grid_template?.version===1&&comp.grid_template.criteres?.length);}
function competencyGridCriteria(comp){
  return competencyGridModel(comp).criteres.map(c=>({...c,id:'grid_'+crypto.randomUUID(),indicateurs:(c.indicateurs||[]).map(it=>({...it}))}));
}
function collectGridCriteria(container){
  return [...container.children].filter(el=>el.classList.contains('criterion-editor')).map(cb=>({
    nom:cb.querySelector('.criterion-name')?.value.trim()||'',
    indicateurs:[...cb.querySelectorAll('.indicator-row')].map(row=>({nom:row.querySelector('.indicator-name')?.value.trim()||'',points:Number(row.querySelector('.indicator-points')?.value)}))
  }));
}
function validateCompetencyGrid(criteres){
  if(!criteres.length)throw new Error('Ajoute au moins un critère.');
  for(const c of criteres){
    if(!c.nom)throw new Error('Chaque critère doit avoir un nom.');
    if(!c.indicateurs.length)throw new Error('Ajoute au moins un indicateur par critère.');
    for(const it of c.indicateurs){
      if(!it.nom)throw new Error('Renseigne ou supprime les indicateurs vides.');
      if(!Number.isFinite(it.points)||it.points<0)throw new Error('Les points doivent être des nombres positifs ou nuls.');
    }
  }
  return {version:1,criteres};
}
function questionGridHasContent(box){
  const defaults=criterionDefaults().map(c=>c.nom);
  return collectGridCriteria(box.querySelector('.competency-criteria')).some(c=>c.indicateurs.length||(c.nom&&!defaults.includes(c.nom)&&!/^Critère \d+$/.test(c.nom)));
}
function updateQuestionGridNote(box){
  const note=box.querySelector('.question-grid-note');if(!note)return;
  const comp=competenciesCache.find(c=>String(c.id)===String(box.dataset.bankCompetencyId));
  note.textContent=!comp?'Choisis une compétence pour charger une grille de départ.':
    (competencyGridIsSaved(comp)?'Modèle personnel disponible. ':'Grille de départ proposée à adapter. ')+
    'Les modifications ci-dessous concernent uniquement cette question. Le modèle ne change que si tu l’enregistres explicitement.';
}
function applyQuestionGrid(box,comp){
  box.querySelector('.competency-criteria').innerHTML=competencyGridCriteria(comp).map(renderCriterionEditor).join('');
  updateEvaluationTotal();updateQuestionGridNote(box);
}
function reloadQuestionGrid(btn){
  const box=btn.closest('.question-editor');
  const comp=competenciesCache.find(c=>String(c.id)===String(box.dataset.bankCompetencyId));
  if(!comp){alert('Choisis d’abord une compétence.');return;}
  if(questionGridHasContent(box)&&!confirm('Remplacer la grille de cette question par le modèle de la compétence ? Les adaptations de cette question seront remplacées.'))return;
  applyQuestionGrid(box,comp);
}
async function persistCompetencyGrid(id,model){
  const q=await sb.from('ProfessorCompetencies').update({grid_template:model}).eq('id',id).select('id,grid_template').maybeSingle();
  if(q.error){
    const message=String(q.error.message||'');
    if(/grid_template|PGRST204|42703/i.test(message+' '+q.error.code))throw new Error('Le stockage des modèles n’est pas encore installé. Exécute le fichier SQL fourni dans Supabase, puis réessaie.');
    throw new Error(message);
  }
  if(!q.data?.id||!q.data.grid_template)throw new Error('La base n’a pas confirmé l’enregistrement du modèle. Vérifie tes droits d’accès.');
  const comp=competenciesCache.find(c=>String(c.id)===String(id));
  if(comp)comp.grid_template=JSON.parse(JSON.stringify(q.data.grid_template));
  document.querySelectorAll('.question-editor').forEach(updateQuestionGridNote);
  const bank=document.getElementById('competencyBankList');if(bank)bank.innerHTML=renderCompetencyBank();
}
async function saveQuestionAsCompetencyGrid(btn){
  if(btn.disabled)return;
  const box=btn.closest('.question-editor');
  const comp=competenciesCache.find(c=>String(c.id)===String(box.dataset.bankCompetencyId));
  if(!comp){alert('Choisis d’abord une compétence.');return;}
  let model;try{model=validateCompetencyGrid(collectGridCriteria(box.querySelector('.competency-criteria')));}catch(e){alert(e.message);return;}
  if(!confirm('Enregistrer cette grille comme modèle de « '+comp.nom+' » ? Les précisions présentes seront réutilisées dans les prochaines questions. Les évaluations existantes resteront inchangées.'))return;
  btn.disabled=true;
  try{await persistCompetencyGrid(comp.id,model);alert('Modèle enregistré. Les évaluations existantes n’ont pas été modifiées.');}
  catch(e){alert('Modèle non enregistré : '+e.message);}finally{btn.disabled=false;}
}
function openCompetencyGrid(id){
  if(competencyGridModalState&&!closeCompetencyGrid())return;
  const comp=competenciesCache.find(c=>String(c.id)===String(id));if(!comp)return;
  const modal=document.createElement('div');modal.id='competencyGridModal';modal.className='pp-modal competency-grid-modal';
  modal.innerHTML=`<section class="pp-modal-card" role="dialog" aria-modal="true" aria-labelledby="competencyGridTitle">
    <div class="entry-head"><h3 id="competencyGridTitle">Grille de référence — ${esc(comp.nom)}</h3><button type="button" onclick="closeCompetencyGrid()">Fermer</button></div>
    <p class="small-note">${competencyGridIsSaved(comp)?'Modèle personnel enregistré.':'Proposition de départ à adapter ; ce n’est pas une grille officielle.'} Modifie les critères, les indicateurs et les points. L’enregistrement ne modifie aucune ancienne évaluation.</p>
    <div class="competency-criteria">${competencyGridCriteria(comp).map(renderCriterionEditor).join('')}</div>
    <button type="button" class="entry-add" onclick="addCriterionToCompetency(this)">＋ Ajouter un critère</button>
    <div class="row grid-modal-actions"><button type="button" onclick="resetCompetencyGridDraft()">Repartir de la proposition de départ</button><button type="button" class="primary" onclick="saveCompetencyGridModal(this)">💾 Enregistrer le modèle</button><button type="button" onclick="closeCompetencyGrid()">Annuler</button></div>
    <p class="status" role="status"></p>
  </section>`;
  document.body.appendChild(modal);
  competencyGridModalState={id:String(id),initial:JSON.stringify(collectGridCriteria(modal.querySelector('.competency-criteria'))),busy:false};
  modal.querySelector('button')?.focus();
}
function closeCompetencyGrid(){
  const modal=document.getElementById('competencyGridModal');if(!modal){competencyGridModalState=null;return true;}
  if(competencyGridModalState?.busy)return false;
  const current=JSON.stringify(collectGridCriteria(modal.querySelector('.competency-criteria')));
  if(current!==competencyGridModalState?.initial&&!confirm('Fermer sans enregistrer les modifications du modèle ?'))return false;
  modal.remove();competencyGridModalState=null;return true;
}
function resetCompetencyGridDraft(){
  const modal=document.getElementById('competencyGridModal'),state=competencyGridModalState;if(!modal||!state||state.busy)return;
  const comp=competenciesCache.find(c=>String(c.id)===state.id);if(!comp)return;
  if(!confirm('Remplacer le brouillon du modèle par la proposition de départ ? Rien ne sera enregistré tant que tu ne cliques pas sur Enregistrer.'))return;
  const proposal={...comp,grid_template:null};
  modal.querySelector('.competency-criteria').innerHTML=competencyGridCriteria(proposal).map(renderCriterionEditor).join('');
}
async function saveCompetencyGridModal(btn){
  const modal=document.getElementById('competencyGridModal'),state=competencyGridModalState;if(!modal||!state||state.busy)return;
  let model;try{model=validateCompetencyGrid(collectGridCriteria(modal.querySelector('.competency-criteria')));}catch(e){modal.querySelector('.status').textContent=e.message;return;}
  const comp=competenciesCache.find(c=>String(c.id)===state.id);
  if(!confirm('Enregistrer ce modèle pour « '+(comp?.nom||'cette compétence')+' » ? Il sera utilisé pour les prochaines questions ; aucune évaluation existante ne sera modifiée.'))return;
  state.busy=true;const controls=[...modal.querySelectorAll('button,input,select,textarea')];const previous=controls.map(el=>el.disabled);controls.forEach(el=>el.disabled=true);
  try{await persistCompetencyGrid(state.id,model);state.initial=JSON.stringify(model.criteres);modal.querySelector('.status').textContent='Modèle enregistré ✓';}
  catch(e){modal.querySelector('.status').textContent='Modèle non enregistré : '+e.message;}
  finally{state.busy=false;controls.forEach((el,i)=>el.disabled=previous[i]);}
}

function selectQuestionCompetency(select){
  const box=select.closest('.question-editor');if(!box)return;
  const previous=String(box.dataset.bankCompetencyId||'');
  if(String(select.value)===previous)return;
  const comp=competenciesCache.find(c=>String(c.id)===String(select.value));

  // Associer une compétence ne remplace jamais un barème déjà construit.
  const hasExistingGrid=questionGridHasContent(box);
  box.dataset.bankCompetencyId=comp?.id||'';
  box.dataset.competencyName=comp?.nom||'';

  if(comp&&!hasExistingGrid){
    applyQuestionGrid(box,comp);
  }else{
    updateQuestionGridNote(box);
  }
  renumberEvaluationQuestions();
}
function renumberEvaluationQuestions(){
  document.querySelectorAll("#competenciesEditor .question-editor")
    .forEach((box,i)=>{
      const input = box.querySelector(".question-number");
      const label = input?.previousElementSibling;
      const title = box.querySelector("strong");
      const nom = box.dataset.competencyName ||
        box.querySelector(".question-bank-select")
          ?.selectedOptions?.[0]?.textContent || "";
      const transversal = isTransversalLanguageCompetency(nom);
      if(input){
        input.style.display = transversal ? "none" : "";
        if(label?.tagName === "LABEL"){
          label.style.display = transversal ? "none" : "";
        }
      }
      if(transversal){
        if(title){
          title.textContent =
            "📝 Maîtriser la langue française — Compétence transversale";
        }
        return;
      }
      if(input && !input.value) input.value = i+1;
      const number = Number(input?.value || i+1);
      if(title) title.textContent = `📝 Question ${number}`;
    });
}
function indicatorEditor(item={}){
  return `<div class="eval-card indicator-row" style="margin:8px 0;padding:11px">
    <div class="eval-grid">
      <input class="indicator-name" value="${esc(item.nom||"")}" placeholder="Indicateur à valider">
      <input class="indicator-points" type="number" min="0" step="0.5" value="${esc(item.points??1)}" title="Points de cet indicateur">
      <button class="danger" onclick="this.closest('.indicator-row').remove()">×</button>
    </div>
    <div class="small-note" style="margin-top:6px">Les points servent au score. La validation du critère est cochée séparément lors de la correction.</div>
  </div>`;
}
function updateEvaluationTotal(){
  const input=document.getElementById("evTotal");
  if(!input)return;
  const total=[...document.querySelectorAll("#competenciesEditor .indicator-points")]
    .reduce((sum,el)=>sum+Number(el.value||0),0);
  input.value=Number.isFinite(total)?total:0;
}
function editEvaluationObject(ev){
  if(!correctionAllowLeave())return;
  const e=evalNormalize(ev);
  const previous=loadEvalNav();
  const returnClasse=String(e.classe||previous.classe||localStorage.getItem("EVAL_SELECTED_CLASS")||"").trim();
  saveEvalNav({view:"editor",classe:returnClasse,evaluationId:e.id||null,correctionId:null,draft:e});
  try{localStorage.setItem("EVAL_SELECTED_CLASS",returnClasse);}catch(err){}
  let comps=Array.isArray(e.competences)&&e.competences.length?e.competences:null;
  if(!comps){
    const crits=criteriaFromLegacy(e);
    const groups={};
    crits.forEach((cr,i)=>{const id=cr.competenceId||"comp1";if(!groups[id])groups[id]={id,nom:cr.competenceNom||e.competence||"",criteres:[]};groups[id].criteres.push(cr);});
    comps=Object.values(groups);
    if(!comps.length)comps=[{id:"comp1",nom:e.competence||"",criteres:criterionDefaults()}];
  }
  const totalAuto=comps.reduce((sum,co)=>sum+(co.criteres||[]).reduce((a,c)=>a+(c.indicateurs||[]).reduce((b,it)=>b+Number(it.points||0),0),0),0);
  content.innerHTML=`<button onclick="evalReturnToList()">← Mes évaluations</button>
  <section class="hero teacher" style="margin-top:14px">
    <span class="eyebrow">Paramétrage</span><h2>📝 ${e.id?"Modifier":"Créer"} une évaluation</h2>
    <div class="editbox">
      <label>Titre</label><input id="evTitre" value="${esc(e.titre)}">
      <label>Chapitre</label>
<input
  id="evChapitre"
  type="number"
  min="1"
  step="1"
  value="${e.chapitre||""}"
  placeholder="Ex. 1"
>

<label>Type</label>
<select id="evType">
  <option value="activite" ${(e.typeEvaluation==="activite")?"selected":""}>
    Activité
  </option>
  <option value="exercice" ${(e.typeEvaluation==="exercice")?"selected":""}>
    Exercice
  </option>
  <option value="evaluation" ${(!e.typeEvaluation||e.typeEvaluation==="evaluation")?"selected":""}>
    Évaluation de chapitre
  </option>
</select>

<input
  id="evCoefficient"
  type="hidden"
  value="${e.coefficient||1}"
>
<p id="evCoefficientInfo" class="small-note"></p>
      <label>Classes concernées</label>
      <div id="evClasses" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${Object.values(CLASSES).flat().map(c=>{const checked=(e.assignedClasses||[]).includes(c);return `<label style="display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid var(--b);border-radius:8px;background:#fff;cursor:pointer;white-space:nowrap;width:auto"><input type="checkbox" class="ev-class-check" style="width:auto" value="${esc(c)}" ${checked?'checked':''}> <span>${esc(c)}</span></label>`}).join("")}</div>
      <p class="small-note">La même grille peut être attribuée à plusieurs classes.</p>
      <label>Barème total</label><input id="evTotal" type="number" min="0" step="0.5" value="${esc(totalAuto)}" readonly><p class="small-note">Le barème total est calculé automatiquement à partir de la somme des points des indicateurs.</p>
    </div>
    <div class="section-heading">
  <h2>📝 Questions de l'évaluation</h2>
  <span class="status">Chaque question peut évaluer une compétence différente.</span>
</div>
    
    <div id="competenciesEditor">${comps.map(renderCompetencyEditor).join("")}</div>
    <button class="entry-add" onclick="addCompetencyEditor()">＋ Ajouter une compétence</button>
    <div class="editbox" style="margin-top:18px"><strong>💡 Principe</strong><p class="muted" style="margin-bottom:0">Chaque compétence possède ses propres critères et indicateurs. Lors de la correction, tu coches les indicateurs réussis puis tu valides les critères. La maîtrise est calculée séparément pour chaque compétence.</p></div>
    <div class="row"><button type="button" class="primary" onclick="event.preventDefault();saveEvaluationFromEditor('${esc(e.id||"")}')">💾 Enregistrer l'évaluation</button><span id="evalSaveStatus" class="status"></span></div>
  </section>`;
  const evType=document.getElementById("evType");
  const evCoefficient=document.getElementById("evCoefficient");
  const evCoefficientInfo=document.getElementById("evCoefficientInfo");
  function updateEvaluationType(){
    const isDemiCoefficient=["activite","exercice"].includes(evType?.value);
    if(evCoefficient){
      evCoefficient.value=isDemiCoefficient?"0.5":"1";
    }
    if(evCoefficientInfo){
      evCoefficientInfo.textContent=isDemiCoefficient
        ?`Coefficient : 0,5 (${evType?.value==="exercice"?"exercice":"activité"})`
        :"Coefficient : 1";
    }
  }
  evType?.addEventListener("change",updateEvaluationType);
  updateEvaluationType();
  loadBanks().then(()=>{
  populateQuestionCompetencyPickers();
}).catch(err=>{const status=document.getElementById('evalSaveStatus');if(status)status.textContent='Banque de compétences indisponible : '+err.message;});
updateEvaluationTotal();
  const editor=document.getElementById("competenciesEditor");
  if(editor){
    const observer=new MutationObserver(()=>updateEvaluationTotal());
    observer.observe(editor,{childList:true,subtree:true});
  }
  editor?.addEventListener("input",e=>{if(e.target.classList.contains("indicator-points"))updateEvaluationTotal();});
  localDraftBeginEditor(e.id);
}
function collectEvaluationEditor(){
  const questions=[...document.querySelectorAll("#competenciesEditor .question-editor")]
    .map((box,ci)=>{
      const id=box.dataset.competencyId||("comp"+(ci+1));
      const questionNumero=Number(
        box.querySelector(".question-number")?.value||ci+1
      );
      const bankId=box.dataset.bankCompetencyId||null;
      const competency=bankId
        ? competenciesCache.find(c=>String(c.id)===String(bankId))
        : null;
      const nom=competency?.nom||box.dataset.competencyName||"Compétence non renseignée";
      const criteres=[
        ...box.querySelectorAll(
          ":scope > .competency-criteria > .criterion-editor"
        )
      ].map((cb,i)=>({
        id:cb.dataset.criterionId||("c"+ci+"_"+i),
        nom:cb.querySelector(".criterion-name")?.value.trim()
          ||`Critère ${i+1}`,
        competenceId:id,
        competenceNom:nom,
        indicateurs:[
          ...cb.querySelectorAll(".indicator-row")
        ].map(row=>({
          nom:row.querySelector(".indicator-name")?.value.trim()||"",
          points:Number(
            row.querySelector(".indicator-points")?.value||0
          )
        })).filter(x=>x.nom)
      }));
      return {
        id,
        nom,
        bankId,
        questionNumero,
        criteres
      };
    });
  const criteres=questions.flatMap(q=>q.criteres);
  const totalAuto=criteres.reduce(
    (s,c)=>s+c.indicateurs.reduce(
      (a,it)=>a+Number(it.points||0),0
    ),0
  );
  const assignedClasses=[
    ...document.querySelectorAll(
      "#evClasses .ev-class-check:checked"
    )
  ]
  .map(x=>String(x.value).trim())
  .filter(Boolean);
  const typeEvaluation=
  document.getElementById("evType")?.value||"evaluation";
const chapitre=Number(
  document.getElementById("evChapitre")?.value||0
);
const coefficient=
  ["activite","exercice"].includes(typeEvaluation)
    ?0.5
    :1;
return {
  titre:document.getElementById("evTitre").value.trim()
    ||"Nouvelle évaluation",
  classe:assignedClasses[0]||"",
  assignedClasses,
  chapitre,
  typeEvaluation,
  coefficient,
  total:totalAuto,
  competences:questions,
  criteres,
  exercices:[]
};
}
async function saveEvaluationFromEditor(id){
  if(window.__savingEvaluation)return;
  if(!localDraftCanValidate())return;
  id=id||localDraftSession?.evaluationId||null;
  const localDraftTicket=localDraftBeforeSave();
  if(!localDraftCanValidate())return;
  window.__savingEvaluation=true;
  try{
    const btn=document.querySelector('#evalSaveStatus')?.parentElement?.querySelector('button.primary');
    if(btn)btn.disabled=true;
    const e=collectEvaluationEditor();e.id=id||null;
    const previousEvaluation=evaluationsCache.find(x=>String(x.id)===String(e.id));
    // Une édition ne doit pas détacher un sujet de son groupe ni effacer
    // les données complémentaires déjà stockées dans exercices.
    e.evaluationGroupId=previousEvaluation?.evaluationGroupId||"";
    e.exercices=Array.isArray(previousEvaluation?.exercices)
      ?previousEvaluation.exercices
      :[];
    e.atelierDocumentId=previousEvaluation?.atelierDocumentId||null;
    const saved=await saveEvaluationObject(e);
    let recalculatedCount=null;
    const rubricChanged=!!previousEvaluation &&
      evaluationRubricSignature(previousEvaluation)!==evaluationRubricSignature(saved);
    if(rubricChanged){
      recalculatedCount=await recalculateEvaluationCorrections(saved);
    }
    const idx=evaluationsCache.findIndex(x=>x.id===saved.id);
    if(idx>=0)evaluationsCache[idx]=saved;else evaluationsCache.unshift(saved);
    evalRememberFromEvaluation(saved,"editor",{evaluationId:saved.id,classe:loadEvalNav().classe||saved.classe});
    const s=document.getElementById("evalSaveStatus");
    if(s)s.textContent=recalculatedCount===null
      ?"Enregistré ✓"
      :`Enregistré ✓ — barème appliqué à ${recalculatedCount} copie(s)`;
    localDraftSaved(localDraftTicket,saved.id);
  }catch(err){
    alert("L'évaluation a peut-être été enregistrée, mais le recalcul des copies n'a pas pu être terminé. Vérifie les copies avant de relancer l'opération.\n\nDétail : "+err.message);
  }
  finally{
    window.__savingEvaluation=false;
    const btn=document.querySelector('#evalSaveStatus')?.parentElement?.querySelector('button.primary');
    if(btn)btn.disabled=false;
  }
}

/* Tableau central des copies : lecture de la classe, statuts existants et brouillons locaux. */
let copiesBoardState=null,copiesBoardRequest=0;
function copiesBoardName(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
async function copiesBoardRead(table,columns,configure){
  const rows=[];for(let from=0;;from+=500){
    let query=sb.from(table).select(columns);if(configure)query=configure(query);
    const result=await query.order('id').range(from,from+499);if(result.error)throw new Error(result.error.message);
    const page=result.data||[];rows.push(...page);if(page.length<500)return rows;
  }
}
function copiesBoardDrafts(ctx){
  const result=new Map();let warnings=0;
  try{
    const prefix=localDraftPrefix(),ids=new Set(ctx.members.map(e=>String(e.id))),rosterIds=new Set(ctx.roster.map(st=>String(st.id)));
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;
      let rec;try{rec=JSON.parse(localStorage.getItem(key));}catch(e){warnings++;continue;}
      if(rec?.mode!=='correction'||rec.owner!==String(user?.id)||rec.version!==1||!String(rec.context).startsWith('correction:'))continue;
      try{
        const [evalId,classe,target]=JSON.parse(rec.context.slice('correction:'.length));
        if(!ids.has(String(evalId))||String(classe)!==ctx.classe)continue;
        if(!Array.isArray(rec.payload?.checks)||!rec.payload.checks.every(v=>Array.isArray(v)&&typeof v[0]==='string'&&typeof v[1]==='boolean')){warnings++;continue;}
        if(key!==prefix+encodeURIComponent(rec.context)){warnings++;continue;}
        let studentIds=[];
        if(Array.isArray(target))studentIds=target.map(String);
        else if(rosterIds.has(String(target)))studentIds=[String(target)];
        else{
          const corr=ctx.corrections.find(c=>String(c.id)===String(target)&&String(c.evaluation_id)===String(evalId));
          if(corr?.eleve_id&&rosterIds.has(String(corr.eleve_id)))studentIds=[String(corr.eleve_id)];
          else{const matches=ctx.roster.filter(st=>[studentDisplayName(st),`${st.prenom||''} ${st.nom||''}`].map(copiesBoardName).includes(copiesBoardName(corr?.eleve||target)));if(matches.length===1)studentIds=[String(matches[0].id)];}
        }
        if(!studentIds.length){warnings++;continue;}
        const legacyCorrection=!Array.isArray(target)&&!rosterIds.has(String(target))?ctx.corrections.find(c=>String(c.id)===String(target)&&String(c.evaluation_id)===String(evalId)):null;
        const draft={key,record:rec,evalId:String(evalId),legacyCorrectionId:legacyCorrection?.id||null,nameTarget:!Array.isArray(target)&&!rosterIds.has(String(target))&&!legacyCorrection?String(target):null,groupIds:Array.isArray(target)?target.map(String):[],incompleteGroup:studentIds.some(id=>!rosterIds.has(id))};
        for(const id of studentIds.filter(id=>rosterIds.has(id))){if(!result.has(id))result.set(id,[]);result.get(id).push(draft);}
      }catch(e){warnings++;}
    }
    result.forEach(list=>list.sort((a,b)=>String(b.record.updatedAt||'').localeCompare(String(a.record.updatedAt||''))));
  }catch(e){return {byStudent:result,warning:'Lecture des brouillons locaux impossible : '+e.message};}
  return {byStudent:result,warning:warnings?warnings+' brouillon(s) local(aux) illisible(s) ou sans élève identifiable : ils ont été conservés.':''};
}
function copiesBoardRows(ctx){
  const drafts=copiesBoardDrafts(ctx),byStudent=new Map(ctx.roster.map(st=>[String(st.id),[]])),unlinked=[];
  const names=new Map();ctx.roster.forEach(st=>{const aliases=new Set([studentDisplayName(st),`${st.prenom||''} ${st.nom||''}`].map(copiesBoardName));aliases.forEach(name=>{if(!names.has(name))names.set(name,[]);names.get(name).push(String(st.id));});});
  for(const corr of ctx.corrections){
    if(corr.eleve_id){if(byStudent.has(String(corr.eleve_id)))byStudent.get(String(corr.eleve_id)).push(corr);continue;}
    const matches=names.get(copiesBoardName(corr.eleve))||[];
    if(matches.length===1)byStudent.get(matches[0]).push(corr);else if(String(corr.evaluation_id)===String(ctx.ev.id))unlinked.push(corr);
  }
  const rows=ctx.roster.map(student=>{
    const saved=(byStudent.get(String(student.id))||[])
      .filter(c=>!ctx.assignmentFilterEnabled||String(c.evaluation_id)===String(ctx.ev.id))
      .slice().sort((a,b)=>Number(String(b.evaluation_id)===String(ctx.ev.id))-Number(String(a.evaluation_id)===String(ctx.ev.id))||String(b.created_at||'').localeCompare(String(a.created_at||'')));
    const corr=saved[0]||null;
    const statuses=ctx.absences.filter(a=>String(a.eleve_id)===String(student.id)&&absenceMatches(a,ctx.ev,ctx.members,ctx.classe));
    const status=ctx.absenceError?'':evaluationStudentStatus(statuses);
    const closed=!corr&&(status==='absent'||status==='non_evalue');
    const local=drafts.byStudent.get(String(student.id))||[];
    return {student,corr,saved,status,closed,drafts:local,draft:local[0]||null,unknown:!corr&&!!ctx.absenceError,pending:!corr&&!closed&&!ctx.absenceError,conflict:!!corr&&statuses.length>0};
  });
  const visibleRows = ctx.assignmentFilterEnabled
    ? rows.filter(r =>
        (ctx.assignedStudentIds instanceof Set && ctx.assignedStudentIds.has(String(r.student.id))) ||
        String(r.corr?.evaluation_id || '') === String(ctx.ev.id) ||
        r.drafts.some(d => String(d.evalId) === String(ctx.ev.id)) ||
        r.closed || r.unknown
      )
    : rows;
  return {rows:visibleRows,unlinked,warning:drafts.warning};
}
function copiesBoardFilter(filter){
  const ctx=copiesBoardState;if(!ctx)return;
  ctx.filter=['todo','draft','done','closed','all'].includes(filter)?filter:'todo';saveEvalNav({copiesFilter:ctx.filter});copiesBoardRender();
}
function copiesBoardSearch(value){if(!copiesBoardState)return;copiesBoardState.search=String(value||'');saveEvalNav({copiesSearch:copiesBoardState.search});copiesBoardRenderRows();}
function copiesBoardCounts(rows){return {todo:rows.filter(r=>r.pending).length,draft:rows.filter(r=>r.draft).length,done:rows.filter(r=>r.corr).length,closed:rows.filter(r=>r.closed).length,all:rows.length};}
function copiesBoardRender(){
  const ctx=copiesBoardState,host=document.getElementById('copiesBoard');if(!ctx||!host)return;
  const report=copiesBoardRows(ctx);ctx.rows=report.rows;ctx.unlinked=report.unlinked;
  const count=copiesBoardCounts(ctx.rows),labels={todo:'À traiter',draft:'Brouillons locaux',done:'Corrigées',closed:'Non évalués / absents',all:'Tous'};
  host.innerHTML=`
    <div class="row" style="justify-content:flex-end;margin:10px 0">
      <button type="button" class="primary" onclick="openCorrectionGridSelection()">☑️ Sélectionner les grilles à imprimer</button>
    </div>
    ${ctx.absenceError?`<p class="copies-warning" role="alert">Statuts indisponibles : ${esc(ctx.absenceError)}. Le nombre de copies à traiter et de non-évalués n’est pas calculé. Réessaie avec Actualiser.</p>`:''}
    ${report.warning?`<p class="copies-warning" role="alert">${esc(report.warning)}</p>`:''}
    ${ctx.assignmentFilterEnabled?`<p class="small-note">Affichage filtré selon les sujets attribués à chaque élève. Les copies déjà enregistrées et les brouillons sont conservés.</p>`:''}
    <div class="copies-progress">${count.done} copie(s) validée(s) · ${ctx.absenceError?'statuts à vérifier':count.closed+' situation(s) clôturée(s) sans note · '+count.todo+' à traiter'} · ${count.all} élève(s)</div>
    <div class="copies-filters" role="group" aria-label="Filtrer les copies">${Object.entries(labels).map(([key,label])=>`<button type="button" class="${ctx.filter===key?'primary':''}" aria-pressed="${ctx.filter===key}" onclick="copiesBoardFilter('${key}')">${label} <span>${ctx.absenceError&&['todo','closed'].includes(key)?'—':count[key]}</span></button>`).join('')}</div>
    <p class="small-note">« À traiter » inclut les brouillons sans copie validée et les rattrapages à prévoir. Un brouillon de modification peut aussi concerner une copie déjà corrigée. Les brouillons sont visibles uniquement dans ce navigateur, pour ce compte.</p>
    <label for="copiesBoardSearch">Rechercher un élève</label><input id="copiesBoardSearch" type="search" value="${esc(ctx.search)}" oninput="copiesBoardSearch(this.value)" placeholder="Nom ou prénom">
    <p id="copiesBoardResultCount" class="small-note" role="status"></p>
    <div class="copies-table-wrap"><table class="mastery-table copies-table"><thead><tr><th scope="col">Élève</th><th scope="col">État</th><th scope="col">Sujet / note validée</th><th scope="col">Actions</th></tr></thead><tbody id="copiesBoardRows"></tbody></table></div>
    ${ctx.unlinked.length?`<details class="copies-unlinked"><summary>${ctx.unlinked.length} ancienne(s) copie(s) sans rattachement certain à un élève — non comptées dans le tableau</summary>${ctx.unlinked.map(c=>correctionCard(ctx.ev,c)).join('')}</details>`:''}`;
  copiesBoardRenderRows();
}
function openCorrectionGridSelection(){
  const ctx=copiesBoardState;
  if(!ctx)return;
  const available=(ctx.rows||[]).map(row=>({
    student:row.student,
    correction:(row.saved||[]).find(c=>String(c.evaluation_id)===String(ctx.ev.id))||null
  })).filter(item=>item.correction)
   .sort((a,b)=>studentDisplayName(a.student).localeCompare(studentDisplayName(b.student),"fr",{numeric:true,sensitivity:"base"}));
  if(!available.length){
    alert("Aucune grille de correction enregistrée pour ce sujet.");
    return;
  }
  document.getElementById("correctionGridSelectionModal")?.remove();
  const modal=document.createElement("div");
  modal.id="correctionGridSelectionModal";
  modal.className="pp-modal";
  modal.innerHTML=`<div class="pp-modal-card" style="max-width:620px;max-height:85vh;overflow:auto">
    <div class="section-heading">
      <div><span class="eyebrow">${esc(ctx.classe)} · ${available.length} grille(s)</span><h3 style="margin:4px 0 0">☑️ Choisir les grilles à imprimer</h3></div>
      <button type="button" onclick="document.getElementById('correctionGridSelectionModal')?.remove()">✕</button>
    </div>
    <p class="small-note">Coche les élèves dont tu souhaites imprimer la grille pour cette évaluation.</p>
    <div class="row" style="margin:12px 0">
      <button type="button" onclick="toggleCorrectionGridSelection(true)">Tout sélectionner</button>
      <button type="button" onclick="toggleCorrectionGridSelection(false)">Tout désélectionner</button>
    </div>
    <div id="correctionGridSelectionList" style="display:grid;gap:7px">
      ${available.map(item=>`<label style="display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--b);border-radius:9px">
        <input type="checkbox" class="correction-grid-student-check" value="${esc(item.student.id)}" style="width:auto">
        <span>${esc(studentDisplayName(item.student))}</span>
      </label>`).join("")}
    </div>
    <div class="row" style="justify-content:space-between;margin-top:16px">
      <span id="correctionGridSelectionCount" class="small-note">${available.length} grille(s) disponibles</span>
      <div class="row" style="margin:0">
        <button type="button" onclick="document.getElementById('correctionGridSelectionModal')?.remove()">Annuler</button>
        <button type="button" class="primary" onclick="printSelectedCorrectionGrids()">📥 Imprimer la sélection</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll(".correction-grid-student-check").forEach(check=>{
    check.addEventListener("change",updateCorrectionGridSelectionCount);
  });
}
function toggleCorrectionGridSelection(checked){
  document.querySelectorAll("#correctionGridSelectionList .correction-grid-student-check").forEach(el=>{el.checked=!!checked;});
  updateCorrectionGridSelectionCount();
}
function updateCorrectionGridSelectionCount(){
  const count=document.querySelectorAll("#correctionGridSelectionList .correction-grid-student-check:checked").length;
  const label=document.getElementById("correctionGridSelectionCount");
  if(label)label.textContent=`${count} grille(s) sélectionnée(s)`;
}
function printSelectedCorrectionGrids(){
  const ctx=copiesBoardState;
  if(!ctx)return;
  const ids=[...document.querySelectorAll("#correctionGridSelectionList .correction-grid-student-check:checked")].map(el=>String(el.value));
  if(!ids.length){alert("Sélectionne au moins un élève.");return;}
  const printTab=window.open("about:blank","_blank");
  if(!printTab){alert("Le navigateur a bloqué l’ouverture du nouvel onglet. Autorise les fenêtres surgissantes pour ce site puis réessaie.");return;}
  try{
    const pages=[];
    ids.forEach(id=>{
      const row=(ctx.rows||[]).find(item=>String(item.student?.id)===id);
      const correction=(row?.saved||[]).find(c=>String(c.evaluation_id)===String(ctx.ev.id));
      if(correction){
        pages.push(correctionGridHtml(ctx.ev,{
          ...correction,
          eleve:studentDisplayName(row.student),
          classe:ctx.classe
        },ctx.classe));
      }
    });
    if(!pages.length)throw new Error("Aucune grille sélectionnée n’a pu être retrouvée.");
    printHtmlInCurrentWindow(`Grilles corrigées — ${ctx.ev.titre||"Évaluation"} — ${ctx.classe}`,pages.join(""),"",printTab);
    document.getElementById("correctionGridSelectionModal")?.remove();
  }catch(e){
    if(printTab&&!printTab.closed)printTab.close();
    alert("Impression des grilles sélectionnées impossible : "+e.message);
  }
}
function copiesBoardRenderRows(){
  const ctx=copiesBoardState,host=document.getElementById('copiesBoardRows');if(!ctx||!host)return;
  const search=copiesBoardName(ctx.search);
  const rows=ctx.rows.filter(r=>(!search||copiesBoardName(studentDisplayName(r.student)).includes(search))&&(ctx.filter==='all'||ctx.filter==='todo'&&(r.pending||r.unknown)||ctx.filter==='draft'&&r.draft||ctx.filter==='done'&&r.corr||ctx.filter==='closed'&&r.closed));
  host.innerHTML=rows.map(r=>{
    const st=r.student;
    let state=r.corr?'Corrigée':r.status==='non_evalue'?'Non évalué — terminé':r.status==='absent'?'Absent — terminé':r.status==='rattrapage'?'Rattrapage à prévoir':r.unknown?'Statut à vérifier':r.draft?'Brouillon — non validé':'À corriger';
    if(r.draft&&r.corr)state='Corrigée · modifications en brouillon';
    if(r.draft&&r.closed)state+=' · brouillon local conservé';
    const source=r.corr?ctx.members.find(e=>String(e.id)===String(r.corr.evaluation_id)):null;
    const draftSource=r.draft?ctx.members.find(e=>String(e.id)===r.draft.evalId):null;
    const raw=r.corr?.resultat?.note??r.corr?.resultat?.score;
    const note=r.corr&&raw!==''&&raw!==null&&raw!==undefined&&Number.isFinite(Number(raw))?Number(raw).toLocaleString('fr-FR')+' / '+Number(source?.total||0).toLocaleString('fr-FR'):'—';
    const sameSubject=source?String(source.id)===String(ctx.ev.id):true;
    return `<tr data-copies-student="${esc(st.id)}"><td><strong>${esc(studentDisplayName(st))}</strong></td>
      <td><span class="copies-state ${r.closed?'copies-closed':r.corr?'copies-done':r.draft?'copies-draft':'copies-todo'}">${esc(state)}</span>${r.conflict?'<p class="small-note copies-warning">Une copie existe : ancien statut à vérifier.</p>':''}${r.drafts.length>1?`<p class="small-note">${r.drafts.length} brouillons locaux ; le plus récent sera proposé.</p>`:''}</td>
      <td>${esc(source?.titre||draftSource?.titre||ctx.ev.titre)}${!sameSubject?'<p class="small-note">Copie validée sur un autre sujet du même ensemble existant.</p>':''}<div>${esc(note)}</div></td>
      <td><div class="copies-row-actions"><button type="button" class="primary" onclick="copiesBoardOpenStudent(${jsArg(st.id)})">${r.draft?'Reprendre le brouillon':r.corr?'Consulter / modifier':'Corriger'}</button>
      ${r.corr&&r.draft?`<button type="button" onclick="editCorrection(${jsArg(r.corr.evaluation_id)},${jsArg(r.corr.id)})">Ouvrir la copie validée</button>`:''}
      <button type="button" onclick="copiesBoardOpenStatus(${jsArg(st.id)})">${r.closed||r.status||r.conflict?'Modifier le statut':'Statut / non évalué'}</button>
      ${r.corr&&String(r.corr.evaluation_id)===String(ctx.ev.id)?`<button type="button" class="danger" onclick="deleteCorrection(${jsArg(ctx.ev.id)},${jsArg(r.corr.id)},${jsArg(studentDisplayName(st))})">Supprimer la copie</button>`:''}</div></td></tr>`;
  }).join('')||'<tr><td colspan="4">Aucun élève pour ce filtre et cette recherche.</td></tr>';
  document.getElementById('copiesBoardResultCount').textContent=rows.length+' élève(s) affiché(s) sur '+(ctx.rows?.length ?? ctx.roster.length)+'.';
}
async function copiesBoardOpenStudent(studentId){
  const ctx=copiesBoardState;if(!ctx||ctx.openBusy)return;
  const row=ctx.rows.find(r=>String(r.student.id)===String(studentId));if(!row)return;
  ctx.openBusy=true;
  try{
    if(row.draft){
      const d=row.draft,raw=localStorage.getItem(d.key);if(!raw){await copiesBoardRefresh();alert('Ce brouillon n’est plus disponible. Le tableau a été actualisé.');return;}
      if(d.incompleteGroup){alert('Ce brouillon de groupe contient un élève qui n’est plus dans cette classe. Il est conservé, mais ne peut pas être repris automatiquement depuis le tableau.');return;}
      saveEvalNav({classe:ctx.classe});
      if(d.groupIds.length){await renderCorrectionEditor(d.evalId,null,{eleve:d.groupIds.length+' élèves sélectionnés',eleve_id:'',resultat:{points:{},note:0,criteriaStats:{}}},d.groupIds);return;}
      let query=sb.from('EvaluationCorrections').select('id,eleve,eleve_id,resultat').eq('evaluation_id',d.evalId);
      query=d.legacyCorrectionId?query.eq('id',d.legacyCorrectionId):query.eq('eleve_id',row.student.id);
      const q=await query.order('created_at',{ascending:false}).limit(1).maybeSingle();if(q.error)throw new Error(q.error.message);
      await renderCorrectionEditor(d.evalId,q.data?.id||null,q.data||{eleve:d.nameTarget||studentDisplayName(row.student),eleve_id:d.nameTarget?'':row.student.id,resultat:{points:{},note:0,criteriaStats:{}}});return;
    }
    if(row.corr){await editCorrection(row.corr.evaluation_id,row.corr.id);return;}
    if(row.closed||row.status==='rattrapage'){await copiesBoardOpenStatus(studentId);alert('Annule le statut existant avant d’enregistrer une correction. Aucune note n’a été créée.');return;}
    const q=await sb.from('EvaluationCorrections').select('id,eleve,eleve_id,resultat').eq('evaluation_id',ctx.ev.id).eq('eleve_id',row.student.id).order('created_at',{ascending:false}).limit(1).maybeSingle();if(q.error)throw new Error(q.error.message);
    await renderCorrectionEditor(ctx.ev.id,q.data?.id||null,q.data||{eleve:studentDisplayName(row.student),eleve_id:row.student.id,resultat:{points:{},note:0,criteriaStats:{}}});
  }catch(e){alert('Ouverture impossible : '+e.message);}finally{ctx.openBusy=false;}
}
async function copiesBoardOpenStatus(studentId){
  const ctx=copiesBoardState;if(!ctx)return;
  await openEvaluationAbsences(ctx.ev.id,ctx.classe);
  [...document.querySelectorAll('#absenceBody [data-absence-student]')].find(el=>String(el.dataset.absenceStudent)===String(studentId))?.scrollIntoView({block:'center'});
}
async function copiesBoardRefresh(){const ctx=copiesBoardState;if(ctx&&document.getElementById('copiesBoard'))await openCorrection(ctx.ev.id,ctx.classe);}
window.addEventListener('storage',e=>{if(document.getElementById('copiesBoard')&&(!e.key||e.key.startsWith(localDraftPrefix())))copiesBoardRender();});

async function openCorrection(id,classOverride=""){
  if(!correctionAllowLeave())return;
  const request=++copiesBoardRequest;let navigationCommitted=false;
  try{
    const q=await sb.from('Evaluations').select('*').eq('id',id).maybeSingle();if(q.error)throw new Error(q.error.message);if(!q.data)throw new Error('Évaluation introuvable.');
    const ev=evalNormalize(q.data),previous=loadEvalNav(),classe=String(classOverride||previous.classe||ev.classe||'').trim();
    if(!classe){alert('Sélectionne une classe.');return;}
    const same=String(previous.evaluationId)===String(id)&&String(previous.classe)===classe;
    evalRememberFromEvaluation(ev,'correction',{evaluationId:ev.id,classe,correctionId:null});navigationCommitted=true;
    saveEvalNav({copiesFilter:same?(previous.copiesFilter||'todo'):'todo',copiesSearch:same?(previous.copiesSearch||''):''});
    try{localStorage.setItem('EVAL_SELECTED_CLASS',classe);}catch(e){}
    if(isHistoricalEvaluation(ev)){await openHistoricalCorrection(id,ev);return;}
    content.innerHTML='<section class="hero"><p role="status">Chargement du tableau des copies…</p></section>';
    await loadBanks();
    const evaluations=await dashboardReadAll('Evaluations','id,titre,classe,total,criteres,exercices,created_at');
    const members=evaluationScopeMembers(ev,evaluations,classe);if(!members.some(e=>String(e.id)===String(ev.id)))members.push(ev);
    const assignmentFilterEnabled = ["activite", "exercice"].includes(String(ev.typeEvaluation || "evaluation"));
    // Reconstitue le même travail que dans « Attribuer les sujets » à partir
    // de l'identifiant de groupe enregistré dans les métadonnées de l'évaluation.
    const assignmentWorkId = String(ev.evaluationGroupId || `evaluation_${ev.id}`);
    const workSubjects = evaluations.map(evalNormalize).filter(subject =>
      evaluationAppliesToClass(subject, classe) &&
      Number(subject.chapitre) === Number(ev.chapitre) &&
      String(subject.typeEvaluation || "evaluation") === String(ev.typeEvaluation || "evaluation") &&
      !isHistoricalEvaluation(subject) &&
      String(subject.evaluationGroupId || `evaluation_${subject.id}`) === assignmentWorkId
    );
    if (!workSubjects.some(subject => String(subject.id) === String(ev.id))) workSubjects.push(ev);

    const [corrections,absenceResult,roster,subjectAssignments]=await Promise.all([
      copiesBoardRead('EvaluationCorrections','id,evaluation_id,eleve,eleve_id,resultat,created_at',query=>query.in('evaluation_id',members.map(e=>e.id))),
      copiesBoardRead(ABSENCE_TABLE,'*',query=>query.eq('classe',classe)).then(data=>({data,error:''})).catch(e=>({data:[],error:e.message})),
      copiesBoardRead('Eleves','id,classe,nom,prenom',query=>query.eq('classe',classe)),
      assignmentFilterEnabled
        // On lit toutes les attributions de ce chapitre puis on isole le travail
        // exact avec travail_id / les identifiants de ses versions. Cela récupère
        // aussi les anciennes lignes dont evaluation_id ne figure plus dans members.
        ? copiesBoardRead('EvaluationSubjectAssignments','id,eleve_id,evaluation_id,travail_id',query=>query.eq('classe',classe).eq('chapitre',Number(ev.chapitre)))
        : Promise.resolve([])
    ]);
    const workSubjectIds = new Set(workSubjects.map(subject => String(subject.id)));
    const workAssignments = (subjectAssignments || []).filter(assignment =>
      workSubjectIds.has(String(assignment.evaluation_id)) ||
      String(assignment.travail_id || '') === assignmentWorkId
    );
    // Si le travail ne possède qu'un seul sujet, aucune attribution individuelle
    // n'est requise. Les copies des sujets multiples, elles, sont filtrées ci-dessous.
    const hasAssignmentsForWork = assignmentFilterEnabled && workSubjects.length > 1 && workAssignments.length > 0;
    const assignedStudentIds = new Set(workAssignments
      .filter(assignment => String(assignment.evaluation_id) === String(ev.id))
      .map(assignment => String(assignment.eleve_id)));
    if(request!==copiesBoardRequest||loadEvalNav().view!=='correction'||String(loadEvalNav().evaluationId)!==String(id)||String(loadEvalNav().classe)!==classe)return;
    studentsCache=[...studentsCache.filter(st=>String(st.classe||'').trim()!==classe),...roster];
    const nav=loadEvalNav();copiesBoardState={ev,members,classe,roster:sortStudents(roster),corrections,absences:absenceResult.data,absenceError:absenceResult.error,assignmentFilterEnabled:hasAssignmentsForWork,assignedStudentIds,filter:nav.copiesFilter||'todo',search:nav.copiesSearch||'',openBusy:false};
    content.innerHTML=`<button type="button" onclick="evalReturnToList()">← Mes évaluations</button><section class="hero" style="margin-top:14px"><span class="eyebrow">${esc(classe)}</span><h2>📝 Copies · ${esc(ev.titre)}</h2><p class="muted">Tous les élèves de la classe, les copies validées, les situations clôturées et les brouillons de cet appareil.</p><div class="row copies-toolbar"><button type="button" class="primary" onclick="pickStudentForCorrection(${jsArg(ev.id)},${jsArg(classe)})">＋ Correction de groupe / choisir les élèves</button><button type="button" onclick="copiesBoardRefresh()">↻ Actualiser</button><button type="button" onclick="openIndicatorReport(${jsArg(ev.id)},${jsArg(classe)})">🎯 Bilan des indicateurs</button><button type="button" onclick="openEvaluationAbsences(${jsArg(ev.id)},${jsArg(classe)})">Absences / non évalués</button><button type="button" onclick="printAllCorrectionGrids(${jsArg(ev.id)})">📥 Grilles validées de ce sujet en PDF</button></div><div id="copiesBoard"></div></section>`;
    copiesBoardRender();
  }catch(e){if(request===copiesBoardRequest&&(!navigationCommitted||(loadEvalNav().view==='correction'&&String(loadEvalNav().evaluationId)===String(id))))showError(e.message);}
}
async function openHistoricalCorrection(evalId,evArg){
  if(!correctionAllowLeave())return;
  try{
    const q=evArg?{data:evArg,error:null}:await sb.from("Evaluations").select("*").eq("id",evalId).maybeSingle();
    if(q.error)throw new Error(q.error.message);
    if(!q.data)throw new Error("Évaluation introuvable.");
    const ev=evalNormalize(q.data),meta=historicalMeta(ev);
    const correctionClass=String(loadEvalNav().classe||ev.classe||"").trim();
    evalRememberFromEvaluation(ev,"correction",{evaluationId:ev.id,classe:correctionClass,correctionId:null});
    try{localStorage.setItem("EVAL_SELECTED_CLASS",correctionClass);}catch(e){}
    await loadBanks();
    const targetClass=correctionClass;
    const students=sortStudents(studentsCache.filter(s=>!targetClass||String(s.classe||"").trim()===targetClass));
    if(!students.length){
      alert(`Aucun élève enregistré dans la classe ${ev.classe||"de cette évaluation"}.\n\nAjoute-les dans « 👥 Élèves & compétences ».`);
      return;
    }
    const corr=await sb.from("EvaluationCorrections").select("id,eleve,eleve_id,resultat").eq("evaluation_id",evalId);
    if(corr.error)throw new Error(corr.error.message);
    const byId=new Map((corr.data||[]).filter(x=>x.eleve_id).map(x=>[String(x.eleve_id),x]));
    content.innerHTML=`<button onclick="evalReturnToList()">← Mes évaluations</button>
      <section class="hero" style="margin-top:14px">
        <span class="eyebrow">${esc(ev.classe||"Classe")} · Évaluation antérieure</span>
        <h2>🕘 ${esc(ev.titre)}</h2>
        <p class="muted">${meta.date?`Date : ${esc(meta.date)} · `:""}Compétence : ${esc(meta.competence||"Non renseignée")}</p>
        <p class="small-note">Cette évaluation a été réalisée avant le nouveau système. On conserve uniquement les informations que tu connais, sans recréer artificiellement les anciens critères. <strong>Si tu ne renseignes pas de niveau de maîtrise, la compétence reste « non renseignée » : elle n'est pas considérée comme MI.</strong></p>
        <div style="overflow:auto;margin-top:16px"><table class="mastery-table">
          <thead><tr><th>Élève</th><th>Note</th><th>Maîtrise</th></tr></thead>
          <tbody>${students.map(s=>{
            const c=byId.get(String(s.id)),r=c?.resultat||{};
            return `<tr>
              <td><strong>${esc(studentDisplayName(s))}</strong></td>
              <td><input id="histNote_${esc(s.id)}" type="number" min="0" step="0.1" value="${Number.isFinite(Number(r.note))?Number(r.note):""}" style="width:90px;padding:8px;border:1px solid var(--b);border-radius:8px"></td>
              <td><select id="histMastery_${esc(s.id)}" style="padding:8px;border:1px solid var(--b);border-radius:8px">
                <option value="">— Non renseigné</option>
                <option value="TBM" ${r.masteryCode==="TBM"?"selected":""}>TBM — Très bonne maîtrise</option>
                <option value="MS" ${r.masteryCode==="MS"?"selected":""}>MS — Maîtrise satisfaisante</option>
                <option value="MF" ${r.masteryCode==="MF"?"selected":""}>MF — Maîtrise fragile</option>
                <option value="MI" ${r.masteryCode==="MI"?"selected":""}>MI — Maîtrise insuffisante</option>
              </select></td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
        <div class="row" style="margin-top:16px">
          <button id="saveHistoricalBtn" class="primary" onclick="saveHistoricalResults('${esc(ev.id)}')">💾 Enregistrer les résultats</button>
          <span id="historicalSaveStatus" class="status"></span>
          <button type="button" onclick="evalReturnToList()">Annuler</button>
        </div>
      </section>`;
  }catch(e){showError(e.message)}
}
async function saveHistoricalResults(evalId){
  const btn=document.getElementById("saveHistoricalBtn");
  const status=document.getElementById("historicalSaveStatus");
  try{
    if(btn){btn.disabled=true;btn.textContent="⏳ Enregistrement…";}
    if(status)status.textContent="";
    const ev=evaluationsCache.find(x=>String(x.id)===String(evalId))||null;
    const q=ev?{data:ev,error:null}:await sb.from("Evaluations").select("*").eq("id",evalId).maybeSingle();
    if(q.error)throw new Error(q.error.message);
    if(!q.data)throw new Error("Évaluation introuvable.");
    const e=evalNormalize(q.data);
    await loadBanks();
    const students=studentsCache.filter(s=>!e.classe||s.classe===e.classe);
    const existing=await sb.from("EvaluationCorrections").select("id,eleve,eleve_id,resultat").eq("evaluation_id",evalId);
    if(existing.error)throw new Error(existing.error.message);
    const byId=new Map((existing.data||[]).filter(x=>x.eleve_id).map(x=>[String(x.eleve_id),x]));
    let savedCount=0;
    for(const s of students){
      const noteEl=document.getElementById(`histNote_${s.id}`);
      const masteryEl=document.getElementById(`histMastery_${s.id}`);
      const noteRaw=noteEl?.value??"";
      const masteryCode=masteryEl?.value||"";
      if(noteRaw==="" && !masteryCode)continue;
      const payload={
        evaluation_id:evalId,
        eleve:s.nom,
        eleve_id:s.id,
        resultat:{
          ...(byId.get(String(s.id))?.resultat||{}),
          historique:true,
          note:Number(noteRaw||0),
          points:{},
          criteriaStats:{},
          masteryCode
        }
      };
      const old=byId.get(String(s.id));
      const r=old
        ? await sb.from("EvaluationCorrections").update(payload).eq("id",old.id)
        : await sb.from("EvaluationCorrections").insert(payload);
      if(r.error)throw new Error(`${s.nom} : ${r.error.message}`);
      savedCount++;
    }
    if(status){
      status.textContent=`✓ ${savedCount} résultat(s) enregistré(s) dans Supabase`;
      status.style.color="var(--ok,#1b7f4b)";
    }
    if(btn){btn.disabled=false;btn.textContent="💾 Enregistrer les résultats";}
  }catch(e){
    if(status){
      status.textContent="⚠️ Enregistrement impossible : "+e.message;
      status.style.color="var(--danger,#b42318)";
    }
    if(btn){btn.disabled=false;btn.textContent="💾 Enregistrer les résultats";}
  }
}
function correctionCard(ev,c){
  const r=c.resultat||{};return `<article class="eval-card"><div class="entry-head"><div><h3>👤 ${esc(c.eleve||"Élève")}</h3><span class="score-pill">${Number(r.note||0)} / ${Number(ev.total||0)}</span></div><div class="row" style="margin:0"><button class="primary" onclick="editCorrection('${esc(ev.id)}','${esc(c.id)}')">Ouvrir</button><button type="button" class="danger" onclick="deleteCorrection(${jsArg(ev.id)},${jsArg(c.id)},${jsArg(c.eleve||"Élève")})">🗑️ Supprimer</button></div></div></article>`;
}
async function deleteCorrection(evalId,correctionId,eleve){
  if(!confirm(`Supprimer la correction de « ${eleve||"Élève"} » ?\n\nCette copie corrigée sera définitivement supprimée.`))return;
  try{
    const {error}=await sb.from("EvaluationCorrections").delete().eq("id",correctionId);
    if(error)throw new Error(error.message);
    await openCorrection(evalId);
  }catch(e){
    alert("Suppression impossible : "+e.message);
  }
}
function studentDisplayName(s){
  const nom=String(s?.nom||"").trim();
  const prenom=String(s?.prenom||"").trim();
  return `${nom} ${prenom}`.trim() || String(s?.name||"Élève").trim();
}
function sortStudents(list){
  return [...list].sort((a,b)=>{
    const nomA=String(a?.nom||"").trim();
    const nomB=String(b?.nom||"").trim();
    const c=nomA.localeCompare(nomB,"fr",{numeric:true,sensitivity:"base"});
    if(c!==0)return c;
    return String(a?.prenom||"").trim().localeCompare(String(b?.prenom||"").trim(),"fr",{numeric:true,sensitivity:"base"});
  });
}
async function loadBanks(){
  const [st,co]=await Promise.all([
    sb.from("Eleves").select("id,classe,nom,prenom,created_at").order("classe").order("nom").order("prenom"),
    sb.from("ProfessorCompetencies").select("*").order("niveau").order("nom")
  ]);
  if(st.error)throw new Error(st.error.message);
  if(co.error)throw new Error(co.error.message);
  studentsCache=st.data||[];competenciesCache=co.data||[];
}
async function openBanks(){
  if(!correctionAllowLeave())return;
  saveEvalNav({view:"banks"});
  try{
    await loadBanks();
    content.innerHTML=`<button type="button" onclick="home()">← Accueil</button>
      <section class="hero" style="margin-top:14px"><span class="eyebrow">Banques</span><h2>👥 Élèves & compétences</h2><p class="muted">Ces banques servent à sélectionner rapidement les élèves et les compétences dans les évaluations. Elles alimentent aussi le suivi.</p></section>
      <div class="bank-grid">
        <section class="hero"><div class="entry-head"><div><h3>👥 Banque d'élèves</h3><p class="small-note">Un élève est enregistré dans une classe.</p></div><button class="primary" onclick="addStudent()">＋ Élève</button></div>
          <div class="bank-list" id="studentBankList">${renderStudentBank()}</div></section>
        <section class="hero"><div class="entry-head"><div><h3>🎯 Banque de compétences</h3><p class="small-note">Chaque compétence dispose d’une grille de départ. Construis et enregistre ton modèle pour le réutiliser dans les évaluations.</p></div><button class="primary" onclick="addCompetency()">＋ Compétence</button></div>
          <div class="bank-list" id="competencyBankList">${renderCompetencyBank()}</div></section>
      </div>`;
  }catch(e){showError(e.message)}
}
function renderStudentBank(){
  const groups={};
  studentsCache.forEach(s=>(groups[s.classe]??=[]).push(s));
  const classes=Object.keys(groups).sort((a,b)=>a.localeCompare(b,"fr",{numeric:true}));
  if(!classes.length)return `<p class="muted">Aucun élève enregistré.</p>`;
  return classes.map(cls=>{
    const students=sortStudents(groups[cls]);
    return `<div class="criteria-box"><strong>${esc(cls)}</strong>${students.map(s=>`<div class="bank-item"><div class="bank-item-main"><strong>${esc(studentDisplayName(s))}</strong></div><div class="bank-actions"><button onclick="editStudent('${esc(s.id)}')">✏️</button><button class="danger" onclick="deleteStudent(${jsArg(s.id)},${jsArg(studentDisplayName(s))})">🗑️</button></div></div>`).join("")}</div>`;
  }).join("");
}
function renderCompetencyBank(){
  const groups={};competenciesCache.forEach(c=>(groups[c.niveau||"Tous niveaux"]??=[]).push(c));
  const levels=Object.keys(groups).sort((a,b)=>a.localeCompare(b,"fr"));
  if(!levels.length)return `<p class="muted">Aucune compétence enregistrée.</p>`;
  return levels.map(level=>`<div class="criteria-box"><strong>${esc(level)}</strong>${groups[level].map(c=>`<div class="bank-item"><div class="bank-item-main"><strong>${esc(c.nom)}</strong></div><div class="bank-actions"><button type="button" onclick="openCompetencyGrid(${jsArg(c.id)})">📋 ${competencyGridIsSaved(c)?"Modifier le modèle":"Construire la grille"}</button><button onclick="editCompetency('${esc(c.id)}')">✏️</button><button class="danger" onclick="deleteCompetency(${jsArg(c.id)},${jsArg(c.nom)})">🗑️</button></div></div>`).join("")}</div>`).join("");
}
async function addStudent(existing){
  const nom=prompt("Nom de famille de l'élève :",existing?.nom||"");if(nom===null||!nom.trim())return;
  const prenom=prompt("Prénom de l'élève :",existing?.prenom||"");if(prenom===null||!prenom.trim())return;
  const classePrompt=prompt(`Classe (ex. ${Object.values(CLASSES).flat().join(", ")}) :`,existing?.classe||"");if(classePrompt===null||!classePrompt.trim())return;
  const classeValue=classePrompt.trim();
  const allowedClasses=new Set(Object.values(CLASSES).flat());
  if(!allowedClasses.has(classeValue)){alert(`Classe inconnue : « ${classeValue} ».\n\nUtilise une des classes prévues : ${[...allowedClasses].join(", ")}.`);return;}
  const payload={nom:nom.trim(),prenom:prenom.trim(),classe:classeValue};
  const q=existing?await sb.from("Eleves").update(payload).eq("id",existing.id):await sb.from("Eleves").insert(payload);
  if(q.error){alert("Enregistrement impossible : "+q.error.message);return} await openBanks();
}
async function editStudent(id){const s=studentsCache.find(x=>String(x.id)===String(id));if(s)await addStudent(s)}
async function deleteStudent(id,nom){if(!confirm(`Retirer « ${nom} » de la banque d'élèves ?\n\nLes anciennes corrections seront conservées.`))return;const q=await sb.from("Eleves").delete().eq("id",id);if(q.error){alert("Suppression impossible : "+q.error.message);return}await openBanks()}
async function addCompetency(existing){
  const nom=prompt("Nom de la compétence :",existing?.nom||"");if(nom===null||!nom.trim())return;
  const niveau=prompt("Niveau (ex. 6e, 5e, 4e, 3e ou Tous niveaux) :",existing?.niveau||"Tous niveaux");if(niveau===null||!niveau.trim())return;
  const payload={nom:nom.trim(),niveau:niveau.trim()};
  const q=existing?await sb.from("ProfessorCompetencies").update(payload).eq("id",existing.id):await sb.from("ProfessorCompetencies").insert(payload);
  if(q.error){alert("Enregistrement impossible : "+q.error.message);return}await openBanks();
}
async function editCompetency(id){const c=competenciesCache.find(x=>String(x.id)===String(id));if(c)await addCompetency(c)}
async function deleteCompetency(id,nom){if(!confirm(`Supprimer la compétence « ${nom} » de la banque ?\n\nElle ne sera pas supprimée des évaluations existantes.`))return;const q=await sb.from("ProfessorCompetencies").delete().eq("id",id);if(q.error){alert("Suppression impossible : "+q.error.message);return}await openBanks()}
async function pickStudentForCorrection(evalId, selectedClass){
  try{
    await loadBanks();
    const ev=evalNormalize((evaluationsCache.find(x=>String(x.id)===String(evalId)))||{});
    const classes=[...new Set(studentsCache.map(s=>String(s.classe||"").trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,"fr",{numeric:true,sensitivity:"base"}));
    const currentClass=selectedClass!==undefined?String(selectedClass).trim():String(loadEvalNav().classe||ev.classe||"").trim();
    if(currentClass){
  saveEvalNav({classe:currentClass});
  try{
    localStorage.setItem("EVAL_SELECTED_CLASS",currentClass);
  }catch(e){}
}
    const students=currentClass?sortStudents(studentsCache.filter(s=>String(s.classe||"").trim()===currentClass)):[];
    const existing=await sb.from("EvaluationCorrections").select("id,eleve,eleve_id,resultat").eq("evaluation_id",evalId);
    if(existing.error)throw new Error(existing.error.message);
    const byId=new Map((existing.data||[]).filter(x=>x.eleve_id).map(x=>[String(x.eleve_id),x]));
    content.innerHTML=`<button onclick="openCorrection('${esc(evalId)}')">← Retour aux copies</button>
      <section class="hero" style="margin-top:14px">
        <span class="eyebrow">${esc(ev.classe||"Correction")}</span>
        <h2>👥 Choisir les élèves à corriger</h2>
        <p class="muted">Choisis d'abord une classe. Seuls les élèves de cette classe sont affichés. Les élèves sont classés par nom de famille.</p>
        <div class="editbox" style="margin-top:14px">
          <label for="correctionClass"><strong>Classe à corriger</strong></label>
          <select id="correctionClass" onchange="pickStudentForCorrection('${esc(evalId)}',this.value)" style="width:100%;margin-top:6px">
            <option value="">— Sélectionner une classe —</option>
            ${classes.map(c=>`<option value="${esc(c)}" ${c===currentClass?"selected":""}>${esc(c)}</option>`).join("")}
          </select>
        </div>
        ${currentClass?`<div class="row" style="margin:12px 0">
          <button type="button" onclick="toggleAllCorrectionStudents(true)">☑️ Tout sélectionner</button>
          <button type="button" onclick="toggleAllCorrectionStudents(false)">☐ Tout désélectionner</button>
          <button type="button" class="primary" onclick="startSelectedStudentsCorrection('${esc(evalId)}')">👥 Corriger le groupe sélectionné</button>
          <span id="correctionSelectionCount" class="status">0 élève sélectionné</span>
        </div>
        <div class="student-picker-grid">
          ${students.map(s=>{const c=byId.get(String(s.id));return `<div class="student-choice" style="position:relative;box-sizing:border-box;min-width:0;">
            <label style="display:block;cursor:pointer;padding-right:8px;min-width:0">
              <input type="checkbox" class="correction-student-check" value="${esc(s.id)}" onchange="updateCorrectionSelectionCount()" style="margin-right:8px">
              <strong style="display:block;white-space:normal;overflow-wrap:anywhere;line-height:1.25">👤 ${esc(studentDisplayName(s))}</strong>
            </label>
            <span class="small-note" style="display:block;margin-top:4px">${c?`Correction enregistrée · ${Number(c.resultat?.note||0)} / ${Number(ev.total||0)}`:`Nouvelle correction`}</span>
            <button type="button" style="margin-top:8px" onclick="${c?`editCorrection('${esc(evalId)}','${esc(c.id)}')`:`startBankStudentCorrection('${esc(evalId)}','${esc(s.id)}')`}">${c?"Ouvrir la correction":"Corriger seul"}</button>
          </div>`}).join("")}
        </div>`:`<p class="muted" style="margin-top:14px">Sélectionne une classe pour afficher ses élèves.</p>`}
      </section>`;
    updateCorrectionSelectionCount();
  }catch(e){alert("Impossible de charger les élèves : "+e.message)}
}
function updateCorrectionSelectionCount(){
  const n=document.querySelectorAll('.correction-student-check:checked').length;
  const el=document.getElementById('correctionSelectionCount');
  if(el)el.textContent=`${n} élève${n>1?'s':''} sélectionné${n>1?'s':''}`;
}
function toggleAllCorrectionStudents(value){
  document.querySelectorAll('.correction-student-check').forEach(cb=>cb.checked=value);
  updateCorrectionSelectionCount();
}
async function startBankStudentCorrection(evalId,studentId){
  const s=studentsCache.find(x=>String(x.id)===String(studentId));
  if(!s)return;
  await renderCorrectionEditor(evalId,null,{eleve:studentDisplayName(s),eleve_id:s.id,resultat:{points:{},note:0,criteriaStats:{}}});
}
async function startSelectedStudentsCorrection(evalId){
  const ids=[...document.querySelectorAll('.correction-student-check:checked')].map(x=>String(x.value));
  if(!ids.length){alert("Sélectionne au moins un élève.");return;}
  const students=sortStudents(studentsCache.filter(s=>ids.includes(String(s.id))));
  if(students.length===1){
    const s=students[0];
    const q=await sb.from("EvaluationCorrections").select("id,eleve,eleve_id,resultat").eq("evaluation_id",evalId).eq("eleve_id",s.id).maybeSingle();
    if(q.error){alert("Impossible de vérifier la correction : "+q.error.message);return;}
    if(q.data){await editCorrection(evalId,q.data.id);return;}
    await renderCorrectionEditor(evalId,null,{eleve:studentDisplayName(s),eleve_id:s.id,resultat:{points:{},note:0,criteriaStats:{}}});
    return;
  }
  await renderCorrectionEditor(evalId,null,{eleve:`${students.length} élèves sélectionnés`,eleve_id:"",resultat:{points:{},note:0,criteriaStats:{}}},ids);
}
async function editCorrection(evalId,correctionId){
  const {data,error}=await sb.from("EvaluationCorrections").select("id,eleve,eleve_id,resultat").eq("id",correctionId).maybeSingle();
  if(error)throw new Error(error.message);
  await renderCorrectionEditor(evalId,correctionId,data);
}
/* Correction : état de sauvegarde et protection des saisies */
let correctionSession=null;
function correctionFingerprint(){
  return JSON.stringify({checks:[...document.querySelectorAll('.correction-check')].map(x=>[x.dataset.key,!!x.checked])});
}
function correctionDirty(){return !!correctionSession && correctionFingerprint()!==correctionSession.baseline;}
function correctionStatus(message,error=false){
  const el=document.getElementById('correctionSaveStatus');
  if(el){el.textContent=message;el.style.color=error?'#9d3030':'#286456';}
}
function correctionRefreshStatus(){
  if(!correctionSession || window.__savingCorrection)return;
  correctionStatus(correctionDirty()?'Modifications non enregistrées':(correctionSession.saved?'Enregistré':'Nouvelle correction — non enregistrée'));
}
function correctionBegin(evalId,correctionId,corr,classe,groupIds){
  correctionSession={evalId,correctionId:correctionId||null,eleve:corr.eleve||'',eleveId:corr.eleve_id||'',classe,groupIds:[...(groupIds||[])],saved:!!correctionId,baseline:correctionFingerprint()};
  saveEvalNav({view:'studentCorrection',evaluationId:evalId,correctionId:correctionId||null,eleve:correctionSession.eleve,eleveId:correctionSession.eleveId,groupIds:correctionSession.groupIds,classe});
  correctionRefreshStatus();
  localDraftBeginCorrection();
}
function correctionAllowLeave(){
  if(!ppCouncilConfirmLeave())return false;
  if(window.__savingEvaluation){alert('Enregistrement de l’évaluation en cours. Attends sa fin avant de quitter.');return false;}
  if(!correctionSession){
    const s=localDraftSession;
    if(s?.root.isConnected&&JSON.stringify(localDraftCapture())!==s.base&&!localDraftFlush()&&!confirm('Les dernières modifications ne sont pas protégées par un brouillon local. Quitter quand même ?'))return false;
    localDraftStop(true);return true;
  }
  if(window.__savingCorrection){alert("Enregistrement en cours. Attends sa fin avant de quitter la correction.");return false;}
  if(correctionDirty() && !confirm("Des modifications ne sont pas validées dans Supabase. Quitter cette correction ? Le brouillon local, s’il a pu être sauvegardé, restera disponible."))return false;
  localDraftStop(true);
  correctionSession=null;
  return true;
}
function correctionSetBusy(busy){
  document.querySelectorAll('.correction-check,#correctionSaveControls button').forEach(el=>{
    if(busy){el.dataset.correctionWasDisabled=el.disabled?'1':'0';el.disabled=true;}
    else{el.disabled=el.dataset.correctionWasDisabled==='1';delete el.dataset.correctionWasDisabled;}
  });
}
async function saveActiveCorrection(next=false){
  if(!correctionSession)return;
  const c=correctionSession;
  return saveCorrection(c.evalId,c.correctionId,c.eleve,c.eleveId,next);
}
async function correctionOpenNext(ctx){
  try{
    const q=await sb.from('Eleves').select('id,classe,nom,prenom').eq('classe',ctx.classe).order('nom').order('prenom');
    if(q.error)throw new Error(q.error.message);
    const students=sortStudents(q.data||[]);
    const index=students.findIndex(x=>String(x.id)===String(ctx.eleveId));
    if(index<0)throw new Error("L'élève actuel n'est pas retrouvé dans la classe sélectionnée.");
    const next=students[index+1];
    if(!next){correctionStatus('Enregistré — dernier élève de la classe.');alert('Correction enregistrée. Tu as atteint le dernier élève de la classe.');return;}
    const cq=await sb.from('EvaluationCorrections').select('id,eleve,eleve_id,resultat').eq('evaluation_id',ctx.evalId).eq('eleve_id',next.id).maybeSingle();
    if(cq.error)throw new Error(cq.error.message);
    const corr=cq.data||{eleve:studentDisplayName(next),eleve_id:next.id,resultat:{points:{},note:0,criteriaStats:{}}};
    await renderCorrectionEditor(ctx.evalId,cq.data?.id||null,corr);
  }catch(e){correctionStatus('Enregistré — ouverture de la copie suivante impossible : '+e.message,true);}
}
document.addEventListener('input',e=>{if(e.target.matches('.correction-check'))correctionRefreshStatus();});
document.addEventListener('change',e=>{if(e.target.matches('.correction-check'))correctionRefreshStatus();});
window.addEventListener('beforeunload',e=>{if(correctionSession && (window.__savingCorrection||correctionDirty())){e.preventDefault();e.returnValue='';}});
async function renderCorrectionEditor(evalId,correctionId,corr,groupIds=[]){
  if(!correctionAllowLeave())return;
  currentCorrectionGroupIds=groupIds||[];
  const {data,error}=await sb.from("Evaluations").select("*").eq("id",evalId).maybeSingle();
  if(error)throw new Error(error.message); if(!data)throw new Error("Évaluation introuvable.");
  const ev=evalNormalize(data); currentCorrectionEvaluation=ev;
  const correctionClass=String(loadEvalNav().classe||ev.classe||"").trim();
  evalRememberFromEvaluation(ev,"studentCorrection",{evaluationId:ev.id,correctionId:correctionId||null,classe:loadEvalNav().classe||ev.classe});
  const result=corr.resultat||{
  points:{},
  note:0,
  criteriaStats:{}
};
const crits=criteriaFromLegacy(ev);
const groups={};
/*
 * Nouvelle structure :
 * une question = un bloc de correction.
 * Même si deux questions évaluent la même compétence,
 * elles restent séparées ici.
 */
crits.forEach((c,i)=>{
  const questionId=String(
    c.questionId ||
    c.questionNumero ||
    `q${i+1}`
  );
  if(!groups[questionId]){
    groups[questionId]={
      id:questionId,
      questionNumero:Number(c.questionNumero||i+1),
      nom:c.competenceNom||"Compétence évaluée",
      criteres:[]
    };
  }
  groups[questionId].criteres.push(c);
});
const comps=Object.values(groups).sort(
  (a,b)=>a.questionNumero-b.questionNumero
);
const savedValidated=result.criteriaStats||{};
  content.innerHTML=`<button onclick="openCorrection('${esc(evalId)}')">← Retour aux copies</button>
  <section class="hero teacher" style="margin-top:14px">
<h2 style="margin:0 0 8px">${esc(corr.eleve||"Élève")}</h2><span class="eyebrow">${esc(correctionClass||"Classe")}</span><p id="correctionSaveStatus" role="status" aria-live="polite" style="margin:8px 0;font-weight:700"></p>    <div class="row"><span class="score-pill" id="liveScore">0 / ${Number(ev.total||0)}</span><span id="livePercent" class="status"></span></div>
    <div id="correctionCriteria">${comps.map((comp,co)=>`<div class="eval-card"><h3>📝 Question ${comp.questionNumero} — ${esc(comp.nom)}</h3>${comp.criteres.map((cr,ci)=>`<div class="criteria-box"><h4 style="margin:0 0 8px">Critère ${ci+1} — ${esc(cr.nom)}</h4><div class="criterion-auto-status" data-criterion-status="${esc(cr.id)}"><span class="small-note">Validation automatique : au moins 2/3 des indicateurs cochés (≥ 66,7 %).</span></div>${(cr.indicateurs||[]).map((it,ii)=>{const key=`${cr.id}_${ii}`,checked=!!result.points?.[key]||!!result.points?.[`${cr.id}_${ii}`];return `<div class="check-row"><label><input type="checkbox" class="correction-check" data-key="${key}" data-points="${Number(it.points||0)}" data-criterion="${esc(cr.id)}" ${checked?"checked":""} onchange="refreshCorrectionScore('${esc(ev.id)}')"> ${esc(it.nom)}</label><span class="small-note">${Number(it.points||0)} pt</span></div>`}).join("")||`<p class="muted">Aucun indicateur pour ce critère.</p>`}</div>`).join("")}</div>`).join("")}</div>
    
    <div id="masteryPreview"></div>
    <div class="row" id="correctionSaveControls">
      <button type="button" class="primary" onclick="saveActiveCorrection(false)">💾 Enregistrer la correction</button>
      ${(!groupIds.length || groupIds.length===1) && corr.eleve_id ? '<button type="button" class="primary" onclick="saveActiveCorrection(true)">💾 Enregistrer et suivant →</button>' : ''}
      <button type="button" onclick="generateCorrectionPDF('${esc(evalId)}')">📥 Exporter cette grille en PDF</button>
      <button type="button" onclick="printAllCorrectionGrids('${esc(evalId)}')">📥 Exporter toutes les grilles de la classe en PDF</button>
    </div>
    <p class="small-note">« Enregistrer » sauvegarde la correction puis revient automatiquement à la liste des copies de cette évaluation. En cas d’échec, la copie reste à l’écran. « Enregistrer et suivant » ouvre l'élève suivant de la classe, dans l'ordre alphabétique, y compris si sa correction existe déjà.</p>
  </section>`;
  refreshCorrectionScore(ev.id);
  correctionBegin(evalId,correctionId,corr,correctionClass,groupIds);
}
function getMasteryByCode(code){
  const map={
    TBM:{code:"TBM",label:"Très bonne maîtrise",cls:"tbm"},
    MS:{code:"MS",label:"Maîtrise satisfaisante",cls:"ms"},
    MF:{code:"MF",label:"Maîtrise fragile",cls:"mf"},
    MI:{code:"MI",label:"Maîtrise insuffisante",cls:"mi"}
  };
  return map[code]||null;
}
function computeCorrection(ev){
  const checks=[...document.querySelectorAll(".correction-check")];
  let score=0;const points={};const criteriaStats={};
  checks.forEach(ch=>{
    const key=ch.dataset.key,p=Number(ch.dataset.points||0),cid=ch.dataset.criterion;
    if(ch.checked){score+=p;points[key]=true}
    if(cid){
      if(!criteriaStats[cid])criteriaStats[cid]={got:0,total:0,checked:0,validated:false};
      criteriaStats[cid].count=(criteriaStats[cid].count||0)+1;
      if(ch.checked){criteriaStats[cid].checked+=1;criteriaStats[cid].got+=p;}
    }
  });
  Object.values(criteriaStats).forEach(st=>{
    st.percent=st.count?Math.round(st.checked/st.count*100):0;
    // Rule: a criterion is validated when at least 2/3 of its indicators are checked.
    st.validated=st.count>0 && (st.checked/st.count)>=(2/3);
  });
  return {score,points,criteriaStats};
}
function refreshCorrectionScore(evalId){
  const ev=currentCorrectionEvaluation;
  if(!ev)return;
  const c=computeCorrection(ev),total=Number(ev.total||0),pct=total?Math.round(c.score/total*100):0;
  const score=document.getElementById("liveScore");if(score)score.textContent=`${c.score} / ${total}`;
  const p=document.getElementById("livePercent");if(p)p.textContent=`${pct}% du barème`;
  const crits=criteriaFromLegacy(ev), groups={};
  crits.forEach(cr=>{const gid=cr.competenceId||"comp1";if(!groups[gid])groups[gid]={nom:cr.competenceNom||"Compétence évaluée",criteres:[]};groups[gid].criteres.push(cr)});
  const compRows=Object.values(groups).map(comp=>{
  const result=masteryForCompetencyQuestions(
    comp.criteres,
    c.criteriaStats
  );
  const mastery=result.mastery;
  const detail=result.occurrences
    .map(q=>`Q${q.questionNumero} : ${q.validated} / ${q.total} → ${q.mastery.code}`)
    .join(" · ");
  return `<tr>
    <td>
      <strong>${esc(comp.nom)}</strong>
      <div class="small-note">${detail}</div>
    </td>
    <td>${result.average!==null
      ?result.average.toFixed(2).replace(".",",")
      :"—"}</td>
    <td>
      ${mastery
        ?`<span class="mastery-result ${mastery.cls}">${mastery.code} — ${mastery.label}</span>`
        :"—"}
    </td>
  </tr>`;
}).join("");
  const box=document.getElementById("masteryPreview");
  if(box)box.innerHTML=`<div class="criteria-box"><strong>📊 Maîtrise par compétence</strong><p class="small-note">La maîtrise est calculée séparément pour chaque compétence, selon le nombre de critères validés.</p><table class="mastery-table"><thead><tr><th>Compétence</th><th>Critères validés</th><th>Maîtrise</th></tr></thead><tbody>${compRows}</tbody></table></div>`;
  document.querySelectorAll(".criterion-auto-status").forEach(el=>{
    const cid=el.dataset.criterionStatus;
    const st=c.criteriaStats[cid]||{checked:0,count:0,percent:0,validated:false};
    el.innerHTML=st.count
      ? `<span class="small-note">${st.checked} / ${st.count} indicateur(s) coché(s) — ${st.percent}%</span> <strong>${st.validated?"✅ Critère validé":"❌ Critère non validé"}</strong>`
      : `<span class="small-note">Aucun indicateur</span>`;
  });
}
async function generateEvaluationSummaryPDF(evalId,includeAllChapterTypes=false){
  // Ouvrir l'onglet immédiatement au clic pour éviter le blocage des pop-ups
  // après les opérations asynchrones de récupération des données.
  const summaryTab=window.open("about:blank","_blank");
  if(!summaryTab){
    alert("Le navigateur a bloqué l’ouverture du nouvel onglet. Autorise les fenêtres surgissantes pour ce site puis réessaie.");
    return;
  }
  try{
    const ev=await getEvaluationById(evalId);
    if(!ev){
      if(summaryTab&&!summaryTab.closed)summaryTab.close();
      alert("Évaluation introuvable.");
      return;
    }
    /*
     * Par défaut, un récapitulatif de sous-onglet reste limité
     * au type du sujet sélectionné. Seul le récapitulatif lancé
     * depuis le chapitre entier inclut tous les types de travaux.
     */
    const nav=loadEvalNav();
    const selectedClass=String(
      nav.classe ||
      localStorage.getItem("EVAL_SELECTED_CLASS") ||
      ev.classe ||
      ""
    ).trim();
    if(!selectedClass){
      if(summaryTab&&!summaryTab.closed)summaryTab.close();
      alert("Sélectionne d'abord une classe.");
      return;
    }
    const chapitre=Number(ev.chapitre||0);
    if(!chapitre){
      if(summaryTab&&!summaryTab.closed)summaryTab.close();
      alert(
        "Cette évaluation n'a pas de numéro de chapitre. " +
        "Impossible de construire le récapitulatif du chapitre."
      );
      return;
    }
    /*
     * Toutes les évaluations correspondant :
     * - à la classe ;
     * - au même chapitre ;
     * - au type Évaluation de chapitre.
     */
    // Les sous-onglets restent filtrés par type. Le récapitulatif
    // du chapitre entier rassemble évaluations, activités et exercices.
    const typeCible=String(ev.typeEvaluation || "evaluation");
    const chapterEvaluations=evaluationsCache
      .filter(e=>{
        const classes=Array.isArray(e.assignedClasses)
          ?e.assignedClasses
          :String(e.classe||"")
            .split(",")
            .map(x=>x.trim())
            .filter(Boolean);
        return classes.includes(selectedClass)
          && Number(e.chapitre||0)===chapitre
          && (includeAllChapterTypes || String(e.typeEvaluation||"evaluation")===typeCible);
      })
      .sort((a,b)=>{
        return String(a.titre||"")
          .localeCompare(
            String(b.titre||""),
            "fr",
            {numeric:true,sensitivity:"base"}
          );
      });
    if(!chapterEvaluations.length){
      if(summaryTab&&!summaryTab.closed)summaryTab.close();
      alert(
        `Aucun sujet du même type trouvé pour ${selectedClass}, chapitre ${chapitre}.`
      );
      return;
    }
    const escPrint=v=>String(v??"")
      .replace(/[&<>]/g,m=>({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;"
      }[m]));
    const normalizeName=v=>String(v??"")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"")
      .toLocaleLowerCase("fr")
      .replace(/[^a-z0-9]+/g," ")
      .trim();
    /*
     * ---------------------------------------------------------
     * 1. Récupération des élèves de la classe
     * ---------------------------------------------------------
     */
    const elevesQ=await sb.from("Eleves")
      .select("id,classe,nom,prenom")
      .eq("classe",selectedClass)
      .order("nom")
      .order("prenom");
    if(elevesQ.error){
      throw new Error(elevesQ.error.message);
    }
    const students=(elevesQ.data||[]).map(s=>({
      id:String(s.id),
      name:studentDisplayName(s),
      sortKey:normalizeName(
        `${s.nom||""} ${s.prenom||""}`
      )
    }));
    /*
     * ---------------------------------------------------------
     * 2. Récupération du sujet attribué à chaque élève
     * ---------------------------------------------------------
     */
    const assignmentQuery=await sb
      .from("EvaluationSubjectAssignments")
      .select("eleve_id,evaluation_id,travail_id")
      .eq("classe",selectedClass)
      .eq("chapitre",chapitre)
      .in("evaluation_id",chapterEvaluations.map(e=>e.id));
    if(assignmentQuery.error){
      throw new Error(
        "Impossible de récupérer les sujets attribués : "+
        assignmentQuery.error.message
      );
    }
    const titleByEvaluationId=new Map(
      chapterEvaluations.map(e=>[
        String(e.id),
        String(e.titre||"Sujet sans titre")
      ])
    );
    const assignedSubjectsByStudent=new Map();
    (assignmentQuery.data||[]).forEach(assignment=>{
      const studentId=String(assignment.eleve_id||"");
      const subjectTitle=titleByEvaluationId.get(
        String(assignment.evaluation_id)
      );
      if(!studentId||!subjectTitle)return;
      if(!assignedSubjectsByStudent.has(studentId)){
        assignedSubjectsByStudent.set(studentId,[]);
      }
      const titles=assignedSubjectsByStudent.get(studentId);
      if(!titles.includes(subjectTitle))titles.push(subjectTitle);
    });
    /*
     * ---------------------------------------------------------
     * 3. Récupération des corrections de TOUS les sujets
     * ---------------------------------------------------------
     */
    const correctionsByEvaluation=new Map();
    for(const evaluation of chapterEvaluations){
      const q=await sb.from("EvaluationCorrections")
        .select("id,eleve,eleve_id,resultat")
        .eq("evaluation_id",evaluation.id);
      if(q.error){
        throw new Error(q.error.message);
      }
      correctionsByEvaluation.set(
        String(evaluation.id),
        q.data||[]
      );
    }
    /*
     * ---------------------------------------------------------
     * 3. Construction des compétences du chapitre
     * ---------------------------------------------------------
     *
     * Une même compétence peut apparaître :
     * - dans plusieurs questions ;
     * - dans plusieurs sujets.
     *
     * Elle n'apparaîtra donc qu'une seule fois dans le PDF.
     */
    const competencyMap=new Map();
    chapterEvaluations.forEach(evaluation=>{
      const crits=criteriaFromLegacy(evaluation);
      crits.forEach((cr,i)=>{
        const nom=String(
          cr.competenceNom ||
          "Compétence évaluée"
        ).trim();
        const key=normalizeName(nom)||`competence-${i}`;
        if(!competencyMap.has(key)){
          competencyMap.set(key,{
            nom,
            evaluations:[]
          });
        }
        const group=competencyMap.get(key);
        let evaluationGroup=group.evaluations
          .find(x=>String(x.evaluationId)===String(evaluation.id));
        if(!evaluationGroup){
          evaluationGroup={
            evaluationId:evaluation.id,
            criteres:[],
            questionIds:[]
          };
          group.evaluations.push(evaluationGroup);
        }
        evaluationGroup.criteres.push(cr);
        const qid=cr.questionId||cr.questionNumero||"";
        if(
          qid &&
          !evaluationGroup.questionIds.includes(String(qid))
        ){
          evaluationGroup.questionIds.push(String(qid));
        }
      });
    });
    const competencies=[...competencyMap.values()];
    /*
     * ---------------------------------------------------------
     * 4. Fonction de calcul de maîtrise
     * ---------------------------------------------------------
     */
    const masteryValues={
      TBM:4,
      MS:3,
      MF:2,
      MI:1
    };
    function masteryForEvaluationStudent(
      evaluation,
      correction,
      competency
    ){
      if(!correction){
        return [];
      }
      if(
        isHistoricalEvaluation(evaluation) &&
        correction.resultat?.masteryCode
      ){
        return [
          correction.resultat.masteryCode
        ];
      }
      const resultat=correction.resultat||{};
      if(!resultat.criteriaStats){
        return [];
      }
      /*
       * On conserve la logique existante :
       * la maîtrise est calculée question par question.
       */
      const evaluationGroups=competency.evaluations
        .filter(g=>
          String(g.evaluationId)===String(evaluation.id)
        );
      const values=[];
      evaluationGroups.forEach(group=>{
        group.questionIds.forEach(questionId=>{
          const questionCriteria=
            group.criteres.filter(cr=>{
              const qid=String(
                cr.questionId ||
                cr.questionNumero ||
                ""
              );
              return qid===String(questionId);
            });
          if(!questionCriteria.length){
            return;
          }
          const validated=questionCriteria.filter(cr=>
            !!resultat.criteriaStats?.[cr.id]?.validated
          ).length;
          const mastery=
            getMasteryFromValidatedCriteria(validated);
          if(masteryValues[mastery.code]){
            values.push(
              masteryValues[mastery.code]
            );
          }
        });
      });
      return values;
    }
    function masteryFromValues(values){
      if(!values.length){
        return "—";
      }
      const average=
        values.reduce((a,b)=>a+b,0)/
        values.length;
      if(average>=3.5)return "TBM";
      if(average>=2.5)return "MS";
      if(average>=1.5)return "MF";
      return "MI";
    }
    /*
     * ---------------------------------------------------------
     * 5. Recherche d'une correction pour un élève
     * ---------------------------------------------------------
     */
    function findCorrection(evaluation,student){
      const corrections=
        correctionsByEvaluation.get(
          String(evaluation.id)
        )||[];
      const byId=corrections.find(c=>
        c.eleve_id &&
        String(c.eleve_id)===String(student.id)
      );
      if(byId){
        return byId;
      }
      const studentKey=normalizeName(
        student.name
      );
      return corrections.find(c=>
        normalizeName(c.eleve||"")===studentKey
      )||null;
    }
    /*
     * ---------------------------------------------------------
     * 6. Lignes du tableau
     * ---------------------------------------------------------
     */
    const rows=students.map(student=>{
      // On affiche chaque note avec son barème d'origine.
      // Il n'y a volontairement ni conversion sur 20 ni moyenne
      // entre des évaluations qui peuvent avoir des barèmes différents.
      const noteDetails=[];
      chapterEvaluations.forEach(evaluation=>{
        const correction=findCorrection(evaluation,student);
        if(!correction)return;
        const resultat=correction.resultat||{};
        const noteValue=resultat.note!==undefined
          ?Number(resultat.note)
          :resultat.score!==undefined
            ?Number(resultat.score)
            :null;
        const total=Number(evaluation.total||0);
        if(noteValue===null || !Number.isFinite(noteValue))return;
        const noteText=total>0
          ?`${String(noteValue).replace(".",",")} / ${String(total).replace(".",",")}`
          :String(noteValue).replace(".",",");
        noteDetails.push({
          titre:String(evaluation.titre||"Évaluation"),
          note:noteText
        });
      });
      const assignedTitles=assignedSubjectsByStudent.get(
        String(student.id)
      )||[];
      const sujetAttribue=assignedTitles.length
        ?assignedTitles.join(" · ")
        :chapterEvaluations.length===1
          ?String(chapterEvaluations[0].titre||"Sujet unique")
          :"Non attribué";
      return {
        student,
        noteDetails,
        competencies,
        sujetAttribue
      };
    });
    /*
     * ---------------------------------------------------------
     * 7. Calcul des maîtrises par compétence
     * ---------------------------------------------------------
     */
    const bodyRows=rows.length
      ?rows.map(row=>{
          const masteryCells=competencies.length
            ?competencies.map(comp=>{
                const values=[];
                chapterEvaluations.forEach(evaluation=>{
                  const correction=
                    findCorrection(
                      evaluation,
                      row.student
                    );
                  if(!correction){
                    return;
                  }
                  const result=
                    masteryForEvaluationStudent(
                      evaluation,
                      correction,
                      comp
                    );
                  values.push(...result);
                });
                const mastery=
                  masteryFromValues(values);
                return `
                  <td style="text-align:center">
                    <strong>${escPrint(mastery)}</strong>
                  </td>
                `;
              }).join("")
            :`<td style="text-align:center">—</td>`;
          return `
            <tr>
              <td>
                <strong>${escPrint(row.student.name)}</strong>
              </td>

              <td>
                ${row.noteDetails.length
                  ?row.noteDetails.map(item=>`<div><strong>${escPrint(item.note)}</strong> <span class="small-note">(${escPrint(item.titre)})</span></div>`).join("")
                  :"—"}
              </td>

              ${includeAllChapterTypes ? "" : `<td>${escPrint(row.sujetAttribue)}</td>`}

              ${masteryCells}
            </tr>
          `;
        }).join("")
      :`
        <tr>
          <td
            colspan="${(includeAllChapterTypes?2:3)+Math.max(1,competencies.length)}"
            style="text-align:center"
          >
            Aucun élève enregistré.
          </td>
        </tr>
      `;
    /*
     * ---------------------------------------------------------
     * 8. En-têtes des compétences
     * ---------------------------------------------------------
     */
    const headers=competencies.length
      ?competencies.map(comp=>`
          <th style="
            width:${Math.max(
              8,
              Math.floor((includeAllChapterTypes ? 48 : 26)/competencies.length)
            )}%;
          ">
            ${escPrint(comp.nom)}
          </th>
        `).join("")
      :`<th>Maîtrise</th>`;
    /*
     * ---------------------------------------------------------
     * 9. Liste des sujets utilisés
     * ---------------------------------------------------------
     */
    const sujets=chapterEvaluations
      .map(e=>escPrint(e.titre))
      .join(" · ");
    /*
     * ---------------------------------------------------------
     * 10. PDF final
     * ---------------------------------------------------------
     */
    const body=`
      <div class="print-page evaluation-summary-page">

        <h1>
          📊 Récapitulatif — Chapitre ${escPrint(chapitre)}
        </h1>

        <p>
          <strong>Classe :</strong>
          ${escPrint(selectedClass)}
          &nbsp; · &nbsp;

          <strong>Type :</strong>
          ${includeAllChapterTypes ? "Ensemble des travaux du chapitre" : typeCible==="activite" ? "Activité" : typeCible==="exercice" ? "Exercice" : "Évaluation de chapitre"}
        </p>

        <p class="small-note">
          <strong>Sujets pris en compte :</strong>
          ${sujets}
        </p>

        <table class="summary-table">

          <thead>
            <tr>
              <th style="width:30%">
                Élève
              </th>

              <th style="width:22%">
                Notes obtenues (barème réel)
              </th>

              ${includeAllChapterTypes ? "" : `<th style="width:22%">Sujet attribué</th>`}

              ${headers}
            </tr>
          </thead>

          <tbody>
            ${bodyRows}
          </tbody>

        </table>

        <p
          class="small-note"
          style="margin-top:10px"
        >
          Récapitulatif du chapitre — les compétences
          identiques entre les différents sujets sont regroupées.
          Les maîtrises sont moyennées entre les questions et les sujets.
        </p>

      </div>
    `;
    const extraCss=`
      .evaluation-summary-page h1{
        margin-bottom:10px!important
      }

      .evaluation-summary-page .summary-table{
        width:100%!important;
        border-collapse:separate!important;
        border-spacing:0!important;
        border:0!important;
        border-top:1px solid #333!important;
        border-left:1px solid #333!important;
        table-layout:fixed!important;
        print-color-adjust:exact!important;
        -webkit-print-color-adjust:exact!important;
      }
      .evaluation-summary-page .summary-table th,
      .evaluation-summary-page .summary-table td{
        border:0!important;
        border-right:1px solid #333!important;
        border-bottom:1px solid #333!important;
        padding:7px!important;
        background-clip:padding-box!important;
        print-color-adjust:exact!important;
        -webkit-print-color-adjust:exact!important;
      }
      .evaluation-summary-page .summary-table tr{
        break-inside:avoid!important;
        page-break-inside:avoid!important;
      }

      .evaluation-summary-page
      .summary-table th{
        text-align:center!important;
        background:#f0f0f0!important
      }

      .evaluation-summary-page
      .summary-table th:first-child{
        text-align:left!important
      }

      .evaluation-summary-page
      .summary-table td:first-child{
        text-align:left!important
      }

      .evaluation-summary-page
      .small-note{
        font-size:9px!important;
        color:#666
      }
    `;
    printHtmlInCurrentWindow(
      `Récapitulatif — Chapitre ${chapitre} — ${selectedClass}`,
      body,
      extraCss,
      summaryTab
    );
  }catch(e){
    if(summaryTab&&!summaryTab.closed)summaryTab.close();
    alert(
      "Génération du récapitulatif impossible : "+
      e.message
    );
  }
}
async function openChapterStudentGrids(chapitre,classe){
  const selectedClass=String(classe||loadEvalNav().classe||"").trim();
  const chapterNumber=Number(chapitre||0);
  if(!selectedClass||!chapterNumber){alert("Classe ou chapitre introuvable.");return;}
  try{
    const q=await sb.from("Eleves").select("id,classe,nom,prenom").eq("classe",selectedClass).order("nom").order("prenom");
    if(q.error)throw new Error(q.error.message);
    const students=q.data||[];
    if(!students.length){alert(`Aucun élève trouvé dans ${selectedClass}.`);return;}
    const modal=document.createElement("div");
    modal.className="pp-modal";
    modal.id="chapterStudentGridModal";
    const options=students.map(st=>`<button type="button" class="chapter-grid-student" data-student-id="${esc(st.id)}" data-search="${esc(studentDisplayName(st).toLocaleLowerCase('fr'))}" onclick="exportChapterStudentGrids(${jsArg(chapterNumber)},${jsArg(selectedClass)},${jsArg(st.id)})" style="display:flex;width:100%;justify-content:space-between;align-items:center;margin:5px 0;text-align:left"><span>${esc(studentDisplayName(st))}</span><span>📥 Exporter</span></button>`).join("");
    modal.innerHTML=`<div class="pp-modal-card" style="max-width:620px;max-height:85vh;overflow:auto"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h3 style="margin:0">Grilles corrigées — Chapitre ${chapterNumber}</h3><button type="button" onclick="document.getElementById('chapterStudentGridModal')?.remove()">Fermer</button></div><p class="muted">${esc(selectedClass)} · Rechercher un élève puis exporter toutes ses grilles corrigées du chapitre.</p><input id="chapterGridStudentSearch" type="search" placeholder="Rechercher un nom ou prénom…" style="width:100%;margin:8px 0 12px;padding:10px;border:1px solid var(--b);border-radius:9px"><div id="chapterGridStudentList">${options}</div><p id="chapterGridNoStudent" class="muted" style="display:none">Aucun élève correspondant.</p></div>`;
    modal.addEventListener("click",e=>{if(e.target===modal)modal.remove();});
    document.body.appendChild(modal);
    const input=modal.querySelector("#chapterGridStudentSearch");
    input?.addEventListener("input",()=>{
      const term=String(input.value||"").trim().toLocaleLowerCase("fr");let visible=0;
      modal.querySelectorAll(".chapter-grid-student").forEach(button=>{const show=String(button.dataset.search||"").includes(term);button.style.display=show?"flex":"none";if(show)visible++;});
      modal.querySelector("#chapterGridNoStudent").style.display=visible?"none":"block";
    });
    input?.focus();
  }catch(e){alert("Impossible de charger les élèves : "+e.message);}
}
async function exportChapterStudentGrids(chapitre,classe,studentId){
  const selectedClass=String(classe||"").trim();
  const chapterNumber=Number(chapitre||0);
  const student=String(studentId||"");
  const printTab=window.open("about:blank","_blank");
  if(!printTab){alert("Safari a bloqué l’ouverture du nouvel onglet. Autorise les fenêtres surgissantes pour ce site puis réessaie.");return;}
  try{
    const classesFor=e=>Array.isArray(e.assignedClasses)?e.assignedClasses:String(e.classe||"").split(",").map(x=>x.trim()).filter(Boolean);
    const chapterSubjects=evaluationsCache.filter(e=>classesFor(e).includes(selectedClass)&&Number(e.chapitre||0)===chapterNumber&&!isHistoricalEvaluation(e));
    if(!chapterSubjects.length)throw new Error("Aucun sujet trouvé pour ce chapitre.");
    const studentQ=await sb.from("Eleves").select("id,classe,nom,prenom").eq("id",student).eq("classe",selectedClass).maybeSingle();
    if(studentQ.error)throw new Error(studentQ.error.message);
    if(!studentQ.data)throw new Error("Élève introuvable dans cette classe.");
    const studentName=studentDisplayName(studentQ.data);
    const pages=[];
    for(const ev of chapterSubjects){
      const q=await sb.from("EvaluationCorrections").select("id,eleve,eleve_id,resultat,created_at").eq("evaluation_id",ev.id).eq("eleve_id",student).order("created_at",{ascending:true});
      if(q.error)throw new Error(q.error.message);
      (q.data||[]).forEach(c=>pages.push(correctionGridHtml(ev,{...c,eleve:studentName,classe:selectedClass},selectedClass)));
    }
    if(!pages.length)throw new Error(`Aucune grille corrigée trouvée pour ${studentName} dans ce chapitre.`);
    printHtmlInCurrentWindow(`Grilles corrigées — ${studentName} — Chapitre ${chapterNumber}`,pages.join(""),"",printTab);
    document.getElementById("chapterStudentGridModal")?.remove();
  }catch(e){if(printTab&&!printTab.closed)printTab.close();alert("Export des grilles impossible : "+e.message);}
}

async function printAllCorrectionGrids(evalId){
  const printTab=window.open("about:blank","_blank");
  if(!printTab){alert("Safari a bloqué l’ouverture du nouvel onglet. Autorise les fenêtres surgissantes pour ce site puis réessaie.");return;}
  try{
    const ev=await getEvaluationById(evalId);
    if(!ev){
      alert("Évaluation introuvable.");
      return;
    }
    const nav=loadEvalNav();
    const selectedClass=String(
      nav.classe ||
      localStorage.getItem("EVAL_SELECTED_CLASS") ||
      ""
    ).trim();
    if(!selectedClass){
      alert("Sélectionne d'abord une classe.");
      return;
    }
    // Récupération des élèves de la classe sélectionnée
    const studentsQ=await sb
      .from("Eleves")
      .select("id,classe,nom,prenom")
      .eq("classe",selectedClass)
      .order("nom")
      .order("prenom");
    if(studentsQ.error){
      throw new Error(studentsQ.error.message);
    }
    const students=studentsQ.data||[];
    const studentById=new Map(
      students.map(s=>[
        String(s.id),
        s
      ])
    );
    const studentIds=new Set(
      students.map(s=>String(s.id))
    );
    // Récupération des corrections de l'évaluation
    const q=await sb
      .from("EvaluationCorrections")
      .select(
        "id,eleve,eleve_id,resultat,created_at"
      )
      .eq("evaluation_id",evalId)
      .order("created_at",{ascending:true});
    if(q.error){
      throw new Error(q.error.message);
    }
    // On garde uniquement les corrections des élèves
    // appartenant à la classe sélectionnée
    const corrections=(q.data||[])
      .filter(c=>
        c.eleve_id &&
        studentIds.has(String(c.eleve_id))
      )
      .map(c=>{
        const student=
          studentById.get(String(c.eleve_id));
        const nomComplet=student
          ?studentDisplayName(student)
          :String(c.eleve||"Élève");
        return {
          ...c,
          eleve:nomComplet,
          classe:selectedClass
        };
      });
    if(!corrections.length){
      alert(
        `Aucune correction enregistrée pour ${selectedClass}.`
      );
      return;
    }
    const pages=corrections
      .map(c=>
        correctionGridHtml(
          ev,
          c,
          selectedClass
        )
      )
      .join("");
    printHtmlInCurrentWindow(
      `${ev.titre||"Grilles"} — ${selectedClass}`,
      pages,
      "",
      printTab
    );
  }catch(e){
    if(printTab&&!printTab.closed)printTab.close();
    alert(
      "Impression impossible : "+
      e.message
    );
  }
}
function correctionGridHtml(ev,c,selectedClass=""){
  const r=c?.resultat||{};
  const crits=criteriaFromLegacy(ev);
  const escPrint=v=>String(v??"").replace(
    /[&<>]/g,
    m=>({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;"
    }[m])
  );
  const total=Number(ev.total||0);
  const score=Number(r.note ?? r.score ?? 0);
  const pct=total
    ?Math.round(score/total*100)
    :0;
  /*
   * =========================================================
   * 1. GROUPER PAR QUESTION
   * =========================================================
   */
  const questionGroups={};
  crits.forEach((cr,i)=>{
    const questionNumero=Number(
      cr.questionNumero||i+1
    );
    const questionId=String(
      cr.questionId||
      `q${questionNumero}`
    );
    if(!questionGroups[questionId]){
      questionGroups[questionId]={
        id:questionId,
        questionNumero,
        nom:
          cr.competenceNom||
          "Compétence évaluée",
        criteres:[]
      };
    }
    questionGroups[questionId]
      .criteres
      .push(cr);
  });
  const questions=
    Object.values(questionGroups)
      .sort(
        (a,b)=>
          a.questionNumero-b.questionNumero
      );
  /*
   * =========================================================
   * 2. MAÎTRISE D'UNE QUESTION
   * =========================================================
   */
  function masteryForQuestion(question){
    const validated=
      question.criteres.filter(
        cr=>!!r.criteriaStats?.[cr.id]?.validated
      ).length;
    return {
      validated,
      total:question.criteres.length,
      mastery:getMasteryFromValidatedCriteria(
        validated
      )
    };
  }
  /*
   * =========================================================
   * 3. REGROUPER LES QUESTIONS PAR COMPÉTENCE
   * =========================================================
   */
  const competenceGroups={};
  questions.forEach(question=>{
    const nom=String(
      question.nom||
      "Compétence évaluée"
    ).trim();
    const key=nom
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g," ")
      .trim();
    if(!competenceGroups[key]){
      competenceGroups[key]={
        nom,
        questions:[]
      };
    }
    competenceGroups[key]
      .questions
      .push(question);
  });
  /*
   * =========================================================
   * 4. MAÎTRISE FINALE D'UNE COMPÉTENCE
   * =========================================================
   */
  function masteryForCompetence(comp){
    const values={
      TBM:4,
      MS:3,
      MF:2,
      MI:1
    };
    const results=
      comp.questions
        .map(q=>
          masteryForQuestion(q)
            .mastery
            .code
        )
        .filter(code=>values[code]);
    if(!results.length){
      return {
        code:"—",
        label:"Non évaluée"
      };
    }
    const average=
      results.reduce(
        (sum,code)=>
          sum+values[code],
        0
      )/results.length;
    if(average>=3.5){
      return {
        code:"TBM",
        label:"Très bonne maîtrise"
      };
    }
    if(average>=2.5){
      return {
        code:"MS",
        label:"Maîtrise satisfaisante"
      };
    }
    if(average>=1.5){
      return {
        code:"MF",
        label:"Maîtrise fragile"
      };
    }
    return {
      code:"MI",
      label:"Maîtrise insuffisante"
    };
  }
  /*
   * =========================================================
   * 5. SYNTHÈSE DES COMPÉTENCES
   * =========================================================
   */
  const masterySummary=
    Object.values(competenceGroups)
      .map(comp=>{
        const m=masteryForCompetence(comp);
        return `
          <tr>
            <td style="
              padding:7px;
              border-bottom:1px solid #ccd5d1
            ">
              <strong>
                ${escPrint(comp.nom)}
              </strong>
            </td>

            <td style="
              text-align:center;
              padding:7px;
              border-bottom:1px solid #ccd5d1
            ">
              <strong>${m.code}</strong>
              — ${escPrint(m.label)}
            </td>
          </tr>
        `;
      })
      .join("");
  /*
   * =========================================================
   * 6. CONSTRUIRE LA PAGE
   * =========================================================
   */
const acquired=[];
const toConsolidate=[];
Object.values(competenceGroups).forEach(comp=>{
  const m=masteryForCompetence(comp);
  const item=`${comp.nom} (${m.code})`;
  if(m.code==="TBM"||m.code==="MS"){
    acquired.push(item);
  }else if(m.code==="MF"||m.code==="MI"){
    toConsolidate.push(item);
  }
});
const summaryHtml=`
  <div class="a4-recap">
    <div class="a4-recap-box a4-ok">
      <strong>✅ Acquis</strong>
      <div>${acquired.length?acquired.map(escPrint).join("<br>"):"—"}</div>
    </div>
    <div class="a4-recap-box a4-todo">
      <strong>🎯 À consolider</strong>
      <div>${toConsolidate.length?toConsolidate.map(escPrint).join("<br>"):"—"}</div>
    </div>
  </div>
`;
  const blocks=questions.map(question=>{
    const qm=masteryForQuestion(question);
    const rows=question.criteres.map(cr=>{
      const st=r.criteriaStats?.[cr.id];
      const indicators=cr.indicateurs||[];
      const checked=indicators.filter((it,ii)=>!!r.points?.[`${cr.id}_${ii}`]).length;
      const validated=st ? !!st.validated : indicators.length>0 && checked/indicators.length>=2/3;
      const earned=indicators.reduce((sum,it,ii)=>sum+(r.points?.[`${cr.id}_${ii}`]?Number(it.points||0):0),0);
      const possible=indicators.reduce((sum,it)=>sum+Number(it.points||0),0);
      const fmtPoints=value=>Number(value||0).toLocaleString('fr-FR',{maximumFractionDigits:2});
      const list=(wanted)=>indicators.map((it,ii)=>({it,checked:!!r.points?.[`${cr.id}_${ii}`]}))
        .filter(x=>x.checked===wanted).map(x=>escPrint(x.it.nom)).join(' ; ')||'—';
      return `<tr class="a4-criterion-row"><td><strong>${escPrint(cr.nom)}</strong><br><small class="criterion-score">Points : ${fmtPoints(earned)} / ${fmtPoints(possible)}</small><br><small>${validated?'Validé':'Reste à valider'}</small></td><td>${list(true)}</td><td>${list(false)}</td></tr>`;
    }).join('');
    return `<section class="a4-question"><h2>${isTransversalLanguageCompetency(question.nom)?'Compétence transversale':'Question '+question.questionNumero} — ${escPrint(question.nom)} <small>(${qm.mastery.code} · ${qm.validated}/${qm.total} critères)</small></h2><table><colgroup><col style="width:24%"><col style="width:38%"><col style="width:38%"></colgroup><thead><tr><th>Critère / bilan</th><th>✓ Validé : indicateurs réussis</th><th>Reste à valider : indicateurs à travailler</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join('');
  return `<div class="print-page svt-a4-grid"><div class="svt-a4-content"><h1>${escPrint(ev.titre||'Évaluation')}</h1><div class="a4-identity"><strong>${escPrint(c.eleve||'Élève')}</strong> — ${escPrint(selectedClass||c.classe||ev.classe)} <strong>Note : ${score} / ${total}</strong></div><table class="a4-summary"><tbody>${masterySummary}</tbody></table>${summaryHtml}${blocks}</div></div>`;
}
async function generateCorrectionPDF(evalId){
  const printTab=window.open("about:blank","_blank");
  if(!printTab){alert("Safari a bloqué l’ouverture du nouvel onglet. Autorise les fenêtres surgissantes pour ce site puis réessaie.");return;}
  try{
    let ev=currentCorrectionEvaluation;
    if(!ev || String(ev.id)!==String(evalId)){
      ev=await getEvaluationById(evalId);
    }
    if(!ev || String(ev.id)!==String(evalId)){
      throw new Error("Évaluation introuvable.");
    }
    currentCorrectionEvaluation=ev;
    const c=computeCorrection(ev);
    const crits=criteriaFromLegacy(ev);
    const nav=loadEvalNav();
const correctionId=nav.correctionId||"";
let student="Élève";
let studentClass=String(
  nav.classe ||
  ev.classe ||
  "Classe"
).trim();
if(correctionId){
  const cq=await sb
    .from("EvaluationCorrections")
    .select("eleve,eleve_id")
    .eq("id",correctionId)
    .maybeSingle();
  if(cq.error)throw new Error(cq.error.message);
  if(cq.data?.eleve_id){
    const sq=await sb
      .from("Eleves")
      .select("id,classe,nom,prenom")
      .eq("id",cq.data.eleve_id)
      .maybeSingle();
    if(sq.error)throw new Error(sq.error.message);
    if(sq.data){
      student=studentDisplayName(sq.data);
      studentClass=String(
        sq.data.classe ||
        studentClass
      ).trim();
    }
  }else if(cq.data?.eleve){
    student=String(cq.data.eleve);
  }
}
    const body=correctionGridHtml(ev,{eleve:student,classe:studentClass,resultat:{...c,note:c.score}},studentClass);
    printHtmlInCurrentWindow(`Correction — ${ev.titre}`,body,"",printTab);
  }catch(e){if(printTab&&!printTab.closed)printTab.close();alert("Impression impossible : "+e.message);}
}
async function saveCorrection(evalId,correctionId,eleve,eleveId,next=false){
  if(window.__savingCorrection)return false;
  if(!localDraftCanValidate())return false;
  const ctx=correctionSession;
  if(!ctx || String(ctx.evalId)!==String(evalId)){alert('Ouvre une correction avant de l’enregistrer.');return false;}
  if(next && (ctx.groupIds.length>1 || !ctx.eleveId)){alert('Le passage au suivant est disponible pour une correction individuelle avec un élève identifié.');return false;}
  const draft=computeCorrection(currentCorrectionEvaluation);
  const resultat={note:draft.score,points:draft.points,criteriaStats:draft.criteriaStats};
  const fingerprint=correctionFingerprint();
  const localDraftTicket=localDraftBeforeSave();
  if(!localDraftCanValidate())return false;
  window.__savingCorrection=true;
  correctionSetBusy(true);
  correctionStatus('Enregistrement…');
  let success=false;
  try{
    await correctionCheckAbsences(ctx);
    async function persist(studentName,studentId,id){
      let existingId=id,previousResult={};
      if(existingId || studentId){
        let query=sb.from('EvaluationCorrections').select('id,resultat');
        query=existingId ? query.eq('id',existingId) : query.eq('evaluation_id',evalId).eq('eleve_id',String(studentId));
        const q=await query.maybeSingle();
        if(q.error)throw new Error(q.error.message);
        if(existingId&&!q.data)throw new Error('La correction à mettre à jour est introuvable.');
        existingId=q.data?.id||null;
        previousResult=q.data?.resultat||{};
      }
      const payload={evaluation_id:evalId,eleve:studentName,eleve_id:studentId||null,resultat:{...previousResult,...resultat}};
      const query=existingId ? sb.from('EvaluationCorrections').update(payload).eq('id',existingId) : sb.from('EvaluationCorrections').insert(payload);
      const r=await query.select('id').single();
      if(r.error)throw new Error(r.error.message);
      if(!r.data?.id)throw new Error('La base n’a pas confirmé la sauvegarde.');
      return r.data.id;
    }
    if(ctx.groupIds.length>1){
      const q=await sb.from('Eleves').select('id,classe,nom,prenom').in('id',ctx.groupIds);
      if(q.error)throw new Error(q.error.message);
      const students=sortStudents(q.data||[]);
      if(students.length!==new Set(ctx.groupIds).size)throw new Error('Certains élèves du groupe ne sont pas accessibles. Aucune nouvelle écriture lancée.');
      const failures=[];
      for(const student of students){
        try{await persist(studentDisplayName(student),student.id,null);}
        catch(e){failures.push(studentDisplayName(student)+' : '+e.message);}
      }
      if(failures.length)throw new Error('Sauvegarde partielle : '+(students.length-failures.length)+'/'+students.length+' élèves. Réessaie pour terminer. '+failures.join(' | '));
    }else{
      ctx.correctionId=await persist(ctx.eleve,ctx.eleveId,ctx.correctionId);
    }
    ctx.saved=true;
    ctx.baseline=fingerprint;
    saveEvalNav({view:'studentCorrection',evaluationId:ctx.evalId,correctionId:ctx.correctionId,eleve:ctx.eleve,eleveId:ctx.eleveId,groupIds:ctx.groupIds,classe:ctx.classe});
    studentTrackingCache=[];
    studentTrackingLoadedAt=0;
    correctionStatus('Enregistré à '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}));
    localDraftSaved(localDraftTicket);
    success=true;
  }catch(e){
    correctionStatus('Échec de l’enregistrement : '+e.message+' — clique à nouveau sur Enregistrer pour réessayer.',true);
  }finally{
    window.__savingCorrection=false;
    correctionSetBusy(false);
  }
  if(success){
    if(next)await correctionOpenNext(ctx);
    else await openCorrection(ctx.evalId,ctx.classe);
  }
  return success;
}
/* ==================== SUIVI PP — V62 ==================== */
const PP_TABLES={events:"PP_Events",contacts:"PP_Contacts",amenagements:"PP_Amenagements",actions:"PP_Actions",conseils:"PP_Conseils",moyennes:"PP_Moyennes"};
const PP_DISCIPLINES=[{nom:"Français",coef:3},{nom:"Mathématiques",coef:3},{nom:"Anglais",coef:3},{nom:"Histoire-Géographie",coef:2},{nom:"Arts plastiques",coef:1},{nom:"Éducation musicale",coef:1},{nom:"EPS",coef:2}];
const PP_SCIENCES={pc:"Physique-Chimie",svt:"SVT",coef:2};
/* Niveaux de maîtrise distincts des moyennes, par discipline, élève et trimestre. */
const PP_MASTERY_TABLE="PP_Maitrises";
const PP_MASTERY_LEVELS=[
  ["TBM","Très bonne maîtrise"],
  ["MS","Maîtrise satisfaisante"],
  ["MF","Maîtrise fragile"],
  ["MI","Maîtrise insuffisante"]
];
function ppMasterySelect(discipline,masteries){
  const row=(masteries||[]).find(x=>String(x.discipline)===String(discipline));
  const selected=String(row?.niveau||"");
  return '<label class="pp-mastery-label"><span>Maîtrise globale</span>'+
    '<select class="pp-mastery" data-discipline="'+esc(discipline)+'" aria-label="Maîtrise globale en '+esc(discipline)+'">'+
    '<option value="">Non renseignée</option>'+
    PP_MASTERY_LEVELS.map(([code,title])=>'<option value="'+code+'"'+(selected===code?' selected':'')+'>'+esc(title)+'</option>').join("")+
    '</select></label>';
}
async function ppLoadMasteries(studentId,period){
  const {data,error}=await sb.from(PP_MASTERY_TABLE).select("id,discipline,niveau")
    .eq("eleve_id",String(studentId)).eq("periode",period).eq("created_by",String(user?.id||""));
  if(error)throw new Error("Chargement des maîtrises impossible : "+error.message);
  return data||[];
}
function ppCollectMasteries(){
  const out=[];
  const permitted=new Set(PP_MASTERY_LEVELS.map(x=>x[0]));
  for(const select of document.querySelectorAll(".pp-mastery")){
    const code=String(select.value||"");
    if(code&&!permitted.has(code))throw new Error("Niveau de maîtrise invalide.");
    if(code)out.push({discipline:String(select.dataset.discipline||""),niveau:code});
  }
  return out;
}
async function ppPersistMasteries(student,period,masteries){
  const current=await ppLoadMasteries(student.id,period);
  const by=new Map();
  for(const row of current){
    if(by.has(row.discipline))throw new Error("Doublons de maîtrise pour "+row.discipline+".");
    by.set(row.discipline,row);
  }
  const proposed=new Map((masteries||[]).map(x=>[x.discipline,x.niveau]));
  const known=new Set([...PP_DISCIPLINES.map(x=>x.nom),PP_SCIENCES.pc,PP_SCIENCES.svt]);
  for(const [discipline,niveau] of proposed){
    const old=by.get(discipline);
    if(old?.niveau===niveau)continue;
    const values={niveau,updated_at:new Date().toISOString()};
    const q=old
      ?sb.from(PP_MASTERY_TABLE).update(values).eq("id",old.id)
      :sb.from(PP_MASTERY_TABLE).insert({eleve_id:String(student.id),classe:student.classe,
        periode:period,discipline,niveau,created_by:user.id});
    const {data,error}=await q.select("id");
    if(error)throw new Error("Maîtrise de "+discipline+" : "+error.message);
    if(!data?.length)throw new Error("Enregistrement non confirmé pour "+discipline);
  }
  for(const [discipline,old] of by){
    if(!known.has(discipline)||proposed.has(discipline))continue;
    const {data,error}=await sb.from(PP_MASTERY_TABLE).delete()
      .eq("id",old.id).eq("eleve_id",String(student.id)).eq("periode",period).select("id");
    if(error)throw new Error("Suppression de maîtrise de "+discipline+" : "+error.message);
    if(!data?.length)throw new Error("Suppression non confirmée pour "+discipline);
  }
}

let ppStudents=[],ppClass="6e3",ppStudentId="",ppPeriod="year";
function ppName(s){return `${safe(s?.prenom)} ${safe(s?.nom)}`.trim()||"Élève"}
function ppToday(){return new Date().toISOString().slice(0,10)}
function ppPeriodStart(p){
  const now=new Date();
  const calendarYear=now.getFullYear();
  const month=now.getMonth()+1;
  const schoolYearStart=month>=9?calendarYear:calendarYear-1;
  if(p==="t1")return `${schoolYearStart}-09-01`;
  if(p==="t2")return `${schoolYearStart}-11-21`;
  if(p==="t3")return `${schoolYearStart+1}-02-13`;
  return "1900-01-01";
}
function ppPeriodEnd(p){
  const now=new Date();
  const calendarYear=now.getFullYear();
  const month=now.getMonth()+1;
  const schoolYearStart=month>=9?calendarYear:calendarYear-1;
  if(p==="t1")return `${schoolYearStart}-11-20`;
 if(p==="t2")return `${schoolYearStart+1}-02-12`;
 if(p==="t3")return `${schoolYearStart+1}-06-30`;
  return "2999-12-31";
}
function ppStudentById(id){return ppStudents.find(s=>String(s.id)===String(id))||null}
function ppClassStudents(){return ppStudents.filter(s=>!ppClass||String(s.classe)===String(ppClass))}
async function ppLoadStudents(){
  const {data,error}=await sb.from("Eleves").select("id,classe,nom,prenom,created_at").eq("classe","6e3").order("nom").order("prenom");
  if(error)throw new Error(error.message);ppStudents=data||[];studentsCache=ppStudents.slice();return ppStudents;
}
async function ppLoadTable(table,studentId=null,classeFilter=null){
  let q=sb.from(table).select("*");
  if(table===PP_TABLES.conseils){
    q=q.order("created_at",{ascending:false});
  }else{
    q=q.order("date",{ascending:false}).order("created_at",{ascending:false});
  }
  if(studentId)q=q.eq("eleve_id",String(studentId));
  if(classeFilter)q=q.eq("classe",classeFilter);
  const {data,error}=await q;
  if(error)throw new Error(error.message);
  return data||[];
}
async function ppInsert(table,payload){
  const row={...payload,created_by:user?.id||null};
  const {data,error}=await sb.from(table).insert(row).select("*").single();if(error)throw new Error(error.message);return data;
}
async function ppDelete(table,id){const {error}=await sb.from(table).delete().eq("id",id);if(error)throw new Error(error.message)}
function ppStatusBadges(s,stats){
  const b=[];if(stats.amenagements)b.push(`<span class="pp-badge info">🧩 ${stats.amenagements}</span>`);if(stats.contacts)b.push(`<span class="pp-badge">👪 ${stats.contacts}</span>`);if(stats.actions)b.push(`<span class="pp-badge ${stats.overdue?"danger":"warn"}">📋 ${stats.actions}</span>`);if(stats.events)b.push(`<span class="pp-badge">📝 ${stats.events}</span>`);return b.join("")||'<span class="small-note">Aucun suivi</span>';
}
// Synthèse des échéances du Suivi PP, sans modification des enregistrements.
function ppDashboardPriorities(students,actions,contacts,today=ppToday()){
 const names=new Map((students||[]).map(st=>[String(st.id),ppName(st)]));
 const all=[];
 (actions||[]).filter(a=>String(a.statut||"").toLowerCase()!=="termine").forEach(a=>{
  const due=String(a.echeance||"").slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(due))return;
  all.push({kind:"actions",studentId:String(a.eleve_id||""),student:names.get(String(a.eleve_id||""))||"Élève non retrouvé",title:String(a.action||"Action à réaliser"),due});
 });
 (contacts||[]).forEach(c=>{
  const due=String(c.relance_date||"").slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(due))return;
  all.push({kind:"contacts",studentId:String(c.eleve_id||""),student:names.get(String(c.eleve_id||""))||"Élève non retrouvé",title:String(c.motif||"Relance famille"),due});
 });
 all.sort((a,b)=>a.due.localeCompare(b.due)||a.student.localeCompare(b.student,"fr"));
 const due=all.filter(x=>x.due<=today);
 return {due,next:all.filter(x=>x.due>today).slice(0,5),
  openActions:(actions||[]).filter(a=>String(a.statut||"").toLowerCase()!=="termine").length,
  overdueActions:due.filter(x=>x.kind==="actions").length,
  followups:due.filter(x=>x.kind==="contacts").length};
}
async function ppOpenPriority(id,tab){
 await openPPStudent(id);
 if(document.getElementById("ppStudentBody"))await ppRenderStudent(tab);
}
function ppDashboardPriorityHTML(summary){
 const row=x=>'<div class="pp-item" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">'+
  '<div><strong>'+esc(x.student)+'</strong> · '+esc(x.kind==="contacts"?"Relance famille":"Action à mener")+
  '<div>'+esc(x.title)+'</div><div class="small-note">'+esc(x.due.split("-").reverse().join("/"))+'</div></div>'+
  (x.studentId?'<button type="button" onclick="ppOpenPriority('+jsArg(x.studentId)+','+jsArg(x.kind)+')">Ouvrir la fiche →</button>':"")+'</div>';
 return '<section class="pp-section" aria-label="Bilan et priorités du professeur principal">'+
  '<h3>📌 Priorités et relances</h3><p class="small-note">Actions non terminées et dates de relance des familles échues ou prévues aujourd’hui. Ces échéances restent visibles tant qu’elles sont renseignées.</p>'+
  '<div class="pp-grid">'+
  '<div class="pp-stat"><div class="n">'+summary.openActions+'</div><div class="l">Actions ouvertes</div></div>'+
  '<div class="pp-stat"><div class="n">'+summary.overdueActions+'</div><div class="l">Actions à échéance</div></div>'+
  '<div class="pp-stat"><div class="n">'+summary.followups+'</div><div class="l">Relances familles</div></div></div>'+
  (summary.due.length?summary.due.slice(0,8).map(row).join("")+
    (summary.due.length>8?'<p class="small-note">'+(summary.due.length-8)+' autre(s) échéance(s).</p>':""):
    '<div class="pp-empty">Aucune action ni relance arrivée à échéance.</div>')+
  (summary.next.length?'<details style="margin-top:12px"><summary>Prochaines échéances</summary>'+
     summary.next.map(x=>'<div class="pp-item">'+esc(x.student)+' · '+esc(x.title)+
       ' · '+esc(x.due.split("-").reverse().join("/"))+'</div>').join("")+'</details>':"")+
  '</section>';
}

async function openPP(){
  if(!correctionAllowLeave())return;
  try{localStorage.setItem(EVAL_NAV_KEY,JSON.stringify({view:"pp",classe:ppClass,period:ppPeriod}))}catch(e){}
label.textContent="Suivi PP";
  content.innerHTML=`<button type="button" onclick="home()">← Accueil</button><section class="hero" style="margin-top:14px"><span class="eyebrow">Professeur principal</span><h2>👨‍🏫 Suivi PP</h2><p class="muted">Un espace dédié au suivi des élèves, des familles, des aménagements et des actions de la classe.</p><div class="pp-toolbar"><div><label>Classe suivie</label><div class="editbox" style="margin-top:6px;padding:10px 12px"><strong>6e3</strong><span class="small-note" style="margin-left:8px">Professeur principal</span></div></div><div><label>Période</label><select id="ppPeriodSelect" onchange="ppPeriod=this.value;renderPPDashboard()"><option value="year">Année</option><option value="t1">Trimestre 1</option><option value="t2">Trimestre 2</option><option value="t3">Trimestre 3</option></select></div></div></section><div id="ppDashboard"><p class="muted">Chargement…</p></div>`;
  try{ppClass="6e3";await ppLoadStudents();const per=document.getElementById("ppPeriodSelect");if(per)per.value=ppPeriod;await renderPPDashboard();}catch(e){showError("Suivi PP : "+e.message)}
}
async function renderPPDashboard(){
  if(document.getElementById("ppDashboard"))saveEvalNav({view:"pp",classe:ppClass,period:ppPeriod});
  const target=document.getElementById("ppDashboard");if(!target)return;target.innerHTML='<section class="hero"><p class="muted">Chargement du suivi…</p></section>';
  try{
    const students=ppClassStudents(),ids=students.map(s=>String(s.id));
    const [events,contacts,amenagements,actions]=await Promise.all([ppLoadTable(PP_TABLES.events,null,ppClass||null),ppLoadTable(PP_TABLES.contacts,null,ppClass||null),ppLoadTable(PP_TABLES.amenagements,null,ppClass||null),ppLoadTable(PP_TABLES.actions,null,ppClass||null)]);
    const start=ppPeriodStart(ppPeriod),end=ppPeriodEnd(ppPeriod),inPeriod=x=>!x.date||(String(x.date)>=start&&String(x.date)<=end);
    const ppPriorities=ppDashboardPriorityHTML(ppDashboardPriorities(students,actions,contacts));
    const ev=events.filter(inPeriod),co=contacts.filter(inPeriod),ac=actions.filter(inPeriod),am=amenagements.filter(x=>x.actif!==false);
    const overdue=actions.filter(x=>x.statut!=="termine"&&x.echeance&&x.echeance<=ppToday()).length;
    const statsBy=new Map(ids.map(id=>[id,{events:0,contacts:0,amenagements:0,actions:0,overdue:0}]));
    ev.forEach(x=>{const z=statsBy.get(String(x.eleve_id));if(z)z.events++});co.forEach(x=>{const z=statsBy.get(String(x.eleve_id));if(z)z.contacts++});am.forEach(x=>{const z=statsBy.get(String(x.eleve_id));if(z)z.amenagements++});ac.forEach(x=>{const z=statsBy.get(String(x.eleve_id));if(z&&x.statut!=="termine"){z.actions++;if(x.echeance&&x.echeance<=ppToday())z.overdue++}});
    target.innerHTML=`<div class="pp-grid"><div class="pp-stat"><div class="n">${students.length}</div><div class="l">Élèves suivis</div></div><div class="pp-stat"><div class="n">${am.length}</div><div class="l">Aménagements actifs</div></div><div class="pp-stat"><div class="n">${co.length}</div><div class="l">Contacts (${ppPeriod==="year"?"année":ppPeriod.toUpperCase()})</div></div><div class="pp-stat"><div class="n">${overdue}</div><div class="l">Actions à relancer</div></div></div>${ppPriorities}<section class="pp-section"><div class="entry-head"><div><h3>👥 Élèves</h3><p class="small-note">Clique sur un élève pour ouvrir sa fiche PP.</p></div><div class="row"><button type="button" onclick="openPPCouncil()">📅 Conseil de classe</button><button type="button" onclick="ppNewStudentEvent()">＋ Ajouter un suivi</button></div></div><div class="pp-student-list">${students.map(s=>`<div class="pp-student" onclick="openPPStudent('${esc(s.id)}')"><div><strong>${esc(ppName(s))}</strong><div class="small-note">${esc(s.classe||"")}</div></div><div class="pp-badges">${ppStatusBadges(s,statsBy.get(String(s.id))||{})}</div></div>`).join("")||'<div class="pp-empty">Aucun élève dans cette sélection.</div>'}</div></section>`;
  }catch(e){target.innerHTML=`<section class="hero error"><h3>⚠️ Suivi PP indisponible</h3><p>${esc(e.message)}</p><p class="small-note">Vérifie que les tables PP ont bien été créées dans Supabase.</p></section>`}
}
function ppModal(html){const d=document.createElement("div");d.className="pp-modal";d.innerHTML=`<div class="pp-modal-card">${html}</div>`;d.addEventListener("click",e=>{if(e.target===d)d.remove()});document.body.appendChild(d);return d}
function ppCloseModal(){document.querySelectorAll(".pp-modal").forEach(x=>x.remove())}
function ppSelectOptions(list,selected=""){return list.map(x=>`<option value="${esc(x[0])}" ${String(x[0])===String(selected)?"selected":""}>${esc(x[1])}</option>`).join("")}
async function ppNewStudentEvent(){
  const students=ppClassStudents();if(!students.length){alert("Aucun élève disponible.");return}
  const modal=ppModal(`<h2>＋ Nouveau suivi PP</h2><div class="editbox"><label>Élève</label><select id="ppf_student">${students.map(s=>`<option value="${esc(s.id)}">${esc(ppName(s))} — ${esc(s.classe||"")}</option>`).join("")}</select><label>Type</label><select id="ppf_type">${ppSelectOptions([["observation","Observation"],["vigilance","Point de vigilance"],["contact","Contact famille"],["rendez_vous","Rendez-vous"],["action","Action à mener"],["conseil","Conseil de classe"]])}</select><label>Date</label><input id="ppf_date" type="date" value="${ppToday()}"><label>Titre</label><input id="ppf_title" placeholder="Ex. Point de vigilance, rencontre famille…"><label>Compte rendu / contenu</label><textarea id="ppf_content" rows="6" placeholder="Notes de suivi…"></textarea></div><div class="row"><button type="button" onclick="ppCloseModal()">Annuler</button><button class="primary" type="button" onclick="ppSaveQuickEvent()">💾 Enregistrer</button></div>`);modal.dataset.x="1";
}
async function ppSaveQuickEvent(){const m=document.querySelector(".pp-modal"),sid=document.getElementById("ppf_student")?.value,s=ppStudentById(sid);if(!s)return;try{await ppInsert(PP_TABLES.events,{eleve_id:String(s.id),classe:s.classe,date:document.getElementById("ppf_date").value,type:document.getElementById("ppf_type").value,titre:document.getElementById("ppf_title").value.trim(),contenu:document.getElementById("ppf_content").value.trim()});m.remove();await renderPPDashboard();alert("Suivi enregistré ✓")}catch(e){alert("Enregistrement impossible : "+e.message)}}
// Fiche PP : période explicite, sans confondre « Année » et les notes du T1.
let ppStudentActiveTab="synthese",ppStudentRenderRequest=0,ppGradeFormSnapshot=null;
function ppPeriodText(period){
  return ({year:"Année scolaire",t1:"Trimestre 1",t2:"Trimestre 2",t3:"Trimestre 3"})[period]||"Période";
}
function ppEventInSelectedPeriod(row,period=ppPeriod){
  if(period==="year")return true;
  const date=String(row?.date||"").slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=ppPeriodStart(period)&&date<=ppPeriodEnd(period);
}
function ppCurrentGradeFormSnapshot(){
  const body=document.getElementById("ppStudentBody");
  if(!body||!body.querySelector(".pp-grade"))return null;
  const inputs=[...body.querySelectorAll(".pp-grade,.pp-mastery")].map(input=>[input.className,input.dataset.discipline,input.value]);
  return JSON.stringify(inputs);
}
function ppStudentHasUnsavedGrades(){
  const current=ppCurrentGradeFormSnapshot();
  return current!==null&&ppGradeFormSnapshot!==null&&current!==ppGradeFormSnapshot;
}
async function ppSelectStudentPeriod(period){
  const selector=document.getElementById("ppStudentPeriod");
  if(!["year","t1","t2","t3"].includes(period)||period===ppPeriod)return;
  if(ppStudentHasUnsavedGrades()&&!confirm("Des moyennes ont été modifiées sans être enregistrées. Changer de période et abandonner ces modifications ?")){
    if(selector)selector.value=ppPeriod;
    return;
  }
  ppPeriod=period;
  await ppRenderStudent(ppStudentActiveTab);
}
async function openPPStudent(id){
  if(!correctionAllowLeave())return;
  ppStudentId=String(id);
  const existing=ppStudentById(id);
  if(!existing)await ppLoadStudents();
  const student=ppStudentById(id);
  if(!student)return;
  ppStudentActiveTab="synthese";
  ppGradeFormSnapshot=null;
  saveEvalNav({view:"ppStudent",id:String(id),classe:student.classe,period:ppPeriod,ppTab:"synthese"});
  label.textContent="Suivi PP · "+ppName(student);
  content.innerHTML='<button type="button" onclick="openPP()">← Suivi PP</button>'+
    '<section class="hero" style="margin-top:14px"><span class="eyebrow">'+esc(student.classe||"")+'</span>'+
    '<h2>👤 '+esc(ppName(student))+'</h2><p class="muted">Fiche de suivi du professeur principal.</p>'+
    '<div class="pp-toolbar" style="margin:14px 0"><label for="ppStudentPeriod">Période de la fiche</label>'+
    '<select id="ppStudentPeriod" onchange="ppSelectStudentPeriod(this.value)">'+
    [["year","Année scolaire (suivis)"],["t1","Trimestre 1"],["t2","Trimestre 2"],["t3","Trimestre 3"]]
      .map(([value,title])=>'<option value="'+value+'"'+(ppPeriod===value?' selected':'')+'>'+title+'</option>').join("")+
    '</select></div>'+
    '<div class="pp-tabs">'+
    '<button data-pp-student-tab="synthese" class="active" onclick="ppRenderStudent(\'synthese\')">Synthèse</button>'+
    '<button data-pp-student-tab="events" onclick="ppRenderStudent(\'events\')">📝 Suivi</button>'+
    '<button data-pp-student-tab="contacts" onclick="ppRenderStudent(\'contacts\')">👪 Familles</button>'+
    '<button data-pp-student-tab="amenagements" onclick="ppRenderStudent(\'amenagements\')">🧩 Aménagements</button>'+
    '<button data-pp-student-tab="actions" onclick="ppRenderStudent(\'actions\')">📋 Actions</button>'+
    '</div></section><div id="ppStudentBody"><p class="muted">Chargement…</p></div>';
  await ppRenderStudent("synthese");
}
async function ppRenderStudent(tab="synthese"){
  const target=document.getElementById("ppStudentBody"),student=ppStudentById(ppStudentId);
  if(!target||!student)return;
  const choices=["synthese","events","contacts","amenagements","actions"];
  if(!choices.includes(tab))tab="synthese";
  if(tab!==ppStudentActiveTab&&ppStudentHasUnsavedGrades()&&
    !confirm("Des moyennes ont été modifiées sans être enregistrées. Changer d’onglet et abandonner ces modifications ?"))return;
  ppStudentActiveTab=tab;
  ppGradeFormSnapshot=null;
  const request=++ppStudentRenderRequest;
  saveEvalNav({view:"ppStudent",id:String(ppStudentId),classe:student.classe,period:ppPeriod,ppTab:tab});
  const periodControl=document.getElementById("ppStudentPeriod");
  if(periodControl)periodControl.value=ppPeriod;
  document.querySelectorAll("[data-pp-student-tab]").forEach(button=>{
    const active=button.dataset.ppStudentTab===tab;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",String(active));
  });
  target.innerHTML='<section class="pp-section"><p class="muted">Chargement du suivi…</p></section>';
  try{
    const studentId=String(ppStudentId),currentPeriod=ppPeriod;
    const [events,contacts,amenagements,actions]=await Promise.all([
      ppLoadTable(PP_TABLES.events,studentId),
      ppLoadTable(PP_TABLES.contacts,studentId),
      ppLoadTable(PP_TABLES.amenagements,studentId),
      ppLoadTable(PP_TABLES.actions,studentId)
    ]);
    if(request!==ppStudentRenderRequest||!target.isConnected||studentId!==String(ppStudentId))return;
    const visibleEvents=events.filter(x=>ppEventInSelectedPeriod(x,currentPeriod));
    const visibleContacts=contacts.filter(x=>ppEventInSelectedPeriod(x,currentPeriod));
    if(tab==="synthese"){
      const activeAm=amenagements.filter(x=>x.actif!==false).length;
      const openActions=actions.filter(x=>x.statut!=="termine");
      const vigilanceEvents=visibleEvents.filter(x=>String(x.type)==="vigilance");
      const vigilanceHtml=vigilanceEvents.length
        ?vigilanceEvents.map(x=>'<div class="pp-item"><strong>'+esc(x.titre||"Point de vigilance")+'</strong>'+
          '<div class="small-note">'+esc(x.date||"")+'</div>'+(x.contenu?'<p>'+esc(x.contenu)+'</p>':"")+'</div>').join("")
        :'<div class="pp-empty">Aucun point de vigilance pour cette période.</div>';
      // Le mode annuel n'a pas de moyenne trimestrielle unique à saisir.
      const gradePeriod=currentPeriod==="year"?null:currentPeriod.toUpperCase();
      let grades=[],masteries=[];
      if(gradePeriod)[grades,masteries]=await Promise.all([ppLoadGrades(studentId,gradePeriod),ppLoadMasteries(studentId,gradePeriod)]);
      if(request!==ppStudentRenderRequest||!target.isConnected||studentId!==String(ppStudentId))return;
      const manualAvg=gradePeriod?ppWeightedAverage(grades):null;
      const generated=gradePeriod?ppGenerateAppreciation(grades,student,visibleEvents,masteries):"";
      const gradeSection=gradePeriod?
        '<section class="pp-section"><div class="entry-head"><div><h3>📊 Résultats du '+esc(ppPeriodText(currentPeriod).toLowerCase())+'</h3>'+
        '<p class="small-note">Moyennes par discipline sur 20 ; les disciplines non renseignées ne comptent pas dans la moyenne générale.</p></div>'+
        '<button class="primary" type="button" onclick="ppSaveGrades()">💾 Enregistrer les moyennes</button></div>'+
        ppGradesEditor(grades,masteries)+
        '<div class="pp-appreciation" style="margin-top:14px"><strong>💬 Proposition d’appréciation générale</strong>'+
        '<textarea id="ppGeneratedAppreciation" rows="4" style="width:100%;margin-top:8px">'+esc(generated)+'</textarea>'+
        '<div class="row" style="margin-top:8px"><button type="button" onclick="ppGenerateAndFillAppreciation()">✨ Régénérer à partir des résultats et du comportement</button></div>'+
        '<p class="small-note">Proposition modifiable avant le conseil de classe.</p></div></section>':
        '<section class="pp-section"><h3>📊 Résultats scolaires</h3><p class="small-note">'+
        'Sélectionne le trimestre 1, 2 ou 3 en haut de la fiche pour consulter ou saisir les moyennes. En vue annuelle, aucune moyenne du T1 n’est affichée comme moyenne de l’année.</p></section>';
      target.innerHTML='<div class="pp-grid">'+
        '<div class="pp-stat"><div class="n">'+visibleContacts.length+'</div><div class="l">Contacts familles ('+esc(ppPeriodText(currentPeriod))+')</div></div>'+
        '<div class="pp-stat"><div class="n">'+(manualAvg===null?"—":ppFormatGrade(manualAvg)+" / 20")+'</div>'+
        '<div class="l">Moyenne '+esc(gradePeriod||"non calculée sur l’année")+'</div></div>'+
        '<div class="pp-stat"><div class="n">'+activeAm+'</div><div class="l">Aménagement(s) actif(s)</div></div>'+
        '<div class="pp-stat"><div class="n">'+vigilanceEvents.length+'</div><div class="l">Points de vigilance</div></div></div>'+
        '<section class="pp-section"><h3>⚠️ Points de vigilance</h3>'+vigilanceHtml+'</section>'+
        gradeSection+
        '<div class="pp-two"><section class="pp-section"><h3>📝 Derniers suivis ('+esc(ppPeriodText(currentPeriod))+')</h3>'+
        (visibleEvents.slice(0,5).map(ppEventHtml).join("")||'<div class="pp-empty">Aucun suivi enregistré pour cette période.</div>')+
        '</section><section class="pp-section"><h3>📋 Actions ouvertes (toutes périodes)</h3>'+
        (openActions.slice(0,5).map(ppActionHtml).join("")||'<div class="pp-empty">Aucune action en cours.</div>')+
        '</section></div><section class="pp-section"><h3>🧩 Aménagements actifs</h3>'+
        (amenagements.filter(x=>x.actif!==false).map(ppAmenagementHtml).join("")||'<div class="pp-empty">Aucun aménagement actif.</div>')+'</section>';
      ppGradeFormSnapshot=ppCurrentGradeFormSnapshot();
    }else if(tab==="events"){
      target.innerHTML=ppListSection("📝 Suivi et observations — "+ppPeriodText(currentPeriod),visibleEvents,"event");
    }else if(tab==="contacts"){
      target.innerHTML=ppListSection("👪 Contacts familles — "+ppPeriodText(currentPeriod),visibleContacts,"contact");
    }else if(tab==="amenagements"){
      // Les aménagements demeurent visibles toute l'année tant qu'ils sont actifs.
      target.innerHTML=ppListSection("🧩 Aménagements (historique annuel)",amenagements,"amenagement");
    }else{
      // Les échéances en cours doivent rester visibles même si l'action date d'un autre trimestre.
      target.innerHTML=ppListSection("📋 Actions (toutes périodes)",actions,"action");
    }
  }catch(e){
    if(request===ppStudentRenderRequest&&target.isConnected)
      target.innerHTML='<section class="pp-section error"><p>'+esc(e.message)+'</p></section>';
  }
}
function ppFormatGrade(v){const n=Number(v);return Number.isFinite(n)?n.toFixed(2).replace(".",","):""}
async function ppLoadGrades(studentId,period){
  const {data,error}=await sb.from(PP_TABLES.moyennes).select("*").eq("eleve_id",String(studentId)).eq("periode",period);
  if(error)throw new Error(error.message);return data||[];
}
function ppNumericGrade(value){
  // Une case vide est une note manquante ; zéro est uniquement une vraie note saisie.
  if(value===null||value===undefined||String(value).trim()==="")return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0&&n<=20?n:null;
}
function ppWeightedAverage(grades){
  const by=new Map((grades||[]).map(x=>[String(x.discipline),ppNumericGrade(x.moyenne)]));
  let total=0,coefTotal=0;
  PP_DISCIPLINES.forEach(d=>{
    const v=by.get(d.nom);
    if(v!==null&&v!==undefined){total+=v*d.coef;coefTotal+=d.coef;}
  });
  // École Directe : SVT et Physique-Chimie sont deux matières distinctes, coef. 2 chacune.
  for(const subject of [PP_SCIENCES.pc,PP_SCIENCES.svt]){
    const value=by.get(subject);
    if(value!==null&&value!==undefined){total+=value*PP_SCIENCES.coef;coefTotal+=PP_SCIENCES.coef;}
  }
  return coefTotal?total/coefTotal:null;
}
function ppGenerateAppreciation(grades,student,events=[],masteries=[]){
  const avg=ppWeightedAverage(grades);
  let result="";
  if(avg===null) result="Résultats à compléter pour établir une appréciation générale.";
  else if(avg>=16) result="Très bons résultats d’ensemble";
  else if(avg>=14) result="Bons résultats d’ensemble";
  else if(avg>=12) result="Résultats satisfaisants dans l’ensemble";
  else if(avg>=10) result="Résultats encore fragiles dans plusieurs disciplines";
  else result="Résultats insuffisants dans l’ensemble, avec des progrès à poursuivre";
  if(avg!==null){
    result+=`. Moyenne générale pondérée : ${ppFormatGrade(avg)}/20.`;
  }
  const remarques=events
    .filter(x=>["observation","vigilance","équipe","autre"].includes(String(x.type)))
    .filter(x=>String(x.contenu||"").trim())
    .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  if(remarques.length){
    const textes=remarques
      .slice(0,3)
      .map(x=>String(x.contenu||"").trim())
      .filter(Boolean);
    if(textes.length){
      result+=" "+textes.join(" ");
    }
  }
  const levels=(masteries||[]).filter(x=>PP_MASTERY_LEVELS.some(a=>a[0]===x.niveau));
  if(levels.length){
    const fragile=levels.filter(x=>x.niveau==="MF"||x.niveau==="MI");
    const positives=levels.filter(x=>x.niveau==="TBM"||x.niveau==="MS");
    if(!fragile.length){
      result+=" La maîtrise globale des compétences est satisfaisante à très bonne dans les disciplines renseignées.";
    }else if(positives.length){
      result+=" La maîtrise des compétences reste hétérogène selon les disciplines.";
    }else{
      result+=" La maîtrise des compétences demeure fragile ou insuffisante dans les disciplines renseignées.";
    }
    const subjects=fragile.map(x=>String(x.discipline||"")).filter(Boolean).slice(0,2);
    if(subjects.length)result+=" Des progrès sont notamment attendus en "+subjects.join(" et ")+".";
  }
  return result;
}
function ppGradesEditor(grades,masteries=[]){
  const by=new Map(grades.map(x=>[String(x.discipline),x]));
  const pcVal=ppNumericGrade(by.get("Physique-Chimie")?.moyenne);
  const svtVal=ppNumericGrade(by.get("SVT")?.moyenne);
  const scienceAvg=(pcVal!=null&&svtVal!=null)?((Number(pcVal)+Number(svtVal))/2):null;
  const scienceHtml=`<div class="pp-sciences"><div class="pp-sciences-title"><div><strong>Sciences</strong> <span class="small-note">2 matières, coefficient 2 chacune</span></div><span class="small-note">Moyennes École Directe séparées</span></div><div class="pp-sciences-fields"><div class="pp-sciences-field"><label>Physique-Chimie <span class="small-note">coef. 2</span></label><input class="pp-grade" data-discipline="Physique-Chimie" type="number" min="0" max="20" step="0.01" value="${pcVal==null?"":esc(pcVal)}" placeholder="/20">${ppMasterySelect("Physique-Chimie",masteries)}</div><div class="pp-sciences-field"><label>SVT <span class="small-note">coef. 2</span></label><input class="pp-grade" data-discipline="SVT" type="number" min="0" max="20" step="0.01" value="${svtVal==null?"":esc(svtVal)}" placeholder="/20">${ppMasterySelect("SVT",masteries)}</div></div><div class="pp-sciences-average">Moyenne Sciences : <output id="ppScienceAverage">${scienceAvg==null?"—":ppFormatGrade(scienceAvg)+" /20"}</output></div><div class="small-note" style="margin-top:6px">La SVT et la Physique-Chimie sont prises en compte séparément, chacune avec un coefficient 2 dans la moyenne générale.</div></div>`;
  return `<div class="pp-grades"><div class="small-note" style="margin-bottom:10px">Les coefficients correspondent au bulletin École Directe fourni, avec anglais coefficient 3 et SVT / Physique-Chimie coefficient 2 chacune.</div>${PP_DISCIPLINES.map(d=>{const r=by.get(d.nom)||{};return `<div class="pp-grade-row"><label>${esc(d.nom)} <span class="small-note">coef. ${d.coef}</span></label><input class="pp-grade" data-discipline="${esc(d.nom)}" type="number" min="0" max="20" step="0.01" value="${r.moyenne==null?"":esc(r.moyenne)}" placeholder="/20">${ppMasterySelect(d.nom,masteries)}</div>`}).join("")}${scienceHtml}</div>`;
}
function ppCollectGrades(){
  const out=[];
  for(const field of document.querySelectorAll(".pp-grade")){
    if(field.value.trim()==="")continue;
    const grade=ppNumericGrade(field.value);
    if(grade===null)throw new Error("Moyenne invalide pour « "+field.dataset.discipline+" » (attendu : 0 à 20).");
    out.push({discipline:field.dataset.discipline,moyenne:grade});
  }
  const d=document.getElementById("pp_other_discipline")?.value.trim(),v=document.getElementById("pp_other_grade")?.value;
  if(d&&v!==""){const grade=ppNumericGrade(v);if(grade===null)throw new Error("Moyenne invalide pour « "+d+" ».");out.push({discipline:d,moyenne:grade});}
  return out;
}
function ppUpdateScienceAverage(){
  const pc=ppNumericGrade(document.querySelector('.pp-grade[data-discipline="Physique-Chimie"]')?.value);
  const svt=ppNumericGrade(document.querySelector('.pp-grade[data-discipline="SVT"]')?.value);
  const out=document.getElementById("ppScienceAverage");
  if(!out)return;
  out.textContent=(pc!==null&&svt!==null)?`${ppFormatGrade((pc+svt)/2)} /20`:"—";
}
// Enregistrer sans suppression préalable : conserver les anciennes lignes si l'ajout échoue.
async function ppPersistGrades(student,period,grades){
  const existing=await ppLoadGrades(student.id,period);
  const known=new Set([...PP_DISCIPLINES.map(d=>d.nom),PP_SCIENCES.pc,PP_SCIENCES.svt]);
  const current=new Map();
  (existing||[]).forEach(row=>{
    const discipline=String(row.discipline||"");
    if(current.has(discipline))throw new Error("Des doublons existent pour « "+discipline+" » : sauvegarde interrompue pour préserver les données.");
    current.set(discipline,row);
  });
  const proposed=new Map(grades.map(g=>[g.discipline,g.moyenne]));
  // 1. Insérer les nouvelles disciplines avant de toucher aux notes existantes.
  for(const [discipline,moyenne] of proposed){
    if(current.has(discipline))continue;
    const {data,error}=await sb.from(PP_TABLES.moyennes).insert({
      eleve_id:String(student.id),classe:student.classe,periode:period,
      discipline,moyenne,created_by:user?.id||null
    }).select("id");
    if(error)throw new Error(error.message);
    if(!data?.length)throw new Error("Ajout non confirmé pour « "+discipline+" ».");
  }
  // 2. Modifier directement les notes existantes, sans effacer leurs lignes.
  for(const [discipline,moyenne] of proposed){
    const old=current.get(discipline);
    if(!old||ppNumericGrade(old.moyenne)===moyenne)continue;
    if(!old.id)throw new Error("Identifiant manquant pour « "+discipline+" ».");
    const {data,error}=await sb.from(PP_TABLES.moyennes).update({moyenne})
      .eq("id",old.id).eq("eleve_id",String(student.id)).eq("periode",period).select("id");
    if(error)throw new Error(error.message);
    if(!data?.length)throw new Error("Modification non confirmée pour « "+discipline+" ».");
  }
  // 3. Supprimer uniquement les disciplines affichées puis volontairement vidées.
  // Les disciplines externes ou non proposées dans le formulaire sont préservées.
  for(const [discipline,old] of current){
    if(!known.has(discipline)||proposed.has(discipline))continue;
    if(!old.id)throw new Error("Identifiant manquant pour « "+discipline+" ».");
    const {data,error}=await sb.from(PP_TABLES.moyennes).delete()
      .eq("id",old.id).eq("eleve_id",String(student.id)).eq("periode",period).select("id");
    if(error)throw new Error(error.message);
    if(!data?.length)throw new Error("Suppression non confirmée pour « "+discipline+" ».");
  }
}
async function ppSaveGrades(){
  const student=ppStudentById(ppStudentId);if(!student)return;
  if(ppPeriod==="year"){alert("Sélectionne un trimestre avant d’enregistrer des moyennes.");return;}
  const period=ppPeriod.toUpperCase();
  const button=document.querySelector('button[onclick="ppSaveGrades()"]');
  if(button?.disabled)return;
  try{
    const grades=ppCollectGrades();
    const existing=await ppLoadGrades(student.id,period);
    const known=new Set([...PP_DISCIPLINES.map(d=>d.nom),PP_SCIENCES.pc,PP_SCIENCES.svt]);
    if(!grades.length&&existing.some(row=>known.has(row.discipline))&&
      !confirm("Les moyennes de "+period+" sont toutes vides. Confirmer la suppression des notes renseignées ?"))return;
    if(button)button.disabled=true;
    await ppPersistGrades(student,period,grades);
    await ppPersistMasteries(student,period,ppCollectMasteries());
    ppGradeFormSnapshot=ppCurrentGradeFormSnapshot();
    await ppRenderStudent("synthese");
    alert("Moyennes et maîtrises de "+period+" enregistrées ✓");
  }catch(e){
    alert("Enregistrement incomplet : "+e.message+". Vérifie les moyennes de cette période avant une nouvelle tentative.");
  }finally{if(button?.isConnected)button.disabled=false;}
}
async function ppGenerateAndFillAppreciation(){
  const student=ppStudentById(ppStudentId);
  if(!student||ppPeriod==="year"){alert("Sélectionne un trimestre pour générer l’appréciation.");return;}
  try{
    // Tenir compte des moyennes en cours de saisie, sans imposer une sauvegarde.
    const grades=ppCollectGrades();
    const events=(await ppLoadTable(PP_TABLES.events,student.id)).filter(x=>ppEventInSelectedPeriod(x));
    const txt=ppGenerateAppreciation(grades,student,events,ppCollectMasteries());
    const el=document.getElementById("ppGeneratedAppreciation");
    if(el)el.value=txt;
  }catch(e){alert("Génération impossible : "+e.message)}
}
function ppEventHtml(x){return `<div class="pp-item"><div class="meta">${esc(x.date||"")} · ${esc(x.type||"Observation")}</div><strong>${esc(x.titre||"Suivi")}</strong><div>${esc(x.contenu||"")}</div></div>`}
function ppContactHtml(x){return `<div class="pp-item"><div class="meta">${esc(x.date||"")} · ${esc(x.type||"Contact")} · ${esc(x.interlocuteur||"")}</div><strong>${esc(x.motif||"Contact famille")}</strong><div>${esc(x.compte_rendu||"")}</div>${x.suite?`<div class="small-note">Suite : ${esc(x.suite)}</div>`:""}</div>`}
function ppAmenagementHtml(x){return `<div class="pp-item"><div class="meta">${esc(x.type||"Aménagement")} · ${x.actif===false?"Inactif":"Actif"}</div><strong>${esc(x.description||"Aménagement")}</strong>${x.date?`<div class="small-note">Depuis le ${esc(x.date)}</div>`:""}</div>`}
function ppActionHtml(x){return `<div class="pp-item"><div class="meta">${esc(x.date||"")} · ${esc(x.statut||"à faire")}${x.echeance?` · Échéance : ${esc(x.echeance)}`:""}</div><strong>${esc(x.action||"Action")}</strong>${x.responsable?`<div class="small-note">Responsable : ${esc(x.responsable)}</div>`:""}${x.notes?`<div>${esc(x.notes)}</div>`:""}</div>`}
function ppListSection(title,rows,type){
  let add="";if(type==="event")add=`<button type="button" onclick="ppAddEvent()">＋ Ajouter</button>`;if(type==="contact")add=`<button type="button" onclick="ppAddContact()">＋ Ajouter</button>`;if(type==="amenagement")add=`<button type="button" onclick="ppAddAmenagement()">＋ Ajouter</button>`;if(type==="action")add=`<button type="button" onclick="ppAddAction()">＋ Ajouter</button>`;
  const fn=type==="event"?ppEventHtml:type==="contact"?ppContactHtml:type==="amenagement"?ppAmenagementHtml:ppActionHtml;
  return `<section class="pp-section"><div class="entry-head"><div><h3>${title}</h3><p class="small-note">Les données sont enregistrées dans Supabase et restent séparées de l'interface élèves.</p></div>${add}</div>${rows.map(x=>`${fn(x)}<div class="row" style="justify-content:flex-end;margin-top:-5px"><button type="button" class="danger" onclick="ppRemove('${esc(type)}','${esc(x.id)}')">🗑️ Supprimer</button></div>`).join("")||'<div class="pp-empty">Aucun élément enregistré.</div>'}</section>`
}
async function ppRemove(type,id){if(!confirm("Supprimer définitivement cet élément ?"))return;const table=type==="event"?PP_TABLES.events:type==="contact"?PP_TABLES.contacts:type==="amenagement"?PP_TABLES.amenagements:PP_TABLES.actions;try{await ppDelete(table,id);await ppRenderStudent(type==="event"?"events":type==="contact"?"contacts":type==="amenagement"?"amenagements":"actions")}catch(e){alert("Suppression impossible : "+e.message)}}
function ppForm(title,fields,saveFn){const modal=ppModal(`<h2>${title}</h2><div class="editbox">${fields.join("")}</div><div class="row"><button type="button" onclick="ppCloseModal()">Annuler</button><button class="primary" type="button" onclick="${saveFn}">💾 Enregistrer</button></div>`);return modal}
function ppAddEvent(){ppForm("＋ Ajouter un suivi",[`<label>Date</label><input id="ppx_date" type="date" value="${ppToday()}"><label>Type</label><select id="ppx_type">${ppSelectOptions([["observation","Observation"],["vigilance","Point de vigilance"],["rendez_vous","Rendez-vous"],["équipe","Équipe éducative"],["autre","Autre"]])}</select><label>Titre</label><input id="ppx_title" placeholder="Objet du suivi"><label>Contenu</label><textarea id="ppx_content" rows="7"></textarea>`],"ppSaveEvent()")}
async function ppSaveEvent(){const s=ppStudentById(ppStudentId);try{await ppInsert(PP_TABLES.events,{eleve_id:String(s.id),classe:s.classe,date:ppx_date.value,type:ppx_type.value,titre:ppx_title.value.trim(),contenu:ppx_content.value.trim()});ppCloseModal();await ppRenderStudent("events")}catch(e){alert(e.message)}}
function ppAddContact(){ppForm("＋ Contact famille",[`<label>Date</label><input id="ppx_date" type="date" value="${ppToday()}"><label>Type</label><select id="ppx_type">${ppSelectOptions([["téléphone","Téléphone"],["email","E-mail"],["rendez_vous","Rendez-vous"],["EcoleDirecte","EcoleDirecte"],["autre","Autre"]])}</select><label>Interlocuteur</label><input id="ppx_inter" placeholder="Parent, responsable légal…"><label>Motif</label><input id="ppx_title" placeholder="Motif du contact"><label>Compte rendu</label><textarea id="ppx_content" rows="6"></textarea><label>Suite à donner</label><textarea id="ppx_suite" rows="3"></textarea><label>Date de relance</label><input id="ppx_relance" type="date">`],"ppSaveContact()")}
async function ppSaveContact(){const s=ppStudentById(ppStudentId);try{await ppInsert(PP_TABLES.contacts,{eleve_id:String(s.id),classe:s.classe,date:ppx_date.value,type:ppx_type.value,interlocuteur:ppx_inter.value.trim(),motif:ppx_title.value.trim(),compte_rendu:ppx_content.value.trim(),suite:ppx_suite.value.trim(),relance_date:ppx_relance.value||null});ppCloseModal();await ppRenderStudent("contacts")}catch(e){alert(e.message)}}
function ppAddAmenagement(){ppForm("＋ Aménagement",[`<label>Type</label><select id="ppx_type">${ppSelectOptions([["PAP","PAP"],["PPS","PPS"],["PAI","PAI"],["ULIS","ULIS"],["autre","Autre"]])}</select><label>Date de mise en place</label><input id="ppx_date" type="date" value="${ppToday()}"><label>Description / adaptations</label><textarea id="ppx_content" rows="7" placeholder="Aménagements, adaptations, outils…"></textarea><label>Actif</label><select id="ppx_actif"><option value="true">Oui</option><option value="false">Non</option></select>`],"ppSaveAmenagement()")}
async function ppSaveAmenagement(){const s=ppStudentById(ppStudentId);try{await ppInsert(PP_TABLES.amenagements,{eleve_id:String(s.id),classe:s.classe,date:ppx_date.value,type:ppx_type.value,description:ppx_content.value.trim(),actif:ppx_actif.value==="true"});ppCloseModal();await ppRenderStudent("amenagements")}catch(e){alert(e.message)}}
function ppAddAction(){ppForm("＋ Action à mener",[`<label>Date</label><input id="ppx_date" type="date" value="${ppToday()}"><label>Action</label><input id="ppx_title" placeholder="Ex. contacter la famille, proposer un rendez-vous…"><label>Responsable</label><input id="ppx_resp" placeholder="PP, CPE, professeur…"><label>Échéance</label><input id="ppx_echeance" type="date"><label>Statut</label><select id="ppx_statut">${ppSelectOptions([["a_faire","À faire"],["en_cours","En cours"],["termine","Terminé"]])}</select><label>Notes</label><textarea id="ppx_content" rows="5"></textarea>`],"ppSaveAction()")}
async function ppSaveAction(){const s=ppStudentById(ppStudentId);try{await ppInsert(PP_TABLES.actions,{eleve_id:String(s.id),classe:s.classe,date:ppx_date.value,action:ppx_title.value.trim(),responsable:ppx_resp.value.trim(),echeance:ppx_echeance.value||null,statut:ppx_statut.value,notes:ppx_content.value.trim()});ppCloseModal();await ppRenderStudent("actions")}catch(e){alert(e.message)}}

/* Suivi PP — bilan académique du conseil, calculé à partir des moyennes enregistrées. */
function ppCouncilAcademicData(students,marks){
  const list=students||[],valid=new Map(list.map(x=>[String(x.id),new Map()])),duplicates=new Set();
  let invalid=0;
  (marks||[]).forEach(m=>{
    const id=String(m.eleve_id||""),discipline=String(m.discipline||"").trim();
    if(!valid.has(id)||!discipline)return;
    const grade=ppNumericGrade(m.moyenne);
    if(grade===null){invalid++;return;}
    const map=valid.get(id),key=id+"::"+discipline;
    if(duplicates.has(key))return;
    if(map.has(discipline)){map.delete(discipline);duplicates.add(key);return;}
    map.set(discipline,grade);
  });
  const pupils=list.map(st=>{
    const m=valid.get(String(st.id)),grades=[...m].map(([discipline,moyenne])=>({discipline,moyenne}));
    return {id:String(st.id),name:ppName(st),grades,average:ppWeightedAverage(grades)};
  });
  const graded=pupils.filter(p=>p.average!==null);
  const bins=[0,0,0,0];
  graded.forEach(p=>{bins[p.average>=16?0:p.average>=10?1:p.average>=5?2:3]++});
  const weightedClassAverage=graded.length?graded.reduce((sum,p)=>sum+p.average,0)/graded.length:null;
  const names=[...PP_DISCIPLINES.map(x=>x.nom),PP_SCIENCES.pc,PP_SCIENCES.svt];
  const others=[...new Set((marks||[]).map(x=>String(x.discipline||"").trim()).filter(x=>x&&!names.includes(x)))].sort((a,b)=>a.localeCompare(b,"fr"));
  const subjects=[...names,...others].map(name=>{
    const rows=pupils.map(p=>{
      const note=p.grades.find(g=>g.discipline===name)?.moyenne;
      return note===undefined?null:{id:p.id,name:p.name,note};
    }).filter(Boolean);
    const avg=rows.length?rows.reduce((sum,x)=>sum+x.note,0)/rows.length:null;
    return {name,rows,average:avg,below:rows.filter(x=>x.note<10).sort((a,b)=>a.note-b.note),included:names.includes(name)};
  });
  const alerts=pupils.map(p=>({...p,below:p.grades.filter(g=>g.moyenne<10).sort((a,b)=>a.moyenne-b.moyenne)}))
    .filter(p=>p.below.length).sort((a,b)=>b.below.length-a.below.length||a.name.localeCompare(b.name,"fr"));
  return {pupils,graded:graded.length,ungraded:pupils.length-graded.length,bins,average:weightedClassAverage,subjects,alerts,duplicates:duplicates.size,invalid};
}
async function ppCouncilAcademicRead(period,classe){
  const rows=[],size=500;
  for(let page=0;page<20;page++){
    const {data,error}=await sb.from(PP_TABLES.moyennes).select("eleve_id,discipline,moyenne")
      .eq("classe",classe).eq("periode",period)
      .order("eleve_id",{ascending:true}).order("discipline",{ascending:true})
      .range(page*size,(page+1)*size-1);
    if(error)throw new Error(error.message);
    rows.push(...(data||[]));
    if((data||[]).length<size)return rows;
  }
  throw new Error("Trop de moyennes à parcourir : lecture interrompue.");
}

/* Graphiques du conseil PP : reproduisent les deux vues de résultats fournies
   dans ÉcoleDirecte, sans assimiler moyennes et maîtrise des compétences. */
let ppCouncilAcademicChartData=null;
function ppChartNumber(value){return Number(value).toFixed(1)}
function ppChartSubjects(data){
  const preferred=[...PP_DISCIPLINES.map(d=>d.nom),PP_SCIENCES.svt,PP_SCIENCES.pc];
  return [...data.subjects].sort((a,b)=>{
    const ai=preferred.indexOf(a.name),bi=preferred.indexOf(b.name);
    return (ai<0?999:ai)-(bi<0?999:bi);
  }).filter(x=>x.rows.length&&x.average!==null);
}
function ppChartCompareSvg(data,pupil){
  const all=ppChartSubjects(data);
  if(!all.length)return '<p class="pp-empty">Aucune moyenne de discipline enregistrée pour la classe.</p>';
  const svgW=Math.max(820,all.length*90+75),svgH=405;
  const left=48,right=24,top=30,baseline=268;
  const step=(svgW-left-right)/all.length;
  const y=v=>baseline-Number(v)/20*(baseline-top);
  const axis=[0,5,10,15,20].map(n=>
    '<line x1="'+left+'" y1="'+ppChartNumber(y(n))+'" x2="'+(svgW-right)+'" y2="'+ppChartNumber(y(n))+'" stroke="#d8e2e6"/>'+
    '<text x="'+(left-10)+'" y="'+ppChartNumber(y(n)+4)+'" font-size="12" fill="#637079" text-anchor="end">'+n+'</text>').join("");
  const range=all.map((subject,i)=>{
    const x=left+step*(i+0.5);
    const vals=subject.rows.map(r=>r.note).filter(Number.isFinite);
    const lo=Math.min(...vals),hi=Math.max(...vals);
    const h=Math.max(3,y(lo)-y(hi));
    return '<rect x="'+ppChartNumber(x-13)+'" y="'+ppChartNumber(y(hi))+'" width="26" height="'+ppChartNumber(h)+'" fill="#9dc5e4" opacity="0.73">'+
       '<title>'+esc(subject.name)+' : '+ppChartNumber(lo)+'–'+ppChartNumber(hi)+'/20 (élèves saisis)</title></rect>'+
       '<text x="'+ppChartNumber(x-4)+'" y="'+(baseline+14)+'" transform="rotate(-48 '+ppChartNumber(x-4)+' '+(baseline+14)+')" text-anchor="end" fill="#42525a" font-size="12">'+esc(subject.name)+'</text>';
  }).join("");
  function line(field,color){
    let html="",prior=null;
    all.forEach((subject,i)=>{
      const v=field==="average" ? subject.average : pupil.grades.find(g=>g.discipline===subject.name)?.moyenne;
      if(!Number.isFinite(v)){prior=null;return;}
      const x=left+step*(i+0.5),cy=y(v);
      if(prior)html+='<line x1="'+ppChartNumber(prior[0])+'" y1="'+ppChartNumber(prior[1])+
        '" x2="'+ppChartNumber(x)+'" y2="'+ppChartNumber(cy)+'" stroke="'+color+'" stroke-width="2.6"/>';
      html+='<circle cx="'+ppChartNumber(x)+'" cy="'+ppChartNumber(cy)+'" r="4.3" fill="'+color+'">'+
        '<title>'+esc(subject.name)+' : '+ppChartNumber(v)+'/20</title></circle>';
      prior=[x,cy];
    });
    return html;
  }
  return '<div class="pp-chart-scroll"><svg class="pp-chart-svg" viewBox="0 0 '+svgW+' '+svgH+
    '" role="img" aria-label="Moyennes de l’élève et de la classe, minimum et maximum par discipline">'+
    axis+range+line("average","#263746")+line("pupil","#d94b58")+'</svg></div>'+
    '<div class="pp-chart-legend"><span><i style="background:#9dc5e4"></i>Min–max de la classe</span>'+
    '<span><i style="background:#263746"></i>Moyenne de la classe</span>'+
    '<span><i style="background:#d94b58"></i>Moyenne de l’élève</span></div>';
}
function ppChartRadarSvg(data,pupil){
  const shared=ppChartSubjects(data).map(subject=>{
    const own=pupil.grades.find(g=>g.discipline===subject.name)?.moyenne;
    return own===undefined?null:{...subject,own};
  }).filter(Boolean);
  if(shared.length<3)return '<p class="pp-empty">Radar indisponible : au moins trois disciplines avec des moyennes sont nécessaires.</p>';
  const n=shared.length,cx=385,cy=223,radius=145;
  function point(i,value){
    const a=-Math.PI/2+2*Math.PI*i/n,rad=radius*(value/20);
    return [cx+rad*Math.cos(a),cy+rad*Math.sin(a)];
  }
  function points(values){return values.map((v,i)=>point(i,v).map(ppChartNumber).join(",")).join(" ")}
  const grid=[5,10,15,20].map(v=>
    '<polygon points="'+points(shared.map(()=>v))+'" fill="none" stroke="#d5dfe4"/>'+
    '<text x="'+(cx+6)+'" y="'+ppChartNumber(cy-radius*v/20-3)+'" font-size="11" fill="#637079">'+v+'</text>').join("");
  const labels=shared.map((s,i)=>{
    const [endX,endY]=point(i,20),a=-Math.PI/2+2*Math.PI*i/n;
    const x=cx+(radius+36)*Math.cos(a),y=cy+(radius+36)*Math.sin(a);
    const anchor=x>cx+8?"start":x<cx-8?"end":"middle";
    return '<line x1="'+cx+'" y1="'+cy+'" x2="'+ppChartNumber(endX)+'" y2="'+ppChartNumber(endY)+'" stroke="#d5dfe4"/>'+
      '<text x="'+ppChartNumber(x)+'" y="'+ppChartNumber(y)+'" font-size="11" fill="#40515a" text-anchor="'+anchor+'">'+esc(s.name)+'</text>';
  }).join("");
  return '<div class="pp-chart-scroll"><svg class="pp-chart-svg pp-radar-svg" viewBox="0 0 770 465" role="img" aria-label="Radar comparant les moyennes de l’élève et de la classe">'+
    grid+labels+
    '<polygon points="'+points(shared.map(s=>s.average))+'" fill="#263746" fill-opacity=".09" stroke="#263746" stroke-width="2.4"/>'+
    '<polygon points="'+points(shared.map(s=>s.own))+'" fill="#d94b58" fill-opacity=".12" stroke="#d94b58" stroke-width="2.4"/></svg></div>'+
    '<div class="pp-chart-legend"><span><i style="background:#263746"></i>Moyenne de la classe</span>'+
    '<span><i style="background:#d94b58"></i>Moyenne de l’élève</span></div>'+
    '<p class="small-note">Radar limité aux disciplines ayant une moyenne disponible pour cet élève.</p>';
}
function ppCouncilDrawAcademicCharts(){
  const d=ppCouncilAcademicChartData,selector=document.getElementById("ppCouncilChartStudent");
  const host=document.getElementById("ppCouncilCharts");
  if(!host||!selector||!d)return;
  const pupil=d.pupils.find(p=>String(p.id)===String(selector.value));
  if(!pupil){host.innerHTML='<p class="pp-empty">Aucun élève sélectionné.</p>';return;}
  host.innerHTML='<div class="pp-student-graphs">'+
    '<section class="pp-chart-card"><h4>Moyennes par discipline — élève et classe</h4>'+ppChartCompareSvg(d,pupil)+'</section>'+
    '<section class="pp-chart-card"><h4>Radar des moyennes</h4>'+ppChartRadarSvg(d,pupil)+'</section></div>'+
    '<p class="small-note">Graphiques calculés uniquement à partir des moyennes de discipline enregistrées dans le Suivi PP. Les plages min–max et les moyennes de classe peuvent être incomplètes si des élèves ne sont pas encore renseignés.</p>';
}
function ppCouncilHistogramHtml(data,distribution){
  const max=Math.max(1,...distribution.map(row=>row[1]));
  return '<div class="pp-histogram" role="img" aria-label="Histogramme des moyennes générales de la classe">'+
    distribution.map(([name,count])=>'<div class="pp-histogram-row"><span>'+esc(name)+'</span>'+
      '<div class="pp-histogram-track"><div style="width:'+(100*count/max).toFixed(1)+'%"></div></div>'+
      '<strong>'+count+'</strong></div>').join("")+'</div>';
}
function ppCouncilSelectorHtml(data){
  const first=data.pupils.find(p=>p.grades.length)||data.pupils[0];
  if(!first)return '<p class="pp-empty">Aucun élève à comparer.</p>';
  return '<div class="pp-chart-selector"><label for="ppCouncilChartStudent">Élève à comparer</label>'+
    '<select id="ppCouncilChartStudent" onchange="ppCouncilDrawAcademicCharts()">'+
    data.pupils.map(p=>'<option value="'+esc(p.id)+'"'+(p.id===first.id?' selected':'')+'>'+esc(p.name)+'</option>').join("")+
    '</select></div><div id="ppCouncilCharts"></div>';
}

function ppCouncilAcademicHtml(data,period){
  const fmt=n=>n===null?"—":n.toFixed(2).replace(".",",");
  const pct=(n,d)=>d?(100*n/d).toFixed(1).replace(".",",")+" %":"—";
  const report='<div class="pp-grid">'+
    '<div class="pp-stat"><div class="n">'+fmt(data.average)+'</div><div class="l">Moyenne de classe /20</div></div>'+
    '<div class="pp-stat"><div class="n">'+data.graded+'</div><div class="l">Élèves avec moyenne</div></div>'+
    '<div class="pp-stat"><div class="n">'+data.ungraded+'</div><div class="l">Sans moyenne calculable</div></div>'+
    '<div class="pp-stat"><div class="n">'+data.alerts.length+'</div><div class="l">Élèves avec discipline sous 10</div></div></div>';
  const distribution=[["16 à 20",data.bins[0]],["10 à moins de 16",data.bins[1]],["5 à moins de 10",data.bins[2]],["Moins de 5",data.bins[3]]];
  const histogram=ppCouncilHistogramHtml(data,distribution);
  const comparison='<h4 style="margin-top:20px">Comparaisons graphiques des résultats</h4>'+ppCouncilSelectorHtml(data);
  const tableDist='<div style="overflow-x:auto"><table class="data-table" style="width:100%">'+
    '<thead><tr><th>Tranche</th><th>Élèves</th><th>Pourcentage</th></tr></thead><tbody>'+
    distribution.map(([name,n])=>'<tr><td>'+name+'</td><td>'+n+'</td><td>'+pct(n,data.graded)+'</td></tr>').join("")+
    '</tbody></table></div>';
  const tableSubjects='<h4 style="margin-top:16px">Bilan par discipline</h4>'+
    '<p class="small-note">Les moyennes sont calculées parmi les élèves ayant une note dans la discipline. Le pourcentage « sous 10 » ne mesure pas la maîtrise des compétences.</p>'+
    '<div style="overflow-x:auto"><table class="data-table" style="width:100%"><thead><tr>'+
    '<th>Discipline</th><th>Moyenne /20</th><th>Élèves notés</th><th>Élèves sous 10</th><th>Part sous 10</th></tr></thead><tbody>'+
    data.subjects.map(d=>'<tr><td><strong>'+esc(d.name)+'</strong>'+
      (d.included?"":'<div class="small-note">Non incluse dans le calcul pondéré actuel</div>')+
      '</td><td>'+fmt(d.average)+'</td><td>'+d.rows.length+'</td><td>'+
      (d.below.length?'<details><summary>'+d.below.length+' élève(s)</summary>'+
        d.below.map(p=>'<div class="small-note">'+esc(p.name)+' : '+fmt(p.note)+'/20</div>').join("")+'</details>':'0')+
      '</td><td>'+pct(d.below.length,d.rows.length)+'</td></tr>').join("")+
    '</tbody></table></div>';
  const alertTable='<h4 style="margin-top:16px">Points de vigilance individuels</h4>'+
    (data.alerts.length?'<div style="overflow-x:auto"><table class="data-table" style="width:100%"><thead><tr>'+
      '<th>Élève</th><th>Moyenne générale</th><th>Disciplines sous 10/20</th></tr></thead><tbody>'+
      data.alerts.map(p=>'<tr><td><strong>'+esc(p.name)+'</strong></td><td>'+fmt(p.average)+'</td><td>'+
        p.below.map(g=>esc(g.discipline)+' : <strong>'+fmt(g.moyenne)+'</strong>').join(" · ")+'</td></tr>').join("")+
      '</tbody></table></div>':'<p class="pp-empty">Aucune discipline sous 10 dans les données saisies.</p>');
  return '<section class="pp-section"><div class="entry-head"><div>'+
    '<h3>📊 Bilan de la classe — '+esc(period)+'</h3>'+
    '<p class="small-note">Moyenne des moyennes générales pondérées des élèves disposant de résultats, sans assimiler une note manquante à 0.</p></div>'+
    '<button type="button" onclick="ppCouncilRefreshAcademic()">↻ Actualiser</button></div>'+
    report+'<h4>Répartition des moyennes générales</h4>'+histogram+tableDist+comparison+tableSubjects+alertTable+
    '<p class="small-note" style="margin-top:12px">La moyenne est indicative lorsque certaines disciplines ne sont pas renseignées. En accord avec le bulletin École Directe, la SVT et la Physique-Chimie comptent séparément, coefficient 2 chacune.</p>'+
    (data.duplicates?'<p class="small-note" role="alert">⚠️ '+data.duplicates+' doublon(s) élève-discipline ignoré(s).</p>':"")+
    (data.invalid?'<p class="small-note">'+data.invalid+' valeur(s) absente(s) ou invalide(s) écartée(s).</p>':"")+
    '<h4 style="margin-top:16px">Maîtrise des compétences</h4>'+
    '<p class="small-note">Indicateur à compléter : le pourcentage de maîtrise satisfaisante (TBM + MS) nécessite les résultats de compétences par discipline, pas seulement les moyennes sur 20.</p>'+
    '</section>';
}
async function ppCouncilRefreshAcademic(){
  const host=document.getElementById("ppCouncilAcademic");if(!host)return;
  const token=ppCouncilLoadRequest,period=document.getElementById("ppCouncilPeriod")?.value;
  if(!["T1","T2","T3"].includes(period))return;
  host.innerHTML='<p class="small-note">Chargement du bilan des résultats…</p>';
  try{
    ppCouncilAcademicChartData=null;
    const marks=await ppCouncilAcademicRead(period,ppClass);
    if(token!==ppCouncilLoadRequest||!host.isConnected||document.getElementById("ppCouncilPeriod")?.value!==period)return;
    ppCouncilAcademicChartData=ppCouncilAcademicData(ppClassStudents(),marks);
    host.innerHTML=ppCouncilAcademicHtml(ppCouncilAcademicChartData,period);
    ppCouncilDrawAcademicCharts();
  }catch(e){
    if(token===ppCouncilLoadRequest&&host.isConnected)
      host.innerHTML='<section class="pp-section"><p role="alert">Bilan des résultats indisponible : '+esc(e.message)+'</p>'+
        '<button type="button" onclick="ppCouncilRefreshAcademic()">Réessayer</button></section>';
  }
}

// Formulation qualitative validée par le PP, non inférée des notes ou des évaluations.
const PP_COUNCIL_MASTERY_PHRASES={
 tres_bonne:"La maîtrise globale des compétences est très bonne.",
 satisfaisante:"La maîtrise globale des compétences est satisfaisante.",
 fragile:"La maîtrise globale des compétences reste fragile.",
 insuffisante:"La maîtrise globale des compétences est insuffisante."
};
function ppCouncilMasteryFromText(value){
 const text=String(value||"");
 return Object.keys(PP_COUNCIL_MASTERY_PHRASES).find(k=>text.includes(PP_COUNCIL_MASTERY_PHRASES[k]))||"";
}
function ppCouncilHasMastery(value){
 const text=String(value||"");
 return !!ppCouncilMasteryFromText(text)||
  (/maîtris[\w]*[^.!?]{0,80}compétences|compétences[^.!?]{0,80}maîtris[\w]*/iu).test(text);
}
function ppCouncilInsertMastery(studentId){
 if(ppCouncilSaving)return;
 const id=String(studentId);
 const field=[...document.querySelectorAll(".pp-council-app")].find(el=>String(el.dataset.id)===id);
 const select=[...document.querySelectorAll(".pp-council-mastery")].find(el=>String(el.dataset.id)===id);
 if(!field||!select)return;
 const sentence=PP_COUNCIL_MASTERY_PHRASES[select.value];
 if(!sentence){alert("Choisis d’abord le niveau de maîtrise des compétences.");return;}
 let text=String(field.value||"").trim();
 Object.values(PP_COUNCIL_MASTERY_PHRASES).forEach(previous=>{text=text.split(previous).join(" ");});
 text=text.replace(/\s+/g," ").trim();
 field.value=(text?text+(/[.!?]$/.test(text)?" ":". "):"")+sentence;
 ppCouncilDrawStatus();
}

/* Conseil de classe PP : repères de complétude, modifications protégées et sauvegarde ciblée. */
let ppCouncilBaseline=new Map(),ppCouncilSaving=false,ppCouncilLoadRequest=0;
function ppCouncilText(value){return String(value??"").trim();}
function ppCouncilCapture(){
  const decisions=new Map([...document.querySelectorAll(".pp-council-dec")]
    .map(el=>[String(el.dataset.id||""),ppCouncilText(el.value)]));
  return [...document.querySelectorAll(".pp-council-app")].map(el=>({
    id:String(el.dataset.id||""),appreciation:ppCouncilText(el.value),
    decisions:decisions.get(String(el.dataset.id||""))||""
  })).filter(row=>row.id);
}
function ppCouncilChanged(row){
  const old=ppCouncilBaseline.get(String(row.id));
  return row.appreciation!==ppCouncilText(old?.appreciation)||
    row.decisions!==ppCouncilText(old?.decisions);
}
function ppCouncilIsDirty(){
  return !!document.getElementById("ppCouncilBody")&&ppCouncilCapture().some(ppCouncilChanged);
}
function ppCouncilDrawStatus(){
  const rows=ppCouncilCapture();
  const done=rows.filter(x=>x.appreciation).length;
  const decisions=rows.filter(x=>x.decisions).length;
  const masteryCount=rows.filter(x=>ppCouncilHasMastery(x.appreciation)).length;
  const dirty=rows.filter(ppCouncilChanged).length;
  const summary=document.getElementById("ppCouncilSummary");
  if(summary)summary.innerHTML=
    '<div class="pp-grid">'+
    '<div class="pp-stat"><div class="n">'+rows.length+'</div><div class="l">Élèves de la classe</div></div>'+
    '<div class="pp-stat"><div class="n">'+done+'</div><div class="l">Appréciations renseignées</div></div>'+
    '<div class="pp-stat"><div class="n">'+decisions+'</div><div class="l">Décisions / suites renseignées</div></div>'+
    '<div class="pp-stat"><div class="n">'+(rows.length-done)+'</div><div class="l">Appréciations à compléter</div></div>'+ 
    '<div class="pp-stat"><div class="n">'+masteryCount+'</div><div class="l">Appréciations évoquant la maîtrise des compétences</div></div>'+
    '</div><p class="small-note" role="status">'+
    (dirty?'<strong style="color:#9a5519">● '+dirty+' fiche(s) modifiée(s) non enregistrée(s).</strong>':
      '✓ Toutes les modifications saisies sont enregistrées.')+
    ' Les décisions ne sont pas obligatoires pour chaque élève.</p>';
  const search=(document.getElementById("ppCouncilSearch")?.value||"").trim().toLocaleLowerCase("fr");
  const filter=document.getElementById("ppCouncilFilter")?.value||"all";
  let visible=0;
  const byId=new Map(rows.map(row=>[row.id,row]));
  document.querySelectorAll("tr[data-pp-council-id]").forEach(tr=>{
    const row=byId.get(String(tr.dataset.ppCouncilId||""));
    if(!row)return;
    const changed=ppCouncilChanged(row);
    const name=String(tr.dataset.ppCouncilName||"").toLocaleLowerCase("fr");
    const matching=(!search||name.includes(search))&&
      (filter==="missing"?!row.appreciation:
       filter==="written"?!!row.appreciation:
       filter==="mastery_missing"?!ppCouncilHasMastery(row.appreciation):
       filter==="unsaved"?changed:true);
    tr.hidden=!matching;
    if(matching)visible++;
    const status=tr.querySelector(".pp-council-status");
    if(status)status.textContent=(row.appreciation?"✓ Appréciation saisie":"À compléter")+
      (row.appreciation?(ppCouncilHasMastery(row.appreciation)?" · Compétences évoquées":" · Maîtrise à préciser"):"")+
      (row.decisions?" · Décision saisie":"")+
      (changed?" · ● Non enregistré":"");
  });
  const shown=document.getElementById("ppCouncilShown");
  if(shown)shown.textContent=visible+" / "+rows.length+" élève(s) affiché(s)";
  const button=document.getElementById("ppCouncilSave");
  if(button)button.disabled=ppCouncilSaving||dirty===0;
}
function ppCouncilConfirmLeave(){
  if(ppCouncilSaving){alert("Enregistrement du conseil de classe en cours.");return false;}
  return !ppCouncilIsDirty()||
    confirm("Des appréciations ou décisions du conseil de classe ne sont pas enregistrées. Quitter sans les sauvegarder ?");
}
async function ppCouncilChangePeriod(value){
  const select=document.getElementById("ppCouncilPeriod");
  const previous=ppPeriod==="year"?"T1":ppPeriod.toUpperCase();
  if(!["T1","T2","T3"].includes(value)){if(select)select.value=previous;return;}
  if(value===previous)return;
  if(!ppCouncilConfirmLeave()){if(select)select.value=previous;return;}
  // La confirmation a été donnée : ne pas la demander une seconde fois à l'ouverture.
  ppCouncilBaseline=new Map(ppCouncilCapture().map(x=>[x.id,x]));
  ppPeriod=value.toLowerCase();
  await openPPCouncil();
}
async function openPPCouncil(){
  if(!correctionAllowLeave())return;
  if(!ppClass){alert("Sélectionne d'abord une classe dans le Suivi PP.");return;}
  const token=++ppCouncilLoadRequest;
  const period=ppPeriod==="year"?"T1":ppPeriod.toUpperCase();
  saveEvalNav({view:"ppCouncil",classe:ppClass,period:ppPeriod});
  label.textContent="Conseil de classe · "+ppClass;
  ppCouncilBaseline=new Map();
  content.innerHTML='<button type="button" onclick="openPP()">← Suivi PP</button>'+
    '<section class="hero" style="margin-top:14px"><span class="eyebrow">'+esc(ppClass)+'</span>'+
    '<h2>📅 Conseil de classe</h2>'+
    '<p class="muted">Prépare les appréciations et les décisions par élève. Les décisions sont facultatives ; les modifications non enregistrées sont signalées.</p>'+
    '<div class="pp-toolbar"><div><label for="ppCouncilPeriod">Trimestre du conseil</label>'+
    '<select id="ppCouncilPeriod" onchange="ppCouncilChangePeriod(this.value)">'+
    ['T1','T2','T3'].map(p=>'<option value="'+p+'"'+(p===period?' selected':'')+'>'+p+'</option>').join("")+
    '</select></div></div></section>'+
    '<div id="ppCouncilBody"><p class="muted">Chargement des appréciations…</p></div>';
  const host=document.getElementById("ppCouncilBody");
  try{
    const [students,all]=await Promise.all([Promise.resolve(ppClassStudents()),
      ppLoadTable(PP_TABLES.conseils,null,ppClass)]);
    if(token!==ppCouncilLoadRequest||!host.isConnected)return;
    const originals=new Map();
    (all||[]).filter(row=>String(row.periode||"").toUpperCase()===period).forEach(row=>{
      const id=String(row.eleve_id||"");
      if(originals.has(id))throw new Error("Deux préparations existent pour un même élève en "+period+
        ". Aucune modification automatique : vérifie les doublons dans PP_Conseils.");
      originals.set(id,{id:row.id,appreciation:ppCouncilText(row.appreciation),decisions:ppCouncilText(row.decisions)});
    });
    ppCouncilBaseline=originals;
    host.innerHTML='<div id="ppCouncilAcademic"><p class="small-note">Chargement du bilan…</p></div>'+ 
      '<section class="pp-section">'+
      '<div class="entry-head"><div><h3>Préparation du conseil — '+esc(period)+'</h3>'+
      '<p class="small-note">Seules les fiches modifiées sont enregistrées. Aucune appréciation existante n’est remplacée automatiquement.</p></div>'+
      '<button class="primary" type="button" id="ppCouncilSave" onclick="ppSaveCouncil()" disabled>💾 Enregistrer les modifications</button></div>'+
      '<div id="ppCouncilSummary"></div>'+
      '<div class="row" style="gap:10px;flex-wrap:wrap;margin:10px 0">'+
      '<label style="flex:1;min-width:190px">Rechercher un élève'+
      '<input id="ppCouncilSearch" type="search" placeholder="Nom ou prénom…" oninput="ppCouncilDrawStatus()"></label>'+
      '<label style="min-width:200px">Afficher'+
      '<select id="ppCouncilFilter" onchange="ppCouncilDrawStatus()">'+
      '<option value="all">Tous les élèves</option>'+
      '<option value="missing">Appréciations à compléter</option>'+
      '<option value="written">Appréciations renseignées</option>'+ 
      '<option value="mastery_missing">Maîtrise des compétences à préciser</option>'+
      '<option value="unsaved">Modifications non enregistrées</option>'+
      '</select></label></div>'+
      '<p id="ppCouncilShown" class="small-note"></p>'+
      '<div style="overflow:auto"><table class="data-table" style="width:100%">'+
      '<thead><tr><th>Élève et état</th><th>Appréciation / synthèse</th><th>Décisions / suites (facultatif)</th></tr></thead><tbody>'+
      students.map(st=>{
        const old=originals.get(String(st.id))||{};
        const name=ppName(st);
        return '<tr data-pp-council-id="'+esc(st.id)+'" data-pp-council-name="'+esc(name)+'">'+
          '<td style="vertical-align:top;min-width:160px"><strong>'+esc(name)+'</strong>'+
          '<div class="small-note">'+esc(st.classe||"")+'</div>'+
          '<span class="small-note pp-council-status"></span></td>'+
          '<td><textarea class="pp-council-app" data-id="'+esc(st.id)+'" rows="4" style="width:100%" oninput="ppCouncilDrawStatus()">'+esc(old.appreciation||"")+'</textarea>'+
          '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:7px;align-items:end">'+
          '<label class="small-note" style="flex:1;min-width:175px">Maîtrise globale des compétences'+
          '<select class="pp-council-mastery" data-id="'+esc(st.id)+'" style="width:100%;margin-top:3px">'+
          '<option value="">Choisir un niveau…</option>'+
          [["tres_bonne","Très bonne maîtrise"],["satisfaisante","Maîtrise satisfaisante"],["fragile","Maîtrise fragile"],["insuffisante","Maîtrise insuffisante"]]
            .map(([key,title])=>'<option value="'+key+'"'+(ppCouncilMasteryFromText(old.appreciation)===key?' selected':'')+'>'+title+'</option>').join("")+
          '</select></label>'+
          '<button type="button" onclick="ppCouncilInsertMastery('+jsArg(st.id)+')">Insérer la phrase</button></div>'+
          '<div class="small-note">Formulation choisie par le PP, sans déduction automatique de la moyenne.</div></td>'+
          '<td><textarea class="pp-council-dec" data-id="'+esc(st.id)+'" rows="4" style="width:100%" oninput="ppCouncilDrawStatus()">'+esc(old.decisions||"")+'</textarea></td></tr>';
      }).join("")+'</tbody></table></div></section>';
    ppCouncilDrawStatus();
    void ppCouncilRefreshAcademic();
  }catch(e){
    if(token===ppCouncilLoadRequest&&host.isConnected)
      host.innerHTML='<section class="hero error"><p>'+esc(e.message)+'</p></section>';
  }
}
async function ppSaveCouncil(){
  if(ppCouncilSaving||!ppClass)return;
  const period=document.getElementById("ppCouncilPeriod")?.value||"T1";
  if(!["T1","T2","T3"].includes(period))return;
  const changed=ppCouncilCapture().filter(ppCouncilChanged);
  if(!changed.length){ppCouncilDrawStatus();return;}
  ppCouncilSaving=true;
  ppCouncilDrawStatus();
  let saved=0;
  try{
    for(const row of changed){
      const student=ppStudentById(row.id);
      if(!student||String(student.classe)!==String(ppClass))
        throw new Error("Élève non retrouvé dans la classe : "+row.id);
      const original=ppCouncilBaseline.get(row.id);
      let savedId=original?.id;
      if(savedId){
        const {data,error}=await sb.from(PP_TABLES.conseils)
          .update({appreciation:row.appreciation,decisions:row.decisions,updated_at:new Date().toISOString()})
          .eq("id",savedId).eq("eleve_id",row.id).eq("classe",student.classe).eq("periode",period)
          .select("id");
        if(error)throw new Error(error.message);
        if(!data?.length)throw new Error("Modification non confirmée pour "+ppName(student));
      }else{
        // Ne pas créer une fiche vide ; garder les valeurs déjà enregistrées des autres élèves.
        if(!row.appreciation&&!row.decisions)continue;
        const inserted=await ppInsert(PP_TABLES.conseils,{
          classe:student.classe,periode:period,eleve_id:row.id,
          appreciation:row.appreciation,decisions:row.decisions
        });
        if(!inserted?.id)throw new Error("Création non confirmée pour "+ppName(student));
        savedId=inserted.id;
      }
      // Actualiser la référence de chaque élève seulement après confirmation Supabase.
      ppCouncilBaseline.set(row.id,{id:savedId,appreciation:row.appreciation,decisions:row.decisions});
      saved++;
      ppCouncilDrawStatus();
    }
    alert(saved+" fiche(s) du conseil enregistrée(s) pour "+period+" ✓");
  }catch(e){
    alert("Enregistrement interrompu après "+saved+" fiche(s) : "+e.message+
      ". Les modifications restantes sont conservées dans le formulaire. Réessaie pour les enregistrer.");
  }finally{
    ppCouncilSaving=false;
    ppCouncilDrawStatus();
  }
}
window.addEventListener("beforeunload",event=>{
  if(ppCouncilSaving||ppCouncilIsDirty()){event.preventDefault();event.returnValue="";}
});
async function init(){
  /*
    On installe le listener AUTH AVANT de vérifier
    la session existante.
    Ainsi, il fonctionne aussi lorsque l'utilisateur
    arrive sur la page sans être encore connecté.
  */
  sb.auth.onAuthStateChange((event,session)=>{
    console.log("AUTH EVENT :",event);
    if(String(user?.id||'')!==String(session?.user?.id||''))localDraftStop(true);
    user=session?.user ?? null;
    if(event==="SIGNED_OUT" || !user){
      if(event==="SIGNED_OUT"){
        mfaAuthGeneration++;
        mfaCheckPromise=null;
      }
      mfaHideProfSpace();
      login(event === "SIGNED_OUT" ? "Tu es déconnecté. Connecte-toi pour continuer." : "Aucune session active. Connecte-toi pour accéder à l’espace Évaluations.");
      return;
    }
    // L'interface reste verrouillée : init() ou doLogin() lancent l'unique contrôle MFA.
  });
  /*
    Vérification de la session déjà existante.
  */
 await openProfSpaceIfMfaReady();
}
function login(message=""){
  label.textContent="Espace professeur";
  content.innerHTML=`<section class="hero login"><span class="eyebrow">Espace sécurisé</span><h2>👨‍🏫 Espace professeur</h2><p class="muted">Connecte-toi pour gérer les évaluations et le suivi de tes élèves.</p><div class="editbox"><label>Email</label><input id="email" type="email" autocomplete="username" placeholder="ton adresse e-mail"><label>Mot de passe</label><input id="password" type="password" autocomplete="current-password" placeholder="Mot de passe"><button class="primary" style="width:100%;margin-top:5px" onclick="doLogin()">Se connecter</button><div id="loginStatus" class="status" style="margin-top:10px"></div></div></section>`;
  const status=document.getElementById("loginStatus");
  if(status&&message)status.textContent=message;
}
async function doLogin(){
  const email=
    document.getElementById("email")?.value.trim() || "";
  const password=
    document.getElementById("password")?.value || "";
  const status=
    document.getElementById("loginStatus");
  const button=
    document.querySelector(".login button.primary");
  if(!email || !password){
    if(status){
      status.textContent=
        "Renseigne l'adresse e-mail et le mot de passe.";
    }
    return;
  }
  if(status){
    status.textContent="Connexion…";
  }
  if(button){
    button.disabled=true;
  }
  try{
    const {data,error}=
      await sb.auth.signInWithPassword({
        email,
        password
      });
    if(error){
      throw new Error(error.message);
    }
    /*
      Sécurité supplémentaire :
      même si l'événement SIGNED_IN tarde à être traité,
      on ouvre l'espace professeur directement.
    */
    user = data?.user ?? null;

if (!user) {
  throw new Error("Connexion réussie mais utilisateur non récupéré.");
}

if (status) status.textContent = "Vérification de la double validation…";

await openProfSpaceIfMfaReady();
  }catch(e){
    console.error(
      "Erreur de connexion :",
      e
    );
    if(status){
      status.textContent=
        "Connexion impossible : " +
        e.message;
    }
  }finally{
    if(button){
      button.disabled=false;
    }
  }
}
async function logout(){
  if(!correctionAllowLeave())return;await sb.auth.signOut()}
  function qcuEsc(v){
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;",
    '"':"&quot;", "'":"&#39;"
  }[c]));
}
function qcuNote(correct, total){
  return Math.round(Number(correct) / Number(total) * 2000) / 100;
}
async function openQCU(){
  if(!correctionAllowLeave())return;
  saveEvalNav({view:"qcu",qcuClass:"",qcuId:null});
  label.textContent = "QCU – Mémorisation";
  window.qcuSelectedClass = null;
  content.innerHTML = `
    <button onclick="home()">← Accueil</button>

    <section class="hero" style="margin-top:14px">
      <span class="eyebrow">Mémorisation active</span>
      <h2>🧠 QCU – Mémorisation</h2>
      <p class="muted">
        Choisis une classe pour gérer ses QCU et consulter ses moyennes.
      </p>
    </section>

    <div id="qcuList">Chargement…</div>
    <div id="qcuDetail"></div>
    <div id="qcuAverages"></div>
  `;
  await qcuLoad();
}
function qcuOpenClass(c){
  saveEvalNav({view:"qcu",qcuClass:String(c||""),qcuId:null});
  window.qcuSelectedClass = c;
  const host = document.getElementById("qcuList");
  if(!host) return;
  host.innerHTML = `
    <section class="hero">
      <button onclick="qcuBackToClasses()">← Toutes les classes</button>
      <h3 style="margin-top:12px">${qcuEsc(c)} — QCU de mémorisation</h3>

      <h4>Créer un QCU</h4>
      <input id="qcuClasse" type="hidden" value="${qcuEsc(c)}">

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <p class="muted" id="qcuAutoTrimester">Le trimestre sera déterminé automatiquement à partir de la date du QCU.</p>

        <label>Titre du QCU
          <input id="qcuTitre" placeholder="Ex. Mémo 1 + 2">
        </label>

        <label>Nombre de questions
          <input id="qcuTotal" type="number" min="1" step="1" value="20">
        </label>

        <label>Date
          <input id="qcuDate" type="date" value="${behaviorDateInputValue()}" onchange="qcuUpdateAutoTrimester()">
        </label>
      </div>

      <button class="primary" onclick="qcuCreate()">＋ Créer le QCU</button>
    </section>

    <section class="hero">
      <h3>QCU de ${qcuEsc(c)}</h3>
      <div id="qcuClassItems"></div>
    </section>
  `;
  qcuUpdateAutoTrimester();
  qcuRenderClassItems();
  qcuRenderAverages();
}
function qcuBackToClasses(){
  saveEvalNav({view:"qcu",qcuClass:"",qcuId:null});
  window.qcuSelectedClass = null;
  document.getElementById("qcuDetail").innerHTML = "";
  document.getElementById("qcuAverages").innerHTML = "";
  qcuLoad();
}
function qcuRenderClassItems(){
  const host = document.getElementById("qcuClassItems");
  if(!host) return;
  const items = (window.qcuItems || [])
    .filter(q => q.classe === window.qcuSelectedClass);
  if(!items.length){
    host.innerHTML = '<p class="muted">Aucun QCU pour cette classe. Crée le premier ci-dessus.</p>';
    return;
  }
  host.innerHTML = `
    <div class="grid">
      ${items.map(q => `
        <article class="card">
          <span class="tag">Trimestre ${Number(trackingPeriodForDate(q.date_qcu).replace("t",""))||"—"}</span>
          <h3>${qcuEsc(q.titre)}</h3>
          <p class="muted">${qcuEsc(q.date_qcu)} · ${q.total_questions} questions</p>
          <button class="primary" onclick="qcuOpen('${q.id}')">Saisir les scores</button>
          <button onclick="qcuDelete('${q.id}')">Supprimer</button>
        </article>
      `).join("")}
    </div>
  `;
}
async function qcuLoad(){
  const host = document.getElementById("qcuList");
  if(!host) return;
  const {data, error} = await sb
    .from("qcu_memorisation")
    .select("*")
    .order("date_qcu", {ascending:false});
  if(error){
    host.innerHTML = `
      <section class="hero">
        <h3>Erreur de chargement</h3>
        <p>${qcuEsc(error.message)}</p>
      </section>`;
    return;
  }
  window.qcuItems = data || [];
  const {data:eleves, error:elevesError} = await sb
    .from("Eleves")
    .select("id,classe,nom,prenom");
  window.qcuStudentsAll = elevesError ? [] : (eleves || []);
  if(window.qcuSelectedClass){
    qcuOpenClass(window.qcuSelectedClass);
    return;
  }
  const classes = [...new Set([
    ...Object.values(CLASSES).flat(),
    ...window.qcuItems.map(q => q.classe)
  ])].sort();
  host.innerHTML = `
    <section class="hero">
      <h3>Choisir une classe</h3>
      <div class="grid"
        style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">

        ${classes.map(c => {
          const n = window.qcuItems.filter(q => q.classe === c).length;

          return `
            <button class="card"
              style="text-align:center;padding:20px"
              onclick="qcuOpenClass('${qcuEsc(c)}')">

              <strong style="font-size:1.15rem">
                ${qcuEsc(c)}
              </strong>

              <p class="muted">
                ${n} QCU
              </p>
            </button>`;
        }).join("")}

      </div>
    </section>`;
}
function qcuUpdateAutoTrimester(){
  const date=document.getElementById("qcuDate")?.value;
  const period=trackingPeriodForDate(date);
  const label=document.getElementById("qcuAutoTrimester");
  if(label)label.textContent=period==="year"
    ?"Cette date est en dehors des périodes des trois trimestres."
    :`Trimestre attribué automatiquement : ${trackingPeriodLabel(period)}.`;
}
async function qcuCreate(){
  const classe = document.getElementById("qcuClasse").value;
  const date_qcu = document.getElementById("qcuDate").value;
  const trimestre = Number(trackingPeriodForDate(date_qcu).replace("t",""));
  const titre = document.getElementById("qcuTitre").value.trim();
  const total_questions = Number(document.getElementById("qcuTotal").value);
  if(!trimestre){alert("La date choisie est en dehors des trois trimestres.");return;}
  if(!titre || !Number.isInteger(total_questions) || total_questions < 1){
    alert("Indique un titre et un nombre de questions valide.");
    return;
  }
  const {data:{user:u}} = await sb.auth.getUser();
  const {error} = await sb.from("qcu_memorisation").insert({
    classe, trimestre, titre, total_questions, date_qcu,
    resultats:{},
    created_by:u?.id
  });
  if(error){
    alert("Création impossible : " + error.message);
    return;
  }
  document.getElementById("qcuTitre").value = "";
  await qcuLoad();
}
async function qcuOpen(id){
  const q = window.qcuItems.find(x => x.id === id);
  if(!q) return;
  window.qcuCurrent = q;
  saveEvalNav({view:"qcu",qcuClass:String(q.classe||""),qcuId:q.id});
  document.getElementById("qcuDetail").innerHTML = `
    <section class="hero">
      <h3>${qcuEsc(q.titre)} — ${qcuEsc(q.classe)}</h3>
      <p class="muted">Trimestre ${q.trimestre} · ${q.total_questions} questions</p>
      <input id="qcuSearch" placeholder="Rechercher un élève…" oninput="qcuFilter()">
      <div style="overflow-x:auto">
        <table>
          <thead><tr>
            <th>Élève</th>
            <th>Bonnes réponses / ${q.total_questions}</th>
            <th>Pourcentage</th>
            <th>Note /20</th>
          </tr></thead>
          <tbody id="qcuRows"><tr><td colspan="4">Chargement…</td></tr></tbody>
        </table>
      </div>
      <button class="primary" onclick="qcuSave()">Enregistrer les scores</button>
      <button onclick="document.getElementById('qcuDetail').innerHTML='';window.qcuCurrent=null;saveEvalNav({qcuId:null})">Fermer</button>
    </section>`;
  const {data, error} = await sb.from("Eleves")
    .select("id,classe,nom,prenom")
    .eq("classe", q.classe)
    .order("nom");
  if(error){
    document.getElementById("qcuRows").innerHTML =
      `<tr><td colspan="4">${qcuEsc(error.message)}</td></tr>`;
    return;
  }
  window.qcuCurrentStudents = data || [];
  qcuDrawRows();
}
function qcuDrawRows(){
  const q = window.qcuCurrent;
  const host = document.getElementById("qcuRows");
  if(!host || !q) return;
  host.innerHTML = (window.qcuCurrentStudents || []).map(e => {
    const v = q.resultats?.[e.id];
    const n = v == null ? "" : Number(v);
    return `<tr data-name="${qcuEsc((e.nom+" "+e.prenom).toLowerCase())}">
      <td>${qcuEsc(e.nom+" "+e.prenom)}</td>
      <td><input class="qcuScore" data-id="${e.id}"
        type="number" min="0" max="${q.total_questions}" step="1"
        value="${n}" style="width:100px" oninput="qcuPreview(this)"></td>
      <td class="qcuPct">${n==="" ? "—" : (n/q.total_questions*100).toFixed(1)+" %"}</td>
      <td class="qcuGrade">${n==="" ? "—" : qcuNote(n,q.total_questions).toFixed(2).replace(".",",")}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="4">Aucun élève trouvé dans la table Eleves.</td></tr>';
}
function qcuPreview(input){
  const q = window.qcuCurrent;
  const tr = input.closest("tr");
  const n = Number(input.value);
  if(input.value === "" || !Number.isInteger(n) || n < 0 || n > q.total_questions){
    tr.querySelector(".qcuPct").textContent = "—";
    tr.querySelector(".qcuGrade").textContent = "—";
    return;
  }
  tr.querySelector(".qcuPct").textContent =
    (n/q.total_questions*100).toFixed(1)+" %";
  tr.querySelector(".qcuGrade").textContent =
    qcuNote(n,q.total_questions).toFixed(2).replace(".",",");
}
function qcuFilter(){
  const v = (document.getElementById("qcuSearch")?.value || "").toLowerCase();
  document.querySelectorAll("#qcuRows tr[data-name]").forEach(tr => {
    tr.style.display = tr.dataset.name.includes(v) ? "" : "none";
  });
}
async function qcuSave(){
  const q = window.qcuCurrent;
  if(!q) return;
  const resultats = {...(q.resultats || {})};
  let invalide = false;
  document.querySelectorAll(".qcuScore").forEach(input => {
    if(input.value === ""){
      delete resultats[input.dataset.id];
      return;
    }
    const n = Number(input.value);
    if(!Number.isInteger(n) || n < 0 || n > q.total_questions){
      invalide = true;
    }else{
      resultats[input.dataset.id] = n;
    }
  });
  if(invalide){
    alert("Chaque score doit être un entier compris entre 0 et "+q.total_questions+".");
    return;
  }
  const {error} = await sb.from("qcu_memorisation")
    .update({resultats})
    .eq("id", q.id);
  if(error){
    alert("Enregistrement impossible : "+error.message);
    return;
  }
  q.resultats = resultats;
  alert("Scores enregistrés.");
  qcuRenderAverages();
}
async function qcuDelete(id){
  const q = window.qcuItems.find(x => x.id === id);
  if(!q || !confirm("Supprimer ce QCU et tous ses scores ?")) return;
  const {error} = await sb.from("qcu_memorisation").delete().eq("id", id);
  if(error){
    alert("Suppression impossible : "+error.message);
    return;
  }
  document.getElementById("qcuDetail").innerHTML = "";
  await qcuLoad();
}
function qcuRenderAverages(){
  const host = document.getElementById("qcuAverages");
  if(!host) return;
  const c = window.qcuSelectedClass;
  if(!c){
    host.innerHTML = "";
    return;
  }
  const items = (window.qcuItems || [])
    .filter(q => q.classe === c);
  if(!items.length){
    host.innerHTML = "";
    return;
  }
  host.innerHTML = `
    <details class="hero">
      <summary style="cursor:pointer;font-weight:700">
        📊 Moyennes trimestrielles — ${qcuEsc(c)}
      </summary>

      <p class="muted">
        Moyenne des notes sur 20.
        Les QCU sans score pour un élève ne sont pas comptés.
      </p>

      <label>Trimestre
        <select id="qcuAvgTrim" onchange="qcuDrawAverages()">
          <option value="1">Trimestre 1</option>
          <option value="2">Trimestre 2</option>
          <option value="3">Trimestre 3</option>
        </select>
      </label>

      <div id="qcuAvgRows"></div>
    </details>
  `;
  qcuDrawAverages();
}
function qcuDrawAverages(){
  const host = document.getElementById("qcuAvgRows");
  if(!host) return;
  const c = window.qcuSelectedClass;
if(!c) return;
  const t = Number(document.getElementById("qcuAvgTrim").value);
  const qs = (window.qcuItems || []).filter(q =>
    q.classe === c && Number(trackingPeriodForDate(q.date_qcu).replace("t","")) === t
  );
  if(!qs.length){
    host.innerHTML = '<p class="muted">Aucun QCU pour cette sélection.</p>';
    return;
  }
  const eleves = (window.qcuStudentsAll || []).filter(e => e.classe === c);
  const rows = eleves.map(e => {
    const notes = qs.filter(q => q.resultats?.[e.id] !== undefined)
      .map(q => qcuNote(q.resultats[e.id], q.total_questions));
    return {
      nom:e.nom+" "+e.prenom,
      notes,
      moyenne:notes.length ? notes.reduce((a,b)=>a+b,0)/notes.length : null
    };
  });
  host.innerHTML = `<p>${qs.length} QCU dans ce trimestre.</p>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Élève</th><th>QCU notés</th><th>Moyenne /20</th></tr></thead>
      <tbody>${rows.map(e => `<tr>
        <td>${qcuEsc(e.nom)}</td>
        <td>${e.notes.length} / ${qs.length}</td>
        <td><strong>${e.moyenne===null ? "—" : e.moyenne.toFixed(2).replace(".",",")}</strong></td>
      </tr>`).join("")}</tbody>
    </table></div>`;
}
/* Accueil : tableau de bord de lecture, sans écriture en base */
let pendingDashboardData=null;
let pendingDashboardRequest=0;
async function dashboardReadAll(table,columns){
  const rows=[];let from=0;
  while(true){
    const q=await sb.from(table).select(columns).order('id').range(from,from+499);
    if(q.error)throw new Error(q.error.message);
    const page=q.data||[];rows.push(...page);
    if(page.length<500)break;from+=500;
  }
  return rows;
}
const ABSENCE_TABLE='EvaluationAbsences';
function evaluationScopeKey(ev){
  if(!isHistoricalEvaluation(ev)&&ev.typeEvaluation==='evaluation'&&Number(ev.chapitre)>0)return 'chapter:'+Number(ev.chapitre);
  return ev.evaluationGroupId?'group:'+ev.evaluationGroupId:'evaluation:'+ev.id;
}
function evaluationScopeMembers(ev,evaluations,classe){return evaluations.map(evalNormalize).filter(e=>evaluationScopeKey(e)===evaluationScopeKey(ev)&&evaluationAppliesToClass(e,classe));}
function absenceMatches(a,ev,members,classe){return String(a.classe)===String(classe)&&(a.scope_key===evaluationScopeKey(ev)||members.some(e=>String(a.evaluation_id)===String(e.id)||(e.evaluationGroupId&&a.scope_key==='group:'+e.evaluationGroupId)));}
function evaluationStudentStatus(rows){
  const rank={non_evalue:3,absent:2,rattrapage:1};
  const ordered=rows.filter(a=>rank[a.statut]).slice().sort((a,b)=>String(b.updated_at||b.created_at||'').localeCompare(String(a.updated_at||a.created_at||''))||(rank[b.statut]-rank[a.statut]));
  return ordered[0]?.statut||'';
}
function scopeStudentSummary(ev,members,roster,corrections,absences,classe){
  const ids=new Set(members.map(e=>String(e.id)));
  const report=buildIndicatorReport(members,roster,corrections.filter(c=>ids.has(String(c.evaluation_id))));
  const missingIds=new Set(report.missing.map(st=>String(st.id)));
  const missing=[],absent=[],notEvaluated=[],retake=[],conflicts=[];
  roster.forEach(st=>{
    const matches=absences.filter(a=>String(a.eleve_id)===String(st.id)&&absenceMatches(a,ev,members,classe));
    if(!missingIds.has(String(st.id))){if(matches.length)conflicts.push(st);return;}
    const status=evaluationStudentStatus(matches);
    if(status==='rattrapage')retake.push(st);else if(status==='non_evalue')notEvaluated.push(st);else if(status==='absent')absent.push(st);else missing.push(st);
  });return {done:report.corrected,missing,absent,notEvaluated,retake,conflicts};
}
let absencePanelContext=null,absenceWriteBusy=false;
async function openEvaluationAbsences(evalId,classe){
  if(!correctionAllowLeave())return;
  classe=String(classe||loadEvalNav().classe||'').trim();if(!classe){alert('Sélectionne une classe.');return;}
  document.getElementById('absenceDialog')?.remove();
  const dialog=document.createElement('div');dialog.id='absenceDialog';dialog.className='pp-modal';
  dialog.innerHTML=`<div class="pp-modal-card"><button type="button" onclick="document.getElementById('absenceDialog')?.remove()">Fermer</button><div id="absenceBody" role="status">Chargement…</div></div>`;document.body.appendChild(dialog);
  try{
    const [evaluations,students,corrections,absences]=await Promise.all([dashboardReadAll('Evaluations','id,titre,classe,total,criteres,exercices,created_at'),dashboardReadAll('Eleves','id,classe,nom,prenom'),dashboardReadAll('EvaluationCorrections','id,evaluation_id,eleve,eleve_id,resultat,created_at'),dashboardReadAll(ABSENCE_TABLE,'*')]);
    const ev=evaluations.map(evalNormalize).find(e=>String(e.id)===String(evalId));if(!ev)throw new Error('Évaluation introuvable.');
    const members=evaluationScopeMembers(ev,evaluations,classe),roster=sortStudents(students.filter(st=>String(st.classe).trim()===classe));
    absencePanelContext={ev,members,roster,classe};
    const summary=scopeStudentSummary(ev,members,roster,corrections,absences,classe);
    const corrected=new Set(roster.filter(st=>![...summary.missing,...summary.absent,...summary.notEvaluated,...summary.retake].some(x=>String(x.id)===String(st.id))).map(st=>String(st.id)));
    const host=document.getElementById('absenceBody');if(!host)return;
    host.innerHTML=`<h2>Statuts des élèves — ${esc(classe)} — ${evaluationScopeKey(ev).startsWith('chapter:')?'Chapitre '+esc(ev.chapitre):esc(ev.titre)}</h2><p>Un statut commun à ${members.length} sujet(s), sans création de note. Absent et Non évalué clôturent la situation ; seul Rattrapage à prévoir reste à terminer.</p><div id="absenceSaveMessage" role="status"></div>${roster.map(st=>{
      const rows=absences.filter(a=>String(a.eleve_id)===String(st.id)&&absenceMatches(a,ev,members,classe));
      const savedStatus=evaluationStudentStatus(rows);
      const status=savedStatus==='rattrapage'?'Rattrapage à prévoir':savedStatus==='non_evalue'?'Non évalué — terminé':savedStatus==='absent'?'Absent — terminé':'Sans correction enregistrée';
      return `<div class="pending-row" data-absence-student="${esc(st.id)}"><strong>${esc(studentDisplayName(st))}</strong><p>${corrected.has(String(st.id))?'Corrigé'+(rows.length?' — ancien statut à annuler':''):status}</p>${!corrected.has(String(st.id))?`<button type="button" onclick="setEvaluationAbsence(${jsArg(st.id)},'absent')">Absent</button> <button type="button" onclick="setEvaluationAbsence(${jsArg(st.id)},'non_evalue')">NON ÉVALUÉ</button> <button type="button" onclick="setEvaluationAbsence(${jsArg(st.id)},'rattrapage')">Rattrapage à prévoir</button>`:''}${rows.length?` <button type="button" onclick="setEvaluationAbsence(${jsArg(st.id)},'')">Annuler le statut</button>`:''}</div>`;
    }).join('')}`;
  }catch(e){const host=document.getElementById('absenceBody');if(host)host.innerHTML='<p role="alert">Absences indisponibles : '+esc(e.message)+'</p>';}
}
async function setEvaluationAbsence(studentId,status){
  if(absenceWriteBusy||!absencePanelContext)return;
  const ctx=absencePanelContext,st=ctx.roster.find(s=>String(s.id)===String(studentId));if(!st)return;
  if(!['','absent','non_evalue','rattrapage'].includes(status))return;
  if(!confirm((status?'Enregistrer '+(status==='absent'?'Absent — terminé':status==='non_evalue'?'Non évalué — terminé':'Rattrapage à prévoir'):'Annuler le statut')+' pour '+studentDisplayName(st)+' sur tous les sujets de cette évaluation ?'))return;
  absenceWriteBusy=true;document.querySelectorAll('#absenceDialog button').forEach(b=>b.disabled=true);
  try{
    if(!user?.id)throw new Error('Reconnecte-toi pour enregistrer.');
    if(status){
      const q=await sb.from('EvaluationCorrections').select('id,evaluation_id,eleve,eleve_id,resultat,created_at').in('evaluation_id',ctx.members.map(e=>e.id));if(q.error)throw new Error(q.error.message);
      if(buildIndicatorReport(ctx.ev,[st],q.data||[]).corrected)throw new Error('Une correction existe déjà sur un sujet : aucun statut ajouté.');
      const payload={created_by:user.id,scope_key:evaluationScopeKey(ctx.ev),evaluation_id:String(ctx.ev.id),classe:ctx.classe,eleve_id:String(st.id),statut:status,updated_at:new Date().toISOString()};
      const r=await sb.from(ABSENCE_TABLE).upsert(payload,{onConflict:'created_by,scope_key,classe,eleve_id'}).select('id').single();if(r.error)throw new Error(r.error.message);if(!r.data?.id)throw new Error('Sauvegarde non confirmée.');
      // Remove obsolete per-subject/group statuses only after the new status is confirmed.
      const all=await dashboardReadAll(ABSENCE_TABLE,'*');
      const old=all.filter(a=>String(a.eleve_id)===String(st.id)&&a.id!==r.data.id&&absenceMatches(a,ctx.ev,ctx.members,ctx.classe)).map(a=>a.id);
      if(old.length){const clean=await sb.from(ABSENCE_TABLE).delete().in('id',old);if(clean.error)throw new Error('Statut enregistré, nettoyage des anciens statuts impossible : '+clean.error.message);}
    }else{
      const all=await dashboardReadAll(ABSENCE_TABLE,'*');const ids=all.filter(a=>String(a.eleve_id)===String(st.id)&&absenceMatches(a,ctx.ev,ctx.members,ctx.classe)).map(a=>a.id);
      if(ids.length){const r=await sb.from(ABSENCE_TABLE).delete().in('id',ids);if(r.error)throw new Error(r.error.message);}
    }
    await openEvaluationAbsences(ctx.ev.id,ctx.classe);if(document.getElementById('pendingDashboard'))await loadPendingDashboard();
    if(document.getElementById('copiesBoard'))await copiesBoardRefresh();
  }catch(e){const host=document.getElementById('absenceSaveMessage');if(host)host.textContent=e.message;}
  finally{absenceWriteBusy=false;document.querySelectorAll('#absenceDialog button').forEach(b=>b.disabled=false);}
}
async function correctionCheckAbsences(ctx){
  const [evaluations,absences]=await Promise.all([dashboardReadAll('Evaluations','id,titre,classe,total,criteres,exercices,created_at'),dashboardReadAll(ABSENCE_TABLE,'*')]);
  const ev=evaluations.map(evalNormalize).find(e=>String(e.id)===String(ctx.evalId));if(!ev)throw new Error('Évaluation introuvable.');
  const members=evaluationScopeMembers(ev,evaluations,ctx.classe),ids=(ctx.groupIds.length>1?ctx.groupIds:[ctx.eleveId]).map(String);
  if(absences.some(a=>ids.includes(String(a.eleve_id))&&absenceMatches(a,ev,members,ctx.classe)))throw new Error('Annule le statut Absent, Non évalué ou Rattrapage à prévoir avant d’enregistrer cette correction.');
}
function dashboardBuild(data,selectedClass=''){
  const students=data.students||[];
  const classes=[...new Set(students.map(st=>String(st.classe||'').trim()).filter(Boolean))];
  const evalRows=[],seen=new Set();
  const evaluations=(data.evaluations||[]).map(evalNormalize);
  for(const ev of evaluations){
    for(const cls of classes.filter(c=>(!selectedClass||selectedClass===c)&&evaluationAppliesToClass(ev,c))){
      const key=JSON.stringify([cls,evaluationScopeKey(ev)]);if(seen.has(key))continue;seen.add(key);
      const members=evaluationScopeMembers(ev,evaluations,cls),roster=students.filter(st=>String(st.classe||'').trim()===cls);
      const summary=scopeStudentSummary(ev,members,roster,data.corrections||[],data.absences||[],cls);
      if(summary.missing.length||summary.retake.length)evalRows.push({id:ev.id,title:evaluationScopeKey(ev).startsWith('chapter:')?'Évaluation du chapitre '+ev.chapitre+' — '+members.length+' sujet(s)':ev.titre,classe:cls,total:roster.length,members,...summary});
    }
  }
  const qcuRows=[];
  for(const q of data.qcu||[]){
    const cls=String(q.classe||'').trim();if(selectedClass&&selectedClass!==cls)continue;
    const roster=students.filter(st=>String(st.classe||'').trim()===cls);if(!roster.length)continue;
    let done=0,invalid=0;const missing=[];
    roster.forEach(st=>{
      const v=q.resultats?.[st.id];
      if(v===null||v===undefined||String(v).trim()===''){missing.push(st);return;}
      const score=Number(v);
      if((typeof v==='number'||typeof v==='string')&&Number.isInteger(score)&&score>=0&&score<=Number(q.total_questions)){done++;}
      else{invalid++;missing.push(st);}
    });
    if(missing.length)qcuRows.push({id:q.id,title:q.titre||'QCU',classe:cls,total:roster.length,done,invalid,missing,trimestre:q.trimestre});
  }
  const byId=new Map(students.map(st=>[String(st.id),st]));
  const today=ppToday();
  const actions=(data.actions||[]).filter(a=>{
    const st=byId.get(String(a.eleve_id));const cls=String(a.classe||st?.classe||'').trim();
    return cls==='6e3'&&(!selectedClass||selectedClass===cls)&&String(a.statut||'').toLowerCase()!=='termine';
  }).map(a=>{
    const student=byId.get(String(a.eleve_id));const due=String(a.echeance||'').slice(0,10);
    const dateValid=/^\d{4}-\d{2}-\d{2}$/.test(due);
    return {...a,student,due:dateValid?due:'',timing:!dateValid?'Sans échéance':due<today?'Échéance dépassée':due===today?'À échéance aujourd’hui':'À venir'};
  }).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
  return {evalRows,qcuRows,actions};
}
async function loadPendingDashboard(){
  const host=document.getElementById('pendingDashboard');if(!host)return;
  const request=++pendingDashboardRequest;
  host.innerHTML='<p role="status">Chargement des éléments à terminer…</p>';
  const jobs=[['students','Eleves','id,classe,nom,prenom'],['evaluations','Evaluations','id,titre,classe,total,criteres,exercices,created_at'],['corrections','EvaluationCorrections','id,evaluation_id,eleve,eleve_id,resultat,created_at'],['qcu','qcu_memorisation','id,titre,classe,trimestre,total_questions,resultats'],['actions',PP_TABLES.actions,'*'],['absences',ABSENCE_TABLE,'*']];
  const results=await Promise.allSettled(jobs.map(([,table,columns])=>dashboardReadAll(table,columns)));
  if(request!==pendingDashboardRequest || document.getElementById('pendingDashboard')!==host)return;
  const data={errors:{}};
  results.forEach((r,i)=>{const key=jobs[i][0];if(r.status==='fulfilled')data[key]=r.value;else{data[key]=[];data.errors[key]=r.reason?.message||String(r.reason);}});
  pendingDashboardData=data;renderPendingDashboard();
}
function dashboardNames(students){return `<details><summary style="cursor:pointer">${students.length} élève(s) concerné(s)</summary>${indicatorStudentList(students)}</details>`;}
function renderPendingDashboard(){
  const host=document.getElementById('pendingDashboard'),data=pendingDashboardData;if(!host||!data)return;
  if(data.errors.students){host.innerHTML=`<p role="alert">Liste des élèves indisponible : ${esc(data.errors.students)}</p><button type="button" onclick="loadPendingDashboard()">Réessayer</button>`;return;}
  let cls='';try{cls=localStorage.getItem('SVT_PENDING_CLASS')||'';}catch(e){}
  const classes=[...new Set((data.students||[]).map(st=>String(st.classe||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr',{numeric:true}));
  if(!classes.includes(cls))cls='';
  const summary=dashboardBuild(data,cls);
  const errors=data.errors;
  const error=(keys)=>keys.filter(k=>errors[k]).map(k=>`<p role="alert" style="color:#9d3030">Chargement incomplet : ${esc(errors[k])}. Ce bloc ne peut pas être calculé.</p>`).join('');
  const evalHtml=summary.evalRows.map(r=>`<div class="pending-row"><strong>${esc(r.classe)} — ${esc(r.title)}</strong><p>${r.done} corrigé(s) · ${r.absent.length} absent(s) · ${r.notEvaluated.length} non évalué(s) · ${r.retake.length} rattrapage(s) · ${r.missing.length} sans correction enregistrée — ${r.total} élèves.</p>${dashboardNames(r.missing)}${r.absent.length?`<details><summary>Absents (${r.absent.length})</summary>${indicatorStudentList(r.absent)}</details>`:''}${r.notEvaluated.length?`<details><summary>Non évalués (${r.notEvaluated.length})</summary>${indicatorStudentList(r.notEvaluated)}</details>`:''}${r.retake.length?`<details><summary>Rattrapages à prévoir (${r.retake.length})</summary>${indicatorStudentList(r.retake)}</details>`:''}${r.conflicts.length?`<p role="alert">${r.conflicts.length} élève(s) corrigés ont aussi une absence : annule les anciens statuts concernés.</p>`:''}<div class="row">${r.members.map(e=>`<button type="button" onclick="openCorrection(${jsArg(e.id)},${jsArg(r.classe)})">${esc(e.titre)}</button>`).join('')}<button type="button" onclick="openEvaluationAbsences(${jsArg(r.id)},${jsArg(r.classe)})">Absences / non évalués</button></div></div>`).join('');
  const qcuHtml=summary.qcuRows.map(r=>`<div class="pending-row"><strong>${esc(r.classe)} — ${esc(r.title)}</strong><p>Trimestre ${esc(r.trimestre)} · ${r.done} / ${r.total} scores valides · ${r.missing.length-r.invalid} non renseigné(s)${r.invalid?' · '+r.invalid+' à vérifier':''}.</p>${dashboardNames(r.missing)}<button type="button" onclick="dashboardResumeQCU(${jsArg(r.id)},${jsArg(r.classe)})">Saisir les scores</button></div>`).join('');
  const ppHtml=summary.actions.map(a=>`<div class="pending-row"><strong>${esc(a.action||'Action PP')}</strong><p>${a.student?esc(studentDisplayName(a.student)):'Élève non retrouvé'} · ${esc(a.timing)}${a.due?' — '+esc(a.due.split('-').reverse().join('/')):''}</p>${a.student?`<button type="button" onclick="dashboardResumePP(${jsArg(a.student.id)})">Ouvrir les actions de l’élève</button>`:''}</div>`).join('');
  host.innerHTML=`<div class="entry-head"><div><span class="eyebrow">Reprendre le travail</span><h2 style="margin:5px 0">À terminer</h2></div><button type="button" onclick="loadPendingDashboard()">Actualiser</button></div>
    <label for="pendingClass" style="display:block;margin:12px 0 6px">Classe</label><select id="pendingClass" style="max-width:280px" onchange="try{localStorage.setItem('SVT_PENDING_CLASS',this.value)}catch(e){};renderPendingDashboard()"><option value="">Toutes les classes</option>${classes.map(c=>`<option value="${esc(c)}" ${c===cls?'selected':''}>${esc(c)}</option>`).join('')}</select>
    <p class="small-note">Vue des données enregistrées, avec les effectifs actuels. Une correction ou un score manquant ne signifie pas que l’élève est en retard ou absent. Un score de zéro est compté comme renseigné.</p>
    <details open class="pending-category"><summary>Évaluations${!errors.evaluations&&!errors.corrections&&!errors.absences?' — '+summary.evalRows.length+' à compléter':''}</summary>${error(['evaluations','corrections','absences'])}${errors.evaluations||errors.corrections||errors.absences?'':evalHtml||'<p>Aucune correction manquante pour les classes affichées.</p>'}</details>
    <details class="pending-category"><summary>QCU${!errors.qcu?' — '+summary.qcuRows.length+' à compléter':''}</summary>${error(['qcu'])}${errors.qcu?'':qcuHtml||'<p>Aucun score manquant pour les classes affichées.</p>'}</details>
    <details class="pending-category"><summary>Suivi PP — actions ouvertes (6e3)${!errors.actions?' : '+summary.actions.length:''}</summary>${error(['actions'])}${errors.actions?'':ppHtml||'<p>Aucune action ouverte pour la sélection.</p>'}</details>`;
}
async function dashboardResumeQCU(id,classe){
  try{await openQCU();qcuOpenClass(classe);const q=(window.qcuItems||[]).find(q=>String(q.id)===String(id));if(!q)throw new Error('QCU introuvable.');await qcuOpen(q.id);}catch(e){alert('Ouverture du QCU impossible : '+e.message);}
}
async function dashboardResumePP(id){
  try{await ppLoadStudents();await openPPStudent(id);await ppRenderStudent('actions');}catch(e){alert('Ouverture du suivi PP impossible : '+e.message);}
}
let behaviorTrackingStudentId='';
async function openBehaviorTracking(classe,studentId,period){
  if(!correctionAllowLeave())return;
  if(classe!==undefined)classTrackingClass=String(classe||'');
  if(studentId!==undefined)behaviorTrackingStudentId=String(studentId||'');
  if(period!==undefined)classTrackingPeriod=String(period||'year');
  saveEvalNav({view:'behaviorTracking',classe:classTrackingClass,studentId:behaviorTrackingStudentId,period:classTrackingPeriod});
  label.textContent='Suivi du comportement';
  content.innerHTML='<p role="status">Chargement des élèves et des observations…</p>';
  try{await loadBehaviorStudents();await loadBehaviorEvents();renderBehaviorTracking();}catch(e){showError(e.message);}
}
function renderBehaviorTracking(){
  if(loadEvalNav().view!=='behaviorTracking')return;
  label.textContent='Suivi du comportement';
  const classes=[...new Set([...Object.values(CLASSES).flat(),...behaviorStudentsCache.map(st=>st.classe),...behaviorEventsCache.map(e=>e.classe)].map(c=>String(c||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr',{numeric:true}));
  const roster=behaviorStudentsForClass(classTrackingClass);
  if(behaviorTrackingStudentId&&!roster.some(st=>String(st.id)===behaviorTrackingStudentId))behaviorTrackingStudentId='';
  saveEvalNav({view:'behaviorTracking',classe:classTrackingClass,studentId:behaviorTrackingStudentId,period:classTrackingPeriod});
  const visible=behaviorTrackingStudentId?roster.filter(st=>String(st.id)===behaviorTrackingStudentId):roster;
  const events=behaviorEventsCache.filter(e=>(!classTrackingClass||String(e.classe)===classTrackingClass)&&(!behaviorTrackingStudentId||String(e.studentId)===behaviorTrackingStudentId)&&(classTrackingPeriod==='year'||trackingPeriodMatch(e.date,classTrackingPeriod))).slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  const dashboardRows=visible.map(st=>({student:st,stats:behaviorStudentDashboard(st)}));
  const actionable=dashboardRows.flatMap(({student,stats})=>stats.filter(x=>x.since>=x.threshold).map(x=>({student,...x})));
  const watchlist=dashboardRows.flatMap(({student,stats})=>stats.filter(x=>x.since>=Math.max(1,x.threshold-2)&&x.since<x.threshold).map(x=>({student,...x})));
  const alertItem=(item,urgent)=>`<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;padding:7px 0;border-bottom:1px solid #eee"><div><strong>${esc(item.student.nom)}</strong><div class="small-note">${esc(item.label)} : ${item.since}/${item.threshold}</div></div><span class="small-note" style="font-weight:700;color:${urgent?'#b42318':'#946200'}">${urgent?(item.category==='participation'?'Mention à transmettre':'Mot à envoyer'):'À surveiller'}</span></div>`;
  const notificationPanel=`<section class="hero" style="margin-top:14px"><h3>🔔 Communications à effectuer</h3><p class="small-note">Les alertes restent affichées tant que la communication n'a pas été enregistrée.</p>${actionable.length?`<h4 style="color:#b42318;margin:8px 0">Actions nécessaires (${actionable.length})</h4>${actionable.map(x=>alertItem(x,true)).join('')}`:'<p class="small-note">Aucune communication urgente à effectuer.</p>'}${watchlist.length?`<h4 style="color:#946200;margin:12px 0 6px">À surveiller (${watchlist.length})</h4>${watchlist.map(x=>alertItem(x,false)).join('')}`:''}</section>`;
  const rosterRows=dashboardRows.map(({student:st,stats})=>{
    const counters=stats.map(x=>{
      const sent=!!x.lastMarker&&x.since===0;
      const actionLabel=x.category==='participation'?'Mention déjà transmise':'Mot déjà envoyé';
      const sentLabel=x.category==='participation'?'Mention transmise ✓':'Mot envoyé ✓';
      return `<div class="behavior-counter" style="min-width:180px;padding:8px 10px;border:1px solid #ddd;border-radius:10px"><strong>${esc(x.label)}</strong><div style="font-size:1.15rem;font-weight:700">${x.since} / ${x.threshold} <span class="small-note">· total ${x.total}</span></div>${x.lastMarker?`<div class="small-note">Dernier envoi : ${esc(trackingDate(x.lastMarker.date))}</div>`:''}${x.since>=x.threshold?`<button type="button" class="primary" style="margin-top:6px" onclick="prepareBehaviorMessage(${jsArg(st.id)},${jsArg(x.category)})">${x.category==='participation'?'Préparer une mention':'Préparer le mot'}</button>`:''}<button type="button" style="margin-top:6px" ${sent?'disabled title="Communication déjà enregistrée pour ce cycle"':''} onclick="recordBehaviorMessage(${jsArg(st.id)},${jsArg(x.category)})">${sent?sentLabel:actionLabel}</button></div>`;
    }).join('');
    return `<div class="behavior-roster-row" style="display:block;width:100%;box-sizing:border-box;padding:12px;border-bottom:1px solid #ddd"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;min-width:0"><input type="checkbox" class="behavior-student-check" value="${esc(st.id)}"><strong style="overflow-wrap:anywhere">${esc(st.nom)}</strong><span class="small-note">${behaviorEventsForStudent(st.nom,st.classe,'year',st.id).filter(e=>behaviorCategory(e.type)).length} observation(s) cette année</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0 28px;min-width:0">${counters}</div></div>`;
  }).join('');
  content.innerHTML=`<button type="button" onclick="home()">← Accueil</button>
    <section class="hero" style="margin-top:14px"><span class="eyebrow">Travail et comportement</span><h2>📝 Suivi du comportement</h2><p class="muted">Choisis une classe, puis sélectionne un ou plusieurs élèves pour enregistrer une observation. Ce suivi est distinct des notes.</p>
    <div class="tracking-filters"><div><label for="behaviorClass">Classe</label><select id="behaviorClass" onchange="classTrackingClass=this.value;behaviorTrackingStudentId='';renderBehaviorTracking()"><option value="">Choisir une classe…</option>${classes.map(c=>`<option value="${esc(c)}" ${c===classTrackingClass?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
    <div><label for="behaviorStudent">Élève — filtre facultatif</label><select id="behaviorStudent" onchange="behaviorTrackingStudentId=this.value;renderBehaviorTracking()"><option value="">Toute la classe</option>${roster.map(st=>`<option value="${esc(st.id)}" ${String(st.id)===behaviorTrackingStudentId?'selected':''}>${esc(st.nom)}</option>`).join('')}</select></div>
    <div><label for="behaviorPeriod">Période</label><select id="behaviorPeriod" onchange="classTrackingPeriod=this.value;renderBehaviorTracking()">${[['year','Année'],['t1','Trimestre 1'],['t2','Trimestre 2'],['t3','Trimestre 3']].map(([v,n])=>`<option value="${v}" ${v===classTrackingPeriod?'selected':''}>${n}</option>`).join('')}</select></div></div></section>
    <section class="hero" style="margin-top:14px"><h3>Enregistrer une observation</h3><p class="small-note">Coche les élèves concernés avant de choisir le type d’observation. La date détermine automatiquement le trimestre.</p><div style="max-width:260px;margin:10px 0"><label for="behaviorEventDate">Date de l’observation / de l’envoi</label><input id="behaviorEventDate" type="date" value="${behaviorDateInputValue()}" style="width:100%"></div><div class="row"><button type="button" onclick="toggleAllBehaviorStudents(true)">Tout sélectionner</button><button type="button" onclick="toggleAllBehaviorStudents(false)">Tout désélectionner</button></div>
    <div class="behavior-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">${BEHAVIOR_TYPES.map(m=>`<button type="button" ${!visible.length?'disabled':''} onclick="addBehaviorEventToSelected(${jsArg(m.code)})">${m.icon} ${esc(m.label)}</button>`).join('')}</div>
    ${notificationPanel}
    ${rosterRows||'<p class="muted">Sélectionne une classe disposant d’élèves enregistrés.</p>'}</section>
    <section class="hero" style="margin-top:14px"><h3>Historique — ${events.length} observation(s)</h3>${events.map(e=>{
      const meta=behaviorMeta(e.type),st=behaviorStudentsCache.find(st=>String(st.id)===String(e.studentId));
      return `<div class="behavior-event"><div><strong>${esc(st?.nom||e.student||'Élève')} · ${esc(e.classe)} — ${meta.icon} ${esc(meta.label)}</strong><div class="meta">${esc(trackingDate(e.date))}${e.note?' · '+esc(e.note):''}</div></div><button type="button" class="danger" onclick="deleteBehaviorEvent(${jsArg(e.id)})">Supprimer</button></div>`;
    }).join('')||'<p class="muted">Aucune observation pour cette sélection.</p>'}</section>`;
}
function naturalistIcon(name){
  const paths={"openEvaluations": "<path d=\"M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4zM13 7a3 3 0 0 1 3-3h5v14h-5a3 3 0 0 0-3 3\"/>", "openQCU": "<path d=\"M9 4a3 3 0 0 0-5 3 4 4 0 0 0-1 7 4 4 0 0 0 6 5V4zm6 0a3 3 0 0 1 5 3 4 4 0 0 1 1 7 4 4 0 0 1-6 5V4zM6 9h3M15 14h3\"/>", "openStudentTracking": "<circle cx=\"12\" cy=\"7\" r=\"3\"/><path d=\"M5 21v-2a7 7 0 0 1 14 0v2\"/>", "openClassTracking": "<circle cx=\"9\" cy=\"7\" r=\"3\"/><path d=\"M2 21v-2a7 7 0 0 1 14 0v2M17 4a3 3 0 0 1 0 6M18 14a6 6 0 0 1 4 5v2\"/>", "openBehaviorTracking": "<path d=\"M5 20C1 7 9 2 21 3c0 12-5 18-16 17zM5 20L17 7M10 15v-5M10 15h5\"/>", "openPP": "<rect x=\"5\" y=\"5\" width=\"14\" height=\"16\" rx=\"2\"/><rect x=\"9\" y=\"3\" width=\"6\" height=\"4\" rx=\"1\"/><path d=\"M9 12h6M9 16h6\"/>", "openBanks": "<path d=\"M3 9l9-6 9 6M5 10v9M12 10v9M19 10v9M3 21h18\"/>"};
  return '<span class="natural-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+(paths[name]||paths.openBehaviorTracking)+'</svg></span>';
}
function openNotebookEditor(){
  if(window.__savingCorrection){alert("Enregistrement en cours. Attends sa fin avant d’ouvrir le cahier.");return false;}
  if(!correctionAllowLeave())return false;
  window.location.href='prof.html';
  return true;
}
async function home(){
  if(!correctionAllowLeave())return;
  saveEvalNav({view:'home'});label.textContent='Évaluations et suivi';
  const card=(fn,tag,title,description)=>`<article class="card"><span class="tag">${tag}</span><h3 class="natural-card-title">${naturalistIcon(fn)}<span>${title.replace(/^\S+\s+/,'')}</span></h3><p class="muted">${description}</p><button type="button" class="primary" onclick="${fn}()">Ouvrir</button></article>`;
  content.innerHTML=`<section class="hero home-intro natural-welcome"><div class="welcome-copy"><span class="eyebrow">SVT · Espace professeur</span><h2>Évaluations et suivi des élèves</h2><p class="muted">Tes outils pour évaluer les acquis, observer les progrès et accompagner chaque élève.</p><p class="welcome-caption">Observer · Comprendre · Transmettre</p></div><figure class="welcome-emblem" aria-hidden="true"><img src="data:image/webp;base64,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" alt="" width="144" height="144" decoding="async"></figure></section>
  <section aria-labelledby="homeEvaluate"><h2 id="homeEvaluate">Évaluer</h2><div class="grid">
  ${card('openEvaluations','Évaluations','📝 Mes évaluations','Chapitres, sujets, corrections, absences et élèves non évalués.')}
  </div></section>
  <section aria-labelledby="homeFollow" style="margin-top:24px"><h2 id="homeFollow">Suivre</h2><div class="grid">
  ${card('openStudentTracking','Suivi individuel','👤 Suivi d’un élève','Résultats, compétences, progression et historique des évaluations.')}
  ${card('openClassTracking','Suivi collectif','🏫 Suivi de classe','Moyennes, résultats et maîtrise des compétences de la classe.')}
  ${card('openBehaviorTracking','Observations','📝 Suivi du comportement','Observations individuelles ou collectives et historique par période.')}
  ${card('openPP','Professeur principal','📋 Suivi PP','Familles, aménagements, actions et conseils de classe.')}</div></section>
  <section aria-labelledby="homeManage" style="margin-top:24px"><h2 id="homeManage">Gérer</h2><div class="grid">
  ${card('openBanks','Banques','👥 Élèves & compétences','Gérer les élèves, leurs classes et le référentiel de compétences.')}</div></section>
  <section class="hero" id="pendingDashboard" style="margin-top:24px"></section>`;
  await loadPendingDashboard();
}
async function restoreLastPosition(){
  if(!correctionAllowLeave())return;
  try{
    const en=JSON.parse(localStorage.getItem(EVAL_NAV_KEY)||"null");
    if(en?.view){
      if(en.view==='behaviorTracking'){await openBehaviorTracking(en.classe||'',en.studentId||'',en.period||'year');return;}
      if(en.view==="indicatorReport"&&en.evaluationId){await openIndicatorReport(en.evaluationId,en.classe||"");return;}
      if(en.view==="home"){await home();return;}
      if(en.view==="banks"){await openBanks();return;}
      if(en.view==="qcu"){
        await openQCU();
        if(en.qcuClass)qcuOpenClass(en.qcuClass);
        if(en.qcuId){const item=(window.qcuItems||[]).find(q=>String(q.id)===String(en.qcuId));if(item)await qcuOpen(item.id);}
        const trim=document.getElementById("qcuAvgTrim");
        if(trim && en.qcuAvgTrim){trim.value=en.qcuAvgTrim;qcuDrawAverages();}
        return;
      }
      if(en.view==="ppCouncil"){ppClass=en.classe||"6e3";ppPeriod=en.period||"year";await ppLoadStudents();await openPPCouncil();return;}
      if(en.view==="pp"){ppClass="6e3";ppPeriod=en.period||"year";await openPP();return;}
      if(en.view==="ppStudent"&&en.id){ppPeriod=en.period||"year";await ppLoadStudents();await openPPStudent(en.id);if(en.ppTab && en.ppTab!=="synthese")await ppRenderStudent(en.ppTab);return;}
      if(en.view==="list"){await openEvaluations({classe:en.classe||""});return;}
      if(en.view==="editor"){
        const editorId=en.evaluationId||en.id||null;
        if(editorId){const all=await loadEvaluations();const ev=all.find(x=>String(x.id)===String(editorId));if(ev){editEvaluationObject(ev);return;}}
        if(en.draft){editEvaluationObject(en.draft);return;}
      }
      if(en.view==="correction"){
        const correctionEvalId=en.evaluationId||en.id||null;
        if(correctionEvalId){await openCorrection(correctionEvalId);return;}
      }
      if(en.view==="studentCorrection"){
        const correctionEvalId=en.evaluationId||en.evalId||null;
        if(correctionEvalId){
          let corr={eleve:en.eleve||"Élève",eleve_id:en.eleveId||"",resultat:{points:{},note:0,criteriaStats:{}}};
          if(en.correctionId){
            const q=await sb.from("EvaluationCorrections").select("id,eleve,eleve_id,resultat").eq("id",en.correctionId).maybeSingle();
            if(q.error)throw new Error(q.error.message);
            if(q.data)corr=q.data;
          }
          await renderCorrectionEditor(correctionEvalId,en.correctionId||null,corr,en.groupIds||[]);
          return;
        }
      }
      if(en.view==="tracking"){studentTrackingClass=en.classe||"";studentTrackingStudent=en.student||"";studentTrackingStudentId=en.studentId||"";studentTrackingPeriod=en.period||"year";await openStudentTracking();return;}
      if(en.view==="classTracking"){classTrackingClass=en.classe||"";classTrackingPeriod=en.period||"year";await openClassTracking();return;}
    }
  }catch(e){}
  home();
}
function captureNavigationFilters(){
  const nav=loadEvalNav();
  if(nav.view==="qcu"){
    const trim=document.getElementById("qcuAvgTrim");
    if(trim)saveEvalNav({qcuAvgTrim:trim.value});
  }
  if(nav.view==="ppCouncil"){
    const period=document.getElementById("ppCouncilPeriod");
    if(period)saveEvalNav({period:String(period.value||"T1").toLowerCase()});
  }
}
// Exposition explicite des actions d'export PDF utilisées par les boutons HTML.
window.generateCorrectionPDF = generateCorrectionPDF;
window.exportStudentTrackingPDF = exportStudentTrackingPDF;
window.openChapterStudentGrids = openChapterStudentGrids;
window.exportChapterStudentGrids = exportChapterStudentGrids;
window.printAllCorrectionGrids = printAllCorrectionGrids;

document.addEventListener("change",captureNavigationFilters);
window.addEventListener("pagehide",captureNavigationFilters);
init();



// Appréciations locales : rédaction déterministe, sans service externe.
function svtAppNumber(value){
  return value === null || value === undefined || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
}
function svtAppPick(seed, key, choices){
  let h=2166136261;
  for(const c of String(seed)+'|'+key) h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;
  return choices[h%choices.length];
}
function svtAppCompose(data){
 const avg=svtAppNumber(data.average),name=String(data.name||'').trim();
 const level=avg===null?null:avg>=18?'excellent':avg>=16?'très bon':avg>=12?'bon':avg>=10?'correct':avg>=6?'fragile':'inquiétant';
 const term=level==='excellent'?'un excellent trimestre':['fragile','inquiétant'].includes(level)?`un trimestre ${level}`:`un ${level} trimestre`;
 const opening=level?(name?`${name} réalise ${term}.`:`Bilan ${level}.`):'Les résultats disponibles ne permettent pas encore de situer le trimestre.';
 const values=(data.competencies||[]).map(x=>svtAppNumber(x.average)).filter(x=>x!==null&&x>=1&&x<=4);
 const mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
 const low=values.filter(x=>x<2.5).length;
 const limited=values.length&&mean>=2.7&&low/values.length<=1/3&&!values.some(x=>x<1.5);
 const adapted=!!data.accommodations;
 let mastery='Les compétences ne sont pas encore renseignées.',compact='Compétences non renseignées.';
 if(values.length){
   const context=adapted?'Avec les aménagements mis en place, ':'Dans l’ensemble, ';
   if(values.every(x=>x>=3.5)) {mastery=context+'les compétences évaluées sont très bien maîtrisées.';compact=mastery;}
   else if(mean>=2.7&&!low){mastery=context+'les compétences évaluées sont bien maîtrisées.';compact=mastery;}
   else if(mean>=2.7&&limited){mastery=context+'les compétences sont globalement maîtrisées, avec quelques points à consolider.';compact=context+'les acquis sont satisfaisants, mais encore inégaux.';}
   else if(mean>=2.7){mastery=context+'les compétences sont globalement maîtrisées, mais certaines difficultés persistent.';compact=context+'la maîtrise des compétences reste inégale.';}
   else if(mean>=2){mastery=context+'la maîtrise des compétences reste inégale.';compact=mastery;}
   else {mastery=context+'la maîtrise des compétences reste à consolider.';compact=mastery;}
 }else if(adapted){mastery='Avec les aménagements mis en place, la maîtrise des compétences reste à évaluer.';compact=mastery;}
 const counts={};
 for(const e of data.events||[]){const t=String(e.type||'');if(t.startsWith('message_envoye')||t.startsWith('mention_envoyee'))continue;counts[t]=(counts[t]||0)+1;}
 const p=counts.participation||0;
 const participation=p>=3?'La participation en classe est bonne.':p===0?'Une participation plus active en classe est attendue.':'';
 const actions=[];
 if((counts.bavardage||0)>=2)actions.push('limiter les bavardages');
 if((counts.travail_non_fait||0)+(counts.devoir_oublie||0)>=2)actions.push('réaliser régulièrement les travaux demandés');
 if((counts.manque_ecoute||0)>=2||(counts.non_respect_consignes||0)>=2)actions.push('mieux suivre les consignes');
 if((counts.oubli_materiel||0)>=3)actions.push('apporter le matériel nécessaire');
 const join=x=>x.length<2?x.join(''):x.slice(0,-1).join(', ')+' et '+x[x.length-1];
 const effort=(counts.effort_progres||0)>0?'Les efforts et les progrès observés sont encourageants.':'';
 let advice,shortAdvice;
 if(actions.length){advice=`Il faudra toutefois ${join(actions)} pour mieux profiter des activités.`;shortAdvice=`Il faudra ${join(actions)}.`;}
 else if(avg!==null&&avg>=16&&limited&&(svtAppNumber(data.qcuAverage)===null||Number(data.qcuAverage)>=10)){
 advice=low?'Félicitations pour ce bilan ; la poursuite des entraînements permettra d’affiner encore cette maîtrise.':'Félicitations pour ce bilan ; cette dynamique est à poursuivre.';
 shortAdvice=low?'Ce très bon bilan est à poursuivre en affinant les acquis.':advice;
 }else if(low){advice=avg!==null&&avg>=16?'Malgré ces très bons résultats, un entraînement ciblé reste nécessaire pour surmonter les difficultés identifiées.':svtAppPick(data.seed||'','advice',['Des entraînements ciblés aideront à dépasser les difficultés restantes.','Pour progresser, il faudra reprendre les exercices corrigés et s’entraîner à mobiliser les notions.']);shortAdvice='Des entraînements ciblés aideront à dépasser les difficultés restantes.';}
 else if(svtAppNumber(data.qcuAverage)!==null&&Number(data.qcuAverage)<10){advice='Des révisions espacées aideront à mieux mémoriser les connaissances.';shortAdvice=advice;}
 else if(avg===null&&!values.length){advice='De nouvelles évaluations permettront de préciser le bilan.';shortAdvice=advice;}
 else {advice=avg!==null&&avg>=16?'Ces très bons résultats sont à maintenir au prochain trimestre.':'La poursuite des entraînements permettra de renforcer les acquis.';shortAdvice=advice;}
 const assemble=parts=>parts.filter(Boolean).join(' ');
 for(const parts of [[opening,mastery,participation,effort,advice],[opening,compact,participation,shortAdvice],[level?`Bilan ${level}.`:'Résultats encore incomplets.',compact,participation,shortAdvice]]){const result=assemble(parts);if(result.length<=400)return result;}
 return assemble([compact,participation,shortAdvice]);
}

function svtAppData(rows,qcuRows,events,seed,name,classe){
  const summaries=trackingSummary(rows).competencySummaries;
  const scored=(qcuRows||[]).filter(q=>q&&q.hasScore&&svtAppNumber(q.score)!==null);
  return {seed,name,average:studentTrackingScienceAverageDetails(rows,scored,classe).final,competencies:summaries,events,
    qcuAverage:studentTrackingQCUOverallAverage(scored)};
}
// Points d’entrée existants conservés : aucune modification des sauvegardes.
function behaviorGenerateAppreciation(events,competencySummaries,rows,qcuRows){
  const student=studentsCache.find(s=>String(s.id)===String(studentTrackingStudentId));
  const name=student?.prenom||'';
  const data=svtAppData(rows||[],qcuRows||[],events||[],String(studentTrackingStudentId||studentTrackingStudent)+'|'+studentTrackingPeriod,name,studentTrackingClass);
  data.competencies=competencySummaries||[];
  data.accommodations=svtAccommodationEnabled(studentTrackingStudentId);
  return svtAppCompose(data);
}
function generateClassAppreciation(student){
  const source=studentsCache.find(s=>String(s.id)===String(student?.id))||student;
  const rows=appreciationStudentRows(source);
  const qcu=studentTrackingQCURowsFor(source.id,source.classe,classTrackingPeriod,studentDisplayName(source));
  const events=behaviorEventsForStudent(studentDisplayName(source),source.classe,classTrackingPeriod,source.id);
  return svtAppCompose({...svtAppData(rows,qcu,events,String(source.id)+'|'+classTrackingPeriod,String(source.prenom||'').trim(),source.classe),accommodations:svtAccommodationEnabled(source.id)});
}


// Choix local, séparé des textes enregistrés et des données médicales.
function svtAccommodationKey(studentId){return 'svt.appreciation.accommodations.v1:'+String(user?.id||'')+':'+String(studentId||'');}
function svtAccommodationEnabled(studentId){if(!studentId)return false;try{return localStorage.getItem(svtAccommodationKey(studentId))==='1';}catch(e){return false;}}
function svtAccommodationControl(studentId){
 if(!studentId)return '';
 return `<label class="appreciation-option"><input type="checkbox" data-svt-accommodation="${esc(studentId)}" ${svtAccommodationEnabled(studentId)?'checked':''}><span>Mentionner les aménagements dans l’appréciation</span></label>`;
}
document.addEventListener('change',function(event){
 const el=event.target;
 if(!el?.matches?.('input[data-svt-accommodation]'))return;
 const id=el.dataset.svtAccommodation;
 try{
   localStorage.setItem(svtAccommodationKey(id),el.checked?'1':'0');
   document.querySelectorAll('input[data-svt-accommodation]').forEach(other=>{if(other.dataset.svtAccommodation===id)other.checked=el.checked;});
 }catch(error){el.checked=!el.checked;alert('Impossible de mémoriser le choix sur ce navigateur.');}
});
