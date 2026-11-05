import test from 'node:test';import assert from 'node:assert/strict';
import {spendViewportIds,spendViewportDemand,createSpendViewportRegistry,createSpendViewportSampler} from './inbox-spend-viewport.js';
test('actual row geometry puts visible fans before overscan at the end of a long list',()=>{
 const entries=Array.from({length:1000},(_,index)=>({id:String(index+1),index,top:index*102,bottom:(index+1)*102}));
 const result=spendViewportIds(entries,{top:990*102,bottom:995*102,width:320,height:510});assert.deepEqual(result.slice(0,5),['991','992','993','994','995']);assert.equal(result.length,14);assert.equal(result.slice(0,20).includes('995'),true);
 const changed=entries.map((row,index)=>({...row,top:index*137,bottom:(index+1)*137}));assert.deepEqual(spendViewportIds(changed,{top:150*137,bottom:153*137,width:320,height:411}).slice(0,3),['151','152','153']);
});
test('hidden lists request no rows; selected fan stays first while the list is visible',()=>{
 const entries=[{id:'1',index:0,top:0,bottom:100}];assert.deepEqual(spendViewportIds(entries,{top:0,bottom:0,width:0,height:0}),[]);assert.deepEqual(spendViewportDemand('5',['1','2','5'],true),['5','1','2']);assert.deepEqual(spendViewportDemand('5',['1','2'],false),[]);
});
test('exact visible fans precede one viewport of downward demand and a bounded previous buffer',()=>{
 const entries=Array.from({length:20},(_,index)=>({id:String(index+1),index,top:index*100,bottom:(index+1)*100}));
 const ids=spendViewportIds(entries,{top:200,bottom:500,width:300,height:300});assert.deepEqual(ids,['3','4','5','6','7','8','2','1']);assert.deepEqual(spendViewportDemand('15',ids,true),['15','3','4','5','6','7','8','2','1']);assert.equal(ids.includes('9'),false);
 const tiny=Array.from({length:200},(_,index)=>({id:String(index+1),index,top:index,bottom:index+1}));assert.equal(spendViewportIds(tiny,{top:0,bottom:100,height:100,width:300},{overscan:0}).length,120);
});
test('page append observes only new row nodes and reordering preserves observers with current visible order',()=>{
 const added=[],removed=[],observer={observe:node=>added.push(node),unobserve:node=>removed.push(node),disconnect:()=>{}},registry=createSpendViewportRegistry(observer);
 const node=id=>({dataset:{fanId:id},top:0,getBoundingClientRect(){return {top:this.top,bottom:this.top+100}}}),a=node('1'),b=node('2'),c=node('3');
 registry.sync(['1','2'],[a,b]);registry.accept([{target:a,isIntersecting:true},{target:b,isIntersecting:true}]);registry.sync(['1','2','3'],[a,b,c]);registry.accept([{target:c,isIntersecting:true}]);assert.deepEqual(added,[a,b,c]);
 c.top=0;a.top=100;b.top=200;registry.sync(['3','1','2'],[c,a,b]);assert.deepEqual(added,[a,b,c]);assert.deepEqual(removed,[]);assert.deepEqual(spendViewportIds(registry.entries(),{top:0,bottom:200,height:200,width:300}),['3','1','2']);
 registry.sync(['3','1'],[c,a]);registry.accept([{target:b,isIntersecting:true}]);assert.deepEqual(removed,[b]);assert.deepEqual(registry.entries().map(entry=>entry.id).sort(),['1','3']);registry.disconnect();assert.deepEqual(registry.entries(),[]);
});
test('continuous scroll events are sampled every100ms without requiring an idle interval and stop cancels late samples',()=>{
 let at=0;const tasks=new Map(),samples=[],sampler=createSpendViewportSampler(()=>samples.push(at),{now:()=>at,schedule:(fn,ms)=>(tasks.set(fn,at+ms),fn),cancel:fn=>tasks.delete(fn)});
 for(at=0;at<=300;at+=20){sampler.queue();for(const [fn,due]of tasks)if(due<=at){tasks.delete(fn);fn()}}
 assert.deepEqual(samples,[0,100,200,300]);sampler.queue();assert.equal(tasks.size,1);sampler.stop();assert.equal(tasks.size,0);sampler.queue();assert.equal(tasks.size,0);
});
