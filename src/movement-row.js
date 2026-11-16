import {categories,categoryFor} from './finance.js';

export function movementRow(row,amount,confirmedLabel='') {
  const li=document.createElement('li'),name=document.createElement('strong'),detail=document.createElement('small'),value=document.createElement('span');
  name.textContent=row.description;
  detail.textContent=[row.date.split('-').reverse().join('/'),row.bank,row.cardName||row.account,categories[categoryFor(row)],row.installment?'Parcela '+row.installment:'',row.pending?'Pendente':confirmedLabel].filter(Boolean).join(' · ');
  li.className=row.direction==='Entrada'?'movement-in':row.direction==='Saída'?'movement-out':'';
  value.textContent=(row.direction==='Entrada'?'+ ':row.direction==='Saída'?'− ':'')+amount(row.amount,row.currency);
  value.setAttribute('aria-label',row.direction+' '+amount(row.amount,row.currency));
  const glyph=document.createElement('span');
  glyph.className='movement-icon';glyph.setAttribute('aria-hidden','true');
  const category=categoryFor(row);
  const paths={market:'M3 10h18l-2 10H5zM7 10l4-7m6 7-4-7',food:'M4 3v6a3 3 0 0 0 6 0V3M7 3v18m12 0V3c-4 2-5 7-4 11h4',fuel:'M3 21h12M5 20V4h9v16M5 10h9m3-5 4 4v9a2 2 0 0 1-4 0v-5h-3'};
  Object.assign(paths,{salary:'M3 7h18v14H3zM8 7V3h8v4M3 12h18M10 12v3h4v-3',health:'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',home:'M3 10 12 3l9 7M5 9v12h14V9M9 21v-7h6v7',transport:'M3 16V8h18v8M5 8l2-5h10l2 5M3 16h18M6 16v4m12-4v4',education:'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3zM12 6v16',leisure:'M3 6h18v14H3zM8 2l4 4 4-4',shopping:'M4 7h16v14H4zM8 7V3h8v4',bill:'M3 5h18v14H3zM3 10h18M6 15h4'});
  const path=paths[category] || (row.direction==='Entrada'?'M18 6 6 18m0-10v10h10':'M6 18 18 6m-10 0h10v10');
  glyph.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="'+path+'"/></svg>';
  li.append(glyph,name,detail,value);
  return li;
}
