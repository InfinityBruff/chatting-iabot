// A section can leave the viewport while its read is waiting behind chat traffic.
// Recheck at dispatch, then allow one resume if it reappears during queue cleanup.
export function createSectionReadGuard({current,visible}){
 let deferred=false,resumed=false;
 return {
  active(){if(!current())return false;if(!visible()){deferred=true;return false}return true},
  deferred:()=>deferred,
  resume(){if(resumed||!deferred||!current()||!visible())return false;resumed=true;return true}
 };
}
