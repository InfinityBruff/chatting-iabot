import React,{createContext,useCallback,useContext,useEffect,useState} from 'react';
import {createFanDirectory,directoryModelIds,demandedDirectoryIds} from '../fan-directory.js';
import {liveRequest} from './LiveData.jsx';
const empty={rows:[],complete:false,error:'',checked:null};
const Context=createContext({fans:{},lists:{},subscribe:()=>()=>{}});
export function FanDirectory({user,workspace,accounts,role,section,activeModel,children,request=liveRequest}){
 const allowed=directoryModelIds({accounts,role,section,activeModel}),[demand,setDemand]=useState({});
 const subscribe=useCallback((kind,id)=>{const key=JSON.stringify([kind,id]);setDemand(old=>({...old,[key]:(old[key]||0)+1}));return()=>setDemand(old=>{const next={...old};if(next[key]>1)next[key]--;else delete next[key];return next})},[]);
 const ids=demandedDirectoryIds(allowed,demand,'fans'),listIds=demandedDirectoryIds(allowed,demand,'lists');
 const scope=JSON.stringify([user,workspace,ids]),listScope=JSON.stringify([user,workspace,listIds]),[state,setState]=useState({scope:'',models:{}}),[lists,setLists]=useState({scope:'',models:{}});
 useEffect(()=>{const directory=createFanDirectory({request,workspace,ids,visible:()=>document.visibilityState==='visible',publish:models=>setState({scope,models})});return()=>directory.stop()},[scope,request]);
 useEffect(()=>{const groups=createFanDirectory({request,workspace,ids:listIds,visible:()=>document.visibilityState==='visible',operation:'collections',field:'lists',publish:models=>setLists({scope:listScope,models})});return()=>groups.stop()},[listScope,request]);
 return <Context.Provider value={{fans:state.scope===scope?state.models:{},lists:lists.scope===listScope?lists.models:{},subscribe}}>{children}</Context.Provider>;
}
function useDirectory(kind,id,enabled){const context=useContext(Context),subscribe=context.subscribe;useEffect(()=>enabled?subscribe(kind,id):undefined,[kind,id,enabled,subscribe]);return enabled?context[kind][id]||empty:empty}
export const useFanDirectory=(id,enabled=true)=>useDirectory('fans',id,enabled);
export const useCollectionDirectory=(id,enabled=true)=>useDirectory('lists',id,enabled);
