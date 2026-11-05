import test from 'node:test';import assert from 'node:assert/strict';
import {composerAttachmentDetails,attachmentScrollState} from './composer-attachments.js';
test('attachment captions use known media types and provider numeric durations without inspecting tokens or URLs',()=>{
 for(const type of ['photo','video','audio','gif']){const item={name:'  Selected file  ',media:{type,duration:65.9},get token(){throw Error('Token must not be read')}};const value=composerAttachmentDetails(item);assert.equal(value.name,'Selected file');assert.equal(value.type,type);assert.equal(value.duration,['video','audio'].includes(type)?'1:05':null)}
 for(const duration of ['65',null,-1,0,NaN,Infinity])assert.equal(composerAttachmentDetails({media:{type:'video',duration}}).duration,null);
 assert.deepEqual(composerAttachmentDetails({media:{type:'unknown'}},2),{type:'file',label:'Archivo',name:'Archivo 3',duration:null});
});
test('strip navigation respects overflow, scroll bounds, fractional endpoints and hidden widths',()=>{
 assert.deepEqual(attachmentScrollState({scrollLeft:0,scrollWidth:1020,clientWidth:300}),{previous:false,next:true});
 assert.deepEqual(attachmentScrollState({scrollLeft:320,scrollWidth:1020,clientWidth:300}),{previous:true,next:true});
 assert.deepEqual(attachmentScrollState({scrollLeft:719.5,scrollWidth:1020,clientWidth:300}),{previous:true,next:false});
 assert.deepEqual(attachmentScrollState({scrollLeft:-20,scrollWidth:1020,clientWidth:300}),{previous:false,next:true});
 assert.deepEqual(attachmentScrollState({scrollLeft:900,scrollWidth:1020,clientWidth:300}),{previous:true,next:false});
 for(const dimensions of [{scrollWidth:100,clientWidth:300},{scrollWidth:1020,clientWidth:0}])assert.deepEqual(attachmentScrollState(dimensions),{previous:false,next:false});
});
