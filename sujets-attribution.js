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
        <style>
          .bulk-work-card .bulk-select-toolbar{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:14px!important;flex-wrap:wrap!important;margin:10px 0!important;}
          .bulk-work-card .bulk-select-all-label{display:inline-flex!important;align-items:center!important;gap:8px!important;margin:0!important;width:auto!important;max-width:100%!important;font-size:14px!important;font-weight:650!important;line-height:1.35!important;color:var(--text)!important;}
          .bulk-work-card .bulk-select-all-label input{width:18px!important;height:18px!important;flex:0 0 18px!important;margin:0!important;}
          .bulk-work-card .bulk-student-list{max-height:300px;overflow:auto;border:1px solid var(--b);border-radius:10px;padding:6px 10px;background:#fff;}
          .bulk-work-card .bulk-student-row{display:grid!important;grid-template-columns:22px minmax(150px,1fr) minmax(140px,auto)!important;gap:10px!important;align-items:center!important;width:100%!important;box-sizing:border-box!important;margin:0!important;padding:9px 4px!important;border-bottom:1px solid var(--b)!important;color:var(--text)!important;font-size:14px!important;font-weight:500!important;line-height:1.35!important;}
          .bulk-work-card .bulk-student-row:last-child{border-bottom:0!important;}
          .bulk-work-card .bulk-student-row input{width:18px!important;height:18px!important;margin:0!important;flex:0 0 18px!important;}
          .bulk-work-card .bulk-student-name{display:block!important;min-width:0!important;color:var(--text)!important;visibility:visible!important;opacity:1!important;overflow-wrap:anywhere!important;}
          .bulk-work-card .bulk-student-current{display:block!important;min-width:0!important;color:var(--muted)!important;font-size:12px!important;font-weight:400!important;overflow-wrap:anywhere!important;}
          @media(max-width:650px){.bulk-work-card .bulk-student-row{grid-template-columns:22px minmax(0,1fr)!important}.bulk-work-card .bulk-student-current{grid-column:2;}}
        </style>
        <div class="editbox">
          <p class="small-note">
            ${workGroups.length} travail(aux), ${subjects.length} sujet(s) disponible(s),
            ${students.length} élève(s). Pour chaque travail, coche plusieurs élèves puis attribue-leur le même sujet en une seule fois.
            « Aucun sujet » retire uniquement l'attribution de ce travail.
          </p>
          ${workGroups.map(group => {
            const currentAssignments = students.map(student => ({
              student,
              assignment: assignmentByStudentWork.get(assignmentKey(student.id, group.id))
            }));
            if (group.subjects.length === 1) {
              return `
                <section class="editbox" style="margin-top:14px;">
                  <h3>${esc(typeLabel(group.type))} — ${esc(group.title)}</h3>
                  <p><strong>Sujet unique :</strong> ${esc(group.subjects[0].titre)}</p>
                  <p class="small-note">Une attribution individuelle n'est pas nécessaire : ce sujet s'applique à toute la classe. Les anciennes attributions sont conservées.</p>
                </section>`;
            }
            if (!group.subjects.length) {
              return `
                <section class="editbox" style="margin-top:14px;">
                  <h3>${esc(typeLabel(group.type))} — ${esc(group.title)}</h3>
                  <p class="status">Aucun sujet disponible pour ce travail. Les attributions existantes sont conservées.</p>
                </section>`;
            }
            return `
              <section class="editbox bulk-work-card" data-work-card="${esc(group.id)}" style="margin-top:14px;">
                <h3>${esc(typeLabel(group.type))} — ${esc(group.title)}</h3>
                <label for="bulkSubject_${esc(group.id)}">Sujet à attribuer</label>
                <select id="bulkSubject_${esc(group.id)}" class="bulk-subject-select" data-work-id="${esc(group.id)}" style="width:100%;margin:6px 0 10px;">
                  <option value="">— Choisir un sujet —</option>
                  ${group.subjects.map(subject => `<option value="${esc(subject.id)}">${esc(subject.titre)}</option>`).join("")}
                </select>
                <div class="bulk-select-toolbar">
                  <label class="bulk-select-all-label"><input type="checkbox" class="bulk-select-all" data-work-id="${esc(group.id)}"> <span>Sélectionner tous les élèves</span></label>
                  <span class="small-note">Coche les élèves concernés ci-dessous.</span>
                </div>
                <div class="bulk-student-list">
                  ${currentAssignments.map(({student, assignment}) => {
                    const assignedSubject = assignment && group.subjects.find(subject => String(subject.id) === String(assignment.evaluation_id));
                    return `<label class="bulk-student-row">
                      <input type="checkbox" class="bulk-student-checkbox" data-work-id="${esc(group.id)}" data-eleve-id="${esc(student.id)}">
                      <span class="bulk-student-name">${esc(student.nom)} ${esc(student.prenom)}</span>
                      <span class="bulk-student-current">${assignedSubject ? `Actuellement : ${esc(assignedSubject.titre)}` : assignment ? `Attribution existante (sujet indisponible : ID ${esc(assignment.evaluation_id)})` : "Non attribué"}</span>
                    </label>`;
                  }).join("")}
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
                  <button type="button" class="primary bulk-assign-btn" data-work-id="${esc(group.id)}">Attribuer le sujet choisi aux élèves cochés</button>
                  <button type="button" class="bulk-remove-btn" data-work-id="${esc(group.id)}">Retirer l'attribution des élèves cochés</button>
                </div>
                <div id="bulkStatus_${esc(group.id)}" class="status" role="status" aria-live="polite" style="margin-top:8px;"></div>
              </section>`;
          }).join("")}
        </div>
      `;

      host.querySelectorAll(".bulk-select-all").forEach(selectAll => {
        selectAll.addEventListener("change", () => {
          host.querySelectorAll(`.bulk-student-checkbox[data-work-id="${CSS.escape(selectAll.dataset.workId)}"]`)
            .forEach(checkbox => { checkbox.checked = selectAll.checked; });
        });
      });
      host.querySelectorAll(".bulk-assign-btn").forEach(button => {
        button.onclick = () => bulkAssignStudents(classe, chapitre, button.dataset.workId, workGroups, assignments, false);
      });
      host.querySelectorAll(".bulk-remove-btn").forEach(button => {
        button.onclick = () => bulkAssignStudents(classe, chapitre, button.dataset.workId, workGroups, assignments, true);
      });
    } catch (e) {
      if (requestId !== loadRequestId) return;
      host.innerHTML = `<p class="status">Chargement impossible : ${esc(e.message)}</p>`;
    }
  }

  async function bulkAssignStudents(classe, chapitre, workId, workGroups, loadedAssignments, removeOnly) {
    const card = document.querySelector(`.bulk-work-card[data-work-card="${CSS.escape(String(workId))}"]`);
    const status = document.getElementById(`bulkStatus_${workId}`);
    if (!card || !status) return;
    const selectedStudents = [...card.querySelectorAll(".bulk-student-checkbox:checked")].map(el => String(el.dataset.eleveId));
    if (!selectedStudents.length) {
      status.textContent = "Coche au moins un élève.";
      return;
    }
    const group = workGroups.find(item => String(item.id) === String(workId));
    if (!group) { status.textContent = "Travail introuvable. Recharge la page."; return; }
    const subjectSelect = card.querySelector(".bulk-subject-select");
    const subjectId = String(subjectSelect?.value || "");
    if (!removeOnly && !subjectId) {
      status.textContent = "Choisis d'abord le sujet à attribuer.";
      return;
    }
    const subject = group.subjects.find(item => String(item.id) === subjectId);
    if (!removeOnly && !subject) { status.textContent = "Le sujet choisi n'appartient pas à ce travail."; return; }

    const allSubjects = workGroups.flatMap(item => item.subjects);
    const currentByKey = new Map();
    loadedAssignments.forEach(a => {
      const key = assignmentKey(a.eleve_id, assignmentWorkId(a, allSubjects));
      const previous = currentByKey.get(key);
      const available = allSubjects.some(s => String(s.id) === String(a.evaluation_id));
      const previousAvailable = previous && allSubjects.some(s => String(s.id) === String(previous.evaluation_id));
      if (!previous || (available && !previousAvailable)) currentByKey.set(key, a);
    });
    const current = selectedStudents.map(studentId => ({
      studentId,
      assignment: currentByKey.get(assignmentKey(studentId, workId))
    }));
    const rows = removeOnly ? [] : current
      .filter(item => !item.assignment || String(item.assignment.evaluation_id) !== String(subject.id))
      .map(item => ({
        chapitre: Number(chapitre), classe, eleve_id: item.studentId,
        evaluation_id: Number(subject.id), travail_id: workId
      }));
    const deletes = removeOnly ? current.filter(item => item.assignment).map(item => item.assignment) : [];
    if (!rows.length && !deletes.length) {
      status.textContent = removeOnly ? "Aucune attribution à retirer pour les élèves cochés." : "Ces élèves ont déjà ce sujet attribué.";
      return;
    }
    const buttons = [...card.querySelectorAll("button")];
    buttons.forEach(button => { button.disabled = true; });
    status.textContent = "Enregistrement et vérification…";
    try {
      if (rows.length) {
        const { error } = await sb.from(ASSIGN_TABLE).upsert(rows, {
          onConflict: "created_by,chapitre,classe,eleve_id,travail_id"
        });
        if (error) throw new Error("Enregistrement impossible : " + error.message);
      }
      for (const assignment of deletes) {
        const { error } = await sb.from(ASSIGN_TABLE).delete()
          .eq("id", assignment.id).eq("classe", classe).eq("chapitre", Number(chapitre));
        if (error) throw new Error("Retrait d'une attribution impossible : " + error.message);
      }
      const refreshed = await loadAssignments(classe, chapitre);
      const refreshedByKey = new Map();
      refreshed.forEach(a => {
        const key = assignmentKey(a.eleve_id, assignmentWorkId(a, allSubjects));
        refreshedByKey.set(key, a);
      });
      const failed = current.some(item => {
        const actual = refreshedByKey.get(assignmentKey(item.studentId, workId));
        if (removeOnly) return !!actual;
        const shouldHaveSubject = rows.some(row => String(row.eleve_id) === item.studentId) ||
          (item.assignment && String(item.assignment.evaluation_id) === String(subject.id));
        return shouldHaveSubject && (!actual || String(actual.evaluation_id) !== String(subject.id));
      });
      if (failed) throw new Error("La vérification n'a pas confirmé toutes les attributions. Recharge la page et vérifie les données avant de recommencer.");
      status.textContent = removeOnly
        ? `Attributions retirées et vérifiées pour ${deletes.length} élève(s).`
        : `Sujet attribué et vérifié pour ${rows.length} élève(s).`;
      await loadAssignmentEditor();
    } catch (e) {
      status.textContent = "Attention : " + e.message;
    } finally {
      buttons.forEach(button => { button.disabled = false; });
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
