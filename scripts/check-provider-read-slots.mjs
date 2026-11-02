import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++},reject=async fn=>{await assert.rejects(fn);checks++},rpc=async(op,lease=null,priority='foreground')=>(await db.query('select public.bruff_provider_read_slot($1,$2,$3) as value',[op,lease,priority])).rows[0].value;
try{
 await db.exec('create role anon;create role authenticated;create role service_role;create schema bruff_private;');
 await db.exec(await readFile(new URL('../supabase/migrations/202611020034_provider_read_slots.sql',import.meta.url),'utf8'));
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await reject(()=>rpc('acquire'));await reject(()=>db.query('select * from bruff_private.provider_read_slots'));await db.exec('reset role')}
 await db.exec('set role service_role');await reject(()=>db.query('select * from bruff_private.provider_read_slots'));
 const first=await rpc('acquire');eq(first.allowed,true);eq(typeof first.lease,'string');eq((await rpc('acquire')).allowed,false);eq((await rpc('acquire',null,'background')).allowed,false);
 eq((await rpc('release','00000000-0000-4000-8000-000000000001')).released,false);eq((await rpc('release',first.lease)).released,true);eq((await rpc('acquire')).allowed,false);
 await reject(()=>rpc('wrong'));await reject(()=>rpc('acquire',null,'invalid'));
 await db.exec("reset role;update bruff_private.provider_read_slots set next_at=now()-interval '1 second';set role service_role;");
 eq((await rpc('acquire',null,'background')).allowed,false);const foreground=await rpc('acquire');eq(foreground.allowed,true);
 await db.exec("reset role;update bruff_private.provider_read_slots set lease_until=now()-interval '1 second',next_at=now()-interval '1 second';set role service_role;");
 const recovered=await rpc('acquire');eq(recovered.allowed,true);eq(recovered.lease===foreground.lease,false);eq((await rpc('release',foreground.lease)).released,false);eq((await rpc('release',recovered.lease)).released,true);
 await db.exec('reset role');eq((await db.query("select relrowsecurity as value from pg_class where oid='bruff_private.provider_read_slots'::regclass")).rows[0].value,true);
 console.log(checks+' provider read-slot SQL checks passed');
}finally{await db.close()}
