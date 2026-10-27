/* Identite commune SVT : interface uniquement. */
(() => {
'use strict';
if (window.__svtIdentity2026) return;
window.__svtIdentity2026 = true;
const root = new URL('.', document.currentScript.src);
const asset = name => new URL(name, root).href;
const slogan = 'La curiosité pour boussole, la nature pour inspiration, la connaissance pour horizon.';
const workshop = !!document.getElementById('stage');
const evaluation = /evaluations\.html$/i.test(location.pathname);
const title = workshop ? 'Atelier pédagogique' : evaluation ? 'Évaluations et suivi' : 'Espace professeur';
const css = document.createElement('style');
css.textContent = `
@media screen {
body.svt-identity {background:#f5f2e5!important;color:#344e39;isolation:isolate;background-image:repeating-linear-gradient(0deg,#96825308 0 1px,transparent 1px 4px)!important}
body.svt-identity::before,body.svt-identity::after {display:none!important}
.svt-site-leaf {position:fixed;z-index:-1;pointer-events:none;width:clamp(160px,21vw,340px);height:85vh;background-repeat:no-repeat;background-size:contain;opacity:.5}
.svt-site-leaf.left {left:0;top:95px;background-position:left center}.svt-site-leaf.right {right:0;bottom:0;background-position:right bottom}
body.svt-identity>header {position:relative!important;z-index:2!important;background:#fffdf3f2!important;border-bottom:1px solid #d8dfc7!important;box-shadow:none!important;color:#344e39!important}
body.svt-identity header .brand h1,body.svt-identity>header>strong {font:700 25px/1.2 Georgia,serif!important;color:#34513a!important}
body.svt-identity header .logo {background:transparent!important;border:0!important;box-shadow:none!important;border-radius:0!important}
body.svt-identity header .logo img {border-radius:0!important;object-fit:contain!important;background:transparent!important}
.svt-site-logo {width:58px!important;height:58px!important;object-fit:contain;flex:0 0 58px;background:transparent!important}
#svt-site-hero {position:relative;isolation:isolate;overflow:hidden;min-height:300px;display:flex;align-items:center;padding:34px clamp(20px,4vw,76px) 46px;background:#f8f5e7;z-index:1}
#svt-site-hero::before {content:'';position:absolute;inset:0;z-index:-2;background:var(--svt-banner) center/cover no-repeat}
#svt-site-hero::after {content:'';position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,#f8f5e7e8,#f8f5e799 38%,transparent 72%),linear-gradient(0deg,#f5f2e5,transparent 12%)}
#svt-site-hero .copy {width:53%;max-width:740px}#svt-site-hero .kicker {font:700 10px/1.5 Arial,sans-serif;letter-spacing:1.8px;color:#70805a;text-transform:uppercase}
#svt-site-hero h2 {font:700 clamp(30px,3.2vw,48px)/1.12 Georgia,serif!important;color:#304e36!important;margin:12px 0 16px!important;letter-spacing:-.6px;text-transform:none!important}
#svt-site-hero p {font:italic clamp(15px,1.4vw,19px)/1.65 Georgia,serif!important;color:#536b48!important;max-width:630px;margin:0!important}
#svt-site-hero.workshop {min-height:230px;padding-top:24px;padding-bottom:32px}#svt-site-hero.workshop h2 {font-size:clamp(30px,3vw,40px)!important}
#svt-site-nav {position:relative;z-index:1;display:flex;gap:8px;flex-wrap:wrap;padding:13px clamp(20px,4vw,76px);background:#fffdf3dd;border-block:1px solid #dce3ca}
#svt-site-nav a {display:inline-flex;align-items:center;min-height:38px;padding:8px 13px;color:#526d48!important;border:1px solid #d5dfc4!important;background:#fffdf3!important;border-radius:5px;font:600 12px/1.4 Arial,sans-serif!important;text-decoration:none!important}
#svt-site-nav a[aria-current=page] {background:#426849!important;color:#fffdf1!important;border-color:#426849!important}#svt-site-nav a:hover {background:#eaf0dd!important}#svt-site-nav a:focus-visible {outline:3px solid #718e57;outline-offset:3px}
.svt-identity .layout {position:relative;z-index:1;background:transparent!important}.svt-identity .layout>aside {background:#fffdf3ed!important;border-color:#dce2cb!important}.svt-identity .layout>main {background:transparent!important}
.svt-identity .layout>aside h2 {font-family:Georgia,serif!important;color:#506d43!important;text-transform:none!important;letter-spacing:0!important;font-size:16px!important}
.svt-identity details.cloud {position:relative;z-index:1;background:#fffdf3e8!important;border-color:#dce2cb!important}.svt-identity #localStatus {color:#6d7e61!important}
#svt-site-footer {position:relative;z-index:1;border-top:1px solid #d9e1c7;margin:0;padding:23px 20px 30px;color:#6d7e61;text-align:center;font:italic 13px/1.7 Georgia,serif;background:linear-gradient(0deg,#d8e2c166,transparent)}
@media(max-width:700px) {.svt-site-leaf{opacity:.2;width:160px}#svt-site-hero{min-height:270px;padding:26px 20px 38px}#svt-site-hero .copy{width:85%}#svt-site-hero h2{font-size:30px!important}#svt-site-hero::after{background:linear-gradient(90deg,#f8f5e7ed,#f8f5e7b8 57%,#f8f5e733),linear-gradient(0deg,#f5f2e5,transparent 15%)}#svt-site-nav{padding:12px 16px}}
}
@media print {#svt-site-hero,#svt-site-nav,#svt-site-footer,.svt-site-leaf{display:none!important}}
`;
document.head.append(css);
function repairModel() {
if (typeof project === 'undefined' || !Array.isArray(project.pages)) return;
const old = ['❧ La curiosité pour boussole, la nature pour inspiration.', 'La curiosité pour boussole, la nature pour inspiration.'];
project.pages.forEach(p => (p.objects || []).forEach(o => {if (o.type === 'text' && old.includes(o.text?.trim())) {o.text = slogan; o.size = 10; o.w = 610; o.h = Math.max(o.h || 20, 24);}}));
}
function start() {
const header = document.querySelector('body>header');if (!header) return;
document.body.classList.add('svt-identity');document.title = title + ' — SVT';
[['left', 'monstera-gauche.png'], ['right', 'monstera-droite.png']].forEach(([side, file]) => {const leaf = document.createElement('div');leaf.className = 'svt-site-leaf ' + side;leaf.setAttribute('aria-hidden', 'true');leaf.style.backgroundImage = 'url("' + asset(file) + '")';document.body.prepend(leaf);});
if (workshop) {
const brand = header.querySelector(':scope>strong');if (brand) brand.textContent = title;
const img = new Image();img.src = asset('logo-svt.PNG');img.alt = 'Logo SVT';img.className = 'svt-site-logo';header.prepend(img);
document.querySelectorAll('button').forEach(b => {if (b.textContent.trim() === 'Modèle Herbier') b.textContent = 'Modèle de fiche';});
if (typeof window.element === 'function') {const original = window.element;window.element = function(o) {const el = original.apply(this, arguments);if(o?.type === 'logo'){const im=el.querySelector('img');if(im)im.src=asset('logo-svt.PNG');}return el;};}
if (typeof window.render === 'function') {const original = window.render;window.render = function(){repairModel();return original.apply(this, arguments);};if (typeof project !== 'undefined') window.render();}
} else {header.querySelectorAll('.brand .logo img').forEach(im => {im.src=asset('logo-svt.PNG');im.alt='Logo SVT';});}
const hero = document.createElement('section');hero.id = 'svt-site-hero';if(workshop)hero.className='workshop';hero.setAttribute('aria-label', title);hero.style.setProperty('--svt-banner','url("'+asset('bandeau-accueil.jpg')+'")');
const copy=document.createElement('div');copy.className='copy';const kicker=document.createElement('div');kicker.className='kicker';kicker.textContent='Sciences de la vie et de la Terre';const heading=document.createElement('h2');heading.textContent=title;const motto=document.createElement('p');motto.textContent=slogan;copy.append(kicker,heading,motto);hero.append(copy);header.after(hero);
const nav=document.createElement('nav');nav.id='svt-site-nav';nav.setAttribute('aria-label','Espaces du site');
[['Espace professeur','prof.html',!workshop&&!evaluation],['Évaluations et suivi','evaluations.html',evaluation],['Atelier pédagogique','atelier.html',workshop]].forEach(([label,file,active])=>{const a=document.createElement('a');a.href=asset(file);a.textContent=label;if(active)a.setAttribute('aria-current','page');a.addEventListener('click',e=>{if(!workshop||active)return;if(typeof finish==='function')finish();if(typeof persist==='function')persist();if(!confirm('Quitter l’atelier ? Si nécessaire, annule et exporte une copie JSON avant de partir.'))e.preventDefault();});nav.append(a);});hero.after(nav);
const footer=document.createElement('footer');footer.id='svt-site-footer';footer.textContent=slogan;document.body.append(footer);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
