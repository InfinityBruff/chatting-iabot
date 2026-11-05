const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>=1&&value<=16384;
export function vaultDialogStorageKey(scope){
 try{
  if(typeof scope!=='string'||!scope.startsWith('bruff-ui:'))return null;
  const parts=JSON.parse(scope.slice('bruff-ui:'.length));if(!Array.isArray(parts))return null;const [actor,workspace]=parts;
  return typeof actor==='string'&&actor&&typeof workspace==='string'&&workspace?'bruff-vault-dialog-size:'+JSON.stringify([actor,workspace]):null;
 }catch{return null}
}
export function validVaultDialogSize(value){
 return value&&typeof value==='object'&&!Array.isArray(value)&&positive(value.width)&&positive(value.height)?{width:Math.round(value.width),height:Math.round(value.height)}:null;
}
export function vaultDialogBounds(viewport){
 const width=positive(viewport?.width)?viewport.width:1024,height=positive(viewport?.height)?viewport.height:768,mobile=width<=640,margin=mobile?16:32;
 const maxWidth=Math.max(1,Math.floor(width-margin)),maxHeight=Math.max(1,Math.floor(height-margin));
 return {mobile,minWidth:Math.min(mobile?320:640,maxWidth),minHeight:Math.min(mobile?420:460,maxHeight),maxWidth,maxHeight,defaultWidth:mobile?maxWidth:Math.min(maxWidth,Math.max(720,Math.round(width*.25))),defaultHeight:mobile?maxHeight:Math.min(maxHeight,Math.max(520,Math.round(height*.25)))};
}
export function clampVaultDialogSize(size,bounds){
 const requested=typeof size?.width==='number'&&Number.isFinite(size.width)&&typeof size?.height==='number'&&Number.isFinite(size.height)?size:{width:bounds.defaultWidth,height:bounds.defaultHeight};
 return {width:Math.round(Math.max(bounds.minWidth,Math.min(bounds.maxWidth,requested.width))),height:Math.round(Math.max(bounds.minHeight,Math.min(bounds.maxHeight,requested.height)))};
}
export function resizeVaultDialogByKey(size,key,bounds,large=false){
 const step=large?40:10;
 if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key))return null;
 return clampVaultDialogSize({width:size.width+(key==='ArrowRight'?step:key==='ArrowLeft'?-step:0),height:size.height+(key==='ArrowDown'?step:key==='ArrowUp'?-step:0)},bounds);
}
export function resizeVaultDialogFromPointer(size,dx,dy,bounds){
 // The native frame stays centered: its right/bottom edge moves by half the
 // size change, so doubling the delta keeps the captured corner under the pointer.
 return clampVaultDialogSize({width:size.width+dx*2,height:size.height+dy*2},bounds);
}
export function readVaultDialogSize(storage,scope){
 const key=vaultDialogStorageKey(scope);if(!key||!storage)return null;
 try{const saved=JSON.parse(storage.getItem(key)||'null');return saved?.version===1?validVaultDialogSize(saved):null}catch{return null}
}
export function writeVaultDialogSize(storage,scope,size){
 const key=vaultDialogStorageKey(scope),valid=validVaultDialogSize(size);if(!key||!storage||!valid)return false;
 try{storage.setItem(key,JSON.stringify({version:1,...valid}));return true}catch{return false}
}
export function resetVaultDialogSize(storage,scope){
 const key=vaultDialogStorageKey(scope);if(!key||!storage)return false;
 try{storage.removeItem(key);return true}catch{return false}
}
