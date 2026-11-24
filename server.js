const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("railway.internal") ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
}) : null;

const mime = { ".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".ico":"image/x-icon" };
const json = (res, status, data) => { res.writeHead(status, {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"same-origin"}); res.end(JSON.stringify(data)); };
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
const token = () => crypto.randomBytes(32).toString("base64url");
const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const parseCookies = (s="") => Object.fromEntries(s.split(";").map(x=>x.trim().split("=")).filter(x=>x.length===2));
const readBody = (req) => new Promise((resolve,reject)=>{let s="";req.on("data",c=>{s+=c;if(s.length>3*1024*1024){reject(new Error("BODY_TOO_LARGE"));req.destroy();}});req.on("end",()=>{try{resolve(s?JSON.parse(s):{});}catch{reject(new Error("BAD_JSON"));}});req.on("error",reject);});
const safeUser = u => ({id:u.id,email:u.email,phone:u.phone,role:u.role,wallet_balance:Number(u.wallet_balance),created_at:u.created_at});
async function initDb(){
 if(!pool) return;
 await pool.query(`
 CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,email TEXT UNIQUE,phone TEXT UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),wallet_balance NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK(wallet_balance>=0),created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS sessions(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT UNIQUE NOT NULL,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions(token_hash);
 CREATE TABLE IF NOT EXISTS wallet_transactions(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,amount NUMERIC(14,4) NOT NULL,description TEXT NOT NULL,reference TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS number_orders(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),provider_order_id TEXT,service TEXT NOT NULL,country_code TEXT NOT NULL,country_name TEXT,phone_number TEXT,provider_price NUMERIC(14,4),sale_price NUMERIC(14,4),status TEXT NOT NULL,code TEXT,passcode TEXT,expires_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS number_orders_user_idx ON number_orders(user_id,created_at DESC);
 CREATE TABLE IF NOT EXISTS payment_requests(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),method TEXT NOT NULL,currency TEXT NOT NULL CHECK(currency IN ('USD','YER')),amount_entered NUMERIC(14,2) NOT NULL,amount_usd NUMERIC(14,4) NOT NULL,amount_yer NUMERIC(16,2) NOT NULL,sender_name TEXT NOT NULL,reference TEXT NOT NULL,proof_data TEXT,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),admin_note TEXT,reviewed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS payment_requests_user_idx ON payment_requests(user_id,created_at DESC);
 INSERT INTO settings(key,value) VALUES ('payment_methods', '{"fulusak":"","jeeb":"","onecash":"","cash":"","binance":""}') ON CONFLICT(key) DO NOTHING;
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 INSERT INTO settings(key,value) VALUES ('markup_percent','10') ON CONFLICT(key) DO NOTHING;
 `);
}
// ReadyWA Reseller API adapter. Credentials are read only from Railway environment variables.
const READYWA_BASE = (process.env.READYWA_API_BASE || "http://38.60.250.36:8888/api/v1").replace(/\/+$/, "");
async function provider(args){
 const apiKey=process.env.READYWA_API_KEY;
 if(!apiKey) throw Object.assign(new Error("مفتاح مزود الأرقام غير مضبوط في إعدادات الموقع."),{status:503});
 const call=async(method,route,body)=>{
  const response=await fetch(READYWA_BASE+route,{method,headers:{"Authorization":"Bearer "+apiKey,"Accept":"application/json","Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  let data;try{data=await response.json();}catch{data={ok:false,message:"استجابة غير صالحة من المزود"};}
  if(!response.ok || data.ok===false){
   const code=data.code||data.error||"PROVIDER_ERROR";
   const message=data.message||data.error_description||"تعذر تنفيذ الطلب لدى المزود";
   return {httpStatus:response.status||502,data:{status:"error",code,message,raw:data}};
  }
  return {httpStatus:response.status,data};
 };
 if(args.action==="balance"){
  const r=await call("GET","/balance");
  if(r.data.status==="error")return r;
  return {httpStatus:r.httpStatus,data:{status:"ok",balance:Number(r.data.data?.balance_usd||0),currency:"USD"}};
 }
 if(args.action==="available_countries"){
  const sectionMap={wa:"readywa",tg:"telegram",readywa:"readywa",closed:"closed",premium:"premium",telegram:"telegram"};
  const section=sectionMap[args.service]||"readywa";
  const r=await call("GET","/services?section="+encodeURIComponent(section));
  if(r.data.status==="error")return r;
  const list=r.data.data?.services;
  if(!Array.isArray(list))return {httpStatus:502,data:{status:"error",code:"BAD_SERVICES_RESPONSE",message:"لم يرجع المزود قائمة خدمات صالحة."}};
  const countries={};
  for(const item of list){
   const id=String(item.service_id||"");if(!id)continue;
   countries[id]={service_id:id,section:item.section||section,name:item.name||id,name_ar:item.name||id,dial_code:item.dial_code||"",price:Number(item.price_usd)||0,qty:Number(item.stock)||0,available:!!item.available};
  }
  return {httpStatus:r.httpStatus,data:{status:"ok",countries}};
 }
 if(args.action==="getNumber"){
  const r=await call("POST","/orders",{service_id:String(args.country_code||"")});
  if(r.data.status==="error")return r;
  const d=r.data.data||{};
  return {httpStatus:r.httpStatus,data:{status:"ok",order_id:d.order_id,Number:d.phone_number,price:d.price_usd,expires_in:86400,raw:d}};
 }
 if(args.action==="getCode"){
  const r=await call("POST","/orders/"+encodeURIComponent(String(args.order_id))+"/code",args.new_code?{new_code:true}:undefined);
  if(r.data.status==="error"){
   const code=r.data.code;
   if(code==="ORDER_NOT_FOUND")return {httpStatus:r.httpStatus,data:{status:"error",code:"ORDER_NOT_FOUND",message:r.data.message}};
   return r;
  }
  const d=r.data.data||{};
  if(d.code)return {httpStatus:r.httpStatus,data:{status:"ok",code:d.code,pass:"",phone_number:d.phone_number}};
  if(["expired","cancelled","refunded","failed"].includes(String(d.status||"").toLowerCase()))return {httpStatus:r.httpStatus,data:{status:"error",code:"EXPIRED",message:d.status}};
  return {httpStatus:r.httpStatus,data:{status:"waiting",expires_in:d.expires_in||0}};
 }
 if(args.action==="cancel")return await call("POST","/orders/"+encodeURIComponent(String(args.order_id))+"/cancel");
 if(args.action==="finish")return await call("POST","/orders/"+encodeURIComponent(String(args.order_id))+"/finish");
 throw Object.assign(new Error("إجراء غير مدعوم في مزود الأرقام."),{status:400});
}
async function auth(req){
 if(!pool) return null;
 const c=parseCookies(req.headers.cookie); if(!c.talabati_session) return null;
 const q=await pool.query("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",[hash(c.talabati_session)]);
 return q.rows[0]||null;
}
const rateMap=new Map();
function rateLimit(req,key,limit=15){
 const ip=(req.headers["x-forwarded-for"]||"unknown").split(",")[0].trim();const k=ip+":"+key;const now=Date.now();const old=rateMap.get(k)||[];const fresh=old.filter(x=>now-x<60000);if(fresh.length>=limit)return false;fresh.push(now);rateMap.set(k,fresh);return true;
}
async function handleApi(req,res,url){
 if(!pool) return json(res,503,{error:"DATABASE_NOT_CONFIGURED"});
 if(req.method==="POST" && url.pathname==="/api/register"){
  if(!rateLimit(req,"register",5))return json(res,429,{error:"RATE_LIMITED"});
  const b=await readBody(req);const email=String(b.email||"").trim().toLowerCase();const phone=String(b.phone||"").trim();const password=String(b.password||"");
  if((!email&&!phone)||password.length<10||password.length>200)return json(res,400,{error:"أدخل البريد أو الهاتف وكلمة مرور لا تقل عن 10 أحرف."});
  const passwordHash=await new Promise((resolve,reject)=>crypto.scrypt(password,process.env.SESSION_SECRET||"talabati",64,(e,k)=>e?reject(e):resolve(k.toString("hex"))));
  try{const q=await pool.query("INSERT INTO users(email,phone,password_hash) VALUES($1,$2,$3) RETURNING *",[email||null,phone||null,passwordHash]);const t=token();await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')",[q.rows[0].id,hash(t)]);res.setHeader("Set-Cookie",cookie("talabati_session",t,2592000));return json(res,201,{user:safeUser(q.rows[0])});}
  catch(e){if(e.code==="23505")return json(res,409,{error:"البريد الإلكتروني أو رقم الهاتف مستخدم مسبقاً."});throw e;}
 }
 if(req.method==="POST" && url.pathname==="/api/login"){
  if(!rateLimit(req,"login",10))return json(res,429,{error:"RATE_LIMITED"});
  const b=await readBody(req);const identity=String(b.identity||"").trim().toLowerCase();const password=String(b.password||"");
  const q=await pool.query("SELECT * FROM users WHERE lower(coalesce(email,''))=$1 OR phone=$2 LIMIT 1",[identity,identity]);
  const u=q.rows[0];if(!u)return json(res,401,{error:"بيانات الدخول غير صحيحة."});
  const p=await new Promise((resolve,reject)=>crypto.scrypt(password,process.env.SESSION_SECRET||"talabati",64,(e,k)=>e?reject(e):resolve(k.toString("hex"))));
  if(!crypto.timingSafeEqual(Buffer.from(p,"hex"),Buffer.from(u.password_hash,"hex")))return json(res,401,{error:"بيانات الدخول غير صحيحة."});
  const t=token();await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')",[u.id,hash(t)]);res.setHeader("Set-Cookie",cookie("talabati_session",t,2592000));return json(res,200,{user:safeUser(u)});
 }
 if(req.method==="POST" && url.pathname==="/api/logout"){
  const c=parseCookies(req.headers.cookie);if(c.talabati_session)await pool.query("DELETE FROM sessions WHERE token_hash=$1",[hash(c.talabati_session)]);res.setHeader("Set-Cookie",cookie("talabati_session","",0));return json(res,200,{ok:true});
 }
 const user=await auth(req);
 if(req.method==="GET" && url.pathname==="/api/me")return user?json(res,200,{user:safeUser(user)}):json(res,401,{error:"UNAUTHORIZED"});
 if(url.pathname.startsWith("/api/admin/") && url.pathname!=="/api/admin/setup" && (!user||user.role!=="admin"))return json(res,403,{error:"ADMIN_ONLY"});
 if(req.method==="POST" && url.pathname==="/api/admin/setup"){
  if(!process.env.ADMIN_SETUP_TOKEN)return json(res,503,{error:"ADMIN_SETUP_TOKEN_NOT_CONFIGURED"});
  const b=await readBody(req);const supplied=Buffer.from(String(b.setupToken||""));const expected=Buffer.from(process.env.ADMIN_SETUP_TOKEN);if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))return json(res,403,{error:"INVALID_SETUP_TOKEN"});
  const count=await pool.query("SELECT count(*)::int AS n FROM users WHERE role='admin'");if(count.rows[0].n>0)return json(res,409,{error:"ADMIN_ALREADY_EXISTS"});
  const email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");if(!email||password.length<14)return json(res,400,{error:"استخدم بريد مدير وكلمة مرور لا تقل عن 14 حرفاً."});
  const ph=await new Promise((resolve,reject)=>crypto.scrypt(password,process.env.SESSION_SECRET||"talabati",64,(e,k)=>e?reject(e):resolve(k.toString("hex"))));
  const q=await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'admin') ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='admin' RETURNING *",[email,ph]);return json(res,201,{user:safeUser(q.rows[0])});
 }
 if(req.method==="GET" && url.pathname==="/api/provider/balance"){
  if(!user||user.role!=="admin")return json(res,403,{error:"ADMIN_ONLY"});
  const r=await provider({action:"balance"});return json(res,r.httpStatus,r.data);
 }
 if(req.method==="GET" && url.pathname==="/api/countries"){
  const service=url.searchParams.get("service")||"telegram";if(!["telegram","readywa","closed","premium","tg","wa"].includes(service))return json(res,400,{error:"BAD_SERVICE"});
   const r=await provider({action:"available_countries",service});if(r.data?.status!=="ok"||!r.data.countries)return json(res,r.httpStatus,r.data);
   const setting=await pool.query("SELECT value FROM settings WHERE key='markup_percent'");const markup=Math.min(400,Math.max(0,Number(setting.rows[0]?.value??10)));
   const countries=Object.fromEntries(Object.entries(r.data.countries).map(([code,item])=>{const providerPrice=Number(item.price)||0;const salePrice=Number((providerPrice*(1+markup/100)).toFixed(4));return [code,{...item,price:salePrice}]}));
   return json(res,200,{...r.data,countries});
 }
 if(req.method==="GET" && url.pathname==="/api/orders"){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  const q=await pool.query("SELECT id,provider_order_id,service,country_code,country_name,phone_number,sale_price,status,code,passcode,expires_at,created_at FROM number_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[user.id]);return json(res,200,{orders:q.rows});
 }
 if(req.method==="POST" && url.pathname==="/api/orders"){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  if(!rateLimit(req,"buy",5))return json(res,429,{error:"RATE_LIMITED"});
  const b=await readBody(req);const service=["readywa","closed","premium","telegram","wa","tg"].includes(String(b.service))?String(b.service):"telegram";const country=String(b.country_code||"");if(!country)return json(res,400,{error:"MISSING_COUNTRY"});
  const countries=await provider({action:"available_countries",service});if(countries.data.status!=="ok")return json(res,countries.httpStatus,countries.data);
  const entry=countries.data.countries?.[country];if(!entry||Number(entry.qty)<=0)return json(res,404,{error:"COUNTRY_UNAVAILABLE"});
  const setting=await pool.query("SELECT value FROM settings WHERE key='markup_percent'");const markup=Math.min(400,Math.max(0,Number(setting.rows[0]?.value??10)));
  const cost=Number(entry.price);const sale=Number((cost*(1+markup/100)).toFixed(4));
  const client=await pool.connect();
  try{
   await client.query("BEGIN");
   const lock=await client.query("SELECT wallet_balance FROM users WHERE id=$1 FOR UPDATE",[user.id]);
   if(Number(lock.rows[0].wallet_balance)<sale){await client.query("ROLLBACK");return json(res,402,{error:"INSUFFICIENT_WALLET",required:sale,balance:Number(lock.rows[0].wallet_balance)});}
   await client.query("UPDATE users SET wallet_balance=wallet_balance-$1 WHERE id=$2",[sale,user.id]);
   const ins=await client.query("INSERT INTO number_orders(user_id,service,country_code,country_name,provider_price,sale_price,status) VALUES($1,$2,$3,$4,$5,$6,'processing') RETURNING id",[user.id,service,country,entry.name_ar||entry.name||country,cost,sale]);
   await client.query("INSERT INTO wallet_transactions(user_id,kind,amount,description,reference) VALUES($1,'debit',$2,$3,$4)",[user.id,sale,"حجز رقم "+(entry.name_ar||country),"order:"+ins.rows[0].id]);
   await client.query("COMMIT");
   const localId=ins.rows[0].id;
   let result;
   try{result=await provider({action:"getNumber",service,country_code:country,maxPrice:cost.toFixed(4)});}
   catch(e){await pool.query("UPDATE number_orders SET status='uncertain',updated_at=now() WHERE id=$1",[localId]);return json(res,202,{status:"uncertain",order_id:localId,message:"نتيجة الشراء غير مؤكدة. لا تكرر الطلب؛ تتم المراجعة قبل أي استرداد."});}
   const d=result.data;
   if(d.status==="ok"){
    await pool.query("UPDATE number_orders SET provider_order_id=$1,phone_number=$2,status='waiting',expires_at=now()+($3 * interval '1 second'),updated_at=now() WHERE id=$4",[String(d.order_id),d.Number,Number(d.expires_in)||3600,localId]);
    return json(res,201,{status:"ok",order_id:localId,number:d.Number,country:entry.name_ar||entry.name,price:sale,expires_in:d.expires_in});
   }
   if(d.code==="UNCERTAIN"||result.httpStatus===202){await pool.query("UPDATE number_orders SET status='uncertain',updated_at=now() WHERE id=$1",[localId]);return json(res,202,{status:"uncertain",order_id:localId,message:"الشراء قيد المراجعة؛ لا تكرر الطلب."});}
   await pool.query("BEGIN");await pool.query("UPDATE users SET wallet_balance=wallet_balance+$1 WHERE id=$2",[sale,user.id]);await pool.query("INSERT INTO wallet_transactions(user_id,kind,amount,description,reference) VALUES($1,'refund',$2,$3,$4)",[user.id,sale,"استرداد طلب فاشل","order:"+localId]);await pool.query("UPDATE number_orders SET status='refunded',updated_at=now() WHERE id=$1",[localId]);await pool.query("COMMIT");
   return json(res,result.httpStatus||400,{status:"error",code:d.code||"PROVIDER_ERROR",message:d.message||"تعذر توفير الرقم وتم رد المبلغ."});
  }catch(e){try{await client.query("ROLLBACK");}catch{}throw e;}finally{client.release();}
 }
 const codeMatch=url.pathname.match(/^\/api\/orders\/(\d+)\/code$/);
 if(req.method==="GET"&&codeMatch){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  const q=await pool.query("SELECT * FROM number_orders WHERE id=$1 AND user_id=$2",[codeMatch[1],user.id]);const o=q.rows[0];if(!o)return json(res,404,{error:"ORDER_NOT_FOUND"});
  if(o.status==="done")return json(res,200,{status:"ok",code:o.code,pass:o.passcode});
  if(["refunded","uncertain"].includes(o.status))return json(res,200,{status:o.status});
  if(!o.provider_order_id)return json(res,409,{error:"ORDER_NOT_READY"});
  const r=await provider({action:"getCode",order_id:o.provider_order_id});
  if(r.data.status==="ok"){await pool.query("UPDATE number_orders SET status='done',code=$1,passcode=$2,updated_at=now() WHERE id=$3",[r.data.code,r.data.pass||"",o.id]);return json(res,200,{status:"ok",code:r.data.code,pass:r.data.pass||""});}
  if(r.data.code==="EXPIRED"||r.data.code==="REFUNDED"){const c=await pool.connect();try{await c.query("BEGIN");const changed=await c.query("UPDATE number_orders SET status='refunded',updated_at=now() WHERE id=$1 AND status='waiting' RETURNING user_id,sale_price",[o.id]);if(changed.rowCount){await c.query("UPDATE users SET wallet_balance=wallet_balance+$1 WHERE id=$2",[changed.rows[0].sale_price,changed.rows[0].user_id]);await c.query("INSERT INTO wallet_transactions(user_id,kind,amount,description,reference) VALUES($1,'refund',$2,'استرداد تلقائي لانتهاء الرقم',$3)",[changed.rows[0].user_id,changed.rows[0].sale_price,"order:"+o.id]);}await c.query("COMMIT");}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}return json(res,200,{status:"refunded",code:r.data.code});}
  return json(res,r.httpStatus,{status:r.data.status||"waiting",expires_in:r.data.expires_in});
 }

 const cancelMatch=url.pathname.match(/^\/api\/orders\/(\d+)\/cancel$/);
 if(req.method==="POST"&&cancelMatch){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  const q=await pool.query("SELECT * FROM number_orders WHERE id=$1 AND user_id=$2",[cancelMatch[1],user.id]);const o=q.rows[0];if(!o)return json(res,404,{error:"ORDER_NOT_FOUND"});
  if(o.status==="refunded")return json(res,200,{status:"refunded",message:"تم استرداد قيمة الطلب مسبقاً."});
  if(!["waiting","done"].includes(o.status)||!o.provider_order_id)return json(res,409,{error:"CANNOT_CANCEL",message:"لا يمكن إلغاء هذا الطلب من حالته الحالية."});
  const r=await provider({action:"cancel",order_id:o.provider_order_id});
  const providerStatus=String(r.data?.status||"").toLowerCase();
  const confirmed=r.httpStatus>=200&&r.httpStatus<300&&(r.data?.success===true||["cancelled","canceled","refunded","success","ok"].includes(providerStatus));
  if(!confirmed)return json(res,409,{error:"CANCEL_NOT_CONFIRMED",message:r.data?.message||"لم يؤكد المزود إلغاء الطلب؛ لم يتم رد الرصيد. تواصل مع الدعم للمراجعة."});
  const c=await pool.connect();try{await c.query("BEGIN");const changed=await c.query("UPDATE number_orders SET status='refunded',updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('waiting','done') RETURNING user_id,sale_price",[o.id,user.id]);if(!changed.rowCount){await c.query("ROLLBACK");return json(res,409,{error:"ALREADY_PROCESSED"});}await c.query("UPDATE users SET wallet_balance=wallet_balance+$1 WHERE id=$2",[changed.rows[0].sale_price,changed.rows[0].user_id]);await c.query("INSERT INTO wallet_transactions(user_id,kind,amount,description,reference) VALUES($1,'refund',$2,'استرداد بعد إلغاء طلب الرقم',$3)",[changed.rows[0].user_id,changed.rows[0].sale_price,"order:"+o.id]);await c.query("COMMIT");return json(res,200,{status:"refunded",message:"تم إلغاء الطلب وإعادة المبلغ إلى محفظتك."});}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 }

 if(req.method==="GET"&&url.pathname==="/api/payment-methods"){
  const q=await pool.query("SELECT value FROM settings WHERE key='payment_methods'");
  let methods={};try{methods=JSON.parse(q.rows[0]?.value||"{}");}catch{}
  return json(res,200,{exchange_rate:560,methods});
 }
 if(req.method==="POST"&&url.pathname==="/api/payment-requests"){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  if(!rateLimit(req,"payment-request",5))return json(res,429,{error:"RATE_LIMITED"});
  const b=await readBody(req);const method=String(b.method||"");const currency=String(b.currency||"USD");
  const amount=Number(b.amount);const sender=String(b.sender_name||"").trim().slice(0,120);const reference=String(b.reference||"").trim().slice(0,120);
  const allowed=["fulusak","jeeb","onecash","cash","binance"];
  if(!allowed.includes(method)||!["USD","YER"].includes(currency)||!Number.isFinite(amount)||amount<=0||amount>100000000||!sender||!reference)return json(res,400,{error:"أكمل بيانات التحويل والمبلغ ورقم العملية."});
  const amountUsd=Number((currency==="USD"?amount:amount/560).toFixed(4));const amountYer=Number((currency==="YER"?amount:amount*560).toFixed(2));
  if(amountUsd<1)return json(res,400,{error:"الحد الأدنى لطلب الشحن دولار واحد."});
  let proof=b.proof_data?String(b.proof_data):null;
  if(proof&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(proof)||proof.length>2500000))return json(res,400,{error:"صورة الإثبات يجب أن تكون PNG أو JPG أو WEBP وأقل من 1.8 ميجابايت."});
  const q=await pool.query("INSERT INTO payment_requests(user_id,method,currency,amount_entered,amount_usd,amount_yer,sender_name,reference,proof_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,status,created_at",[user.id,method,currency,amount,amountUsd,amountYer,sender,reference,proof]);
  return json(res,201,{request:q.rows[0],message:"تم استلام طلب الدفع وسيظهر رصيدك بعد مراجعة الإدارة."});
 }
 if(req.method==="GET"&&url.pathname==="/api/payment-requests"){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  const q=await pool.query("SELECT id,method,currency,amount_entered,amount_usd,amount_yer,sender_name,reference,status,admin_note,created_at,reviewed_at FROM payment_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",[user.id]);
  return json(res,200,{requests:q.rows});
 }
 if(req.method==="GET"&&url.pathname==="/api/admin/payment-methods"){
  const q=await pool.query("SELECT value FROM settings WHERE key='payment_methods'");let methods={};try{methods=JSON.parse(q.rows[0]?.value||"{}");}catch{}
  return json(res,200,{methods});
 }
 if(req.method==="POST"&&url.pathname==="/api/admin/payment-methods"){
  const b=await readBody(req);const allowed=["fulusak","jeeb","onecash","cash","binance"];const methods={};
  for(const k of allowed)methods[k]=String(b.methods?.[k]||"").trim().slice(0,500);
  await pool.query("INSERT INTO settings(key,value) VALUES('payment_methods',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[JSON.stringify(methods)]);
  return json(res,200,{ok:true,methods});
 }
 if(req.method==="GET"&&url.pathname==="/api/admin/payment-requests"){
  const q=await pool.query("SELECT p.id,p.user_id,p.method,p.currency,p.amount_entered,p.amount_usd,p.amount_yer,p.sender_name,p.reference,p.proof_data,p.status,p.admin_note,p.created_at,u.email,u.phone FROM payment_requests p JOIN users u ON u.id=p.user_id ORDER BY CASE WHEN p.status='pending' THEN 0 ELSE 1 END,p.created_at DESC LIMIT 200");
  return json(res,200,{requests:q.rows});
 }
 const paymentReview=url.pathname.match(/^\/api\/admin\/payment-requests\/(\d+)\/(approve|reject)$/);
 if(req.method==="POST"&&paymentReview){
  const id=Number(paymentReview[1]);const action=paymentReview[2];const b=await readBody(req);const c=await pool.connect();
  try{
   await c.query("BEGIN");
   const q=await c.query("SELECT * FROM payment_requests WHERE id=$1 FOR UPDATE",[id]);const p=q.rows[0];
   if(!p){await c.query("ROLLBACK");return json(res,404,{error:"طلب الدفع غير موجود."});}
   if(p.status!=="pending"){await c.query("ROLLBACK");return json(res,409,{error:"تمت مراجعة هذا الطلب مسبقاً."});}
   if(action==="approve"){
    await c.query("UPDATE users SET wallet_balance=wallet_balance+$1 WHERE id=$2",[p.amount_usd,p.user_id]);
    await c.query("INSERT INTO wallet_transactions(user_id,kind,amount,description,reference) VALUES($1,'credit',$2,$3,$4)",[p.user_id,p.amount_usd,"شحن محفظة بعد قبول الدفع اليدوي","payment:"+p.id]);
    await c.query("UPDATE payment_requests SET status='approved',admin_note=$1,reviewed_at=now() WHERE id=$2",[String(b.note||"تم التحقق من الدفع").slice(0,500),id]);
   }else{
    await c.query("UPDATE payment_requests SET status='rejected',admin_note=$1,reviewed_at=now() WHERE id=$2",[String(b.note||"تعذر التحقق من الدفع").slice(0,500),id]);
   }
   await c.query("COMMIT");return json(res,200,{ok:true,status:action==="approve"?"approved":"rejected"});
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 }
 if(req.method==="GET"&&url.pathname==="/api/wallet"){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  const q=await pool.query("SELECT id,kind,amount,description,reference,created_at FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[user.id]);return json(res,200,{balance:Number(user.wallet_balance),transactions:q.rows});
 }
 if(req.method==="GET"&&url.pathname==="/api/admin/users"){
   const q=await pool.query("SELECT id,email,phone,role,wallet_balance,created_at FROM users ORDER BY created_at DESC LIMIT 200");return json(res,200,{users:q.rows});
  }
  if(req.method==="GET"&&url.pathname==="/api/admin/orders"){
   const q=await pool.query("SELECT o.id,o.phone_number,o.status,o.sale_price,o.created_at,u.email,u.phone FROM number_orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 200");return json(res,200,{orders:q.rows});
  }
  if(req.method==="GET"&&url.pathname==="/api/admin/overview"){
  const [u,o,w]=await Promise.all([pool.query("SELECT count(*)::int n FROM users WHERE role='customer'"),pool.query("SELECT count(*)::int n FROM number_orders"),pool.query("SELECT coalesce(sum(sale_price),0)::numeric total FROM number_orders WHERE status='done'")]);return json(res,200,{customers:u.rows[0].n,orders:o.rows[0].n,sales:Number(w.rows[0].total)});
 }
 if(req.method==="POST"&&url.pathname==="/api/admin/markup"){
  const b=await readBody(req);const v=Number(b.percent);if(!Number.isFinite(v)||v<0||v>400)return json(res,400,{error:"MARKUP_RANGE_0_400"});await pool.query("INSERT INTO settings(key,value) VALUES('markup_percent',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[String(v)]);return json(res,200,{markup_percent:v});
 }
 if(req.method==="POST"&&url.pathname==="/api/admin/wallet/credit"){
  const b=await readBody(req);const email=String(b.email||"").trim().toLowerCase();const amount=Number(b.amount);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!Number.isFinite(amount)||amount<=0||amount>10000)return json(res,400,{error:"BAD_CREDIT"});
  const c=await pool.connect();try{await c.query("BEGIN");const q=await c.query("UPDATE users SET wallet_balance=wallet_balance+$1 WHERE lower(email)=lower($2) RETURNING id,email",[amount,email]);if(!q.rowCount){await c.query("ROLLBACK");return json(res,404,{error:"USER_NOT_FOUND"});}await c.query("INSERT INTO wallet_transactions(user_id,kind,amount,description) VALUES($1,'credit',$2,'شحن يدوي من الإدارة')",[q.rows[0].id,amount]);await c.query("COMMIT");return json(res,200,{ok:true,email:q.rows[0].email});}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 }
 return json(res,404,{error:"NOT_FOUND"});
}

async function main(req,res){
 let url;try{url=new URL(req.url,"http://localhost");}catch{return res.writeHead(400).end();}
 if(url.pathname.startsWith("/api/")){
  try{return await handleApi(req,res,url);}catch(e){console.error("API error",e.message);if(!res.headersSent)return json(res,e.status||500,{error:e.message==="BODY_TOO_LARGE"?"BODY_TOO_LARGE":e.message==="BAD_JSON"?"BAD_JSON":"SERVER_ERROR"});return;}
 }
 if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405,{Allow:"GET, HEAD"});return res.end("Method not allowed");}
 let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{res.writeHead(400);return res.end("Bad request");}
 if(pathname==="/")pathname="/index.html";const file=path.resolve(root,"."+pathname);
 if(!file.startsWith(root+path.sep)&&file!==path.join(root,"index.html")){res.writeHead(403);return res.end("Forbidden");}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(err.code==="ENOENT"?404:500);return res.end(err.code==="ENOENT"?"Not found":"Server error");}res.writeHead(200,{"Content-Type":mime[path.extname(file).toLowerCase()]||"application/octet-stream","Cache-Control":"no-cache","X-Content-Type-Options":"nosniff"});res.end(data);});
}
const server=http.createServer((req,res)=>{main(req,res).catch(e=>{console.error(e);if(!res.headersSent)json(res,500,{error:"SERVER_ERROR"});});});
server.on("error",e=>{console.error("HTTP server failed",e);process.exit(1);});
(async()=>{try{await initDb();server.listen(port,"0.0.0.0",()=>console.log("Talabati Numbers backend listening on "+port));}catch(e){console.error("Database initialization failed",e);process.exit(1);}})();
