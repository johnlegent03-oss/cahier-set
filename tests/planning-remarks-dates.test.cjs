// Phase 10 — vérifications des remarques par dates scolaires réelles.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Remarks=require('../planning-remarks.js');
const occurrence=(id,classe,type,date)=>({id,classe,type,date});
const rows=[
 occurrence(1,'6e2','bavardage','2026-11-18T09:00:00Z'),
 occurrence(2,'6e2','oubli_materiel','2026-11-18T11:00:00Z'),
 occurrence(3,'6e1','travail_non_fait','2026-11-18T13:00:00Z'),
 occurrence(4,'6e2','participation','2026-11-19T11:00:00Z'),
 occurrence(5,'6e2','bavardage','2026-11-19T08:00:00Z'),
 occurrence(6,'6e2','message_envoye_bavardage','2026-11-19T17:00:00Z'),
 occurrence(7,'6e2','bavardage','2026-11-20T09:00:00Z')
];
const period={fromDate:'2026-09-01',toDate:'2027-07-03',classes:['6e1','6e2']};
test('une remarque avec fuseau UTC est rattachée au jour Europe/Paris, y compris au changement de date',()=>{
 assert.equal(Remarks.frenchDate('2026-11-21T23:40:00.000Z'),'2026-11-22');
 assert.equal(Remarks.frenchDate('2026-06-30T22:40:00.000Z'),'2026-07-01');
 assert.equal(Remarks.frenchDate('2026-11-22'),'2026-11-22');
 assert.equal(Remarks.frenchDate('invalide'),'');
});
test('une ligne par date et classe, et pas une ligne par séance scolaire',()=>{
 const data=Remarks.byDate(rows,period);
 assert.equal(data.length,4);
 assert.deepEqual(data.map(r=>r.date+' '+r.classe),[
  '2026-11-20 6e2',
  '2026-11-19 6e2',
  '2026-11-18 6e1',
  '2026-11-18 6e2'
 ].filter(Boolean));
});
test('chaque type est compté au jour correspondant, sans doublonner les communications',()=>{
 const data=Remarks.byDate(rows,period);
 const d18=data.find(x=>x.date==='2026-11-18'&&x.classe==='6e2');
 assert.ok(d18);
 assert.equal(d18.counts.total,2);
 assert.equal(d18.counts.bavardage,1);
 assert.equal(d18.counts.materiel,1);
 const d19=data.find(x=>x.date==='2026-11-19'&&x.classe==='6e2');
 assert.equal(d19.counts.total,1);
 assert.equal(d19.counts.participation,1);
 const c=Remarks.summarize(rows,period);
 assert.equal(c.total,5);
 assert.equal(c.participation,1);
});
test('la sélection du jour et de la classe adapte le journal comme les compteurs',()=>{
 const selection={...period,className:'6e2',fromDate:'2026-11-18',toDate:'2026-11-18'};
 const daily=Remarks.byDate(rows,selection);
 assert.equal(daily.length,1);
 assert.equal(daily[0].classe,'6e2');
 assert.equal(daily[0].counts.total,2);
 assert.equal(Remarks.summarize(rows,selection).total,2);
 assert.equal(Remarks.summarize(rows,selection).participation,0);
 assert.equal(Remarks.byDate(rows,{...selection,className:'6e3'}).length,0);
});
test('le journal se calcule sur des données en lecture seule sans les modifier',()=>{
 const frozen=Object.freeze(rows.map(r=>Object.freeze({...r})));
 assert.equal(Remarks.byDate(frozen,period).length,4);
 assert.equal(Remarks.summarize(frozen,period).total,5);
});
test('la requête annuelle couvre aussi les heures proches de minuit du calendrier parisien',()=>{
 assert.deepEqual(Remarks.utcFetchBounds('2026-09-01','2027-07-03'),{
  from:'2026-08-31T00:00:00.000Z',
  toExclusive:'2027-07-04T00:00:00.000Z'
 });
 assert.throws(()=>Remarks.utcFetchBounds('2026-12-20','2026-11-01'),/invalides/);
});
test('le rendu affiche l’historique daté et les entrées de la classe, filtrées aux dates sélectionnées',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
 const a=source.indexOf('function renderRemarks(){');
 const b=source.indexOf('async function loadRemarks(){',a);
 assert.ok(a>0&&b>a);
 const nodes={
  '#planningRemarksSummary':{innerHTML:''},
  '#planningRemarksHistory':{innerHTML:''},
  '#planningRemarksFrom':{value:'',min:'',max:''},
  '#planningRemarksTo':{value:'',min:'',max:''}
 };
 const state={
  remarksRows:rows,remarksLoading:false,remarksError:'',remarksFrom:'2026-11-18',
  remarksTo:'2026-11-19',followupClass:'6e2',
  occurrences:[],period:{start_date:'2026-09-01',end_date:'2027-07-03'}
 };
 const ctx={window:{PlanningRemarks:Remarks},state,CLASSES:['6e1','6e2'],
  $:id=>nodes[id]||null,dateFrom:x=>new Date(x+'T12:00:00'),
  esc:x=>String(x)};
 vm.createContext(ctx);vm.runInContext(source.slice(a,b),ctx);
 ctx.renderRemarks();
 assert.match(nodes['#planningRemarksHistory'].innerHTML,/18 novembre 2026/);
 assert.match(nodes['#planningRemarksHistory'].innerHTML,/19 novembre 2026/);
 assert.doesNotMatch(nodes['#planningRemarksHistory'].innerHTML,/20 novembre 2026/);
 assert.match(nodes['#planningRemarksHistory'].innerHTML,/6e2/);
 assert.doesNotMatch(nodes['#planningRemarksHistory'].innerHTML,/6e1/);
 assert.match(nodes['#planningRemarksHistory'].innerHTML,/data-remarks-week="2026-11-18"/);
 assert.equal(nodes['#planningRemarksFrom'].value,'2026-11-18');
 assert.equal(nodes['#planningRemarksTo'].value,'2026-11-19');
 state.remarksFrom='2026-11-20';state.remarksTo='2026-11-18';
 ctx.renderRemarks();
 assert.match(nodes['#planningRemarksSummary'].innerHTML,/date de début/);
 assert.equal(nodes['#planningRemarksHistory'].innerHTML,'');
});
test('les contrôles ouvrent une semaine existante, sans attribution à une séance ou écriture',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','planning.html'),'utf8');
 const source=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
 for(const id of ['planningRemarksFrom','planningRemarksTo','planningRemarksWeek',
  'planningRemarksYear','planningRemarksHistory'])assert.match(html,new RegExp(id));
 assert.match(source,/state\.weekStart=mondayOf\(dateFrom\(date\)\)/);
 assert.match(source,/data-remarks-week/);
 assert.match(source,/state\.tab='planning'/);
 assert.match(source,/window\.PlanningRemarks\.utcFetchBounds/);
 assert.match(source,/\.lt\('date',toExclusive\)/);
 assert.match(html,/plusieurs cours ont lieu le même jour/);
});
