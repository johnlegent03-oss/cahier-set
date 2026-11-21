// Charger après appreciations-nuances.js et avant appreciations-stockage.js.
(function(){
 const previous=svtAppCompose;
 let batch=null;
 function normalized(text,name){
  let value=String(text);
  if(name)value=value.split(String(name)).join('[élève]');
  return value.replace(/\s+/g,' ').trim();
 }
 function choose(seed,key,items){return svtAppPick(seed,key,items);}
 function rewrite(data,attempt){
  let text=previous(data);
  const seed=String(data.seed||'')+'|classe|'+attempt;
  const avg=svtAppNumber(data.average);
  const scientific=choose(seed,'science',[
   'Pour aller plus loin, il sera utile de développer les explications scientifiques.',
   'L’objectif sera d’approfondir les raisonnements scientifiques en justifiant les réponses.',
   'Relier les observations aux conclusions permettra d’affiner le raisonnement scientifique.',
   'Pour approfondir les acquis, il faudra expliciter les étapes du raisonnement scientifique.',
   'La poursuite des entraînements aidera à construire des réponses scientifiques argumentées.'
  ]);
  // Ne remplacer que les conseils génériques, pas les difficultés ou remarques comportementales.
  const generic=[
   'La poursuite des entraînements permettra de renforcer les acquis.',
   'Ces très bons résultats sont à maintenir au prochain trimestre.',
   'Félicitations pour ce bilan ; cette dynamique est à poursuivre.',
   'Ce très bon bilan mérite des félicitations. Il faudra poursuivre sur cette lancée.',
   'Cette dynamique est à poursuivre en approfondissant les raisonnements.',
   'Pour aller plus loin, il faudra continuer à développer les justifications.',
   'Pour aller plus loin, il faudra s’entraîner à expliquer et justifier les réponses.'
  ];
  for(const sentence of generic)if(text.includes(sentence)){
   const replacement=avg!==null&&avg>=16?'Félicitations pour ce bilan. '+scientific:scientific;
   const candidate=text.replace(sentence,replacement);
   if(candidate.length<=400)text=candidate;
   break;
  }
  text=text.replace('La participation en classe est bonne.',choose(seed,'participation',[
   'La participation en classe est bonne.',
   'La bonne participation en classe est à souligner.',
   'La participation en classe constitue un point positif.'
  ]));
  const name=String(data.name||'').trim();
  if(name&&avg!==null){
   const level=avg>=18?'excellent':avg>=16?'très bon':avg>=12?'bon':avg>=10?'correct':avg>=6?'fragile':'inquiétant';
   const term=level==='excellent'?'un excellent trimestre':['fragile','inquiétant'].includes(level)?`un trimestre ${level}`:`un ${level} trimestre`;
   const opening=name+' réalise '+term+'.';
   const alternative=choose(seed,'opening',[
    opening,
    `${name} présente un bilan ${level} ce trimestre.`,
    `Le bilan trimestriel est ${level} pour ${name}.`
   ]);
   if(text.startsWith(opening))text=alternative+text.slice(opening.length);
  }
  // Déplacer une phrase complète, sans modifier les pronoms ou les connecteurs.
  const participationMatches=[
   'La participation en classe est bonne.',
   'La bonne participation en classe est à souligner.',
   'La participation en classe constitue un point positif.'
  ];
  if(choose(seed,'order',[false,true]))for(const phrase of participationMatches){
   const position=text.indexOf(phrase),end=text.indexOf('. ');
   if(position>end+2&&end>=0){
    const without=text.replace(phrase+' ','');
    text=without.slice(0,end+2)+phrase+' '+without.slice(end+2);
    break;
   }
  }
  return text.length<=400?text:previous(data);
 }
 svtAppCompose=function(data){
  let selected=rewrite(data,0);
  if(batch){
   let least=Infinity;
   for(let attempt=0;attempt<64;attempt++){
    const candidate=rewrite(data,attempt);
    const key=normalized(candidate,data.name);
    const count=batch.get(key)||0;
    if(count<least){least=count;selected=candidate;}
    if(count===0)break;
   }
   const key=normalized(selected,data.name);batch.set(key,(batch.get(key)||0)+1);
  }
  return selected;
 };
 const generateBatch=generateAllClassAppreciations;
 generateAllClassAppreciations=function(){
  batch=new Map();
  try{return generateBatch();}finally{batch=null;}
 };
})();
