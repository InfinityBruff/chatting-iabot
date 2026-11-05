// Planned frontend entry screen only. The owner can set enabled:true and deploy,
// then restore enabled:false and deploy. Existing tabs are not paused, sessions
// are not cleared, and backend workers and HTTP availability are unchanged.
export const siteStatus=Object.freeze({maintenance:Object.freeze({enabled:false})});

export function isPlannedMaintenance(status=siteStatus){return status?.maintenance?.enabled===true;}

// Keep authentication code and its initialization out of the maintenance branch.
// Infrastructure/provider failures never select planned maintenance implicitly.
export function loadSiteAccess(importer,status=siteStatus){
 return isPlannedMaintenance(status)?Promise.resolve(null):Promise.resolve().then(importer);
}
