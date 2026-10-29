import {scopeState} from './creators.js';
import { defaults, validateConfig } from './policy.js';
const key='iabot-v1';
const seedFans=[
  {id:1,name:'Alex',tag:'Conversación nueva',on:true,messages:[{text:'¡Hola! ¿Qué tal va tu día?',mine:false},{text:'¡Hola Alex! Muy bien, ¿y el tuyo?',mine:true}]},
  {id:2,name:'Daniel',tag:'Pendiente de respuesta',on:false,messages:[{text:'Hola, ¿tienes un momento?',mine:false}]},
  {id:3,name:'Marcos',tag:'Conversación en curso',on:true,messages:[{text:'Hoy por fin he terminado el proyecto que te conté.',mine:false}]},
  {id:4,name:'Lucas',tag:'Seguimiento',on:false,messages:[{text:'¡Gracias por acordarte!',mine:false}]}
];
export function loadState() {
  const fresh=scopeState({config:{...defaults},fans:structuredClone(seedFans)});
  try {
    const saved=JSON.parse(localStorage.getItem(key));
    if (!saved) return fresh;
    const config={...defaults,...saved.config};
    if (validateConfig(config)) return fresh;
    for (const name of ['tone','instructions','words','avoid']) if (typeof config[name] !== 'string') return fresh;
    if (typeof config.video !== 'boolean') return fresh;
    if (!Array.isArray(saved.fans) || !saved.fans.length) return fresh;
    const ids=new Set();
    for (const fan of saved.fans) {
      if (!Number.isInteger(fan.id)||ids.has(fan.id)||typeof fan.name!=='string'||typeof fan.tag!=='string'||typeof fan.on!=='boolean'||!Array.isArray(fan.messages)) return fresh;
      ids.add(fan.id);
      if (fan.messages.some(m => !m || typeof m.text!=='string'||typeof m.mine!=='boolean')) return fresh;
    }
    return scopeState({...saved,config,fans:saved.fans,campaigns:Array.isArray(saved.campaigns)?saved.campaigns.filter(c=>c&&typeof c.name==='string'&&typeof c.text==='string'&&Array.isArray(c.recipientIds)&&typeof c.createdAt==='string'):[]});
  } catch { return fresh; }
}
export function saveState(state) { localStorage.setItem(key,JSON.stringify(state)); }
