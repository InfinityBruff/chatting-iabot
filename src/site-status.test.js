import test from 'node:test';
import assert from 'node:assert/strict';
import {isPlannedMaintenance,loadSiteAccess,siteStatus} from './site-status.js';

test('planned maintenance is disabled by default and requires the explicit boolean configuration',()=>{
 assert.equal(siteStatus.maintenance.enabled,false);assert.equal(isPlannedMaintenance(),false);
 assert.equal(Object.isFrozen(siteStatus),true);assert.equal(Object.isFrozen(siteStatus.maintenance),true);
 assert.equal(isPlannedMaintenance({maintenance:{enabled:true}}),true);
 for(const status of [null,{},true,{enabled:true},...['true','1',1,0,false,null,undefined].map(enabled=>({maintenance:{enabled}}))])assert.equal(isPlannedMaintenance(status),false);
});
test('the planned maintenance branch never imports authentication or starts its initialization',async()=>{
 let imports=0,authInitializations=0;
 const importer=()=>{imports++;authInitializations++;throw Error('Authentication must not initialize')};
 assert.equal(await loadSiteAccess(importer,{maintenance:{enabled:true}}),null);
 assert.equal(imports,0);assert.equal(authInitializations,0);
});
test('normal entry imports only on demand and returns the access module without an availability request',async()=>{
 let imports=0;const module={default:()=>null},importer=()=>{imports++;return module};
 assert.equal(imports,0);const pending=loadSiteAccess(importer);assert.equal(imports,0);
 assert.equal(await pending,module);assert.equal(imports,1);
});
test('authorization, provider limits, infrastructure failures and SDK import errors do not imply planned maintenance',async()=>{
 for(const status of [401,403,429,503]){
  const error=Object.assign(Error('Fixture failure'),{status,code:'READ_UNAVAILABLE'});
  assert.equal(isPlannedMaintenance(error),false);
  await assert.rejects(loadSiteAccess(()=>Promise.reject(error)),failure=>failure===error);
  assert.equal(isPlannedMaintenance(),false);
 }
 const sdk=Error('SDK import unavailable');await assert.rejects(loadSiteAccess(()=>{throw sdk}),failure=>failure===sdk);
});
