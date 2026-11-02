import React from 'react';
import {AudiencePicker} from './AutomationControls.jsx';

// Uses the same scoped draft contract and server authorization as Auto Messages.
export function MassAudience({draft,set,directory,lists}){
 const bulk=draft.bulk;
 const selected=bulk.audience==='all'?['__all']:bulk.listIds;
 return <><div className="am-include-heading"><span>✓</span><h3>Incluir fans</h3></div><p className="am-help">Los fans que coincidan con estas listas serán los destinatarios.</p>
 {bulk.audience==='selected'?<><AudiencePicker label="Fans seleccionados" rows={directory.rows} value={bulk.recipients} loading={!directory.complete} error={directory.error} onChange={recipients=>set('bulk',{...bulk,recipients})}/><button type="button" onClick={()=>set('bulk',{...bulk,audience:'collections',listIds:[]})}>Elegir listas de fans</button></>:<AudiencePicker label="Listas de fans a incluir" rows={lists.rows} allOption value={selected} loading={!lists.complete} error={lists.error} onChange={value=>set('bulk',{...bulk,audience:value.includes('__all')?'all':'collections',listIds:value.filter(id=>id!=='__all')})}/>}
 {bulk.audience==='all'&&<small className="am-help">{directory.complete?directory.rows.length+' perfiles sincronizados.':'Sincronizando el directorio completo…'} La selección incluye todos los fans; el proveedor determina quién puede recibir el mensaje.</small>}
 </>;
}
