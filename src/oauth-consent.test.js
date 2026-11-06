import test from 'node:test';import assert from 'node:assert/strict';
import {authorizationId,chatgptCallback,consentDetails} from './oauth-consent.js';
const authorization='authorization-123',actor='owner',data={authorization_id:authorization,user:{id:actor},client:{id:'client-id-123',name:'ChatGPT'},redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',scope:'openid email profile'};
test('consent needs one unambiguous authorization ID and never reads return paths as authority',()=>{
 assert.equal(authorizationId('?authorization_id='+authorization),authorization);for(const value of ['', '?authorization_id=short','?authorization_id=a12345678&authorization_id=b12345678','?authorization_id=https://bad.test'])assert.equal(authorizationId(value),null);
});
test('consent only accepts documented HTTPS ChatGPT callback paths',()=>{
 assert.ok(chatgptCallback(data.redirect_uri));assert.ok(chatgptCallback('https://chatgpt.com/connector/oauth/callback-id?code=test&state=test'));
 for(const url of ['http://chatgpt.com/connector_platform_oauth_redirect','https://chatgpt.com.evil.test/connector_platform_oauth_redirect','https://user@chatgpt.com/connector_platform_oauth_redirect','https://chatgpt.com:444/connector_platform_oauth_redirect','https://chatgpt.com/redirect','javascript:alert(1)','https://chatgpt.com/connector_platform_oauth_redirect#fragment'])assert.equal(chatgptCallback(url),null,url);
});
test('consent binds server-provided client, user, request ID and scopes',()=>{
 assert.equal(consentDetails(data,{authorization,actor}).clientName,'ChatGPT');
 for(const patch of [{authorization_id:'other-request'},{user:{id:'other'}},{client:{id:'bad',name:'ChatGPT'}},{scope:'openid database.admin'},{redirect_uri:data.redirect_uri+'?state=untrusted'},{client:{id:'client-id-123',name:''}}])assert.throws(()=>consentDetails({...data,...patch},{authorization,actor}));
 assert.deepEqual(consentDetails({...data,scope:'email email'},{authorization,actor}).scopes,['email']);
});
