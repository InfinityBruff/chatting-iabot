import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {transformWithOxc} from 'vite';
import {composerAttachmentDetails,attachmentScrollState} from './composer-attachments.js';
const source=await readFile(new URL('./components/ComposerAttachments.jsx',import.meta.url),'utf8');
const transformed=await transformWithOxc(source,'ComposerAttachments.jsx',{lang:'jsx',jsx:{runtime:'classic'}});
function render(items,disabled=false){
 const previews=[],buttons=[],removed=[],viewReact={...React,createElement:(type,props,...children)=>{if(type==='button')buttons.push(props);return React.createElement(type,props,...children)}};
 const code=transformed.code.replace(/^import .*;\n/gm,'').replace('export default function ComposerAttachments','function ComposerAttachments');
 const Component=new Function('React','useEffect','useId','useLayoutEffect','useRef','useState','MediaImage','ChatIcon','composerAttachmentDetails','attachmentScrollState',code+'\nreturn ComposerAttachments;')(viewReact,React.useEffect,React.useId,React.useLayoutEffect,React.useRef,React.useState,props=>{previews.push(props);return React.createElement('span',{'data-mock-preview':true})},()=>React.createElement('svg',{'aria-hidden':true}),composerAttachmentDetails,attachmentScrollState);
 return {html:renderToStaticMarkup(React.createElement(Component,{items,disabled,onRemove:item=>removed.push(item)})),previews,buttons,removed};
}
test('actual strip renders ten uniform cards with only two eager previews and no players or opaque draft values',()=>{
 const items=Array.from({length:10},(_,index)=>({id:String(index),name:'Archivo '+index,token:'DO_NOT_RENDER',media:{type:['photo','video','audio','gif'][index%4],duration:75,url:'DO_NOT_RENDER_URL'}}));
 const {html,previews,buttons,removed}=render(items);assert.equal((html.match(/role="listitem"/g)||[]).length,10);assert.equal(previews.length,10);assert.equal(previews.filter(props=>props.eager).length,2);assert.ok(previews.every((props,index)=>props.item===items[index].media));assert.equal(/DO_NOT_RENDER|<video|<audio|autoplay/.test(html),false);assert.match(html,/Ver adjuntos siguientes/);assert.match(html,/tabindex="0"/);buttons.find(button=>button['aria-label']==='Quitar Archivo 3').onClick();assert.equal(removed[0],items[3]);
});
test('actual strip disables each removal during review while retaining navigation controls and empty drafts add no UI',()=>{
 const items=[{name:'Vídeo seleccionado',media:{type:'video',duration:65}},{name:'Audio seleccionado',media:{type:'audio',duration:12}}],view=render(items,true),{html}=view;
 const buttons=[...html.matchAll(/<button[^>]*>/g)].map(match=>match[0]),remove=buttons.filter(button=>button.includes('Quitar '));assert.equal(remove.length,2);assert.ok(remove.every(button=>button.includes('disabled=""')));assert.equal(buttons.filter(button=>button.includes('Ver adjuntos ')).length,2);view.buttons.find(button=>button['aria-label']==='Quitar Vídeo seleccionado').onClick();assert.deepEqual(view.removed,[]);assert.match(html,/duración 1:05/);assert.match(html,/duración 0:12/);assert.equal(render([]).html,'');
});
