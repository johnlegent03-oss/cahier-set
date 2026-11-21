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
 assert.match(js,/planningWeekAddEvent'\)\.onclick=addEvent/);
 assert.match(js,/<option value="meeting">Conseil de classe/);
 assert.match(js,/data-event-week/);
 assert.match(js,/function showEventInWeek\(eventId\)/);
 assert.match(js,/state\.weekStart=mondayOf\(start\)/);
 assert.match(js,/state\.tab='planning'/);
 assert.match(js,/data-week-event-id/);
 assert.match(js,/scrollIntoView\(\{behavior:'smooth',block:'center'\}\)/);
});
