/* Correctifs comportementaux — à charger après les scripts existants. */
(function () {
  'use strict';

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

  /* Styles du cahier — sélecteur ajouté aux barres d'outils riches. */
  const CAHIER_STYLES = [
    { value: 'style-chapitre', label: 'Titre de chapitre' },
    { value: 'style-problematique', label: 'Problématique' },
    { value: 'style-seance', label: 'Titre de séance' },
    { value: 'style-probleme', label: 'Problème de la séance' },
    { value: 'style-activite', label: 'Lien d’activité' },
    { value: 'style-bilan', label: 'Bilan' }
  ];

  const CAHIER_STYLE_CLASSES = CAHIER_STYLES.map(function (style) {
    return style.value;
  });

  function findCurrentBlock(editor) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return null;

    let node = selection.getRangeAt(0).commonAncestorContainer;
    const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'LI', 'BLOCKQUOTE'];

    while (node && node !== editor) {
      if (node.nodeType === Node.ELEMENT_NODE && blockTags.includes(node.tagName)) {
        return node;
      }
      node = node.parentNode;
    }

    return null;
  }

  function applyCahierStyle(editorId, className) {
    const editor = document.getElementById(editorId);
    if (!editor) return;

    if (typeof restoreSelection === 'function') {
      restoreSelection(editorId);
    }

    editor.focus();

    let block = findCurrentBlock(editor);

    if (!block) {
      document.execCommand('formatBlock', false, 'p');
      const paragraphs = editor.querySelectorAll('p');
      block = paragraphs[paragraphs.length - 1] || null;
    }

    if (!block) return;

    CAHIER_STYLE_CLASSES.forEach(function (existingClass) {
      block.classList.remove(existingClass);
    });

    if (className) {
      block.classList.add(className);
    }

    if (typeof rememberSelection === 'function') {
      rememberSelection(editorId);
    }

    if (typeof scheduleAutosave === 'function') {
      scheduleAutosave();
    }
  }

  window.applyCahierStyle = applyCahierStyle;

  function addCahierStyleMenu(toolbar) {
    if (!toolbar || toolbar.querySelector('.cahier-style-choice')) return;

    const editor = toolbar.nextElementSibling;
    if (!editor || !editor.classList.contains('rich-editor') || !editor.id) return;

    const select = document.createElement('select');
    select.className = 'cahier-style-choice';
    select.title = 'Style du cahier';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '🎨 Style';
    select.appendChild(defaultOption);

    CAHIER_STYLES.forEach(function (style) {
      const option = document.createElement('option');
      option.value = style.value;
      option.textContent = style.label;
      select.appendChild(option);
    });

    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'Aucun style';
    select.appendChild(noneOption);

    select.addEventListener('change', function () {
      applyCahierStyle(editor.id, select.value);
      select.selectedIndex = 0;
    });

    const fontSelect = toolbar.querySelector('.font-choice');
    if (fontSelect) {
      toolbar.insertBefore(select, fontSelect);
    } else {
      toolbar.appendChild(select);
    }
  }

  function initStyleMenus() {
    document.querySelectorAll('.rich-toolbar').forEach(addCahierStyleMenu);
  }

  function init() {
    fixActivityLinks(document);
    normalizeEditorImages();
    initStyleMenus();

    const observer = new MutationObserver(function () {
      fixActivityLinks(document);
      normalizeEditorImages();
      initStyleMenus();
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