/* Correctifs comportementaux — à charger après les scripts existants. */
(function () {
  'use strict';

  /*
    CONFIGURATION
    - activityLinkPattern : liens à corriger s'ils pointent vers l'éditeur.
    - studentActivityBase : URL élève à utiliser pour les activités.
    Exemple : si un lien généré est "prof.html#activite/123",
    il devient "atelier.html#activite/123".
  */
  const CONFIG = {
    activityLinkPattern: /(^|\/)prof\.html(#|\?).*activite/i,
    studentActivityBase: 'atelier.html'
  };

  function fixActivityLinks(root) {
    const links = (root || document).querySelectorAll('a[href]');

    links.forEach(function (link) {
      const href = link.getAttribute('href');
      if (!href || !CONFIG.activityLinkPattern.test(href)) return;

      try {
        const url = new URL(href, window.location.href);
        const hash = url.hash || url.search;
        const studentHref = CONFIG.studentActivityBase + hash;

        if (link.getAttribute('href') !== studentHref) {
          link.setAttribute('href', studentHref);
          link.setAttribute('data-corrected-activity-link', 'true');
        }
      } catch (error) {
        console.warn('[correctifs-prof] Lien d\'activité non corrigé :', href, error);
      }
    });
  }

  function cleanEmptyPrintPages() {
    document.querySelectorAll('.print-sheet .print-page').forEach(function (page) {
      const hasContent = page.textContent.trim().length > 0 || page.querySelector('img, table, canvas');
      if (!hasContent) page.remove();
    });

    const pages = document.querySelectorAll('.print-sheet .print-page');
    pages.forEach(function (page, index) {
      if (index === pages.length - 1) {
        page.style.pageBreakAfter = 'auto';
        page.style.breakAfter = 'auto';
      }
    });
  }

  function normalizeEditorImages() {
    document.querySelectorAll('.rich-editor img').forEach(function (image) {
      image.style.objectFit = 'initial';
      image.style.height = 'auto';
      image.style.maxWidth = '100%';
      image.style.minWidth = '0';
      image.style.minHeight = '0';
      image.style.resize = 'none';
      image.style.display = 'block';
      image.style.marginLeft = 'auto';
      image.style.marginRight = 'auto';
    });
  }

  function init() {
    fixActivityLinks(document);
    normalizeEditorImages();

    const observer = new MutationObserver(function () {
      fixActivityLinks(document);
      normalizeEditorImages();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'src', 'style']
    });

    window.addEventListener('beforeprint', cleanEmptyPrintPages);

    document.addEventListener('click', function (event) {
      const button = event.target.closest('button, [role=button]');
      if (!button) return;
      const label = (button.textContent || '').toLowerCase();
      if (label.includes('pdf') || label.includes('imprimer')) {
        setTimeout(cleanEmptyPrintPages, 50);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();