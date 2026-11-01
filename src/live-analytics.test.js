import test from 'node:test';import assert from 'node:assert/strict';import {earningsCategories} from './live-analytics.js';
test('earnings distinguishes money, counts and unknown metadata',()=>{const [x]=earningsCategories({total:{gross:100,total:80,delta:25,chartAmount:[{date:'2026-10-01',count:80}],chartCount:[{count:3}]}});assert.equal(x.total,80);assert.equal(x.points[0].amount,80);assert.equal(x.points[0].operations,3);assert.equal('delta' in x,false);assert.deepEqual(earningsCategories({unknown:{delta:99}}),[])});
test('missing financial values stay unavailable',()=>{const [x]=earningsCategories({total:{total:0,gross:null}});assert.equal(x.total,0);assert.equal(x.gross,null)});
import {analyticsRange,historicalSum} from './live-analytics.js';
test('last month is a complete UTC calendar month across year and leap boundaries',()=>{assert.deepEqual(analyticsRange('last-month',new Date('2026-01-15T12:00Z')),{start:'2025-12-01',end:'2025-12-31'});assert.deepEqual(analyticsRange('last-month',new Date('2024-03-10T12:00Z')),{start:'2024-02-01',end:'2024-02-29'});});
test('historical totals reject missing fields and duplicate months; preserve zero',()=>{assert.equal(historicalSum([{label:'2026-01',net:0},{label:'2026-02',net:10.1}],'net'),10.1);assert.equal(historicalSum([{label:'2026-01',net:null}],'net'),null);assert.equal(historicalSum([{label:'x',net:1},{label:'x',net:2}],'net'),null);assert.equal(historicalSum([],'net'),null)});
import {historicalRange} from './live-analytics.js';
test('lifetime range uses earliest provided month; rejects missing, duplicate and future months',()=>{
 const now=new Date('2026-11-01T12:00Z');assert.deepEqual(historicalRange([{label:'2026-10-01'},{label:'2024-07-01'}],now),{start:'2024-07-01',end:'2026-11-01'});assert.equal(historicalRange([{label:null}],now),null);assert.equal(historicalRange([{label:'2026-10'},{label:'2026-10-01'}],now),null);assert.equal(historicalRange([{label:'2027-01'}],now),null);
});
