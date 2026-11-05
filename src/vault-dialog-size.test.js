import test from 'node:test';
import assert from 'node:assert/strict';
import {clampVaultDialogSize,readVaultDialogSize,resetVaultDialogSize,resizeVaultDialogByKey,resizeVaultDialogFromPointer,validVaultDialogSize,vaultDialogBounds,vaultDialogStorageKey,writeVaultDialogSize} from './vault-dialog-size.js';
const scope=(actor='worker-a',agency='agency-a',model='')=>'bruff-ui:'+JSON.stringify([actor,agency,model,'','vault-dialog-size']);
const store=()=>{const values=new Map(),writes=[];return {values,writes,getItem:key=>values.get(key)||null,setItem:(key,value)=>{writes.push({key,value});values.set(key,value)},removeItem:key=>values.delete(key)}};
test('desktop defaults use the requested quarter viewport with usable minimums and a viewport margin',()=>{
 const ordinary=vaultDialogBounds({width:1440,height:900});assert.deepEqual(clampVaultDialogSize(null,ordinary),{width:720,height:520});
 const large=vaultDialogBounds({width:4000,height:2400});assert.deepEqual(clampVaultDialogSize(null,large),{width:1000,height:600});
 const short=vaultDialogBounds({width:700,height:450});assert.deepEqual(clampVaultDialogSize({width:900,height:900},short),{width:668,height:418});
});
test('mobile defaults fill the available viewport and manual sizes remain usable without overflowing it',()=>{
 const mobile=vaultDialogBounds({width:390,height:844});assert.equal(mobile.mobile,true);assert.deepEqual(clampVaultDialogSize(null,mobile),{width:374,height:828});assert.deepEqual(clampVaultDialogSize({width:1,height:1},mobile),{width:320,height:420});
 const tiny=vaultDialogBounds({width:280,height:340});assert.deepEqual(clampVaultDialogSize(null,tiny),{width:264,height:324});assert.equal(tiny.minWidth,tiny.maxWidth);assert.equal(tiny.minHeight,tiny.maxHeight);
});
test('viewport adaptation never mutates or saves the original explicit preference',()=>{
 const storage=store(),saved={width:1100,height:700};assert.equal(writeVaultDialogSize(storage,scope(),saved),true);const writes=storage.writes.length;
 assert.deepEqual(clampVaultDialogSize(readVaultDialogSize(storage,scope()),vaultDialogBounds({width:390,height:844})),{width:374,height:700});
 assert.deepEqual(clampVaultDialogSize(readVaultDialogSize(storage,scope()),vaultDialogBounds({width:1440,height:900})),saved);assert.equal(storage.writes.length,writes);assert.deepEqual(saved,{width:1100,height:700});
});
test('preferences are isolated by worker and agency, and are shared across that worker’s models',()=>{
 const storage=store();writeVaultDialogSize(storage,scope('worker-a','agency-a','model-a'),{width:900,height:650});
 assert.deepEqual(readVaultDialogSize(storage,scope('worker-a','agency-a','model-b')),{width:900,height:650});assert.equal(readVaultDialogSize(storage,scope('worker-b','agency-a')),null);assert.equal(readVaultDialogSize(storage,scope('worker-a','agency-b')),null);
 assert.notEqual(vaultDialogStorageKey(scope('worker-a')),vaultDialogStorageKey(scope('worker-b')));
});
test('missing or invalid actor/agency scope cannot write a global preference',()=>{
 const storage=store();for(const invalid of [undefined,null,'','other', 'bruff-ui:bad','bruff-ui:[]','bruff-ui:"ab"',scope('', 'agency-a'),scope('worker-a','')]){assert.equal(vaultDialogStorageKey(invalid),null);assert.equal(writeVaultDialogSize(storage,invalid,{width:900,height:650}),false)}assert.equal(storage.writes.length,0);
});
test('malformed and unsupported saved sizes are ignored without inventing a persisted default',()=>{
 const storage=store(),key=vaultDialogStorageKey(scope());for(const raw of ['broken','null','[]','{}',JSON.stringify({version:2,width:900,height:650}),JSON.stringify({version:1,width:'900',height:650}),JSON.stringify({version:1,width:-1,height:650}),JSON.stringify({version:1,width:20000,height:650})]){storage.values.set(key,raw);assert.equal(readVaultDialogSize(storage,scope()),null)}assert.equal(storage.writes.length,0);
 for(const invalid of [null,[],{width:NaN,height:520},{width:720,height:Infinity},{width:0,height:520}])assert.equal(validVaultDialogSize(invalid),null);
});
test('centered corner resizing follows pointer geometry and clamps at both viewport bounds',()=>{
 const bounds=vaultDialogBounds({width:1440,height:900}),initial={width:800,height:600};assert.deepEqual(resizeVaultDialogFromPointer(initial,50,20,bounds),{width:900,height:640});assert.deepEqual(resizeVaultDialogFromPointer(initial,-500,-500,bounds),{width:640,height:460});assert.deepEqual(resizeVaultDialogFromPointer(initial,500,500,bounds),{width:1408,height:868});assert.deepEqual(initial,{width:800,height:600});
});
test('keyboard arrows control each axis independently, with larger Shift steps and the same clamps',()=>{
 const bounds=vaultDialogBounds({width:1440,height:900}),initial={width:800,height:600};assert.deepEqual(resizeVaultDialogByKey(initial,'ArrowRight',bounds),{width:810,height:600});assert.deepEqual(resizeVaultDialogByKey(initial,'ArrowUp',bounds,true),{width:800,height:560});assert.deepEqual(resizeVaultDialogByKey({width:640,height:460},'ArrowLeft',bounds),{width:640,height:460});assert.deepEqual(resizeVaultDialogByKey({width:720,height:520},'ArrowLeft',bounds),{width:710,height:520});assert.equal(resizeVaultDialogByKey(initial,'Enter',bounds),null);
});
test('reset removes only the current worker/agency explicit size, leaving other preferences intact',()=>{
 const storage=store();writeVaultDialogSize(storage,scope(),{width:1000,height:700});writeVaultDialogSize(storage,scope('worker-b'),{width:900,height:650});resetVaultDialogSize(storage,scope());assert.equal(readVaultDialogSize(storage,scope()),null);assert.deepEqual(readVaultDialogSize(storage,scope('worker-b')),{width:900,height:650});
});
test('unavailable or denied browser storage never breaks geometry or modal use',()=>{
 const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};assert.equal(readVaultDialogSize(blocked,scope()),null);assert.equal(writeVaultDialogSize(blocked,scope(),{width:900,height:650}),false);assert.equal(resetVaultDialogSize(blocked,scope()),false);assert.equal(writeVaultDialogSize(null,scope(),{width:900,height:650}),false);assert.deepEqual(clampVaultDialogSize(null,vaultDialogBounds({width:1440,height:900})),{width:720,height:520});
});
