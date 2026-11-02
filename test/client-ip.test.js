import test from 'node:test';
import assert from 'node:assert/strict';
import {clientIp} from '../backend/client-ip.mjs';
test('Proxy IP is trusted only when explicitly enabled and syntactically valid',()=>{
 const req={socket:{remoteAddress:'127.0.0.1'},headers:{'fly-client-ip':'203.0.113.10','x-forwarded-for':'198.51.100.1'}};
 assert.equal(clientIp(req),'127.0.0.1');assert.equal(clientIp(req,true),'203.0.113.10');
 req.headers['fly-client-ip']='203.0.113.10, 10.0.0.1';assert.equal(clientIp(req,true),'127.0.0.1');
 delete req.headers['fly-client-ip'];assert.equal(clientIp(req,true),'127.0.0.1');
});
