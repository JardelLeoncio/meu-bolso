import {categories,categoryFor,optionsFor,summarize} from './finance.js';
const money = cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const el=id=>document.getElementById(id);

function breakdown(id, values, empty) {
  const host=el(id);
  host.replaceChildren();
  const pairs=Object.entries(values).sort((a,b)=>b[1]-a[1]);
  const total=pairs.reduce((sum,[,value])=>sum+value,0);
  if(!pairs.length){host.textContent=empty;return;}
  for(const [key,value] of pairs){
    const line=document.createElement('button');
    line.type='button';line.className='analysis-row';
    line.addEventListener('click',()=>{
      const filter=el('finance-category-filter');filter.value=key;filter.dispatchEvent(new Event('change'));
      filter.focus();filter.scrollIntoView({block:'center'});
    });
    const label=document.createElement('span'), amount=document.createElement('strong'), meter=document.createElement('meter');
    label.textContent=categories[key] || categories.review;
    amount.textContent=money(value)+' · '+Math.round(value/total*100 || 0)+'%';
    meter.max=total || 1; meter.value=value; meter.setAttribute('aria-label',label.textContent);
    line.append(label,amount,meter);host.append(line);
  }
}

export function setupFinanceReport(client,session) {
  let period='', page='', activeSession=null, serial=0, loadedAt=0, loading=false;
  let rows=[], days=0, visible=30;
  const filter=el('finance-category-filter'), list=el('finance-classifications');
  for(const [key,label] of Object.entries(categories))filter.add(new Option(label,key));
  function status(message){
    el('finance-home-status').textContent=message;
    el('finance-report-status').textContent=message;
  }
  function renderRows(){
    const filtered=rows.filter(row=>!filter.value || categoryFor(row)===filter.value);
    list.replaceChildren();
    for(const row of filtered.slice(0,visible)){
      const li=document.createElement('li'), title=document.createElement('strong'), meta=document.createElement('small');
      title.textContent=row.description;
      meta.textContent=[row.date.split('-').reverse().join('/'),row.bank,row.account,row.direction,
        row.currency==='BRL'?money(Math.round(row.amount*100)):row.amount+' '+row.currency,row.absent?'Ausente na última consulta':row.pending?'A confirmar':''].filter(Boolean).join(' · ');
      const select=document.createElement('select');
      select.setAttribute('aria-label','Categoria de '+row.description);
      const suggested=categoryFor({...row,chosen:null});
      select.add(new Option('Sugestão · '+categories[suggested],''));
      for(const key of optionsFor(row))select.add(new Option(categories[key],key));
      select.value=row.chosen || '';
      select.addEventListener('change',async()=>{
        const before=session(),month=period;
        select.disabled=true;
        try {
          const {error}=await client.rpc('bolso_finance_classify',{p_ref:row.ref,p_category:select.value || null});
          if(session()!==before || period!==month)return;
          if(error)throw error;
          await refresh(true);
        }catch{
          if(session()===before && period===month){select.value=row.chosen || '';status('Não foi possível salvar a categoria. Tente novamente.');}
        }finally{select.disabled=false;}
      });
      li.append(title,meta,select);list.append(li);
    }
    if(!filtered.length)list.textContent='Nenhuma movimentação nesta seleção.';
    el('finance-classify-more').hidden=filtered.length<=visible;
  }
  function paint(){
    const data=summarize(rows);
    el('finance-in').textContent=days?money(data.cashIn):'—';
    el('finance-out').textContent=days?money(data.cashOut):'—';
    el('finance-net').textContent=days?money(data.cashIn-data.cashOut):'—';
    breakdown('finance-spending',data.spending,'Ainda não há gastos identificados neste período.');
    breakdown('finance-origins',data.origins,'Ainda não há entradas em conta neste período.');
    renderRows();
    el('finance-export').disabled=rows.length===0;
    if(!days){status('Para ver este mês, consulte Bancos e guarde o período no histórico.');return;}
    const totalDays=new Date(Number(period.slice(0,4)),Number(period.slice(5)),0).getDate();
    el('finance-home-status').textContent=days+' de '+totalDays+' dias com extrato guardado. Valores confirmados em reais, sem transferências próprias identificadas.';
    el('finance-report-status').textContent=days+' dias cobertos · '+data.review+' a classificar · '+data.pending+' pendentes · '+data.foreign+' em outras moedas · '+data.absent+' ausentes na última consulta. Os totais consideram movimentos confirmados em BRL.';
  }
  function clear(){
    serial++;activeSession=null;loadedAt=0;loading=false;rows=[];days=0;visible=30;filter.value='';
    paint();
  }
  async function refresh(force=false){
    const nowSession=session();
    if(nowSession===null || !period || !['overview','history'].includes(page))return;
    if(!force && (loading || Date.now()-loadedAt<60000))return;
    const id=++serial, month=period;loading=true;
    if(!loadedAt)status('Carregando o histórico financeiro…');
    try{
      const {data,error}=await client.rpc('bolso_finance_period',{p_month:month});
      if(id!==serial || session()!==nowSession)return;
      if(error)throw error;
      rows=data.rows;days=data.days;paint();
    }catch{
      if(id===serial && session()===nowSession){
        rows=[];days=0;paint();status('Histórico indisponível. Confira a conexão e a ativação do histórico bancário.');
      }
    }finally{if(id===serial){loading=false;loadedAt=Date.now();}}
  }
  document.addEventListener('finance-view',({detail})=>{
    if(session()===null)return;
    if(detail.month!==period || activeSession!==session()){
      clear();period=detail.month;activeSession=session();
    }
    page=detail.page;void refresh();
  });
  el('finance-export').addEventListener('click',()=>{
    if(session()===null || !rows.length)return;
    const quote=value=>{
      let text=String(value??'');
      if(/^[\s]*[=+@-]|^[\t\r]/.test(text))text="'"+text;
      return '"'+text.replaceAll('"','""')+'"';
    };
    const fields=[['Data','Banco','Conta','Descrição','Direção','Valor','Moeda','Categoria','Situação'],
      ...rows.map(r=>[r.date,r.bank,r.cardName||r.account,r.description,r.direction,r.amount.toLocaleString('pt-BR',{useGrouping:false,minimumFractionDigits:2}),
        r.currency,categories[categoryFor(r)],r.absent?'Ausente':r.pending?'A confirmar':'Confirmado'])];
    const csv=fields.map(line=>line.map(quote).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='meu-bolso-financas-'+period+'.csv';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  });
  filter.addEventListener('change',()=>{visible=30;renderRows();});
  el('finance-classify-more').addEventListener('click',()=>{visible+=30;renderRows();});
  return {clear,invalidate(){loadedAt=0;void refresh(true);}};
}
