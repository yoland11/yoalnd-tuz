import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/views/admin/_lib.ts", "utf8");
const ast = ts.createSourceFile("_lib.ts", source, ts.ScriptTarget.Latest, true);
const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node)
  && ["fetchAdminMe", "getCachedAdminMe"].includes(node.name?.text)).map((node) => node.getText(ast));
function fixture() {
  let calls = 0;
  const responses = [];
  const adminFetch = async () => { calls++; const next = responses.shift(); if (next instanceof Error) throw next; return next; };
  const module = { exports: {} };
  const compiled = ts.transpileModule(`let adminMeCache; let adminMePromise;\n${functions.join("\n")}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("module", "exports", "adminFetch", compiled)(module, module.exports, adminFetch);
  return { ...module.exports, responses, calls: () => calls };
}
const transient = Object.assign(new Error("synthetic service unavailable"), { status: 503, requestId: "TEST-503" });
const user = { id: 7, role: "employee", permissions: ["photography"], isActive: true };
const cold = fixture();
cold.responses.push(transient);
await assert.rejects(cold.fetchAdminMe(), (error) => error === transient, "503 must remain an observable error");
assert.equal(cold.getCachedAdminMe(), undefined, "a transient failure must not poison the session cache with null");
cold.responses.push({ user });
assert.deepEqual(await cold.fetchAdminMe(), user, "the next request retries the session without reload");
assert.equal(cold.calls(), 2);
cold.responses.push(transient);
await assert.rejects(cold.fetchAdminMe({ force: true }), (error) => error === transient);
assert.deepEqual(cold.getCachedAdminMe(), user, "transient refresh keeps the last authenticated cache");
assert.deepEqual(await cold.fetchAdminMe(), user);
for (const status of [401, 403]) {
  const invalid = fixture();
  invalid.responses.push(Object.assign(new Error("session rejected"), { status }));
  assert.equal(await invalid.fetchAdminMe(), null);
  assert.equal(invalid.getCachedAdminMe(), null, `${status} retains the existing sign-out result`);
}
const offline = fixture();
const networkError = Object.assign(new Error("synthetic network failure"), { status: 0, code: "NETWORK_ERROR" });
offline.responses.push(networkError);
await assert.rejects(offline.fetchAdminMe(), (error) => error === networkError);
assert.equal(offline.getCachedAdminMe(), undefined);
const concurrent = fixture();
concurrent.responses.push({ user });
const results = await Promise.all([concurrent.fetchAdminMe(), concurrent.fetchAdminMe()]);
assert.deepEqual(results, [user, user]);
assert.equal(concurrent.calls(), 1, "ordinary concurrent session requests are deduplicated");

// Execute the real mount/refresh callbacks of every consumer outside React Query.
// A rejected session lookup must surface its cause and must never run the
// success callback that redirects to login or clears the authenticated identity.
const consumers = ["admin/index.tsx", "admin/login.tsx", "admin/invoice.tsx", "staff/index.tsx",
  "staff/unified-portal.tsx", "staff/photography/index.tsx", "staff/tailors/index.tsx"];
for (const path of consumers) {
  const content = readFileSync(`src/views/${path}`, "utf8");
  const tree = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && ["useEffect", "useCallback"].includes(node.expression.text)
      && node.arguments[0]?.getText(tree).includes("fetchAdminMe(")) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(callback, `${path} has a session mount/refresh callback`);
  const seen = { errors: [], identityUpdates: 0, navigations: 0, dataRequests: 0 };
  const dependencies = {
    fetchAdminMe: () => cold.fetchAdminMe({ force: true }), getCachedAdminMe: () => undefined,
    setSessionError: (error) => seen.errors.push(error), setSessionLoadError: (error) => seen.errors.push(error),
    setMe: () => { seen.identityUpdates++; }, setLoading: () => {},
    setLocation: () => { seen.navigations++; }, navigate: () => { seen.navigations++; },
    adminFetch: () => { seen.dataRequests++; throw new Error("must not load data without session verification"); },
  };
  const module = { exports: {} };
  const output = ts.transpileModule(`exports.run = ${callback.getText(tree)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("exports", ...Object.keys(dependencies), output)(module.exports, ...Object.values(dependencies));
  cold.responses.push(transient);
  module.exports.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.errors.at(-1), transient, `${path} displays the original failure`);
  assert.equal(seen.identityUpdates, 0, `${path} does not replace identity with null after 503`);
  assert.equal(seen.navigations, 0, `${path} does not redirect after 503`);
  assert.equal(seen.dataRequests, 0);
  assert.match(content, /<SessionLoadError\s+error=/, `${path} exposes a retry state`);
}
console.log("Admin session transient failures: PASS (synthetic requests; no network/database)");
