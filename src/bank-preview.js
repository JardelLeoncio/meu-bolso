export function setupBankPreview(client, currentSession) {
  const button = document.getElementById('bank-load');
  const status = document.getElementById('bank-status');
  const results = document.getElementById('bank-results');
  const list = document.getElementById('bank-movements');
  const more = document.getElementById('bank-more');
  const filter = document.getElementById('bank-filter');
  let rows = [], shown = 0, controller;
  const day = value => value.split('-').reverse().join('/');

  function render() {
    const filtered = rows.filter(row => !filter.value || row.direction === filter.value);
    list.replaceChildren();
    for (const row of filtered.slice(0, shown)) {
      const li = document.createElement('li');
      const name = document.createElement('strong');
      const detail = document.createElement('small');
      const amount = document.createElement('span');
      name.textContent = row.description;
      detail.textContent = [day(row.date),row.bank,row.account,row.pending?'Pendente':''].filter(Boolean).join(' · ');
      const formatted = /^[A-Z]{3}$/.test(row.currency)
        ? new Intl.NumberFormat('pt-BR',{style:'currency',currency:row.currency}).format(row.amount)
        : row.amount.toLocaleString('pt-BR');
      amount.textContent = row.direction+' · '+formatted;
      li.append(name,detail,amount);
      list.append(li);
    }
    if (!filtered.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Nenhuma movimentação nesta seleção.';
      list.append(empty);
    }
    more.hidden = shown >= filtered.length;
  }
  filter.addEventListener('change',()=>{ shown=30; render(); });
  more.addEventListener('click',()=>{ shown+=30; render(); });
  function clear() {
    controller?.abort();
    rows = []; shown = 0; filter.value = '';
    list.replaceChildren(); status.textContent=''; results.hidden=true; button.disabled=false;
  }
  button.addEventListener('click',async()=>{
    const session = currentSession();
    if (session === null || button.disabled) return;
    clear();
    controller = new AbortController();
    button.disabled = true;
    status.textContent = 'Consultando os bancos…';
    try {
      const {data,error} = await client.functions.invoke('bank-preview',{body:{},signal:controller.signal});
      if (error) {
        const payload = await error.context?.json?.().catch(()=>null);
        const messages = {
          access:'Entre novamente com a conta titular e confirme a verificação em duas etapas.',
          connection:'Confira no Meu Pluggy se as duas conexões estão atualizadas e autorizadas.',
          wait:'Já existe uma consulta recente. Aguarde dois minutos antes de tentar de novo.',
          setup:'Confira os quatro segredos e a configuração da função e do banco no Supabase.',
          provider:'A Pluggy recusou a consulta. Confira as credenciais e o estado das conexões.',
          limit:'O volume ultrapassou o limite desta prévia. A consulta ficou incompleta.',
        };
        throw Error(messages[payload?.error] || 'Prévia indisponível. Confira a conexão e a publicação da função bank-preview.');
      }
      if (currentSession()!==session) return;
      rows=data.movements; shown=30;
      render();
      const when=new Date(data.fetchedAt).toLocaleString('pt-BR');
      status.textContent=day(data.from)+' a '+day(data.to)+' · '+rows.length+' movimentações · Consulta em '+when;
      results.hidden=false;
    } catch(error) {
      if(currentSession()===session) status.textContent=error.message;
    } finally {
      if(currentSession()===session) button.disabled=false;
    }
  });
  return clear;
}
