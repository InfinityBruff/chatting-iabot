// USD cents, lifetime spend with the selected creator only.
export const fanThresholds=Object.freeze([600,1701,3501,6001,9500]);
export function fanTier(cents){
 if(!Number.isSafeInteger(cents)||cents<0)return {count:null,diamond:false};
 return {count:fanThresholds.filter(n=>cents>=n).length,diamond:cents>20000};
}
export function spendCents(spend){return spend?.available===true&&typeof spend.total==='number'&&Number.isFinite(spend.total)&&spend.total>=0&&Number.isSafeInteger(Math.round(spend.total*100))?Math.round(spend.total*100):null;}
