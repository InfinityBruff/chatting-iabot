export function createUnsavedRegistry(){
 const entries=new Map();
 return {set(key,label,dirty){if(dirty)entries.set(key,label);else entries.delete(key)},remove(key){entries.delete(key)},labels(){return [...new Set(entries.values())]},hasChanges(){return entries.size>0}};
}
export function sameFields(a,b,keys){return keys.every(key=>(a?.[key]??'')===(b?.[key]??''));}
// Editors contain JSON-compatible local records. Null means no open editor.
export function editorChanged(draft,baseline){return draft!==null&&JSON.stringify(draft)!==JSON.stringify(baseline);}
