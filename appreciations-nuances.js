// Charger après evaluations.js ; compatible avec appreciations-stockage.js.
(function(){
 const previousCompose=svtAppCompose;
 svtAppCompose=function(data){
  const original=previousCompose(data);
  let result=original;
  const avg=svtAppNumber(data.average);
  const values=(data.competencies||[]).map(x=>svtAppNumber(x.average)).filter(x=>x!==null&&x>=1&&x<=4);
  const weak=values.filter(x=>x<2.5).length;
  // Une compétence faible ne démontre pas, à elle seule, une difficulté persistante.
  if(avg!==null&&avg>=16&&weak===1&&values.length>1){
   result=result
    .replace(/mais des difficultés persistent dans certaines d’entre elles/g,'avec un point encore à consolider')
    .replace(/mais certaines difficultés persistent/g,'avec un point encore à consolider')
    .replace(/avec quelques points encore à consolider/g,'avec un point encore à consolider')
    .replace(/avec quelques points à consolider/g,'avec un point à consolider')
    .replace(/même si quelques fragilités subsistent/g,'avec un point encore à consolider')
    .replace(/mais certains acquis restent fragiles/g,'avec un point encore à consolider')
    .replace(/Malgré ces très bons résultats, un entraînement ciblé reste nécessaire pour surmonter les difficultés identifiées\./g,'Ce très bon bilan est à poursuivre en affinant les acquis.')
    .replace(/Un entraînement ciblé aidera à dépasser les difficultés restantes\./g,'La poursuite des entraînements permettra d’affiner les acquis.')
    .replace(/Des entraînements ciblés aideront à dépasser les difficultés restantes\./g,'La poursuite des entraînements permettra d’affiner les acquis.');
  }
  const chatter=(data.events||[]).filter(e=>e.type==='bavardage').length>=2;
  if(chatter){
   // Ne pas répéter « concentration » quand une remarque de consignes suit déjà.
   result=result.replace(/limiter les bavardages/g,'limiter les bavardages et se concentrer davantage en classe');
   if(result.length>400){
    result=result.replace(' pour mieux profiter des activités.','.');
   }
   if(result.length>400){
    result=result.replace(/Les efforts et les progrès observés sont encourageants\. ?/g,'')
     .replace('Les compétences évaluées sont très bien maîtrisées.','Les compétences sont très bien maîtrisées.')
     .replace('Les compétences évaluées sont globalement bien maîtrisées.','Les compétences sont bien maîtrisées.')
     .replace('Les résultats disponibles ne permettent pas encore de situer le trimestre.','Résultats encore incomplets.');
   }
   if(result.length>400){
    result=result.replace(/limiter les bavardages et se concentrer davantage en classe/g,'réduire les bavardages et mieux se concentrer en classe');
   }
  }
  if(result.length<=400)return result.replace(/  +/g,' ').trim();
  // Secours compact : conserver les constats de compétence, l’adaptation et tous les axes de comportement.
  const level=avg===null?null:avg>=18?'excellent':avg>=16?'très bon':avg>=12?'bon':avg>=10?'correct':avg>=6?'fragile':'inquiétant';
  const intro=level?`Bilan ${level}.`:'Résultats encore incomplets.';
  const mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const mastery=mean===null?'Compétences non renseignées.':mean>=3.5?'Les compétences sont très bien maîtrisées.':mean>=2.7?(weak?'Les acquis sont satisfaisants, avec un point à consolider.':'Les compétences sont bien maîtrisées.'):'La maîtrise des compétences reste à consolider.';
  const context=data.accommodations?'Avec les aménagements mis en place, '+mastery[0].toLowerCase()+mastery.slice(1):mastery;
  const count=t=>(data.events||[]).filter(e=>e.type===t).length;
  const participation=count('participation')>=3?'La participation en classe est bonne.':count('participation')===0?'Une participation plus active est attendue.':'';
  const actions=[];
  if(chatter)actions.push('limiter les bavardages et mieux se concentrer');
  if(count('travail_non_fait')+count('devoir_oublie')>=2)actions.push('faire les travaux demandés');
  if(count('manque_ecoute')>=2||count('non_respect_consignes')>=2)actions.push('mieux suivre les consignes');
  if(count('oubli_materiel')>=3)actions.push('apporter le matériel');
  return [intro,context,participation,'Il faudra '+actions.join(', ')+'.'].filter(Boolean).join(' ');
 };
})();
