import React from 'react';
const usd=n=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD'}).format(n);
export default function EarningsChart({points,title}){
 const values=points.map(p=>p.amount).filter(Number.isFinite);
 if(!values.length)return <p>No hay importes suficientes para mostrar la evolución.</p>;
 const low=Math.min(0,...values),high=Math.max(0,...values),span=high-low||1;
 const x=i=>30+i*700/Math.max(1,points.length-1),y=v=>170-(v-low)/span*140;
 return <figure className="earnings-chart"><figcaption>{title} · Evolución en USD</figcaption><svg viewBox="0 0 760 210" role="img" aria-label={`${title}: ${points.length} puntos; mínimo ${usd(Math.min(...values))}, máximo ${usd(Math.max(...values))}. Importes exactos en la tabla inferior.`}><line x1="30" x2="730" y1={y(0)} y2={y(0)} className="chart-axis"/>{points.map((p,i)=>Number.isFinite(p.amount)&&<g key={i}>{i>0&&Number.isFinite(points[i-1].amount)&&<line x1={x(i-1)} y1={y(points[i-1].amount)} x2={x(i)} y2={y(p.amount)} className="chart-line"/>}<circle cx={x(i)} cy={y(p.amount)} r="4"><title>{p.label} · {usd(p.amount)}</title></circle></g>)}<text x="30" y="200">{points[0]?.label}</text><text x="730" y="200" textAnchor="end">{points.at(-1)?.label}</text></svg><div className="chart-range"><span>Mínimo {usd(Math.min(...values))}</span><span>Máximo {usd(Math.max(...values))}</span></div><small>Orden y puntos del proveedor. Los valores ausentes no se estiman ni se unen.</small></figure>
}
