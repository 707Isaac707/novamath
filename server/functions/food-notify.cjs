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
      if(lookup?.id){const nid=crypto.randomUUID();await social.setJSON(`notification/${lookup.id}/${String(at).padStart(13,'0')}¶»§q«^