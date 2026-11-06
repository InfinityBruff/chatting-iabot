import test from 'node:test';import assert from 'node:assert/strict';
import {fitChatDirectWindow,changeChatDirectWindow} from './chat-direct-window.js';
test('chat direct window starts centered, compact and inside the desktop viewport',()=>{
 assert.deepEqual(fitChatDirectWindow({}, {width:1200,height:900}),{x:380,y:140,width:440,height:620});
});
test('mobile and virtual keyboard keep the whole panel in the visible viewport',()=>{
 const box=fitChatDirectWindow({x:900,y:700,width:600,height:800},{left:8,top:140,width:390,height:280});
 assert.deepEqual(box,{x:20,y:152,width:366,height:256});
 const tiny=fitChatDirectWindow({}, {width:80,height:50});assert.ok(tiny.width<=80&&tiny.height<=50&&tiny.x>=0&&tiny.y>=0);
});
test('pointer or keyboard changes clamp independently without mutating the stored frame',()=>{
 const frame={x:50,y:60,width:440,height:620},viewport={width:1000,height:900};
 assert.deepEqual(changeChatDirectWindow(frame,{dx:-1000,dy:1000},viewport),{x:12,y:268,width:440,height:620});
 assert.deepEqual(changeChatDirectWindow(frame,{dx:-999,dy:-999,resize:true},viewport),{x:50,y:60,width:340,height:360});
 assert.deepEqual(frame,{x:50,y:60,width:440,height:620});
});
test('malformed geometry never creates an offscreen or nonfinite window',()=>{
 const box=fitChatDirectWindow({x:NaN,y:Infinity,width:'large',height:-3},{width:390,height:844});
 assert.deepEqual(box,{x:12,y:242,width:366,height:360});
});
