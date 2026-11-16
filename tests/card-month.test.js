import test from 'node:test';
import assert from 'node:assert/strict';
import {monthCardActivity} from '../src/bank-overview.js';

test('Gastos mensais incluem o primeiro e o último dia e acompanham a confirmação de uma compra',()=>{
  const base={account:'Cartão',accountRef:'card',currency:'BRL',direction:'Saída',amount:42,pending:false};
  const purchase={...base,date:'2026-10-31',amount:19.90,pending:true,billPeriod:'2026-11'};
  const snapshot={cardFrom:'2026-10-01',from:'2026-10-02',to:'2026-10-31',earlierCardRows:[{...base,date:'2026-10-01'}],movements:[purchase,
    {...base,date:'2026-10-02',direction:'Entrada',amount:5},
    {...base,date:'2026-10-15',operation:'PAGAMENTO_FATURA'},
    {...base,date:'2026-09-30'},{...base,date:'2026-11-01'},{...base,date:'2026-10-30',accountRef:'other'}]};
  const read=()=>monthCardActivity(snapshot,{ref:'card'},'2026-10-31');
  assert.equal(read().complete,true);
  assert.equal(read().rows.length,3);
  assert.deepEqual(read().totals.get('BRL'),{posted:4200,pending:1990,credits:500});
  purchase.pending=false;
  assert.deepEqual(read().totals.get('BRL'),{posted:6190,pending:0,credits:500});
  delete snapshot.cardFrom;
  assert.equal(read().complete,false);
});

import {openBill} from '../src/bank-overview.js';
test('A fatura considera só a parcela do ciclo e respeita o total do emissor',()=>{
  const card={ref:'card',currency:'BRL',openDueDate:'2026-12-05'};
  const purchase={accountRef:'card',billPeriod:'2026-12',currency:'BRL',direction:'Saída',amount:45};
  const rows=[purchase,{...purchase,installment:'3/10',amount:120},{...purchase,direction:'Entrada',amount:5},
    {...purchase,operation:'PAGAMENTO_FATURA',amount:400},{...purchase,billPeriod:'2027-01',amount:120}];
  const estimate=openBill(card,[],rows,'2026-11-16');
  assert.equal(estimate.amount,160);assert.equal(estimate.items.length,3);assert.equal(estimate.estimated,true);
  assert.equal(openBill({...card,openBalance:175},[],rows,'2026-11-16').amount,175);
});
