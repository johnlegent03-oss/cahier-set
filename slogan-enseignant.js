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
