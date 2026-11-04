// Only reads with one bounded response can be cancelled through the page loader.
// Legacy earnings clients still receive the complete multi-category response.
export function cancellableLiveRead(operation,args={}){
 return operation==='inbox'||operation==='messages'||operation==='monthly'||operation==='balances'||operation==='transactions'||operation==='earnings'&&args.category!=null;
}
