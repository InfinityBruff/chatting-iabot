export function captureThreadAnchor(el){
 const top=el.getBoundingClientRect().top;
 const rows=el.querySelectorAll('[data-message-id]');let lo=0,hi=rows.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].getBoundingClientRect().bottom>top+1)hi=mid;else lo=mid+1}
 const row=rows[lo];
 return {id:row?.dataset.messageId??null,offset:row?row.getBoundingClientRect().top-top:0,height:el.scrollHeight,scrollTop:el.scrollTop};
}
export function restoreThreadAnchor(el,anchor){
 const row=anchor.id?[...el.querySelectorAll('[data-message-id]')].find(node=>node.dataset.messageId===anchor.id):null;
 const target=row?el.scrollTop+row.getBoundingClientRect().top-el.getBoundingClientRect().top-anchor.offset:anchor.scrollTop+el.scrollHeight-anchor.height;
 el.scrollTop=Math.max(0,target);return el.scrollTop;
}
export function nearHistoryStart(el){return el.scrollTop<Math.max(500,el.clientHeight*.85)}
