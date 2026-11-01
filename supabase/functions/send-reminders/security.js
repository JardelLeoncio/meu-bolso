export function allowedEndpoint(value = '') {
 try{const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && !u.port && !u.hash && ['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].includes(u.hostname);}catch{return false;}
}
export async function authorized(provided = '',expected = '') {
 if(expected.length<32 || provided.length>256)return false;
 const hash=async (s = '')=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [a,b]=await Promise.all([hash(provided),hash(expected)]);let difference=0;
 for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;
}
