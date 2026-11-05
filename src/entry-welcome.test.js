import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedLoginWelcome,entryWelcomeReady,matchesEntryWelcome} from './entry-welcome.js';

const actor='worker-a';
const user={id:actor,email_confirmed_at:'2026-11-05T10:00:00Z'};
const login={user,session:{user,access_token:'test-session'}};
const intent={attempt:1,currentAttempt:1,currentActor:actor,flow:null};
const workspaces=[{id:'agency-a'},{id:'agency-b'}];

test('only the current explicit confirmed password-login result creates an entry',()=>{
 assert.deepEqual(confirmedLoginWelcome(login,intent),{actor,token:JSON.stringify([actor,1])});
 // A restored session or auth event supplies no explicit accepted login intent.
 for(const event of ['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED']){
  assert.equal(confirmedLoginWelcome(login.session,{event,currentActor:actor}),null);
  assert.equal(confirmedLoginWelcome(login,{event,currentActor:actor}),null);
 }
 for(const data of [null,{},login.session,{...login,user:null},{...login,session:null},{...login,session:{...login.session,access_token:''}},{...login,user:{...user,email_confirmed_at:null}},{...login,session:{...login.session,user:{...user,email_confirmed_at:null}}},{...login,session:{...login.session,user:{...user,id:'other-worker'}}}])assert.equal(confirmedLoginWelcome(data,intent),null);
});

test('late login responses cannot restart welcome after a newer attempt, logout, user change or password flow',()=>{
 for(const changes of [{currentAttempt:2},{currentActor:null},{currentActor:'worker-b'},{attempt:0},{attempt:1.5},{attempt:undefined},...['link','request','invite','recovery'].map(flow=>({flow}))])assert.equal(confirmedLoginWelcome(login,{...intent,...changes}),null);
 const first=confirmedLoginWelcome(login,intent),second=confirmedLoginWelcome(login,{...intent,attempt:2,currentAttempt:2});
 assert.equal(matchesEntryWelcome(second,first.token,first.actor),false);
 assert.equal(matchesEntryWelcome(second,second.token,'worker-b'),false);
 assert.equal(matchesEntryWelcome(second,second.token,actor),true);
 assert.equal(matchesEntryWelcome(null,second.token,actor),false);
});

test('ready waits for verified agencies and the current selected workspace commit',()=>{
 const entry=confirmedLoginWelcome(login,intent);
 assert.equal(entryWelcomeReady(entry,{actor,workspaces:null}),false);
 for(const selected of ['agency-a','agency-b']){
  const state={actor,workspaces,selected};
  assert.equal(entryWelcomeReady(entry,state),false);
  for(const committed of [null,{token:'old-entry',actor,workspace:selected},{token:entry.token,actor:'worker-b',workspace:selected},{token:entry.token,actor,workspace:'other-agency'}])assert.equal(entryWelcomeReady(entry,{...state,committed}),false);
  assert.equal(entryWelcomeReady(entry,{...state,committed:{token:entry.token,actor,workspace:selected}}),true);
 }
});

test('automatic agency selection also waits for workspace commit without blocking the normal data loading',()=>{
 const entry=confirmedLoginWelcome(login,intent),state={actor,workspaces:[workspaces[0]],automatic:'agency-a'};
 assert.equal(entryWelcomeReady(entry,state),false);
 assert.equal(entryWelcomeReady(entry,{...state,committed:{token:entry.token,actor,workspace:'agency-a'}}),true);
 // A real explicit selection takes precedence over a saved automatic agency.
 assert.equal(entryWelcomeReady(entry,{...state,workspaces,selected:'agency-b',committed:{token:entry.token,actor,workspace:'agency-a'}}),false);
});

test('agency chooser, no assigned agency and authorization errors are terminal views, never an indefinite welcome gate',()=>{
 const entry=confirmedLoginWelcome(login,intent);
 assert.equal(entryWelcomeReady(entry,{actor,workspaces}),true);
 assert.equal(entryWelcomeReady(entry,{actor,workspaces:[]}),true);
 assert.equal(entryWelcomeReady(entry,{actor,workspaces:null,error:'Permissions could not be checked'}),true);
 assert.equal(entryWelcomeReady(entry,{actor:'worker-b',workspaces:[],error:'Unavailable'}),false);
 assert.equal(entryWelcomeReady(null,{actor,workspaces:[]}),false);
 for(const flow of ['link','request','invite','recovery'])assert.equal(entryWelcomeReady(entry,{actor,workspaces:[],error:'Unavailable',flow}),false);
});

test('membership and login data remain unchanged by welcome readiness',()=>{
 const before=JSON.stringify({login,workspaces}),entry=confirmedLoginWelcome(login,intent);
 entryWelcomeReady(entry,{actor,workspaces,selected:'agency-a',committed:{token:entry.token,actor,workspace:'agency-a'}});
 assert.equal(JSON.stringify({login,workspaces}),before);
});
