import React,{useState} from 'react';
import {isFanOnline} from '../fan-presence.js';
import './fan-avatar.css';
export default function FanAvatar({fan,now,online:onlineOverride,className='live-avatar'}){
 const [failed,setFailed]=useState('');
 const name=fan.name||fan.username||'Fan';
 const initials=name.split(/\s+/).slice(0,2).map(s=>Array.from(s)[0]).join('').toUpperCase();
 const src=typeof fan.avatar==='string'&&fan.avatar.startsWith('https://')?fan.avatar:null;
 const online=typeof onlineOverride==='boolean'?onlineOverride:isFanOnline(fan,now);
 return <span className={`${className} fan-photo-avatar ${online?'fan-online-ring':''}`}>
  {src&&failed!==src?<img key={src} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(src)}/>:initials}
  {online&&<i className="fan-online-dot" aria-label="En línea" title="En línea · Confirmado hace menos de un minuto"/>}
 </span>;
}
