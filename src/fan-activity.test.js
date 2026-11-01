import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeActivity,activityStats} from './fan-activity.js';
test('activity refresh deduplicates IDs and updates existing amounts without adding unknown IDs',()=>{const rows=mergeActivity([{id:'a',amount:4,createdAt:'2026-10-01'}],[{id:'a',amount:5,createdAt:'2026-10-01'},{id:'b',amount:3,createdAt:'2026-10-02'},{amount:999}]);assert.equal(rows.length,2);assert.equal(activityStats(rows).total,8);assert.equal(activityStats(rows).average,4)});
test('unknown amounts are not treated as zero or used for averages',()=>{const s=activityStats([{amount:null},{amount:5}]);assert.equal(s.count,2);assert.equal(s.total,null);assert.equal(s.average,null);assert.equal(activityStats([{amount:0}]).total,0)});
