import React,{lazy,Suspense,useRef,useState} from 'react';
import Brand from './Brand.jsx';
import {MaintenanceExperience} from './BrandExperience.jsx';
import {isPlannedMaintenance,loadSiteAccess,siteStatus} from '../site-status.js';

const AccessGate=lazy(()=>loadSiteAccess(()=>import('./AccessGate.jsx')));
function OpeningFallback(){
 return <main role="status" style={{minHeight:'100dvh',display:'grid',placeItems:'center',padding:24,background:'#050505',color:'#fff'}}><div style={{textAlign:'center'}}><Brand/><p>Abriendo BRUFF…</p><p lang="en">Opening BRUFF…</p></div></main>;
}
export default function AvailabilityGate(){
 const [checking,setChecking]=useState(false),retrying=useRef(false);
 const retry=()=>{if(retrying.current)return;retrying.current=true;setChecking(true);try{window.location.reload()}catch{retrying.current=false;setChecking(false)}};
 if(isPlannedMaintenance(siteStatus))return <MaintenanceExperience maintenance={siteStatus.maintenance} onRetry={retry} checking={checking}/>;
 return <Suspense fallback={<OpeningFallback/>}><AccessGate/></Suspense>;
}
