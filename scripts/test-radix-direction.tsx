/**
 * Radix controls follow the page direction. Select, DropdownMenu, Tabs, RadioGroup,
 * ToggleGroup, Slider, ScrollArea, Accordion, Menubar, ContextMenu and NavigationMenu
 * fall back to ltr unless a DirectionProvider is above them. The document root gives
 * them rtl, pages that switch language (Kurdish rtl, Turkish ltr) nest their own,
 * and nothing renders them outside that reach. Static scan plus server renders;
 * touches no database.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { NavigationMenu, NavigationMenuItem, NavigationMenuList } from "../src/components/ui/navigation-menu";
import { RadioGroup, RadioGroupItem } from "../src/components/ui/radio-group";
import { ScrollArea } from "../src/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../src/components/ui/select";
import { Slider } from "../src/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "../src/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../src/components/ui/toggle-group";

Object.assign(globalThis, { React });
// tsx loads the wrappers (and so Radix) as CommonJS here; an ESM import would get the
// package's other build and a second, unconnected context. The app bundles one copy.
const { DirectionProvider } = createRequire(import.meta.url)("@radix-ui/react-direction") as typeof import("@radix-ui/react-direction");

// 1. The provider is what decides: without it every control is ltr, with it each
// control takes the provider's direction, and an explicit dir prop still wins.
// (Accordion, Menubar and the menus read the same context for arrow keys and their
// portaled content, which a server render does not stamp.)
const controls = (
  <>
    <Select value="a"><SelectTrigger aria-label="اختيار"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a">أ</SelectItem></SelectContent></Select>
    <Tabs defaultValue="a"><TabsList><TabsTrigger value="a">أ</TabsTrigger></TabsList></Tabs>
    <RadioGroup defaultValue="a"><RadioGroupItem value="a" aria-label="أ" /></RadioGroup>
    <ToggleGroup type="single"><ToggleGroupItem value="a">أ</ToggleGroupItem></ToggleGroup>
    <Slider defaultValue={[1]} max={2} />
    <ScrollArea><p>نص</p></ScrollArea>
    <NavigationMenu><NavigationMenuList><NavigationMenuItem>أ</NavigationMenuItem></NavigationMenuList></NavigationMenu>
  </>
);
const directions = (html: string) => [...html.matchAll(/\sdir="(rtl|ltr)"/g)].map((match) => match[1]);
const stamped = directions(renderToStaticMarkup(controls));
assert.ok(stamped.length >= 8, `every control stamps a direction, found ${stamped.length}`);
assert.deepEqual([...new Set(stamped)], ["ltr"], "without a provider Radix falls back to ltr — the reason the provider exists");
assert.deepEqual([...new Set(directions(renderToStaticMarkup(<DirectionProvider dir="rtl">{controls}</DirectionProvider>)))], ["rtl"], "Arabic and Kurdish pages");
assert.deepEqual([...new Set(directions(renderToStaticMarkup(<DirectionProvider dir="ltr">{controls}</DirectionProvider>)))], ["ltr"], "Turkish pages stay ltr");
assert.deepEqual(
  directions(renderToStaticMarkup(<DirectionProvider dir="rtl"><Tabs dir="ltr" defaultValue="a"><TabsList><TabsTrigger value="a">a</TabsTrigger></TabsList></Tabs></DirectionProvider>)),
  ["ltr"],
  "an explicit dir prop keeps priority over the provider",
);

// 2. One copy of the direction context, so the provider reaches every Radix package.
const lock = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
const directionVersions = [...new Set([...lock.matchAll(/^  '@radix-ui\/react-direction@(\d+\.\d+\.\d+)/gm)].map((match) => match[1]))];
assert.equal(directionVersions.length, 1, `two copies of @radix-ui/react-direction split the provider's context: ${directionVersions.join(", ")}`);
assert.match(lock, new RegExp(`'@radix-ui/react-direction':\\n\\s+specifier: [^\\n]+\\n\\s+version: ${directionVersions[0].replace(/\./g, "\\.")}\\(`), "the app imports the same copy the Radix packages use");

// Source files, parsed once.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const files: string[] = [];
const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.tsx?$/.test(name)) files.push(path); } };
walk(join(repoRoot, "src"));
walk(join(repoRoot, "app"));
const rel = (file: string) => relative(repoRoot, file).split(sep).join("/");
const sources = files.map((file) => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
const at = (source: ts.SourceFile, node: ts.Node) => `${rel(source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
const each = (source: ts.SourceFile, visit: (node: ts.Node) => void) => { const step = (node: ts.Node) => { visit(node); ts.forEachChild(node, step); }; step(source); };
const opening = (node: ts.Node) => ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
const attribute = (element: ts.JsxOpeningLikeElement, name: string) => element.attributes.properties.find((property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === name);
const valueText = (attr: ts.JsxAttribute | undefined) => {
  const initializer = attr?.initializer;
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer)) return JSON.stringify(initializer.text);
  return ts.isJsxExpression(initializer) && initializer.expression ? initializer.expression.getText() : undefined;
};
const tag = (element: ts.JsxOpeningLikeElement) => element.tagName.getText();

// 3. The document root: every <html> rendered by the app gives Radix the same direction.
let documentRoots = 0;
for (const source of sources) {
  each(source, (node) => {
    const element = opening(node);
    if (!element || tag(element) !== "html") return;
    documentRoots += 1;
    const htmlDir = valueText(attribute(element, "dir"));
    assert.ok(htmlDir, `${at(source, node)}: the document declares its direction`);
    const providers: string[] = [];
    each(node, (inner) => { const innerElement = opening(inner); if (innerElement && tag(innerElement) === "DirectionProvider") providers.push(valueText(attribute(innerElement, "dir")) ?? ""); });
    assert.deepEqual(providers, [htmlDir], `${at(source, node)}: one DirectionProvider inside <html>, with the document's dir ${htmlDir}`);
  });
}
assert.equal(documentRoots, 1, "app/layout.tsx is the one document root");

// 4. Pages that choose their language at runtime give Radix that language's direction.
const languageRoots: string[] = [];
const missingLanguageProviders: string[] = [];
for (const source of sources) {
  each(source, (node) => {
    const element = opening(node);
    if (!element || tag(element) === "html") return;
    const dir = valueText(attribute(element, "dir"));
    if (!dir || !attribute(element, "lang")) return;
    languageRoots.push(at(source, node));
    const parent = node.parent;
    const provider = ts.isJsxElement(parent) && tag(parent.openingElement) === "DirectionProvider" ? valueText(attribute(parent.openingElement, "dir")) : undefined;
    if (provider !== dir) missingLanguageProviders.push(`${at(source, node)} (dir=${dir}, provider=${provider ?? "none"})`);
  });
}
assert.deepEqual(missingLanguageProviders, [], "an element that sets lang and dir must sit directly inside <DirectionProvider dir={same}>");
assert.ok(languageRoots.length >= 3, `expected the public layout, wedding and bride pages, found ${languageRoots.join(", ")}`);

// 5. Nothing renders React outside the tree the providers wrap.
const SEPARATE_ROOTS = new Set(["createRoot", "hydrateRoot", "render", "renderToString", "renderToStaticMarkup", "renderToPipeableStream", "renderToReadableStream"]);
const unwrappedRoots: string[] = [];
for (const source of sources) {
  const calls: ts.Node[] = [];
  each(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.getText() : node.expression.getText();
    const receiver = ts.isPropertyAccessExpression(node.expression) ? node.expression.expression.getText() : "";
    if (SEPARATE_ROOTS.has(callee) && (callee !== "render" || /ReactDOM|root/i.test(receiver))) calls.push(node);
  });
  if (calls.length && !source.text.includes("DirectionProvider")) unwrappedRoots.push(...calls.map((call) => at(source, call)));
}
assert.deepEqual(unwrappedRoots, [], "a separate React root needs its own DirectionProvider");

// 6. Direction-sensitive primitives come only through the shared wrappers, so the scans
// above see all of them, and no wrapped control sits in a region whose direction may
// differ from its provider unless it states its own dir.
const SENSITIVE = ["accordion", "context-menu", "dropdown-menu", "menubar", "navigation-menu", "radio-group", "scroll-area", "select", "slider", "tabs", "toggle-group"];
const ROOTS: Record<string, string> = { accordion: "Accordion", "context-menu": "ContextMenu", "dropdown-menu": "DropdownMenu", menubar: "Menubar", "navigation-menu": "NavigationMenu", "radio-group": "RadioGroup", "scroll-area": "ScrollArea", select: "Select", slider: "Slider", tabs: "Tabs", "toggle-group": "ToggleGroup" };
const directImports: string[] = [];
const mismatched: string[] = [];
let followProvider = 0;
let explicitDir = 0;
for (const source of sources) {
  const inWrappers = rel(source.fileName).startsWith("src/components/ui/");
  const local = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    const radix = module.match(/^@radix-ui\/react-(.+)$/)?.[1];
    if (radix && (SENSITIVE.includes(radix) || radix === "menu" || radix === "roving-focus") && !inWrappers) directImports.push(`${at(source, statement)} ${module}`);
    const wrapper = module.match(/^@\/components\/ui\/(.+)$/)?.[1];
    const bindings = statement.importClause?.namedBindings;
    if (wrapper && ROOTS[wrapper] && bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) if ((specifier.propertyName ?? specifier.name).text === ROOTS[wrapper]) local.set(specifier.name.text, ROOTS[wrapper]);
    }
  }
  if (!local.size) continue;
  each(source, (node) => {
    const element = opening(node);
    if (!element || !local.has(tag(element))) return;
    if (attribute(element, "dir")) { explicitDir += 1; return; }
    followProvider += 1;
    for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
      const ancestor = opening(parent);
      if (!ancestor) continue;
      if (tag(ancestor) === "DirectionProvider") break;
      const regionDir = valueText(attribute(ancestor, "dir"));
      if (regionDir === undefined) continue;
      if (regionDir !== '"rtl"') mismatched.push(`${at(source, node)} <${tag(element)}> inside dir=${regionDir} at ${at(source, parent)}`);
      break;
    }
  });
}
assert.deepEqual(directImports, [], "import direction-sensitive Radix primitives through src/components/ui");
assert.deepEqual(mismatched, [], "inside a region whose direction may not be rtl, give the control its own dir or wrap the region in a DirectionProvider");
assert.ok(followProvider > 40, `expected the existing controls to be found, got ${followProvider}`);

// 7. The wrappers mirror: logical sides, so the check mark, padding and submenu arrow
// flip with the direction instead of sitting on a fixed physical side. (Single corners
// stay physical: the navigation indicator is a square turned 45° to point up.)
const PHYSICAL = /^-?(?:pl|pr|ml|mr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(?:-|$)/;
for (const wrapper of SENSITIVE) {
  const text = readFileSync(new URL(`../src/components/ui/${wrapper}.tsx`, import.meta.url), "utf8");
  const physical = [...text.matchAll(/"([^"\n]*)"/g)].flatMap((match) => match[1].split(/\s+/)).filter((token) => PHYSICAL.test(token.split(":").pop() ?? ""));
  assert.deepEqual(physical, [], `${wrapper}.tsx uses start/end classes, not left/right`);
  for (const chevron of text.matchAll(/<ChevronRight className="([^"]*)"/g)) assert.match(chevron[1], /rtl:rotate-180/, `${wrapper}.tsx: the submenu arrow points inward in rtl`);
}
const select = readFileSync(new URL("../src/components/ui/select.tsx", import.meta.url), "utf8");
assert.match(select, /"absolute end-2 flex/, "the Select check mark sits at the end of the row in both directions");

console.log(`PASS radix direction: provider at the document root and ${languageRoots.length} language roots, one direction context, no separate roots, ${followProvider} controls follow the provider and ${explicitDir} keep an explicit dir, wrappers mirror`);
