// Vérifications côté navigateur pour les sauvegardes atomiques (aucune donnée réelle).
// Exécution : node --test tests/cahier-concurrence.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const read=filename=>fs.readFileSync(path.join(__dirname,'..',filename),'utf8');
function extract(file,begin,end){
 const source=read(file),a=source.indexOf(begin),b=source.indexOf(end,a+begin.length);
 assert.ok(a>=0&&b>a,'Bloc attendu absent : '+file+' '+begin);
 return source.slice(a,b);
}

const profSource=extract('prof.html','async function saveClass(','function saveNav(){');
const atelierSource=extract('atelier.html','async function addToSession(){','async function sendEvaluation(){');
const original=()=>({chapitres:[{titre:'Chapitre initial',seances:[]}]});
const updated=()=>({chapitres:[{titre:'Chapitre modifié',seances:[]}]});

function makeProf(db,originalContent=original(),rpcError=null){
 const calls=[];
 const cache={id:7,classe:'6e1',originalContent};
 const ctx={
  currentClassData:cache,
  ensureUniquePlanningUids:()=>{},
  sb:{
   rpc:async(name,args)=>{
    calls.push({name,args});
    if(rpcError)return {data:null,error:rpcError};
    if(JSON.stringify(db.value)!==JSON.stringify(args.p_original))
     return {data:[],error:null};
    db.value=structuredClone(args.p_nouveau);
    return {data:[{cahier_id:7,cahier_contenu:structuredClone(db.value)}],error:null};
   },
   from:()=>{throw Error('Ne jamais utiliser UPDATE direct pour Cahier existant')}
  }
 };
 vm.createContext(ctx);
 vm.runInContext(profSource,ctx);
 return {save:ctx.saveClass,cache,calls};
}
test('professeur : la première sauvegarde valide fonctionne',async()=>{
 const db={value:original()},p=makeProf(db);
 assert.equal(await p.save('6e1',updated(),7),7);
 assert.equal(p.calls.length,1);
 assert.equal(p.calls[0].name,'svt_cahier_cas_v1');
 assert.deepEqual(db.value,updated());
 assert.deepEqual(p.cache.originalContent,updated());
});
test('professeur : le deuxième onglet ne peut pas écraser une version obsolète',async()=>{
 const db={value:original()};
 const a=makeProf(db),b=makeProf(db);
 await a.save('6e1',updated(),7);
 await assert.rejects(b.save('6e1',{chapitres:[]},7),/Conflit d’enregistrement/);
 assert.deepEqual(db.value,updated(),'Le contenu du premier onglet est intact');
 assert.deepEqual(b.cache.originalContent,original(),'La version de départ demeure inchangée');
});
test('professeur : absence de RPC ne déclenche pas un UPDATE non protégé',async()=>{
 const p=makeProf({value:original()},original(),{code:'PGRST202',message:'Function not found'});
 await assert.rejects(p.save('6e1',updated(),7),/Sauvegarde protégée indisponible/);
});
test('professeur : chaîne JSON ancienne conservée comme chaîne',async()=>{
 const before=JSON.stringify(original()),db={value:before};
 const p=makeProf(db,before);
 await p.save('6e1',updated(),7);
 assert.equal(typeof p.calls[0].args.p_original,'string');
 assert.equal(p.calls[0].args.p_nouveau,JSON.stringify(updated()));
 assert.equal(typeof db.value,'string');
});

function makeAtelier({db,uid='seance-originale',storedUid='seance-originale',conflict=false,storedLinkClass='6e1'}={}){
 const messages=[],calls=[];
 const entry={titre:'Séance 1',planning_uid:storedUid,activites:[]};
 const row={id:8,contenu:{chapitres:[{titre:'Chapitre 1',seances:[entry]}]}};
 const q={
  select(){return q},
  eq(){return q},
  single:async()=>({data:row,error:null})
 };
 const ctx={
  atelierLinkBusy:false,
  requireUser:()=>{},finish:()=>{},metadata:()=>{},
  context:()=>({
   classe:'6e1',cahier_id:'8',chapitre_index:0,seance_index:0,
   chapitre_titre:'Chapitre 1',seance_titre:'Séance 1'
  }),
  atelierClassCode:()=> 'code-simule',
  confirm:()=>true,saveCloud:async()=>true,cloudId:'fiche-1',cloudOwner:'prof-test',user:{id:'prof-test'},
  project:{title:'Fiche'},plain:s=>String(s),escapeHtml:s=>String(s),
  cahier:{chapitres:[{titre:'Chapitre 1',seances:[{
   titre:'Séance 1',planning_uid:uid
  }]}]},
  status:(message,error=false)=>messages.push({message,error}),
  console:{error:()=>{}},
  sb:{
   from:table=>{
     if(table==='Cahier')return q;
     if(table==='atelier_documents')return{
       select(){return this},eq(){return this},
       async maybeSingle(){return{data:{classe:storedLinkClass,cahier_id:8,chapitre_index:0,seance_index:0},error:null}}
     };
     throw Error('Table inattendue : '+table);
    },
   rpc:async(name,args)=>{
    calls.push({name,args});
    if(conflict)return {data:[],error:null};
    return {data:[{cahier_id:8,cahier_contenu:args.p_nouveau}],error:null};
   }
  }
 };
 vm.createContext(ctx);
 vm.runInContext(atelierSource,ctx);
 return {run:ctx.addToSession,ctx,messages,calls,row};
}
test('atelier : lien ajouté via RPC et non via UPDATE direct',async()=>{
 const a=makeAtelier();
 await a.run();
 assert.equal(a.calls.length,1);
 assert.equal(a.calls[0].name,'svt_cahier_cas_v1');
 assert.equal(a.calls[0].args.p_original,a.row.contenu);
 assert.equal(a.calls[0].args.p_nouveau.chapitres[0].seances[0].activites[0].atelier_document_id,'fiche-1');
 assert.match(a.messages.at(-1).message,/Lien ajouté/);
});
test('atelier : conflit de sauvegarde signalé, lien non annoncé enregistré',async()=>{
 const a=makeAtelier({conflict:true});
 await a.run();
 assert.equal(a.calls.length,1);
 assert.equal(a.messages.at(-1).error,true);
 assert.match(a.messages.at(-1).message,/cahier a changé/);
});
test('atelier : séance déplacée détectée, aucune écriture',async()=>{
 const a=makeAtelier({uid:'seance-originale',storedUid:'une-autre-seance'});
 await a.run();
 assert.equal(a.calls.length,0);
 assert.equal(a.messages.at(-1).error,true);
 assert.match(a.messages.at(-1).message,/séance sélectionnée a changé/);
});
test('atelier : changement de classe sur une fiche déjà publiée refusé',async()=>{
 const a=makeAtelier({storedLinkClass:'5e1'});
 await a.run();
 assert.equal(a.calls.length,0,'aucune écriture ne doit avoir lieu');
 assert.equal(a.messages.at(-1).error,true);
 assert.match(a.messages.at(-1).message,/Enregistrer une copie/);
});
test('SQL proposé : fonction exécutée sous les droits utilisateur et UPDATE conditionnel',()=>{
 const sql=read('propositions-sql/svt_cahier_cas_v1.sql');
 assert.match(sql,/SECURITY INVOKER/i);
 assert.doesNotMatch(sql,/SECURITY DEFINER/i);
 assert.match(sql,/UPDATE public\."Cahier"/i);
 assert.match(sql,/IS NOT DISTINCT FROM p_original/i);
 assert.match(sql,/GRANT EXECUTE.+TO authenticated/i);
 assert.match(sql,/REVOKE ALL.+FROM PUBLIC/i);
});
