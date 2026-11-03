export const categories = {
  food:'Refeições', market:'Supermercado', fuel:'Combustível', transport:'Transporte',
  home:'Moradia', health:'Saúde', shopping:'Compras', leisure:'Lazer', education:'Educação',
  services:'Serviços', otherExpense:'Outros gastos', salary:'Salário', refund:'Reembolso',
  otherIncome:'Outras entradas', transfer:'Transferência própria', bill:'Pagamento de fatura',
  review:'A classificar',
};
const expenseKeys = ['food','market','fuel','transport','home','health','shopping','leisure','education','services','otherExpense'];
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const rules = [
  ['market', /supermerc|atacad|mercearia|hortifruti|grocer/],
  ['food', /restaurant|restaurante|food delivery|ifood|lanchonete|padaria|refeicao|alimentacao/],
  ['fuel', /combustivel|gasolin|etanol|fuel|gas station|posto de abastecimento/],
  ['transport', /transport|estacionamento|ride.hailing|uber trip|taxi/],
  ['home', /aluguel|condominio|rent and housing/],
  ['health', /farmacia|drogaria|pharmacy|healthcare/],
  ['education', /education|educacao|mensalidade escolar/],
  ['leisure', /cinema|entertainment|streaming/],
];
export function optionsFor(row) {
  const allowed = ['review','transfer','bill'];
  if(row.direction==='Saída') return [...allowed,...expenseKeys];
  if(row.direction==='Entrada') return [...allowed,...(row.account==='Conta'?['salary']:[]),'refund','otherIncome'];
  return allowed;
}
export function categoryFor(row) {
  if(row.chosen && optionsFor(row).includes(row.chosen)) return row.chosen;
  const label=normalize([row.categoryHint,row.description].join(' '));
  if(row.operation==='PAGAMENTO_FATURA' || /pagamento (d[ae] )?fatura|pagto fatura|credit card payment/.test(label)) return 'bill';
  if(/transferencia (entre (minhas )?contas|propria)|transfer - internal/.test(label)) return 'transfer';
  if(row.direction==='Entrada') {
    if(row.account==='Conta' && /salario|folha de pagamento|payroll|salary/.test(label)) return 'salary';
    if(/reembolso|estorno|refund/.test(label)) return 'refund';
  }
  if(row.direction==='Saída') return rules.find(([,regex])=>regex.test(label))?.[0] || 'review';
  return 'review';
}
export function summarize(rows) {
  const result = {cashIn:0,cashOut:0,spending:{},origins:{},review:0,pending:0,foreign:0,absent:0};
  for(const row of rows) {
    if(row.absent){result.absent++;continue;}
    if(row.pending){result.pending++;continue;}
    if(row.currency!=='BRL'){result.foreign++;continue;}
    const cents=Math.round(row.amount*100);
    const category=categoryFor(row);
    if(category==='transfer') continue;
    if(row.account==='Conta') {
      if(row.direction==='Entrada'){
        result.cashIn+=cents;
        result.origins[category]=(result.origins[category]||0)+cents;
      }
      if(row.direction==='Saída')result.cashOut+=cents;
    }
    if(category==='review')result.review++;
    if(row.direction==='Saída' && expenseKeys.includes(category)){
      result.spending[category]=(result.spending[category]||0)+cents;
    }
  }
  return result;
}
