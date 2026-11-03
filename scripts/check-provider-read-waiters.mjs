import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++},reject=async fn=>{await assert.rejects(fn);checks++},rpc=async(op,lease=null,priority='foreground')=>(await db.query('select public.bruff_provider_read_slot($1,$2,$3) as value',[op,lease,priority])).rows[0].value;
const elapsed=()=>db.exec("reset role;update bruff_private.provider_read_slots set next_at=clock_timestamp()-interval '1 second',foreground_until='-infinity';set role service_role");
try{
 await db.exec('create role anon;create role authenticated;create role service_role;create schema bruff_private;');
 for(const name of ['202611020034_provider_read_slots','202611030035_provider_read_capacity','202611030036_provider_read_waiters'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await reject(()=>rpc('acquire'));await reject(()=>db.query('select * from bruff_private.provider_read_waiters'));await db.exec('reset role')}
 await db.exec('set role service_role');await reject(()=>db.query('select * from bruff_private.provider_read_waiters'));
 const oldA=await rpc('acquire');eq(oldA.allowed,true);await elapsed();const oldB=await rpc('acquire');eq(oldB.allowed,true);
 const a=crypto.randomUUID(),b=crypto.randomUUID(),c=crypto.randomUUID(),d=crypto.randomUUID();
 eq((await rpc('acquire',a)).allowed,false);eq((await rpc('acquire',b)).allowed,false);
 eq((await rpc('release',oldA.lease)).released,true);await elapsed();eq((await rpc('acquire')).allowed,false);eq((await rpc('acquire',b)).allowed,false);
 const first=await rpc('acquire',a);eq(first.allowed,true);eq(first.lease,a);
 eq((await rpc('release',oldB.lease)).released,true);await elapsed();eq((await rpc('acquire',null,'background')).allowed,false);eq((await rpc('acquire',b)).allowed,true);
 eq((await rpc('acquire',c,'background')).allowed,false);eq((await rpc('acquire',d)).allowed,false);eq((await rpc('release',a)).released,true);await elapsed();eq((await rpc('acquire',c,'background')).allowed,false);eq((await rpc('acquire',d)).allowed,true);
 eq((await rpc('cancel',c,'background')).cancelled,true);eq((await rpc('cancel',d)).cancelled,true);await elapsed();eq((await rpc('acquire')).allowed,false);
 eq((await rpc('release',b)).released,true);eq((await rpc('release',d)).released,true);await elapsed();
 await db.exec("reset role;update bruff_private.provider_read_slots set next_at=clock_timestamp()+interval '10 seconds';set role service_role");const expired=crypto.randomUUID();eq((await rpc('acquire',expired)).allowed,false);
 await db.exec("reset role;update bruff_private.provider_read_waiters set expires_at=clock_timestamp()-interval '1 second';set role service_role");await elapsed();const recovered=await rpc('acquire');eq(recovered.allowed,true);eq((await rpc('release',expired)).released,false);eq((await rpc('release',recovered.lease)).released,true);
 await db.exec('reset role');eq((await db.query("select count(*)::int as value from bruff_private.provider_read_waiters")).rows[0].value,0);eq((await db.query("select relrowsecurity as value from pg_class where oid='bruff_private.provider_read_waiters'::regclass")).rows[0].value,true);
 console.log(checks+' provider read-waiter SQL checks passed');
}finally{await db.close()}
