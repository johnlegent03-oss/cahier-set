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

/* Professeur uniquement : mesurer le menu visible, pas seulement le conteneur externe. */
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
      max-width:none!important;box-sizing:border-box!important;
    }
    body.svt-prof-layout-fix #svt-site-hero .copy {min-width:0}
    body.svt-prof-layout-fix #svt-site-hero h2,
    body.svt-prof-layout-fix #svt-site-hero p {overflow-wrap:anywhere}
  }`;
  document.head.append(style);
  let frame=0;
  function menuRight(){
    if(innerWidth<=820)return 0;
    const candidates=new Set(document.querySelectorAll('aside,nav,[role="navigation"],[id*="sidebar" i],[class*="sidebar" i]'));
    document.querySelectorAll('h1,h2,h3,a,button,span,strong,div').forEach(el=>{
      if(!['Mon espace SVT','Tableau de bord'].includes(el.textContent.trim()))return;
      let parent=el;
      for(let i=0;parent&&parent!==document.body&&i<8;i++,parent=parent.parentElement)candidates.add(parent);
    });
    let right=0;
    candidates.forEach(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return;
      if(r.left<=20&&r.right>40&&r.width>=48&&r.width<innerWidth*.5&&r.height>=140&&r.bottom>0&&r.top<innerHeight)
        right=Math.max(right,r.right+scrollX);
    });
    return right;
  }
  function align(){
    frame=0;
    const content=document.getElementById('content');if(!content)return;
    const rect=content.getBoundingClientRect();
    const padding=parseFloat(getComputedStyle(content).paddingLeft)||0;
    const fallback=rect.left+scrollX+(innerWidth>820&&padding>=100?padding:0);
    const left=Math.max(0,fallback,menuRight());
    const value=(Math.round(left*100)/100)+'px';
    if(document.body.style.getPropertyValue('--svt-prof-content-left')!==value)
      document.body.style.setProperty('--svt-prof-content-left',value);
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(align)}
  function start(){
    document.body.classList.add('svt-prof-layout-fix');
    const content=document.getElementById('content');
    if(window.ResizeObserver&&content)new ResizeObserver(schedule).observe(content);
    new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class','style','hidden'],childList:true,subtree:true});
    window.addEventListener('resize',schedule);
    document.addEventListener('click',schedule);
    document.addEventListener('transitionend',schedule);
    if(document.fonts?.ready)document.fonts.ready.then(schedule);
    schedule();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
