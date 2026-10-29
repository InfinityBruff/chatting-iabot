import test from 'node:test';
import assert from 'node:assert/strict';
import {canAssist,defaults,validateConfig} from './policy.js';
test('pause overrides individual selection',()=>{assert.equal(canAssist({...defaults,mode:'off'},{on:true}),false)});
test('selection mode only includes selected fans',()=>{assert.equal(canAssist(defaults,{on:true}),true);assert.equal(canAssist(defaults,{on:false}),false)});
test('all mode includes fans regardless of saved selection',()=>{assert.equal(canAssist({...defaults,mode:'all'},{on:false}),true)});
test('waiting interval rejects invalid and inverted bounds',()=>{for(const [min,max] of [[30,10],[-1,30],[1,3601],[1.5,30],['',30]])assert.ok(validateConfig({...defaults,min,max}));assert.equal(validateConfig(defaults),'')});
