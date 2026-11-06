import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';

// SSR cannot mount portals. Only the portal transport is replaced in this test;
// the actual panel, validators, labels and disabled states remain unchanged.
const vite=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',plugins:[{name:'ssr-panel-portal-only',enforce:'pre',transform(code,id){if(id.split('?')[0].endsWith('/src/components/ChatDirectPanel.jsx'))return code.replace("import {createPortal} from 'react-dom';",'const createPortal=children=>children;')}}]});
const {authClient}=await vite.ssrLoadModule('/src/auth.js');let requests=0;
authClient.rpc=()=>{requests++;throw Error('No RPC is allowed during static UI verification')};authClient.functions.invoke=()=>{requests++;throw Error('No provider call is allowed during static UI verification')};
const {default:Panel}=await vite.ssrLoadModule('/src/components/ChatDirectPanel.jsx'),{default:Knowledge}=await vite.ssrLoadModule('/src/components/ChatDirectKnowledge.jsx'),{default:ModelKnowledge}=await vite.ssrLoadModule('/src/components/ChatDirectModelKnowledge.jsx');
const previousWindow=globalThis.window,previousDocument=globalThis.document;
globalThis.window={innerWidth:1280,innerHeight:900};globalThis.document={body:{}};
after(async()=>{await vite.close();if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument});
const actor='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333',generation='44444444-4444-4444-8444-444444444444',example='55555555-5555-4555-8555-555555555555';
const draft=patch=>({id:'gen.'+generation+'.1',english:'Good morning! How is your day?',spanish:'¡Buenos días! ¿Cómo va tu día?',variables:[],aiGenerated:true,aiVerified:false,generationId:generation,exampleIds:[example],knowledgeIds:[],expiresAt:new Date(Date.now()+600000).toISOString(),source:{kind:'generated',modelId:account,verified:false,label:'Borrador IA · Revisión humana',version:'a'.repeat(32)},...patch});
const literal={id:example,english:'Hello! How is your morning?',spanish:'¡Hola! ¿Cómo va tu mañana?',variables:[],source:{kind:'document',modelId:account,verified:true,label:'Fuente documental de QA',referenceId:'qa-morning',version:'v1.r1'}};
function render({candidates=[],selected=null,knowledge=null,canManage=true,input='',messages=[{id:'1',text:'Good morning',isFromMe:false,createdAt:'2026-11-06T10:00:00Z'}]}={}){
 const context={scope:JSON.stringify([actor,workspace,account,'99']),revision:'context',actor,workspace,account,fanId:'99',modelName:'Modelo de QA',fanName:'Fan de QA',canRead:true,canInsert:true,canVault:false,messages,historyComplete:false},entry={candidates,selectedId:selected,insertToken:'manual-choice',values:{},input,knowledge,busy:false,inserted:false};
 return renderToStaticMarkup(React.createElement(Panel,{context,entry,canManage,actor,workspace,sourceAvailable:true,captureEnabled:false,focusRequest:0,onFrame(){},onClose(){},onInput(){},onValue(){},onSelect(){},onConsult(){throw Error('Static render must not consult')},onInsert(){throw Error('Static render must not insert')},setCaptureEnabled(){}}));
}

