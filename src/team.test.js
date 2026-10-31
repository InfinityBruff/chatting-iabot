import test from 'node:test';import assert from 'node:assert/strict';
import {toggleTeamGrant,grantsForRole,teamRoles} from './team.js';
test('team role labels match requested names',()=>assert.deepEqual(Object.values(teamRoles),['Propietario','Manager','Chatter','Analista']));
test('permission edits preserve other models and require read',()=>{let g=toggleTeamGrant([{creator_id:'b',permission:'read'}],'a','send',true,'operator');assert.equal(g.length,3);g=toggleTeamGrant(g,'a','read',false,'operator');assert.deepEqual(g,[{creator_id:'b',permission:'read'}])});
test('role downgrades remove write permissions; manager has implicit grants',()=>{const g=[{creator_id:'a',permission:'read'},{creator_id:'a',permission:'send'}];assert.deepEqual(grantsForRole(g,'viewer'),[]);assert.deepEqual(grantsForRole(g,'admin'),[])});
import {bulkTeamGrant,grantCoverage} from './team.js';
test('bulk permission applies only to selected models and preserves unrelated models',()=>{const before=[{creator_id:'elsewhere',permission:'read'}];const next=bulkTeamGrant(before,['a','b'],'send',true,'operator');assert.equal(next.length,5);assert.deepEqual(grantCoverage(next,['a','b'],'send'),{count:2,total:2,all:true,mixed:false});assert.deepEqual(bulkTeamGrant(next,['a','b'],'read',false,'operator'),before)});
test('mixed coverage is explicit and empty scope never reports all',()=>{assert.equal(grantCoverage([{creator_id:'a',permission:'read'}],['a','b'],'read').mixed,true);assert.equal(grantCoverage([],[],'read').all,false)});

test('analyst analytics grant never implies chats; chatter cannot grant analytics or notes',()=>{assert.deepEqual(bulkTeamGrant([],['a'],'analytics',true,'viewer'),[{creator_id:'a',permission:'analytics'}]);assert.deepEqual(bulkTeamGrant([],['a'],'notes',true,'operator'),[]);assert.deepEqual(bulkTeamGrant([],['a'],'analytics',true,'operator'),[])});
import {messageSenderName} from './team.js';
test('message sender remains historical and missing authors are not guessed',()=>{assert.equal(messageSenderName({senderName:' Marta '}),'Marta');assert.equal(messageSenderName({mine:true}),'Autor no registrado');assert.equal(messageSenderName({senderName:''}),'Autor no registrado')});
