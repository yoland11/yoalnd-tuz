/** Representative login accounts: created through the existing staff route, linked through the existing assignment route. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const accounts = readFileSync("src/views/representative/accounts.tsx", "utf8");
const lib = readFileSync("src/views/admin/_lib.ts", "utf8");
const server = readFileSync("src/server/representative.ts", "utf8");
const portal = readFileSync("src/views/representative/index.tsx", "utf8");

const permissions = [...accounts.matchAll(/"(representative\.[a-z.]+)"/g)].map((match) => match[1]);
assert.ok(permissions.includes("representative.portal.access"), "accounts can open the portal");
for (const permission of new Set(permissions)) assert.ok(lib.includes(`"${permission}"`), `${permission} is a known permission`);
assert.match(accounts, /adminFetch<[^>]*>\("\/admin\/staff", \{\s*method: "POST"/, "accounts reuse the existing staff creation route (hashing, duplicate username check)");
assert.match(accounts, /"\/admin\/representative\/assignments", \{\s*method: "POST"/, "the new account is linked through the existing assignment route");
assert.ok(accounts.indexOf('"/admin/staff"') < accounts.indexOf('"/admin/representative/assignments"'), "create first, then link");
assert.match(accounts, /role: "employee"/, "representatives are never created as administrators");
assert.match(accounts, /\/representative\/login/, "the login address is shown and shared");
assert.match(server, /representativeName: graduationGroupsTable\.representativeName/, "the admin page sees each group's recorded representative");
assert.match(server, /if \(user\.role !== "admin"\)\s*return fail\("إدارة تعيين الممثلين متاحة للإدارة فقط", 403\)/, "the assignments payload stays administrator-only");
assert.match(portal, /<RepresentativeAccounts groups=\{q\.data\?\.groups \?\? \[\]\} items=\{q\.data\?\.items \?\? \[\]\} \/>/);
console.log("representative accounts: all checks passed");
