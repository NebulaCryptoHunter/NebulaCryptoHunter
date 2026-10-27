import gateway from './frontend-gateway.mjs';
import html from '../../index.html';
export default {fetch(request,env,ctx){return gateway.fetch(request,{...env,ASSETS:{fetch:async r=>['/','/index.html'].includes(new URL(r.url).pathname)?new Response(html,{headers:{'Content-Type':'text/html;charset=utf-8'}}):new Response('Not found',{status:404})}},ctx)}};
