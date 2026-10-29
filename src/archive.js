const collections={templates:'archivedTemplates',campaigns:'archivedCampaigns'};
export function archivedFor(state,kind,creatorId){const key=collections[kind];return key?(state[key]||[]).filter(item=>item&&item.creatorId===creatorId):[];}
export function moveArchive(state,kind,creatorId,id,restore=false){
 const archived=collections[kind];if(!archived)return state;
 const from=restore?archived:kind,to=restore?kind:archived;
 const source=state[from]||[],destination=state[to]||[];
 const match=item=>item&&item.id===id&&item.creatorId===creatorId;
 const item=source.find(match);
 // Keep both versions intact when an active record already uses this identity.
 if(!item||destination.some(match))return state;
 return {...state,[from]:source.filter(v=>!match(v)),[to]:[item,...destination]};
}
