/* Preference is local to this device; no financial data is stored here. */
(() => {
 const key='meu-bolso-theme', root=document.documentElement;
 const system=window.matchMedia('(prefers-color-scheme: dark)');
 let preference='system';
 try{const saved=localStorage.getItem(key);if(['light','dark','system'].includes(saved))preference=saved;}catch{}
 function apply(){
  const dark=preference==='dark'||(preference==='system'&&system.matches);
  root.dataset.theme=dark?'dark':'light';
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=dark?'#101a2c':'#f5f7fc';
  document.querySelectorAll('input[name="theme"]').forEach(input=>{input.checked=input.value===preference;});
 }
 apply();system.addEventListener('change',apply);
 document.addEventListener('DOMContentLoaded',apply);
 document.addEventListener('change',event=>{
  if(!event.target.matches('input[name="theme"]'))return;
  const value=event.target.value;if(!['light','dark','system'].includes(value))return;
  preference=value;apply();
  let saved=true;try{localStorage.setItem(key,value);}catch{saved=false;}
  const status=document.getElementById('theme-status');
  if(status)status.textContent=saved?(value==='system'?'Acompanha o tema do aparelho.':'Tema '+(value==='dark'?'escuro':'claro')+' ativado neste aparelho.'):'Tema aplicado. Este navegador não permitiu salvar a preferência.';
 });
 window.addEventListener('storage',event=>{
  if(event.key===key || event.key===null){preference=['light','dark','system'].includes(event.newValue)?event.newValue:'system';apply();}
 });
})();
