import test from 'node:test';import assert from 'node:assert/strict';
import {spendViewportIds,spendViewportDemand} from './inbox-spend-viewport.js';
test('actual row geometry puts visible fans before overscan at the end of a long list',()=>{
 const entries=Array.from({length:1000},(_,index)=>({id:String(index+1),index,top:index*102,bottom:(index+1)*102}));
 const result=spendViewportIds(entries,{top:990*102,bottom:995*102,width:320,height:510});assert.deepEqual(result.slice(0,5),['991','992','993','994','995']);assert.equal(result.length,9);assert.equal(result.slice(0,20).includes('995'),true);
 const changed=entries.map((row,index)=>({...row,top:index*137,bottom:(index+1)*137}));assert.deepEqual(spendViewportIds(changed,{top:150*137,bottom:153*137,width:320,height:411}).slice(0,3),['151','152','153']);
});
test('hidden and moving lists request no rows; selected fan stays first only when the list is visible',()=>{
 const entries=[{id:'1',index:0,top:0,bottom:100}];assert.deepEqual(spendViewportIds(entries,{top:0,bottom:0,width:0,height:0}),[]);assert.deepEqual(spendViewportDemand('5',['1','2','5'],true),['5','1','2']);assert.deepEqual(spendViewportDemand('5',['1','2'],false),[]);
});
