// The launch screen ends as soon as the initial account check settles.
(() => {
 const timer=setTimeout(()=>{
  if(!document.body.classList.contains('launching'))return;
  document.getElementById('launch-message').hidden=false;
  document.getElementById('launch-retry').hidden=false;
 },12000);
 window.addEventListener('bolso-ready',()=>clearTimeout(timer),{once:true});
 document.getElementById('launch-retry').addEventListener('click',()=>location.reload());
})();
