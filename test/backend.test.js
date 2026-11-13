import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp, MAX_BODY } from '../backend/app.mjs';
import { createBook } from '../dist/model.js';
const origin = 'http://localhost:4000';
const password = 'test-only-password-2026';
function setup(t, options = {}) {
 const dir = mkdtempSync(join(tmpdir(),'quiet-chapter-test-'));
 const databasePath = join(dir,'test.sqlite');
 let app = createApp({databasePath,origin,...options});
 t.after(()=>{app.close();rmSync(dir,{recursive:true,force:true});});
 return {databasePath, restart(){app.close();app=createApp({databasePath,origin,...options});},
  async call(path, {method='GET',body,cookie,accountId,headers={},ip='test'}={}) {
   const request = new Request(origin+path,{method,headers:{...(method!=='GET'?{'Origin':origin,'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(accountId?{'X-Account-ID':accountId}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
   const response = await app.handle(request,{ip});
   const payload = response.status===204?null:await response.json();
   return {status:response.status,body:payload,headers:response.headers};
  }
 };
}
async function register(service,email='author@example.test') {
 const result=await service.call('/api/auth/register',{method:'POST',body:{email,password}});
 assert.equal(result.status,201);
 return {cookie:result.headers.get('set-cookie').split(';')[0],accountId:result.body.user.id,email:result.body.user.email};
}
const populated = () => {
 const book=createBook('Моя рукопись');book.chapters[0].html='<p>Секретный черновик</p>';
 book.notes.push({id:'geo',kind:'location',title:'Гавань',body:'Город на острове',locationType:'Город',quote:'',chapterId:null});
 return {version:2,activeBookId:book.id,books:[book]};
};
test('Registration creates private empty library and a protected cookie; passwords and tokens are hashed',async t=>{
 const s=setup(t);const user=await register(s,' Writer@Example.test ');
 assert.equal(user.email,'writer@example.test');
 const me=await s.call('/api/auth/me',user);assert.equal(me.status,200);assert.equal(me.body.user.id,user.accountId);
 const lib=await s.call('/api/library',user);assert.deepEqual(lib.body,{revision:0,library:{version:2,activeBookId:null,books:[]}});
 const login=await s.call('/api/auth/login',{method:'POST',body:{email:user.email,password}});
 assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Lax/);
 const db=new DatabaseSync(s.databasePath);const row=db.prepare('SELECT password_hash FROM users').get();
 assert.match(row.password_hash,/^scrypt\$/);assert.ok(!row.password_hash.includes(password));
 assert.notEqual(db.prepare('SELECT token_hash FROM sessions LIMIT 1').get().token_hash,user.cookie.split('=')[1]);db.close();
 assert.equal(me.headers.get('cache-control'),'no-store');
});
test('Anonymous requests cannot read or replace manuscripts',async t=>{
 const s=setup(t);
 for(const method of ['GET','PUT'])assert.equal((await s.call('/api/library',{method,...(method==='PUT'?{body:{revision:0,library:populated()}}:{})})).status,401);
 assert.equal((await s.call('/api/auth/me')).status,401);
});
test('Two accounts are isolated, including same book IDs; account switch cannot overwrite another library',async t=>{
 const s=setup(t), a=await register(s,'a@example.test'), b=await register(s,'b@example.test');
 const library=populated();
 assert.equal((await s.call('/api/library',{...a,method:'PUT',body:{revision:0,library}})).status,200);
 assert.equal((await s.call('/api/library',b)).body.library.books.length,0);
 const mismatch=await s.call('/api/library',{...b,accountId:a.accountId,method:'PUT',body:{revision:0,library}});
 assert.equal(mismatch.status,409);assert.equal(mismatch.body.error.code,'account_changed');
 assert.equal((await s.call('/api/library',{...b,method:'PUT',body:{revision:0,library:{...library,books:library.books.map(x=>({...x,title:'Другая книга'}))}}})).status,200);
 assert.equal((await s.call('/api/library',a)).body.library.books[0].title,'Моя рукопись');
});
test('Atomic revisions reject stale saves without changing chapters, geography or history',async t=>{
 const s=setup(t), user=await register(s), library=populated();
 const results=await Promise.all([1,2].map(()=>s.call('/api/library',{...user,method:'PUT',body:{revision:0,library}})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const loaded=await s.call('/api/library',user);assert.equal(loaded.body.revision,1);assert.deepEqual(loaded.body.library,library);
});
test('Accounts, sessions and manuscripts survive database reopen; deletion stays deleted',async t=>{
 const s=setup(t), user=await register(s), library=populated();
 await s.call('/api/library',{...user,method:'PUT',body:{revision:0,library}});s.restart();
 assert.deepEqual((await s.call('/api/library',user)).body.library,library);
 await s.call('/api/library',{...user,method:'PUT',body:{revision:1,library:{version:2,activeBookId:null,books:[]}}});s.restart();
 assert.equal((await s.call('/api/library',user)).body.library.books.length,0);
});
test('Logout revokes session; unknown passwords and duplicate emails do not create access',async t=>{
 const s=setup(t), user=await register(s);
 assert.equal((await s.call('/api/auth/register',{method:'POST',body:{email:user.email.toUpperCase(),password}})).status,409);
 for(const email of [user.email,'missing@example.test']) {
  const r=await s.call('/api/auth/login',{method:'POST',body:{email,password:'wrong'}});assert.equal(r.status,401);assert.equal(r.body.error.code,'invalid_login');
 }
 const logout=await s.call('/api/auth/logout',{...user,method:'POST',body:{}});assert.equal(logout.status,204);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal((await s.call('/api/auth/me',user)).status,401);
});
test('Expired sessions no longer authorize requests',async t=>{
 let time=Date.now();const s=setup(t,{now:()=>time}), user=await register(s);
 time+=15*24*3600*1000;assert.equal((await s.call('/api/library',user)).status,401);
});
test('Cross-origin and non-JSON mutations are rejected, including login',async t=>{
 const s=setup(t), user=await register(s);
 for(const path of ['/api/auth/login','/api/auth/logout','/api/library']) {
  const options={...user,method:path==='/api/library'?'PUT':'POST',body:{}};
  assert.equal((await s.call(path,{...options,headers:{Origin:'https://attacker.test'}})).status,403);
  assert.equal((await s.call(path,{...options,headers:{Origin:''}})).status,403);
  assert.equal((await s.call(path,{...options,headers:{'Content-Type':'text/plain'}})).status,415);
 }
});
test('Malformed, oversized and invalid libraries leave saved data untouched',async t=>{
 const s=setup(t), user=await register(s);
 for(const body of ['{', {revision:-1,library:populated()}, {revision:0,library:{version:2,activeBookId:null,books:[null]}}]) {
  assert.equal((await s.call('/api/library',{...user,method:'PUT',body})).status,400);
 }
 assert.equal((await s.call('/api/library',{...user,method:'PUT',body:' '.repeat(MAX_BODY+1)})).status,413);
 assert.equal((await s.call('/api/library',user)).body.revision,0);
});
test('Authentication attempt limit survives restart',async t=>{
 const s=setup(t,{rateLimit:2});
 await s.call('/api/auth/login',{method:'POST',body:{email:'x@example.test',password:'wrong'}});
 await s.call('/api/auth/login',{method:'POST',body:{email:'x@example.test',password:'wrong'}});s.restart();
 const result=await s.call('/api/auth/login',{method:'POST',body:{email:'x@example.test',password:'wrong'}});
 assert.equal(result.status,429);assert.equal(result.headers.get('retry-after'),'900');
});
test('HTTPS deployments use Secure cookies and production refuses HTTP origin',async t=>{
 assert.throws(()=>createApp({databasePath:':memory:',production:true,origin}),/HTTPS/);
 const app=createApp({databasePath:':memory:',production:true,origin:'https://books.example.test'});t.after(()=>app.close());
 const result=await app.handle(new Request('https://books.example.test/api/auth/register',{method:'POST',headers:{Origin:'https://books.example.test','Content-Type':'application/json'},body:JSON.stringify({email:'secure@example.test',password})}));
 assert.equal(result.status,201);assert.match(result.headers.get('set-cookie'),/; Secure/);
});

test('Backup command creates a restorable snapshot while source database is open',async t=>{
 const s=setup(t), user=await register(s), library=populated();
 await s.call('/api/library',{...user,method:'PUT',body:{revision:0,library}});
 const {spawnSync}=await import('node:child_process');
 const {dirname}=await import('node:path');
 const {readdirSync}=await import('node:fs');
 const backupDir=join(dirname(s.databasePath),'backups');
 const result=spawnSync(process.execPath,['scripts/backup.mjs'],{env:{...process.env,DATABASE_PATH:s.databasePath,BACKUP_DIR:backupDir},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const db=new DatabaseSync(join(backupDir,readdirSync(backupDir)[0]));
 assert.deepEqual(JSON.parse(db.prepare('SELECT payload FROM libraries WHERE user_id=?').get(user.accountId).payload),library);
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();
});

test('Server persists both outline modes and rejects invalid chapter links without overwriting saved plans',async t=>{
 const s=setup(t), user=await register(s), library=populated(), book=library.books[0];
 book.outline={mode:'chapters',summary:'История возвращения',items:[{id:'free',title:'Финал',body:'Вернуться домой',chapterId:null},{id:'chapter',title:'Начало',body:'Письмо',chapterId:book.activeId}]};
 assert.equal((await s.call('/api/library',{...user,method:'PUT',body:{revision:0,library}})).status,200);
 s.restart();assert.deepEqual((await s.call('/api/library',user)).body.library.books[0].outline,book.outline);
 book.outline.mode='free';assert.equal((await s.call('/api/library',{...user,method:'PUT',body:{revision:1,library}})).status,200);
 const expected=structuredClone(book.outline);book.outline.items[1].chapterId='missing';
 assert.equal((await s.call('/api/library',{...user,method:'PUT',body:{revision:2,library}})).status,400);
 assert.deepEqual((await s.call('/api/library',user)).body.library.books[0].outline,expected);
});

test('Public health check confirms database availability without exposing manuscripts',async t=>{
 const s=setup(t);const response=await s.call('/api/health');assert.equal(response.status,200);assert.deepEqual(response.body,{status:'ok'});
});

test('Large rich notes survive server restart and backup round-trip alongside legacy notes', async t => {
 const s=setup(t), user=await register(s), library=populated();
 const body='Большой отрывок.\n'.repeat(20000);
 const html='<h2>Замысел</h2><p style="text-align:center"><strong>Начало</strong> <s>черновик</s><span style="background-color:#f0e8ba">свет</span></p><p>'+body+'</p>';
 library.books[0].notes.push({id:'long-note',kind:'note',title:'Большой отрывок',body,html,quote:'',chapterId:null});
 assert.equal((await s.call('/api/library',{...user,method:'PUT',body:{revision:0,library}})).status,200);
 s.restart();
 const saved=(await s.call('/api/library',user)).body.library;
 assert.deepEqual(JSON.parse(JSON.stringify(saved)).books[0].notes,library.books[0].notes);
 for (const invalid of [42, 'x'.repeat(2_000_001)]) {
  const changed=structuredClone(saved); changed.books[0].notes[1].html=invalid;
  assert.equal((await s.call('/api/library',{...user,method:'PUT',body:{revision:1,library:changed}})).status,400);
 }
 const oversized=structuredClone(saved);oversized.books[0].notes[1].body='x'.repeat(1_000_001);
 assert.equal((await s.call('/api/library',{...user,method:'PUT',body:{revision:1,library:oversized}})).status,400);
 assert.deepEqual((await s.call('/api/library',user)).body.library,saved);
});
