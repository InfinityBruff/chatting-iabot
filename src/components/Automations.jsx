import React,{useState} from 'react';
import AutoMessages from './AutoMessages.jsx';
import LegacyAutomations from './LegacyAutomations.jsx';
export default function Automations(props){
 const [legacy,setLegacy]=useState(false);
 return legacy?<><div className="am-legacy-back"><button onClick={()=>setLegacy(false)}>← Volver a Automatizaciones</button><small>Campañas anteriores · Conservan sus datos y controles originales</small></div><LegacyAutomations {...props}/></>:<AutoMessages {...props} center onLegacy={()=>setLegacy(true)}/>;
}
