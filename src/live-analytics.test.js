import test from 'node:test';import assert from 'node:assert/strict';import {earningsCategories} from './live-analytics.js';
test('earnings distinguishes money, counts and unknown metadata',()=>{const [x]=earningsCategories({total:{gross:100,total:80,delta:25,chartAmount:[{date:'2026-10-01',count:80}],chartCount:[{count:3}]}});assert.equal(x.total,80);assert.equal(x.points[0].amount,80);assert.equal(x.points[0].operations,3);assert.equal('delta' in x,false);assert.deepEqual(earningsCategories({unknown:{delta:99}}),[])});
test('missing financial values stay unavailable',()=>{const [x]=earningsCategories({total:{total:0,gross:null}});assert.equal(x.total,0);assert.equal(x.gross,null)});
test('dated operation counts align with money by exact date rather than position or sort order',()=>{
 const [x]=earningsCategories({total:{chartAmount:[{date:'2026-10-01',count:80},{date:'2026-10-02',count:60},{date:'2026-10-03',count:40}],chartCount:[{date:'2026-10-03',count:4},{datetime:'2026-10-01',count:8}]}});
 assert.deepEqual(x.points.map(p=>[p.label,p.amount,p.operations]),[['2026-10-01',80,8],['2026-10-02',60,null],['2026-10-03',40,4]]);
});
test('datetime counts require an exact match and mixed dated arrays never fall back to the index',()=>{
 const [x]=earningsCategories({total:{chartAmount:[{datetime:'2026-10-01T00:00:00Z',count:10},{date:'2026-10-02',count:20},{datetime:'2026-10-01T01:00:00Z',count:30},{count:40}],chartCount:[{date:'2026-10-01',count:9},{count:7},{datetime:'2026-10-01T00:00:00Z',count:1}]}});
 assert.deepEqual(x.points.map(p=>p.operations),[1,null,null,null]);
});
test('wholly undated legacy count arrays retain positional compatibility and preserve real zero',()=>{
 const [x]=earningsCategories({total:{chartAmount:[{date:'2026-10-01',count:10},{date:'2026-10-02',count:20},{date:'2026-10-03',count:30}],chartCount:[{count:0},{count:2}]}});
 assert.deepEqual(x.points.map(p=>p.operations),[0,2,null]);
});
test('duplicate dates and non-finite operation counts remain unavailable rather than reporting an arbitrary value',()=>{
 const [x]=earningsCategories({total:{chartAmount:[{date:'2026-10-01',count:10},{date:'2026-10-02',count:20}],chartCount:[{date:'2026-10-01',count:1},{date:'2026-10-01',count:2},{date:'2026-10-02',count:Infinity}]}});
 assert.deepEqual(x.points.map(p=>p.operations),[null,null]);
});
import {analyticsRange,historicalSum} from './live-analytics.js';
test('last month is a complete UTC calendar month across year and leap boundaries',()=>{assert.deepEqual(analyticsRange('last-month',new Date('2026-01-15T12:00Z')),{start:'2025-12-01',end:'2025-12-31'});assert.deepEqual(analyticsRange('last-month',new Date('2024-03-10T12:00Z')),{start:'2024-02-01',end:'2024-02-29'});});
test('historical totals reject missing fields and duplicate months; preserve zero',()=>{assert.equal(historicalSum([{label:'2026-01',net:0},{label:'2026-02',net:10.1}],'net'),10.1);assert.equal(historicalSum([{label:'2026-01',net:null}],'net'),null);assert.equal(historicalSum([{label:'x',net:1},{label:'x',net:2}],'net'),null);assert.equal(historicalSum([],'net'),null)});
import {historicalRange} from './live-analytics.js';
test('lifetime range uses earliest provided month; rejects missing, duplicate and future months',()=>{
 const now=new Date('2026-11-01T12:00Z');assert.deepEqual(historicalRange([{label:'2026-10-01'},{label:'2024-07-01'}],now),{start:'2024-07-01',end:'2026-11-01'});assert.equal(historicalRange([{label:null}],now),null);assert.equal(historicalRange([{label:'2026-10'},{label:'2026-10-01'}],now),null);assert.equal(historicalRange([{label:'2027-01'}],now),null);
});
test('lifetime range includes January 2016 but rejects older history consistently with the live handler',()=>{
 const now=new Date('2026-11-01T12:00Z');assert.deepEqual(historicalRange([{label:'2016-01-01'},{label:'2026-10-01'}],now),{start:'2016-01-01',end:'2026-11-01'});assert.equal(historicalRange([{label:'2015-12-01'}],now),null);
});
