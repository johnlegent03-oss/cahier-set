/* Planning SVT — fonctionnement autonome sur les tables planning V5 */
(() => {
'use strict';
const $ = (s,root=document) => root.querySelector(s);
const $$ = (s,root=document) => [...root.querySelectorAll(s)];
const CLASSES = ['6e1','6e2','6e3','6e4','6e5','5e1','5e3','5e5','3e2','3e3'];
const DAYS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi'];
const state = {user:null,period:null,slots:[],occurrences:[],events:[],weekStart:mondayOf(new Date()),weekPattern:'A',view:'week',tab:'planning',busy:false};
function mondayOf(d){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x}
function iso(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function dateFrom(s){return new Date(`${s}T12:00:00`)}
function plusDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function notify(msg,error=false){const el=$('#planningMessage');el.textContent=msg;el.className='planning-alert'+(error?' planning-error':'');el.hidden=false}
function hideMessage(){$('#planningMessage').hidden=true}
function client(){if(!window.sb)throw new Error('Client Supabase absent : vérifie le chargement de config.js et du client Supabase.');return window.sb}
async function query(table,method='select',payload=null,filters=[]){
 let q=client().from(table);
 if(method==='insert')q=q.insert(payload);
 else if(method==='update')q=q.update(payload);
 else q=q.select('*');
 filters.forEach(([k,op,v])=>{q=op==='eq'?q.eq(k,v):op==='gte'?q.gte(k,v):op==='lte'?q.lte(k,v):q});
 const {data,error}=await q;if(error)throw error;return data||[];
}
async function init(){
 document.body.classList.add('planning-page');
 try{
  const {data:{session},error}=await client().auth.getSession();if(error)throw error;
  if(!session?.user)throw new Error('Session professeur absente. Connecte-toi depuis l’espace professeur.');
  state.user=session.user;
  await loadPeriod();render();
 }catch(e){notify(e.message||'Impossible de charger le Planning.',true)}
}
async function loadPeriod(){
 const rows=await query('planning_periods','select',null,[['owner_id','eq',state.user.id]]);
 const today=iso(new Date());
 state.period=rows.find(p=>p.start_date<=today&&p.end_date>=today)||rows.sort((a,b)=>b.start_date.localeCompare(a.start_date))[0]||null;
 if(!state.period){notify('Aucune période de planning n’est configurée. La création de la période annuelle doit être faite avant de générer les cours.');return}
 const [slots,occ,events]=await Promise.all([
  query('planning_slots','select',null,[['owner_id','eq',state.user.id],['period_id','eq',state.period.id]]),
  query('planning_session_occurrences','select',null,[['owner_id','eq',state.user.id],['period_id','eq',state.period.id]]),
  query('planning_events','select',null,[['owner_id','eq',state.user.id],['period_id','eq',state.period.id]])
 ]);
 state.slots=slots;state.occurrences=occ;state.events=events;
}
function visibleOccurrences(){
 const start=iso(state.weekStart),end=iso(plusDays(state.weekStart,6));
 return state.occurrences.filter(o=>o.session_date>=start&&o.session_date<=end&&o.status!=='cancelled');
}
function render(){
 $('#planningPeriod').textContent=state.period?state.period.name:'Période non configurée';
 $('#planningWeek').textContent=`Semaine du ${state.weekStart.toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})} · semaine ${state.weekPattern}`;
 $$('.planning-tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===state.tab)));
 $('#planningWeekView').hidden=state.tab!=='planning';
 $('#planningEventsView').hidden=state.tab!=='events';
 $('#planningSettingsView').hidden=state.tab!=='settings';
 renderGrid();renderEvents();renderSettings();
}
function renderGrid(){
 const occ=visibleOccurrences(),head=DAYS.map((d,i)=>`<th>${d}<br><span>${plusDays(state.weekStart,i).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})}</span></th>`).join('');
 const times=[...new Set(state.slots.map(s=>`${s.start_time.slice(0,5)}|${s.end_time.slice(0,5)}`))].sort();
 const rows=times.map(t=>{const [a,b]=t.split('|');return `<tr><td>${a}<br>– ${b}</td>${DAYS.map((_,i)=>{const day=plusDays(state.weekStart,i);const items=occ.filter(o=>o.session_date===iso(day)&&o.start_time.slice(0,5)===a);return `<td>${items.map(o=>`<button class="planning-course" data-occ="${esc(o.id)}" style="--course-color:${colorFor(o.class_name)}">${esc(o.class_name||o.title||'Événement')}<small>${esc(o.start_time.slice(0,5))}–${esc(o.end_time.slice(0,5))} · ${statusLabel(o.status)}</small></button>`).join('')||'<span class="planning-empty">—</span>'}</td>`}).join('')}</tr>`}).join('');
 $('#planningGrid').innerHTML=`<thead><tr><th>Horaire</th>${head}</tr></thead><tbody>${rows||'<tr><td colspan="6">Aucun créneau pour cette semaine.</td></tr>'}</tbody>`;
 $$('#planningGrid [data-occ]').forEach(b=>b.addEventListener('click',()=>editOccurrence(b.dataset.occ)));
}
function colorFor(c){const i=CLASSES.indexOf(c);return ['#71966a','#8ba96b','#5d927d','#a2a66a','#7297a5','#b28c63','#8c9b71','#a48a78','#7d91a8','#9b8ba7'][Math.max(0,i)]}
function statusLabel(s){return ({planned:'À venir',completed:'Effectué',postponed:'Reporté',cancelled:'Annulé'})[s]||s}
function renderEvents(){
 $('#planningEvents').innerHTML=state.events.sort((a,b)=>a.start_at.localeCompare(b.start_at)).map(e=>`<article class="planning-card"><strong>${esc(e.title)}</strong><div class="planning-muted">${new Date(e.start_at).toLocaleString('fr-FR')} · ${e.all_day?'Toute la journée':new Date(e.end_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div><p>${esc(e.description||'')}</p><span class="planning-status ${esc(e.status)}">${statusLabel(e.status)}</span></article>`).join('')||'<p class="planning-muted">Aucun événement enregistré.</p>';
}
function renderSettings(){
 $('#planningSettings').innerHTML=state.period?`<div class="planning-cards"><article class="planning-card"><strong>${esc(state.period.name)}</strong><p>${state.period.start_date} → ${state.period.end_date}</p><p class="planning-muted">${state.slots.length} créneaux récurrents · ${state.occurrences.length} séances générées</p></article><article class="planning-card"><strong>Alternance A/B</strong><p>Référence semaine A : ${esc(state.period.week_a_reference_date)}</p><p class="planning-muted">Les vacances ne décalent pas l’alternance.</p></article></div>`:'<p class="planning-muted">Aucune période configurée.</p>';
}
function openModal(title,body){$('#planningDialogTitle').textContent=title;$('#planningDialogBody').innerHTML=body;$('#planningModal').hidden=false}
function closeModal(){$('#planningModal').hidden=true}
async function editOccurrence(id){
 const o=state.occurrences.find(x=>x.id===id);if(!o)return;
 openModal('Modifier la séance',`<form id="occForm"><div class="planning-form-grid"><div class="planning-field"><label>Date</label><input class="planning-input" type="date" name="session_date" value="${esc(o.session_date)}" required></div><div class="planning-field"><label>Classe</label><select class="planning-select" name="class_name">${CLASSES.map(c=>`<option ${c===o.class_name?'selected':''}>${c}</option>`).join('')}</select></div><div class="planning-field"><label>Début</label><input class="planning-input" type="time" name="start_time" value="${esc(o.start_time.slice(0,5))}" required></div><div class="planning-field"><label>Fin</label><input class="planning-input" type="time" name="end_time" value="${esc(o.end_time.slice(0,5))}" required></div><div class="planning-field"><label>État</label><select class="planning-select" name="status">${['planned','completed','postponed','cancelled'].map(s=>`<option value="${s}" ${s===o.status?'selected':''}>${statusLabel(s)}</option>`).join('')}</select></div><div class="planning-field full"><label>Notes</label><textarea class="planning-textarea" name="notes">${esc(o.notes||'')}</textarea></div></div><div class="planning-footer"><button type="button" class="planning-btn" id="occCancel">Fermer</button><button class="planning-btn primary">Enregistrer</button></div></form>`);
 $('#occCancel').onclick=closeModal;
 $('#occForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await query('planning_session_occurrences','update',{session_date:f.get('session_date'),class_name:f.get('class_name'),start_time:f.get('start_time'),end_time:f.get('end_time'),status:f.get('status'),notes:f.get('notes'),is_modified:true},[['id','eq',id],['owner_id','eq',state.user.id]]);closeModal();await loadPeriod();render();notify('Séance mise à jour.')}catch(err){notify(err.message,true)}};
}
async function addEvent(){
 openModal('Ajouter un événement',`<form id="eventForm"><div class="planning-form-grid"><div class="planning-field full"><label>Intitulé</label><input class="planning-input" name="title" required maxlength="180" placeholder="Conseil de classe, réunion…"></div><div class="planning-field"><label>Début</label><input class="planning-input" type="datetime-local" name="start_at" required></div><div class="planning-field"><label>Fin</label><input class="planning-input" type="datetime-local" name="end_at" required></div><div class="planning-field"><label>Type</label><select class="planning-select" name="event_type"><option>meeting</option><option>outing</option><option>training</option><option>other</option></select></div><div class="planning-field"><label>Classe (facultatif)</label><select class="planning-select" name="class_name"><option value="">Toutes</option>${CLASSES.map(c=>`<option>${c}</option>`).join('')}</select></div><div class="planning-field full"><label>Description</label><textarea class="planning-textarea" name="description"></textarea></div></div><div class="planning-footer"><button type="button" class="planning-btn" id="eventCancel">Annuler</button><button class="planning-btn primary">Créer l’événement</button></div></form>`);
 $('#eventCancel').onclick=closeModal;
 $('#eventForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(f.get('end_at')<=f.get('start_at'))return notify('La fin doit être après le début.',true);try{await query('planning_events','insert',{owner_id:state.user.id,period_id:state.period?.id||null,title:f.get('title'),description:f.get('description'),event_type:f.get('event_type'),start_at:new Date(f.get('start_at')).toISOString(),end_at:new Date(f.get('end_at')).toISOString(),status:'upcoming',class_name:f.get('class_name')||null,all_day:false});closeModal();await loadPeriod();render();notify('Événement ajouté.')}catch(err){notify(err.message,true)}};
}
function bind(){
 $('#planningPrev').onclick=()=>{state.weekStart=plusDays(state.weekStart,-7);render()};
 $('#planningNext').onclick=()=>{state.weekStart=plusDays(state.weekStart,7);render()};
 $('#planningToday').onclick=()=>{state.weekStart=mondayOf(new Date());render()};
 $('#planningPattern').onchange=e=>{state.weekPattern=e.target.value;render()};
 $$('.planning-tabs button').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;render()});
 $('#planningAddEvent').onclick=addEvent;
 $('#planningRefresh').onclick=async()=>{try{await loadPeriod();render();notify('Planning actualisé.')}catch(e){notify(e.message,true)}};
 $('#planningModalClose').onclick=closeModal;
 $('#planningModal').addEventListener('click',e=>{if(e.target.id==='planningModal')closeModal()});
}
document.addEventListener('DOMContentLoaded',()=>{bind();init()},{once:true});
})();