test('generated cards disclose new AI prose, actual reference IDs and missing facts without a verified-literal badge',()=>{
 const candidate=draft(),html=render({candidates:[candidate],selected:candidate.id,knowledge:{engine:'generative',engineInvoked:true,status:'connected',approvedCount:1,unknowns:['Edad sin confirmar']}});
 for(const text of ['IA generativa consultada','Borrador IA · Revisar','ENGLISH · BORRADOR IA','ESPAÑOL · TRADUCCIÓN IA','Fuentes utilizadas y trazabilidad',generation,example,'Datos sin confirmar','Edad sin confirmar'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('class="chat-direct-verified"'));assert.ok(!html.includes('Verificada · v'));assert.ok(html.includes('no acreditan que esta respuesta sea una cita literal'));assert.ok(html.includes('CREAR BORRADORES IA'));
});

test('literal bank cards retain their original English, Spanish and verified documentary reference',()=>{
 const html=render({candidates:[literal],selected:literal.id,knowledge:{engine:'bank',engineInvoked:false,status:'connected',approvedCount:1}});for(const text of ['Verificada · vv1.r1',literal.english,literal.spanish,'Referencia del ejemplo','Fuente documental de QA · qa-morning'])assert.ok(html.includes(text),text);assert.ok(!html.includes('class="chat-direct-generated"'));
});

test('expired generated suggestions cannot be copied or confirmed and show their real validation warning',()=>{
 const candidate=draft({expiresAt:new Date(Date.now()-1000).toISOString()}),html=render({candidates:[candidate],selected:candidate.id,knowledge:{engine:'generative',engineInvoked:true,status:'connected',approvedCount:1,unknowns:[]}});assert.ok(html.includes('Este borrador ha caducado'));assert.match(html,/disabled=""[^>]*>Copiar inglés/u);assert.match(html,/disabled=""[^>]*>Confirmar ✓/u);
});

test('the contextual action can use an existing confirmed incoming message, but cannot use a pending message as evidence',()=>{
 const button=html=>html.match(/<button[^>]*class="chat-direct-primary chat-direct-consult"[^>]*>/u)?.[0];
 assert.ok(!button(render()).includes('disabled'));
 assert.ok(button(render({messages:[{id:'1',text:'Pending',isFromMe:false,delivery:'checking'}]})).includes('disabled'));
 assert.ok(button(render({messages:[{id:'1',text:'Own only',isFromMe:true}]})).includes('disabled'));
});

test('latest incoming preview follows real dates and numeric IDs, keeps manual input empty and ignores pending or outgoing messages',()=>{
 const html=render({messages:[{id:'10',text:'Latest by numeric ID',isFromMe:false,createdAt:'2026-11-06T12:00:00Z'},{id:'9',text:'Same time older ID',isFromMe:false,createdAt:'2026-11-06T12:00:00Z'},{id:'50',text:'New pending',isFromMe:false,createdAt:'2026-11-06T13:00:00Z',delivery:'sending'},{id:'60',text:'Own newest',isFromMe:true,createdAt:'2026-11-06T14:00:00Z'},{id:'99',text:'Older at end of array',isFromMe:false,createdAt:'2026-11-06T11:00:00Z'}]});
 assert.match(html,/aria-label="Último mensaje recibido"[^>]*><small>Último mensaje recibido<\/small><p>Latest by numeric ID<\/p>/u);assert.ok(!html.includes('<p>Older at end of array</p>'));assert.match(html,/<textarea[^>]*><\/textarea>/u);assert.equal(requests,0);
});

test('owner curation is absent from the worker panel, and the knowledge hub keeps the three owner sections separate',()=>{
 assert.ok(render().includes('>Base de ejemplos</button>'));assert.ok(!render({canManage:false}).includes('>Base de ejemplos</button>'));
 const html=renderToStaticMarkup(React.createElement(Knowledge,{actor,workspace,account}));for(const label of ['>Ejemplos</button>','>Modelo</button>','>Generación</button>'])assert.ok(html.includes(label));assert.ok(!html.includes('<form'));
});

test('initial model knowledge has no fabricated personal data and generation has no assumed server state',()=>{
 const props={actor,workspace,account},knowledge=renderToStaticMarkup(React.createElement(ModelKnowledge,props)),settings=renderToStaticMarkup(React.createElement(ModelKnowledge,{...props,mode:'generation'}));
 assert.equal((knowledge.match(/Sin verificar/gu)||[]).length,6);assert.ok(!knowledge.includes('<form'));assert.ok(!settings.includes('Estado guardado'));assert.ok(!settings.includes('<form'));assert.ok(settings.includes('Cada respuesta requiere revisión humana'));assert.equal(requests,0);
});
