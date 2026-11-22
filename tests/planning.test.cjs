// Tests du Planning — aucun accès à Supabase ni données réelles.
// Exécution : node --test tests/planning.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','planning.js'),'utf8');

function extract(start,end){
 const a=code.indexOf(start),b=code.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Bloc introuvable : '+start);
 return code.slice(a,b);
}
test('planning.js se compile sans erreur de syntaxe',()=>{
 assert.doesNotThrow(()=>new vm.Script(code));
});

function fakeClient(allRows,{failAt=null,updateRows=null}={}){
 const calls=[];
 const db={
  from(table){
   const state={table,from:0,to:999,method:'select',filters:[],order:null,selectCols:null};
   const builder={
    select(cols){state.selectCols=cols;return builder},
    insert(payload){state.method='insert';state.payload=payload;return builder},
    update(payload){state.method='update';state.payload=payload;return builder},
    eq(k,v){state.filters.push([k,'eq',v]);return builder},
    gte(k,v){state.filters.push([k,'gte',v]);return builder},
    lte(k,v){state.filters.push([k,'lte',v]);return builder},
    order(k){state.order=k;return builder},
    range(from,to){state.from=from;state.to=to;return builder},
    then(onFulfilled,onRejected){
     return Promise.resolve().then(()=>{
      calls.push({...state,filters:[...state.filters]});
      if(failAt!==null&&state.from>=failAt)return {data:null,error:new Error('Erreur simulée réseau')};
      if(state.method==='update')return {data:updateRows??[],error:null};
      if(state.method==='insert')return {data:[state.payload],error:null};
      const filtered=allRows.filter(row=>state.filters.every(([k,op,v])=>
       op==='eq'?row[k]===v:op==='gte'?row[k]>=v:row[k]<=v));
      return {data:filtered.slice(state.from,state.to+1),error:null};
     }).then(onFulfilled,onRejected);
    }
   };
   return builder;
  }
 };
 return {db,calls};
}
function createQuery(client){
 const context={client:()=>client};
 vm.createContext(context);
 vm.runInContext(extract('async function query(','async function init(){'),context);
 return context.query;
}
test('charge 1253 occurrences sans arrêt à la 1000e ligne',async()=>{
 const data=Array.from({length:1253},(_,i)=>({id:i+1,owner_id:'prof'}));
 const {db,calls}=fakeClient(data);
 const rows=await createQuery(db)('planning_session_occurrences','select',null,[['owner_id','eq','prof']]);
 assert.equal(rows.length,1253);
 assert.equal(rows[1252].id,1253);
 assert.deepEqual(calls.map(c=>[c.from,c.to]),[[0,499],[500,999],[1000,1499]]);
 assert.ok(calls.every(c=>c.order==='id'));
});
test('lire plusieurs pages respecte les filtres existants',async()=>{
 const data=Array.from({length:1170},(_,i)=>({id:i+1,owner_id:i%2?'autre':'prof'}));
 const {db}=fakeClient(data);
 const rows=await createQuery(db)('planning_slots','select',null,[['owner_id','eq','prof']]);
 assert.equal(rows.length,585);
 assert.ok(rows.every(r=>r.owner_id==='prof'));
});
test('ne retourne pas une liste tronquée en cas d’échec de la 2e page',async()=>{
 const data=Array.from({length:800},(_,i)=>({id:i+1}));
 const {db}=fakeClient(data,{failAt:500});
 await assert.rejects(
  createQuery(db)('planning_session_occurrences','select'),
  /Erreur simulée réseau/
 );
});
test('une mise à jour rejetée ne doit jamais être annoncée comme réussie',async()=>{
 const {db,calls}=fakeClient([],{updateRows:[]});
 await assert.rejects(
  createQuery(db)('planning_session_occurrences','update',{notes:'test'},[['id','eq','occ1']]),
  /Enregistrement non confirmé/
 );
 assert.equal(calls[0].selectCols,'id');
});
test('une mise à jour confirmée retourne son identifiant',async()=>{
 const {db}=fakeClient([],{updateRows:[{id:'occ1'}]});
 const rows=await createQuery(db)('planning_session_occurrences','update',{notes:'test'},[['id','eq','occ1']]);
 assert.equal(rows[0].id,'occ1');
});

function gridHtml(state){
 const target={innerHTML:''};
 const context={
  state,DAYS:['Lundi','Mardi','Mercredi','Jeudi','Vendredi'],
  weekPatternFor:()=> 'A',visibleOccurrences:()=>[],
  planningWeekEvents:()=>({timed:[],allDay:[]}),
  iso:()=> '2026-11-23',plusDays:d=>d,
  $:()=>target,$$:()=>[],
  esc:String,colorFor:()=> '#000',statusLabel:()=> 'Prévu'
 };
 vm.createContext(context);
 vm.runInContext(extract('function renderGrid(){','function colorFor('),context);
 context.renderGrid();
 return target.innerHTML;
}
const baseline={
 weekStart:new Date('2026-11-23T12:00:00Z'),
 weekPattern:'A',period:null,slots:[],occurrences:[]
};
test('année scolaire absente : expliquer la première étape',()=>{
 assert.match(gridHtml({...baseline}),/Aucune année scolaire configurée/);
 assert.match(gridHtml({...baseline}),/Paramètres/);
});
test('aucun créneau : guider vers l’initialisation',()=>{
 assert.match(gridHtml({...baseline,period:{id:1}}),/Aucun créneau enregistré/);
});
test('créneaux présents sans cours généré : indiquer la génération',()=>{
 assert.match(gridHtml({...baseline,period:{id:1},slots:[{
  week_pattern:'AB',start_time:'09:00',end_time:'10:00'
 }]}),/séances ne sont pas encore générées/);
});
