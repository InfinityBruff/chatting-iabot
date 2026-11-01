import test from 'node:test';
import assert from 'node:assert/strict';
import {messageAttribution} from './message-attribution.js';
test('message authors distinguish BRUFF, unattributed outgoing messages and failed lookups',()=>{
 assert.equal(messageAttribution({isFromMe:true,sentBy:'Pedro',attributionAvailable:true}),'Enviado por: Pedro');
 assert.equal(messageAttribution({isFromMe:true,sentBy:null,attributionAvailable:true}),'by: onlyfans');
 assert.equal(messageAttribution({isFromMe:true,sentBy:null,attributionAvailable:false}),'Autoría no disponible');
 assert.equal(messageAttribution({isFromMe:false,sentBy:'Pedro',attributionAvailable:true}),'');
});
