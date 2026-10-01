import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/views/admin/staff.tsx", "utf8");

assert.match(source, /import\s*\{[^}]*\bEye\b[^}]*\bEyeOff\b[^}]*\}\s*from\s*["']lucide-react["']/s,
  "staff editor should use the existing Lucide eye icons");
assert.match(source, /const\s*\[showPassword,\s*setShowPassword\]\s*=\s*useState\(false\)/,
  "password visibility must default to hidden");
assert.match(source, /type=\{showPassword\s*\?\s*["']text["']\s*:\s*["']password["']\}/,
  "visibility control should switch only the entered password input");
assert.match(source, /aria-label=\{showPassword\s*\?\s*["']إخفاء كلمة المرور["']\s*:\s*["']إظهار كلمة المرور["']\}/,
  "toggle must provide an accessible Arabic label");
assert.match(source, /if\s*\(e\.password\)\s*body\.password\s*=\s*e\.password/,
  "blank edit password must continue leaving the current password unchanged");

console.log("Staff password visibility control contract verified.");
