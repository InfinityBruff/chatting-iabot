import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveDynamicName,personalizeMessage} from './dynamic-name.js';
const step={nameMode:'custom_fan',fallback:'Mi cielo',firstName:true,text:'Hola {nombre}, {nombre}'};
test('all four modes select only their ordered source',()=>{
 for(const [nameMode,source] of [['custom','custom'],['fan','fan'],['fan_custom','fan'],['custom_fan','custom']])assert.equal(resolveDynamicName({...step,nameMode},{fan:'John Smith',custom:'Johnny Bravo'}).source,source);
 assert.equal(resolveDynamicName({...step,nameMode:'custom'},{fan:'John'}).name,'Mi cielo');
 assert.equal(resolveDynamicName({...step,nameMode:'fan'},{custom:'Johnny'}).name,'Mi cielo');
 assert.equal(resolveDynamicName(step,{custom:'  ',fan:' John   Smith '}).name,'John');
 assert.equal(resolveDynamicName({...step,nameMode:'fan_custom'},{fan:'',custom:' Juan Carlos '}).name,'Juan');
});
test('first word never truncates fallback and full names survive disabled switch',()=>{
 assert.deepEqual(resolveDynamicName(step),{name:'Mi cielo',source:'fallback'});
 assert.equal(resolveDynamicName({...step,firstName:false},{custom:' John\t Smith '}).name,'John Smith');
 assert.equal(resolveDynamicName(step,{custom:'María\n José'}).name,'María');
});
test('rendering replaces every placeholder without example names or replacement-string expansion',()=>{
 assert.equal(personalizeMessage(step).text,'Hola Mi cielo, Mi cielo');
 assert.equal(personalizeMessage({...step,firstName:false},{custom:'$&'}).text,'Hola $&, $&');
 assert.throws(()=>personalizeMessage({...step,fallback:' '}));
 assert.equal(personalizeMessage({...step,nameMode:'none'}).text,'Hola , ');
});
