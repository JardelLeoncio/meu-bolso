import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files=new Set(['index.html','theme.js','startup.js','app.css','auth.css','cloud.js','sw.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png']);
const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',svg:'image/svg+xml',png:'image/png',webmanifest:'application/manifest+json'};
createServer(async(req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!files.has(name)||req.method!=='GET'){res.writeHead(404);res.end();return;}
  try{const data=await readFile(new URL('../'+name,import.meta.url));res.writeHead(200,{'Content-Type':types[name.split('.').pop()],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);}
  catch{res.writeHead(404);res.end();}
}).listen(4173,'127.0.0.1',()=>console.log('Meu Bolso: http://127.0.0.1:4173 (somente neste computador)'));
