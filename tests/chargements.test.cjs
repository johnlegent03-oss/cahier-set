// Tests de non-régression des chargements du suivi (sans données élèves réelles).
// Exécution : node --test tests/chargements.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function functionSource(filename,start,end){
  const full=fs.readFileSync(path.join(__dirname,'..',filename),'utf8');
  const a=full.indexOf(start);
  const b=full.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Bloc attendu introuvable dans '+filename);
  return full.slice(a,b);
}
function queryFor(table,reader){
  const q={table,eqFilters:{},inFilters:{},rangeFrom:0,rangeTo:999};
  const builder={
    select(){return builder},
    eq(k,v){q.eqFilters[k]=v;return builder},
    in(k,v){q.inFilters[k]=v;return builder},
    order(){return builder},
    range(from,to){q.rangeFrom=from;q.rangeTo=to;return builder},
    then(ok,fail){return Promise.resolve().then(()=>reader(q)).then(
      data=>ok({data,error:null}),fail)}
  };
  return builder;
}

test('QCU : quatre sessions au maximum en parallèle, sans perte ni réordonnancement',async()=>{
  const sessions=Array.from({length:9},(_,i)=>({
    id:'s'+(i+1),classe:'6e1',titre:'Mémo',niveau:'6e',
    trimestre:1,date_qcu:'2026-11-15',chapitres:[1]
  }));
  let activeSubjects=0,maxSubjects=0;
  const reader=async q=>{
    if(q.table==='qcu_sessions')return sessions;
    if(q.table==='qcu_sujets'){
      const n=Number(q.eqFilters.session_id.slice(1));
      activeSubjects++;
      maxSubjects=Math.max(maxSubjects,activeSubjects);
      await new Promise(resolve=>setTimeout(resolve,5+(n%4)*3));
      activeSubjects--;
      return n===3?[]:[{id:'subject'+n,code:'A',titre:'Sujet A'}];
    }
    if(q.table==='qcu_attributions'){
      const n=Number(q.eqFilters.session_id.slice(1));
      return [{id:'attr'+n,eleve_id:'student'+n,sujet_id:'subject'+n,statut:'corrige'}];
    }
    if(q.table==='qcu_sujet_questions'){
      return q.inFilters.sujet_id.map(id=>{
        const n=Number(id.slice('subject'.length));
        return {id:'sq'+n,sujet_id:id,question_id:'bank1',
          chapitre_snapshot:1,position:1,question_text_snapshot:'Question test'};
      });
    }
    if(q.table==='qcu_reponses'){
      return q.inFilters.attribution_id.map(id=>{
        const n=Number(id.slice('attr'.length));
        return {attribution_id:id,sujet_question_id:'sq'+n,is_correct:true};
      });
    }
    if(q.table==='qcu_questions')return [
      {id:'bank1',question_text:'Question test',chapitre:1}
    ];
    throw Error('Table inattendue : '+q.table);
  };
  const context={
    sb:{
      auth:{getUser:async()=>({data:{user:{id:'prof'}},error:null})},
      from(table){return queryFor(table,reader)}
    },
    studentTrackingQCUError:'',
    studentTrackingQCUCache:[],
    console
  };
  vm.createContext(context);
  vm.runInContext(functionSource('evaluations.js',
    'async function loadStudentTrackingQCUFresh(){',
    'function studentTrackingQCURowsFor('),context);
  const rows=await context.loadStudentTrackingQCUFresh();
  assert.equal(context.studentTrackingQCUError,'');
  assert.equal(rows.length,8);
  assert.deepEqual(Array.from(rows,x=>x.id),sessions.filter(x=>x.id!=='s3').map(x=>x.id));
  assert.equal(rows[0].studentScores.student1.correct,1);
  assert.equal(rows[0].studentScores.student1.total,1);
  assert.ok(maxSubjects>1,'Le chargement devrait être concurrent');
  assert.ok(maxSubjects<=4,'Le chargement ne doit pas dépasser quatre sessions');
});

test('Comportement : charger intégralement 1247 observations par pages de 500',async()=>{
  const events=Array.from({length:1247},(_,i)=>({
    id:String(i),eleve_id:'student1',classe:'6e1',type:'participation',
    period:'t1',date:'2026-11-15',note:'',created_at:'2026-11-15'
  }));
  const requested=[];
  let cached=null;
  const client={
    auth:{getSession:async()=>({data:{session:{user:{id:'prof'}}}})},
    from(table){
      assert.equal(table,'StudentBehaviorEvents');
      return queryFor(table,q=>{
        requested.push([q.rangeFrom,q.rangeTo]);
        return events.slice(q.rangeFrom,q.rangeTo+1);
      });
    }
  };
  const context={
    TABLE:'StudentBehaviorEvents',
    currentSb:()=>client,
    behaviorSupabaseLoading:false,
    behaviorSupabaseLoaded:false,
    buildStudentNames:async()=>new Map(),
    setCache:rows=>{cached=rows},
    normalizeEvent:row=>row,
    migrateLegacyEvents:async()=>{},
    renderCurrentView:()=>{},
    console
  };
  vm.createContext(context);
  vm.runInContext(functionSource('behavior-supabase.js',
    'async function fetchBehaviorEventsFromSupabase(){',
    'function renderCurrentView(){'),context);
  await context.fetchBehaviorEventsFromSupabase();
  assert.equal(context.behaviorSupabaseLoaded,true);
  assert.equal(context.behaviorSupabaseLoading,false);
  assert.equal(cached.length,1247);
  assert.deepEqual(requested,[[0,499],[500,999],[1000,1499]]);
  assert.equal(cached[1246].id,'1246');
});
