// Phase 9 : comptage réel des remarques depuis les observations existantes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Remarks=require('../planning-remarks.js');
const row=(id,classe,type,date='2026-11-20T12:00:00+01:00')=>({id,classe,type,date});
const bounds={fromDate:'2026-09-01',toDate:'2027-07-03',classes:['6e1','6e2']};
test('compter uniquement les remarques négatives et séparer les participations positives',()=>{
 const data=[
  row(1,'6e2','bavardage'),row(2,'6e2','bavardage'),
  row(3,'6e2','oubli_materiel'),row(4,'6e2','travail_non_fait'),
  row(5,'6e2','participation'),row(6,'6e2','effort_progres'),
  row(7,'6e2','message_envoye_bavardage'),
  row(8,'6e2','message_envoye_travail_materiel'),
  row(9,'6e2','mention_envoyee_participation'),
  row(10,'6e2','non_respect_consignes')
 ];
 const c=Remarks.summarize(data,bounds);
 assert.deepEqual(c,{total:5,bavardage:2,materiel:1,travail:1,autres:1,participation:2});
});
test('filtrage par classe, période scolaire et exclusion des classes extérieures',()=>{
 const data=[
  row(1,'6e2','bavardage','2026-11-20T12:00:00'),
  row(2,'6e1','travail_non_fait','2026-11-20T12:00:00'),
  row(3,'6e2','oubli_materiel','2025-11-20T12:00:00'),
  row(4,'4e1','bavardage','2026-11-20T12:00:00')
 ];
 const c=Remarks.summarize(data,{...bounds,className:'6e2'});
 assert.equal(c.total,1);
 assert.equal(Remarks.summarize(data,bounds).total,2);
});
test('les types inconnus et marqueurs de message ne gonflent pas le total',()=>{
 const c=Remarks.summarize([
  row(1,'6e2','message_envoye_bavardage'),
  row(2,'6e2','mention_envoyee_participation'),
  row(3,'6e2','type_non_reconnu'),
  row(4,'6e2','devoir_oublie'),
  row(5,'6e2','manque_ecoute')
 ],bounds);
 assert.equal(c.total,2);
 assert.equal(c.autres,2);
 assert.equal(c.participation,0);
});
test('les remarques ne modifient pas les objets sources',()=>{
 const rows=Object.freeze([Object.freeze(row(1,'6e2','bavardage'))]);
 const c=Remarks.summarize(rows,bounds);
 assert.equal(c.total,1);
});
test('afficher un panneau explicite en cas de droits insuffisants, sans prétendre à zéro',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
 const a=source.indexOf('function renderRemarks(){'),b=source.indexOf('async function loadRemarks(){',a);
 assert.ok(a>0&&b>a);
 const node={innerHTML:''};
 const history={innerHTML:''};
 const fromInput={value:'',min:'',max:''},toInput={value:'',min:'',max:''};
 const state={remarksRows:null,remarksLoading:false,remarksError:'Permission refusée',
  followupClass:'6e2',occurrences:[],period:{start_date:'2026-09-01',end_date:'2027-07-03'}};
 const ctx={window:{PlanningRemarks:Remarks},state,$:id=>({
  '#planningRemarksSummary':node,'#planningRemarksHistory':history,
  '#planningRemarksFrom':fromInput,'#planningRemarksTo':toInput
 })[id]||null,esc:x=>String(x),CLASSES:['6e2'],
  dateFrom:s=>new Date(s+'T12:00:00')};
 vm.createContext(ctx);vm.runInContext(source.slice(a,b),ctx);
 ctx.renderRemarks();
 assert.match(node.innerHTML,/Remarques indisponibles/);
 assert.doesNotMatch(node.innerHTML,/Remarques négatives/);
 state.remarksError='';state.remarksRows=[row('one','6e2','bavardage')];
 ctx.renderRemarks();
 assert.match(node.innerHTML,/Remarques négatives/);
 assert.match(node.innerHTML,/Bavardages/);
 assert.match(node.innerHTML,/>1<\/strong>/);
});
test('la lecture Supabase est paginée, sans noms, et sans écriture',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
 const a=source.indexOf('async function loadRemarks(){'),b=source.indexOf('function renderSettings(){',a);
 assert.ok(a>0&&b>a);
 const rows=Array.from({length:1253},(_,i)=>row('id-'+i,'6e2','bavardage'));
 const ranges=[],selected=[];
 const builder={
  select(cols){selected.push(cols);return this;},
  gte(){return this;},lte(){return this;},lt(){return this;},
  order(){return this;},
  async range(start,end){ranges.push([start,end]);return {data:rows.slice(start,end+1),error:null};}
 };
 const state={user:{id:'p'},period:{id:'period',start_date:'2026-09-01',end_date:'2027-07-03'},
  remarksLoading:false,remarksRows:null,remarksError:'',remarksRequest:0};
 const ctx={state,client:()=>({from(name){assert.equal(name,'StudentBehaviorEvents');return builder;}}),
  renderRemarks(){}};
 vm.createContext(ctx);vm.runInContext(source.slice(a,b),ctx);
 await ctx.loadRemarks();
 assert.equal(state.remarksRows.length,1253);
 assert.deepEqual(ranges,[[0,499],[500,999],[1000,1499]]);
 assert.ok(selected.every(v=>v==='id,classe,type,date'));
 assert.equal(state.remarksLoading,false);
});
test('le nouveau panneau est chargé avant le script principal, sans altérer le reste',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','planning.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');
 assert.match(html,/planningRemarksSummary/);
 assert.match(html,/planningRemarksRefresh/);
 assert.ok(html.indexOf('planning-remarks.js')<html.indexOf('planning.js'));
 assert.match(js,/function loadRemarks\(\)/);
 assert.match(js,/function renderRemarks\(\)/);
 assert.match(js,/\.select\('id,classe,type,date'\)/);
 assert.match(js,/renderRemarks\(\)/);
 assert.match(js,/\$\$\('\.planning-tabs button'\)/);
});
