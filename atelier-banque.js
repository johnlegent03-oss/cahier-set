/* Suppression prudente d'une fiche de banque — aucune suppression au chargement. */
(function(){
'use strict';
let running=false;
function isModel(title){return /^MODÈLE PERSONNEL SVT — (6e|5e|3e)$/.test(title||'');}
function references(value,id){
 if(value==null)return false;
 if(Array.isArray(value))return value.some(v=>references(v,id));
 if(typeof value==='object')return Object.entries(value).some(([k,v])=>
   (['atelier_document_id','atelierDocumentId'].includes(k)&&String(v)===id)||references(v,id));
 if(typeof value!=='string')return false;
 if(value.includes('atelier-doc='+id+' ')||value.includes('atelier-doc:'+id+' ')||value.includes('atelier-doc='+id+'--')||value.includes('atelier-doc:'+id+'--'))return true;
 const doc=new DOMParser().parseFromString(value,'text/html');
 for(const a of doc.querySelectorAll('a[href]')){
  try{const url=new URL(a.getAttribute('href'),location.href);
   if(url.searchParams.get('doc')===id)return true;
   const path=url.searchParams.get('path')||'';
   if(path.startsWith('atelier-activities/')&&(path.endsWith('/'+id+'.html')||path.includes('/'+id+'-')))return true;
  }catch(_){}
 }
 return false;
}
async function linkedCahier(id){
 for(let offset=0;;offset+=200){
  const {data,error}=await sb.from('Cahier').select('id,classe,contenu').order('id').range(offset,offset+199);
  if(error)throw Error('Vérification des cahiers impossible : '+error.message+'. Suppression annulée.');
  if(!Array.isArray(data))throw Error('Réponse des cahiers invalide. Suppression annulée.');
  for(const row of data){
   let value=row.contenu;
   if(typeof value==='string'){
    try{value=JSON.parse(value);}catch(_){throw Error('Le cahier '+row.id+' est illisible. Suppression annulée par précaution.');}
   }
   if(references(value,id))return row;
  }
  if(data.length<200)return null;
 }
}
async function removeSelected(){
 if(running)return;
 running=true;
 const button=document.getElementById('svt-delete-bank');let locked=false;
 try{
  requireUser();if(cloudBusy)throw Error('Un enregistrement est en cours. Réessaie ensuite.');
  const id=String(document.getElementById('bank').value||'');
  if(!id)throw Error('Choisis la fiche à supprimer dans « Documents enregistrés ».');
  const owner=user.id;
  cloudBusy=true;locked=true;controls();button.disabled=true;
  status('Vérification des liens avant suppression…');
  const {data:row,error}=await sb.from('atelier_documents').select('*').eq('id',id).eq('user_id',owner).single();
  if(error)throw error;
  if(row.evaluation_id)throw Error('Cette fiche est associée à une évaluation. Suppression bloquée.');
  const linked=await linkedCahier(id);
  if(linked)throw Error('Cette fiche est encore référencée dans le cahier '+(linked.classe||linked.id)+'. Suppression bloquée pour conserver son lien.');
  const title=String(row.titre||'Sans titre');
  if(!confirm('Supprimer définitivement la fiche « '+title+' » de ta banque ? Cette action ne peut pas être annulée depuis l’atelier.')){status('Suppression annulée.');return;}
  if(isModel(title)&&prompt('Il s’agit de ton modèle personnel. Pour confirmer, recopie exactement son titre :\n'+title)!==title){status('Suppression du modèle annulée.');return;}
  if(user?.id!==owner)throw Error('Le compte a changé. Suppression annulée.');
  // Nouvelle lecture après la confirmation, avant toute suppression.
  if(await linkedCahier(id))throw Error('La fiche vient d’être référencée dans un cahier. Suppression annulée.');
  let q=sb.from('atelier_documents').delete().eq('id',id).eq('user_id',owner).is('evaluation_id',null);
  if(row.updated_at!=null)q=q.eq('updated_at',row.updated_at);
  const result=await q.select('id');
  if(result.error)throw result.error;
  if(result.data?.length!==1)throw Error('Aucune suppression confirmée : document modifié, déjà supprimé ou accès refusé.');
  if(String(cloudId||'')===id){cloudId=null;cloudOwner=null;persist();}
  await refreshBank();
  status('Fiche « '+title+' » supprimée de la banque. Le contenu actuellement affiché dans l’éditeur est conservé.');
 }catch(e){console.error('[Suppression banque]',e);status(e.message||String(e),true);alert(e.message||String(e));}
 finally{if(locked){cloudBusy=false;controls();}running=false;if(button)button.disabled=false;}
}
function init(){
 const anchor=document.getElementById('saveCopyBtn');
 if(!anchor||!document.getElementById('stage')||document.getElementById('svt-delete-bank'))return;
 const button=document.createElement('button');button.id='svt-delete-bank';button.type='button';button.textContent='Supprimer la fiche sélectionnée';button.style.color='#8b3e35';button.title='Supprimer de la banque une fiche qui n’est liée à aucun cahier';
 button.onclick=removeSelected;anchor.insertAdjacentElement('afterend',button);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
