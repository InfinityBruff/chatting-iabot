// Only reads with one bounded response can be cancelled through the page loader.
// Legacy earnings clients still receive the complete multi-category response.
export function cancellableLiveRead(operation,args={}){
 return ['inbox','messages','monthly','balances','transactions','fan_profile','fan_history','fan_spend','fan_spend_batch','fan_activity','presence','notification_heads'].includes(operation)||operation==='earnings'&&args.category!=null;
}
