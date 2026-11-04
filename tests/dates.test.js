import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validDate,dateValue,localDate,dueItems} from '../src/dates.js';
test('Datas reais, legado e próximo vencimento entre meses',()=>{
 assert.equal(validDate('2026-02-29'),false);assert.equal(validDate('2028-02-29'),true);
 assert.equal(validDate('2026-13-01'),false);assert.equal(dateValue(undefined),null);
 assert.throws(()=>dateValue('2026-02-31'));assert.equal(localDate(new Date(2026,10,1,23,50)),'2026-11-01');
 const items=[['old','2026-10-30','pending'],['today','2026-10-31','pending'],['six','2026-11-06','pending'],['seven','2026-11-07','pending'],['paid','2026-11-01','paid'],['unknown','2026-11-01','unknown'],['empty',null,'pending']].map(([name,dueDate,status])=>({name,dueDate,status}));
 assert.deepEqual(dueItems({months:{'2026-09':items}},'2026-10-31').map(x=>[x.name,x.days]),[['old',-1],['today',0]]);
});

test('Radar restrito aos próximos três dias, com atrasadas',()=>{
 const item=(name,dueDate,status='pending')=>({name,dueDate,status});
 const doc={months:{'2026-11':[item('A','2026-11-20'),item('B','2026-11-20'),item('C','2026-11-21'),item('Pago','2026-11-02','paid')],'2026-10':[item('Atrasada','2026-10-30'),item('Sem data',null),item('Inválida','2026-02-31')]}};
 assert.deepEqual(dueItems(doc,'2026-11-01').map(x=>x.name),['Atrasada']);
 assert.deepEqual(dueItems({months:{}},'2026-11-01'),[]);
 assert.deepEqual(dueItems({months:{'2026-10':[item('Antiga','2026-10-01')]}},'2026-11-01').map(x=>x.name),['Antiga']);
});

test('Radar inclui hoje até três dias e exclui o quarto dia',()=>{const doc={months:{'2026-11':[0,1,2,3,4].map(n=>({name:String(n),dueDate:'2026-11-0'+(n+1),status:'pending'}))}};assert.deepEqual(dueItems(doc,'2026-11-01').map(x=>x.days),[0,1,2,3]);});
