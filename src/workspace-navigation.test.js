import {test} from 'node:test';import assert from 'node:assert/strict';
import {visibleSections,resolveSection,sectionAccount} from './workspace-navigation.js';
const accounts=[{id:'a',chat:true,analytics:false,vault:false},{id:'b',chat:false,analytics:true,vault:false}];
test('navigation only exposes permitted functions and management roles',()=>{assert.deepEqual(visibleSections('operator',[accounts[0]]).map(x=>x.id),['chat','accounts']);assert.deepEqual(visibleSections('viewer',[accounts[1]]).map(x=>x.id),['dashboard','analytics','accounts']);assert.ok(visibleSections('admin',accounts).some(s=>s.id==='team'));assert.ok(!visibleSections('operator',accounts).some(s=>s.id==='bot'));});
test('switching function selects an authorized model and drops a removed model',()=>{assert.equal(sectionAccount('analytics',accounts,'a').id,'b');assert.equal(sectionAccount('chat',accounts.slice(1),'a'),null);assert.equal(resolveSection('chat','viewer',accounts.slice(1)),'dashboard');assert.equal(resolveSection('team','operator',accounts),'chat');assert.equal(resolveSection('analytics','viewer',[]),'accounts');});

import {navigationSections} from './workspace-navigation.js';
test('locked navigation remains visible but never authorizes a section',()=>{const nav=navigationSections('operator',[accounts[0]]);assert.equal(nav.length,10);assert.equal(nav.find(s=>s.id==='team').locked,true);assert.equal(nav.find(s=>s.id==='chat').locked,false);assert.equal(resolveSection('team','operator',[accounts[0]]),'chat');assert.equal(nav.find(s=>s.id==='team').group,'Trabajadores');});
