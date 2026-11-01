export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
export function validDate(value) {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+'T12:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===value;
}
export function dateValue(value) {
  if(value==null || value==='')return null;
  if(!validDate(value))throw Error('Data inválida. Use uma data real do calendário.');
  return value;
}
export const displayDate = value => value ? value.split('-').reverse().join('/') : 'Não informada';
export function dueItems(document,today=localDate()) {
  const start=Date.parse(today+'T00:00:00Z');
  return Object.entries(document.months).flatMap(([month,items])=>items
    .filter(x=>x.status==='pending' && validDate(x.dueDate))
    .map(x=>({...x,month,days:Math.round((Date.parse(x.dueDate+'T00:00:00Z')-start)/86400000)})))
    .filter(x=>x.days<=6).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.name.localeCompare(b.name));
}
