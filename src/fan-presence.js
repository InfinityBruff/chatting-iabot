// A missing result is unknown, never an offline assertion. Presence expires locally.
export function isFanOnline(fan,now=Date.now()){
 const checked=Date.parse(fan?.presence?.checkedAt);
 return fan?.presence?.online===true&&Number.isFinite(checked)&&now>=checked&&now-checked<60000;
}
