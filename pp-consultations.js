(()=>{'use strict';
const likert=['Tout à fait','Plutôt oui','Plutôt non','Pas du tout'];
const groups=[['La vie de classe',[['bien','Je me sens bien dans ma classe.'],['ambiance','Il y a une bonne ambiance.'],['respect','Les élèves se respectent.'],['entraide','Les élèves s’entraident.'],['calme','Le calme me permet de travailler.'],['securite','Je me sens en sécurité au collège.'],['parole','J’ose prendre la parole.'],['ecoute','Je me sens écouté par les adultes.']]],['Mon travail scolaire',[['resultats','Je suis satisfait de mes résultats.'],['progres','J’ai le sentiment d’avoir progressé.'],['attention','Je suis attentif en cours.'],['participation','Je participe en classe.'],['maison','Je travaille régulièrement à la maison.'],['organisation','J’arrive à organiser mon travail.'],['consignes','Je comprends les consignes.'],['aide','J’ose demander de l’aide.'],['efforts','J’ai fourni suffisamment d’efforts.']]]];
const extra=[['charge','Comment trouves-tu la quantité de travail à la maison ?',['Trop importante','Adaptée','Pas assez importante']],['evaluations','Comment trouves-tu la répartition des évaluations ?',['Bien réparties','Parfois trop regroupées','Souvent trop regroupées']],['adaptation','As-tu réussi à t’adapter au collège ?',['Oui, complètement','Oui, progressivement','Quelques difficultés','Beaucoup de difficultés']]];
const privateChoices=[['difficultes','Rencontres-tu des difficultés dans certaines matières ?',['Oui','Non','Je ne sais pas']],['entretien','Souhaites-tu rencontrer ton professeur principal ?',['Oui','Non','Peut-être']]];
const openQuestions=[['matieres','Dans quelles matières rencontres-tu des difficultés ?'],['raisons','Quelles sont les raisons de tes difficultés ?'],['explication','Explique plus précisément tes difficultés dans ces matières.'],['probleme','Y a-t-il un problème dont tu aimerais parler avec ton professeur principal ?'],['positifs','Quels sont les points positifs de notre classe ?'],['ameliorations','Quels sont les points à améliorer ?'],['solutions','Quelles solutions proposes-tu ?']];
const subjects=['Français','Mathématiques','Histoire-géographie-EMC','Anglais','SVT','Physique-chimie','Arts plastiques','Éducation musicale','EPS','Autre'];
const reasons=['Je ne comprends pas certaines leçons','J’ai du mal à mémoriser','J’ai du mal à comprendre les consignes','J’ai du mal à me concentrer','Je n’ose pas poser de questions','Je manque de méthode','Je ne travaille pas suffisamment','Le bruit me gêne','Je manque de confiance en moi','Autre'];
const scale=Array.from({length:10},(_,i)=>String(i+1));
const scales=[['note_ambiance','Note de l’ambiance de la classe sur 10',scale],['note_trimestre','Note de mon trimestre au collège sur 10',scale]];
const publicQuestions=[...groups.flatMap(g=>g[1].map(([k,t])=>[k,t,likert])),...extra,...scales];
const allTitles=new Map([...publicQuestions,...privateChoices,...openQuestions].map(([k,t])=>[k,t]));
function el(tag,text,parent){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(parent)parent.append(n);return n;}
function card(parent,title){const n=el('section',null,parent);n.className='ppq-card';if(title)el('h2',title,n);return n;}
function btn(parent,label,fn){const n=el('button',label,parent);n.type='button';n.addEventListener('click',fn);return n;}
function radio(parent,key,title,options){const f=el('fieldset',null,parent);el('legend',title,f);const row=el('div',null,f);row.className='ppq-options';options.forEach(v=>{const l=el('label',null,row),i=el('input',null,l);i.type='radio';i.name=key;i.value=v;i.required=true;l.append(' '+v);});}
function checks(parent,key,title,options){const f=el('fieldset',null,parent);el('legend',title,f);options.forEach(v=>{const l=el('label',null,f),i=el('input',null,l);i.type='checkbox';i.name=key;i.value=v;l.append(' '+v);});}
function field(parent,key,title,type='text'){const l=el('label',title,parent),i=el(type==='textarea'?'textarea':'input',null,l);if(type!=='textarea')i.type=type;i.name=key;i.maxLength=type==='textarea'?1500:100;return i;}
function unwrap(r){if(r.error)throw new Error(r.error.message);return r.data;}
function student(){const mount=document.getElementById('ppqForm');if(!mount)return;const f=el('form',null,mount);const a=card(f,'1. Mon identité');const first=field(a,'prenom','Ton prénom (comme sur ton code individuel)');first.required=true;const code=field(a,'code','Ton code individuel');code.required=true;code.pattern='[A-Fa-f0-9 ]{20,30}';code.autocomplete='off';code.spellcheck=false;code.setAttribute('autocapitalize','off');
groups.forEach(([title,questions],i)=>{const c=card(f,(i+2)+'. '+title);questions.forEach(([k,t])=>radio(c,k,t,likert));if(i===1)extra.forEach(([k,t,o])=>radio(c,k,t,o));});
const b=card(f,'4. Mes difficultés personnelles');el('p','Cette partie est réservée à ton professeur principal.',b);radio(b,...privateChoices[0]);checks(b,'matieres',openQuestions[0][1],subjects);checks(b,'raisons',openQuestions[1][1],reasons);openQuestions.slice(2,4).forEach(([k,t])=>field(b,k,t,'textarea'));radio(b,...privateChoices[1]);
const c=card(f,'5. Le bilan de notre classe');el('p','Ne cite aucun nom dans cette partie. Les idées retenues pourront être présentées au conseil de classe.',c);openQuestions.slice(4).forEach(([k,t])=>field(c,k,t,'textarea'));scales.forEach(([k,t,o])=>radio(c,k,t,o));const send=el('button','Envoyer mes réponses',c);send.type='submit';const status=el('p','',c);status.className='ppq-status';status.setAttribute('role','status');
const client=supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
f.addEventListener('submit',async e=>{e.preventDefault();if(!f.reportValidity())return;const data=new FormData(f),answers={};[...publicQuestions,...privateChoices].forEach(([k])=>answers[k]=data.get(k));openQuestions.forEach(([k])=>answers[k]=['matieres','raisons'].includes(k)?data.getAll(k).join(' ; '):String(data.get(k)||'').trim());send.disabled=true;status.textContent='Envoi en cours…';try{const ok=unwrap(await client.rpc('pp_consultation_submit',{p_code:String(data.get('code')).replace(/\s/g,'').toLowerCase(),p_prenom:String(data.get('prenom')).trim(),p_reponses:answers}));if(!ok)throw new Error('Code ou prénom incorrect, questionnaire fermé ou réponse déjà envoyée. Vérifie avec ton professeur.');mount.replaceChildren();const done=card(mount,'Merci !');el('p','Tes réponses ont été enregistrées. Tu peux fermer cette page.',done);}catch(err){status.textContent=err.message;send.disabled=false;}});
}
function token(){return Array.from(crypto.getRandomValues(new Uint8Array(10)),x=>x.toString(16).padStart(2,'0')).join('');}
function year(){const d=new Date(),y=d.getFullYear()-(d.getMonth()<8?1:0);return y+'-'+(y+1);}
function table(parent,head,rows){const t=el('table',null,parent),h=el('tr',null,el('thead',null,t));head.forEach(v=>el('th',v,h));const body=el('tbody',null,t);rows.forEach(row=>{const tr=el('tr',null,body);row.forEach(v=>el('td',v,tr));});return t;}
function summary(parent,rows){const n=rows.length;if(!n){el('p','Aucune réponse reçue.',parent);return;}publicQuestions.forEach(([key,title,options])=>{el('h3',title,parent);const counts=options.map(o=>rows.filter(r=>r.reponses[key]===o).length);const bar=el('div',null,parent);bar.className='ppq-bar';const colors=['#347852','#93bf88','#ecb969','#be6557'];counts.forEach((v,i)=>{const s=el('span',null,bar);s.style.width=(100*v/n)+'%';s.style.background=colors[i%4];});el('p',options.map((o,i)=>o+' : '+counts[i]+' ('+Math.round(100*counts[i]/n)+' %)').join(' · '),parent);if(key.startsWith('note_'))el('p','Moyenne : '+(rows.reduce((s,r)=>s+Number(r.reponses[key]),0)/n).toFixed(1).replace('.',',')+'/10',parent);});}
function printPage(title,build){const w=window.open('','_blank');if(!w){alert('Autorise les fenêtres surgissantes pour imprimer.');return;}w.document.title=title;const style=w.document.createElement('style');style.textContent='body{font:14px Arial,sans-serif;padding:22px;color:#222}h1,h2,h3{break-after:avoid}h3{margin:14px 0 4px}p{margin:5px 0}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #ccc;text-align:left}.ppq-bar{display:flex;height:12px;background:#eee;print-color-adjust:exact;-webkit-print-color-adjust:exact}@media print{button{display:none}}';w.document.head.append(style);const header=w.document.createElement('h1');header.textContent=title;w.document.body.append(header);build(w.document.body);const b=w.document.createElement('button');b.textContent='Imprimer / enregistrer en PDF';b.onclick=()=>w.print();w.document.body.prepend(b);w.opener=null;}
async function admin(){const parent=document.getElementById('ppqAdmin');if(!parent)return;const host=card(parent,'Consultation des élèves');const nav=el('div',null,host);nav.className='ppq-row';const y=field(nav,'annee','Année scolaire');y.value=year();const label=el('label','Trimestre',nav),period=el('select',null,label);[1,2,3].forEach(v=>{const o=el('option','Trimestre '+v,period);o.value=v;});period.value=typeof ppPeriod!=='undefined'&&/^t[123]$/.test(ppPeriod)?ppPeriod.slice(1):'1';const status=el('p','',host);status.setAttribute('role','status');const output=el('div',null,host);const cls=()=>typeof ppClass!=='undefined'&&ppClass?ppClass:'6e3';const query=async()=>unwrap(await sb.from('pp_consultations').select('*').eq('classe',cls()).eq('annee',y.value).eq('trimestre',Number(period.value)).maybeSingle());let busy=false;
async function refresh(){if(busy)return;busy=true;period.disabled=y.disabled=true;status.textContent='Chargement…';output.replaceChildren();try{if(!/^\d{4}-\d{4}$/.test(y.value))throw Error('Année scolaire invalide (ex. 2026-2027).');const {data:aal,error}=await sb.auth.mfa.getAuthenticatorAssuranceLevel();if(error||aal?.currentLevel!=='aal2')throw Error('Reconnecte-toi avec la double authentification.');const campaign=await query();if(!campaign){status.textContent='Aucune consultation pour cette période.';btn(output,'Créer le questionnaire',async()=>{if(busy)return;busy=true;try{unwrap(await sb.from('pp_consultations').insert({classe:cls(),annee:y.value,trimestre:Number(period.value)}));}catch(e){alert(e.message);}finally{busy=false;await refresh();}});return;}
const invitations=unwrap(await sb.from('pp_consultation_invitations').select('*').eq('consultation_id',campaign.id).order('nom').order('prenom'));const done=invitations.filter(i=>i.reponses&&i.submitted_at);status.textContent=campaign.classe+' · '+campaign.annee+' · T'+campaign.trimestre+' · '+(campaign.ouverte?'OUVERT':'FERMÉ')+' · '+done.length+'/'+invitations.length+' réponses';
const actions=el('div',null,output);actions.className='ppq-row';btn(actions,'Synchroniser les élèves / générer les codes',async()=>{if(busy)return;busy=true;try{const students=unwrap(await sb.from('Eleves').select('id,prenom,nom').eq('classe',campaign.classe).order('nom'));const ids=new Set(invitations.map(i=>i.eleve_id));const add=students.filter(s=>!ids.has(String(s.id))).map(s=>({consultation_id:campaign.id,eleve_id:String(s.id),prenom:s.prenom,nom:s.nom||'',code:token()}));if(add.length)unwrap(await sb.from('pp_consultation_invitations').insert(add));}catch(e){alert(e.message);}finally{busy=false;await refresh();}});
btn(actions,campaign.ouverte?'Fermer le questionnaire':'Ouvrir le questionnaire',async()=>{if(busy)return;if(!campaign.ouverte&&!invitations.length){alert('Génère d’abord les codes.');return;}busy=true;try{unwrap(await sb.from('pp_consultations').update({ouverte:!campaign.ouverte}).eq('id',campaign.id).select('id').single());}catch(e){alert(e.message);}finally{busy=false;await refresh();}});
const link=new URL('questionnaire-pp.html',location.href).href;const linkField=field(output,'lien','Lien commun à transmettre');linkField.value=link;linkField.readOnly=true;btn(actions,'Copier le lien',async()=>{try{await navigator.clipboard.writeText(link);status.textContent='Lien copié.';}catch{linkField.select();}});btn(actions,'Imprimer les codes individuels',()=>printPage('Codes individuels – confidentiel',p=>table(p,['Élève','Code'],invitations.filter(i=>!i.submitted_at).map(i=>[i.prenom+' '+i.nom,i.code]))));
const stats=card(output,'Résultats collectifs');el('p',done.length+' réponses reçues.',stats);summary(stats,done);const note=field(stats,'synthese','Idées collectives validées par le PP (sans nom ni détail identifiable)','textarea');btn(stats,'PDF délégués — collectif uniquement',()=>printPage('Bilan de la classe '+campaign.classe+' – T'+campaign.trimestre,p=>{el('p',done.length+'/'+invitations.length+' réponses',p);summary(p,done);if(note.value.trim()){el('h2','Idées collectives validées',p);el('p',note.value,p);}}));
const privateBox=card(output,'Réponses nominatives — confidentiel');el('p','Ne pas transmettre ni projeter cette partie aux élèves ou aux délégués.',privateBox);table(privateBox,['Élève','État','Difficultés signalées','Entretien'],invitations.map(i=>[i.prenom+' '+i.nom,i.submitted_at?'Répondu':'En attente',i.reponses?.matieres||i.reponses?.difficultes||'—',i.reponses?.entretien||'—']));done.forEach(i=>{const d=el('details',null,privateBox);el('summary',i.prenom+' '+i.nom,d);allTitles.forEach((t,k)=>{el('strong',t,d);el('p',i.reponses[k]||'—',d);});});btn(privateBox,'PDF PP — confidentiel',()=>printPage('CONFIDENTIEL – '+campaign.classe+' T'+campaign.trimestre,p=>{summary(p,done);done.forEach(i=>{el('h2',i.prenom+' '+i.nom,p);allTitles.forEach((t,k)=>{el('strong',t,p);el('p',i.reponses[k]||'—',p);});});}));
}catch(err){status.textContent='Consultation indisponible : '+err.message+'\nVérifie l’installation SQL et ta connexion sécurisée.';}finally{busy=false;period.disabled=y.disabled=false;}}
btn(nav,'Actualiser',refresh);period.addEventListener('change',refresh);y.addEventListener('change',refresh);await refresh();
}
function openConsultation(){
 const dashboard=document.getElementById('ppDashboard');
 const root=dashboard?.parentElement||document.getElementById('content');
 if(!root)return;
 let mount=document.getElementById('ppqAdmin');
 if(!mount){mount=el('section',null);mount.id='ppqAdmin';if(dashboard)dashboard.before(mount);else root.append(mount);}
 mount.replaceChildren();
 admin();
 mount.scrollIntoView({behavior:'smooth',block:'start'});
}
function install(){
 const dashboard=document.getElementById('ppDashboard');
 if(!dashboard)return;
 const council=dashboard.querySelector('button[onclick*="openPPCouncil"]');
 if(council&&!dashboard.querySelector('[data-ppq-launch]')){
  const button=btn(council.parentElement,'🗳 Consultation des élèves',openConsultation);
  button.setAttribute('data-ppq-launch','1');
  council.after(button);
 }
 if(!document.getElementById('ppqAdmin')){
  const mount=el('section',null);mount.id='ppqAdmin';dashboard.before(mount);
  const c=card(mount,'Préparation du conseil de classe');
  btn(c,'Consultation des élèves – questionnaire et résultats',openConsultation);
 }
}
if(document.getElementById('ppqStudent'))student();else{
 window.ppOpenConsultation=openConsultation;
 window.ppInstallConsultation=install;
 const watch=new MutationObserver(install);
 watch.observe(document.body,{childList:true,subtree:true});
 if(typeof window.openPP==='function'){
   const original=window.openPP;
   window.openPP=async function(...args){const result=await original.apply(this,args);install();return result;};
 }
 if(typeof window.renderPPDashboard==='function'){
   const originalRender=window.renderPPDashboard;
   window.renderPPDashboard=async function(...args){const result=await originalRender.apply(this,args);install();return result;};
 }
 install();
}
})();