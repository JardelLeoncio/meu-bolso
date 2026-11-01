import {createECDH,randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url),file=new URL('work/push-secrets.env',root);
await mkdir(new URL('work/',root),{recursive:true});
let contents;
try{contents=await readFile(file,'utf8');}catch(error){
 if(error.code!=='ENOENT')throw error;
 const vapid=createECDH('prime256v1');vapid.generateKeys();
 contents=[`PUSH_PUBLIC_KEY=${vapid.getPublicKey().toString('base64url')}`,`PUSH_PRIVATE_KEY=${vapid.getPrivateKey().toString('base64url')}`,`PUSH_CRON_SECRET=${randomBytes(32).toString('hex')}`,'PUSH_SUBJECT=https://jardelleoncio.github.io/meu-bolso/',''].join('\n');
 await writeFile(file,contents,{flag:'wx',mode:0o600});
}
const env=Object.fromEntries(contents.trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)]}));
const vapid=createECDH('prime256v1');vapid.setPrivateKey(Buffer.from(env.PUSH_PRIVATE_KEY,'base64url'));
if(vapid.getPublicKey().toString('base64url')!==env.PUSH_PUBLIC_KEY || !/^[a-f0-9]{64}$/.test(env.PUSH_CRON_SECRET))throw Error('Configuração local inválida');
const handler=await readFile(new URL('supabase/functions/send-reminders/index.ts',root),'utf8');
const security=await readFile(new URL('supabase/functions/send-reminders/security.js',root),'utf8');
await writeFile(new URL('work/send-reminders.ts',root),handler.replace("import { allowedEndpoint, authorized } from './security.js';",security));
if(process.argv.includes('--enable-client')){
 const config=new URL('src/config.js',root),source=await readFile(config,'utf8');
 await writeFile(config,source.replace(/export const PUSH_PUBLIC_KEY = '[^']*';/,`export const PUSH_PUBLIC_KEY = '${env.PUSH_PUBLIC_KEY}';`));
 console.log('Somente a chave pública foi aplicada em src/config.js. Execute npm run build antes de publicar.');
}else console.log('Preparação concluída. Segredos privados em work/push-secrets.env; função para o editor em work/send-reminders.ts. Nada foi enviado ao servidor.');
