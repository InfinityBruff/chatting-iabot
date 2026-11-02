import React,{createContext,useContext,useEffect,useState} from 'react';
import {createFanDirectory} from '../fan-directory.js';
import {liveRequest} from './LiveWorkspace.jsx';
const Context=createContext({});
const ListsContext=createContext({});
export function FanDirectory({user,workspace,accounts,role,children}){
 const ids=['owner','admin'].includes(role)?accounts.filter(a=>a.chat).map(a=>a.id).sort():[];
 const scope=JSON.stringify([user,workspace,ids]),[state,setState]=useState({scope:'',models:{}}),[lists,setLists]=useState({scope:'',models:{}});
 useEffect(()=>{const directory=createFanDirectory({request:liveRequest,workspace,ids,publish:models=>setState({scope,models})});const groups=createFanDirectory({request:liveRequest,workspace,ids,operation:'collections',field:'lists',publish:models=>setLists({scope,models})});return()=>{directory.stop();groups.stop()}},[scope]);
 return <Context.Provider value={state.scope===scope?state.models:{}}><ListsContext.Provider value={lists.scope===scope?lists.models:{}}>{children}</ListsContext.Provider></Context.Provider>;
}
export const useFanDirectory=id=>useContext(Context)[id]||{rows:[],complete:false,error:'',checked:null};

export const useCollectionDirectory=id=>useContext(ListsContext)[id]||{rows:[],complete:false,error:'',checked:null};
