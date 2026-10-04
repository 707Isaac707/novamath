export async function runLegacy(req,res,handler){
  try{
    let body='';
    if(req.method!=='GET'&&req.method!=='HEAD'){
      if(typeof req.body==='string') body=req.body;
      else if(req.body!=null) body=JSON.stringify(req.body);
    }
    const proto=(req.headers['x-forwarded-proto']||'https').toString().split(',')[0].trim();
    const host=req.headers.host||'localhost';
    const rawUrl=`${proto}://${host}${req.url||''}`;
    const event={
      httpMethod:req.method||'GET',
      headers:req.headers||{},
      body,
      rawUrl,
      queryStringParameters:req.query||{}
    };
    const out=await handler(event);
    const status=Number(out?.statusCode)||200;
    res.statusCode=status;
    for(const [k,v] of Object.entries(out?.headers||{})){
      if(v!=null)res.setHeader(k,String(v));
    }
    if(out?.isBase64Encoded){
      res.end(Buffer.from(out.body||'','base64'));
    }else{
      res.end(out?.body??'');
    }
  }catch(err){
    console.error('Vercel bridge error',err);
    if(!res.headersSent)res.setHeader('Content-Type','application/json; charset=utf-8');
    res.statusCode=500;
    res.end(JSON.stringify({error:'Server function failed.'}));
  }
}
