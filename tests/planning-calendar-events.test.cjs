// Test du rendu logique des événements sans connexion à Supabase.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
process.env.TZ='Europe/Paris';
const {weekCells}=require('../planning-calendar-events.js');
const monday=new Date('2026-11-23T12:00:00+01:00');
const event=(title,start_at,end_at,extras={})=>({
 id:title,title,start_at,end_at,description:'',class_name:null,
 event_type:'meeting',status:'upcoming',all_day:false,...extras
});
test('un conseil de classe à 17h00 apparait après les cours',()=>{
 const result=weekCells([
  event('Conseil de classe 6e3','2026-11-23T17:00:00+01:00','2026-11-23T18:30:00+01:00',{class_name:'6e3'})
 ],monday);
 assert.equal(result.timed.length,1);
 assert.deepEqual([result.timed[0].day,result.timed[0].from,result.timed[0].to],['2026-11-23','17:00','18:30']);
 assert.equal(result.timed[0].title,'Conseil de classe 6e3');
 assert.equal(result.timed[0].class_name,'6e3');
});
test('deux réunions à la même heure restent visibles indépendamment',()=>{
 const result=weekCells([
  event('Conseil 1','2026-11-24T17:00:00+01:00','2026-11-24T18:00:00+01:00'),
  event('Conseil 2','2026-11-24T17:00:00+01:00','2026-11-24T18:00:00+01:00')
 ],monday);
 assert.equal(result.timed.length,2);
});
test('un événement sur deux jours est présenté dans chacun',()=>{
 const result=weekCells([
  event('Réunion tardive','2026-11-23T23:30:00+01:00','2026-11-24T00:30:00+01:00')
 ],monday);
 assert.deepEqual(result.timed.map(e=>[e.day,e.from,e.to]),[
  ['2026-11-23','23:30','24:00'],['2026-11-24','00:00','00:30']
 ]);
});
test('un événement toute la journée est affiché sur sa journée',()=>{
 const result=weekCells([
  event('Sortie pédagogique','2026-11-26T00:00:00+01:00','2026-11-27T00:00:00+01:00',{all_day:true})
 ],monday);
 assert.equal(result.timed.length,0);
 assert.equal(result.allDay.length,1);
 assert.equal(result.allDay[0].day,'2026-11-26');
});
test('les événements hors de la semaine scolaire ne remontent pas',()=>{
 const result=weekCells([
  event('Samedi','2026-11-28T17:00:00+01:00','2026-11-28T18:00:00+01:00'),
  event('Semaine suivante','2026-11-30T17:00:00+01:00','2026-11-30T18:00:00+01:00')
 ],monday);
 assert.equal(result.timed.length,0);
 assert.equal(result.allDay.length,0);
});
test('les dates incohérentes ne créent aucun créneau',()=>{
 const result=weekCells([
  event('Invalide','date impossible','2026-11-23T18:00:00+01:00'),
  event('Recul','2026-11-23T20:00:00+01:00','2026-11-23T18:00:00+01:00')
 ],monday);
 assert.equal(result.timed.length,0);
});
test('le planning hebdomadaire intègre les événements et permet leur création',()=>{
 const js=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'..','planning.html'),'utf8');
 assert.match(html,/planning-calendar-events\.js/);
 assert.match(html,/id="planningWeekAddEvent"/);
 assert.match(js,/events\.timed\.forEach\(e=>timeSet\.add/);
 assert.match(js,/events\.timed\.filter\(e=>e\.day===iso\(day\)/);
 assert.match(js,/events\.allDay\.filter\(e=>e\.day===day\)/);
 assert.match(js,/weekAddEvent\.onclick=addEvent/);
 assert.match(js,/<option value="meeting">Conseil de classe/);
 assert.match(js,/data-event-week/);
 assert.match(js,/function showEventInWeek\(eventId\)/);
 assert.match(js,/state\.weekStart=mondayOf\(start\)/);
 assert.match(js,/state\.tab='planning'/);
 assert.match(js,/data-week-event-id/);
 assert.match(js,/scrollIntoView\(\{behavior:'smooth',block:'center'\}\)/);
});


