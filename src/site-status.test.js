import test from 'node:test';
import assert from 'node:assert/strict';
import {isPlannedMaintenance,loadSiteAccess,siteStatus} from './site-status.js';

test('planned maintenance follows the deployed boolean configuration and accepts explicit overrides',()=>{
 assert.equal(typeof siteStatus.maintenance.enabled,'boolean');assert.equal(isPlannedMaintenance(),siteStatus.maintenance.enabled);
 assert.equal(Object.isFrozen(siteStatus),true);assert.equal(Object.isFrozen(siteStatus.maintenance),true);
 assert.equal(isPlannedMaintenance({maintenance:{enabled:true}}),true);
 assert.equal(isPlannedMaintenance({maintenance:{enabled:false}}),false);
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
 assert.equal(imports,0);const pending=loadSiteAccess(importer,{maintenance:{enabled:false}});assert.equal(imports,0);
 assert.equal(await pending,module);assert.equal(imports,1);
});
test('the default access loader follows the deployed flag without requiring either maintenance state',async()=>{
 let imports=0;const module={default:()=>null},result=await loadSiteAccess(()=>{imports++;return module});
 assert.equal(result,siteStatus.maintenance.enabled?null:module);
 assert.equal(imports,siteStatus.maintenance.enabled?0:1);
});
test('authorization, provider limits, infrastructure failures and SDK import errors do not imply planned maintenance',async()=>{
 const normal={maintenance:{enabled:false}};
 for(const status of [401,403,429,503]){
  const error=Object.assign(Error('Fixture failure'),{status,code:'READ_UNAVAILABLE'});
  assert.equal(isPlannedMaintenance(error),false);
  await assert.rejects(loadSiteAccess(()=>Promise.reject(error),normal),failure=>failure===error);
  assert.equal(isPlannedMaintenance(normal),false);
 }
 const sdk=Error('SDK import unavailable');await assert.rejects(loadSiteAccess(()=>{throw sdk},normal),failure=>failure===sdk);
});
