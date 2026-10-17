(async function () {
  if (!window.supabase || typeof SUPABASE_URL === "undefined") return;

  const ASSIGN_TABLE = "EvaluationSubjectAssignments";

  function esc(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function addAssignButton() {
    const nav = document.querySelector(".workspace-actions");
    if (!nav || document.getElementById("subjectAssignBtn")) return;

    const btn = document.createElement("button");
    btn.id = "subjectAssignBtn";
    btn.type = "button";
    btn.textContent = "Attribuer les sujets";
    btn.onclick = openSubjectAssignments;

    const first = nav.querySelector("button");
    nav.insertBefore(btn, first);
  }

  async function loadChapterSubjects(classe, chapitre) {
    const { data, error } = await sb
      .from("Evaluations")
      .select("id, titre, chapitre, classe, total, createdat")
      .eq("classe", classe)
      .eq("chapitre", Number(chapitre))
      .order("titre", { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  }

  async function loadStudents(classe) {
    const { data, error } = await sb
      .from("Eleves")
      .select("id, nom, prenom, classe")
      .eq("classe", classe)
      .order("nom", { ascending: true })
      .order("prenom", { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  }

  async function loadAssignments(classe, chapitre) {
    const { data, error } = await sb
      .from(ASSIGN_TABLE)
      .select("id, eleve_id, evaluation_id")
      .eq("classe", classe)
      .eq("chapitre", Number(chapitre));

    if (error) throw new Error(error.message);
    return data || [];
  }

  async function openSubjectAssignments() {
    const content = document.getElementById("content");
    const label = document.getElementById("label");
    if (!content || !label) return;

    label.textContent = "Attribution des sujets";

    const classes = ["6e1", "6e2", "6e3", "6e4", "6e5", "5e1", "5e3", "5e5", "3e2", "3e3"];

    content.innerHTML = `
      <button type="button" onclick="home()">Accueil</button>
      <section class="hero" style="margin-top:14px;">
        <span class="eyebrow">Évaluations</span>
        <h2>Attribuer les sujets</h2>
        <p class="muted">
          Choisis une classe et un chapitre, puis attribue à chaque élève le sujet qu’il doit traiter.
          Un élève peut avoir un sujet aménagé.
        </p>

        <div class="editbox">
          <label>Classe</label>
          <select id="assignClass">
            ${classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
          </select>

          <label style="margin-top:10px;">Chapitre</label>
          <input id="assignChapitre" type="number" min="1" step="1" value="1">

          <button id="assignLoadBtn" class="primary" style="margin-top:10px;">
            Charger les élèves et les sujets
          </button>
        </div>

        <div id="assignResult" style="margin-top:18px;"></div>
      </section>
    `;

    document.getElementById("assignLoadBtn").onclick = loadAssignmentEditor;
  }

  async function loadAssignmentEditor() {
    const host = document.getElementById("assignResult");
    const classe = document.getElementById("assignClass").value.trim();
    const chapitre = Number(document.getElementById("assignChapitre").value);

    if (!classe || !Number.isInteger(chapitre) || chapitre < 1) {
      host.innerHTML = `<p class="status">Choisis une classe et un numéro de chapitre.</p>`;
      return;
    }

    host.innerHTML = `<p class="muted">Chargement…</p>`;

    try {
      const [subjects, students, assignments] = await Promise.all([
        loadChapterSubjects(classe, chapitre),
        loadStudents(classe),
        loadAssignments(classe, chapitre)
      ]);

      if (!subjects.length) {
        host.innerHTML = `
          <p class="status">Aucun sujet trouvé pour la classe ${esc(classe)} et le chapitre ${esc(chapitre)}.</p>
        `;
        return;
      }

      if (!students.length) {
        host.innerHTML = `<p class="status">Aucun élève trouvé dans la classe ${esc(classe)}.</p>`;
        return;
      }

      const assignmentByStudent = new Map(
        assignments.map(a => [String(a.eleve_id), String(a.evaluation_id)])
      );

      host.innerHTML = `
        <div class="editbox">
          <p class="small-note">
            ${subjects.length} sujet(s) disponible(s) pour ${students.length} élève(s).
          </p>

          <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;">
              <thead>
                <tr>
                  <th>Élève</th>
                  <th>Sujet attribué</th>
                </tr>
              </thead>
              <tbody>
                ${students.map(s => {
                  const current = assignmentByStudent.get(String(s.id)) || "";
                  return `
                    <tr>
                      <td><strong>${esc(s.nom)} ${esc(s.prenom)}</strong></td>
                      <td>
                        <select class="assignment-select" data-eleve-id="${esc(s.id)}">
                          <option value="">Aucun sujet</option>
                          ${subjects.map(e => `
                            <option value="${esc(e.id)}" ${String(e.id) === current ? "selected" : ""}>
                              ${esc(e.titre)}
                            </option>
                          `).join("")}
                        </select>
                      </td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>

          <button id="assignSaveBtn" class="primary" style="margin-top:14px;">
            Enregistrer les attributions
          </button>

          <div id="assignSaveStatus" class="status" style="margin-top:10px;"></div>
        </div>
      `;

      document.getElementById("assignSaveBtn").onclick = () =>
        saveAssignments(classe, chapitre, subjects);

    } catch (e) {
      host.innerHTML = `
        <p class="status">Chargement impossible : ${esc(e.message)}</p>
      `;
    }
  }

  async function saveAssignments(classe, chapitre, subjects) {
    const status = document.getElementById("assignSaveStatus");
    const button = document.getElementById("assignSaveBtn");
    const selects = [...document.querySelectorAll(".assignment-select")];

    const subjectIds = new Set(subjects.map(s => String(s.id)));
    const rows = [];

    selects.forEach(select => {
      const evaluationId = select.value.trim();
      if (!evaluationId || !subjectIds.has(evaluationId)) return;

      rows.push({
        chapitre: Number(chapitre),
        classe,
        eleve_id: select.dataset.eleveId,
        evaluation_id: Number(evaluationId)
      });
    });

    if (!rows.length) {
      status.textContent = "Aucune attribution à enregistrer.";
      return;
    }

    button.disabled = true;
    status.textContent = "Enregistrement…";

    try {
      const { error } = await sb
        .from(ASSIGN_TABLE)
        .upsert(rows, {
          onConflict: "created_by,chapitre,classe,eleve_id"
        });

      if (error) throw new Error(error.message);

      status.textContent = "Attributions enregistrées.";
    } catch (e) {
      status.textContent = "Enregistrement impossible : " + e.message;
    } finally {
      button.disabled = false;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addAssignButton);
  } else {
    addAssignButton();
  }
})();
