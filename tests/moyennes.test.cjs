// Tests de non-régression du calcul des moyennes (sans Supabase).
// Exécution : node --test tests/moyennes.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','evaluations.js'),'utf8');
const start=source.indexOf('function studentTrackingAverageDetails(');
const end=source.indexOf('function studentTrackingIsSixthGrade(',start);
assert.ok(start>=0&&end>start,'Fonction de calcul introuvable');
const context={
  trackingUniqueGroupedRows:rows=>rows,
  trackingScore20:row=>row.score,
  studentTrackingQCUOverallAverage:rows=>rows.reduce((s,r)=>s+r.score,0)/rows.length,
  studentTrackingRoundMemorisationGrade:n=>{
    if(!Number.isFinite(n))return null;
    const low=Math.floor(n),dec=n-low;
    return Math.abs(dec-.5)<1e-9?low+.5:dec<.5?low:low+1;
  }
};
vm.createContext(context);
vm.runInContext(source.slice(start,end),context);
const calc=context.studentTrackingAverageDetails;
const grade=(score,coefficient=1)=>({score,evaluation:{coefficient}});
const qcu=score=>({score,hasScore:true});

test('aucune évaluation théorique : QCU seul pris en compte',()=>{
  const r=calc([],[qcu(14)]);
  assert.equal(r.base,null);
  assert.equal(r.final,14);
  assert.equal(r.qcuIncluded,true);
  assert.equal(r.qcuCount,1);
});
test('aucune évaluation ni QCU : pas de moyenne',()=>{
  const r=calc([],[]);
  assert.equal(r.final,null);
  assert.equal(r.qcuIncluded,false);
});
test('QCU supérieur : augmente la moyenne théorique, coefficient 1',()=>{
  const r=calc([grade(10)],[qcu(14)]);
  assert.equal(r.final,12);
  assert.equal(r.qcuIncluded,true);
});
test('QCU inférieur : ne diminue pas la moyenne théorique',()=>{
  const r=calc([grade(16)],[qcu(14)]);
  assert.equal(r.final,16);
  assert.equal(r.qcuIncluded,false);
});
test('QCU égal : moyenne inchangée',()=>{
  const r=calc([grade(14)],[qcu(14)]);
  assert.equal(r.final,14);
  assert.equal(r.qcuIncluded,false);
});
test('coefficient des évaluations conservé',()=>{
  const r=calc([grade(10,2)],[qcu(16)]);
  assert.equal(r.final,12);
});
test('arrondi QCU : 17,33 donne 17, 17,5 reste 17,5 et 17,66 donne 18',()=>{
  assert.equal(calc([],[qcu(17.33)]).final,17);
  assert.equal(calc([],[qcu(17.5)]).final,17.5);
  assert.equal(calc([],[qcu(17.66)]).final,18);
});
