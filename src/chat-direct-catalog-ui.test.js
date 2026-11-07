import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const vite=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});
const {default:Catalog,CatalogPlanEditor,CommerceEvidence}=await vite.ssrLoadModule('/src/components/ChatDirectCatalog.jsx');
after(()=>vite.close());
const actor='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333';
const context={actor,workspace,account,fanId:'99',canRead:true,canInsert:false};
let requests=0;const source={read(){requests++;throw Error('No read during rendering')},sync(){requests++;throw Error('No sync during rendering')}};
const render=patch=>renderToStaticMarkup(React.createElement(Catalog,{actor,workspace,context:{...context,...patch},source}));
test('catalog is available to a read-only conversation without a composer, media requests or preparation actions',()=>{const html=render();for(const label of ['Catálogo y seguimiento','SEGUIMIENTO PRIVADO · SIN ENVÍOS','Actualizar recientes','Ampliar historial · 1 página','no activan guiones ni modifican el chat'])assert.ok(html.includes(label),label);assert.ok(!html.includes('Confirmar'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<video'));assert.equal(requests,0)});
test('missing read permissions or mismatched identity shows only an authorization gate, never a previous catalog',()=>{for(const patch of [{canRead:false},{actor:account},{workspace:account},{fanId:null}]){const html=render(patch);assert.ok(html.includes('Abre una conversación autorizada'));assert.ok(!html.includes('Actualizar recientes'));assert.ok(!html.includes('Carpeta'));assert.equal(requests,0)}});

const folder={id:'folder',name:'Script de QA',orderConfirmed:false,items:[{id:'101',type:'video',label:'V01',durationLabel:'1:30',referencePriceCents:600,configuredPriceCents:null},{id:'102',type:'photo',label:'F01',durationLabel:null,referencePriceCents:0,configuredPriceCents:null}]};
test('owner plan editor starts with an explicitly unapproved proposal and cannot save without checking review',()=>{
 const html=renderToStaticMarkup(React.createElement(CatalogPlanEditor,{folder,onSave(){requests++;throw Error('No save during rendering')}}));
 assert.ok(html.includes('Orden y precios del guion'));assert.ok(html.includes('Pendiente de revisión'));assert.ok(html.indexOf('<strong>F01</strong>')<html.indexOf('<strong>V01</strong>'));assert.ok(!html.includes('checked=""'));assert.match(html,/<button type="submit" disabled="">Guardar orden y precios revisados<\/button>/u);assert.ok(html.includes('No ejecuta el guion ni envía mensajes'));assert.equal(requests,0);
});
test('an approved plan displays its saved order and version, rather than automatically reapplying the photo-first proposal',()=>{
 const plan={folderId:'folder',version:2,planHash:'a'.repeat(64),approvedAt:'2026-11-07T12:00:00Z',steps:[{mediaId:'101',priceCents:1850},{mediaId:'102',priceCents:0}]},html=renderToStaticMarkup(React.createElement(CatalogPlanEditor,{folder,plan,onSave(){requests++;throw Error('No save')}}));assert.ok(html.includes('Versión 2'));assert.ok(html.indexOf('<strong>V01</strong>')<html.indexOf('<strong>F01</strong>'));assert.ok(html.includes('value="18.5"'));assert.equal(requests,0);
});
test('bundle evidence renders a reported unlock without pretending to know payment amount/date, and a purchase event once for both files',()=>{
 const common={messageId:'500',mediaIds:['101','102'],offerPriceCents:1850,observedAt:'2026-11-07T12:00:00Z'},unlock={...common,id:'a'.repeat(64),kind:'paid_unlock_reported',paidAmountCents:null,paidAt:null,eventId:null},purchase={...common,id:'b'.repeat(64),kind:'ppv_purchase_event',paidAmountCents:1850,paidAt:'2026-11-07T11:00:00Z',eventId:'44444444-4444-4444-8444-444444444444'};
 const renderEvidence=evidence=>renderToStaticMarkup(React.createElement(CommerceEvidence,{folder,commerce:{evidence,refundStatus:'unknown'}})),reported=renderEvidence([unlock]),paid=renderEvidence([purchase,purchase]);assert.ok(reported.includes('Desbloqueo PPV reportado'));assert.ok(reported.includes('Importe y fecha de pago no informados'));assert.ok(!reported.includes('Fecha de pago:'));assert.equal((paid.match(/Importe del evento/g)||[]).length,1);assert.equal((paid.match(/Fecha de pago:/g)||[]).length,1);assert.ok(paid.includes('F01'));assert.ok(paid.includes('V01'));assert.ok(paid.includes('Devoluciones sin comprobar'));assert.equal(requests,0);
});
