import React,{useEffect,useRef,useState} from 'react';
import ConversationList from './components/ConversationList.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import AssistantSettings from './components/AssistantSettings.jsx';
import {canAssist} from './policy.js';
import {loadState,saveState} from './storage.js';
export default function App() {
  const [state,setState]=useState(loadState);
  const [view,setView]=useState('inbox');
  const [current,setCurrent]=useState(state.fans[0].id);
  const [notice,setNotice]=useState('');
  const timeout=useRef();
  const {fans,config}=state;
  const fan=fans.find(f=>f.id===current)||fans[0];
  useEffect(()=>()=>clearTimeout(timeout.current),[]);
  function toast(message){setNotice(message);clearTimeout(timeout.current);timeout.current=setTimeout(()=>setNotice(''),4000)}
  function commit(next,message){setState(next);try{saveState(next);if(message)toast(message)}catch{toast('Los cambios están en memoria; no se pudieron guardar en este navegador.')}}
  function toggle(ids,on){commit({...state,fans:fans.map(f=>ids.includes(f.id)?{...f,on}:f)},'Selección del asistente actualizada')}
  function message(id,text){commit({...state,fans:fans.map(f=>f.id===id?{...f,messages:[...f.messages,{text,mine:true}]}:f)})}
  return <div className="shell"><nav><div className="brand">◈ Chatting<span> IA</span></div><button className={view==='inbox'?'active':''} onClick={()=>setView('inbox')}>▤ &nbsp; Conversaciones</button><button className={view==='settings'?'active':''} onClick={()=>setView('settings')}>⚙ &nbsp; Mi asistente</button><small>ESPACIO DE TRABAJO<br/>Proyecto IABOT<br/><span className="badge">React · Versión 0.2</span></small></nav>
    <main><header><div><h1>{view==='inbox'?'Conversaciones':'Mi asistente'}</h1><p>{view==='inbox'?'Tu equipo y tu asistente, en un mismo lugar.':'Define cómo escribe, a quién atiende y cuándo responde.'}</p></div><span className="badge">Datos de ejemplo</span></header>
      {view==='inbox'?<><div className="stats"><div className="stat"><p>Conversaciones</p><strong>{fans.length}</strong></div><div className="stat"><p>Asistente habilitado</p><strong>{fans.filter(f=>canAssist(config,f)).length}<span style={{fontSize:13,color:'#9293a5'}}> / {fans.length}</span></strong></div><div className="stat"><p>Modo actual</p><strong style={{fontSize:21}}>{{all:'Todos los fans',selected:'Selección manual',off:'Pausado'}[config.mode]}</strong></div></div><section className="panel workspace"><ConversationList fans={fans} config={config} current={current} onSelect={setCurrent} onBulk={toggle}/><ChatPanel key={fan.id} fan={fan} config={config} onToggle={(id,on)=>toggle([id],on)} onMessage={message}/></section></>:<AssistantSettings config={config} onSave={config=>commit({...state,config},'Configuración guardada')}/>}
      <footer>Entorno de prueba · Sin conexión a cuentas ni envíos reales · Configuración guardada en este navegador</footer>
    </main><div className="toast" role="status" style={{display:notice?'block':'none'}}>{notice}</div>
  </div>;
}
