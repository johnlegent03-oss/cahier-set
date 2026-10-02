/* ============================================================
   Cahier numérique de SVT — Suivi comportemental
   Stockage Supabase : StudentBehaviorEvents
   ============================================================ */

(function () {
  "use strict";

  const TABLE = "StudentBehaviorEvents";

  let behaviorSupabaseLoading = false;
  let behaviorSupabaseLoaded = false;


  /* ------------------------------------------------------------
     Connexion Supabase
     ------------------------------------------------------------ */

  function currentSb() {
    return window.sb || (typeof sb !== "undefined" ? sb : null);
  }


  /* ------------------------------------------------------------
     Transformation d'une ligne Supabase
     ------------------------------------------------------------ */

  function normalizeEvent(row, studentName) {

    return {
      id: String(row.id),

      studentId: row.eleve_id
        ? String(row.eleve_id)
        : "",

      student: String(
        studentName || row.student || ""
      ),

      classe: String(
        row.classe || ""
      ),

      period: String(
        row.period || "year"
      ),

      type: String(
        row.type || ""
      ),

      date:
        row.date ||
        row.created_at ||
        new Date().toISOString(),

      note: String(
        row.note || ""
      )
    };
  }


  /* ------------------------------------------------------------
     Récupération des noms à partir des eleve_id
     ------------------------------------------------------------ */

  async function buildStudentNames(rows) {

    const ids = [
      ...new Set(
        (rows || [])
          .map(row => row.eleve_id)
          .filter(Boolean)
          .map(String)
      )
    ];

    const names = new Map();


    /*
     * On utilise d'abord les élèves déjà chargés
     * par le cahier numérique.
     */

    if (typeof behaviorStudentsCache !== "undefined") {

      (behaviorStudentsCache || []).forEach(student => {

        if (!student || !student.id) {
          return;
        }

        names.set(
          String(student.id),
          String(student.nom || "")
        );

      });
    }


    /*
     * Pour les élèves dont le nom n'est pas encore connu,
     * on interroge directement la table Eleves.
     */

    const missing = ids.filter(
      id => !names.has(id)
    );


    if (missing.length) {

      const db = currentSb();

      if (db) {

        try {

          const { data, error } = await db
            .from("Eleves")
            .select("*")
            .in("id", missing);


          if (!error) {

            (data || []).forEach(student => {

              let name = "";


              if (
                typeof studentDisplayName === "function"
              ) {

                name = studentDisplayName(
                  student
                );

              } else {

                name = [
                  student.nom,
                  student.prenom
                ]
                  .filter(Boolean)
                  .join(" ")
                  .trim();
              }


              names.set(
                String(student.id),
                String(name || "")
              );

            });

          }

        } catch (e) {

          console.warn(
            "Impossible de récupérer les noms des élèves :",
            e
          );

        }

      }

    }


    return names;
  }


  /* ------------------------------------------------------------
     Chargement des observations depuis Supabase
     ------------------------------------------------------------ */

  async function fetchBehaviorEventsFromSupabase() {

    const db = currentSb();

    if (!db || behaviorSupabaseLoading) {
      return;
    }


    behaviorSupabaseLoading = true;


    try {

      const { data, error } = await db
        .from(TABLE)
        .select(
          "id,eleve_id,classe,type,period,date,note,created_at"
        )
        .order(
          "date",
          { ascending: false }
        );


      if (error) {
        throw error;
      }


      /*
       * On récupère les noms correspondant
       * aux eleve_id.
       */

      const studentNames =
        await buildStudentNames(
          data || []
        );


      /*
       * On transforme les lignes Supabase
       * dans le format attendu par ton ancien suivi.
       */

      behaviorEventsCache =
        (data || []).map(row =>

          normalizeEvent(
            row,
            studentNames.get(
              String(row.eleve_id || "")
            ) || ""
          )

        );


      behaviorSupabaseLoaded = true;


      /*
       * Actualisation de l'affichage.
       */

      if (
        typeof renderStudentTracking ===
        "function"
      ) {

        renderStudentTracking();

      }


      if (
        typeof renderClassTracking ===
        "function"
      ) {

        renderClassTracking();

      }


    } catch (e) {

      console.error(
        "Erreur chargement suivi comportemental :",
        e
      );

    } finally {

      behaviorSupabaseLoading = false;

    }

  }


  /* ------------------------------------------------------------
     Remplacement de l'ancien loadBehaviorEvents()
     ------------------------------------------------------------ */

  window.loadBehaviorEvents = function () {

    if (
      !behaviorSupabaseLoaded &&
      !behaviorSupabaseLoading
    ) {

      fetchBehaviorEventsFromSupabase();

    }


    return behaviorEventsCache || [];
  };


  /* ------------------------------------------------------------
     Compatibilité avec l'ancien code
     ------------------------------------------------------------ */

  window.saveBehaviorEvents = function () {

    /*
     * Le stockage réel est maintenant Supabase.
     * Cette fonction reste présente car l'ancien
     * prof.html l'appelle encore.
     */

    return true;
  };


  /* ------------------------------------------------------------
     INSERT d'une observation
     ------------------------------------------------------------ */

  async function insertBehaviorEvent(
    student,
    type,
    period,
    note
  ) {

    const db = currentSb();


    if (!db) {

      throw new Error(
        "Connexion Supabase indisponible."
      );

    }


    const payload = {

      eleve_id:
        String(student.id),

      classe:
        String(student.classe || ""),

      type:
        String(type),

      period:
        String(period || "year"),

      date:
        new Date().toISOString(),

      note:
        String(note || "").trim()

    };


    const { data, error } = await db
      .from(TABLE)
      .insert(payload)
      .select(
        "id,eleve_id,classe,type,period,date,note,created_at"
      )
      .single();


    if (error) {
      throw error;
    }


    /*
     * On conserve immédiatement le nom
     * pour que l'affichage fonctionne sans
     * attendre un nouveau chargement.
     */

    return normalizeEvent(
      data,
      String(student.nom || "")
    );

  }


  /* ------------------------------------------------------------
     AJOUT — UN SEUL ÉLÈVE
     ------------------------------------------------------------ */

  window.addBehaviorEvent = async function (type) {

    const name =
      studentTrackingStudent;


    if (!name) {

      alert(
        "Sélectionne d'abord un élève."
      );

      return;
    }


    const meta =
      typeof behaviorMeta === "function"
        ? behaviorMeta(type)
        : {
            icon: "📝",
            label: type
          };


    const note = prompt(

      `${meta.icon} ${meta.label}\n\n` +
      `Précision facultative :`,

      ""

    );


    if (note === null) {
      return;
    }


    /*
     * Recherche de l'élève dans la liste
     * déjà chargée par le cahier.
     */

    const student =
      (behaviorStudentsCache || [])
        .find(

          s =>
            String(s.nom || "")
              .trim() ===
            String(name)
              .trim()

        );


    if (!student || !student.id) {

      alert(
        "Impossible de retrouver l'élève dans la table Eleves."
      );

      return;
    }


    try {

      const event =
        await insertBehaviorEvent(

          student,

          type,

          studentTrackingPeriod ||
            "year",

          note

        );


      /*
       * Ajout immédiat dans le cache
       * utilisé par l'ancien affichage.
       */

      behaviorEventsCache = [

        event,

        ...(behaviorEventsCache || [])

      ];


      if (
        typeof renderStudentTracking ===
        "function"
      ) {

        renderStudentTracking();

      }


    } catch (e) {

      alert(
        "Enregistrement impossible : " +
        e.message
      );

    }

  };


  /* ------------------------------------------------------------
     AJOUT — PLUSIEURS ÉLÈVES
     ------------------------------------------------------------ */

  window.addBehaviorEventToSelected =
    async function (type) {

      const selected = [

        ...document.querySelectorAll(
          ".behavior-student-check:checked"
        )

      ]

        .map(
          element => element.value
        )

        .filter(Boolean);


      if (!selected.length) {

        alert(
          "Sélectionne au moins un élève."
        );

        return;
      }


      const meta =
        typeof behaviorMeta === "function"
          ? behaviorMeta(type)
          : {
              icon: "📝",
              label: type
            };


      const note = prompt(

        `${meta.icon} ${meta.label}\n\n` +
        `Observation facultative pour les ` +
        `${selected.length} élève(s) :`,

        ""

      );


      if (note === null) {
        return;
      }


      const period =
        classTrackingPeriod ||
        "year";


      const added = [];


      try {

        /*
         * On enregistre chaque élève
         * individuellement dans Supabase.
         */

        for (
          const studentId of selected
        ) {

          const student =
            (behaviorStudentsCache || [])
              .find(

                s =>
                  String(s.id) ===
                  String(studentId)

              );


          if (
            !student ||
            !student.id
          ) {

            continue;

          }


          const event =
            await insertBehaviorEvent(

              student,

              type,

              period,

              note

            );


          added.push(event);

        }


        /*
         * Ajout au cache local d'affichage.
         */

        behaviorEventsCache = [

          ...added,

          ...(behaviorEventsCache || [])

        ];


        if (
          typeof renderClassTracking ===
          "function"
        ) {

          renderClassTracking();

        }


        alert(

          `${added.length} observation(s) enregistrée(s) ✓`

        );


      } catch (e) {

        alert(

          "Enregistrement impossible : " +
          e.message

        );


        /*
         * Si une partie des observations
         * a déjà été enregistrée, on recharge
         * depuis Supabase pour resynchroniser.
         */

        fetchBehaviorEventsFromSupabase();

      }

    };


  /* ------------------------------------------------------------
     SUPPRESSION
     ------------------------------------------------------------ */

  window.deleteBehaviorEvent =
    async function (id) {

      if (
        !confirm(
          "Supprimer cette observation ?"
        )
      ) {

        return;

      }


      const db = currentSb();


      if (!db) {

        alert(
          "Connexion Supabase indisponible."
        );

        return;
      }


      try {

        const { error } =
          await db

            .from(TABLE)

            .delete()

            .eq(
              "id",
              String(id)
            );


        if (error) {
          throw error;
        }


        /*
         * Suppression du cache local
         * après confirmation Supabase.
         */

        behaviorEventsCache =
          (behaviorEventsCache || [])
            .filter(

              event =>
                String(event.id) !==
                String(id)

            );


        if (
          typeof renderStudentTracking ===
          "function"
        ) {

          renderStudentTracking();

        }


        if (
          typeof renderClassTracking ===
          "function"
        ) {

          renderClassTracking();

        }


      } catch (e) {

        alert(

          "Suppression impossible : " +
          e.message

        );

      }

    };


  /* ------------------------------------------------------------
     CHARGEMENT AUTOMATIQUE
     ------------------------------------------------------------ */

  setTimeout(
    fetchBehaviorEventsFromSupabase,
    500
  );

})();
