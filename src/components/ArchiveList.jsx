import React from 'react';
import {archivedFor} from '../archive.js';
export default function ArchiveList({state,kind,creatorId,onRestore}){
 const items=archivedFor(state,kind,creatorId),title=kind==='templates'?'Plantillas archivadas':'Campañas archivadas';
 return <details className="archive-panel"><summary>{title} <span>{items.length}</span></summary><p className="fine-print">Solo esta cuenta. Restaurar devuelve el contenido a su lista; no envía mensajes.</p>{items.length?items.map(item=>{const conflict=(state[kind]||[]).some(v=>v.id===item.id&&v.creatorId===creatorId);return <article className="archive-row" key={item.id}><div><strong>{item.title||item.name}</strong><p>{item.text}</p>{kind==='campaigns'&&<small>{item.recipientIds?.length||0} destinatarios guardados · Borrador sin enviar</small>}{conflict&&<p className="fine-print">Ya existe un elemento activo con este identificador. Se conservan ambas versiones.</p>}</div><button type="button" className="secondary" disabled={conflict} onClick={()=>onRestore(item.id)}>Restaurar</button></article>}):<p className="fine-print">Nada archivado en esta cuenta.</p>}</details>;
}
