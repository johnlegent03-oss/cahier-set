(() => {
  const slogan = "La curiosité pour boussole, la nature pour inspiration, la connaissance pour horizon.";
  const style = document.createElement('style');
  style.textContent = `@media screen {
    #svtDashboard .svt-welcome .svt-note {
      display:block;max-width:680px;font:italic 17px/1.65 Georgia,serif!important;
      color:#536b48!important;margin-top:14px;position:relative;z-index:2;
    }
    @media(min-width:801px){#svtDashboard .svt-welcome .svt-note{max-width:62%}}
    @media(max-width:650px){#svtDashboard .svt-welcome .svt-note{font-size:16px!important;max-width:100%}}
  }`;
  document.head.append(style);
  function apply(){
    const el=document.querySelector('#svtDashboard .svt-welcome .svt-note');
    if(el && el.textContent!==slogan) el.textContent=slogan;
  }
  const root=document.getElementById('content');
  if(root)new MutationObserver(apply).observe(root,{childList:true,subtree:true});
  apply();
})();

/* Aligner uniquement le bandeau commun de prof.html sur son contenu existant. */
(() => {
  if (!/\/prof\.html$/i.test(location.pathname)) return;
  const style = document.createElement('style');
  style.id = 'svt-prof-sidebar-alignment';
  style.textContent = `@media screen {
    body.svt-prof-layout-fix #svt-site-hero,
    body.svt-prof-layout-fix #svt-site-nav,
    body.svt-prof-layout-fix #svt-site-footer {
      margin-left:var(--svt-prof-content-left,0px)!important;
      margin-right:0!important;
      width:calc(100% - var(--svt-prof-content-left,0px))!important;
      max-width:none!important;
      box-sizing:border-box!important;
    }
    body.svt-prof-layout-fix #svt-site-hero .copy {min-width:0}
    body.svt-prof-layout-fix #svt-site-hero h2,
    body.svt-prof-layout-fix #svt-site-hero p {overflow-wrap:anywhere}
  }`;
  document.head.append(style);
  let frame = 0;
  function align(){
    frame = 0;
    const content = document.getElementById('content');
    if (!content) return;
    const left = Math.max(0, content.getBoundingClientRect().left + window.scrollX);
    const value = (Math.round(left * 100) / 100) + 'px';
    if (document.body.style.getPropertyValue('--svt-prof-content-left') !== value)
      document.body.style.setProperty('--svt-prof-content-left', value);
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(align)}
  function start(){
    document.body.classList.add('svt-prof-layout-fix');
    const content = document.getElementById('content');
    if(window.ResizeObserver && content)new ResizeObserver(schedule).observe(content);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body,{attributes:true,childList:true});
    if(content)observer.observe(content,{attributes:true});
    window.addEventListener('resize',schedule);
    document.addEventListener('click',schedule);
    if(document.fonts?.ready)document.fonts.ready.then(schedule);
    schedule();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
