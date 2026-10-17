(async function () {
  if (!window.supabase || typeof SUPABASE_URL === "undefined") return;

  const ASSIGN_TABLE = "EvaluationSubjectAssignments";
  let loadRequestId = 0;

  function esc(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function typeLabel(type) {
    if (type === "activite") return "Activité";
    if (type === "exercice") return "Exercice";
    return "Évaluation de chapitre";
  }

  // Doit correspondre aux identifiants attribués en base lors de la migration.
  function getWorkId(subject) {
    return String(subject.evaluationGroupId || `evaluation_${subject.id}`);
  }

  function getWorkTitle(subjects, type) {
    const titles = subjects
      .map(s => String(s.titre || "Sujet sans titre").trim())
      .map(t => t
        .replace(/\s*[—–-]\s*sujet aménagé\s*$/i, "")
        .replace(/\s*:\s*sujet\s*\d+\s*$/i, "")
        .trim());
    const unique = [...new Set(titles)];
    if (unique.length === 1) return unique[0];
    if (subjects.length === 1) return titles[0] || "Travail sans titre";
    return `${typeLabel(type)} — ${subjects.length} versions`;
  }

  function assignmentWorkId(assignment, subjects) {
    // Une ancienne attribution peut encore porter evaluation_<id> alors que
    // ce sujet vient d'être rattaché à un groupe. Dans ce cas, on la rattache
    // au groupe du sujet plutôt que de créer une colonne orpheline.
    const assignedSubject = subjects.find(subject =>
      String(subject.id) === String(assignment.evaluation_id)
    );
    return assignedSubject
      ? getWorkId(assignedSubject)
      : String(assignment.travail_id || `evaluation_${assignment.evaluation_id}`);
  }

  function buildWorkGroups(subjects, assignments) {
    const byId = new Map();
    subjects.forEach(subject => {
      const id = getWorkId(subject);
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          type: String(subject.typeEvaluation || "evaluation"),
          subjects: [],
          title: ""
        });
      }
      byId.get(id).subjects.push(subject);
    });

    // Conserve les attributions réellement indisponibles, mais ne recrée pas
    // un ancien travail individuel si son sujet appartient maintenant à un groupe.
    assignments.forEach(assignment => {
      const id = assignmentWorkId(assignment, subjects);
      const subjectStillAvailable = subjects.some(subject =>
        String(subject.id) === String(assignment.evaluation_id)
      );
      if (!byId.has(id) && !subjectStillAvailable) {
        byId.set(id, {
          id,
          type: "evaluation",
          subjects: [],
          title: `Travail enregistré — sujet indisponible (ID ${assignment.evaluation_id})`
        });
      }
    });

    const typeOrder = { evaluation: 0, activite: 1, exercice: 2 };
    return [...byId.values()]
      .map(group => ({
        ...group,
        subjects: group.subjects.sort((a, b) =>
          String(a.titre || "").localeCompare(String(b.titre || ""), "fr", {
            numeric: true,
            sensitivity: "base"
          })
        ),
        title: group.title || getWorkTitle(group.subjects, group.type)
      }))
      .sort((a, b) =>
        (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9) ||
        a.title.localeCompare(b.title, "fr", { numeric: true, sensitivity: "base" })
      );
  }

  function assignmentKey(studentId, workId) {
    return `${String(studentId)}::${String(workId)}`;
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
    const evaluations = await loadEvaluations();
    const selectedClass = String(classe).trim();
    const chapterNumber = Number(chapitre);

    return evaluations
      .filter(ev =>
        evaluationAppliesToClass(ev, selectedClass) &&
        Number(ev.chapitre) === chapterNumber &&
        ["evaluation", "activite", "exercice"].includes(String(ev.typeEvaluation || "evaluation")) &&
        !isHistoricalEvaluation(ev)
      )
      .sort((a, b) =>
        String(a.titre || "").localeCompare(
          String(b.titre || ""),
          "fr",
          { numeric: true, sensitivity: "base" }
        )
      );
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
      .select("id, eleve_id, evaluation_id, travail_id")
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
          Choisis une classe et un chapitre. Chaque travail possède son propre sélecteur par élève :
          évaluation, activité ou exercice. Les versions d'un même travail sont regroupées.
        </p>

        <div class="editbox">
          <label for="assignClass">Classe</label>
          <select id="assignClass">
            ${classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
          </select>

          <label for="assignChapitre" style="margin-top:10px;">Chapitre</label>
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
    const classSelect = document.getElementById("assignClass");
    const chapterInput = document.getElementById("assignChapitre");
    if (!host || !classSelect || !chapterInput) return;

    const requestId = ++loadRequestId;
    const classe = classSelect.value.trim();
    const chapitre = Number(chapterInput.value);

    if (!classe || !Number.isInteger(chapitre) || chapitre < 1) {
      host.innerHTML = `<p class="status">Choisis une classe et un numéro de chapitre valide.</p>`;
      return;
    }

    host.innerHTML = `<p class="muted">Chargement…</p>`;

    try {
      const [subjects, students, assignments] = await Promise.all([
        loadChapterSubjects(classe, chapitre),
        loadStudents(classe),
        loadAssignments(classe, chapitre)
      ]);
      if (requestId !== loadRequestId) return;

      if (!students.length) {
        host.innerHTML = `<p class="status">Aucun élève trouvé dans la classe ${esc(classe)}.</p>`;
        return;
      }

      const workGroups = buildWorkGroups(subjects, assignments);
      if (!workGroups.length) {
        host.innerHTML = `<p class="status">Aucun travail ni aucune attribution trouvés pour la classe ${esc(classe)} et le chapitre ${esc(chapitre)}.</p>`;
        return;
      }

      const assignmentByStudentWork = new Map();
      assignments.forEach(a => {
        const key = assignmentKey(a.eleve_id, assignmentWorkId(a, subjects));
        // Si d'anciennes lignes existent pour plusieurs versions d'un même
        // travail, privilégie une attribution dont le sujet est disponible.
        const previous = assignmentByStudentWork.get(key);
        const available = subjects.some(subject => String(subject.id) === String(a.evaluation_id));
        const previousAvailable = previous && subjects.some(subject => String(subject.id) === String(previous.evaluation_id));
        if (!previous || (available && !previousAvailable)) assignmentByStudentWork.set(key, a);
      });

      host.innerHTML = `
        <div class="editbox">
          <p class="small-note">
            ${workGroups.length} travail(aux), ${subjects.length} sujet(s) disponible(s),
            ${students.length} élève(s). « Aucun sujet » retire uniquement l'attribution de ce travail.
          </p>
          <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%; min-width:760px;">
              <thead>
                <tr>
                  <th>Élève</th>
                  ${workGroups.map(group => `
                    <th>${esc(typeLabel(group.type))}<br><span class="small-note">${esc(group.title)}</span></th>
                  `).join("")}
                </tr>
              </thead>
              <tbody>
                ${students.map(student => `
                  <tr>
                    <td><strong>${esc(student.nom)} ${esc(student.prenom)}</strong></td>
                    ${workGroups.map(group => {
                      const current = assignmentByStudentWork.get(assignmentKey(student.id, group.id));
                      const currentId = current ? String(current.evaluation_id) : "";
                      const currentAvailable = group.subjects.some(subject => String(subject.id) === currentId);
                      return `
                        <td>
                          <select
                            class="assignment-select"
                            data-eleve-id="${esc(student.id)}"
                            data-work-id="${esc(group.id)}"
                            aria-label="${esc(typeLabel(group.type) + " — " + group.title + " — " + student.nom + " " + student.prenom)}"
                          >
                            <option value="">Aucun sujet</option>
                            ${current && !currentAvailable ? `<option value="${esc(currentId)}" selected>Sujet actuellement attribué indisponible (ID ${esc(currentId)})</option>` : ""}
                            ${group.subjects.map(subject => `
                              <option value="${esc(subject.id)}" ${String(subject.id) === currentId ? "selected" : ""}>
                                ${esc(subject.titre)}
                              </option>
                            `).join("")}
                          </select>
                        </td>
                      `;
                    }).join("")}
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <button id="assignSaveBtn" class="primary" style="margin-top:14px;">
            Enregistrer les attributions
          </button>
          <div id="assignSaveStatus" class="status" style="margin-top:10px;" role="status" aria-live="polite"></div>
        </div>
      `;

      const saveButton = document.getElementById("assignSaveBtn");
      saveButton.onclick = () => saveAssignments(classe, chapitre, workGroups, assignments);
    } catch (e) {
      if (requestId !== loadRequestId) return;
      host.innerHTML = `<p class="status">Chargement impossible : ${esc(e.message)}</p>`;
    }
  }

  async function saveAssignments(classe, chapitre, workGroups, loadedAssignments) {
    const status = document.getElementById("assignSaveStatus");
    const button = document.getElementById("assignSaveBtn");
    if (!status || !button) return;

    const selects = [...document.querySelectorAll(".assignment-select")];
    const subjectByWorkAndId = new Map();
    workGroups.forEach(group => {
      group.subjects.forEach(subject => {
        subjectByWorkAndId.set(`${group.id}::${String(subject.id)}`, subject);
      });
    });

    const currentByKey = new Map();
    loadedAssignments.forEach(a => {
      const key = assignmentKey(a.eleve_id, assignmentWorkId(a, workGroups.flatMap(g => g.subjects)));
      const previous = currentByKey.get(key);
      const allSubjects = workGroups.flatMap(g => g.subjects);
      const available = allSubjects.some(subject => String(subject.id) === String(a.evaluation_id));
      const previousAvailable = previous && allSubjects.some(subject => String(subject.id) === String(previous.evaluation_id));
      if (!previous || (available && !previousAvailable)) currentByKey.set(key, a);
    });
    const upsertRows = [];
    const deletes = [];
    const expected = [];

    for (const select of selects) {
      const studentId = select.dataset.eleveId;
      const workId = select.dataset.workId;
      const selectedId = String(select.value || "").trim();
      const key = assignmentKey(studentId, workId);
      const current = currentByKey.get(key);
      const currentId = current ? String(current.evaluation_id) : "";

      if (selectedId === currentId) continue;

      if (!selectedId) {
        if (current) deletes.push(current);
        expected.push({ key, evaluationId: "" });
        continue;
      }

      const subject = subjectByWorkAndId.get(`${workId}::${selectedId}`);
      if (!subject) {
        // Un sujet indisponible déjà attribué est conservé tant que l'utilisateur ne le retire pas.
        status.textContent = "Enregistrement annulé : un sujet sélectionné n'appartient pas au travail affiché.";
        return;
      }

      upsertRows.push({
        chapitre: Number(chapitre),
        classe,
        eleve_id: studentId,
        evaluation_id: Number(subject.id),
        travail_id: workId
      });
      expected.push({ key, evaluationId: String(subject.id) });
    }

    if (!upsertRows.length && !deletes.length) {
      status.textContent = "Aucune modification à enregistrer.";
      return;
    }

    button.disabled = true;
    status.textContent = "Enregistrement et vérification…";
    let upsertsCompleted = false;
    let deletesCompleted = false;

    try {
      if (upsertRows.length) {
        const { error } = await sb
          .from(ASSIGN_TABLE)
          .upsert(upsertRows, {
            onConflict: "created_by,chapitre,classe,eleve_id,travail_id"
          });
        if (error) throw new Error("Enregistrement des sujets impossible : " + error.message);
      }
      upsertsCompleted = true;

      for (const assignment of deletes) {
        const { error } = await sb
          .from(ASSIGN_TABLE)
          .delete()
          .eq("id", assignment.id)
          .eq("classe", classe)
          .eq("chapitre", Number(chapitre))
          .eq("travail_id", assignment.travail_id);
        if (error) throw new Error("Retrait d'une attribution impossible : " + error.message);
      }
      deletesCompleted = true;

      const refreshed = await loadAssignments(classe, chapitre);
      const refreshedByKey = new Map(
        refreshed.map(a => [
          assignmentKey(a.eleve_id, a.travail_id || `evaluation_${a.evaluation_id}`),
          a
        ])
      );
      const mismatch = expected.find(item => {
        const actual = refreshedByKey.get(item.key);
        return item.evaluationId
          ? !actual || String(actual.evaluation_id) !== item.evaluationId
          : !!actual;
      });
      if (mismatch) {
        throw new Error("La vérification après enregistrement n'a pas confirmé toutes les modifications. Recharge la page et vérifie les attributions avant de recommencer.");
      }

      loadedAssignments.splice(0, loadedAssignments.length, ...refreshed);
      status.textContent = `Attributions enregistrées et vérifiées (${expected.length} modification(s)).`;
    } catch (e) {
      const partial = upsertsCompleted !== deletesCompleted || upsertsCompleted || deletesCompleted;
      status.textContent = (partial ? "Attention : l'enregistrement a pu être partiel. Recharge les attributions et vérifie-les avant toute nouvelle modification. " : "") + e.message;
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
