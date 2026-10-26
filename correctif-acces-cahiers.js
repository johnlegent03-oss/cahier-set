(() => {
  function rename(){
    const buttons=document.querySelectorAll('#svtDashboard .svt-actions button');
    ['Mes cahiers','Reprendre ma dernière séance'].forEach((text,i)=>{
      const b=buttons[i];if(!b||b.dataset.svtShortcut===text)return;
      const icon=b.querySelector('svg')?.cloneNode(true);b.replaceChildren();if(icon)b.append(icon);
      const span=document.createElement('span');span.textContent=text;b.append(span);b.dataset.svtShortcut=text;
    });
  }
  function chooser(){
    if(!requireTeacher())return;
    document.getElementById('svtCahierChooser')?.remove();
    const oldFocus=document.activeElement;
    const overlay=document.createElement('div');overlay.id='svtCahierChooser';overlay.style.cssText='position:fixed;inset:0;z-index:90000;background:#173b2ab8;display:grid;place-items:center;padding:20px';
    const panel=document.createElement('section');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','svtChooserTitle');panel.style.cssText='width:min(620px,100%);max-height:85vh;overflow:auto;background:#fffdf4;border-radius:18px;padding:26px;box-shadow:0 20px 80px #0003;color:#344e39;font-size:16px';
    const close=()=>{overlay.remove();oldFocus?.focus()};
    const heading=document.createElement('h2');heading.id='svtChooserTitle';heading.textContent='Mes cahiers';heading.style.cssText='font:700 26px Georgia;margin:0 0 12px';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Fermer';cancel.onclick=close;
    panel.append(heading,cancel);
    const note=document.createElement('p');note.textContent='Choisis une classe pour retrouver ses chapitres et ses séances.';panel.append(note);
    Object.entries(CLASSES).forEach(([level,classes])=>{
      const title=document.createElement('h3');title.textContent=level==='TEST'?'Classe de test':level;panel.append(title);
      const row=document.createElement('div');row.style.cssText='display:flex;flex-wrap:wrap;gap:10px';
      classes.forEach(c=>{const b=document.createElement('button');b.type='button';b.textContent=c;b.style.cssText='font-size:17px;padding:12px 18px';b.onclick=async()=>{
        b.disabled=true;try{if(await flushPendingAutosave()===false)return;niveau=level;await openClasse(c);overlay.remove()}catch(e){alert('Ouverture impossible : '+e.message)}finally{b.disabled=false}
      };row.append(b)});panel.append(row);
    });
    overlay.append(panel);document.body.append(overlay);overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
    overlay.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();close()}
      if(e.key==='Tab'){const a=[...panel.querySelectorAll('button:not(:disabled)')];if(e.shiftKey&&document.activeElement===a[0]){e.preventDefault();a[a.length-1].focus()}else if(!e.shiftKey&&document.activeElement===a[a.length-1]){e.preventDefault();a[0].focus()}}
    });cancel.focus();
  }
  async function resume(button){
    if(!requireTeacher())return;
    if(typeof svtRecentRead!=='function'||typeof svtOpenRecent!=='function'||typeof svtResolveRecent!=='function'){
      alert('Ce raccourci nécessite la version de prof.html contenant l’historique des séances.');return;
    }
    const recent=svtRecentRead().filter(x=>x.c!=='TEST').sort((a,b)=>b.at-a.at);
    if(!recent.length){alert('Aucune séance consultée pour le moment. Ouvre un cahier puis clique dans une séance pour la mémoriser.');return}
    button.disabled=true;button.setAttribute('aria-busy','true');
    try{
      const cache=new Map();
      for(const item of recent){
        if(!Object.values(CLASSES).some(a=>a.includes(item.c)))continue;
        if(!cache.has(item.c))cache.set(item.c,await loadClass(item.c));
        if(svtResolveRecent(item,cache.get(item.c))){await svtOpenRecent(item);return}
      }
      alert('Aucune séance récente ne peut être retrouvée : elle a peut-être été renommée, supprimée ou archivée. Choisis une séance depuis Mes cahiers.');
    }catch(e){alert('Impossible de reprendre la séance : '+e.message)}
    finally{button.disabled=false;button.removeAttribute('aria-busy')}
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest?.('#svtDashboard .svt-actions button');if(!b)return;
    const index=[...b.parentElement.querySelectorAll('button')].indexOf(b);if(index!==0&&index!==1)return;
    e.preventDefault();e.stopImmediatePropagation();if(index===0)chooser();else resume(b);
  },true);
  const root=document.getElementById('content');if(root)new MutationObserver(rename).observe(root,{childList:true,subtree:true});rename();
})();
