/* Planning SVT — fonctionnement autonome sur les tables planning V5 */
(() => {
'use strict';
const $ = (s,root=document) => root.querySelector(s);
const $$ = (s,root=document) => [...root.querySelectorAll(s)];
const CLASSES = ['6e1','6e2','6e3','6e4','6e5','5e1','5e3','5e5','3e2','3e3'];
const DAYS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi'];
const state = {user:null,period:null,slots:[],occurrences:[],events:[],cahierSessionsByUid:{},weekStart:mondayOf(new Date()),weekPattern:'',view:'week',tab:'planning',busy:false,
 followupClass:'',followupFilter:'missing',followupSessions:null,followupLoadedClass:'',followupLoading:false,followupError:'',followupRequest:0};
const NAV_KEY='svt.planning.navigation.v1';
function savePlanningNav(){if(!state.user)return;try{localStorage.setItem(NAV_KEY+':'+state.user.id,JSON.stringify({weekStart:iso(state.weekStart),tab:state.tab,weekPattern:state.weekPattern,scrollY:window.scrollY||0}));}catch(e){}}
function restorePlanningNav(){if(!state.user)return;try{const saved=JSON.parse(localStorage.getItem(NAV_KEY+':'+state.user.id)||'null');if(!saved)return;if(saved.weekStart&&/^\d{4}-\d{2}-\d{2}$/.test(saved.weekStart))state.weekStart=mondayOf(dateFrom(saved.weekStart));if(['planning','events','settings','followup'].includes(saved.tab))state.tab=saved.tab;if(['A','B'].includes(saved.weekPattern))state.weekPattern=saved.weekPattern;state._restoreScroll=Math.max(0,Number(saved.scrollY)||0);}catch(e){}}
function mondayOf(d){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x}
function iso(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function dateFrom(s){return new Date(`${s}T12:00:00`)}
function plusDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function notify(msg,error=false){const el=$('#planningMessage');el.textContent=msg;el.className='planning-alert'+(error?' planning-error':'');el.hidden=false}
function hideMessage(){$('#planningMessage').hidden=true}
function client(){if(!window.sb)throw new Error('Client Supabase absent : vérifie le chargement de config.js et du client Supabase.');return window.sb}
async function query(table,method='select',payload=null,filters=[]){
 const applyFilters=q=>{
  filters.forEach(([k,op,v])=>{q=op==='eq'?q.eq(k,v):op==='gte'?q.gte(k,v):op==='lte'?q.lte(k,v):q});
  return q;
 };
 if(method==='select'){
  // Pagination avec ordre stable : une année de planning peut contenir
  // bien plus de 1 000 séances, limite habituelle de l'API Supabase.
  const rows=[],pageSize=500;
  for(let offset=0;;offset+=pageSize){
   const q=applyFilters(client().from(table).select('*'))
    .order('id',{ascending:true})
    .range(offset,offset+pageSize-1);
   const {data,error}=await q;
   if(error)throw error;
   const page=data||[];
   rows.push(...page);
   if(page.length<pageSize)break;
  }
  return rows;
 }
 let q=client().from(table);
 if(method==='insert')q=q.insert(payload).select('*');
 else if(method==='update')q=q.update(payload).select('id');
 else throw new Error('Méthode de planning inconnue : '+method);
 q=applyFilters(q);
 const {data,error}=await q;
 if(error)throw error;
 if(method==='update'&&!(data||[]).length){
  throw new Error('Enregistrement non confirmé. La séance est introuvable ou la modification a été refusée ; actualise le planning.');
 }
 return data||[];
}
async function init(){
 document.body.classList.add('planning-page');
 try{
  const {data:{session},error}=await client().auth.getSession();if(error)throw error;
  if(!session?.user)throw new Error('Session professeur absente. Connecte-toi depuis l’espace professeur.');
  state.user=session.user;
  await loadPeriod();restorePlanningNav();
  // Ne pas masquer les étapes de configuration derrière un planning vide.
  if(!state.period||!state.slots.length||!state.occurrences.length)state.tab='settings';
  if(!state.weekPattern)state.weekPattern=weekPatternFor(state.weekStart);
  render();if(Number.isFinite(state._restoreScroll))requestAnimationFrame(()=>{window.scrollTo({top:state._restoreScroll,left:0,behavior:'auto'});savePlanningNav();delete state._restoreScroll;});
 }catch(e){notify(e.message||'Impossible de charger le Planning.',true)}
}
async function loadPeriod(){
 const rows=await query('planning_periods','select',null,[['owner_id','eq',state.user.id]]);
 const today=iso(new Date());
 state.period=rows.find(p=>p.start_date<=today&&p.end_date>=today)||rows.sort((a,b)=>b.start_date.localeCompare(a.start_date))[0]||null;
 if(!state.period){
  state.slots=[];state.occurrences=[];state.events=[];state.cahierSessionsByUid={};
  state.followupSessions=null;state.followupLoadedClass='';state.followupRequest++;state.followupLoading=false;
  state.tab='settings';
  notify('Aucune période de planning n’est configurée. Ouvre les paramètres pour créer l’année scolaire, puis les créneaux et les séances.');return
 }
 const [slots,occ,events]=await Promise.all([
  query('planning_slots','select',null,[['owner_id','eq',state.user.id],['period_id','eq',state.period.id]]),
  query('planning_session_occurrences','select',null,[['owner_id','eq',state.user.id],['period_id','eq',state.period.id]]),
  query('planning_events','select',null,[['owner_id','eq',state.user.id],['period_id','eq',state.period.id]])
 ]);
 state.slots=slots;state.occurrences=occ;state.events=events;
 state.followupSessions=null;state.followupLoadedClass='';state.followupRequest++;state.followupLoading=false;
 await loadLinkedCahierSessions();
}
async function loadLinkedCahierSessions(){
 state.cahierSessionsByUid={};
 const linked=state.occurrences.filter(o=>o.cahier_planning_uid);
 const classes=[...new Set(linked.map(o=>o.class_name).filter(Boolean))];
 await Promise.all(classes.map(async className=>{
  try{const sessions=await getCahierSessions(className);sessions.forEach(session=>{state.cahierSessionsByUid[session.uid]={...session,className};});}
  catch(error){console.warn(`Cahier ${className} non chargé pour l’affichage du planning :`,error);}
 }));
}
function weekPatternFor(date){
 const ref=dateFrom(state.period?.week_a_reference_date||'2026-08-31');
 const monday=mondayOf(date);
 const weeks=Math.round((monday-ref)/604800000);
 return Math.abs(weeks)%2===0?'A':'B';
}
function visibleOccurrences(){
 const start=iso(state.weekStart),end=iso(plusDays(state.weekStart,6));
 return state.occurrences.filter(o=>o.session_date>=start&&o.session_date<=end&&(o.status!=='cancelled'||window.PlanningKinds?.isSpecial(o.notes)));
}
function render(){
 $('#planningPeriod').textContent=state.period?state.period.name:'Période non configurée';
 if(!state.weekPattern)state.weekPattern=weekPatternFor(state.weekStart);$('#planningPattern').value=state.weekPattern;$('#planningWeek').textContent=`Semaine du ${state.weekStart.toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})} · semaine ${state.weekPattern}`;
 $$('.planning-tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===state.tab)));
 $('#planningWeekView').hidden=state.tab!=='planning';
 $('#planningEventsView').hidden=state.tab!=='events';
 $('#planningSettingsView').hidden=state.tab!=='settings';
 $('#planningFollowupView').hidden=state.tab!=='followup';
 renderGrid();renderEvents();renderSettings();
 if(state.tab==='followup'){
  renderFollowup();
  if(state.followupClass&&!state.followupLoading&&!state.followupError&&state.followupLoadedClass!==state.followupClass)
   void loadFollowupCahier(state.followupClass);
 }
 savePlanningNav();
}
/* Projection des événements intégrée : la grille fonctionne même si planning-calendar-events.js manque. */
function planningWeekEvents(events,weekStart,days=5){
 if(window.PlanningCalendarEvents&&typeof window.PlanningCalendarEvents.weekCells==='function')
  return window.PlanningCalendarEvents.weekCells(events,weekStart,days);
 const timed=[],allDay=[];
 const base=new Date(weekStart);
 if(!Number.isFinite(base.getTime()))return {timed,allDay};
 base.setHours(0,0,0,0);
 const hm=d=>String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
 for(let i=0;i<days;i++){
  const begin=new Date(base);begin.setDate(begin.getDate()+i);
  const finish=new Date(begin);finish.setDate(finish.getDate()+1);
  for(const e of events||[]){
   const start=new Date(e.start_at),end=new Date(e.end_at);
   if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start||start>=finish||end<=begin)continue;
   const from=new Date(Math.max(start.getTime(),begin.getTime()));
   const to=new Date(Math.min(end.getTime(),finish.getTime()));
   const projected={id:e.id,day:iso(begin),title:e.title||'Événement',
    description:e.description||'',class_name:e.class_name||'',event_type:e.event_type||'other',
    status:e.status||'',from:hm(from),to:to.getTime()===finish.getTime()?'24:00':hm(to)};
   if(e.all_day)allDay.push(projected);else timed.push(projected);
  }
 }
 timed.sort((a,b)=>a.day.localeCompare(b.day)||a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
 return {timed,allDay};
}
function renderGrid(){
 const pattern=state.weekPattern||weekPatternFor(state.weekStart);const occ=visibleOccurrences();
 const events=planningWeekEvents(state.events||[],state.weekStart,5);
 const head=DAYS.map((d,i)=>`<th>${d}<br><span>${plusDays(state.weekStart,i).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})}</span></th>`).join('');
 const setupMessage=!state.period
  ?'Aucune année scolaire configurée. Ouvre l’onglet Paramètres pour créer la période.'
  :!state.slots.length
   ?'Aucun créneau enregistré. Ouvre l’onglet Paramètres pour initialiser ton emploi du temps.'
   :!state.occurrences.length&&!events.timed.length&&!events.allDay.length
    ?'Les créneaux existent, mais les séances ne sont pas encore générées. Ouvre l’onglet Paramètres puis clique sur Générer les cours de l’année.'
    :'';
 if(setupMessage){
  $('#planningGrid').innerHTML=`<thead><tr><th>Horaire</th>${head}</tr></thead><tbody><tr><td colspan="6" class="planning-empty">${setupMessage}</td></tr></tbody>`;
  return;
 }
 const timeSet=new Set(state.slots.filter(s=>s.week_pattern==='AB'||s.week_pattern===pattern).map(s=>`${s.start_time.slice(0,5)}|${s.end_time.slice(0,5)}`));occ.forEach(o=>timeSet.add(`${o.start_time.slice(0,5)}|${o.end_time.slice(0,5)}`));
 events.timed.forEach(e=>timeSet.add(`${e.from}|${e.to}`));
 const times=[...timeSet].sort();
 const eventHtml=e=>'<div class="planning-week-event" data-week-event-id="'+esc(e.id)+'"><strong>'+esc(e.title)+'</strong><small>'+esc(e.from)+'–'+esc(e.to)+(e.class_name?' · '+esc(e.class_name):'')+'</small>'+(e.description?'<small>'+esc(e.description)+'</small>':'')+'</div>';
 const allDayRow=events.allDay.length?'<tr><td>Toute la journée</td>'+DAYS.map((_,i)=>{const day=iso(plusDays(state.weekStart,i));return '<td>'+events.allDay.filter(e=>e.day===day).map(eventHtml).join('')+'</td>'}).join('')+'</tr>':'';
 const rows=times.map(t=>{const [a,b]=t.split('|');return `<tr><td>${a}<br>– ${b}</td>${DAYS.map((_,i)=>{const day=plusDays(state.weekStart,i);const items=occ.filter(o=>o.session_date===iso(day)&&o.start_time.slice(0,5)===a&&o.end_time.slice(0,5)===b);return `<td>${items.map(o=>{const meta=window.PlanningKinds?.read(o.notes)||{kind:'cours',detail:''};
  const kind=window.PlanningKinds?.descriptor(meta.kind);
  const special=meta.kind!=='cours';
  const kindText=special?'<small class="planning-special-title">'+esc(kind.icon+' '+kind.label)
   +(meta.detail.trim()?' — '+esc(meta.detail.trim().split(/\r?\n/)[0].slice(0,95)):'')+'</small>':'';
  const linked=special?null:state.cahierSessionsByUid[o.cahier_planning_uid];const href=linked?`prof.html?classe=${encodeURIComponent(o.class_name)}&planning_uid=${encodeURIComponent(o.cahier_planning_uid)}`:'';return `<div class="planning-course-wrap"><button class="planning-course" data-occ="${esc(o.id)}" style="--course-color:${colorFor(o.class_name)}">${esc(o.class_name||o.title||'Événement')}<small>${esc(o.start_time.slice(0,5))}–${esc(o.end_time.slice(0,5))} · ${statusLabel(o.status)}</small>${kindText}${linked?`<small class="planning-linked-title">${esc(linked.chapterTitle)} — ${esc(linked.sessionTitle)}</small>`:''}</button>${linked?`<a class="planning-open-session" href="${href}" title="Ouvrir la séance du cahier">↗ Cahier</a>`:''}</div>`}).join('')+events.timed.filter(e=>e.day===iso(day)&&e.from===a&&e.to===b).map(eventHtml).join('')||'<span class="planning-empty">—</span>'}</td>`}).join('')}</tr>`}).join('');
 $('#planningGrid').innerHTML=`<thead><tr><th>Horaire</th>${head}</tr></thead><tbody>${allDayRow}${rows||(!allDayRow?'<tr><td colspan="6">Aucun créneau pour cette semaine.</td></tr>':'')}</tbody>`;
 $$('#planningGrid [data-occ]').forEach(b=>b.addEventListener('click',()=>editOccurrence(b.dataset.occ)));
}
function colorFor(c){const i=CLASSES.indexOf(c);return ['#71966a','#8ba96b','#5d927d','#a2a66a','#7297a5','#b28c63','#8c9b71','#a48a78','#7d91a8','#9b8ba7'][Math.max(0,i)]}
function statusLabel(s){return ({planned:'À venir',completed:'Effectué',postponed:'Reporté',cancelled:'Annulé'})[s]||s}
function renderEvents(){
 $('#planningEvents').innerHTML=state.events.slice().sort((a,b)=>a.start_at.localeCompare(b.start_at)).map(e=>`<article class="planning-card"><strong>${esc(e.title)}</strong><div class="planning-muted">${new Date(e.start_at).toLocaleString('fr-FR')} · ${e.all_day?'Toute la journée':new Date(e.end_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div><p>${esc(e.description||'')}</p><span class="planning-status ${esc(e.status)}">${statusLabel(e.status)}</span><div class="planning-event-actions"><button class="planning-btn" type="button" data-event-week="${esc(e.id)}">Voir dans ma semaine</button></div></article>`).join('')||'<p class="planning-muted">Aucun événement enregistré.</p>';
}
function showEventInWeek(eventId){
 const event=state.events.find(e=>String(e.id)===String(eventId));
 if(!event)return notify('Événement introuvable. Actualise le planning.',true);
 const start=new Date(event.start_at);
 if(!Number.isFinite(start.getTime()))return notify('La date de cet événement est invalide.',true);
 state.weekStart=mondayOf(start);
 state.weekPattern=weekPatternFor(state.weekStart);
 state.tab='planning';
 render();
 // Le surlignage est effectué uniquement après le rendu de la bonne semaine.
 const node=$$('#planningGrid [data-week-event-id]').find(el=>el.dataset.weekEventId===String(eventId));
 if(node){
  node.classList.add('planning-week-event-focused');
  node.scrollIntoView({behavior:'smooth',block:'center'});
 }else{
  notify('Semaine affichée, mais cet événement ne figure pas dans la grille. Vérifie sa date et son horaire ; la grille affiche seulement du lundi au vendredi.',true);
 }
}

/* Phase 7 — vue en lecture, aucun accès direct en écriture à Supabase. */
function renderFollowup(){
 const root=$('#planningFollowupView');
 if(!root)return;
 if(!window.PlanningFollowup){
  $('#planningFollowupList').textContent='Module de suivi introuvable. Recharge les fichiers complets de la phase 7.';
  return;
 }
 const classSelect=$('#planningFollowupClass'),filterSelect=$('#planningFollowupFilter');
 const classes=[...new Set([...CLASSES,...state.occurrences.map(o=>o.class_name).filter(Boolean)])];
 classSelect.innerHTML='<option value="">Toutes les classes</option>'+classes.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
 classSelect.value=state.followupClass;
 filterSelect.value=state.followupFilter;
 const report=window.PlanningFollowup.summarize({
  occurrences:state.occurrences,className:state.followupClass,
  today:iso(new Date()),fromDate:state.period?.start_date||'',toDate:state.period?.end_date||'',
  sessions:state.followupLoadedClass===state.followupClass?state.followupSessions:null
 });
 const metrics=[
  {id:'completed',label:'Effectués (confirmés)',value:report.counts.completed},
  {id:'upcoming',label:'À venir',value:report.counts.upcoming},
  {id:'toConfirm',label:'Passés à confirmer',value:report.counts.toConfirm},
  {id:'missing',label:'Sans séance associée',value:report.counts.missing},
  {id:'special',label:'Activités particulières',value:report.counts.special}
 ];
 $('#planningFollowupSummary').innerHTML=metrics.map(m=>
  '<button type="button" class="planning-followup-metric" data-followup-filter="'+esc(m.id)+'"'+
  (state.followupFilter===m.id?' aria-pressed="true"':' aria-pressed="false"')+'>'+
  '<strong>'+m.value+'</strong><span>'+esc(m.label)+'</span></button>').join('');
 const all=report.rows.filter(row=>state.followupFilter==='all'
  ||state.followupFilter==='missing'&&row.missing
  ||row.stage===state.followupFilter);
 const max=60,visible=all.slice(0,max);
 const stageNames={completed:'Effectué',upcoming:'À venir',toConfirm:'À confirmer',
  postponed:'Reporté',cancelled:'Annulé',special:'Activité particulière'};
 const list='<p class="planning-muted">'+all.length+' créneau(x) correspondant(s)'+
  (all.length>max?' · '+max+' premiers affichés':'')+' — année scolaire en cours.</p>'+
  (visible.length?'<div class="planning-followup-rows">'+visible.map(o=>{
   const linked=state.cahierSessionsByUid[o.uid]||
    (state.followupLoadedClass===o.class_name?(state.followupSessions||[]).find(s=>s.uid===o.uid):null);
   const headline=o.kind!=='cours'
    ?'Activité : '+(window.PlanningKinds?.descriptor(o.kind).label||o.kind)
    :linked?linked.chapterTitle+' — '+linked.sessionTitle
    :o.linked?'Séance associée au cahier':'Séance du cahier non associée';
   const classAndDate=esc(o.class_name)+' · '+esc(o.session_date)+' · '+esc(o.start_time)+'–'+esc(o.end_time);
   return '<article class="planning-followup-row"><div><strong>'+esc(headline)+'</strong>'+
    '<p class="planning-muted">'+classAndDate+' · '+esc(stageNames[o.stage]||o.stage)+'</p></div>'+
    '<button class="planning-btn" type="button" data-followup-occ="'+esc(o.id)+'">Voir le créneau</button></article>';
  }).join('')+'</div>':'<p class="planning-muted">Aucun créneau pour ce filtre.</p>');
 $('#planningFollowupList').innerHTML=list;
 const sessionsNode=$('#planningFollowupSessions');
 if(!state.followupClass){
  sessionsNode.innerHTML='<p class="planning-muted">Choisis une classe pour comparer les séances créées dans le cahier avec celles placées dans le planning.</p>';
 }else if(state.followupLoading){
  sessionsNode.innerHTML='<p class="planning-muted">Chargement des séances du cahier de '+esc(state.followupClass)+'…</p>';
 }else if(state.followupError){
  sessionsNode.innerHTML='<p class="planning-muted">Cahier de '+esc(state.followupClass)+' indisponible : '+esc(state.followupError)+'</p>';
 }else if(!report.sessions){
  sessionsNode.innerHTML='<p class="planning-muted">Lecture des séances non lancée. Sélectionne à nouveau la classe.</p>';
 }else{
  const unplaced=report.sessions.unplaced;
  sessionsNode.innerHTML='<h3>Séances du cahier non placées · '+esc(state.followupClass)+'</h3>'+
   '<p class="planning-muted">'+report.sessions.placed+' séance(s) placée(s) sur '+report.sessions.total+' dans le cahier. '+
   unplaced.length+' séance(s) non placée(s). Une séance peut occuper plusieurs créneaux.</p>'+
   (unplaced.length?'<ul class="planning-followup-unplaced">'+unplaced.slice(0,30).map(s=>
    '<li>'+esc(s.chapterTitle)+' — '+esc(s.sessionTitle)+'</li>').join('')+'</ul>'+
    (unplaced.length>30?'<p class="planning-muted">Les 30 premières séances sont affichées.</p>':'')
    :'<p class="planning-muted">Toutes les séances existantes du cahier sont présentes au moins une fois dans le planning.</p>');
 }
}
async function loadFollowupCahier(className){
 const request=++state.followupRequest;
 if(!className){state.followupSessions=null;state.followupLoadedClass='';state.followupError='';state.followupLoading=false;renderFollowup();return;}
 state.followupSessions=null;state.followupLoadedClass='';state.followupLoading=true;state.followupError='';
 renderFollowup();
 try{
  const sessions=await getCahierSessions(className);
  if(request!==state.followupRequest||state.followupClass!==className)return;
  state.followupSessions=sessions;state.followupLoadedClass=className;
 }catch(e){
  if(request!==state.followupRequest||state.followupClass!==className)return;
  state.followupError=e.message||'Erreur de lecture';
 }finally{
  if(request===state.followupRequest){state.followupLoading=false;renderFollowup();}
 }
}
function renderSettings(){
 $('#planningSettings').innerHTML=state.period?`<div class="planning-cards"><article class="planning-card"><strong>${esc(state.period.name)}</strong><p>${state.period.start_date} → ${state.period.end_date}</p><p class="planning-muted">${state.slots.length} créneaux récurrents · ${state.occurrences.length} séances générées</p></article><article class="planning-card"><strong>Alternance A/B</strong><p>Référence semaine A : ${esc(state.period.week_a_reference_date)}</p><p class="planning-muted">Les vacances ne décalent pas l’alternance.</p></article></div>${state.slots.length===0?`<div class="planning-card planning-settings-actions"><h3>Initialiser ton emploi du temps</h3><p>Enregistre les 26 créneaux récurrents communiqués, avec les alternances A/B et les classes correspondantes. Aucune séance ne sera encore générée.</p><button class="planning-btn primary" id="planningInitSlots">Enregistrer mes 26 créneaux</button></div>`:`<div class="planning-card planning-settings-actions"><h3>Génération des cours</h3><p>Génère les occurrences à partir des créneaux récurrents enregistrés. Les vacances scolaires de la zone B sont exclues.</p><button class="planning-btn primary" id="planningGenerate">Générer les cours de l’année</button></div>`}`:`<div class="planning-card"><h3>Créer la période 2026–2027</h3><p>Académie d’Amiens · zone B · du 1er septembre 2026 au 3 juillet 2027.</p><form id="periodForm" class="planning-form-grid"><div class="planning-field full"><label>Nom de la période</label><input class="planning-input" name="name" value="Année scolaire 2026-2027" required></div><div class="planning-field"><label>Début</label><input class="planning-input" type="date" name="start_date" value="2026-09-01" required></div><div class="planning-field"><label>Fin</label><input class="planning-input" type="date" name="end_date" value="2027-07-03" required></div><div class="planning-field"><label>Référence de la semaine A</label><input class="planning-input" type="date" name="week_a_reference_date" value="2026-08-31" required></div><div class="planning-field full"><p class="planning-muted">Vacances intégrées automatiquement : Toussaint, Noël, hiver et printemps (zone B), ainsi que le vendredi 7 mai 2027.</p></div><div class="planning-field full"><button class="planning-btn primary">Créer la période</button></div></form></div>`;
}
function openModal(title,body,wide=false){
 $(".planning-dialog").classList.toggle("is-wide",wide);$('#planningDialogTitle').textContent=title;$('#planningDialogBody').innerHTML=body;$('#planningModal').hidden=false}
function closeModal(){$('#planningModal').hidden=true}
async function getCahierSessions(className){
 const {data,error}=await client().from('Cahier').select('classe,contenu').eq('classe',className).maybeSingle();
 if(error)throw error;
 let contenu=data?.contenu??{};
 if(typeof contenu==='string'){try{contenu=JSON.parse(contenu)}catch(e){throw new Error(`Le cahier de ${className} contient un JSON illisible.`)}}
 const chapters=Array.isArray(contenu?.chapitres)?contenu.chapitres:[];
 return chapters.flatMap((chapter,chapterIndex)=>chapter?.archive===true?[]:(Array.isArray(chapter?.seances)?chapter.seances:[]).map((session,sessionIndex)=>({
  uid:session?.planning_uid||'',chapterIndex,sessionIndex,
  chapterTitle:plainText(chapter?.titre)||`Chapitre ${chapterIndex+1}`,
  sessionTitle:plainText(session?.titre)||`Séance ${sessionIndex+1}`
 })).filter(x=>x.uid));
}
function plainText(value){const el=document.createElement('div');el.innerHTML=String(value??'');return (el.textContent||el.innerText||'').trim()}
async function editOccurrence(id){
 const o=state.occurrences.find(x=>x.id===id);if(!o)return;
 let sessions=[];
 try{sessions=await getCahierSessions(o.class_name)}catch(err){notify(`Impossible de lire le cahier de ${o.class_name} : ${err.message}`,true)}
 const meta=window.PlanningKinds.read(o.notes);
 const linked=meta.kind==='cours'?sessions.find(x=>x.uid===o.cahier_planning_uid):null;
 const kindOptions=window.PlanningKinds.types.map(t=>`<option value="${esc(t.value)}" ${t.value===meta.kind?'selected':''}>${esc(t.icon+' '+t.label)}</option>`).join('');
 const linkOptions=[`<option value="">— Aucune séance associée —</option>`,...sessions.map(x=>`<option value="${esc(x.uid)}" ${x.uid===o.cahier_planning_uid?'selected':''}>${esc(x.chapterTitle)} · ${esc(x.sessionTitle)}</option>`)].join('');
 openModal('Modifier la séance',`<form id="occForm"><div class="planning-form-grid"><div class="planning-field"><label>Date</label><input class="planning-input" type="date" name="session_date" value="${esc(o.session_date)}" required></div><div class="planning-field"><label>Classe</label><select class="planning-select" name="class_name">${CLASSES.map(c=>`<option ${c===o.class_name?'selected':''}>${c}</option>`).join('')}</select></div><div class="planning-field"><label>Début</label><input class="planning-input" type="time" name="start_time" value="${esc(o.start_time.slice(0,5))}" required></div><div class="planning-field"><label>Fin</label><input class="planning-input" type="time" name="end_time" value="${esc(o.end_time.slice(0,5))}" required></div><div class="planning-field"><label>Type de créneau</label><select class="planning-select" name="kind">${kindOptions}</select></div><div class="planning-field"><label>État</label><select class="planning-select" name="status">${['planned','completed','postponed','cancelled'].map(s=>`<option value="${s}" ${s===o.status?'selected':''}>${statusLabel(s)}</option>`).join('')}</select></div><div class="planning-field full"><label>Associer à une séance du cahier (${esc(o.class_name)})</label><select class="planning-select" name="cahier_planning_uid">${linkOptions}</select><small class="planning-muted">Le lien utilise l’identifiant stable de la séance : un déplacement dans le planning ne le supprime pas.</small><a id="openLinkedSession" class="planning-btn" style="display:inline-block;width:max-content;margin-top:7px;${linked?'':'opacity:.55;pointer-events:none'}" href="${linked?`prof.html?classe=${encodeURIComponent(o.class_name)}&planning_uid=${encodeURIComponent(linked.uid)}`:'#'}">${linked?'Ouvrir la séance associée':'Aucune séance associée'}</a></div><div class="planning-field full"><label>Intitulé / notes (facultatif)</label><textarea class="planning-textarea" name="notes">${esc(meta.detail)}</textarea></div></div><div class="planning-footer"><button type="button" class="planning-btn" id="occCancel">Fermer</button><button class="planning-btn primary">Enregistrer</button></div></form>`);
 $('#occCancel').onclick=closeModal;
 $('#occForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const kind=String(f.get('kind')||'cours');await query('planning_session_occurrences','update',{session_date:f.get('session_date'),class_name:f.get('class_name'),start_time:f.get('start_time'),end_time:f.get('end_time'),status:f.get('status'),notes:window.PlanningKinds.write(kind,f.get('notes')),cahier_planning_uid:kind==='cours'?(f.get('cahier_planning_uid')||null):null,is_modified:true},[['id','eq',id],['owner_id','eq',state.user.id]]);closeModal();await loadPeriod();render();notify('Séance mise à jour.')}catch(err){notify(err.message,true)}};
 const refreshOpenLink=()=>{const uid=$('#occForm [name="cahier_planning_uid"]')?.value||'';const cls=$('#occForm [name="class_name"]')?.value||'';const a=$('#openLinkedSession');if(!a)return;const active=$('#occForm [name="kind"]')?.value==='cours';const sessionSelect=$('#occForm [name="cahier_planning_uid"]');if(sessionSelect)sessionSelect.disabled=!active;const valid=!!uid&&active;a.href=valid?`prof.html?classe=${encodeURIComponent(cls)}&planning_uid=${encodeURIComponent(uid)}`:'#';a.textContent=valid?'Ouvrir la séance associée':'Aucune séance associée';a.style.opacity=valid?'1':'.55';a.style.pointerEvents=valid?'auto':'none';};
 $('#occForm [name="cahier_planning_uid"]').addEventListener('change',refreshOpenLink);
 $('#occForm [name="kind"]').addEventListener('change',refreshOpenLink);
 refreshOpenLink();
 $('#occForm [name="class_name"]').addEventListener('change',async e=>{try{const list=await getCahierSessions(e.target.value);const label=$('#occForm .planning-field.full label');if(label)label.textContent=`Associer à une séance du cahier (${e.target.value})`;const select=$('#occForm [name="cahier_planning_uid"]');select.innerHTML=`<option value="">— Aucune séance associée —</option>`+list.map(x=>`<option value="${esc(x.uid)}">${esc(x.chapterTitle)} · ${esc(x.sessionTitle)}</option>`).join('');refreshOpenLink();}catch(err){notify(`Impossible de lire le cahier : ${err.message}`,true)}});
}
const SCHOOL_HOLIDAYS=[
 {name:'Toussaint',start:'2026-10-17',end:'2026-11-02'},
 {name:'Noël',start:'2026-12-19',end:'2027-01-04'},
 {name:'Hiver',start:'2027-02-20',end:'2027-03-08'},
 {name:'Printemps',start:'2027-04-17',end:'2027-05-03'}
];

const DEFAULT_SLOTS = [
 // Lundi
 [1,'13:40','15:35','6e4','AB'],
 [1,'15:50','16:45','6e5','B'],
 // Mardi
 [2,'09:25','10:20','5e1','B'],
 [2,'10:40','11:30','6e2','AB'],
 [2,'13:45','15:35','6e1','AB'],
 [2,'15:50','16:45','6e3','A'],
 [2,'15:50','16:45','6e5','B'],
 // Mercredi
 [3,'08:30','09:25','5e1','AB'],
 [3,'09:25','10:20','3e2','A'],
 [3,'09:25','10:20','3e3','B'],
 [3,'10:40','11:30','5e3','AB'],
 [3,'11:30','12:25','5e5','AB'],
 // Jeudi
 [4,'08:30','09:25','6e5','AB'],
 [4,'09:25','10:20','3e3','AB'],
 [4,'10:20','11:30','6e3','AB'],
 [4,'11:30','12:25','6e3','AB'],
 [4,'13:45','14:40','6e3','AB'],
 [4,'15:50','16:45','6e2','AB'],
 // Vendredi
 [5,'08:30','09:25','6e4','AB'],
 [5,'09:25','10:20','6e5','AB'],
 [5,'10:40','11:30','6e1','AB'],
 [5,'11:30','12:25','6e2','AB'],
 [5,'13:45','14:40','3e2','AB'],
 [5,'14:40','15:35','5e3','A'],
 [5,'14:40','15:35','5e5','B'],
 [5,'15:50','16:45','6e3','AB']
];
async function initializeDefaultSlots(){
 if(!state.period)throw new Error('Aucune période scolaire active.');
 if(state.slots.length)throw new Error(`Il existe déjà ${state.slots.length} créneau(x). Pour éviter les doublons, l’initialisation automatique est arrêtée.`);
 const rows=DEFAULT_SLOTS.map(([weekday,start_time,end_time,class_name,week_pattern])=>({
  owner_id:state.user.id,period_id:state.period.id,class_name,weekday,start_time,end_time,week_pattern,
  valid_from:state.period.start_date,valid_until:null,is_active:true
 }));
 const saved=await query('planning_slots','insert',rows);
 if(saved.length!==26)throw new Error(`Seulement ${saved.length} créneaux sur 26 ont été retournés. Vérifie les données avant toute génération.`);
 await loadPeriod();render();notify('Les 26 créneaux de ton emploi du temps ont été enregistrés. Vérifie-les avant de générer les cours.');
}
function isSchoolHoliday(day,holidays){
 const d=iso(day);
 return holidays.some(h=>d>=h.start&&d<h.end)||d==='2027-05-07';
}
async function createPeriod(form){
 const f=new FormData(form),start=f.get('start_date'),end=f.get('end_date'),ref=f.get('week_a_reference_date');
 if(end<=start||ref>start) return notify('Vérifie les dates : la fin doit suivre le début et la référence A doit être antérieure ou égale au début.',true);
 const payload={owner_id:state.user.id,name:f.get('name').trim(),start_date:start,end_date:end,week_a_reference_date:ref,holidays:SCHOOL_HOLIDAYS};
 try{
  const rows=await query('planning_periods','insert',payload);
  const created=rows[0];
  if(!created)throw new Error('La période n’a pas été créée. Vérifie les droits d’accès.');
  state.period=created;await loadPeriod();render();notify('Période annuelle créée. Tu peux maintenant générer les cours.');
 }catch(e){notify(e.message||'Création impossible.',true)}
}
async function generateOccurrences(){
 if(!state.period)return;
 if(!state.slots.length)return notify('Aucun créneau récurrent trouvé dans planning_slots. Il faut d’abord enregistrer les 26 créneaux de ton emploi du temps.',true);
 const p=state.period,holidays=Array.isArray(p.holidays)?p.holidays:SCHOOL_HOLIDAYS;
 const existing=new Set(state.occurrences.map(o=>o.generation_key));
 const toCreate=[];
 for(let d=dateFrom(p.start_date);iso(d)<=p.end_date;d=plusDays(d,1)){
  const dow=(d.getDay()+6)%7+1;if(dow>5||isSchoolHoliday(d,holidays))continue;
  const pattern=weekPatternFor(d);
  for(const slot of state.slots){
   if(!slot.is_active||Number(slot.weekday)!==dow)continue;
   if(slot.week_pattern!=='AB'&&slot.week_pattern!==pattern)continue;
   if(slot.valid_from&&iso(d)<slot.valid_from)continue;
   if(slot.valid_until&&iso(d)>slot.valid_until)continue;
   const key=`${slot.id}:${iso(d)}`;
   if(existing.has(key))continue;
   toCreate.push({owner_id:state.user.id,period_id:p.id,slot_id:slot.id,generation_key:key,source_type:'recurring',class_name:slot.class_name,session_date:iso(d),start_time:slot.start_time,end_time:slot.end_time,status:'planned',is_modified:false});
  }
 }
 if(!toCreate.length)return notify('Aucune nouvelle occurrence à générer : les cours sont déjà générés ou aucun créneau ne correspond.');
 try{
  let count=0;
  for(let i=0;i<toCreate.length;i+=100){
   const batch=toCreate.slice(i,i+100);
   const {data,error}=await client().from('planning_session_occurrences').upsert(batch,{onConflict:'owner_id,period_id,generation_key',ignoreDuplicates:true}).select('id');
   if(error)throw error;count+=(data||[]).length;
  }
  await loadPeriod();render();notify(`${count} occurrences générées. Les semaines A/B et les vacances ont été prises en compte.`);
 }catch(e){notify(e.message||'Génération impossible.',true)}
}

/* Associations en série : aperçu obligatoire et écritures conditionnelles. */
function planningBulkSignature(plan){
 return plan.items.map(x=>[x.id,x.uid,x.session_date,x.start_time,x.end_time,x.status,x.originalNotes??'<null>'].join('|')).join('\n');
}
async function openPlanningBulk(){
 if(!state.period||!state.occurrences.length)return notify('Aucune séance de planning générée à associer.',true);
 if(!window.PlanningBatch||!window.PlanningKinds)return notify('Les modules du planning sont incomplets : actualise la page.',true);
 const options=CLASSES.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
 openModal('Associer les séances en série',
  '<p class="planning-muted">La correspondance automatique est <strong>indicative</strong>. Pour chaque créneau, tu peux choisir une séance du cahier, une évaluation, une intervention, une sortie/voyage scolaire, une absence ou rien. Aucune écriture avant validation explicite.</p>'
  +'<form id="planningBulkForm" class="planning-form-grid">'
  +'<div class="planning-field"><label for="bulkClass">Classe</label><select id="bulkClass" class="planning-select" name="class_name" required>'+options+'</select></div>'
  +'<div class="planning-field"><label for="bulkStart">À partir du</label><input id="bulkStart" class="planning-input" type="date" name="from_date" value="'+esc(iso(state.weekStart))+'" required></div>'
  +'<div class="planning-field"><label for="bulkEnd">Jusqu’au</label><input id="bulkEnd" class="planning-input" type="date" name="to_date" value="'+esc(state.period.end_date)+'" required></div>'
  +'<div class="planning-field"><label for="bulkSession">Séance de départ (facultatif)</label><select id="bulkSession" class="planning-select" name="first_uid"><option value="">Première séance non encore associée</option></select></div>'
  +'<div class="planning-field full"><small class="planning-muted">Suggestion initiale : une séance différente par créneau. Tu pourras la répéter, choisir un autre type de créneau ou laisser le cours sans association. Maximum 40 lignes par prévisualisation.</small></div>'
  +'<div class="planning-field full"><button class="planning-btn primary" type="submit">🔎 Prévisualiser les associations</button></div>'
  +'</form>'
  +'<div id="planningBulkPreview" aria-live="polite"></div>'
  +'<div class="planning-footer"><button type="button" class="planning-btn" id="planningBulkCancel">Fermer sans enregistrer</button>'
  +'<button type="button" class="planning-btn primary" id="planningBulkApply" hidden>💾 Confirmer les associations</button></div>',
  true);
 const form=$('#planningBulkForm'),preview=$('#planningBulkPreview'),save=$('#planningBulkApply');
 let proposed=null;
 const reset=()=>{proposed=null;preview.innerHTML='';save.hidden=true};
 preview.addEventListener('change',e=>{
  const select=e.target.closest('.planning-bulk-choice');
  if(!select||!proposed)return;
  const entry=proposed.items.find(x=>String(x.id)===select.dataset.occId);
  if(!entry)return;
  const selected=proposed.availableSessions.find(session=>session.uid===select.value);
  if(select.value.startsWith('kind:')){
   const kind=select.value.slice(5);
   if(!window.PlanningKinds.types.some(t=>t.value===kind&&kind!=='cours')){
    notify('Type de créneau inconnu : refais la prévisualisation.',true);reset();return;
   }
   entry.kind=kind;entry.uid='';entry.chapterTitle='';entry.sessionTitle='';
  }else{
   if(select.value&&!selected){notify('Séance inconnue : refais la prévisualisation.',true);reset();return;}
   entry.kind='cours';
   entry.uid=selected?.uid||'';
   entry.chapterTitle=selected?.chapterTitle||'';
   entry.sessionTitle=selected?.sessionTitle||'';
  }
  const detail=preview.querySelector('.planning-bulk-detail[data-occ-id="'+entry.id+'"]');
  if(detail)detail.hidden=entry.kind==='cours';
  updateSelectedCount();
 });
 preview.addEventListener('input',e=>{
  const input=e.target.closest('.planning-bulk-detail');
  if(!input||!proposed)return;
  const entry=proposed.items.find(x=>String(x.id)===input.dataset.occId);
  if(entry)entry.detail=input.value;
 });
 const updateSelectedCount=()=>{
  const count=proposed?.items.filter(x=>x.uid||x.kind!=='cours').length||0;
  const label=preview.querySelector('#planningBulkSelectedCount');
  if(label)label.textContent=count+' créneau(x) sélectionné(s).';
  save.hidden=count===0;
 };
 const fillSessions=async()=>{
  const select=form.elements.first_uid;
  select.disabled=true;
  try{
   const all=await getCahierSessions(form.elements.class_name.value);
   select.innerHTML='<option value="">Première séance non encore associée</option>'
    +all.map(s=>'<option value="'+esc(s.uid)+'">'+esc(s.chapterTitle+' — '+s.sessionTitle)+'</option>').join('');
  }catch(e){select.innerHTML='<option value="">Cahier non disponible</option>';notify('Lecture des séances impossible : '+e.message,true)}
  finally{select.disabled=false}
 };
 form.addEventListener('input',reset);
 form.addEventListener('change',e=>{reset();if(e.target.name==='class_name')fillSessions()});
 $('#planningBulkCancel').onclick=closeModal;
 form.addEventListener('submit',async e=>{
  e.preventDefault();reset();
  const values=new FormData(form),className=String(values.get('class_name')||'');
  const fromDate=String(values.get('from_date')||''),toDate=String(values.get('to_date')||'');
  try{
   if(!state.period||fromDate<state.period.start_date||toDate>state.period.end_date)
    throw new Error('Choisis des dates comprises dans la période scolaire du planning.');
   const sessions=await getCahierSessions(className);
   const proposal=window.PlanningBatch.plan({
    occurrences:state.occurrences,sessions,className,fromDate,toDate,
    firstUid:String(values.get('first_uid')||''),limit:40
   });
   proposed={...proposal,periodId:state.period.id,ownerId:state.user.id,
    baseSignature:planningBulkSignature(proposal),availableSessions:sessions};
   const sessionOptions=(chosen)=>'<option value="">— Ne pas associer ce créneau —</option>'
    +window.PlanningKinds.types.filter(t=>t.value!=='cours').map(t=>'<option value="kind:'+esc(t.value)+'">'+esc(t.icon+' '+t.label)+'</option>').join('')
    +sessions.map(session=>'<option value="'+esc(session.uid)+'"'
    +(session.uid===chosen?' selected':'')+'>'+esc(session.chapterTitle+' — '+session.sessionTitle)+'</option>').join('');
   const rows=proposal.items.map(x=>'<tr><td>'+esc(x.session_date)+'</td><td>'
    +esc(x.start_time.slice(0,5))+'–'+esc(x.end_time.slice(0,5))+'</td><td>'
    +'<select class="planning-select planning-bulk-choice" data-occ-id="'+esc(x.id)+'"'
    +' aria-label="Séance associée au cours du '+esc(x.session_date)+'">'
    +sessionOptions(x.uid)+'</select>'
    +'<input class="planning-input planning-bulk-detail" data-occ-id="'+esc(x.id)+'" type="text" maxlength="200" placeholder="Intitulé facultatif (ex. contrôle chapitre 2)" value="'+esc(x.originalNotes||'')+'" hidden></td></tr>').join('');
   preview.innerHTML='<h3>Proposition pour '+esc(className)+'</h3>'
    +'<p><strong id="planningBulkSelectedCount">'+proposal.items.filter(x=>x.uid).length+' créneau(x) sélectionné(s).</strong> '
    +proposal.stats.existing+' créneau(x) déjà associés, '
    +proposal.stats.modified+' créneau(x) modifiés manuellement ignorés. '
    +proposal.stats.cancelled+' cours annulés ou reportés ignorés, '
    +proposal.stats.exceptions+' créneau(x) particuliers ignorés.</p>'
    +(rows?'<div class="planning-bulk-table"><table><thead><tr><th>Date</th><th>Horaire</th><th>Séance à associer (modifiable)</th></tr></thead><tbody>'+rows+'</tbody></table></div>':
      '<p class="planning-muted">Aucun créneau libre compatible ou aucune séance du cahier restante sur cette période.</p>')
    +'<p class="planning-muted"><strong>Important :</strong> la répartition automatique est une suggestion. Choisis une séance, une évaluation, une intervention, une sortie ou une absence. Tu peux répéter une séance ou laisser un créneau vide. Les liens existants et les horaires restent inchangés.</p>';
   updateSelectedCount();
  }catch(err){notify('Prévisualisation impossible : '+err.message,true)}
 });
 save.onclick=async()=>{
  const selected=proposed?.items.filter(item=>item.uid||item.kind!=='cours')||[];
  if(!proposed||state.busy||!selected.length)return;
  if(!confirm('Confirmer les '+selected.length+' créneau(x) sélectionné(s) pour '+proposed.className+' ? Vérifie les séances, les évaluations et les absences. Cette opération modifiera le planning Supabase.'))return;
  state.busy=true;save.disabled=true;
  let completed=0;
  try{
   // Recharger et revérifier l’aperçu avant toute écriture.
   await loadPeriod();
   if(!state.period||state.period.id!==proposed.periodId||state.user.id!==proposed.ownerId)
    throw new Error('La période ou la session a changé. Refais la prévisualisation.');
   const sessions=await getCahierSessions(proposed.className);
   const now=window.PlanningBatch.plan({
    occurrences:state.occurrences,sessions,className:proposed.className,
    fromDate:proposed.fromDate,toDate:proposed.toDate,
    firstUid:proposed.firstUid,limit:proposed.limit
   });
   if(planningBulkSignature(now)!==proposed.baseSignature)
    throw new Error('Le planning ou les séances ont changé depuis l’aperçu. Ferme la fenêtre et recommence.');
   const knownUids=new Set(sessions.map(session=>session.uid));
   if(selected.some(item=>item.uid&&!knownUids.has(item.uid)))
    throw new Error('Une séance sélectionnée a disparu du cahier : aucune sauvegarde lancée.');
   for(const item of selected){
    // Protection contre un changement entre deux clics/onglets : condition
    // SQL sur l’état de la ligne + refus si déjà associée.
    const payload=item.kind==='cours'
      ?{cahier_planning_uid:item.uid,is_modified:true}
      :{cahier_planning_uid:null,notes:window.PlanningKinds.write(item.kind,item.detail),is_modified:true};
    let request=client().from('planning_session_occurrences')
      .update(payload)
      .eq('id',item.id).eq('owner_id',state.user.id)
      .eq('period_id',proposed.periodId).eq('class_name',proposed.className)
      .eq('session_date',item.session_date)
      .eq('start_time',item.start_time).eq('end_time',item.end_time)
      .eq('status',item.status).eq('is_modified',false)
      .is('cahier_planning_uid',null);
    request=item.originalNotes===null?request.is('notes',null):request.eq('notes',item.originalNotes);
    const {data,error}=await request.select('id');
    if(error)throw new Error('Créneau '+item.session_date+' : '+error.message);
    if(!Array.isArray(data)||data.length!==1)
      throw new Error('Le créneau du '+item.session_date+' a changé ou n’est plus accessible. Association refusée.');
    completed++;
   }
   await loadPeriod();render();closeModal();
   notify(completed+' association(s) enregistrée(s) et vérifiée(s) pour '+proposed.className+'.');
  }catch(err){
   try{await loadPeriod();render()}catch(_){}
   notify('Association interrompue : '+completed+' sur '+selected.length+' enregistrée(s). '+err.message,true);
   reset();
  }finally{state.busy=false;save.disabled=false}
 };
 await fillSessions();
}

async function addEvent(){
 openModal('Ajouter un événement',`<form id="eventForm"><div class="planning-form-grid"><div class="planning-field full"><label>Intitulé</label><input class="planning-input" name="title" required maxlength="180" placeholder="Conseil de classe, réunion…"></div><div class="planning-field"><label>Début</label><input class="planning-input" type="datetime-local" name="start_at" required></div><div class="planning-field"><label>Fin</label><input class="planning-input" type="datetime-local" name="end_at" required></div><div class="planning-field"><label>Type</label><select class="planning-select" name="event_type"><option value="meeting">Conseil de classe / réunion</option><option value="outing">Sortie ou voyage</option><option value="training">Formation</option><option value="other">Autre</option></select></div><div class="planning-field"><label>Classe (facultatif)</label><select class="planning-select" name="class_name"><option value="">Toutes</option>${CLASSES.map(c=>`<option>${c}</option>`).join('')}</select></div><div class="planning-field full"><label>Description</label><textarea class="planning-textarea" name="description"></textarea></div></div><div class="planning-footer"><button type="button" class="planning-btn" id="eventCancel">Annuler</button><button class="planning-btn primary">Créer l’événement</button></div></form>`);
 $('#eventCancel').onclick=closeModal;
 $('#eventForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(f.get('end_at')<=f.get('start_at'))return notify('La fin doit être après le début.',true);try{await query('planning_events','insert',{owner_id:state.user.id,period_id:state.period?.id||null,title:f.get('title'),description:f.get('description'),event_type:f.get('event_type'),start_at:new Date(f.get('start_at')).toISOString(),end_at:new Date(f.get('end_at')).toISOString(),status:'upcoming',class_name:f.get('class_name')||null,all_day:false});closeModal();await loadPeriod();render();notify('Événement ajouté.')}catch(err){notify(err.message,true)}};
}
function bind(){
 $('#planningSettings').addEventListener('submit',e=>{if(e.target.id==='periodForm'){e.preventDefault();createPeriod(e.target)}});
 $('#planningSettings').addEventListener('click',e=>{
  if(e.target.id==='planningGenerate')generateOccurrences();
  if(e.target.id==='planningInitSlots')initializeDefaultSlots().catch(err=>notify(err.message||'Initialisation impossible.',true));
 });
 $('#planningPrev').onclick=()=>{state.weekStart=plusDays(state.weekStart,-7);state.weekPattern=weekPatternFor(state.weekStart);render()};
 $('#planningNext').onclick=()=>{state.weekStart=plusDays(state.weekStart,7);state.weekPattern=weekPatternFor(state.weekStart);render()};
 $('#planningToday').onclick=()=>{state.weekStart=mondayOf(new Date());state.weekPattern=weekPatternFor(state.weekStart);render()};
 $('#planningPattern').onchange=e=>{state.weekPattern=e.target.value;render()};
 $$('.planning-tabs button').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;render();if(state.tab==='followup'&&state.followupClass&&state.followupLoadedClass!==state.followupClass&&!state.followupLoading)loadFollowupCahier(state.followupClass)});
 window.addEventListener('pagehide',savePlanningNav);window.addEventListener('scroll',()=>{clearTimeout(window.__planningNavTimer);window.__planningNavTimer=setTimeout(savePlanningNav,250)},{passive:true});
 $('#planningEvents').addEventListener('click',e=>{const button=e.target.closest('[data-event-week]');if(button)showEventInWeek(button.dataset.eventWeek)});
 $('#planningFollowupClass').addEventListener('change',e=>{state.followupClass=e.target.value;loadFollowupCahier(state.followupClass)});
 $('#planningFollowupFilter').addEventListener('change',e=>{state.followupFilter=e.target.value;renderFollowup()});
 $('#planningFollowupSummary').addEventListener('click',e=>{const item=e.target.closest('[data-followup-filter]');if(!item)return;state.followupFilter=item.dataset.followupFilter;renderFollowup()});
 $('#planningFollowupList').addEventListener('click',e=>{const item=e.target.closest('[data-followup-occ]');if(item)editOccurrence(item.dataset.followupOcc)});
 $('#planningAddEvent').onclick=addEvent;
 const weekAddEvent=$('#planningWeekAddEvent');if(weekAddEvent)weekAddEvent.onclick=addEvent;
 $('#planningBulkLink').onclick=openPlanningBulk;
 $('#planningRefresh').onclick=async()=>{try{await loadPeriod();render();notify('Planning actualisé.')}catch(e){notify(e.message,true)}};
 $('#planningModalClose').onclick=closeModal;
 $('#planningModal').addEventListener('click',e=>{if(e.target.id==='planningModal')closeModal()});
}
document.addEventListener('DOMContentLoaded',()=>{bind();init()},{once:true});
})();
