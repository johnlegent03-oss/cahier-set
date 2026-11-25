/* Planning SVT — fonctionnement autonome sur les tables planning V5 */
(() => {
'use strict';
const $ = (s,root=document) => root.querySelector(s);
const $$ = (s,root=document) => [...root.querySelectorAll(s)];
const CLASSES = ['6e1','6e2','6e3','6e4','6e5','5e1','5e3','5e5','3e2','3e3'];
const DAYS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi'];
const state = {user:null,period:null,slots:[],occurrences:[],events:[],cahierSessionsByUid:{},atelierActivitiesBySession:{},atelierBankPromise:null,atelierBankError:'',weekStart:mondayOf(new Date()),weekPattern:'',view:'week',tab:'planning',busy:false,
 followupClass:'',followupFilter:'missing',followupSessions:null,followupLoadedClass:'',followupLoading:false,followupError:'',followupRequest:0,quickDoneBusy:false,remarksRows:null,remarksLoading:false,remarksError:'',remarksRequest:0,remarksFrom:'',remarksTo:''};
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
  filters.forEach(([k,op,v])=>{q=op==='eq'?q.eq(k,v):op==='gte'?q.gte(k,v):op==='lte'?q.lte(k,v):op==='is'?q.is(k,v):q});
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
/* Mise à jour ciblée de l'ancien créneau du jeudi pour les 6e3.
   Les occurrences déjà générées gardent leurs identifiants, liens, notes et états.
   Ne modifie jamais un cours déplacé à un autre horaire ou un autre jour. */
async function correctThursday6e3Start(){
 if(!state.period||!state.user)return {slots:0,courses:0};
 const candidates=state.slots.filter(slot=>Number(slot.weekday)===4
  &&slot.class_name==='6e3'
  &&String(slot.end_time||'').slice(0,5)==='11:30'
  &&['10:20','10:40'].includes(String(slot.start_time||'').slice(0,5)));
 let fixedSlots=0,fixedCourses=0;
 for(const slot of candidates){
  const outdated=state.occurrences.filter(occ=>String(occ.slot_id||'')===String(slot.id)
   &&occ.class_name==='6e3'
   &&String(occ.start_time||'').slice(0,5)==='10:20'
   &&String(occ.end_time||'').slice(0,5)==='11:30'
   &&dateFrom(occ.session_date).getDay()===4);
  for(let offset=0;offset<outdated.length;offset+=100){
   const ids=outdated.slice(offset,offset+100).map(occ=>occ.id);
   const {data,error}=await client().from('planning_session_occurrences')
    .update({start_time:'10:40:00'})
    .eq('owner_id',state.user.id).eq('period_id',state.period.id)
    .eq('slot_id',slot.id).eq('class_name','6e3')
    .eq('start_time','10:20:00').eq('end_time','11:30:00')
    .in('id',ids).select('id');
   if(error)throw new Error('Correction des cours du jeudi impossible : '+error.message);
   fixedCourses+=(data||[]).length;
  }
  if(String(slot.start_time||'').slice(0,5)==='10:20'){
   const {data,error}=await client().from('planning_slots')
    .update({start_time:'10:40:00'})
    .eq('id',slot.id).eq('owner_id',state.user.id)
    .eq('period_id',state.period.id).eq('weekday',4)
    .eq('class_name','6e3').eq('start_time','10:20:00')
    .eq('end_time','11:30:00').select('id');
   if(error)throw new Error('Correction du créneau récurrent impossible : '+error.message);
   fixedSlots+=(data||[]).length;
  }
 }
 if(fixedSlots||fixedCourses)await loadPeriod();
 return {slots:fixedSlots,courses:fixedCourses};
}
async function init(){
 document.body.classList.add('planning-page');
 try{
  const {data:{session},error}=await client().auth.getSession();if(error)throw error;
  if(!session?.user)throw new Error('Session professeur absente. Connecte-toi depuis l’espace professeur.');
  state.user=session.user;
  await loadPeriod();
   let timetableCorrection={slots:0,courses:0};
   try{timetableCorrection=await correctThursday6e3Start();}
   catch(error){console.error('Correction du jeudi 6e3 :',error);notify(error.message||'Impossible de corriger le créneau du jeudi 6e3.',true);}
   restorePlanningNav();
  // Ne pas masquer les étapes de configuration derrière un planning vide.
  if(!state.period||!state.slots.length||!state.occurrences.length)state.tab='settings';
  if(!state.weekPattern)state.weekPattern=weekPatternFor(state.weekStart);
  render();
   if(timetableCorrection.slots||timetableCorrection.courses)
    notify('Jeudi 6e3 corrigé : 10h40–11h30. '+timetableCorrection.courses+' cours existant(s) mis à jour, sans modifier leurs associations.');
   if(Number.isFinite(state._restoreScroll))requestAnimationFrame(()=>{window.scrollTo({top:state._restoreScroll,left:0,behavior:'auto'});savePlanningNav();delete state._restoreScroll;});
 }catch(e){notify(e.message||'Impossible de charger le Planning.',true)}
}
async function loadPeriod(){
 state.atelierBankPromise=null;state.atelierBankError='';
 const rows=await query('planning_periods','select',null,[['owner_id','eq',state.user.id]]);
 const today=iso(new Date());
 state.period=rows.find(p=>p.start_date<=today&&p.end_date>=today)||rows.sort((a,b)=>b.start_date.localeCompare(a.start_date))[0]||null;
 if(!state.period){
  state.slots=[];state.occurrences=[];state.events=[];state.cahierSessionsByUid={};state.atelierActivitiesBySession={};state.atelierBankPromise=null;state.atelierBankError='';
  state.followupSessions=null;state.followupLoadedClass='';state.followupRequest++;state.followupLoading=false;
 state.remarksRows=null;state.remarksLoading=false;state.remarksError='';state.remarksRequest++;
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
 state.remarksRows=null;state.remarksLoading=false;state.remarksError='';state.remarksRequest++;
 await loadLinkedCahierSessions();
}
async function loadLinkedCahierSessions(){
 state.cahierSessionsByUid={};state.atelierActivitiesBySession={};
 const linked=state.occurrences.filter(o=>linkedIds(o).length);
 const classes=[...new Set(linked.map(o=>o.class_name).filter(Boolean))];
 await Promise.all(classes.map(async className=>{
  try{const elements=await getPlanningElements(className);elements.forEach(item=>{
    const linked={...item,className};
    state.cahierSessionsByUid[className+'::'+item.uid]=linked;
    if(item.type==='atelier-activity'){
     const key=className+'::'+item.sessionUid;
     (state.atelierActivitiesBySession[key]||(state.atelierActivitiesBySession[key]=[])).push(linked);
    }
   });}
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
  if(state.period&&!state.remarksLoading&&!state.remarksError&&state.remarksRows===null)
   void loadRemarks();
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
// Supprime les cellules vides créées dans un cours long par les horaires d'autres jours.
function fillContinuingCells(times,hasAllDayRow=false){
 const table=$('#planningGrid');
 const rows=Array.from(table?.tBodies?.[0]?.rows||[]).slice(hasAllDayRow?1:0);
 const cells=rows.map(row=>Array.from(row.cells).slice(1));
 for(let day=0;day<DAYS.length;day++){
  for(let i=0;i<times.length;i++){
   const cell=cells[i]?.[day];
   if(!cell||!cell.isConnected||!cell.querySelector('.planning-course,.planning-week-event'))continue;
   const end=times[i].split('|')[1];
   let span=1;
   for(let j=i+1;j<times.length;j++){
    const [start,finish]=times[j].split('|');
    if(start>=end||finish>end)break;
    const following=cells[j]?.[day];
    if(!following||!following.isConnected||following.querySelector('.planning-course,.planning-week-event'))break;
    following.remove();span++;
   }
   if(span>1){
    cell.rowSpan=span;
    cell.classList.add('planning-spanning-cell');
    cell.style.setProperty('--planning-span-height',String(span*76-16)+'px');
   }
  }
 }
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
 const rows=times.map(t=>{
 const [a,b]=t.split('|');
 return `<tr><td>${a}<br>– ${b}</td>${DAYS.map((_,i)=>{
  const day=plusDays(state.weekStart,i);
  const items=occ.filter(o=>o.session_date===iso(day)&&o.start_time.slice(0,5)===a&&o.end_time.slice(0,5)===b);
  const courses=items.map(o=>{
   const meta=window.PlanningKinds?.read(o.notes)||{kind:'cours',detail:''};
   const kind=window.PlanningKinds?.descriptor(meta.kind);
   const special=meta.kind!=='cours';
   const kindText=special?'<small class="planning-special-title">'+esc(kind.icon+' '+kind.label)
    +(meta.detail.trim()?' — '+esc(meta.detail.trim().split(/\r?\n/)[0].slice(0,95)):'')+'</small>':'';
   const draftHtml=meta.drafts?.length
    ?'<div class="planning-course-drafts"><small class="planning-draft-status">✏️ Préparation privée · non publiée</small>'
     +meta.drafts.map(item=>'<small class="planning-draft-title">'+esc((item.type==='seance'?'📘 Séance : ':'🧪 Activité : ')+item.title)+'</small>').join('')+'</div>'
    :'';
   const ids=linkedIds(o);
   const explicit=new Set(ids);
   const elements=ids.flatMap(uid=>{
    const item=state.cahierSessionsByUid[o.class_name+'::'+uid];
    if(!item)return [];
    return item.type==='session'?[item,...(state.atelierActivitiesBySession[o.class_name+'::'+item.uid]||[])
     .filter(child=>!explicit.has(child.uid))]:[item];
   });
   const linkedHtml=elements.length?'<div class="planning-course-links">'+elements.map((item,n)=>
    '<small class="planning-linked-title">'+(ids.length>1?(n+1)+'. ':'')+esc(item.chapterTitle)+' — '+esc(item.type==='atelier-activity'?item.parentSessionTitle+' / '+item.sessionTitle:item.sessionTitle)+'</small>').join('')+'</div>'
    :ids.length?'<small class="planning-linked-title">⚠ Élément du cahier introuvable</small>':'';
   const hrefs=elements.map(item=>'<a class="planning-open-session" href="'+esc(cahierElementHref(o.class_name,item))+'" title="'+esc(item.type==='atelier-bank'?'Ouvrir la fiche dans l’atelier':item.type==='atelier-activity'?'Ouvrir la fiche de l’atelier':'Ouvrir cet élément du cahier')+'">↗ '+esc(item.sessionTitle)+'</a>').join('');
   const quickDone=window.PlanningCompletion?.eligible(o,iso(new Date()))?'<button type="button" class="planning-quick-done" data-quick-done="'+esc(o.id)+'" title="Confirmer ce cours comme effectué">✓ Effectué</button>':'';
   return '<div class="planning-course-wrap"><button class="planning-course" data-occ="'+esc(o.id)+'" style="--course-color:'+colorFor(o.class_name)+'">'
    +esc(o.class_name||o.title||'Événement')+'<small>'+esc(o.start_time.slice(0,5))+'–'+esc(o.end_time.slice(0,5))+' · '+statusLabel(o.status)+'</small>'
    +kindText+draftHtml+linkedHtml+'</button>'+hrefs+quickDone+'</div>';
  }).join('');
  const timed=events.timed.filter(e=>e.day===iso(day)&&e.from===a&&e.to===b).map(eventHtml).join('');
  return '<td>'+(courses+timed||'<span class="planning-empty">—</span>')+'</td>';
 }).join('')}</tr>`;
}).join('');
  $('#planningGrid').innerHTML=`<thead><tr><th>Horaire</th>${head}</tr></thead><tbody>${allDayRow}${rows||(!allDayRow?'<tr><td colspan="6">Aucun créneau pour cette semaine.</td></tr>':'')}</tbody>`;
 fillContinuingCells(times,events.allDay.length>0);
 $$('#planningGrid [data-occ]').forEach(b=>b.addEventListener('click',()=>editOccurrence(b.dataset.occ)));
 $$('#planningGrid [data-quick-done]').forEach(b=>b.addEventListener('click',()=>openQuickCompletion(b.dataset.quickDone)));
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
  {id:'missing',label:'Sans contenu préparé',value:report.counts.missing},
  {id:'prepared',label:'Préparations privées',value:report.counts.prepared},
  {id:'special',label:'Activités particulières',value:report.counts.special}
 ];
 $('#planningFollowupSummary').innerHTML=metrics.map(m=>
  '<button type="button" class="planning-followup-metric" data-followup-filter="'+esc(m.id)+'"'+
  (state.followupFilter===m.id?' aria-pressed="true"':' aria-pressed="false"')+'>'+
  '<strong>'+m.value+'</strong><span>'+esc(m.label)+'</span></button>').join('');
 const all=report.rows.filter(row=>state.followupFilter==='all'
  ||state.followupFilter==='missing'&&row.missing
  ||state.followupFilter==='prepared'&&row.prepared
  ||row.stage===state.followupFilter);
 const max=60,visible=all.slice(0,max);
 const stageNames={completed:'Effectué',upcoming:'À venir',toConfirm:'À confirmer',
  postponed:'Reporté',cancelled:'Annulé',special:'Activité particulière'};
 const list='<p class="planning-muted">'+all.length+' créneau(x) correspondant(s)'+
  (all.length>max?' · '+max+' premiers affichés':'')+' — année scolaire en cours.</p>'+
  (visible.length?'<div class="planning-followup-rows">'+visible.map(o=>{
   const linked=state.cahierSessionsByUid[o.class_name+'::'+o.uid]||
    (state.followupLoadedClass===o.class_name?(state.followupSessions||[]).find(s=>s.uid===o.uid):null);
   const headline=o.kind!=='cours'
    ?'Activité : '+(window.PlanningKinds?.descriptor(o.kind).label||o.kind)
    :linked?linked.chapterTitle+' — '+linked.sessionTitle
    :o.linked?'Élément(s) du cahier associé(s)':o.prepared?'✏️ Prévu : '+o.draftTitle+(o.draftCount>1?' (+'+(o.draftCount-1)+' autre(s))':''):'Aucune préparation ni élément du cahier';
   const classAndDate=esc(o.class_name)+' · '+esc(o.session_date)+' · '+esc(o.start_time)+'–'+esc(o.end_time);
   return '<article class="planning-followup-row"><div><strong>'+esc(headline)+'</strong>'+
    '<p class="planning-muted">'+classAndDate+' · '+esc(stageNames[o.stage]||o.stage)+'</p></div>'+
    '<div class="planning-followup-actions">'+
    (window.PlanningCompletion?.eligible(o,iso(new Date()))?
     '<button class="planning-btn planning-quick-done" type="button" data-quick-done="'+esc(o.id)+'">✓ Effectué</button>':'')+
    '<button class="planning-btn" type="button" data-followup-occ="'+esc(o.id)+'">Voir le créneau</button></div></article>';
  }).join('')+'</div>':'<p class="planning-muted">Aucun créneau pour ce filtre.</p>');
 $('#planningFollowupList').innerHTML=list;
 renderRemarks();
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

/* Phase 9 : lecture des remarques, sans noms d’élèves ni écriture. */
function renderRemarks(){
 const box=$('#planningRemarksSummary');
 const history=$('#planningRemarksHistory');
 if(!box||!history)return;
 const from=state.remarksFrom||state.period?.start_date||'';
 const to=state.remarksTo||state.period?.end_date||'';
 const fromInput=$('#planningRemarksFrom'),toInput=$('#planningRemarksTo');
 for(const input of [fromInput,toInput]){
  if(!input)continue;
  input.min=state.period?.start_date||'';
  input.max=state.period?.end_date||'';
 }
 if(fromInput)fromInput.value=from;
 if(toInput)toInput.value=to;
 function message(msg){
  box.innerHTML='<p class="planning-muted">'+esc(msg)+'</p>';
  history.innerHTML='';
 }
 if(!window.PlanningRemarks?.summarize||!window.PlanningRemarks?.byDate){
  message('Module de remarques indisponible : vérifie les fichiers de la phase 10.');return;
 }
 if(state.remarksLoading){message('Chargement des remarques depuis le suivi comportemental…');return;}
 if(state.remarksError){message('Remarques indisponibles : '+state.remarksError+'. Réessaie avec « Actualiser les remarques ».');return;}
 if(!Array.isArray(state.remarksRows)){message('Remarques non encore chargées.');return;}
 if(from>to){message('La date de début doit précéder la date de fin.');return;}
 if(from<(state.period?.start_date||'')||to>(state.period?.end_date||'')){
  message('Choisis des dates comprises dans l’année scolaire.');return;
 }
 const allowed=[...new Set([...CLASSES,...state.occurrences.map(o=>o.class_name).filter(Boolean)])];
 const options={className:state.followupClass,classes:allowed,fromDate:from,toDate:to};
 const c=window.PlanningRemarks.summarize(state.remarksRows,options);
 const stats=[
  [c.total,'Remarques négatives'],
  [c.bavardage,'Bavardages'],
  [c.materiel,'Oublis de matériel'],
  [c.travail,'Travail non fait'],
  [c.autres,'Autres remarques'],
  [c.participation,'Participations positives']
 ];
 box.innerHTML='<div class="planning-remarks-counters">'+stats.map(([count,label])=>
  '<div class="planning-remarks-counter"><strong>'+count+'</strong><span>'+esc(label)+'</span></div>').join('')+'</div>';
 const rows=window.PlanningRemarks.byDate(state.remarksRows,options);
 const max=60,visible=rows.slice(0,max);
 history.innerHTML='<h4>Remarques par date</h4>'+
  '<p class="planning-muted">'+rows.length+' journée(s)-classe avec observations du '+esc(from)+' au '+esc(to)+
  (rows.length>max?' · '+max+' plus récentes affichées':'')+'.</p>'+
  (visible.length?'<div class="planning-remarks-days">'+visible.map(item=>{
   const day=dateFrom(item.date).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
   const entries=[
    [item.counts.bavardage,'bavardage(s)'],
    [item.counts.materiel,'oubli(s) de matériel'],
    [item.counts.travail,'travail non fait'],
    [item.counts.autres,'autre(s) remarque(s)'],
    [item.counts.participation,'participation(s) positive(s)']
   ].filter(([n])=>n>0).map(([n,label])=>n+' '+label);
   return '<article class="planning-remarks-day"><div><strong>'+esc(day)+' · '+esc(item.classe)+'</strong>'+
    '<p class="planning-muted">'+esc(entries.join(' · '))+'</p></div>'+
    '<button class="planning-btn" type="button" data-remarks-week="'+esc(item.date)+'">Voir cette semaine</button></article>';
  }).join('')+'</div>':'<p class="planning-muted">Aucune remarque ni participation enregistrée pour cette classe et ces dates.</p>');
}
async function loadRemarks(){
 if(!state.user||!state.period||state.remarksLoading)return;
 const request=++state.remarksRequest,periodId=state.period.id;
 state.remarksRows=null;state.remarksError='';state.remarksLoading=true;
 renderRemarks();
 try{
  const {from,toExclusive}=window.PlanningRemarks.utcFetchBounds(state.period.start_date,state.period.end_date);
  const rows=[],pageSize=500;
  for(let offset=0;;offset+=pageSize){
   const {data,error}=await client().from('StudentBehaviorEvents')
    .select('id,classe,type,date')
    .gte('date',from)
    .lt('date',toExclusive)
    .order('id',{ascending:true})
    .range(offset,offset+pageSize-1);
   if(error)throw error;
   if(request!==state.remarksRequest||state.period?.id!==periodId)return;
   const page=data||[];
   rows.push(...page);
   if(page.length<pageSize)break;
  }
  state.remarksRows=rows;
 }catch(e){
  if(request!==state.remarksRequest)return;
  state.remarksError=e.message||'Erreur de lecture des observations';
 }finally{
  if(request===state.remarksRequest){state.remarksLoading=false;renderRemarks();}
 }
}
function renderSettings(){
 $('#planningSettings').innerHTML=state.period?`<div class="planning-cards"><article class="planning-card"><strong>${esc(state.period.name)}</strong><p>${state.period.start_date} → ${state.period.end_date}</p><p class="planning-muted">${state.slots.length} créneaux récurrents · ${state.occurrences.length} séances générées</p></article><article class="planning-card"><strong>Alternance A/B</strong><p>Référence semaine A : ${esc(state.period.week_a_reference_date)}</p><p class="planning-muted">Les vacances ne décalent pas l’alternance.</p></article></div>${state.slots.length===0?`<div class="planning-card planning-settings-actions"><h3>Initialiser ton emploi du temps</h3><p>Enregistre les 28 créneaux récurrents communiqués, avec les alternances A/B et les classes correspondantes. Aucune séance ne sera encore générée.</p><button class="planning-btn primary" id="planningInitSlots">Enregistrer mes 28 créneaux</button></div>`:`<div class="planning-card planning-settings-actions"><h3>Génération des cours</h3><p>Génère les occurrences à partir des créneaux récurrents enregistrés. Les vacances scolaires de la zone B sont exclues.</p><button class="planning-btn primary" id="planningGenerate">Générer les cours de l’année</button></div>`}`:`<div class="planning-card"><h3>Créer la période 2026–2027</h3><p>Académie d’Amiens · zone B · du 1er septembre 2026 au 3 juillet 2027.</p><form id="periodForm" class="planning-form-grid"><div class="planning-field full"><label>Nom de la période</label><input class="planning-input" name="name" value="Année scolaire 2026-2027" required></div><div class="planning-field"><label>Début</label><input class="planning-input" type="date" name="start_date" value="2026-09-01" required></div><div class="planning-field"><label>Fin</label><input class="planning-input" type="date" name="end_date" value="2027-07-03" required></div><div class="planning-field"><label>Référence de la semaine A</label><input class="planning-input" type="date" name="week_a_reference_date" value="2026-08-31" required></div><div class="planning-field full"><p class="planning-muted">Vacances intégrées automatiquement : Toussaint, Noël, hiver et printemps (zone B), ainsi que le vendredi 7 mai 2027.</p></div><div class="planning-field full"><button class="planning-btn primary">Créer la période</button></div></form></div>`;
}
function openModal(title,body,wide=false){
 $(".planning-dialog").classList.toggle("is-wide",wide);$('#planningDialogTitle').textContent=title;$('#planningDialogBody').innerHTML=body;$('#planningModal').hidden=false}
function closeModal(){$('#planningModal').hidden=true}
function atelierActivityInfo(entry){
 const docId=String(entry?.atelier_document_id||entry?.atelierDocumentId||'').trim();
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(docId))return null;
 const wrapper=document.createElement('div');wrapper.innerHTML=String(entry?.texte||'');
 const expected=new URL('fiche.html',window.location.href);
 let ficheHref='',title='';
 for(const anchor of wrapper.querySelectorAll('a[href]')){
  let url;
  try{url=new URL(anchor.getAttribute('href'),window.location.href)}catch(_){continue}
  if(url.origin!==expected.origin||url.pathname!==expected.pathname||url.searchParams.get('doc')!==docId)continue;
  const code=url.searchParams.get('code');
  if(!code)continue;
  ficheHref='fiche.html?code='+encodeURIComponent(code)+'&doc='+encodeURIComponent(docId);
  title=String(anchor.textContent||'').trim();break;
 }
 if(!title)title=String(wrapper.textContent||'').trim();
 title=title.replace(/\s*[—–-]\s*Ouvrir la fiche\s*[↗➜→]*\s*$/i,'').replace(/\s+/g,' ').trim();
 return {docId,title:(title||'Fiche d’activité de l’atelier').slice(0,125),ficheHref};
}
/* Les fiches de la banque sont accessibles au professeur avant d'être
   liées au cahier des élèves. Une requête mutualisée évite de relire toute
   la banque pour chaque classe figurant dans la semaine. */
function getAtelierBankElements(){
 if(!state.user?.id)return Promise.resolve([]);
 if(!state.atelierBankPromise){
  state.atelierBankPromise=(async()=>{
   const rows=[],pageSize=500;
   for(let offset=0;offset<3000;offset+=pageSize){
    const {data,error}=await client().from('atelier_documents')
     .select('id,titre,classe,chapitre_titre,document_type,updated_at')
     .eq('user_id',state.user.id).order('updated_at',{ascending:false})
     .range(offset,offset+pageSize-1);
    if(error)throw new Error('Lecture de la banque de l’atelier : '+error.message);
    const page=data||[];
    rows.push(...page);
    if(page.length<pageSize)break;
   }
   const seen=new Set();
   return rows.flatMap(doc=>{
    const id=String(doc?.id||'').trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)||seen.has(id))return [];
    seen.add(id);
    const title=String(doc.titre||'').trim()||'Document sans titre';
    const atelierClass=String(doc.classe||'').trim();
    return [{uid:'atelier-doc:'+id,type:'atelier-bank',docId:id,
     chapterIndex:999999,chapterTitle:'🧪 Banque de l’atelier',
     sessionTitle:'🧪 '+title.slice(0,140),
     atelierClass,atelierChapter:String(doc.chapitre_titre||'').trim(),
     documentType:String(doc.document_type||'').trim()}];
   });
  })().catch(error=>{
   state.atelierBankPromise=null;
   state.atelierBankError=error.message||String(error);
   throw error;
  });
 }
 return state.atelierBankPromise;
}
/* Réunit uniquement dans le planning les séances publiées et les documents
   personnels de l'atelier. Aucune écriture dans le cahier des élèves. */
async function getPlanningElements(className){
 const [cahier,bank]=await Promise.allSettled([getCahierElements(className),getAtelierBankElements()]);
 if(cahier.status==='rejected'&&bank.status==='rejected')
  throw new Error('Cahier et atelier indisponibles : '+cahier.reason.message+' ; '+bank.reason.message);
 if(cahier.status==='rejected')console.warn('Cahier indisponible, banque de l’atelier conservée :',cahier.reason);
 if(bank.status==='rejected'){
  console.warn('Banque de l’atelier indisponible, cahier conservé :',bank.reason);
  state.atelierBankError=bank.reason.message||'Banque indisponible';
 }
 const all=bank.status==='fulfilled'?bank.value:[];
 const sorted=all.slice().sort((a,b)=>{
  const priority=row=>row.atelierClass===className?0:!row.atelierClass?1:2;
  return priority(a)-priority(b);
 });
 return [...(cahier.status==='fulfilled'?cahier.value:[]),...sorted];
}
async function getCahierElements(className){
 const {data,error}=await client().from('Cahier').select('classe,contenu').eq('classe',className).maybeSingle();
 if(error)throw error;
 let contenu=data?.contenu??{};
 if(typeof contenu==='string'){try{contenu=JSON.parse(contenu)}catch(_){throw new Error('Le cahier de '+className+' contient un JSON illisible.');}}
 const chapters=Array.isArray(contenu?.chapitres)?contenu.chapitres:[];
 const fields=[
  {part:'germoir',label:'🌱 Germoir à idées'},
  {part:'problematique',label:'🎯 Problématique du chapitre'},
  {part:'vocabulaire',label:'📚 Vocabulaire du chapitre'},
  {part:'schema',label:'🧠 Carte mentale / Schéma-bilan'},
  {part:'memo',label:'📝 Fiche de mémorisation'},
  {part:'evaluation',label:'✅ Évaluation de fin de chapitre'}
 ];
 return chapters.flatMap((ch,chapterIndex)=>{
  if(ch?.archive===true)return [];
  const chapterTitle=plainText(ch?.titre)||'Chapitre '+(chapterIndex+1);
  const part=field=>({uid:'chapter:'+chapterIndex+':'+field.part,type:'chapter',part:field.part,chapterIndex,chapterTitle,sessionTitle:field.label});
  const sessions=(Array.isArray(ch?.seances)?ch.seances:[]).flatMap((se,sessionIndex)=>{
   const sessionUid=String(se?.planning_uid||'').trim();
   if(!sessionUid)return [];
   const sessionTitle=plainText(se?.titre)||'Séance '+(sessionIndex+1);
   const session={uid:sessionUid,type:'session',chapterIndex,sessionIndex,chapterTitle,sessionTitle};
   const seenDocuments=new Set();
   const activities=(Array.isArray(se?.activites)?se.activites:[]).flatMap(entry=>{
    const info=atelierActivityInfo(entry);
    if(!info||seenDocuments.has(info.docId))return [];
    seenDocuments.add(info.docId);
    return [{uid:'atelier:'+sessionUid+':'+info.docId,type:'atelier-activity',chapterIndex,sessionIndex,
     chapterTitle,sessionUid,docId:info.docId,ficheHref:info.ficheHref,
     parentSessionTitle:sessionTitle,sessionTitle:'🧪 '+info.title}];
   });
   return [session,...activities];
  });
  return [...fields.slice(0,3).map(part),...sessions,...fields.slice(3).map(part)];
 });
}
async function getCahierSessions(className){
 return (await getCahierElements(className)).filter(item=>item.type==='session');
}
function linkedIds(o){return window.PlanningKinds?.linkedIds(o)||[o.cahier_planning_uid].filter(Boolean)}
function cahierElementHref(className,item){
 const cls=encodeURIComponent(className||'');
 if(item.type==='session')return 'prof.html?classe='+cls+'&planning_uid='+encodeURIComponent(item.uid);
 if(item.type==='atelier-bank')return 'atelier.html?doc='+encodeURIComponent(item.docId);
 if(item.type==='atelier-activity')return item.ficheHref||'atelier.html?doc='+encodeURIComponent(item.docId);
 return 'prof.html?classe='+cls+'&planning_chapter='+encodeURIComponent(item.chapterIndex)+'&planning_part='+encodeURIComponent(item.part);
}
function atelierEditHref(item){
 return ['atelier-activity','atelier-bank'].includes(item?.type)?'atelier.html?doc='+encodeURIComponent(item.docId):'';
}
function atelierSessionHref(className,item){
 return item?.type==='atelier-activity'?'prof.html?classe='+encodeURIComponent(className)
  +'&planning_uid='+encodeURIComponent(item.sessionUid)+'&planning_atelier_doc='+encodeURIComponent(item.docId):'';
}
function plainText(value){const el=document.createElement('div');el.innerHTML=String(value??'');return (el.textContent||el.innerText||'').trim()}
/* Phase 8 : confirmation explicite du seul état, pas de modification du cahier. */
function openQuickCompletion(id){
 if(state.quickDoneBusy)return;
 const course=state.occurrences.find(o=>String(o.id)===String(id));
 if(!window.PlanningCompletion?.eligible(course,iso(new Date()))){
  notify('Seul un cours prévu, aujourd’hui ou dans le passé, peut être marqué comme effectué.',true);
  return;
 }
 if(!state.user?.id||!state.period?.id)return notify('La période ou le compte professeur est indisponible.',true);
 const label=course.class_name+' · '+course.session_date+' · '+String(course.start_time).slice(0,5)+'–'+String(course.end_time).slice(0,5);
 openModal('Confirmer le cours effectué',
  '<p>Marquer ce cours comme <strong>Effectué</strong> ?</p>'+
  '<p class="planning-muted">'+esc(label)+'</p>'+
  '<p class="planning-muted">Seul son état sera modifié. La séance associée, les notes, les horaires et la classe resteront inchangés.</p>'+
  '<p class="planning-alert planning-error" id="quickDoneError" role="alert" hidden></p>'+
  '<div class="planning-footer">'+
  '<button class="planning-btn" type="button" id="quickDoneCancel">Annuler</button>'+
  '<button class="planning-btn primary" type="button" id="quickDoneConfirm">✓ Confirmer effectué</button></div>');
 $('#quickDoneCancel').onclick=closeModal;
 $('#quickDoneConfirm').onclick=async()=>{
  if(state.quickDoneBusy)return;
  if(!window.PlanningCompletion.eligible(course,iso(new Date()))){
   closeModal();notify('Ce créneau ne peut plus être confirmé depuis cet écran.',true);return;
  }
  state.quickDoneBusy=true;
  const submit=$('#quickDoneConfirm'),cancel=$('#quickDoneCancel');
  submit.disabled=true;cancel.disabled=true;submit.textContent='Enregistrement…';
  try{
   const conditions=window.PlanningCompletion.conditions(course,state.user.id,state.period.id,iso(new Date()));
   await query('planning_session_occurrences','update',{status:'completed'},conditions);
  }catch(error){
   state.quickDoneBusy=false;
   submit.disabled=false;cancel.disabled=false;submit.textContent='✓ Confirmer effectué';
   const msg='Cours non confirmé : '+(error.message||'Une erreur a empêché la sauvegarde.');
   const feedback=$('#quickDoneError');if(feedback){feedback.textContent=msg;feedback.hidden=false;}
   notify(msg,true);
   return;
  }
  closeModal();
  try{
   await loadPeriod();
   render();
   notify('Cours marqué « Effectué » et sauvegardé.');
  }catch(error){
   notify('État « Effectué » enregistré, mais le rechargement a échoué : '+(error.message||'réessaie Actualiser.'),true);
  }finally{state.quickDoneBusy=false;}
 };
}
async function editOccurrence(id){
 const o=state.occurrences.find(x=>String(x.id)===String(id));if(!o)return;
 let elements=[];
 try{elements=await getPlanningElements(o.class_name)}
 catch(err){notify('Cahier indisponible pour '+o.class_name+' : '+err.message+'. Tu peux néanmoins préparer librement ce créneau.',true);}
 let selected=linkedIds(o);
 let pickerClass=o.class_name;
 let pickerLoading=false,changeRequest=0;
 const meta=window.PlanningKinds.read(o.notes);
 let drafts=window.PlanningKinds.normalizeDrafts(meta.drafts);
 const kindOptions=window.PlanningKinds.types.map(t=>'<option value="'+esc(t.value)+'" '+(t.value===meta.kind?'selected':'')+'>'+esc(t.icon+' '+t.label)+'</option>').join('');
 const box='<form id="occForm"><div class="planning-form-grid">'
  +'<div class="planning-field"><label>Date</label><input class="planning-input" type="date" name="session_date" value="'+esc(o.session_date)+'" required></div>'
  +'<div class="planning-field"><label>Classe</label><select class="planning-select" name="class_name">'+CLASSES.map(c=>'<option '+(c===o.class_name?'selected':'')+'>'+c+'</option>').join('')+'</select></div>'
  +'<div class="planning-field"><label>Début</label><input class="planning-input" type="time" name="start_time" value="'+esc(o.start_time.slice(0,5))+'" required></div>'
  +'<div class="planning-field"><label>Fin</label><input class="planning-input" type="time" name="end_time" value="'+esc(o.end_time.slice(0,5))+'" required></div>'
  +'<div class="planning-field"><label>Type de créneau</label><select class="planning-select" name="kind">'+kindOptions+'</select></div>'
  +'<div class="planning-field"><label>État</label><select class="planning-select" name="status">'+['planned','completed','postponed','cancelled'].map(s=>'<option value="'+s+'" '+(s===o.status?'selected':'')+'>'+statusLabel(s)+'</option>').join('')+'</select></div>'
  +'<div class="planning-field full planning-preparation"><label>✏️ Préparer à l’avance — sans créer de séance dans le cahier des élèves</label>'
  +'<small class="planning-muted">Rédige une ou plusieurs séances ou activités prévisionnelles. Elles restent uniquement dans ton planning professeur et ne sont pas visibles par les élèves. Tu pourras ensuite les relier aux éléments du cahier.</small>'
  +'<div id="planningDraftItems" class="planning-draft-items" aria-live="polite"></div>'
  +'<div class="planning-draft-add"><select class="planning-select" id="planningDraftType" aria-label="Type de préparation"><option value="seance">📘 Séance à prévoir</option><option value="activite">🧪 Activité à prévoir</option></select>'
  +'<input class="planning-input" id="planningDraftTitle" type="text" maxlength="160" placeholder="Ex. Séance 4 — Comprendre la digestion" aria-label="Intitulé de la préparation">'
  +'<button type="button" class="planning-btn" id="planningDraftAdd">＋ Prévoir</button></div></div>'
  +'<div class="planning-field full"><label>Associer des éléments existants : cahier OU banque de l’atelier</label>'
  +'<small class="planning-muted">Choisis directement une fiche déjà enregistrée dans ton atelier, même si elle n’a pas encore été publiée dans le cahier. Plusieurs activités peuvent être associées au même créneau, sans publication automatique.</small>'
 +'<input id="planningElementSearch" class="planning-input" type="search" placeholder="Rechercher une fiche de l’atelier, une séance, une classe…" aria-label="Rechercher dans le cahier et la banque de l’atelier">'
 +'<small id="planningElementCount" class="planning-muted" aria-live="polite"></small>'
  +'<div id="planningSelectedItems" class="planning-linked-items" aria-live="polite"></div>'
  +'<div class="planning-add-link"><select class="planning-select" id="planningElementChoice" aria-label="Élément du cahier à ajouter"></select>'
  +'<button type="button" class="planning-btn" id="planningAddLinkedElement">＋ Ajouter</button></div></div>'
  +'<div class="planning-field full"><label>Intitulé / notes (facultatif)</label><textarea class="planning-textarea" name="notes">'+esc(meta.detail)+'</textarea></div>'
  +'</div><div class="planning-footer"><button type="button" class="planning-btn" id="occCancel">Fermer</button>'
  +'<button class="planning-btn primary" id="occSave">Enregistrer</button></div></form>';
 openModal('Modifier le créneau',box,true);
 const form=$('#occForm');
 const renderPicker=()=>{
  if(!form?.isConnected)return;
  const byUid=new Map(elements.map(item=>[item.uid,item]));
  $('#planningSelectedItems').innerHTML=selected.length?selected.map((uid,index)=>{
   const item=byUid.get(uid);
   const title=item?item.sessionTitle:'Élément précédemment associé introuvable';
   const chapter=item?item.chapterTitle+(item.type==='atelier-bank'&&item.atelierClass?' · enregistrée pour '+item.atelierClass:''):uid;
   const href=item?(item.type==='atelier-bank'
    ?'<a href="'+esc(cahierElementHref(pickerClass,item))+'" target="_blank" rel="noopener">Ouvrir dans l’atelier ↗</a>'
    :item.type==='atelier-activity'
     ?'<a href="'+esc(cahierElementHref(pickerClass,item))+'" target="_blank" rel="noopener">Ouvrir la fiche ↗</a> · '
      +'<a href="'+esc(atelierEditHref(item))+'" target="_blank" rel="noopener">Modifier dans l’atelier ↗</a> · '
      +'<a href="'+esc(atelierSessionHref(pickerClass,item))+'" target="_blank" rel="noopener">Voir dans la séance ↗</a>'
     :'<a href="'+esc(cahierElementHref(pickerClass,item))+'" target="_blank" rel="noopener">Ouvrir dans l’éditeur ↗</a>'):'';
   return '<div class="planning-linked-item'+(item?'':' is-missing')+'"><div><strong>'+(index+1)+'. '+esc(title)+'</strong>'
    +'<small>'+esc(chapter)+'</small>'+href+'</div><div class="planning-linked-actions">'
    +'<button type="button" data-link-action="up" data-link-index="'+index+'" '+(index===0?'disabled':'')+' title="Monter">↑</button>'
    +'<button type="button" data-link-action="down" data-link-index="'+index+'" '+(index===selected.length-1?'disabled':'')+' title="Descendre">↓</button>'
    +'<button type="button" data-link-action="remove" data-link-index="'+index+'" title="Retirer">✕</button></div></div>';
  }).join(''):'<p class="planning-muted">Aucun élément associé à ce créneau.</p>';
  const search=String($('#planningElementSearch').value||'').trim().toLocaleLowerCase('fr-FR');
  const allAvailable=elements.filter(item=>!selected.includes(item.uid));
  const available=allAvailable.filter(item=>!search||[
   item.sessionTitle,item.chapterTitle,item.atelierClass,item.atelierChapter,item.parentSessionTitle
  ].some(text=>String(text||'').toLocaleLowerCase('fr-FR').includes(search)));
  $('#planningElementCount').textContent=available.length+' élément(s) trouvé(s)'+
   (search?' sur '+allAvailable.length+' disponibles':'')+
   (state.atelierBankError?' · Banque de l’atelier indisponible : '+state.atelierBankError:'');
  let lastChapter=-1;
  let options='<option value="">— Sélectionner une séance ou une fiche de l’atelier —</option>';
  for(const item of available){
   if(item.chapterIndex!==lastChapter){if(lastChapter!==-1)options+='</optgroup>';options+='<optgroup label="'+esc(item.chapterTitle)+'">';lastChapter=item.chapterIndex;}
   options+='<option value="'+esc(item.uid)+'">'+esc(item.type==='atelier-activity'
    ?'　↳ '+item.sessionTitle
    :item.sessionTitle+(item.type==='atelier-bank'&&item.atelierClass?' · '+item.atelierClass:''))+'</option>';
  }
  if(lastChapter!==-1)options+='</optgroup>';
  $('#planningElementChoice').innerHTML=options;
  $('#planningElementChoice').disabled=pickerLoading||!available.length;
  $('#planningAddLinkedElement').disabled=pickerLoading||!available.length;
 };
 const renderDrafts=()=>{
  if(!form?.isConnected)return;
  const available=elements.filter(item=>!selected.includes(item.uid));
  const options='<option value="">— Choisir un élément du cahier —</option>'
   +available.map(item=>'<option value="'+esc(item.uid)+'">'
     +esc(item.chapterTitle+' — '+(item.type==='atelier-activity'?item.parentSessionTitle+' / ':'')+item.sessionTitle)+'</option>').join('');
  $('#planningDraftItems').innerHTML=drafts.length?drafts.map((item,index)=>
   '<div class="planning-draft-item" data-draft-index="'+index+'">'
    +'<div class="planning-draft-item-head"><strong>'+(item.type==='seance'?'📘 Séance prévisionnelle':'🧪 Activité prévisionnelle')+'</strong>'
    +'<div class="planning-linked-actions">'
    +'<button type="button" data-draft-action="up" data-draft-index="'+index+'" '+(index===0?'disabled':'')+' title="Monter la préparation">↑</button>'
    +'<button type="button" data-draft-action="down" data-draft-index="'+index+'" '+(index===drafts.length-1?'disabled':'')+' title="Descendre la préparation">↓</button>'
    +'<button type="button" data-draft-action="remove" data-draft-index="'+index+'" title="Supprimer la préparation">✕</button></div></div>'
    +'<label class="planning-draft-field">Intitulé<input class="planning-input" maxlength="160" data-draft-field="title" data-draft-index="'+index+'" value="'+esc(item.title)+'"></label>'
    +'<label class="planning-draft-field">Notes facultatives (objectif, matériel, déroulement…)<textarea class="planning-textarea" rows="2" maxlength="1500" data-draft-field="detail" data-draft-index="'+index+'">'+esc(item.detail)+'</textarea></label>'
    +'<div class="planning-draft-connect"><select class="planning-select" data-draft-target="'+index+'" aria-label="Choisir l’élément du cahier qui remplace cette préparation" '+(!available.length?'disabled':'')+'>'+options+'</select>'
    +'<button class="planning-btn" type="button" data-draft-action="connect" data-draft-index="'+index+'" '+(!available.length?'disabled':'')+'>Remplacer par un élément existant</button></div></div>'
  ).join(''):'<p class="planning-muted">Aucune préparation. Tu peux commencer même si tu n’as encore rien créé dans le cahier.</p>';
  $('#planningDraftAdd').disabled=drafts.length>=60;
 };
 renderDrafts();
 $('#planningDraftAdd').onclick=()=>{
  const input=$('#planningDraftTitle'),title=input.value.trim();
  if(!title)return notify('Saisis un intitulé pour ta séance ou ton activité prévisionnelle.',true);
  if(drafts.length>=60)return notify('Maximum 60 préparations dans un créneau.',true);
  drafts.push({type:$('#planningDraftType').value==='activite'?'activite':'seance',title:title.slice(0,160),detail:''});
  input.value='';renderDrafts();input.focus();
 };
 $('#planningDraftTitle').addEventListener('keydown',event=>{
  if(event.key==='Enter'){event.preventDefault();$('#planningDraftAdd').click();}
 });
 $('#planningDraftItems').addEventListener('input',event=>{
  const field=event.target.closest('[data-draft-field]');
  if(!field)return;
  const index=Number(field.dataset.draftIndex),key=field.dataset.draftField;
  if(drafts[index]&&['title','detail'].includes(key))drafts[index][key]=field.value;
 });
 $('#planningDraftItems').addEventListener('click',event=>{
  const button=event.target.closest('[data-draft-action]');if(!button)return;
  const index=Number(button.dataset.draftIndex),action=button.dataset.draftAction;
  if(!Number.isInteger(index)||index<0||index>=drafts.length)return;
  if(action==='remove')drafts.splice(index,1);
  else if(action==='up'&&index>0)[drafts[index-1],drafts[index]]=[drafts[index],drafts[index-1]];
  else if(action==='down'&&index<drafts.length-1)[drafts[index+1],drafts[index]]=[drafts[index],drafts[index+1]];
  else if(action==='connect'){
   const uid=$('#planningDraftItems').querySelector('[data-draft-target="'+index+'"]')?.value;
   if(!uid||selected.includes(uid)||!elements.some(item=>item.uid===uid))
    return notify('Sélectionne une séance du cahier ou une fiche existante dans l’atelier.',true);
   if(drafts[index].detail.trim()&&!confirm('Cette préparation contient des notes. Les remplacer par un lien existant effacera ces notes privées. Continuer ?'))return;
   selected.push(uid);drafts.splice(index,1);renderPicker();
  }
  renderDrafts();
 });
 renderPicker();
 $('#planningElementSearch').addEventListener('input',renderPicker);
 $('#occCancel').onclick=closeModal;
 $('#planningAddLinkedElement').onclick=()=>{
  const uid=$('#planningElementChoice').value;
  if(uid&&elements.some(item=>item.uid===uid)&&!selected.includes(uid)){selected.push(uid);renderPicker();renderDrafts();}
 };
 $('#planningSelectedItems').addEventListener('click',e=>{
  const button=e.target.closest('[data-link-action]');
  if(!button)return;
  const index=Number(button.dataset.linkIndex);
  if(!Number.isInteger(index)||index<0||index>=selected.length)return;
  if(button.dataset.linkAction==='remove')selected.splice(index,1);
  else if(button.dataset.linkAction==='up'&&index>0)[selected[index-1],selected[index]]=[selected[index],selected[index-1]];
  else if(button.dataset.linkAction==='down'&&index<selected.length-1)[selected[index+1],selected[index]]=[selected[index],selected[index+1]];
  renderPicker();renderDrafts();
 });
 form.elements.class_name.addEventListener('change',async e=>{
  const request=++changeRequest,cls=e.target.value;
  pickerClass=cls;selected=[];elements=[];pickerLoading=true;renderPicker();renderDrafts();
  try{
   const next=await getPlanningElements(cls);
   if(request!==changeRequest||!form.isConnected)return;
   elements=next;
  }catch(error){if(request===changeRequest)notify('Impossible de lire le cahier : '+error.message,true)}
  finally{if(request===changeRequest){pickerLoading=false;renderPicker();renderDrafts()}}
 });
 form.onsubmit=async e=>{
  e.preventDefault();
  if(pickerLoading)return notify('Attends le chargement des éléments de la classe.',true);
  const pendingTitle=$('#planningDraftTitle').value.trim();
  if(pendingTitle&&drafts.length>=60)
   return notify('Maximum 60 préparations par créneau. Supprime une préparation ou efface le nouveau titre.',true);
  if(pendingTitle){
   drafts.push({type:$('#planningDraftType').value==='activite'?'activite':'seance',title:pendingTitle.slice(0,160),detail:''});
   $('#planningDraftTitle').value='';
   renderDrafts();
  }
  if(drafts.some(item=>!String(item.title||'').trim()))
   return notify('Une préparation n’a plus de titre. Complète-la ou supprime-la avant d’enregistrer.',true);
  const button=$('#occSave');button.disabled=true;
  const f=new FormData(form);
  try{
   const kind=String(f.get('kind')||'cours');
   const sessionUid=selected.find(uid=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uid))||null;
   await query('planning_session_occurrences','update',{
    session_date:f.get('session_date'),class_name:f.get('class_name'),
    start_time:f.get('start_time'),end_time:f.get('end_time'),
    status:f.get('status'),notes:window.PlanningKinds.write(kind,f.get('notes'),selected,drafts),
    cahier_planning_uid:sessionUid,is_modified:true
   },[['id','eq',id],['owner_id','eq',state.user.id]]);
   closeModal();await loadPeriod();render();
   notify(drafts.length+' préparation(s) libre(s) et '+selected.length+' élément(s) du cahier enregistrés.');
  }catch(error){notify('Enregistrement impossible : '+error.message,true);if(form.isConnected)button.disabled=false;}
 };
}

const SCHOOL_HOLIDAYS=[
 {name:'Toussaint',start:'2026-10-17',end:'2026-11-02'},
 {name:'Noël',start:'2026-12-19',end:'2027-01-04'},
 {name:'Hiver',start:'2027-02-20',end:'2027-03-08'},
 {name:'Printemps',start:'2027-04-17',end:'2027-05-03'}
];

const DEFAULT_SLOTS = [
 // Lundi
 [1,'13:45','14:40','6e4','AB'],
  [1,'14:40','15:35','6e4','AB'],
 [1,'15:50','16:45','6e5','B'],
 // Mardi
 [2,'09:25','10:20','5e1','B'],
 [2,'10:40','11:30','6e2','AB'],
 [2,'13:45','14:40','6e1','AB'],
  [2,'14:40','15:35','6e1','AB'],
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
 [4,'10:40','11:30','6e3','AB'],
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
 if(saved.length!==28)throw new Error(`Seulement ${saved.length} créneaux sur 28 ont été retournés. Vérifie les données avant toute génération.`);
 await loadPeriod();render();notify('Les 28 créneaux de ton emploi du temps ont été enregistrés. Vérifie-les avant de générer les cours.');
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
 if(!state.slots.length)return notify('Aucun créneau récurrent trouvé dans planning_slots. Il faut d’abord enregistrer les 28 créneaux de ton emploi du temps.',true);
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
 openModal('Préparer ou associer des cours en série',
  '<p class="planning-muted">La correspondance automatique est <strong>indicative</strong>. Pour chaque créneau, tu peux aussi saisir une séance ou une activité prévisionnelle sans la créer dans le cahier des élèves. Aucune écriture avant validation explicite.</p>'
  +'<form id="planningBulkForm" class="planning-form-grid">'
  +'<div class="planning-field"><label for="bulkClass">Classe</label><select id="bulkClass" class="planning-select" name="class_name" required>'+options+'</select></div>'
  +'<div class="planning-field"><label for="bulkStart">À partir du</label><input id="bulkStart" class="planning-input" type="date" name="from_date" value="'+esc(iso(state.weekStart))+'" required></div>'
  +'<div class="planning-field"><label for="bulkEnd">Jusqu’au</label><input id="bulkEnd" class="planning-input" type="date" name="to_date" value="'+esc(state.period.end_date)+'" required></div>'
  +'<div class="planning-field"><label for="bulkSession">Séance de départ (facultatif)</label><select id="bulkSession" class="planning-select" name="first_uid"><option value="">Première séance non encore associée</option></select></div>'
  +'<div class="planning-field full"><small class="planning-muted">Suggestion initiale : une séance différente par créneau. Tu pourras la répéter, choisir un autre type de créneau ou laisser le cours sans association. Maximum 40 lignes par prévisualisation.</small></div>'
  +'<div class="planning-field full"><button class="planning-btn primary" type="submit">🔎 Prévisualiser le planning</button></div>'
  +'</form>'
  +'<div id="planningBulkPreview" aria-live="polite"></div>'
  +'<div class="planning-footer"><button type="button" class="planning-btn" id="planningBulkCancel">Fermer sans enregistrer</button>'
  +'<button type="button" class="planning-btn primary" id="planningBulkApply" hidden>💾 Enregistrer le planning</button></div>',
  true);
 const form=$('#planningBulkForm'),preview=$('#planningBulkPreview'),save=$('#planningBulkApply');
 let proposed=null;
 const reset=()=>{proposed=null;preview.innerHTML='';save.hidden=true};
 preview.addEventListener('change',e=>{
  const select=e.target.closest('.planning-bulk-choice');
  if(!select||!proposed)return;
  const entry=proposed.items.find(x=>String(x.id)===select.dataset.occId);
  if(!entry)return;
  const selected=proposed.availableElements.find(item=>item.uid===select.value);
  if(select.value.startsWith('draft:')){
   const type=select.value.slice(6);
   if(!['seance','activite'].includes(type)){notify('Type de préparation inconnu.',true);reset();return;}
   entry.draftType=type;entry.kind='cours';entry.uid='';entry.chapterTitle='';entry.sessionTitle='';
  }else if(select.value.startsWith('kind:')){
   const kind=select.value.slice(5);
   if(!window.PlanningKinds.types.some(t=>t.value===kind&&kind!=='cours')){
    notify('Type de créneau inconnu : refais la prévisualisation.',true);reset();return;
   }
   entry.kind=kind;entry.draftType='';entry.uid='';entry.chapterTitle='';entry.sessionTitle='';
  }else{
   if(select.value&&!selected){notify('Séance inconnue : refais la prévisualisation.',true);reset();return;}
   entry.kind='cours';entry.draftType='';
   entry.uid=selected?.uid||'';
   entry.chapterTitle=selected?.chapterTitle||'';
   entry.sessionTitle=selected?.sessionTitle||'';
  }
  const detail=preview.querySelector('.planning-bulk-detail[data-occ-id="'+entry.id+'"]');
  if(detail){
   detail.hidden=entry.kind==='cours'&&!entry.draftType;
   detail.placeholder=entry.draftType?'Intitulé obligatoire de la préparation (non publiée)':'Intitulé facultatif (ex. contrôle chapitre 2)';
   detail.maxLength=entry.draftType?160:200;
  }
  updateSelectedCount();
 });
 preview.addEventListener('input',e=>{
  const input=e.target.closest('.planning-bulk-detail');
  if(!input||!proposed)return;
  const entry=proposed.items.find(x=>String(x.id)===input.dataset.occId);
  if(entry)entry.detail=input.value;
 });
 const updateSelectedCount=()=>{
  const count=proposed?.items.filter(x=>x.uid||x.kind!=='cours'||x.draftType).length||0;
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
   const elements=await getPlanningElements(className);
    const sessions=elements.filter(item=>item.type==='session');
   const proposal=window.PlanningBatch.plan({
    occurrences:state.occurrences,sessions,className,fromDate,toDate,
    firstUid:String(values.get('first_uid')||''),limit:40
   });
   proposed={...proposal,periodId:state.period.id,ownerId:state.user.id,
    baseSignature:planningBulkSignature(proposal),availableSessions:sessions,availableElements:elements};
   const sessionOptions=(chosen)=>'<option value="">— Ne pas associer ce créneau —</option>'
    +'<option value="draft:seance">✏️ Prévoir une séance libre (privée)</option>'
    +'<option value="draft:activite">🧪 Prévoir une activité libre (privée)</option>'
    +window.PlanningKinds.types.filter(t=>t.value!=='cours').map(t=>'<option value="kind:'+esc(t.value)+'">'+esc(t.icon+' '+t.label)+'</option>').join('')
    +elements.map(session=>'<option value="'+esc(session.uid)+'"'
    +(session.uid===chosen?' selected':'')+'>'+esc(session.chapterTitle+' — '+(session.type==='atelier-activity'?session.parentSessionTitle+' / ':'')+session.sessionTitle)+'</option>').join('');
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
    +(rows?'<div class="planning-bulk-table"><table><thead><tr><th>Date</th><th>Horaire</th><th>Élément à associer (modifiable)</th></tr></thead><tbody>'+rows+'</tbody></table></div>':
      '<p class="planning-muted">Aucun créneau libre compatible sur cette période.</p>')
    +'<p class="planning-muted"><strong>Important :</strong> la répartition automatique est une suggestion. Tu peux préparer une séance ou activité libre sans la publier aux élèves, ou choisir une séance, une évaluation, une intervention, une sortie ou une absence. Tu peux aussi choisir le germoir, la carte mentale, la fiche de mémorisation ou l’évaluation. Les fiches de l’atelier liées à une séance sont proposées séparément. Pour plusieurs éléments dans la même heure, ouvre ensuite le créneau dans « Ma semaine ». Les liens existants et les horaires restent inchangés.</p>';
   updateSelectedCount();
  }catch(err){notify('Prévisualisation impossible : '+err.message,true)}
 });
 save.onclick=async()=>{
  const selected=proposed?.items.filter(item=>item.uid||item.kind!=='cours'||item.draftType)||[];
  if(!proposed||state.busy||!selected.length)return;
  if(selected.some(item=>item.draftType&&!String(item.detail||'').trim()))
   return notify('Indique un intitulé pour chaque séance ou activité prévisionnelle avant d’enregistrer.',true);
  if(!confirm('Confirmer les '+selected.length+' créneau(x) sélectionné(s) pour '+proposed.className+' ? Vérifie les séances, les évaluations et les absences. Cette opération modifiera le planning Supabase.'))return;
  state.busy=true;save.disabled=true;
  let completed=0;
  try{
   // Recharger et revérifier l’aperçu avant toute écriture.
   await loadPeriod();
   if(!state.period||state.period.id!==proposed.periodId||state.user.id!==proposed.ownerId)
    throw new Error('La période ou la session a changé. Refais la prévisualisation.');
   const elements=await getPlanningElements(proposed.className);
    const sessions=elements.filter(item=>item.type==='session');
   const now=window.PlanningBatch.plan({
    occurrences:state.occurrences,sessions,className:proposed.className,
    fromDate:proposed.fromDate,toDate:proposed.toDate,
    firstUid:proposed.firstUid,limit:proposed.limit
   });
   if(planningBulkSignature(now)!==proposed.baseSignature)
    throw new Error('Le planning ou les séances ont changé depuis l’aperçu. Ferme la fenêtre et recommence.');
   const knownUids=new Set(elements.map(item=>item.uid));
   if(selected.some(item=>item.uid&&!knownUids.has(item.uid)))
    throw new Error('Un élément sélectionné a disparu du cahier : aucune sauvegarde lancée.');
   for(const item of selected){
    // Protection contre un changement entre deux clics/onglets : condition
    // SQL sur l’état de la ligne + refus si déjà associée.
    const element=elements.find(candidate=>candidate.uid===item.uid);
    const payload=item.draftType
     ?{cahier_planning_uid:null,
       notes:window.PlanningKinds.write('cours',item.originalNotes??'',[],[{type:item.draftType,title:String(item.detail||'').trim()}]),
       is_modified:true}
     :item.kind==='cours'
      ?{cahier_planning_uid:element?.type==='session'?item.uid:null,
        notes:window.PlanningKinds.write('cours',item.originalNotes??'',item.uid?[item.uid]:[]),is_modified:true}
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
   notify(completed+' créneau(x) planifié(s) ou associé(s) et enregistré(s) pour '+proposed.className+'.');
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
 $('#planningRemarksRefresh').addEventListener('click',()=>{void loadRemarks()});
 $('#planningRemarksFrom').addEventListener('change',e=>{state.remarksFrom=e.target.value;renderRemarks()});
 $('#planningRemarksTo').addEventListener('change',e=>{state.remarksTo=e.target.value;renderRemarks()});
 $('#planningRemarksYear').addEventListener('click',()=>{
  state.remarksFrom='';state.remarksTo='';renderRemarks();
 });
 $('#planningRemarksWeek').addEventListener('click',()=>{
  const from=iso(state.weekStart),to=iso(plusDays(state.weekStart,6));
  state.remarksFrom=from<state.period.start_date?state.period.start_date:from;
  state.remarksTo=to>state.period.end_date?state.period.end_date:to;
  renderRemarks();
 });
 $('#planningRemarksHistory').addEventListener('click',e=>{
  const btn=e.target.closest('[data-remarks-week]');
  if(!btn)return;
  const date=btn.dataset.remarksWeek;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
  state.weekStart=mondayOf(dateFrom(date));
  state.weekPattern=weekPatternFor(state.weekStart);
  state.tab='planning';
  render();
 });
 $('#planningFollowupSummary').addEventListener('click',e=>{const item=e.target.closest('[data-followup-filter]');if(!item)return;state.followupFilter=item.dataset.followupFilter;renderFollowup()});
 $('#planningFollowupList').addEventListener('click',e=>{
  const done=e.target.closest('[data-quick-done]');if(done){openQuickCompletion(done.dataset.quickDone);return;}
  const item=e.target.closest('[data-followup-occ]');if(item)editOccurrence(item.dataset.followupOcc);
 });
 $('#planningAddEvent').onclick=addEvent;
 const weekAddEvent=$('#planningWeekAddEvent');if(weekAddEvent)weekAddEvent.onclick=addEvent;
 $('#planningBulkLink').onclick=openPlanningBulk;
 $('#planningRefresh').onclick=async()=>{try{await loadPeriod();render();notify('Planning actualisé.')}catch(e){notify(e.message,true)}};
 $('#planningModalClose').onclick=closeModal;
 $('#planningModal').addEventListener('click',e=>{if(e.target.id==='planningModal')closeModal()});
}
document.addEventListener('DOMContentLoaded',()=>{bind();init()},{once:true});
})();
