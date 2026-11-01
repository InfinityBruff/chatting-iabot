// Navigation is a presentation filter; server authorization remains mandatory.
export const workspaceSections = [
 {id:'chat',label:'Mensajes',group:'Mensajes',icon:'chat',permission:'chat'},
 {id:'notifications',label:'Notificaciones',group:'Actividad',icon:'bell',management:true,permission:'chat'},
 {id:'collections',label:'Colecciones',group:'Contenido',icon:'vault',management:true,permission:'chat'},
 {id:'dashboard',label:'Resumen financiero',group:'Analíticas',icon:'chart',permission:'analytics'},
 {id:'analytics',label:'Ingresos y movimientos',group:'Analíticas',icon:'chart',permission:'analytics'},
 {id:'vault',label:'Baúl de contenido',group:'Contenido',icon:'vault',permission:'vault'},
 {id:'accounts',label:'Cuentas',group:'Organización',icon:'accounts'},
 {id:'team',label:'Equipo y permisos por modelo',group:'Trabajadores',icon:'team',management:true},
 {id:'roles',label:'Roles y funciones',group:'Trabajadores',icon:'shield',management:true},
 {id:'automations',label:'Centro de automatizaciones',group:'Automatizaciones',icon:'bot',management:true,permission:'chat'},
 {id:'bot',label:'Alcance por modelo',group:'BRUFF IA',icon:'bot',management:true,permission:'chat'},
];
export const isManager = role => ['owner','admin'].includes(role);
export function visibleSections(role,accounts=[]){return workspaceSections.filter(s=>(!s.management||isManager(role))&&(!s.permission||accounts.some(a=>a[s.permission]===true)));}
export function navigationSections(role,accounts=[]){const allowed=new Set(visibleSections(role,accounts).map(s=>s.id));return workspaceSections.map(s=>({...s,locked:!allowed.has(s.id)}));}
export function sectionAccount(section,accounts=[],selected){const permission=workspaceSections.find(s=>s.id===section)?.permission;if(!permission)return null;const allowed=accounts.filter(a=>a[permission]===true);return allowed.find(a=>a.id===selected)||allowed[0]||null;}
export function resolveSection(requested,role,accounts=[]){const sections=visibleSections(role,accounts);return sections.some(s=>s.id===requested)?requested:sections[0]?.id||'accounts';}
