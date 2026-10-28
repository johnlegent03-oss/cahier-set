/* Consultation des fiches : aucune écriture automatique au chargement. */
(() => {
  'use strict';
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const css = '*{box-sizing:border-box}body{margin:0;padding:12px;background:#eee;color:#294536;font:13px Arial}.sheet{position:relative;width:794px;height:1123px;margin:0 auto 12px;background:#fff;overflow:hidden}.object{position:absolute;transform-origin:center}.content{width:100%;height:100%;overflow:hidden;overflow-wrap:anywhere;line-height:1.25;white-space:pre-wrap}.content img,.content svg{display:block;width:100%;height:100%;object-fit:contain}.content ul,.content ol{margin:4px 0;padding-left:22px}.content li{margin:2px 0}.skills-title{font:bold 16px Georgia;margin-bottom:10px}.skills-item{display:flex;gap:8px;margin:5px 0;line-height:1.4}.skills-item:before{content:"✓";color:#718e58}table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed;font:12px Arial}td,th{border:1px solid #a4b095;padding:7px;overflow-wrap:anywhere}th{background:#e3e9d8}';

  function clean(root) {
    root.querySelectorAll('script,style,link,meta,base,iframe,object,embed,form,input,button,textarea,select,foreignObject,.selectionBox,.marquee,.align-guide').forEach(el => el.remove());
    [root, ...root.querySelectorAll('*')].forEach(el => {
      el.removeAttribute('contenteditable');
      el.classList.remove('selected', 'active');
      [...el.attributes].forEach(attr => {
        if (/^on/i.test(attr.name) || /^(href|xlink:href|srcdoc|formaction|action|autofocus|tabindex)$/i.test(attr.name)) el.removeAttribute(attr.name);
      });
    });
    root.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      try {
        const url = new URL(src, document.baseURI);
        if (!/^https?:$/.test(url.protocol) && !/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(src)) throw Error('Image non autorisée');
        img.src = url.href;
        img.removeAttribute('srcset');
      } catch (_) { img.removeAttribute('src'); img.removeAttribute('srcset'); }
    });
    return root;
  }

  function snapshot() {
    const sheets = [...document.querySelectorAll('#stage .sheet')];
    if (!sheets.length || sheets.length !== project.pages.length) throw Error('Les pages affichées ne correspondent pas au projet. Recharge la fiche avant de réessayer.');
    const html = sheets.map(sheet => clean(sheet.cloneNode(true)).outerHTML).join('');
    if (html.length > 12000000) throw Error('Fiche trop volumineuse pour cette intégration. Réduis la taille des images.');
    return '<div data-svt-layout="1">' + html + '</div>';
  }

  function consultation(layout) {
    const clone = clean(layout.cloneNode(true));
    const count = clone.querySelectorAll('.sheet').length;
    if (!count || count > 30) throw Error('Nombre de pages non pris en charge.');
    const csp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; base-uri 'none'; form-action 'none'; object-src 'none'";
    const source = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + escape(csp) + '"><style>' + css + '</style></head><body>' + clone.innerHTML + '</body></html>';
    const iframe = document.createElement('iframe');
    iframe.title = 'Activité — consultation des pages, défilement horizontal et vertical disponible';
    iframe.setAttribute('sandbox', '');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.style.cssText = 'display:block;width:100%;height:1160px;max-width:100%;border:1px solid #ccd5c5;background:white;';
    iframe.srcdoc = source;
    return '<p>Fiche en consultation — ' + count + ' page(s). Faites défiler la fiche si nécessaire.</p>' + iframe.outerHTML;
  }

  function install() {
    if (typeof window.sanitizeRichHtml === 'function' && !window.sanitizeRichHtml.svtLayout) {
      const original = window.sanitizeRichHtml;
      const wrapped = function(value) {
        const html = String(value || '');
        if (!html.includes('data-svt-layout="1"')) return original.apply(this, arguments);
        try {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const layout = doc.querySelector('[data-svt-layout="1"]');
          return layout ? consultation(layout) : original.apply(this, arguments);
        } catch (error) {
          console.error('[Fiche SVT]', error);
          return '<p>La fiche ne peut pas être affichée. Contactez votre professeur.</p>';
        }
      };
      wrapped.svtLayout = true;
      window.sanitizeRichHtml = wrapped;
    }

    if (!document.getElementById('stage') || typeof window.addToSession !== 'function') return;

// L’ajout par lien reste géré par atelier.html.
return;

let busy = false;
    window.addToSession = async function() {
      if (busy) return;
      busy = true;
      try {
        requireUser();
        if (typeof finish === 'function') finish();
        metadata();
        const cx = context();
        if (!cx.classe || !cx.cahier_id || cx.chapitre_index === null || cx.seance_index === null) throw Error('Choisis une classe, un chapitre et une séance.');
        if (!confirm('Enregistrer la fiche avec sa mise en page dans « ' + cx.classe + ' / ' + cx.seance_titre + ' » ? L’entrée de ce document sera mise à jour si elle existe déjà.')) return;
        const html = snapshot();
        if (!await saveCloud(false)) return;
        const id = String(cloudId || '');
        if (!id) throw Error('Le document enregistré n’a pas d’identifiant.');
        const {data:row,error} = await sb.from('Cahier').select('id,contenu').eq('id',cx.cahier_id).single();
        if (error) throw error;
        const before = JSON.stringify(row.contenu);
        const contenu = JSON.parse(before);
        const seance = contenu?.chapitres?.[cx.chapitre_index]?.seances?.[cx.seance_index];
        if (!seance) throw Error('Séance introuvable.');
        if (seance.activites != null && !Array.isArray(seance.activites)) throw Error('Format des activités inattendu. Aucune modification.');
        const list = seance.activites || (seance.activites = []);
        const matches = [];
        list.forEach((entry,index) => {
          const text = String(entry.texte || '');
          let found = text.includes('atelier-doc=' + id + ' ');
          const doc = new DOMParser().parseFromString(text,'text/html');
          for (const link of doc.querySelectorAll('a[href]')) {
            try { if (new URL(link.getAttribute('href'),location.href).searchParams.get('doc') === id) found = true; } catch (_) {}
          }
          if (found) matches.push(index);
        });
        if (matches.length > 1) throw Error('Plusieurs entrées correspondent au document. Aucune modification du cahier.');
        localStorage.setItem('svt-layout-backup-' + row.id + '-' + Date.now(), before);
        const texte = '<!-- atelier-doc=' + id + ' --><h3>' + escape(project.title || 'Activité') + '</h3>' + html;
        if (matches.length) {
          const index = matches[0];
          list[index] = {...list[index], texte};
        } else {
          list.push({date:new Date().toISOString().slice(0,10),texte,pdf:''});
        }
        const {data:updated,error:updateError} = await sb.from('Cahier').update({contenu}).eq('id',row.id).eq('contenu',before).select('id');
        if (updateError) throw updateError;
        if (!updated || updated.length !== 1) throw Error('Mise à jour non confirmée : le cahier a changé ou l’accès est refusé. Recharge avant de réessayer.');
        status('Fiche enregistrée avec sa mise en page. Recharge le cahier élève pour vérifier.');
      } catch (error) {
        status(error.message || String(error), true);
      } finally { busy = false; }
    };
    console.info('[Fiche SVT] Ajout avec mise en page activé.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();
