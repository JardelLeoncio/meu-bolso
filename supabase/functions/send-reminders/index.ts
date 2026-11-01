import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { allowedEndpoint, authorized } from './security.js';

Deno.serve(async request => {
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 const secret=Deno.env.get('PUSH_CRON_SECRET')||'';
 if(!await authorized(request.headers.get('x-cron-secret')||'',secret))return new Response('Unauthorized',{status:401});
 const publicKey=Deno.env.get('PUSH_PUBLIC_KEY'),privateKey=Deno.env.get('PUSH_PRIVATE_KEY'),subject=Deno.env.get('PUSH_SUBJECT');
 if(!publicKey || !privateKey || !subject)return new Response('Not configured',{status:503});
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 webpush.setVapidDetails(subject,publicKey,privateKey);
 const {data,error}=await admin.rpc('bolso_push_batch');
 if(error)return new Response('Queue unavailable',{status:503});
 let sent=0,failed=0;
 for(const item of data||[]) {
  let result='failed';
  try {
   if(!allowedEndpoint(item.endpoint))throw Error('Invalid endpoint');
   await webpush.sendNotification({endpoint:item.endpoint,keys:{p256dh:item.p256dh,auth:item.auth_key}},JSON.stringify({upcoming:Number(item.upcoming),overdue:Number(item.overdue),date:item.due_date}),{TTL:3600,timeout:5000,urgency:'normal'});
   result='sent';sent++;
  }catch(error){if([404,410].includes((error as {statusCode?:number}).statusCode ?? 0))result='expired';failed++;}
  const {error:updateError}=await admin.rpc('bolso_push_result',{p_id:item.id,p_status:result});
  if(updateError)console.error('Unable to record push delivery status');
 }
 return Response.json({sent,failed});
});
