/* ============================================================
   Cahier numérique de SVT — Suivi comportemental V63
   Stockage principal : Supabase / StudentBehaviorEvents
   Chargé après prof.html.
   ============================================================ */
(function(){
  "use strict";

  const TABLE="StudentBehaviorEvents";
  const LEGACY_KEY="svt_behavior_events_v1";
  const MIGRATION_KEY="svt_behavior_migrated_v1";

  let behaviorSupabaseLoading=false;
  let behaviorSupabaseLoaded=false;

  function currentSb(){
    return window.sb || (typeof sb!=="undefined" ? sb : null);
  }

  function getCache(){
    return (
      typeof behaviorEventsCache!=="undefined" &&
      Array.isArray(behaviorEventsCache)
    )
      ? behaviorEventsCache
      : [];
  }

  function setCache(events){
    if(typeof behaviorEventsCache!=="undefined"){
      behaviorEventsCache=Array.isArray(events) ? events : [];
    }
  }

  function normalizeName(v){
    return String(v||"")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"")
      .replace(/[-']/g," ")
      .replace(/\s+/g," ")
      .trim()
      .toLocaleLowerCase("fr");
  }

  function normalizeEvent(row,studentName){
    return {
      id:String(row.id),
      studentId:row.eleve_id ? String(row.eleve_id) : "",
      student:String(studentName || row.student || ""),
      classe:String(row.classe || ""),
      period:String(row.period || "year"),
      type:String(row.type || ""),
      date:row.date || row.created_at || new Date().toISOString(),
      note:String(row.note || "")
    };
  }

  function studentName(student){
    if(typeof studentDisplayName==="function"){
      return String(studentDisplayName(student)||"");
    }

    return [
      student?.nom,
      student?.prenom
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  async function buildStudentNames(rows){
    const names=new Map();

    if(typeof behaviorStudentsCache!=="undefined"){
      (behaviorStudentsCache||[]).forEach(s=>{
        if(s?.id){
          names.set(
            String(s.id),
            String(s.nom || studentName(s))
          );
        }
      });
    }

    const missing=[
      ...new Set(
        (rows||[])
          .map(r=>r.eleve_id)
          .filter(Boolean)
          .map(String)
      )
    ].filter(id=>!names.has(id));

    const db=currentSb();

    if(db && missing.length){
      try{
        const {data,error}=await db
          .from("Eleves")
          .select("*")
          .in("id",missing);

        if(!error){
          (data||[]).forEach(s=>{
            names.set(
              String(s.id),
              studentName(s)
            );
          });
        }
      }catch(e){
        console.warn(
          "Impossible de récupérer les noms des élèves :",
          e
        );
      }
    }

    return names;
  }

  async function fetchBehaviorEventsFromSupabase(){

    const client=currentSb();

    if(!client || behaviorSupabaseLoading){
      return;
    }

    /*
      On vérifie explicitement la session avant de charger
      les observations. Cela évite de lancer le chargement
      avant que Supabase Auth soit initialisé.
    */
    try{
      const sessionQ=await client.auth.getSession();

      if(!sessionQ?.data?.session){
        behaviorSupabaseLoaded=false;
        return;
      }

    }catch(e){
      console.warn(
        "Session Supabase indisponible :",
        e
      );
      return;
    }

    behaviorSupabaseLoading=true;

    try{

      const {data,error}=await client
        .from(TABLE)
        .select(
          "id,eleve_id,classe,type,period,date,note,created_at"
        )
        .order("date",{ascending:false});

      if(error){
        throw error;
      }

      const studentNames=
        await buildStudentNames(data||[]);

      setCache(
        (data||[]).map(row=>
          normalizeEvent(
            row,
            studentNames.get(
              String(row.eleve_id||"")
            ) || ""
          )
        )
      );

      behaviorSupabaseLoaded=true;

      /*
        Migration des anciennes observations locales.
        Elle est effectuée après le chargement Supabase
        afin d'éviter les doublons.
      */
      await migrateLegacyEvents(studentNames);

      renderCurrentView();

    }catch(e){

      console.error(
        "Suivi comportemental Supabase :",
        e
      );

    }finally{

      behaviorSupabaseLoading=false;

    }
  }

  function renderCurrentView(){

    if(
      typeof renderStudentTracking==="function" &&
      document.getElementById("trackingStudent")
    ){
      renderStudentTracking();
    }

    if(
      typeof renderClassTracking==="function" &&
      (
        document.querySelector(".behavior-roster-row") ||
        document.querySelector(".behavior-actions")
      )
    ){
      renderClassTracking();
    }
  }

  async function insertOne(
    student,
    type,
    period,
    note
  ){

    const client=currentSb();

    if(!client){
      throw new Error(
        "Connexion Supabase indisponible."
      );
    }

    const payload={
      eleve_id:String(student.id),
      classe:String(student.classe||""),
      type:String(type),
      period:String(period||"year"),
      date:new Date().toISOString(),
      note:String(note||"").trim()
    };

    const {data,error}=await client
      .from(TABLE)
      .insert(payload)
      .select(
        "id,eleve_id,classe,type,period,date,note,created_at"
      )
      .single();

    if(error){
      throw error;
    }

    return normalizeEvent(
      data,
      String(
        student.nom ||
        studentName(student)
      )
    );
  }

  async function migrateLegacyEvents(
    studentNames
  ){

    let migrated=false;

    try{
      migrated=
        localStorage.getItem(
          MIGRATION_KEY
        )==="1";
    }catch(e){}

    if(migrated){
      return;
    }

    let legacy=[];

    try{
      legacy=JSON.parse(
        localStorage.getItem(
          LEGACY_KEY
        ) || "[]"
      );
    }catch(e){
      legacy=[];
    }

    if(
      !Array.isArray(legacy) ||
      !legacy.length
    ){

      try{
        localStorage.setItem(
          MIGRATION_KEY,
          "1"
        );
      }catch(e){}

      return;
    }

    const students=
      typeof behaviorStudentsCache!=="undefined"
        ? (behaviorStudentsCache||[])
        : [];

    const existing=getCache();

    let changed=false;

    for(const old of legacy){

      const oldId=
        old?.studentId
          ? String(old.studentId)
          : "";

      const oldClass=
        String(old?.classe||"").trim();

      const oldName=
        normalizeName(
          old?.student||""
        );

      let student=null;

      /*
        Priorité à l'identifiant élève.
        Cela évite les problèmes d'homonymes.
      */
      if(oldId){
        student=
          students.find(
            s=>String(s.id)===oldId
          ) || null;
      }

      /*
        Si aucun ID n'est disponible,
        recherche par nom + classe.
      */
      if(!student && oldName){

        const matches=
          students.filter(
            s=>
              normalizeName(s.nom)===oldName &&
              (
                !oldClass ||
                String(s.classe||"").trim()===oldClass
              )
          );

        /*
          On ne migre que si le nom identifie
          un seul élève.
        */
        if(matches.length===1){
          student=matches[0];
        }
      }

      if(!student?.id){
        continue;
      }

      /*
        Vérification anti-doublon.
      */
      const already=
        existing.some(
          e=>
            String(e.studentId||"")===
            String(student.id) &&

            String(e.type||"")===
            String(old.type||"") &&

            String(e.note||"")===
            String(old.note||"") &&

            Math.abs(
              new Date(e.date).getTime() -
              new Date(old.date||0).getTime()
            ) < 2000
        );

      if(already){
        continue;
      }

      try{

        const event=
          await insertOne(
            student,
            old.type||"",
            old.period||"year",
            old.note||""
          );

        existing.unshift(event);
        changed=true;

      }catch(e){

        console.warn(
          "Migration d'une observation impossible :",
          e
        );

      }
    }

    if(changed){
      setCache(existing);
    }

    try{
      localStorage.setItem(
        MIGRATION_KEY,
        "1"
      );
    }catch(e){}
  }

  /*
    Fonction conservée pour compatibilité
    avec prof.html.
  */
  window.loadBehaviorEvents=function(){

    if(
      !behaviorSupabaseLoaded &&
      !behaviorSupabaseLoading
    ){
      fetchBehaviorEventsFromSupabase();
    }

    return getCache();
  };

  /*
    Compatibilité avec l'ancien système.
    Les données sont désormais enregistrées
    directement dans Supabase.
  */
  window.saveBehaviorEvents=function(){
    return true;
  };

  /*
    Ajout d'une observation à un élève.
  */
  window.addBehaviorEvent=async function(type){

    const studentId=
      String(
        typeof studentTrackingStudentId!=="undefined"
          ? studentTrackingStudentId
          : ""
      );

    const name=
      String(
        typeof studentTrackingStudent!=="undefined"
          ? studentTrackingStudent
          : ""
      );

    if(!studentId && !name){

      alert(
        "Sélectionne d'abord un élève."
      );

      return;
    }

    const meta=
      typeof behaviorMeta==="function"
        ? behaviorMeta(type)
        : {
            icon:"📝",
            label:type
          };

    const note=
      prompt(
        `${meta.icon} ${meta.label}\n\nPrécision facultative :`,
        ""
      );

    if(note===null){
      return;
    }

    const students=
      typeof behaviorStudentsCache!=="undefined"
        ? (behaviorStudentsCache||[])
        : [];

    let student=
      studentId
        ? students.find(
            s=>String(s.id)===studentId
          )
        : null;

    /*
      Recherche secondaire par nom + classe.
      On refuse automatiquement les homonymes.
    */
    if(!student && name){

      const cls=
        String(
          typeof studentTrackingClass!=="undefined"
            ? studentTrackingClass
            : ""
        ).trim();

      const matches=
        students.filter(
          s=>
            normalizeName(s.nom)===
              normalizeName(name) &&
            (
              !cls ||
              String(s.classe||"").trim()===cls
            )
        );

      if(matches.length===1){

        student=matches[0];

      }else if(matches.length>1){

        alert(
          "Plusieurs élèves portent ce nom. " +
          "Sélectionne précisément l'élève dans la liste."
        );

        return;
      }
    }

    if(!student?.id){

      alert(
        "Impossible de retrouver l'élève dans la table Eleves."
      );

      return;
    }

    try{

      const period=
        typeof studentTrackingPeriod!=="undefined"
          ? studentTrackingPeriod
          : "year";

      const event=
        await insertOne(
          student,
          type,
          period,
          note
        );

      /*
        Mise à jour immédiate du cache local
        pour que l'observation apparaisse
        sans rechargement de page.
      */
      setCache([
        event,
        ...getCache()
      ]);

      if(
        typeof renderStudentTracking==="function"
      ){
        renderStudentTracking();
      }

    }catch(e){

      alert(
        "Enregistrement impossible : " +
        e.message
      );

    }
  };

  /*
    Ajout d'une même observation
    à plusieurs élèves sélectionnés.
  */
  window.addBehaviorEventToSelected=
    async function(type){

      const selected=[
        ...document.querySelectorAll(
          ".behavior-student-check:checked"
        )
      ]
        .map(
          el=>String(el.value||"")
        )
        .filter(Boolean);

      if(!selected.length){

        alert(
          "Sélectionne au moins un élève."
        );

        return;
      }

      const meta=
        typeof behaviorMeta==="function"
          ? behaviorMeta(type)
          : {
              icon:"📝",
              label:type
            };

      const note=
        prompt(
          `${meta.icon} ${meta.label}\n\n` +
          `Observation facultative pour les ` +
          `${selected.length} élève(s) :`,
          ""
        );

      if(note===null){
        return;
      }

      const students=
        typeof behaviorStudentsCache!=="undefined"
          ? (behaviorStudentsCache||[])
          : [];

      const period=
        typeof classTrackingPeriod!=="undefined"
          ? classTrackingPeriod
          : "year";

      const added=[];

      try{

        for(const id of selected){

          const student=
            students.find(
              s=>String(s.id)===id
            );

          if(!student?.id){
            continue;
          }

          added.push(
            await insertOne(
              student,
              type,
              period,
              note
            )
          );
        }

        /*
          Une seule mise à jour du cache
          après toutes les insertions.
        */
        setCache([
          ...added,
          ...getCache()
        ]);

        if(
          typeof renderClassTracking==="function"
        ){
          renderClassTracking();
        }

        alert(
          `${added.length} observation(s) enregistrée(s) ✓`
        );

      }catch(e){

        alert(
          "Enregistrement impossible : " +
          e.message
        );

        /*
          En cas d'erreur, on recharge depuis
          Supabase afin de resynchroniser le cache.
        */
        fetchBehaviorEventsFromSupabase();
      }
    };

  /*
    Suppression durable d'une observation.
  */
  window.deleteBehaviorEvent=
    async function(id){

      if(
        !confirm(
          "Supprimer cette observation ?"
        )
      ){
        return;
      }

      const client=currentSb();

      if(!client){

        alert(
          "Connexion Supabase indisponible."
        );

        return;
      }

      try{

        const {error}=
          await client
            .from(TABLE)
            .delete()
            .eq(
              "id",
              String(id)
            );

        if(error){
          throw error;
        }

        /*
          Mise à jour immédiate du cache.
          L'enregistrement ayant également été supprimé
          de Supabase, il ne réapparaîtra pas au prochain chargement
          si les droits RLS autorisent bien la suppression.
        */
        setCache(
          getCache().filter(
            e=>String(e.id)!==String(id)
          )
        );

        renderCurrentView();

      }catch(e){

        alert(
          "Suppression impossible : " +
          e.message
        );
      }
    };

  /*
    AUTHENTIFICATION
    ----------------
    Ne pas lancer le chargement avant que
    la session Supabase soit disponible.
  */
  const db=currentSb();

  if(db){

    db.auth.onAuthStateChange(
      (event)=>{

        if(
          event==="SIGNED_IN" ||
          event==="TOKEN_REFRESHED"
        ){

          behaviorSupabaseLoaded=false;

          /*
            setTimeout évite de lancer une requête
            Supabase pendant le traitement interne
            du changement d'état Auth.
          */
          setTimeout(
            fetchBehaviorEventsFromSupabase,
            0
          );

        }else if(
          event==="SIGNED_OUT"
        ){

          behaviorSupabaseLoaded=false;

          /*
            Vidage immédiat du cache après déconnexion
            afin qu'un autre compte ne voie pas les
            données du compte précédent.
          */
          setCache([]);
        }
      }
    );
  }

  /*
    Premier chargement différé.
    Le délai laisse à prof.html le temps
    d'initialiser Supabase et l'authentification.
  */
  setTimeout(
    fetchBehaviorEventsFromSupabase,
    500
  );

})();
