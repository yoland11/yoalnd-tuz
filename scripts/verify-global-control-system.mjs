import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const button = read("src/components/ui/button.tsx");

assert.match(button, /selected\s*:/, "shared Button must expose a semantic selected variant");
assert.match(button, /focus-visible:ring-2/, "shared Button must retain a visible keyboard focus ring");
assert.match(button, /max-md:min-h-11/, "shared Button must preserve a mobile touch target");
assert.match(button, /flush:\s*"[^"]*\bp-0\b/, "shared Button must provide an image-safe flush size");

assert.ok(existsSync(new URL("../src/components/ui/icon-button.tsx", import.meta.url)), "IconButton primitive must exist");
const iconButton = read("src/components/ui/icon-button.tsx");
assert.match(iconButton, /(?:aria-label|"aria-label")\s*:\s*string/, "IconButton must require an accessible name");
assert.match(iconButton, /asChild \? undefined/, "asChild icon links must not receive a button-only type attribute");
assert.ok(existsSync(new URL("../src/components/ui/icon-frame.tsx", import.meta.url)), "IconFrame primitive must exist");
const iconFrame = read("src/components/ui/icon-frame.tsx");
assert.match(iconFrame, /success|warning|danger|neutral/, "IconFrame must expose semantic tones");

const workspace = read("src/views/admin/workspace.tsx");
assert.match(workspace, /<IconButton/, "workspace icon-only actions must use the shared primitive");
assert.match(workspace, /<IconFrame/, "workspace section icon halos must use the shared primitive");
assert.match(workspace, /variant=\{pinned \? "selected"/, "workspace pinned modules must expose the selected state");

const navbar = read("src/components/layout/Navbar.tsx");
assert.match(navbar, /<IconButton/, "shared navbar icon actions must use IconButton");
const mobileNav = read("src/components/layout/MobileNav.tsx");
assert.match(mobileNav, /<Button[\s\S]*?variant=\{isActive \? "selected"/, "mobile drawer links must use selected shared buttons");
const cart = read("src/views/cart.tsx");
assert.match(cart, /import \{ IconButton \}/, "store cart quantity and remove actions must use IconButton");
const productDetail = read("src/views/store/id.tsx");
assert.match(productDetail, /import \{ IconButton \}/, "store product icon actions must use IconButton");
const studentWizard = read("src/components/graduation-student-wizard.tsx");
assert.match(studentWizard, /variant=\{\s*form\.sashType === type\.key \? "selected"/, "graduation sash selection must expose a selected state");
const groupBooking = read("src/views/graduation-groups.tsx");
assert.match(groupBooking, /variant=\{selected \? "selected" : "outline"\}/, "optional booking services must expose a selected state");
const bookingCenter = read("src/views/admin/booking-center.tsx");
assert.match(bookingCenter, /variant=\{type === item\.key \? "selected" : "outline"\}/, "booking report selectors must expose a selected state");
const staffBooking = read("src/views/staff/booking-detail.tsx");
assert.match(staffBooking, /import \{ IconButton \}/, "staff booking icon actions must use IconButton");

const globalCss = read("src/index.css");
assert.doesNotMatch(globalCss, /^\s*(?:button|svg)\s*\{/m, "do not globally override every button or SVG");

const exceptions = JSON.parse(read("scripts/global-control-exceptions.json"));
const exceptionPaths = new Set(exceptions.map((entry) => entry.file.replaceAll("\\", "/")));
assert.ok(exceptions.every((entry) => entry.reason.trim().length > 30), "every native-button exception must document its interaction reason");
const nativeButtons = [];
const imageButtonsWithoutFlush = [];
function scan(directory) {
  for (const entry of readdirSync(new URL(`../${directory}`, import.meta.url), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (path === "src/components/ui") continue;
      scan(path);
      continue;
    }
    if (!entry.isFile() || !path.endsWith(".tsx") || exceptionPaths.has(path)) continue;
    const source = read(path);
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && node.tagName.text === "button") {
        nativeButtons.push(path);
      }
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && node.tagName.text === "Button") {
        let containsImage = false;
        function inspectChild(child) {
          if ((ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) && ts.isIdentifier(child.tagName) && child.tagName.text === "img") containsImage = true;
          ts.forEachChild(child, inspectChild);
        }
        inspectChild(node.parent);
        const size = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "size")?.initializer?.getText(sourceFile) ?? "";
        if (containsImage && !size.includes("flush")) imageButtonsWithoutFlush.push(`${path}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
}
scan("src/components");
scan("src/views");
assert.deepEqual(nativeButtons, [], `app-owned raw <button> controls must use shared Button/ IconButton primitives or a documented exception; remaining: ${nativeButtons.join(", ")}`);
assert.deepEqual(imageButtonsWithoutFlush, [], `image-bearing buttons need the shared flush size to preserve image space: ${imageButtonsWithoutFlush.join(", ")}`);

console.log("Global button/icon system source contract passed.");
