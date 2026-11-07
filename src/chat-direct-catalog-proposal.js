const HASH=/^[a-f0-9]{64}$/u,ID=/^[1-9][0-9]{0,23}$/u;
const POLICY='bruff-catalog-proposal-v1',POLICY_V2='bruff-catalog-proposal-v2';
const planKeys=['planVersion','planHash','stepIndex','progressState','evidenceBasis'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clean=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=()=>{throw Object.assign(new Error('La propuesta de catálogo no se pudo verificar.'),{status:503})};
export function validateCatalogProposal(value,catalog,commerce){
 if(value===null)return null;
 const v2=value?.policyVersion===POLICY_V2,keys=['id','policyVersion','folderId','mediaId','priceCents','currency','reviewRequired','orderConfirmed','paidConfirmed','reason','observedCount','pendingOfferCount',...(v2?planKeys:[])];
 if(!object(value)||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key))||!HASH.test(value.id)||![POLICY,POLICY_V2].includes(value.policyVersion)||!clean(value.folderId,256)||typeof value.mediaId!=='string'||!ID.test(value.mediaId)||value.priceCents!==null&&!natural(value.priceCents)||value.currency!=='USD'||value.reviewRequired!==true||value.orderConfirmed!==v2||value.paidConfirmed!==false||!clean(value.reason,500)||!natural(value.observedCount)||!natural(value.pendingOfferCount))fail();
 const folder=catalog?.folders?.find(folder=>folder.id===value.folderId);
 const item=folder?.items?.find(item=>item.id===value.mediaId);
 if(!item||!['photo','video'].includes(item.type)||item.type==='photo'&&value.priceCents!==0||!v2&&item.type==='video'&&value.priceCents!==item.referencePriceCents||value.priceCents!==null&&Math.round(value.priceCents/100*100)!==value.priceCents)fail();
 if(v2){
  const plan=commerce?.plans?.find(plan=>plan.folderId===value.folderId),step=plan?.steps?.[value.stepIndex];
  if(!natural(value.planVersion)||value.planVersion<1||!HASH.test(value.planHash)||!natural(value.stepIndex)||!['ready','awaiting_payment','needs_review','exhausted'].includes(value.progressState)||!['none','free_sent','paid_unlock_reported','ppv_purchase_event'].includes(value.evidenceBasis)||!plan||plan.version!==value.planVersion||plan.planHash!==value.planHash||!step||step.mediaId!==value.mediaId||step.priceCents!==value.priceCents)fail();
 }
 return Object.fromEntries(keys.map(key=>[key,value[key]]));
}
export function catalogSelection(value={}){
 if(!object(value)||Object.keys(value).some(key=>!['folderId','mediaId'].includes(key))||value.folderId!==undefined&&!clean(value.folderId,256)||value.mediaId!==undefined&&(typeof value.mediaId!=='string'||!ID.test(value.mediaId)||!value.folderId))fail();
 return {...(value.folderId!==undefined?{folderId:value.folderId}:{}),...(value.mediaId!==undefined?{mediaId:value.mediaId}:{})};
}
export function createCatalogProposal(data,context,candidateId,selection={},now=Date.now()){
 const proposal=validateCatalogProposal(data.proposal,data.catalog,data.commerce);if(!proposal)return null;
 if(!clean(candidateId,256)||!clean(context.scope,2048)||!clean(context.revision,512)||data.actorId!==context.actor||data.workspaceId!==context.workspace||data.creatorId!==context.account||data.fanId!==context.fanId||!HASH.test(data.catalog.batchHash)||!natural(data.progress?.scan?.version)||!Number.isFinite(Date.parse(data.observedAt)))fail();
 const snapshot={scope:context.scope,revision:context.revision,receivedAt:now,observedAt:data.observedAt,batchHash:data.catalog.batchHash,scanVersion:data.progress.scan.version,selection:catalogSelection(selection)};
 const content={accountId:context.account,folderName:data.catalog.folders.find(folder=>folder.id===proposal.folderId).name,currency:'USD',mediaIds:[proposal.mediaId],priceCents:proposal.priceCents,reason:proposal.reason,provenance:{kind:'catalog_proposal',proposalId:proposal.id,policyVersion:proposal.policyVersion,batchHash:snapshot.batchHash,folderId:proposal.folderId,reviewRequired:true,orderConfirmed:proposal.orderConfirmed,paidConfirmed:false}};
 return {candidateId,proposal,snapshot,content,resolvedContent:{status:'unavailable',items:[],message:'Contenido pendiente de comprobar en el baúl.'}};
}
// Association only: the canonical text/source remains untouched. A fresh server
// verification and vault resolution are still mandatory before draft mutation.
export function getCatalogProposal(entry,candidate,context,now=Date.now()){
 const item=entry?.catalogProposal;if(!item||!candidate||item.candidateId!==candidate.id||candidate.content)return null;
 const {proposal,snapshot,content}=item;
 try{
  if(!exact(snapshot,['scope','revision','receivedAt','observedAt','batchHash','scanVersion','selection'])||!Number.isFinite(snapshot.receivedAt)||snapshot.receivedAt>now+30000||now-snapshot.receivedAt>120000||!Number.isFinite(Date.parse(snapshot.observedAt))||Date.parse(snapshot.observedAt)>now+30000||now-Date.parse(snapshot.observedAt)>120000||!HASH.test(snapshot.batchHash)||!natural(snapshot.scanVersion))return null;
  if(context&&(context.scope!==snapshot.scope||context.revision!==snapshot.revision||context.account!==content?.accountId||context.canRead!==true))return null;
  const data=entry.catalogData;if(!data||snapshot.scope!==JSON.stringify([data.actorId,data.workspaceId,data.creatorId,data.fanId])||candidate.source?.modelId!==data.creatorId||data.catalog.batchHash!==snapshot.batchHash||data.progress.scan.version!==snapshot.scanVersion)return null;
  const normalized=validateCatalogProposal(proposal,data.catalog,data.commerce),selection=catalogSelection(snapshot.selection);
  if(selection.folderId&&selection.folderId!==normalized.folderId||selection.mediaId&&selection.mediaId!==normalized.mediaId)return null;
  if(!exact(content,['accountId','folderName','currency','mediaIds','priceCents','reason','provenance'])||content.accountId!==data.creatorId||content.currency!=='USD'||content.priceCents!==normalized.priceCents||!Array.isArray(content.mediaIds)||content.mediaIds.length!==1||content.mediaIds[0]!==normalized.mediaId||content.reason!==normalized.reason||content.folderName!==data.catalog.folders.find(folder=>folder.id===normalized.folderId)?.name||content.reference!==undefined||content.categoryId!==undefined)return null;
  const provenance=content.provenance;
  if(!exact(provenance,['kind','proposalId','policyVersion','batchHash','folderId','reviewRequired','orderConfirmed','paidConfirmed'])||provenance.kind!=='catalog_proposal'||provenance.proposalId!==normalized.id||provenance.policyVersion!==normalized.policyVersion||provenance.batchHash!==snapshot.batchHash||provenance.folderId!==normalized.folderId||provenance.reviewRequired!==true||provenance.orderConfirmed!==normalized.orderConfirmed||provenance.paidConfirmed!==false)return null;
  return item;
 }catch{return null}
}
