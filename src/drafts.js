import {demoMedia} from './fanData.js';
export function draftFor(fan){const saved=fan.draft;return {text:typeof saved?.text==='string'?saved.text.slice(0,3000):'',attachment:demoMedia.find(m=>m.id===saved?.attachment?.id)||null};}
export function hasDraft(fan){const draft=draftFor(fan);return Boolean(draft.text||draft.attachment);}
export function updateDraft(state,creatorId,fanId,patch){return {...state,fans:state.fans.map(f=>{if(f.creatorId!==creatorId||f.id!==fanId)return f;const draft=draftFor({...f,draft:{...draftFor(f),...patch}});return {...f,draft:draft.text||draft.attachment?draft:null};})};}
// Append the local message and clear only its conversation's draft in one state update.
export function saveDraftMessage(state,creatorId,fanId){return {...state,fans:state.fans.map(f=>{if(f.creatorId!==creatorId||f.id!==fanId)return f;const draft=draftFor(f);if(!draft.text.trim()&&!draft.attachment)return f;return {...f,draft:null,messages:[...f.messages,{text:draft.text.trim(),mine:true,...(draft.attachment?{attachment:draft.attachment}:{})}]};})};}
