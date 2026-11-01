import React,{createContext,useContext,useEffect,useState} from 'react';
import {createFanDirectory} from '../fan-directory.js';
import {liveRequest} from './LiveWorkspace.jsx';
const Context=createContext({});
export function FanDirectory({user,workspace,accounts,role,children}){
 const ids=['owner','admin'].includes(role)?accounts.filter(a=>a.chat).map(a=>a.id).sort():[];
 const scope=JSON.stringify([user,workspace,ids]),[state,setState]=useState({scope:'',models:{}});
 useEffect(()=>{const directory=createFanDirectory({request:liveRequest,workspace,ids,publish:models=>setState({scope,models})});return()=>directory.stop()},[scope]);
 return <Context.Provider value={state.scope===scope?state.models:{}}>{children}</Context.Provider>;
}
export const useFanDirectory=id=>useContext(Context)[id]||{rows:[],complete:false,error:'',checked:null};
