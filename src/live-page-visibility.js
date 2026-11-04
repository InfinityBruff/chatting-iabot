const financialCategories=new Set(['total','messages','tips','subscriptions','posts','streams','referrals']);
// Legacy combined earnings and unrelated sections retain their current contract.
export function financialPageRead(operation,args={}){
 return ['monthly','balances','transactions'].includes(operation)||operation==='earnings'&&financialCategories.has(args?.category);
}
