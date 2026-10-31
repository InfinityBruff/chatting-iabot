export function fanSelected(scope,fan){
 if(!scope||scope.mode==='off')return false;
 const override=scope.overrides?.[String(fan)];
 return override==='manual'?false:override==='enabled'?true:scope.mode==='all';
}
