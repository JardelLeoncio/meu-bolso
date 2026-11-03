import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categoryFor, summarize} from '../src/finance.js';

test('Fluxo por conta e consumo por categoria usam bases distintas',()=>{
  const row=(description,amount,changes={})=>({description,amount,account:'Conta',direction:'Saída',currency:'BRL',...changes});
  const rows=[
    row('Folha de pagamento',3500,{direction:'Entrada'}),row('Supermercado',120.32),
    row('iFood',35.45,{account:'Cartão'}),row('Posto de gasolina',90,{account:'Cartão'}),
    row('Pagamento da fatura',125.45,{operation:'PAGAMENTO_FATURA'}),
    row('Pix enviado',500,{chosen:'transfer'}),row('Pix recebido',500,{direction:'Entrada',chosen:'transfer'}),
    row('Devolução',10,{account:'Cartão',direction:'Entrada'}),row('Restaurante',99,{pending:true}),
    row('Mercado Pago',17),row('Restaurante',50,{currency:'USD'}),row('Farmácia',80,{absent:true}),
  ];
  const r=summarize(rows);
  assert.equal(r.cashIn,350000);assert.equal(r.cashOut,26277);
  assert.deepEqual(r.spending,{market:12032,food:3545,fuel:9000});
  assert.equal(r.origins.salary,350000);assert.equal(r.pending,1);assert.equal(r.foreign,1);assert.equal(r.absent,1);
  assert.equal(categoryFor(row('Supermercado',30,{chosen:'food'})),'food');
  assert.equal(categoryFor(row('Mercado Pago',30)),'review');
  assert.equal(categoryFor(row('Pix enviado',10)),'review');
});
