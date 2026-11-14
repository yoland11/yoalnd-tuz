/**
 * The opening intro (styles: «AJN opening intro» in src/index.css; markup: app/layout.tsx).
 *
 * Both scripts run inline in the server HTML, before React: the intro plays while the
 * app's JavaScript is still loading, and the page never flashes.
 * - INTRO_DECIDE (in <head>) sets <html data-ajn-intro="play"> once per visit, on public
 *   pages and the login pages only — never inside the admin or staff screens, on a
 *   print/PDF view or inside an embedded frame — and preloads the two logo layers.
 * - INTRO_CONTROL (after the markup) remembers the visit, lets a click, tap, Enter, Space
 *   or Escape skip it, and clears the flag when the closing animation ends.
 */
export const INTRO_IMAGES = ["/images/intro/ajn-emblem.webp", "/images/intro/ajn-wordmark-light.webp"] as const;

export const INTRO_SESSION_KEY = "ajn-intro-seen";

/** Paths where the intro may play; everything under /admin and /staff except their login pages is excluded. */
export function introAllowedPath(pathname: string, search = ""): boolean {
  if (/^\/(admin|staff)(\/|$)/.test(pathname) && !/^\/(admin|staff)\/login\/?$/.test(pathname)) return false;
  if (/[?&](print|pdf)=1(&|$)/.test(search)) return false;
  return true;
}

export const INTRO_DECIDE = String.raw`(function(){try{var p=location.pathname;if(/^\/(admin|staff)(\/|$)/.test(p)&&!/^\/(admin|staff)\/login\/?$/.test(p))return;if(/[?&](print|pdf)=1(&|$)/.test(location.search))return;if(window.top!==window.self)return;if(sessionStorage.getItem("${INTRO_SESSION_KEY}")==="1")return;document.documentElement.setAttribute("data-ajn-intro","play");${JSON.stringify(INTRO_IMAGES)}.forEach(function(h){var l=document.createElement("link");l.rel="preload";l.as="image";l.href=h;document.head.appendChild(l);});}catch(e){}})();`;

/** Original score timed to the animation (composed for the intro; 4.9 s, about 70 KB). */
export const INTRO_SOUND = "/sounds/ajn-intro.mp3";

/*
 * Sound: browsers refuse to start audio before the visitor has touched the page, so the
 * intro tries once and otherwise offers «تشغيل الصوت». A tap starts the score at the point
 * the animation has reached (it never skips the intro). The score's own tail fades out after
 * the intro; skipping fades it out at once. Reduced-motion visitors are never auto-played.
 */
export const INTRO_CONTROL = String.raw`(function(){
var root=document.documentElement;if(!root.hasAttribute("data-ajn-intro"))return;
try{sessionStorage.setItem("${INTRO_SESSION_KEY}","1");}catch(e){}
var el=document.getElementById("ajn-intro");if(!el){root.removeAttribute("data-ajn-intro");return;}
var btn=document.getElementById("ajn-intro-sound");var t0=performance.now();var done=false;var audio=null;
try{audio=new Audio("${INTRO_SOUND}");audio.preload="auto";}catch(e){audio=null;}
function setSound(s){if(!btn)return;btn.setAttribute("data-sound",s);btn.setAttribute("aria-pressed",s==="on"?"true":"false");btn.setAttribute("aria-label",s==="on"?"كتم صوت الافتتاحية":"تشغيل صوت الافتتاحية");}
function elapsed(){return Math.max(0,(performance.now()-t0)/1000);}
function play(fromNow){if(!audio)return;if(fromNow){try{audio.currentTime=elapsed();}catch(e){}}audio.muted=false;var p=audio.play();if(p&&p.then)p.then(function(){setSound("on");},function(){setSound("blocked");});}
if(audio){audio.addEventListener("playing",function(){var at=elapsed();if(at<4.8&&Math.abs(audio.currentTime-at)>0.15){try{audio.currentTime=at;}catch(e){}}},{once:true});
if(!(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches))play(false);}
if(btn){if(!audio)btn.hidden=true;btn.addEventListener("click",function(e){e.stopPropagation();if(!audio)return;if(btn.getAttribute("data-sound")==="on"){audio.muted=true;setSound("muted");}else if(audio.paused){play(true);}else{audio.muted=false;setSound("on");}});}
function fadeOut(){if(!audio||audio.paused)return;var v=audio.volume,i=0;var iv=setInterval(function(){i++;try{audio.volume=Math.max(0,v*(1-i/8));}catch(e){}if(i>=8){clearInterval(iv);audio.pause();}},35);}
function finish(){if(done)return;done=true;root.removeAttribute("data-ajn-intro");document.removeEventListener("keydown",onKey);}
function skip(){if(done||root.getAttribute("data-ajn-intro")==="skip")return;root.setAttribute("data-ajn-intro","skip");fadeOut();setTimeout(finish,340);}
function onKey(e){if(e.target===btn)return;if(e.key==="Escape"||e.key==="Enter"||e.key===" ")skip();}
el.addEventListener("click",skip);document.addEventListener("keydown",onKey);
el.addEventListener("animationend",function(e){if(e.target===el&&(e.animationName==="ajn-intro-exit"||e.animationName==="ajn-intro-fade-out"))finish();});
setTimeout(finish,4600);
})();`;
