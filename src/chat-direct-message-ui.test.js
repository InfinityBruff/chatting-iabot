import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';

const source=await readFile(new URL('./components/ChatMessageBubble.jsx',import.meta.url),'utf8');
const transformed=await transformWithOxc(source,'ChatMessageBubble.jsx',{lang:'jsx',jsx:{runtime:'classic'}});
const code=transformed.code.replace(/^import .*;\n/gm,'').replace('export default memo(ChatMessageBubble);','');

function render(props){
 const elements=[];
 const trackedReact={...React,createElement:(type,attributes,...children)=>{elements.push({type,attributes});return React.createElement(type,attributes,...children)}};
 const Component=new Function('React','memo','useEffect','useId','useLayoutEffect','useRef','useState','createPortal','MediaPreview','ChatIcon','messageAttribution','restoreReply',code+'\nreturn ChatMessageBubble;')(
  trackedReact,React.memo,React.useEffect,React.useId,React.useLayoutEffect,React.useRef,React.useState,()=>null,()=>null,()=>React.createElement('svg',{'aria-hidden':true}),()=>'',()=>null);
 const html=renderToStaticMarkup(React.createElement(Component,props));
 return {html,elements,article:elements.find(item=>item.type==='article')?.attributes};
}
const incoming={id:'11',text:'How has your day been?',isFromMe:false,createdAt:'2026-11-06T12:00:00Z'};

test('actual incoming bubble captures text only in direct mode and double click cannot toggle a like',()=>{
 const selected=[],likes=[];
 const view=render({m:incoming,captureMode:true,captureSelected:true,onCapture:message=>selected.push(message),onLike:message=>likes.push(message),canLike:true});
 assert.match(view.html,/chat-direct-message-selected/);
 assert.match(view.html,/Analizar este mensaje en BRUFF IA/);
 const textEvent={target:{closest:()=>null}};
 view.article.onClick(textEvent);
 view.article.onDoubleClick(textEvent);
 assert.deepEqual(selected,[incoming]);
 assert.equal(likes.length,0);
 const controlEvent={target:{closest:()=>({tagName:'BUTTON'})}};
 view.article.onClick(controlEvent);
 assert.equal(selected.length,1);
});

test('outgoing, pending, empty and inactive bubbles never become assistant capture targets',()=>{
 for(const props of [
  {m:{...incoming,isFromMe:true},captureMode:true},
  {m:{...incoming,delivery:'checking'},captureMode:true},
  {m:{...incoming,text:'  '},captureMode:true},
  {m:incoming,captureMode:false}
 ]){
  const calls=[],view=render({...props,captureSelected:true,onCapture:message=>calls.push(message)});
  assert.doesNotMatch(view.html,/chat-direct-message-selected|chat-direct-message-capturable|Analizar este mensaje en BRUFF IA/);
  view.article.onClick({target:{closest:()=>null}});
  assert.equal(calls.length,0);
 }
});

test('keyboard capture button selects the original incoming record without sending or rewriting it',()=>{
 const original={...incoming,text:'Hello 👋\nHow are you?'},calls=[];
 const view=render({m:original,captureMode:true,onCapture:message=>calls.push(message)});
 const capture=view.elements.find(item=>item.type==='button'&&item.attributes['aria-label']==='Analizar este mensaje en BRUFF IA');
 assert.equal(capture.attributes.type,'button');
 assert.equal(capture.attributes['aria-pressed'],false);
 capture.attributes.onClick();
 assert.deepEqual(calls,[original]);
 assert.equal(calls[0].text,'Hello 👋\nHow are you?');
});
