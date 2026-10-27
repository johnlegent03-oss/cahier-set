/* Correctifs comportementaux — à charger après les scripts existants. */
(function () {
  'use strict';

  /*
    CONFIGURATION
    - activityLinkPattern : liens à corriger s'ils pointent vers l'éditeur.
    - studentActivityBase : URL élève à utiliser pour les activités.
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

  function isBlankPrintPage(page) {
    if (!page) return true;

    const clone = page.cloneNode(true);
    clone.querySelectorAll('script, style, link, meta').forEach(function (node) {
      node.remove();
    });

    const text = (clone.textContent || '').replace(/\s|\u00a0/g, '');
    const hasMedia = clone.querySelector('img:not([src=""]), canvas, svg, table');
    const hasVisibleElement = Array.from(clone.querySelectorAll('*')).some(function (node) {
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && node.offsetHeight > 0;
    });

    return text.length === 0 && !hasMedia && !hasVisibleElement;
  }

  function cleanEmptyPrintPages() {
    const pages = Array.from(document.querySelectorAll('.print-sheet .print-page'));

    pages.forEach(function (page) {
      if (isBlankPrintPage(page)) {
        page.remove();
      }
    });

    const remaining = document.querySelectorAll('.print-sheet .print-page');
    remaining.forEach(function (page, index) {
      const isLast = index === remaining.length - 1;
      page.style.pageBreakAfter = isLast ? 'auto' : 'always';
      page.style.breakAfter = isLast ? 'auto' : 'always';
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
      const button = event.target.closest('button, [role=button], a');
      if (!button) return;

      const label = (button.textContent || button.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('pdf') || label.includes('imprimer') || label.includes('télécharger')) {
        setTimeout(cleanEmptyPrintPages, 50);
        setTimeout(cleanEmptyPrintPages, 300);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();