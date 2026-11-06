const finite=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
export function fitChatDirectWindow(box={},viewport={}){
 const left=finite(viewport.left,0),top=finite(viewport.top,0),vw=Math.max(1,finite(viewport.width,1024)),vh=Math.max(1,finite(viewport.height,768));
 const margin=Math.min(12,vw/8,vh/8),maxWidth=Math.max(1,vw-margin*2),maxHeight=Math.max(1,vh-margin*2);
 const width=Math.min(maxWidth,Math.max(Math.min(340,maxWidth),finite(box.width,440))),height=Math.min(maxHeight,Math.max(Math.min(360,maxHeight),finite(box.height,620)));
 const x=Math.max(left+margin,Math.min(finite(box.x,left+(vw-width)/2),left+vw-margin-width)),y=Math.max(top+margin,Math.min(finite(box.y,top+(vh-height)/2),top+vh-margin-height));
 return {x,y,width,height};
}
export function changeChatDirectWindow(box,{dx=0,dy=0,resize=false}={},viewport){
 return fitChatDirectWindow(resize?{...box,width:box.width+finite(dx,0),height:box.height+finite(dy,0)}:{...box,x:box.x+finite(dx,0),y:box.y+finite(dy,0)},viewport);
}
