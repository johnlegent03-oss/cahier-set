/* ============================================================
   Correctif suivi comportemental
   Stockage Supabase : StudentBehaviorEvents
   ============================================================ */

(function () {
  "use strict";

  const TABLE = "StudentBehaviorEvents";
  let loading = false;
  let loaded = false;

  function client() {
    return window.sb || (typeof sb !== "undefined" ? sb : null);
  }

  function normalize(row) {
    return {
      id: String(row.id),
      studentId: row.eleve_id ? String(row.eleve_id) : "",
      student: String(row.student || ""),
      classe: String(row.classe || ""),
      period: String(row.period || "year"),
      type: String(row.type || ""),
      date: row.date || row.created_at || new Date().toISOString(),
      note: String(row.note || "")
    };
  }

  async function loadFromSupabase() {
    const db = client();
    if (!db || loading) return;

    loading = true;

    try {
      const { data, error } = await db
        .from(TABLE)
        .select("id,eleve_id,classe,type,period,date,note,created_at")
        .order("date", { ascending: false });

      if (error) throw error;

      behaviorEventsCache = (data || []).map(normalize);
      loaded = true;

      if (typeof renderStudentTracking === "function") {
        renderStudentTracking();
      }

      if (typeof renderClassTracking === "function") {
        renderClassTracking();
      }

    } catch (e) {
      console.error("Erreur chargement suivi comportemental :", e);
    } finally {
      loading = false;
    }
  }

  /*
   * Remplace l'ancien chargement localStorage.
   */
  window.loadBehaviorEvents = function () {
    if (!loaded && !loading) {
      loadFromSupabase();
    }

    return behaviorEventsCache || [];
  };

  /*
   * L'ancien code appelle saveBehaviorEvents().
   * On le conserve pour éviter toute erreur,
   * mais Supabase est désormais le stockage réel.
   */
  window.saveBehaviorEvents = function () {
    return true;
  };

  async function insertEvent(student, type, period, note) {

    const db = client();

    if (!db) {
      throw new Error("Connexion Supabase indisponible.");
    }

    const payload = {
      eleve_id: String(student.id),
      classe: String(student.classe || ""),
      type: String(type),
      period: String(period || "year"),
      date: new Date().toISOString(),
      note: String(note || "").trim()
    };

    const { data, error } = await db
      .from(TABLE)
      .insert(payload)
      .select("id,eleve_id,classe,type,period,date,note,created_at")
      .single();

    if (error) throw error;

    return normalize(data);
  }

  /*
   * Ajout pour un seul élève.
   */
  window.addBehaviorEvent = async function (type) {

    const name = studentTrackingStudent;

    if (!name) {
      alert("Sélectionne d'abord un élève.");
      return;
    }

    const meta =
      typeof behaviorMeta === "function"
        ? behaviorMeta(type)
        : { icon: "📝", label: type };

    const note = prompt(
      `${meta.icon} ${meta.label}\n\nPrécision facultative :`,
      ""
    );

    if (note === null) return;

    const student =
      behaviorStudentsCache.find(
        s => String(s.nom || "").trim() === String(name).trim()
      );

    if (!student || !student.id) {
      alert("Impossible de retrouver l'élève.");
      return;
    }

    try {

      const event = await insertEvent(
        student,
        type,
        studentTrackingPeriod || "year",
        note
      );

      behaviorEventsCache = [
        event,
        ...(behaviorEventsCache || [])
      ];

      if (typeof renderStudentTracking === "function") {
        renderStudentTracking();
      }

    } catch (e) {
      alert("Enregistrement impossible : " + e.message);
    }
  };

  /*
   * Ajout pour plusieurs élèves.
   */
  window.addBehaviorEventToSelected = async function (type) {

    const selected = [
      ...document.querySelectorAll(
        ".behavior-student-check:checked"
      )
    ]
      .map(el => el.value)
      .filter(Boolean);

    if (!selected.length) {
      alert("Sélectionne au moins un élève.");
      return;
    }

    const meta =
      typeof behaviorMeta === "function"
        ? behaviorMeta(type)
        : { icon: "📝", label: type };

    const note = prompt(
      `${meta.icon} ${meta.label}\n\nObservation facultative pour les ${selected.length} élève(s) :`,
      ""
    );

    if (note === null) return;

    const period = classTrackingPeriod || "year";
    const added = [];

    try {

      for (const studentId of selected) {

        const student =
          behaviorStudentsCache.find(
            s => String(s.id) === String(studentId)
          );

        if (!student || !student.id) continue;

        const event = await insertEvent(
          student,
          type,
          period,
          note
        );

        added.push(event);
      }

      behaviorEventsCache = [
        ...added,
        ...(behaviorEventsCache || [])
      ];

      if (typeof renderClassTracking === "function") {
        renderClassTracking();
      }

      alert(`${added.length} observation(s) enregistrée(s) ✓`);

    } catch (e) {

      alert("Enregistrement impossible : " + e.message);

      loadFromSupabase();
    }
  };

  /*
   * Suppression réelle dans Supabase.
   */
  window.deleteBehaviorEvent = async function (id) {

    if (!confirm("Supprimer cette observation ?")) {
      return;
    }

    const db = client();

    if (!db) {
      alert("Connexion Supabase indisponible.");
      return;
    }

    try {

      const { error } = await db
        .from(TABLE)
        .delete()
        .eq("id", String(id));

      if (error) throw error;

      behaviorEventsCache =
        (behaviorEventsCache || []).filter(
          e => String(e.id) !== String(id)
        );

      if (typeof renderStudentTracking === "function") {
        renderStudentTracking();
      }

      if (typeof renderClassTracking === "function") {
        renderClassTracking();
      }

    } catch (e) {

      alert(
        "Suppression impossible : " + e.message
      );
    }
  };

  /*
   * Chargement automatique.
   */
  setTimeout(loadFromSupabase, 500);

})();
