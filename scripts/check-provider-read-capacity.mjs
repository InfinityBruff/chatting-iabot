import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++},reject=async fn=>{await assert.rejects(fn);checks++},rpc=async(op,lease=null,priority='foreground')=>(await db.query('select public.bruff_provider_read_slot($1,$2,$3) as value',[op,lease,priority])).rows[0].value;
const elapsed=()=>db.exec("reset role;update bruff_private.provider_read_slots set next_at=clock_timestamp()-interval '1 second',foreground_until='-infinity';set role service_role");
try{
 await db.exec('create role anon;create role authenticated;create role service_role;create schema bruff_private;');
 for(const name of ['202611020034_provider_read_slots','202611030035_provider_read_capacity'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await reject(()=>rpc('acquire'));await reject(()=>db.query('select * from bruff_private.provider_read_leases'));await db.exec('reset role')}
 await db.exec('set role service_role');await reject(()=>db.query('select * from bruff_private.provider_read_leases'));
 const bg=await rpc('acquire',null,'background');eq(bg.allowed,true);eq((await rpc('acquire')).allowed,false);
 await elapsed();eq((await rpc('acquire',null,'background')).allowed,false);
 const fg=await rpc('acquire');eq(fg.allowed,true);await elapsed();eq((await rpc('acquire')).allowed,false);eq((await rpc('acquire',null,'background')).allowed,false);
 eq((await rpc('release','00000000-0000-4000-8000-000000000001')).released,false);eq((await rpc('release',bg.lease)).released,true);eq((await rpc('acquire')).allowed,false);
 await elapsed();const second=await rpc('acquire');eq(second.allowed,true);await elapsed();eq((await rpc('acquire')).allowed,false);
 eq((await rpc('release',fg.lease)).released,true);eq((await rpc('release',second.lease)).released,true);
 await elapsed();await db.exec("reset role;update bruff_private.provider_read_slots set lease='00000000-0000-4000-8000-000000000002',lease_until=clock_timestamp()+interval '20 seconds';set role service_role");
 eq((await rpc('acquire',null,'background')).allowed,false);const alongside=await rpc('acquire');eq(alongside.allowed,true);await elapsed();eq((await rpc('acquire')).allowed,false);
 eq((await rpc('release','00000000-0000-4000-8000-000000000002')).released,true);eq((await rpc('release',alongside.lease)).released,true);
 await elapsed();const expired=await rpc('acquire');await db.exec("reset role;update bruff_private.provider_read_leases set lease_until=clock_timestamp()-interval '1 second';set role service_role");await elapsed();const recovered=await rpc('acquire');eq(recovered.allowed,true);eq((await rpc('release',expired.lease)).released,false);eq((await rpc('release',recovered.lease)).released,true);
 await reject(()=>rpc('acquire',null,'invalid'));await db.exec('reset role');eq((await db.query("select relrowsecurity as value from pg_class where oid='bruff_private.provider_read_leases'::regclass")).rows[0].value,true);
 console.log(checks+' provider read-capacity SQL checks passed');
}finally{await db.close()}
