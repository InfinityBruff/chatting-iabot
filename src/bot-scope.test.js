import test from 'node:test';import assert from 'node:assert/strict';import {fanSelected} from './bot-scope.js';
test('paused model overrides all selections; explicit exclusions take priority',()=>{
 assert.equal(fanSelected({mode:'off',overrides:{1:'enabled'}},1),false);
 assert.equal(fanSelected({mode:'all',overrides:{1:'manual'}},1),false);
 assert.equal(fanSelected({mode:'all',overrides:{}},2),true);
 assert.equal(fanSelected({mode:'selected',overrides:{1:'enabled'}},1),true);
 assert.equal(fanSelected({mode:'selected',overrides:{1:'enabled'}},2),false);
 assert.equal(fanSelected({mode:'selected',overrides:{}},1),false);
});
