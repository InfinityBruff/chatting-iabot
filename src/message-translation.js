// Browser-local translation only. No fan text is sent to a third-party service.
const sourceCache=new Map(),abort=()=>Object.assign(Error('Traducción cancelada'),{name:'AbortError'});
export function createLocalTranslator(platform=globalThis){
 return async function translate(text,{signal,onProgress=()=>{}}={}){
  const current=()=>{if(signal?.aborted)throw abort()};current();
  if(!platform.Translator||!platform.LanguageDetector)throw Error('Este navegador no incluye traducción local. Disponible en Chrome de ordenador compatible; móvil y otros navegadores requieren un proveedor de traducción configurado.');
  let detector,translator;const dispose=()=>{try{detector?.destroy()}catch{}try{translator?.destroy()}catch{}};
  signal?.addEventListener('abort',dispose,{once:true});
  const monitor=monitor=>monitor.addEventListener('downloadprogress',event=>onProgress({progress:event.loaded,message:'Preparando el modelo local de traducción…'}));
  try{
   let sourceLanguage=sourceCache.get(text);
   if(!sourceLanguage){onProgress('Detectando idioma en este dispositivo…');detector=await platform.LanguageDetector.create({monitor});current();const detected=await detector.detect(text);current();const best=detected?.[0];if(!best||best.detectedLanguage==='und'||best.confidence<.45)throw Error('No se pudo identificar el idioma con suficiente certeza. Prueba con un mensaje más largo.');sourceLanguage=best.detectedLanguage;sourceCache.set(text,sourceLanguage);if(sourceCache.size>100)sourceCache.delete(sourceCache.keys().next().value);detector.destroy();detector=null}
   if(sourceLanguage==='es')return{text,sourceLanguage,targetLanguage:'es'};
   onProgress('Preparando traducción local al español…');
   translator=await platform.Translator.create({sourceLanguage,targetLanguage:'es',monitor});current();
   const translated=await translator.translate(text);current();
   return{text:translated,sourceLanguage,targetLanguage:'es'};
  }catch(error){current();if(/user.*activ|gesture|activation/i.test(error?.message||''))throw Error('Pulsa «Reintentar traducción» para autorizar la preparación del paquete local de este idioma. No se enviará el texto a un traductor externo.');throw error}
  finally{signal?.removeEventListener('abort',dispose);dispose()}
 };
}
export const translateMessage=createLocalTranslator();
