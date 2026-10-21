const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const source=fs.readFileSync('src/server/api.ts','utf8'),ast=ts.createSourceFile('api.ts',source,ts.ScriptTarget.Latest,true);let checked=0;
function visit(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='set'){
 const target=n.expression.expression;if(ts.isCallExpression(target)&&ts.isPropertyAccessExpression(target.expression)&&target.expression.name.text==='update'&&target.arguments[0]?.getText(ast)==='koshaBookingsTable'){
  const values=n.arguments[0];if(ts.isObjectLiteralExpression(values)){for(const prop of values.properties)if(ts.isPropertyAssignment(prop)&&prop.name.getText(ast)==='bookingDetails'){assert.match(prop.initializer.getText(ast),/^bookingEvidenceWriteSql\(/,`unguarded native booking JSON write at ${ast.getLineAndCharacterOfPosition(prop.pos).line+1}`);checked++}}
  else assert.fail(`dynamic native booking SET must protect bookingDetails: ${values.getText(ast)}`);
 }}ts.forEachChild(n,visit)}visit(ast);assert.ok(checked>=10,'native update caller map must include manager, crew, finance snapshots and operational paths');
const save=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='saveBookingOperations').getText(ast);assert.match(save,/bookingEvidenceWriteSql\([\s\S]*reference\.operations/);assert.match(save,/routedKoshaCustomFieldsSql\([\s\S]*reference\.operations/);
assert.match(fs.readFileSync('src/server/kosha-instruction-store.ts','utf8'),/bookingEvidenceWriteSql\(column, safePatch, baselineOperations\)/);
assert.match(fs.readFileSync('src/server/kosha-equipment.ts','utf8'),/booking_details=\$\{bookingEvidenceWriteSql/);
console.log(`PASS all ${checked} native booking JSON update call sites + routed service helper + equipment importer protect live evidence at SQL UPDATE time`);
