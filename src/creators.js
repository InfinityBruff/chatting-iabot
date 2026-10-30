import {profileFor} from './fanData.js';
export const creators = [
  {id:'luna',name:'Luna',handle:'luna.demo'},
  {id:'valeria',name:'Valeria',handle:'valeria.demo'}
];
const extraFans = [
  {id:101,creatorId:'valeria',name:'Hugo',tag:'Conversación nueva',on:false,messages:[{text:'¡Hola Valeria! Acabo de suscribirme.',mine:false}]},
  {id:102,creatorId:'valeria',name:'Pablo',tag:'Seguimiento',on:true,messages:[{text:'Gracias por la bienvenida, Valeria.',mine:false}]}
];
export function scopeState(state) {
  const fans=state.fans.map(f=>({...f,creatorId:f.creatorId||'luna'}));
  if (!state.creatorSchema) for (const fan of extraFans) if (!fans.some(f=>f.creatorId===fan.creatorId&&f.id===fan.id)) fans.push(structuredClone(fan));
  return {...state,creatorSchema:1,activeCreatorId:creators.some(c=>c.id===state.activeCreatorId)?state.activeCreatorId:'luna',fans,campaigns:(state.campaigns||[]).map(c=>({...c,creatorId:c.creatorId||'luna'}))};
}
export function fansFor(state,creatorId=state.activeCreatorId){return state.fans.filter(f=>f.creatorId===creatorId)}

export function markFanRead(state,creatorId,fanId){return {...state,fans:state.fans.map(f=>f.creatorId===creatorId&&f.id===fanId?{...f,profile:{...profileFor(f),unread:0}}:f)};}
