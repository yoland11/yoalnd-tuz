import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as preparationPage from "../src/views/admin/preparation";

const Actions = (preparationPage as any).PreparationPrintActions;
assert.equal(typeof Actions, "function", "booking card print actions must exist");

const ready = renderToStaticMarkup(createElement(Actions, { busy: false, onPrint: () => {} }));
assert.match(ready, /طباعة A4/);
assert.match(ready, /طباعة 80 حراري/);
assert.match(ready, /aria-label="طباعة قائمة التجهيز"/);

const busy = renderToStaticMarkup(createElement(Actions, { busy: true, onPrint: () => {} }));
assert.equal((busy.match(/disabled=""/g) ?? []).length, 2);

console.log("Preparation A4 and 80mm booking card controls verified.");