const vm=require('node:vm');
const planningCode=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
function extractPlanning(start,end){
 const a=planningCode.indexOf(start),b=planningCode.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Fonction introuvable : '+start);
 return planningCode.slice(a,b);
}
function gridFor(events,{calendarModule=true}={}){
 const target={innerHTML:''},state={
  period:{id:'school'},weekPattern:'A',weekStart:new Date('2026-11-23T12:00:00+01:00'),
  slots:[{week_pattern:'AB',start_time:'08:30:00',end_time:'09:25:00'}],
  occurrences:[],events,cahierSessionsByUid:{}
 };
 const context={
  state,window:calendarModule?{PlanningCalendarEvents:{weekCells}}:{},
  DAYS:['Lundi','Mardi','Mercredi','Jeudi','Vendredi'],
  weekPatternFor:()=> 'A',visibleOccurrences:()=> [],
  iso:d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),
  plusDays:(d,n)=>{const copy=new Date(d);copy.setDate(copy.getDate()+n);return copy;},
  $:()=>target,$$:()=>[],
  esc:String,colorFor:()=> '#000',statusLabel:()=> 'Prévu',editOccurrence:()=>{}
 };
 vm.createContext(context);
 vm.runInContext(extractPlanning('function planningWeekEvents(','function colorFor('),context);
 context.renderGrid();
 return target.innerHTML;
}
test('Rendu HTML : le conseil à 17h30 existe réellement dans la grille, pas seulement dans les données',()=>{
 const html=gridFor([event('Conseil de classe 6e3','2026-11-23T17:30:00+01:00','2026-11-23T18:30:00+01:00')]);
 assert.match(html,/Conseil de classe 6e3/);
 assert.match(html,/17:30–18:30/);
 assert.match(html,/class="planning-week-event"/);
 assert.match(html,/data-week-event-id="Conseil de classe 6e3"/);
});
test('Rendu HTML : un conseil après 16h45 et les cours ordinaires coexistent',()=>{
 const html=gridFor([
  event('Conseil 6e1','2026-11-23T17:00:00+01:00','2026-11-23T18:00:00+01:00'),
  event('Conseil 6e2','2026-11-24T18:30:00+01:00','2026-11-24T19:30:00+01:00')
 ]);
 assert.match(html,/08:30/);
 assert.match(html,/17:00/);
 assert.match(html,/18:30/);
 assert.match(html,/Conseil 6e1/);
 assert.match(html,/Conseil 6e2/);
});
test('Navigation : le bouton Voir dans ma semaine active la bonne date et le bon onglet',()=>{
 let rendered=0,scrolled=0,focused=false;
 const state={
  events:[event('conseil','2026-12-15T17:15:00+01:00','2026-12-15T18:15:00+01:00')],
  tab:'events',weekStart:new Date('2026-11-23T12:00:00+01:00'),weekPattern:'A'
 };
 const node={dataset:{weekEventId:'conseil'},classList:{add:k=>{if(k==='planning-week-event-focused')focused=true}},scrollIntoView:()=>scrolled++};
 const ctx={
  state,mondayOf:d=>{const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x},
  weekPatternFor:()=> 'B',render:()=>rendered++,
  $$:()=>[node],notify:()=>{throw new Error('Aucun avertissement attendu')}
 };
 vm.createContext(ctx);
 vm.runInContext(extractPlanning('function showEventInWeek(eventId){','function renderSettings(){'),ctx);
 ctx.showEventInWeek('conseil');
 assert.equal(state.tab,'planning');
 assert.equal(state.weekPattern,'B');
 assert.equal(state.weekStart.getDate(),14);
 assert.equal(state.weekStart.getMonth(),11);
 assert.equal(rendered,1);
 assert.equal(scrolled,1);
 assert.equal(focused,true);
});

test('sans planning-calendar-events.js, un conseil enregistré à 17h45 apparaît dans la grille',()=>{
 const html=gridFor([
  event('Conseil de classe 5e1','2026-11-25T17:45:00+01:00','2026-11-25T19:00:00+01:00')
 ],{calendarModule:false});
 assert.match(html,/Conseil de classe 5e1/);
 assert.match(html,/17:45/);
 assert.match(html,/19:00/);
});
test('sans planning-calendar-events.js, les événements sur plusieurs jours restent visibles',()=>{
 const html=gridFor([
  event('Formation','2026-11-23T08:00:00+01:00','2026-11-24T18:15:00+01:00')
 ],{calendarModule:false});
 assert.match(html,/Formation/);
 assert.match(html,/08:00–24:00/);
 assert.match(html,/00:00–18:15/);
});
test('le bouton Ajouter un événement reste facultatif si le HTML est plus ancien',()=>{
 assert.match(planningCode,/const weekAddEvent=\$\('#planningWeekAddEvent'\);if\(weekAddEvent\)weekAddEvent\.onclick=addEvent/);
});
