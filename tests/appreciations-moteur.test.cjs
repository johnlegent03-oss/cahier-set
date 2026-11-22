// Non-régression : appréciations françaises, phrases complètes et limite de 400 caractères.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','appreciations-moteur.js'),'utf8');
function engine(option=0){
 const ctx={
  svtAppPick:(_seed,_key,values)=>values[option%values.length],
  svtAppData:()=>({}),
  behaviorGenerateAppreciation:()=>'',generateClassAppreciation:()=>'',generateAllClassAppreciations:()=>{},
  svtAccommodationEnabled:()=>false,
  renderStudentTracking:()=>{},renderClassTracking:()=>{},
  studentsCache:[],behaviorStudentsCache:[],
  studentTrackingScienceAverageDetails:()=>({final:null,isSixthGrade:false}),
  document:{querySelectorAll:()=>[]},
  window:{},
  user:{id:'prof-test'},
  localStorage:{getItem:()=>null},
  console
 };
 vm.createContext(ctx);
 vm.runInContext(source,ctx);
 return data=>ctx.svtAppCompose({seed:'eleve-test',name:'',competencies:[],events:[],...data});
}
function sentences(text){
 return text.match(/[.!?](?=\s|$)/g)||[];
}
const student=(name,extra={})=>({name,average:14,competencies:[],events:[],...extra});
test('une bonne moyenne sans compétence renseignée produit des phrases complètes, pas un bilan télégraphique',()=>{
 const text=engine(0)(student('Anaelle'));
 assert.match(text,/Anaelle réalise un bon trimestre/);
 assert.match(text,/compétences/i);
 assert.match(text,/travail régulier/i);
 assert.doesNotMatch(text,/Anaelle\s*:\s*bilan bon/i);
 assert.ok(sentences(text).length>=3,text);
 assert.ok(text.length<=400,text);
});
test('devant une voyelle, on utilise d’Ambre, d’Émilie, d’Inès et d’Yasmine',()=>{
 const compose=engine(1); // deuxième variante de l'introduction avec « Le bilan de »
 for(const name of ['Ambre','Émilie','Inès','Yasmine']){
  const output=compose(student(name));
  assert.ok(output.includes('Le bilan d’'+name),output);
  assert.ok(!output.includes('de '+name),output);
 }
});
test('devant une consonne, on conserve « de » dans les tournures concernées',()=>{
 const output=engine(1)(student('Lucie'));
 assert.match(output,/Le bilan de Lucie est satisfaisant/);
});
test('la version compacte est toujours rédigée et entière même en présence de nombreux signaux',()=>{
 const events=[
  ...Array.from({length:4},(_,i)=>({id:i,type:'bavardage'})),
  ...Array.from({length:4},(_,i)=>({id:i+5,type:'oubli_materiel'})),
  ...Array.from({length:4},(_,i)=>({id:i+10,type:'travail_non_fait'})),
  ...Array.from({length:3},(_,i)=>({id:i+20,type:'participation'})),
  ...Array.from({length:3},(_,i)=>({id:i+30,type:'effort_progres'}))
 ];
 const compose=engine(0);
 const output=compose(student('Anaelle',{
  average:14,theoryAverage:17,practicalAverage:11,isSixthGrade:true,
  competencies:Array.from({length:8},(_,i)=>({average:i%2?2:3})),events,
  qcuAverage:8,
  accommodations:true
 }));
 assert.ok(output.length<=400,output);
 assert.ok(sentences(output).length>=2,output);
 assert.match(output,/Anaelle réalise un bon trimestre/);
 assert.doesNotMatch(output,/\bbilan bon\b/i);
 assert.ok(output.endsWith('.'),output);
});
test('les alertes de comportement ne sont pas déduites d’une seule observation isolée',()=>{
 const output=engine(0)(student('Ambre',{events:[{type:'bavardage'}]}));
 assert.doesNotMatch(output,/bavardage/i);
 assert.ok(output.length<=400);
});
test('sans note ni compétences, le texte ne prétend pas que des compétences ont été évaluées',()=>{
 const output=engine(0)(student('Anaelle',{average:null}));
 assert.match(output,/résultats.*ne permettent pas encore/i);
 assert.match(output,/prochaines évaluations/i);
 assert.doesNotMatch(output,/compétences évaluées sont bien maîtrisées/i);
 assert.ok(output.length<=400);
});
test('un prénom atypiquement long ne fait pas tronquer la proposition à 400 caractères',()=>{
 const output=engine(0)(student('A'.repeat(450),{
  average:14,events:[{type:'bavardage'},{type:'bavardage'}]
 }));
 assert.ok(output.length<=400,output);
 assert.ok(sentences(output).length>=2,output);
 assert.ok(output.endsWith('.'));
});
