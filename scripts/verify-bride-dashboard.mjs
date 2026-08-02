import fs from "node:fs";

const mustContain = (file, text) => {
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes(text)) throw new Error(`${file} is missing ${text}`);
};

mustContain("src/App.tsx", 'path="/bride"');
mustContain("src/server/api.ts", "handleBrideDashboard(req, parts, customer)");
mustContain("src/server/bride-dashboard.ts", "inArray(koshaBookingsTable.status");
mustContain("src/server/bride-dashboard.ts", "eq(koshaBookingsTable.customerId, customer.id)");
mustContain("src/server/bride-dashboard.ts", "db.transaction(async (tx)");
mustContain("src/server/bride-dashboard.ts", "customerActivityLogsTable");
mustContain("src/server/bride-dashboard.ts", "messageThreadsTable");
mustContain("src/server/bride-dashboard.ts", "entityDocumentsTable");
mustContain("src/views/bride-dashboard.tsx", 'dir={dir}');
mustContain("src/views/bride-dashboard.tsx", 'value="ku"');
mustContain("src/views/bride-dashboard.tsx", 'value="tr"');
mustContain("lib/db/migrations/0083_bride_dashboard.sql", "bride_dashboard_requests");
mustContain("lib/db/migrations/0083_bride_dashboard.sql", "wedding_workspace_members");

console.log("Bride dashboard contract checks passed.");
