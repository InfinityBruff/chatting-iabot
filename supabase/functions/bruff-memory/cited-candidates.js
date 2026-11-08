// Literal, neutral evidence only. This module has no network, store, auth or AI.
export const citedMemoryCategories=Object.freeze(['preferred_name','language','interests','availability','pending_question','commitment','personal_context']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[1-9][0-9]{0,23}$/u.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(v);
const fail=(status=400,code='MEMORY_CANDIDATES')=>Object.assign(Error(status===400?'Selecciona únicamente citas literales neutrales de mensajes del fan.':'No se pudo verificar la página de evidencia de memoria.'),{status,code});
const fold=v=>v.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').replace(/[’‘]/gu,"'").toLowerCase();
const sexual=/\b(?:fuck\w*|pussy|cock|dick|sext\w*|nudes?|naked|porn\w*|erotic\w*|fetish\w*|masturb\w*|orgasm\w*|cum|anal|blowjob|handjob|sex\w*|horny|boobs?|breasts?|penis|vagina|desnud\w*|follar|polla|cono|tetas?|culo|sexo|cachond\w*)\b/u;
const sensitive=/\b(?:race|racial|ethnic\w*|religio\w*|christian|muslim|jewish|hindu|buddh\w*|budis\w*|atheist|catholic|politic\w*|republican|democrat|vot(?:e|ing)|salud|health|medical|diagnos\w*|disease|cancer|diabet\w*|asthma|asma|depress\w*|anxi\w*|therapy|therapist|medicat\w*|disab\w*|embaraz\w*|pregnan\w*|suicid\w*|bipolar|autis\w*|hiv|sida|adic\w*|addict\w*|drugs?|cocaine|criminal|prison|carcel|religion|raza|etni\w*|enfermedad\w*|medic\w*|salud|orientacion|gay|lesbian\w*|bisexual|transgender|transexual|straight|heterosexual|homosexual|wife|husband|spouse|girlfriend|boyfriend|married|espos\w*|novi[oa]s?|casad[oa]s?|age|edad|years? old|anos de edad|minor|underage|menor(?:es)?|wealth\w*|rich|poverty|poor|homeless|refugio|albergue|pobre\w*|salary|income|savings|balance|financ\w*|purchased?|bought|buying|payment|paid|refund\w*|spent|spend\w*|tips?|propina\w*|compr\w*|pagad\w*|sueldo|ingresos|dinero|rica?|rico|ahorros)\b/u;
const credential=/\b(?:bearer|password|passwd|passcode|pin|contrasena|clave|credencial\w*|secret|secreto|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|session[ _-]?(?:key|token)|jwt|oauth|ssn|passport|pasaporte|dni|iban|credit card|tarjeta|bank account|cuenta bancaria)\b/u;
const validScope=scope=>object(scope)&&['ownerId','workspaceId','creatorId'].every(k=>uuid(scope[k]))&&id(scope.fanId)&&typeof scope.binding==='string'&&/^acct_[A-Za-z0-9_-]{1,123}$/u.test(scope.binding);
const validAt=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
function safeQuote(quote,min=3,max=240){
 if(typeof quote!=='string'||quote!==quote.trim()||quote.length<min||quote.length>max||/[\u0000-\u001f\u007f]/u.test(quote))return false;
 const value=fold(quote);
 if(/(?:[a-z][a-z0-9+.-]*:\/\/|https?:|www\.|\b(?:data|blob|javascript):|[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}|@[\p{L}\d_]|\b[\p{L}\d-]+(?:\.[\p{L}\d-]+)*\.[a-z]{2,24}\b)/iu.test(quote))return false;
 if(/(?:\+?\d[\d ().-]{5,}\d|\d{4,}|\b[a-z0-9_-]{32,}\b|[$€£¥]|\b(?:street|road|avenue|postcode|postal|zip|calle|avenida|direccion exacta|numero de telefono|phone number|whatsapp|telegram|snapchat|instagram)\b)/iu.test(value))return false;
 if(sexual.test(value)||sensitive.test(value)||credential.test(value)||/\b(?:i am|i'm|tengo|soy)\s+\d{1,3}\b/u.test(value)||/\b\d{1,3}\s*(?:years?|anos|yo)\b/u.test(value))return false;
 if(/\b(?:ignore (?:all|previous)|system prompt|system instructions|developer message|ignora (?:todo|las instrucciones))\b/u.test(value))return false;
 return true;
}
const set=value=>new Set(value.split('|'));
const languages=set('english|spanish|espanol|ingles|french|frances|portuguese|portugues|italian|italiano|german|aleman|dutch|neerlandes|japanese|japones|korean|coreano');
const hobbies=set('reading|books|music|football|basketball|cooking|hiking|photography|art|design|gaming|video games|travel|travelling|traveling|movies|cinema|dancing|running|cycling|swimming|fitness|camping|fishing|writing|gardening|chess|tennis|padel|volleyball|leer|libros|la lectura|musica|la musica|futbol|el futbol|baloncesto|el baloncesto|cocinar|la cocina|senderismo|el senderismo|fotografia|la fotografia|el arte|el diseno|videojuegos|los videojuegos|viajar|el cine|peliculas|bailar|correr|ciclismo|nadar|acampar|pescar|escribir|jardineria|ajedrez|el ajedrez|tenis|el tenis|voleibol');
// Coarse place and ordinary occupation vocabularies intentionally stay bounded.
// Unknown locations/jobs require human review rather than guessing neutrality.
const places=set('madrid|barcelona|valencia|sevilla|seville|bilbao|malaga|zaragoza|london|manchester|birmingham|edinburgh|dublin|paris|berlin|hamburg|munich|rome|roma|milan|milano|lisbon|lisboa|porto|amsterdam|brussels|vienna|zurich|prague|warsaw|athens|budapest|oslo|stockholm|helsinki|copenhagen|new york|boston|chicago|seattle|austin|denver|miami|los angeles|san francisco|san diego|houston|dallas|atlanta|toronto|montreal|vancouver|ottawa|mexico city|ciudad de mexico|bogota|medellin|buenos aires|santiago|lima|montevideo|caracas|quito|guayaquil|san jose|panama|sao paulo|rio de janeiro|sydney|melbourne|brisbane|perth|auckland|wellington|tokyo|osaka|seoul|singapore|bangkok|taipei|hong kong|dubai|abu dhabi|cape town|johannesburg|spain|espana|england|inglaterra|scotland|escocia|ireland|irlanda|france|francia|germany|alemania|italy|italia|portugal|netherlands|paises bajos|belgium|belgica|austria|switzerland|suiza|poland|polonia|greece|grecia|norway|noruega|sweden|suecia|finland|finlandia|denmark|dinamarca|canada|mexico|colombia|argentina|chile|peru|uruguay|ecuador|brazil|brasil|australia|new zealand|nueva zelanda|japan|japon|south korea|corea del sur|uk|the uk|united kingdom|the united kingdom|reino unido|usa|the usa|united states|the united states|estados unidos|california|texas|florida|new jersey|washington|colorado|ontario|quebec');
const jobs=set('carpenter|electrician|plumber|mechanic|designer|graphic designer|web designer|software developer|software engineer|engineer|teacher|chef|cook|waiter|bartender|driver|photographer|writer|technician|accountant|consultant|artist|office worker|retail worker|construction worker|manager|carpintero|carpintera|electricista|fontanero|mecanico|mecanica|disenador|disenadora|desarrollador|desarrolladora|ingeniero|ingeniera|profesor|profesora|cocinero|cocinera|camarero|camarera|conductor|conductora|fotografo|fotografa|escritor|escritora|tecnico|tecnica|contable|artista');
const sectors=set('design|software|engineering|retail|logistics|hospitality|construction|marketing|sales|an office|a restaurant|a shop|a hotel|a factory|diseno|programacion|ingenieria|logistica|hosteleria|construccion|ventas|una oficina|un restaurante|una tienda|un hotel|una fabrica');
for(const place of 'alabama|alaska|arizona|arkansas|connecticut|delaware|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|utah|vermont|virginia|west virginia|wisconsin|wyoming'.split('|'))places.add(place);
// A closed place vocabulary supports neutral, literal question/answer evidence.
// It never geocodes an address or infers current or permanent residence.
export const isAllowedCoarsePlace=value=>typeof value==='string'&&value===value.trim()&&value.length<=80&&places.has(fold(value));
const nonNameTokens=set('and|or|but|because|with|without|my|your|his|her|their|our|i|you|he|she|we|they|me|have|has|had|am|is|are|was|were|be|been|being|need|feel|live|work|want|buy|can|will|would|should|must|do|does|not|no|yes|to|from|at|in|on|of|for|the|a|an|y|o|pero|porque|con|sin|mi|mis|tu|tus|su|sus|yo|el|ella|nosotros|ellos|tengo|tiene|tenia|soy|es|eres|somos|estoy|esta|vivo|trabajo|quiero|necesito|puedo|puede|debo|para|por|de|del|en|un|una|la|las|los|years|year|anos|ano|old|edad|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|lupus');
const listIn=(value,allowed)=>{const parts=value.split(/\s*(?:,|\band\b|\by\b|&)\s*/u);return parts.length>=1&&parts.length<=5&&parts.every(part=>allowed.has(part));};
function positiveCategory(quote,category){
 const value=fold(quote).replace(/^[¿¡]/u,'').replace(/[.!?]+$/u,'').trim();let match;
 if(category==='preferred_name'){
  const named=/^(?:please )?(?:call me|you can call me|my name is|me puedes llamar|llamame|me llamo|mi nombre es) ([\p{L}][\p{L} '-]{0,59})$/u.exec(value);if(!named)return false;
  const tokens=named[1].split(/[\s'-]+/u);return tokens.length>=1&&tokens.length<=3&&tokens.every(token=>/^\p{L}+$/u.test(token)&&!nonNameTokens.has(token));
 }
 if(category==='language')return !!((match=/^(?:i (?:speak|prefer)|i prefer to speak|can we speak|could we speak|hablo|prefiero|prefiero hablar|podemos hablar) (.+?)(?: please| por favor)?$/u.exec(value))&&listIn(match[1],languages));
 if(category==='interests')return !!((match=/^(?:i (?:like|love|enjoy)|i am into|i'm into|my hobbies are|me gusta|me gustan|me encanta|me encantan|disfruto|mis aficiones son) (.+?)(?: a lot| mucho)?$/u.exec(value))&&listIn(match[1],hobbies));
 if(category==='personal_context'){
  if((match=/^(?:i live in|i'm based in|i am based in|vivo en|resido en) (.+)$/u.exec(value)))return places.has(match[1]);
  if((match=/^(?:i work as (?:a |an )?|i am (?:a |an )|i'm (?:a |an )|trabajo como (?:un |una )?|soy (?:un |una )?)(.+)$/u.exec(value)))return jobs.has(match[1]);
  if((match=/^(?:i work in|i work at|trabajo en) (.+)$/u.exec(value)))return sectors.has(match[1]);
  return false;
 }
 if(category==='availability')return /^(?:(?:i am|i'm) (?:usually |generally )?(?:free|available) (?:on weekends|on weekdays|in the evenings|in the mornings|after work|after lunch|today|tomorrow|tonight|this weekend|at (?:[1-9]|1[0-2])(?:am|pm))|(?:estoy|suelo estar) (?:libre|disponible) (?:los fines de semana|entre semana|por las tardes|por las mananas|despues del trabajo|hoy|manana|esta noche))$/u.test(value);
 if(category==='commitment')return /^(?:(?:i'll|i will) (?:message|text|write to|reply to) you (?:later|tomorrow|tonight|after work|this evening)|te (?:escribo|escribire|respondo|respondere) (?:luego|manana|mas tarde|esta noche|despues del trabajo))$/u.test(value);
 if(category==='pending_question')return /^(?:how (?:is|was) your day|how are you|how is your week going|what are you doing|what are your plans (?:today|for the weekend)|what time (?:are you back|will you be back)|what(?:'s| is) your favorite (?:movie|book|music|food|hobby)|como (?:estas|va tu dia|fue tu dia|va tu semana)|que (?:tal tu dia|haces|planes tienes para el fin de semana)|cual es tu (?:pelicula|libro|comida|aficion) favorit[oa])$/u.test(value);
 return false;
}
export function isNeutralMemoryQuote(quote,category){return safeQuote(quote)&&(category===undefined?citedMemoryCategories.some(key=>positiveCategory(quote,key)):citedMemoryCategories.includes(category)&&positiveCategory(quote,category));}
export function isNeutralMemoryFragment(quote){return safeQuote(quote,2,120);}
export function isAllowedContextualReply(kind,quote){
 if(!isNeutralMemoryFragment(quote))return false;
 if(kind==='where_from'||kind==='where_based'){
  const value=fold(quote);if(places.has(value))return true;
  const part=/^(?:in|from|near|around|en|de|cerca de)\s+(?:(?:the\s+|las\s+|los\s+|el\s+)?(?:mountains|mountain region|countryside|state|area|montanas|estado|zona)\s+(?:of|de)\s+)?(.+)$/u.exec(value);return !!part&&places.has(part[1]);
 }
 const category=kind==='preferred_name'?'preferred_name':kind==='language'?'language':kind==='interests'?'interests':null,prefix=kind==='preferred_name'?'Call me ':kind==='language'?'I speak ':kind==='interests'?'I like ':null;
 return !!category&&(isNeutralMemoryQuote(prefix+quote,category)||isNeutralMemoryQuote(quote,category));
}
export function validateCitedCandidates(candidates){
 if(!Array.isArray(candidates)||candidates.length>20)throw fail();
 return candidates.map(candidate=>{
  if(!exact(candidate,['category','message_id','quote'])||!citedMemoryCategories.includes(candidate.category)||!id(candidate.message_id)||!isNeutralMemoryQuote(candidate.quote,candidate.category))throw fail();
  return {category:candidate.category,message_id:candidate.message_id,quote:candidate.quote};
 });
}
// Ordinary declarations only: historical questions and promises are not an
// automatic to-do list. This walks literal sentence spans, never paraphrases.
export function extractCitedCandidateInputs(messages){
 if(!Array.isArray(messages)||messages.length>200)throw fail(503);
 const categories=['preferred_name','language','interests','personal_context','availability'],result=[];
 for(const message of messages){
  if(!object(message)||message.isFromMe!==false||message.pending||message.delivery||typeof message.text!=='string'||message.text.length>10000||!id(message.id)||!validAt(message.createdAt))continue;
  const found=new Set();let spans=0;
  for(const match of message.text.matchAll(/[^.!?;\r\n]+[.!?]?/gu)){
   if(++spans>64)break;const quote=match[0].trim();if(!quote||quote.endsWith('?'))continue;
   for(const category of categories){
    if(found.has(category)||!isNeutralMemoryQuote(quote,category))continue;
    // Time-relative availability from old pages must not become current state.
    if(category==='availability'&&!/\b(?:on weekends|on weekdays|in the evenings|in the mornings|los fines de semana|entre semana|por las tardes|por las mananas)\b/u.test(fold(quote)))continue;
    found.add(category);result.push({category,message_id:message.id,quote});
   }
  }
 }
 return result;
}
export async function citedCandidateKey(scope,candidate){
 const keys=['ownerId','workspaceId','creatorId','binding','fanId'];
 if(!validScope(scope))throw fail(503);
 const canonical=[...keys.map(k=>scope[k]),candidate.category,candidate.message_id,candidate.quote];
 return 'cited_'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical))))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function prepareCitedCandidates(scope,candidates,messages){
 const selected=validateCitedCandidates(candidates);if(!validScope(scope)||!Array.isArray(messages)||messages.length>200)throw fail(503);
 const evidence=new Map();
 for(const message of messages){
  if(!object(message))throw fail(503);const messageId=typeof message.id==='number'&&Number.isSafeInteger(message.id)?String(message.id):message.id;
  if(!id(messageId)||evidence.has(messageId))throw fail(503);
  for(const [key,expected]of [['workspaceId',scope.workspaceId],['creatorId',scope.creatorId],['modelId',scope.creatorId],['fanId',scope.fanId],['binding',scope.binding]])if(Object.hasOwn(message,key)&&message[key]!==expected)throw fail(503);
  evidence.set(messageId,message);
 }
 const output=[];
 for(const candidate of selected){
  const message=evidence.get(candidate.message_id);
  if(!message||message.isFromMe!==false||message.delivery||message.pending||typeof message.text!=='string'||!message.text.includes(candidate.quote)||!validAt(message.createdAt))throw fail();
  output.push({workspaceId:scope.workspaceId,creatorId:scope.creatorId,fanId:scope.fanId,key:await citedCandidateKey(scope,candidate),category:candidate.category,value:candidate.quote,status:'pending',origin:'analysis',pinned:false,source:{messageId:candidate.message_id,quote:candidate.quote,at:new Date(message.createdAt).toISOString(),author:'fan'}});
 }
 return output;
}
