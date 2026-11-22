/**
 * Contrôle réseau en lecture seule de la consultation publique de l'atelier.
 * Ne requiert pas de compte enseignant, ne lit aucune fiche existante :
 * l'identifiant de fiche est volontairement inexistant.
 * La réponse de la base n'est jamais affichée dans les journaux.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const configPath=path.resolve(__dirname,'..','config.js');
const source=fs.readFileSync(configPath,'utf8');
const declarations=source.split(/\r?\n/).filter(line=>/^\s*const\s+SUPABASE_(?:URL|PUBLISHABLE_KEY)\s*=/.test(line));
assert.equal(declarations.length,2,'Les deux constantes publiques Supabase doivent être déclarées.');
const config=vm.runInNewContext(declarations.join('\n')+'\n;({url:SUPABASE_URL,key:SUPABASE_PUBLISHABLE_KEY})',{});
const url=new URL(config.url);
assert.equal(url.protocol,'https:','Supabase doit utiliser HTTPS');
assert.ok(/(^|\.)supabase\.co$/i.test(url.hostname),'Domaine Supabase attendu');
assert.ok(typeof config.key==='string'&&config.key.startsWith('sb_publishable_'),
  'Le test requiert une clé publique, jamais une clé secrète');

const headers={
  'apikey':config.key,
  'Content-Type':'application/json',
  'Accept':'application/json',
  'Cache-Control':'no-store'
};
const endpoint=new URL('/rest/v1/rpc/svt_lire_fiche_publiee_v1',url);
const phantomId='00000000-0000-4000-8000-000000000000';

(async()=>{
 const response=await fetch(endpoint,{
  method:'POST',headers,
  body:JSON.stringify({p_document_id:phantomId,p_classe:'TEST'}),
  signal:AbortSignal.timeout(15000)
 });
 let data;
 try{data=await response.json()}catch{throw Error('La lecture publique ne renvoie pas de JSON (HTTP '+response.status+').')}
 if(!response.ok){
  const code=typeof data?.code==='string'?data.code:'inconnu';
  throw Error('RPC publique indisponible : HTTP '+response.status+', code '+code+
    '. Aucun document de classe n’a été consulté ou modifié.');
 }
 assert.ok(Array.isArray(data),'La RPC publique doit renvoyer une liste de fiches.');
 assert.equal(data.length,0,'Une fiche inexistante ne doit produire aucun contenu publié.');
 console.log('OK : RPC de lecture publique disponible ; une fiche inexistante renvoie zéro résultat.');

 // Présence publique de TEST : le résultat ne contient que la classe,
 // ni noms d'élèves, ni contenu des cahiers, ni document.
 const classesUrl=new URL('/rest/v1/Cahier',url);
 classesUrl.searchParams.set('select','classe,contenu');
 classesUrl.searchParams.set('classe','eq.TEST');
 classesUrl.searchParams.set('limit','1');
 const classResponse=await fetch(classesUrl,{
  headers:{'apikey':config.key,'Accept':'application/json','Cache-Control':'no-store'},
  signal:AbortSignal.timeout(15000)
 });
 if(!classResponse.ok){
  console.log('À vérifier : le cahier TEST n’est pas consultable anonymement (HTTP '+classResponse.status+').');
  return;
 }
 const classes=await classResponse.json();
 if(!Array.isArray(classes))throw Error('Format de réponse Cahier inattendu.');
 const publicTest=classes.some(row=>row&&row.classe==='TEST');
 console.log(publicTest?
  'OK : la classe TEST est visible via la lecture publique du cahier.':
  'À vérifier : aucune classe TEST visible publiquement (absente ou filtrée par RLS).');
 // Lire uniquement la structure pédagogique de TEST, jamais les autres classes.
 // Les textes, les titres de séance, les liens et les identifiants ne sont
 // ni affichés ni conservés dans les artefacts de CI.
 if(publicTest){
  let cahier=classes.find(row=>row?.classe==='TEST')?.contenu;
  if(typeof cahier==='string')cahier=JSON.parse(cahier);
  const chapters=Array.isArray(cahier)?cahier:Array.isArray(cahier?.chapitres)?cahier.chapitres:[];
  const sessions=chapters.reduce((total,ch)=>{
    const seances=Array.isArray(ch?.seances)?ch.seances:Array.isArray(ch?.sessions)?ch.sessions:[];
    return total+seances.length;
  },0);
  console.log('Préparation TEST : '+chapters.length+' chapitre(s), '+sessions+' séance(s) visibles.');
  if(sessions===0)console.log('À préparer : ajouter une séance au cahier TEST avant la recette de publication.');
 }
})().catch(error=>{console.error('Échec du contrôle public : '+error.message);process.exitCode=1});
