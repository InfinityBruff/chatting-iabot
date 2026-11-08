import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const vite=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});
after(()=>vite.close());
const {authClient}=await vite.ssrLoadModule('/src/auth.js');let requests=0;
authClient.rpc=()=>{requests++;throw Error('No RPC in evidence rendering')};authClient.functions.invoke=()=>{requests++;throw Error('No provider read in evidence rendering')};
const {FanMemoryEvidence}=await vite.ssrLoadModule('/src/components/ChatDirectFanMemory.jsx');
const item=()=>({origin:'analysis',source:{messageId:'201',quote:'Canada',at:'2026-11-08T00:01:00Z',author:'fan',question:{messageId:'200',quote:'Where are you from?',at:'2026-11-08T00:00:00Z',author:'model',kind:'where_from'}}});
test('actual memory evidence shows compact question and literal reply with separate attribution and geographic uncertainty',()=>{
 const value=item(),html=renderToStaticMarkup(React.createElement(FanMemoryEvidence,{item:value}));for(const text of ['Ver pregunta y respuesta','Pregunta de la cuenta','Where are you from?','Respuesta del fan','Canada','Mensaje 200','Mensaje 201','no confirma residencia actual o permanente ni nacionalidad'])assert.ok(html.includes(text),text);assert.equal((html.match(/<blockquote>/gu)||[]).length,2);assert.ok(!html.includes('open='));assert.equal(requests,0);
});
test('old memories keep their original evidence rendering without a fabricated question or geography warning',()=>{
 const value=item();delete value.source.question;const html=renderToStaticMarkup(React.createElement(FanMemoryEvidence,{item:value}));assert.ok(html.includes('Ver procedencia'));assert.ok(html.includes('Declaración del fan'));assert.ok(!html.includes('Pregunta de la cuenta'));assert.ok(!html.includes('residencia'));assert.equal((html.match(/<blockquote>/gu)||[]).length,1);assert.equal(requests,0);
});
