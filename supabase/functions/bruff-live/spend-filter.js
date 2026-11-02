import {fanTier} from '../../../src/fan-tier.js';
// Lifetime spend from the provider, never inferred from a visible page of transactions.
export async function filterSpend({ids,rule,stars,checkpoint,read,save,maxBatches=2}){
 const source=[...ids].sort(),saved=checkpoint?.spendFilter;
 let offset=0,passed=[];
 if(saved&&JSON.stringify(saved.source)===JSON.stringify(source)){
  if(!Number.isSafeInteger(saved.offset)||saved.offset<0||saved.offset>source.length||!Array.isArray(saved.passed)||new Set(saved.passed).size!==saved.passed.length||saved.passed.some(x=>!source.slice(0,saved.offset).includes(x)))throw Error('Avance de filtro inválido');
  offset=saved.offset;passed=[...saved.passed];
 }
 rule=rule?.enabled===false||!rule?{min:0,max:Infinity}:rule;
 if(stars?.enabled&&(!Number.isInteger(Number(stars.min))||!Number.isInteger(Number(stars.max))||Number(stars.min)<0||Number(stars.max)>5||Number(stars.max)<Number(stars.min)))throw Error('Rango de estrellas inválido');
 const min=rule.min===''||rule.min==null?0:Number(rule.min),max=rule.max===''||rule.max==null?Infinity:Number(rule.max);
 if(!Number.isFinite(min)||min<0||max<min||Number.isNaN(max))throw Error('Rango de gasto inválido');
 for(let n=0;offset<source.length&&n<maxBatches;n++){
  const batch=source.slice(offset,offset+20),data=await read('fans/spend?'+new URLSearchParams({ids:batch.join(',')}));
  if(!Array.isArray(data.fans)||data.fans.length!==batch.length||new Set(data.fans.map(x=>String(x.fanId))).size!==batch.length)throw Error('Gasto incompleto: no se preparará una audiencia parcial');
  const byId=new Map(data.fans.map(x=>[String(x.fanId),x]));
  for(const id of batch){const row=byId.get(id);if(row?.available!==true||typeof row.total!=='number'||!Number.isFinite(row.total)||row.total<0)throw Error('No se pudo verificar el gasto de todos los destinatarios');const cents=Math.round(row.total*100);if(!Number.isSafeInteger(cents)||Math.abs(row.total*100-cents)>0.000001)throw Error('Gasto sin precisión verificable');const count=fanTier(cents).count;const starMatch=!stars?.enabled||count>=Number(stars.min)&&count<=Number(stars.max);if(row.total>=min&&row.total<=max&&starMatch)passed.push(id)}
  offset+=batch.length;await save({source,offset,passed:[...passed]});
 }
 return {complete:offset===source.length,ids:passed};
}
