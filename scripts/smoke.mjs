import assert from 'node:assert/strict';
const origin = new URL(process.argv[2] || 'https://book.ayudenko.by').origin;
const get = path => fetch(origin+path,{redirect:'error',signal:AbortSignal.timeout(30000)});
const page=await get('/');assert.equal(page.status,200);assert.match(await page.text(),/Тихая глава/);
const health=await get('/api/health');assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok'});
for(const path of ['/api/auth/me','/api/library']) {const response=await get(path);assert.equal(response.status,401);}
console.log(`OK: ${origin} — interface, database health and anonymous access protection`);
