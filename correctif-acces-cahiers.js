(() => {
  function closeChooser(){document.getElementById('svtCahierChooser')?.remove()}
  function openChooser(mode){
    if(!requireTeacher())return;
    closeChooser();
    const overlay=document.createElement('div');
    overlay.id='svtCahierChooser';
    overlay.style.cssText='position:fixed;inset:0;z-index:90000;background:#173b2ab8;display:grid;place-items:center;padding:20px;overflow:auto';
    const panel=document.createElement('section');
    panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','svtChooserTitle');
    panel.style.cssText='width:min(620px,100%);max-height:85vh;overflow:auto;background:#fffdf4;border-radius:18px;padding:26px;box-shadow:0 20px 80px #0003;font-size:16px;color:#344e39';
    const top=document.createElement('div');top.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:16px';
    const title=document.createElement('h2');title.id='svtChooserTitle';title.textContent=mode==='chapters'?'Gérer les chapitres d’une classe':'Ouvrir le cahier d’une classe';title.style.cssText='font:700 25px Georgia;margin:0';
    const close=document.createElement('button');close.type='button';close.textContent='Fermer';close.onclick=closeChooser;
    top.append(title,close);panel.append(top);
    const note=document.createElement('p');note.textContent='Choisis directement une classe pour accéder à ses chapitres et à ses séances.';panel.append(note);
    Object.entries(CLASSES).forEach(([level,classes])=>{
      const heading=document.createElement('h3');heading.textContent=level==='TEST'?'Classe de test':level;heading.style.cssText='font:700 20px Georgia;margin:22px 0 10px';panel.append(heading);
      const row=document.createElement('div');row.style.cssText='display:flex;flex-wrap:wrap;gap:10px';
      classes.forEach(c=>{const button=document.createElement('button');button.type='button';button.textContent=c;button.style.cssText='font-size:17px;padding:12px 18px;min-height:46px';button.onclick=async()=>{
        button.disabled=true;
        try{if(await flushPendingAutosave()===false)return;niveau=level;await openClasse(c);closeChooser()}
        catch(e){alert('Ouverture impossible : '+e.message)}finally{button.disabled=false}
      };row.append(button)});panel.append(row)
    });
    overlay.append(panel);document.body.append(overlay);
    const previousFocus=document.activeElement;
    overlay.addEventListener('click',e=>{if(e.target===overlay)closeChooser()});
    overlay.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();closeChooser();previousFocus?.focus()}
      if(e.key==='Tab'){const buttons=[...panel.querySelectorAll('button:not(:disabled)')];const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
    });close.focus();
  }
  document.addEventListener('click',e=>{
    const button=e.target.closest?.('#svtDashboard .svt-actions button');if(!button)return;
    const index=[...button.parentElement.querySelectorAll('button')].indexOf(button);
    if(index!==0&&index!==1)return;
    e.preventDefault();e.stopImmediatePropagation();openChooser(index===0?'chapters':'cahier');
  },true);
})();
