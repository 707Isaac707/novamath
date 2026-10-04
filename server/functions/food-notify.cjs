const crypto=require('crypto');
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return {statusCode:405, body:JSON.stringify({error:'Method not allowed'})};
  let input={}; try{input=JSON.parse(event.body||'{}')}catch(e){return {statusCode:400, body:JSON.stringify({error:'Invalid JSON'})};}
  const esc=v=>String(v==null?'':v).slice(0,1000);
  const subtotal=Number(input.estimated_subtotal||0), fee=Number(input.delivery_fee||3), total=Number(input.estimated_total||subtotal+fee), at=Date.now();
  const order={id:crypto.randomUUID(),at,name:esc(input.name||'Unknown'),date:esc(input.date||''),delivery_window:esc(input.delivery_window||''),meeting_spot:esc(input.meeting_spot||''),notes:esc(input.notes||''),order_items:esc(input.order_items||''),estimated_subtotal:Number.isFinite(subtotal)?subtotal:0,delivery_fee:Number.isFinite(fee)?fee:3,estimated_total:Number.isFinite(total)?total:0};
  try{
    const {getStore}=require('../vercel-store.cjs');
    const platform=getStore('mediahub-platform');
    await platform.setJSON(`food-order/${String(at).padStart(13,'0')}-${order.id}`,order);
    const adminName=String(process.env.MEDIAHUB_ADMIN_USERNAME||'').trim().toLowerCase();
    if(adminName){
      const social=getStore('mediahub-social');const lookup=await social.get(`username/${adminName}`,{type:'json',consistency:'strong'});
      if(lookup?.id){const nid=crypto.randomUUID();await social.setJSON(`notification/${lookup.id}/${String(at).padStart(13,'0')}-${nid}`,{id:nid,type:'snack',title:'New Snack Drop request',body:`${order.name} · ${order.delivery_window||'Delivery'} · $${order.estimated_total.toFixed(2)} est.`,at,read:false,data:{orderId:order.id}});}
    }
  }catch(e){console.warn('Snack order log failed',e);}
  const webhook=process.env.FOOD_REQUEST_DISCORD_WEBHOOK||'';
  if(!webhook) return {statusCode:200, body:JSON.stringify({sent:false,configured:false,stored:true})};
  const payload={username:'Nova Math',embeds:[{title:'🍿 New Snack Request',description:esc(input.order_items||'No items'),color:16726080,fields:[
    {name:'For',value:esc(input.name||'Unknown'),inline:true},
    {name:'When',value:esc(`${input.date||'No date'} • ${input.delivery_window||'No window'}`),inline:true},
    {name:'Meetup',value:esc(input.meeting_spot||'Not set'),inline:false},
    {name:'Estimated price',value:`${Number.isFinite(subtotal)?'$'+subtotal.toFixed(2):'$0.00'} snacks + $${fee.toFixed(2)} delivery = ${Number.isFinite(total)?'$'+total.toFixed(2):'TBD'} estimated`,inline:false},
    {name:'Notes',value:esc(input.notes||'None'),inline:false}
  ],footer:{text:'Nova Math • Prices are estimates; actual store receipt may differ.'}}]};
  try{const r=await fetch(webhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!r.ok)throw new Error('Discord '+r.status);return {statusCode:200,body:JSON.stringify({sent:true,configured:true,stored:true})};}catch(e){return {statusCode:502,body:JSON.stringify({error:'Notification failed',sent:false,configured:true,stored:true})};}
};
