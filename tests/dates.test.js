import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validDate,dateValue,localDate,dueItems} from '../src/dates.js';
test('Datas reais, legado e janela de seis dias entre meses',()=>{
 assert.equal(validDate('2026-02-29'),false);assert.equal(validDate('2028-02-29'),true);
 assert.equal(validDate('2026-13-01'),false);assert.equal(dateValue(undefined),null);
 assert.throws(()=>dateValue('2026-02-31'));assert.equal(localDate(new Date(2026,10,1,23,50)),'2026-11-01');
 const items=[['old','2026-10-30','pending'],['today','2026-10-31','pending'],['six','2026-11-06','pending'],['seven','2026-11-07','pending'],['paid','2026-11-01','paid'],['unknown','2026-11-01','unknown'],['empty',null,'pending']].map(([name,dueDate,status])=>({name,dueDate,status}));
 assert.deepEqual(dueItems({months:{'2026-09':items}},'2026-10-31').map(x=>[x.name,x.days]),[['old',-1],['today',0],['six',6]]);
});
