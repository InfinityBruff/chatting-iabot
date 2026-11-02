import React,{createContext,useContext,useEffect,useState} from 'react';
import {createFanDirectory,directoryModelIds} from '../fan-directory.js';
import {liveRequest} from './LiveWorkspace.jsx';
const Context=createContext({});
const ListsContext=createContext({});
export function FanDirectory({user,workspace,accounts,role,section,activeModel,children,request=liveRequest}){
 const ids=directoryModelIds({accounts,role,section,activeModel});
 const scope=JSON.stringify([user,workspace,ids]),[state,setState]=useState({scope:'',models:{}}),[lists,setLists]=useState({scope:'',models:{}});
 useEffect(()=>{const visible=()=>document.visibilityState==='visible';const directory=createFanDirectory({request,workspace,ids,visible,publish:models=>setState({scope,models})});const groups=createFanDirectory({request,workspace,ids,visible,operation:'collections',field:'lists',publish:models=>setLists({scope,models})});return()=>{directory.stop();groups.stop()}},[scope,request]);
 return <Context.Provider value={state.scope===scope?state.models:{}}><ListsContext.Provider value={lists.scope===scope?lists.models:{}}>{children}</ListsContext.Provider></Context.Provider>;
}
export const useFanDirectory=id=>useContext(Context)[id]||{rows:[],complete:false,error:'',checked:null};

export const useCollectionDirectory=id=>useContext(ListsContext)[id]||{rows:[],complete:false,error:'',checked:null};
