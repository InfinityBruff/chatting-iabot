import test from 'node:test';import assert from 'node:assert/strict';
import {automationStatus,automationSummary,automationRows} from './automation-view.js';
test('visual counters use confirmed receipts and isolate message type',()=>{
 const rows=[{id:1,type:'mass',status:'active',counts:{sent:4,pending:9}},{id:2,type:'online',status:'active',counts:{sent:2}},{id:3,type:'mass',status:'error',counts:{uncertain:1}},{id:4,type:'welcome',status:'draft'},{id:5,type:'mass',archived:true,status:'completed',counts:{sent:3}}];
 assert.deepEqual(automationSummary(rows,'mass'),{active:1,drafts:0,sent:7,review:1});
 assert.deepEqual(automationRows(rows,'mass','active').map(x=>x.id),[1]);assert.deepEqual(automationRows(rows,null,'sent').map(x=>x.id),[1,2]);assert.deepEqual(automationRows(rows,'mass','archived').map(x=>x.id),[5]);
});
test('scheduled display never changes server state or calls drafts active',()=>{
 const row={status:'active',type:'mass',schedule:'scheduled',at:'2030-01-01'};assert.equal(automationStatus(row,0).label,'Programada');assert.equal(row.status,'active');assert.equal(automationStatus({...row,status:'draft'},0).label,'Borrador');assert.equal(automationStatus({status:'error'}).label,'Revisión necesaria');assert.equal(automationSummary([{counts:{sent:NaN},status:'draft'}]).sent,0);
});
