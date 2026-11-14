/** Opening intro: where it may play, that it is wired before React, and that it stays light. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { INTRO_CONTROL, INTRO_DECIDE, INTRO_IMAGES, INTRO_SESSION_KEY, INTRO_SOUND, introAllowedPath } from "../src/lib/site-intro";

// Public pages and the two login pages play it; admin/staff screens and print views never do.
for (const path of ["/", "/koshas", "/shop/123", "/track", "/admin/login", "/staff/login", "/admin/login/"]) assert.ok(introAllowedPath(path), path);
for (const path of ["/admin", "/admin/dashboard", "/admin/invoice/5", "/staff", "/staff/photography"]) assert.equal(introAllowedPath(path), false, path);
assert.equal(introAllowedPath("/", "?print=1"), false);
assert.equal(introAllowedPath("/", "?pdf=1&x=2"), false);
assert.ok(introAllowedPath("/", "?printer=1"));

// The inline head script uses the same rules (it cannot import the helper) and runs once per visit.
const decide = new Function("location", "window", "sessionStorage", "document", INTRO_DECIDE);
const run = (pathname: string, search = "", seen: string | null = null) => {
  const attributes: Record<string, string> = {};
  const links: string[] = [];
  const self = {};
  decide({ pathname, search }, { top: self, self }, { getItem: () => seen }, {
    documentElement: { setAttribute: (name: string, value: string) => { attributes[name] = value; } },
    createElement: () => ({}),
    head: { appendChild: (link: { href: string }) => links.push(link.href) },
  });
  return { flag: attributes["data-ajn-intro"] ?? null, links };
};
for (const [path, search] of [["/", ""], ["/admin/login", ""], ["/admin/dashboard", ""], ["/", "?print=1"], ["/staff/tailors", ""]] as const)
  assert.equal(run(path, search).flag, introAllowedPath(path, search) ? "play" : null, `${path}${search}`);
assert.equal(run("/", "", "1").flag, null, "not twice in one visit");
assert.deepEqual(run("/").links, [...INTRO_IMAGES], "both layers preload while it plays");
assert.ok(INTRO_CONTROL.includes(`sessionStorage.setItem("${INTRO_SESSION_KEY}","1")`) && INTRO_CONTROL.includes('"Escape"') && INTRO_CONTROL.includes("ajn-intro-exit"));

// Wired in the server HTML (plays while the app loads), the old in-app splash is gone.
const layout = readFileSync("app/layout.tsx", "utf8");
assert.match(layout, /dangerouslySetInnerHTML=\{\{ __html: INTRO_DECIDE \}\}/);
assert.match(layout, /dangerouslySetInnerHTML=\{\{ __html: INTRO_CONTROL \}\}/);
assert.ok(layout.indexOf("INTRO_DECIDE }}") < layout.indexOf("</head>"), "decided in <head>, before first paint");
assert.match(layout, /suppressHydrationWarning/);
assert.match(layout, /className="ajn-intro__skip"/);
assert.ok(!existsSync("src/components/ajn-splash-screen.tsx") && !readFileSync("src/App.tsx", "utf8").includes("AjnSplashScreen"));

const css = readFileSync("src/index.css", "utf8");
assert.ok(!css.includes(".ajn-splash"), "old splash styles removed");
assert.match(css, /html\[data-ajn-intro\] \.ajn-intro \{ display: grid; \}/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.ajn-intro \*,/);
assert.ok(!/\.ajn-intro[^{]*\{[^}]*transition:\s*all/.test(css), "no transition: all");

// Sound: one autoplay attempt, otherwise a tap on «تشغيل الصوت» (which never skips the intro);
// never auto-played for reduced motion; skipping fades it out.
assert.ok(INTRO_CONTROL.includes(`new Audio("${INTRO_SOUND}")`) && INTRO_CONTROL.includes(".play()"));
assert.ok(INTRO_CONTROL.includes('matchMedia("(prefers-reduced-motion: reduce)").matches))play(false)'), "no autoplay for reduced motion");
assert.ok(INTRO_CONTROL.includes("e.stopPropagation()") && INTRO_CONTROL.includes("if(e.target===btn)return;"), "the sound button never skips");
assert.ok(INTRO_CONTROL.includes("fadeOut();setTimeout(finish,340)"), "skipping fades the sound out");
assert.match(layout, /id="ajn-intro-sound"[^>]*data-sound="blocked"/);
assert.match(css, /\.ajn-intro__sound\[data-sound="blocked"\] \{/);
assert.ok(statSync(`public${INTRO_SOUND}`).size < 120_000, "sound stays small");

// Light enough for a first visit on a phone.
for (const image of INTRO_IMAGES) assert.ok(statSync(`public${image}`).size < 160_000, image);

console.log("PASS site intro: public and login pages only, once per visit, decided before paint, skippable, reduced motion, sound with tap fallback, old splash removed, light assets");
