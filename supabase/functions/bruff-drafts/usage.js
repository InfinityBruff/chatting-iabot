// Tokens are observed provider metadata; neurons are a tariff calculation,
// not a reading of the Cloudflare account's invoice or remaining free quota.
// https://developers.cloudflare.com/workers-ai/platform/pricing/ (2026-11-06)
// Bump whenever model, prompt policy, output schema, or validation changes:
// cache entries attest the complete inference contract, not only the text.
export const ENGINE_VERSION='bruff-drafts-v2';
export const RESERVED_NEURONS=600;
export const SHARED_BUDGET_NEURONS=7500;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const token=(x,min=0)=>Number.isSafeInteger(x)&&x>=min&&x<=1_000_000;
const integer=x=>Number.isSafeInteger(x)&&x>=0;
export function calculatedNeurons(promptTokens,completionTokens){
 if(!token(promptTokens,1)||!token(completionTokens))return null;
 const numerator=BigInt(promptTokens)*31876n+BigInt(completionTokens)*50488n;
 return Math.max(1,Number((numerator+999999n)/1000000n));
}
export function providerUsage(answer){
 const usage=answer?.result?.usage;
 if(!record(usage)||!token(usage.prompt_tokens,1)||!token(usage.completion_tokens)||Object.hasOwn(usage,'total_tokens')&&(!Number.isSafeInteger(usage.total_tokens)||usage.total_tokens!==usage.prompt_tokens+usage.completion_tokens))return reservedUsage();
 const calculated=calculatedNeurons(usage.prompt_tokens,usage.completion_tokens);
 return {status:'observed',promptTokens:usage.prompt_tokens,completionTokens:usage.completion_tokens,calculatedNeurons:calculated,chargedNeurons:calculated};
}
export function reservedUsage(){return {status:'reserved',promptTokens:null,completionTokens:null,calculatedNeurons:null,chargedNeurons:RESERVED_NEURONS}}
export function validUsage(usage){
 if(!record(usage))return false;
 if(usage.status==='reserved')return usage.promptTokens===null&&usage.completionTokens===null&&usage.calculatedNeurons===null&&usage.chargedNeurons===RESERVED_NEURONS;
 const calculated=calculatedNeurons(usage.promptTokens,usage.completionTokens);
 return usage.status==='observed'&&calculated!==null&&usage.calculatedNeurons===calculated&&usage.chargedNeurons===calculated;
}
export function validQuota(quota){
 if(!record(quota)||typeof quota.usageDay!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(quota.usageDay)||quota.sharedBudgetNeurons!==SHARED_BUDGET_NEURONS)return false;
 const day=Date.parse(quota.usageDay+'T00:00:00.000Z');
 if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==quota.usageDay||typeof quota.resetsAt!=='string'||Date.parse(quota.resetsAt)!==day+86400000)return false;
 if(!['modelQueries','calculatedNeurons','reservedNeurons','chargedNeurons','remainingNeurons','observedRequests','reservedRequests'].every(key=>integer(quota[key]))||!Number.isSafeInteger(quota.modelDailyLimit)||quota.modelDailyLimit<1||quota.modelDailyLimit>1000)return false;
 return quota.reservedNeurons===quota.reservedRequests*RESERVED_NEURONS&&quota.chargedNeurons===quota.calculatedNeurons+quota.reservedNeurons&&quota.remainingNeurons===Math.max(0,SHARED_BUDGET_NEURONS-quota.chargedNeurons);
}
