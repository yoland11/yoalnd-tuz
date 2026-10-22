import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../src/components/ui/button";
import { Badge } from "../src/components/ui/badge";
import { Skeleton } from "../src/components/ui/skeleton";
import { UserRound, PackageCheck } from "lucide-react";
const source = ts.createSourceFile("workspace.tsx", readFileSync("src/views/admin/booking-operations-workspace.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "FixedCustodyPanel")!;
const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
function render(preview: any) {
  const panel = new Function("React", "useQueryClient", "useToast", "useState", "useQuery", "useEffect", "useMutation", "useMemo", "Button", "Badge", "Skeleton", "UserRound", "PackageCheck", `${code};return FixedCustodyPanel;`)(React, () => ({}), () => ({ toast: () => {} }), React.useState, (options: any) => options.queryKey.includes("fixed-custody") ? preview : { data: [] }, React.useEffect, () => ({ isPending: false, mutate: () => {} }), React.useMemo, Button, Badge, Skeleton, UserRound, PackageCheck);
  return renderToStaticMarkup(React.createElement(panel, { base: "/admin/booking-operations/kosha/7", queryKey: ["booking", "kosha", 7] }));
}
const missing = render({ data: { assets: [{ productId: 10, name: "كاميرا", employeeName: "أحمد", available: false, reason: "فترة التشغيل غير مكتملة" }], employeeIds: [5], reservations: [], timingIncomplete: true } });
assert.match(missing, /حدد فترة تشغيل الموارد/);
assert.match(missing, /disabled=""[^>]*>.*?حفظ وحجز المعدات المتاحة/s);
const failed = render({ isError: true, error: new Error("database failed"), refetch: () => {} });
assert.match(failed, /role="alert"/); assert.match(failed, /تعذر تحميل معدات العهدة/); assert.match(failed, /إعادة المحاولة/);
assert.doesNotMatch(failed, /لا توجد مجموعة عهدة/);
console.log("PASS actual fixed-custody panel: incomplete timing blocks reservation and read failure is not an empty group");
