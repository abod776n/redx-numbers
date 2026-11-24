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

 CREATE TABLE IF NOT EXISTS herosms_orders(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),activation_id TEXT,service TEXT NOT NULL,country_code TEXT NOT NULL,country_name TEXT,phone_number TEXT,provider_price NUMERIC(14,4),sale_price NUMERIC(14,4),status TEXT NOT NULL,code TEXT,sms_text TEXT,expires_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS herosms_orders_user_idx ON herosms_orders(user_id,created_at DESC);
 CREATE TABLE IF NOT EXISTS payment_requests(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),method TEXT NOT NULL,currency TEXT NOT NULL CHECK(currency IN ('USD','YER')),amount_entered NUMERIC(14,2) NOT NULL,amount_usd NUMERIC(14,4) NOT NULL,amount_yer NUMERIC(16,2) NOT NULL,sender_name TEXT NOT NULL,reference TEXT NOT NULL,proof_data TEXT,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),admin_note TEXT,reviewed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS payment_requests_user_idx ON payment_requests(user_id,created_at DESC);
 CREATE TABLE IF NOT EXISTS binance_payments(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),merchant_trade_no TEXT UNIQUE NOT NULL,prepay_id TEXT,transaction_id TEXT UNIQUE,amount_usdt NUMERIC(14,8) NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','CLOSED')),checkout_url TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),paid_at TIMESTAMPTZ);
 CREATE INDEX IF NOT EXISTS binance_payments_user_idx ON binance_payments(user_id,created_at DESC);
 CREATE TABLE IF NOT EXISTS binance_manual_claims(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),transaction_id TEXT UNIQUE NOT NULL,amount_usdt NUMERIC(14,8) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS binance_manual_claims_user_idx ON binance_manual_claims(user_id,created_at DESC);
 INSERT INTO settings(key,value) VALUES ('payment_methods', '{"fulusak":"","jeeb":"","onecash":"","cash":"","binance":""}') ON CONFLICT(key) DO NOTHING;
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 INSERT INTO settings(key,value) VALUES ('markup_percent','10') ON CONFLICT(key) DO NOTHING;
 `);
}

function binanceApiCredentials(){return {key:process.env.BINANCE_API_KEY||process.env.BINANCE_PAY_API_KEY,secret:process.env.BINANCE_API_SECRET||process.env.BINANCE_PAY_SECRET_KEY};}
async function binancePayHistory(){
 const {key,secret}=binanceApiCredentials();if(!key||!secret)throw new Error("BINANCE_API_CREDENTIALS_MISSING");
 const params=new URLSearchParams({startTime:String(Date.now()-90*24*60*60*1000),endTime:String(Date.now()),limit:"100",recvWindow:"10000",timestamp:String(Date.now())});
 const signature=crypto.createHmac("sha256",secret).update(params.toString()).digest("hex");params.set("signature",signature);
 const r=await fetch("https://api.binance.com/sapi/v1/pay/transactions?"+params.toString(),{headers:{"X-MBX-APIKEY":key}});
 const d=await r.json().catch(()=>({}));if(!r.ok||d.success===false||(d.code&&String(d.code)!=="000000"))throw new Error("BINANCE_HISTORY_API_ERROR: "+String(d.msg||d.message||d.code||r.status).slice(0,220));
 return Array.isArray(d.data)?d.data:[];
}
function binanceConfigured(){return !!(process.env.BINANCE_PAY_API_KEY&&process.env.BINANCE_PAY_SECRET_KEY);}
function binanceSign(payload){return crypto.createHmac("sha512",process.env.BINANCE_PAY_SECRET_KEY).update(payload).digest("hex").toUpperCase();}
async function binanceRequest(endpoint,body={}){const timestamp=String(Date.now()),nonce=crypto.randomBytes(16).toString("hex"),raw=JSON.stringify(body),signature=binanceSign(timestamp+"\n"+nonce+"\n"+raw+"\n");const r=await fetch("https://bpay.binanceapi.com"+endpoint,{method:"POST",headers:{"Content-Type":"application/json","BinancePay-Timestamp":timestamp,"BinancePay-Nonce":nonce,"BinancePay-Certificate-SN":process.env.BINANCE_PAY_API_KEY,"BinancePay-Signature":signature},body:raw});const d=await r.json().catch(()=>({}));if(!r.ok||d.status==="FAIL"||(d.code&&d.code!=="000000")){const detail=[`HTTP_${r.status}`,d.code||"NO_CODE",d.errorCode||"",d.errorMessage||d.message||""].filter(Boolean).join(" | ").slice(0,500);throw new Error(detail||"BINANCE_API_ERROR");}return d;}
let binanceCertCache={at:0,certs:[],legacyAt:0,legacyCerts:[]};
function certList(d){const a=d?.data?.certificates||d?.data||[];return Array.isArray(a)?a:[];}
async function binanceCertificates(force=false){if(!force&&Date.now()-binanceCertCache.at<86400000)return binanceCertCache.certs;const d=await binanceRequest("/binancepay/openapi/certificates-new",{});const certs=certList(d);binanceCertCache={...binanceCertCache,at:Date.now(),certs};return certs;}
async function binanceLegacyCertificates(force=false){if(!force&&Date.now()-binanceCertCache.legacyAt<86400000)return binanceCertCache.legacyCerts;const d=await binanceRequest("/binancepay/openapi/certificates",{});const certs=certList(d);binanceCertCache={...binanceCertCache,legacyAt:Date.now(),legacyCerts:certs};return certs;}
async function verifyBinanceWebhook(raw,h){const isNew=!!h["binancepay-certificate-sn-new"],sn=isNew?h["binancepay-certificate-sn-new"]:h["binancepay-certificate-sn"],sig=isNew?h["binancepay-signature-new"]:h["binancepay-signature"],nonce=h["binancepay-nonce"],ts=h["binancepay-timestamp"];if(!sn||!sig||!nonce||!ts||!/^\\d{32}$/.test(nonce)||!/^\\d+$/.test(ts)||Math.abs(Date.now()-Number(ts))>300000)return false;let certs=isNew?await binanceCertificates():await binanceLegacyCertificates(),cert=certs.find(x=>String(x.certSerial)===String(sn));if(!cert&&Date.now()-(isNew?binanceCertCache.at:binanceCertCache.legacyAt)>=60000){certs=isNew?await binanceCertificates(true):await binanceLegacyCertificates(true);cert=certs.find(x=>String(x.certSerial)===String(sn));}if(!cert?.certPublic)return false;try{return crypto.verify("RSA-SHA256",Buffer.from(ts+"\n"+nonce+"\n"+raw+"\n"),cert.certPublic,Buffer.from(sig,"base64"));}catch{return false;}}
async function handleBinanceWebhook(req,res){let raw="";for await(const chunk of req){raw+=chunk.toString("utf8");if(raw.length>1048576)return json(res,413,{returnCode:"FAIL",returnMessage:"BODY_TOO_LARGE"});}let event;try{event=JSON.parse(raw);}catch{return json(res,400,{returnCode:"FAIL",returnMessage:"BAD_JSON"});}if(!await verifyBinanceWebhook(raw,req.headers))return json(res,401,{returnCode:"FAIL",returnMessage:"INVALID_SIGNATURE"});if(event.bizType==="PAY"&&event.bizStatus==="PAY_SUCCESS"){let data;try{data=typeof event.data==="string"?JSON.parse(event.data):event.data;}catch{return json(res,400,{returnCode:"FAIL",returnMessage:"BAD_EVENT"});}const c=await pool.connect();try{await c.query("BEGIN");const q=await c.query("SELECT * FROM binance_payments WHERE merchant_trade_no=$1 FOR UPDATE",[String(data?.merchantTradeNo||"")]);const p=q.rows[0];if(!p){await c.query("ROLLBACK");return json(res,200,{returnCode:"SUCCESS",returnMessage:"Unknown order ignored"});}if(p.status!=="PAID"){const paid=Number(data.totalFee),expected=Number(p.amount_usdt);if(String(data.currency).toUpperCase()!=="USDT"||!Number.isFinite(paid)||Math.abs(paid-expected)>0.00000001){await c.query("ROLLBACK");return json(res,400,{returnCode:"FAIL",returnMessage:"AMOUNT_MISMATCH"});}await c.query("UPDATE users SET wallet_balance=wallet_balance+$1 WHERE id=$2",[p.amount_usdt,p.user_id]);await c.query("INSERT INTO wallet_transactions(user_id,kind,amount,description,reference) VALUES($1,'credit',$2,'شحن تلقائي عبر Binance Pay',$3)",[p.user_id,p.amount_usdt,"binance:"+p.merchant_trade_no]);await c.query("UPDATE binance_payments SET status='PAID',transaction_id=$1,paid_at=now() WHERE id=$2",[data.transactionId||null,p.id]);}await c.query("COMMIT");}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}}else if(event.bizType==="PAY"&&event.bizStatus==="PAY_CLOSED"){let data;try{data=typeof event.data==="string"?JSON.parse(event.data):event.data;}catch{data={};}if(data.merchantTradeNo)await pool.query("UPDATE binance_payments SET status='CLOSED' WHERE merchant_trade_no=$1 AND status='PENDING'",[String(data.merchantTradeNo)]);}return json(res,200,{returnCode:"SUCCESS",returnMessage:null});}

// Original servicesapi.tech provider integration.
async function provider(params){
 const key=process.env.SERVICES_API_KEY;
 if(!key) throw Object.assign(new Error("مفتاح مزود الأرقام الأول غير مضبوط في إعدادات الموقع."),{status:503});
 const url=new URL("https://servicesapi.tech/");
 for(const [k,v] of Object.entries(params)) if(v!==undefined && v!==null) url.searchParams.set(k,String(v));
 const ac=new AbortController(); const t=setTimeout(()=>ac.abort(),20000);
 try{
  const r=await fetch(url,{headers:{"X-API-Key":key,"Accept":"application/json"},signal:ac.signal});
  const data=await r.json().catch(()=>null);
  if(!data || typeof data!=="object") throw Object.assign(new Error("BAD_PROVIDER_RESPONSE"),{status:502});
  return {httpStatus:r.status,data};
 }finally{clearTimeout(t);}
}

// Independent HEROSMS integration. It never calls the original servicesapi.tech provider.
async function heroRequest(method, endpoint, body){
 const key=process.env.HEROSMS_API_KEY;
 if(!key) throw Object.assign(new Error("مفتاح HEROSMS غير مضبوط في إعدادات الاستضافة."),{status:503});
 const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),20000);
 try{
  const r=await fetch("https://hero-sms.com/api/v1"+endpoint,{method,headers:{"Authorization":"ApiKey "+key,"Accept":"application/json","Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),signal:ac.signal});
  const raw=await r.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{data={raw:raw.slice(0,500)};}
  if(!r.ok){
   const detailValue=data.details??data.errors??data.detail??data.message??data.error??data.raw;
   const detail=typeof detailValue==="string"?detailValue:(detailValue?JSON.stringify(detailValue):"");
   const title=String(data.title||data.errorCode||"").trim();
   const message=[title,detail].filter(Boolean).join(": ")||("HEROSMS_HTTP_"+r.status);
   throw Object.assign(new Error(message.slice(0,700)),{status:r.status>=500?502:400,providerStatus:r.status});
  }
  return {status:r.status,data};
 }finally{clearTimeout(timer);}
}
function heroErrorMessage(e){return e.name==="AbortError"?"انتهت مهلة الاتصال بسيرفر رقم اثنين.":String(e.message||"تعذر الاتصال بسيرفر رقم اثنين.");}

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

 // HEROSMS offers, orders and OTP are isolated from the original provider.
 if(req.method==="GET" && url.pathname==="/api/herosms/offers"){
  const service=String(url.searchParams.get("service")||"wa").toLowerCase();
  if(!/^[a-zA-Z]{2,4}$/.test(service))return json(res,400,{error:"BAD_SERVICE"});
  const result=await heroRequest("GET","/activations/offers/sms?services="+encodeURIComponent(service));
  const setting=await pool.query("SELECT value FROM settings WHERE key='markup_percent'");
  const markup=Math.min(400,Math.max(0,Number(setting.rows[0]?.value??10)));
  const rows=result.data?.data?.[service]||{};
  const offers=Object.entries(rows).map(([country,item])=>{const base=Number(item?.prices?.default??item?.prices?.retail??item?.prices?.min??0);const count=Number(item?.counts?.total??0);return {country_code:String(country),country_name:"دولة رقم "+country,price:Number((base*(1+markup/100)).toFixed(4)),provider_price:base,qty:count,available:count>0};}).filter(x=>x.price>0).sort((a,b)=>a.price-b.price);
  return json(res,200,{provider:"herosms",service,offers});
 }
 if(req.method==="GET" && url.pathname==="/api/herosms/orders"){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  const q=await pool.query("SELECT id,activation_id,service,country_code,country_name,phone_number,sale_price,status,code,sms_text,expires_at,created_at FROM herosms_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[user.id]);
  return json(res,200,{orders:q.rows});
 }
 if(req.method==="POST" && url.pathname==="/api/herosms/orders"){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  if(!rateLimit(req,"herosms-buy",5))return json(res,429,{error:"RATE_LIMITED"});
  const b=await readBody(req),service=String(b.service||"wa").toLowerCase(),country=String(b.country_code||"");
  if(!/^[a-zA-Z]{2,4}$/.test(service)||!/^[0-9]{1,3}$/.test(country))return json(res,400,{error:"اختر الخدمة والدولة بشكل صحيح."});
  const offers=await heroRequest("GET","/activations/offers/sms?services="+encodeURIComponent(service)+"&countries="+encodeURIComponent(country));
  const item=offers.data?.data?.[service]?.[country];const cost=Number(item?.prices?.default??item?.prices?.retail??item?.prices?.min??0);const qty=Number(item?.counts?.total??0);
  if(!cost||qty<1)return json(res,404,{error:"لا توجد أرقام متاحة لهذه الدولة على سيرفر رقم اثنين."});
  const setting=await pool.query("SELECT value FROM settings WHERE key='markup_percent'");
  const markup=Math.min(400,Math.max(0,Number(setting.rows[0]?.value??10))),sale=Number((cost*(1+markup/100)).toFixed(4));
  const client=await pool.connect();let localId;
  try{
   await client.query("BEGIN");const lock=await client.query("SELECT wallet_balance FROM users WHERE id=$1 FOR UPDATE",[user.id]);
   if(Number(lock.rows[0]?.wallet_balance||0)<sale){await client.query("ROLLBACK");return json(res,402,{error:"INSUFFICIENT_WALLET",required:sale,balance:Number(lock.rows[0]?.wallet_balance||0)});}
   await client.query("UPDATE users SET wallet_balance=wallet_balance-$1 WHERE id=$2",[sale,user.id]);
   const ins=await client.query("INSERT INTO herosms_orders(user_id,service,country_code,country_name,provider_price,sale_price,status) VALUES($1,$2,$3,$4,$5,$6,'processing') RETURNING id",[user.id,service,country,"دولة رقم "+country,cost,sale]);localId=ins.rows[0].id;
   await client.query("INSERT INTO wallet_transactions(user_id,kind,amount,description,reference) VALUES($1,'debit',$2,$3,$4)",[user.id,sale,"حجز رقم من سيرفر رقم اثنين","herosms:"+localId]);
   await client.query("COMMIT");
  }catch(e){try{await client.query("ROLLBACK");}catch{}throw e;}finally{client.release();}
  let bought;
  try{bought=await heroRequest("POST","/activations",{service,country:Number(country),amount:1,verificationType:"sms",maxPrice:sale});}
  catch(e){
   // Provider errors are definitive only when a normal HTTP response was received.
   if(e.providerStatus && e.providerStatus>=400 && e.providerStatus<500){const cx=await pool.connect();try{await cx.query("BEGIN");await cx.query("UPDATE herosms_orders SET status='refunded',updated_at=now() WHERE id=$1",[localId]);await cx.query("UPDATE users SET wallet_balance=wallet_balance+$1 WHERE id=$2",[sale,user.id]);await cx.query("INSERT INTO wallet_transactions(user_id,kind,amount,description,reference) VALUES($1,'refund',$2,'استرداد طلب فاشل من سيرفر رقم اثنين',$3)",[user.id,sale,"herosms:"+localId]);await cx.query("COMMIT");}catch(x){await cx.query("ROLLBACK");throw x;}finally{cx.release();}return json(res,502,{error:heroErrorMessage(e)});}
   await pool.query("UPDATE herosms_orders SET status='uncertain',updated_at=now() WHERE id=$1",[localId]);return json(res,202,{status:"uncertain",order_id:localId,message:"الشراء قيد المراجعة؛ لا تكرر الطلب."});
  }
  const raw=bought.data?.data;const activation=Array.isArray(raw)?raw[0]:(raw?.activations?.[0]||raw);
  const activationId=activation?.id??activation?.activationId,phone=activation?.phone??activation?.phoneNumber;
  if(!activationId||!phone){await pool.query("UPDATE herosms_orders SET status='uncertain',updated_at=now() WHERE id=$1",[localId]);return json(res,202,{status:"uncertain",order_id:localId,message:"استلمنا رد شراء غير مكتمل من المزود؛ الطلب قيد المراجعة ولا تعاود الشراء."});}
  const expiry=activation?.expiredAt?new Date(activation.expiredAt):null;
  await pool.query("UPDATE herosms_orders SET activation_id=$1,phone_number=$2,status='waiting',expires_at=$3,updated_at=now() WHERE id=$4",[String(activationId),String(phone),expiry,localId]);
  return json(res,201,{status:"ok",order_id:localId,number:String(phone),price:sale,expires_at:expiry});
 }
 const heroCodeMatch=url.pathname.match(/^\/api\/herosms\/orders\/(\d+)\/code$/);
 if(req.method==="GET"&&heroCodeMatch){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  const q=await pool.query("SELECT * FROM herosms_orders WHERE id=$1 AND user_id=$2",[heroCodeMatch[1],user.id]),o=q.rows[0];
  if(!o)return json(res,404,{error:"ORDER_NOT_FOUND"});
  if(o.status==="done")return json(res,200,{status:"ok",code:o.code,sms_text:o.sms_text});
  if(["refunded","uncertain"].includes(o.status))return json(res,200,{status:o.status});
  if(!o.activation_id)return json(res,409,{error:"ORDER_NOT_READY"});
  const r=await heroRequest("GET","/activations/"+encodeURIComponent(o.activation_id)+"/otp/last");
  const otp=r.data?.data??r.data?.otp??r.data;
  const code=otp?.smsCode??otp?.code;
  if(code){await pool.query("UPDATE herosms_orders SET status='done',code=$1,sms_text=$2,updated_at=now() WHERE id=$3",[String(code),String(otp?.smsText||""),o.id]);return json(res,200,{status:"ok",code:String(code),sms_text:otp?.smsText||""});}
  return json(res,200,{status:"waiting",message:"لم يصل رمز التفعيل بعد."});
 }
 const heroCancelMatch=url.pathname.match(/^\/api\/herosms\/orders\/(\d+)\/cancel$/);
 if(req.method==="POST"&&heroCancelMatch){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  const q=await pool.query("SELECT * FROM herosms_orders WHERE id=$1 AND user_id=$2",[heroCancelMatch[1],user.id]),o=q.rows[0];
  if(!o)return json(res,404,{error:"ORDER_NOT_FOUND"});
  if(o.status==="refunded")return json(res,200,{status:"refunded",message:"تم استرداد قيمة الطلب مسبقاً."});
  if(!o.activation_id||o.status!=="waiting")return json(res,409,{error:"CANNOT_CANCEL",message:"لا يمكن إلغاء هذا الطلب في حالته الحالية."});
  try{await heroRequest("DELETE","/activations/"+encodeURIComponent(o.activation_id));}
  catch(e){return json(res,e.status||502,{error:"CANCEL_NOT_CONFIRMED",message:heroErrorMessage(e)});}
  const cx=await pool.connect();try{await cx.query("BEGIN");const changed=await cx.query("UPDATE herosms_orders SET status='refunded',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='waiting' RETURNING user_id,sale_price",[o.id,user.id]);if(!changed.rowCount){await cx.query("ROLLBACK");return json(res,409,{error:"ALREADY_PROCESSED"});}await cx.query("UPDATE users SET wallet_balance=wallet_balance+$1 WHERE id=$2",[changed.rows[0].sale_price,changed.rows[0].user_id]);await cx.query("INSERT INTO wallet_transactions(user_id,kind,amount,description,reference) VALUES($1,'refund',$2,'استرداد بعد إلغاء رقم سيرفر اثنين',$3)",[changed.rows[0].user_id,changed.rows[0].sale_price,"herosms:"+o.id]);await cx.query("COMMIT");return json(res,200,{status:"refunded",message:"تم إلغاء الرقم وإعادة المبلغ إلى محفظتك."});}catch(e){await cx.query("ROLLBACK");throw e;}finally{cx.release();}
 }
 if(req.method==="POST"&&url.pathname.match(/^\/api\/herosms\/orders\/\d+\/finish$/)){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  const id=url.pathname.match(/\/(\d+)\/finish$/)[1],q=await pool.query("SELECT * FROM herosms_orders WHERE id=$1 AND user_id=$2",[id,user.id]),o=q.rows[0];
  if(!o||!o.activation_id)return json(res,404,{error:"ORDER_NOT_FOUND"});
  await heroRequest("POST","/activations/"+encodeURIComponent(o.activation_id)+"/finish",{});
  await pool.query("UPDATE herosms_orders SET status='finished',updated_at=now() WHERE id=$1",[o.id]);return json(res,200,{status:"finished"});
 }

 if(req.method==="GET" && url.pathname==="/api/countries"){
  const service=url.searchParams.get("service")||"tg";if(!["tg","wa"].includes(service))return json(res,400,{error:"BAD_SERVICE"});
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
  const b=await readBody(req);const service=b.service==="wa"?"wa":"tg";const country=String(b.country_code||"");if(!country)return json(res,400,{error:"MISSING_COUNTRY"});
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


 if(req.method==="POST"&&url.pathname==="/api/binance/verify-transfer"){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  if(!rateLimit(req,"binance-verify",5))return json(res,429,{error:"RATE_LIMITED"});
  const b=await readBody(req),transactionId=String(b.transaction_id||"").trim(),amount=Number(b.amount);
  if(!transactionId||transactionId.length<6||transactionId.length>120||/[\\s<>]/.test(transactionId))return json(res,400,{error:"أدخل رقم معاملة Binance الصحيح."});
  if(!Number.isFinite(amount)||amount<1||amount>10000)return json(res,400,{error:"أدخل مبلغاً بين 1 و10000 USDT."});
  const c=await pool.connect();
  try{
   await c.query("BEGIN");
   await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",["binance-transfer:"+transactionId]);
   const exists=await c.query("SELECT id FROM payment_requests WHERE method='binance' AND reference=$1 LIMIT 1",[transactionId]);
   if(exists.rowCount){await c.query("ROLLBACK");return json(res,409,{error:"رقم المعاملة مسجل مسبقاً. لا ترسله مرة أخرى."});}
   const amountUsd=Number(amount.toFixed(4)),amountYer=Number((amount*560).toFixed(2));
   const q=await c.query("INSERT INTO payment_requests(user_id,method,currency,amount_entered,amount_usd,amount_yer,sender_name,reference) VALUES($1,'binance','USD',$2,$3,$4,'Binance Pay',$5) RETURNING id,status,created_at",[user.id,amount,amountUsd,amountYer,transactionId]);
   await c.query("COMMIT");
   return json(res,201,{ok:true,request:q.rows[0],message:"تم استلام طلب الشحن. ستراجع الإدارة رقم المعاملة وتضيف الرصيد بعد التأكد من وصول التحويل."});
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 }
 if(req.method==="POST"&&url.pathname==="/api/jeeb/verify-transfer"){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  if(!rateLimit(req,"jeeb-verify",5))return json(res,429,{error:"RATE_LIMITED"});
  const b=await readBody(req),transactionId=String(b.transaction_id||"").trim(),amount=Number(b.amount);
  if(!transactionId||transactionId.length<4||transactionId.length>120||/[\\s<>]/.test(transactionId))return json(res,400,{error:"أدخل رقم حوالة جيب الصحيح."});
  if(!Number.isFinite(amount)||amount<560||amount>100000000)return json(res,400,{error:"أدخل مبلغاً لا يقل عن 560 ريال يمني."});
  const c=await pool.connect();
  try{
   await c.query("BEGIN");
   await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",["jeeb-transfer:"+transactionId]);
   const exists=await c.query("SELECT id FROM payment_requests WHERE method='jeeb' AND reference=$1 LIMIT 1",[transactionId]);
   if(exists.rowCount){await c.query("ROLLBACK");return json(res,409,{error:"رقم العملية مسجل مسبقاً. لا ترسله مرة أخرى."});}
   const amountYer=Number(amount.toFixed(2)),amountUsd=Number((amount/560).toFixed(4));
   const q=await c.query("INSERT INTO payment_requests(user_id,method,currency,amount_entered,amount_usd,amount_yer,sender_name,reference) VALUES($1,'jeeb','YER',$2,$3,$4,'Jeeb',$5) RETURNING id,status,created_at",[user.id,amount,amountUsd,amountYer,transactionId]);
   await c.query("COMMIT");
   return json(res,201,{ok:true,request:q.rows[0],message:"تم استلام طلب شحن جيب. ستراجع الإدارة رقم العملية وتضيف الرصيد بعد التأكد من وصول الحوالة."});
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 }
 if(req.method==="POST"&&url.pathname==="/api/binance/create-order"){
  if(!user)return json(res,401,{error:"UNAUTHORIZED"});
  if(!binanceConfigured())return json(res,503,{error:"BINANCE_NOT_CONFIGURED",message:"خدمة Binance Pay لم تُفعّل بعد؛ مفاتيح التاجر مطلوبة في إعدادات الاستضافة."});
  if(!rateLimit(req,"binance-create",5))return json(res,429,{error:"RATE_LIMITED"});
  const b=await readBody(req),amount=Number(b.amount);if(!Number.isFinite(amount)||amount<1||amount>10000)return json(res,400,{error:"أدخل مبلغاً بين 1 و10000 USDT."});
  const trade="TN"+Date.now().toString()+crypto.randomBytes(4).toString("hex").toUpperCase();
  const ins=await pool.query("INSERT INTO binance_payments(user_id,merchant_trade_no,amount_usdt) VALUES($1,$2,$3) RETURNING id",[user.id,trade,amount]);
  try{const result=await binanceRequest("/binancepay/openapi/v3/order",{env:{terminalType:"WEB"},merchantTradeNo:trade,orderAmount:Number(amount.toFixed(8)),currency:"USDT",description:"شحن محفظة طلباتي نمبر",goodsDetails:[{goodsType:"02",goodsCategory:"D000",referenceGoodsId:trade,goodsName:"Wallet top-up",goodsDetail:"Talabati Numbers wallet credit"}],webhookUrl:"https://talabati-numbers-website-production.up.railway.app/api/binance/webhook",passThroughInfo:JSON.stringify({paymentId:ins.rows[0].id,userId:user.id})});const d=result.data||{},checkout=d.checkoutUrl||d.universalUrl||d.deeplink;if(!checkout)throw new Error("No checkout URL");await pool.query("UPDATE binance_payments SET prepay_id=$1,checkout_url=$2 WHERE id=$3",[d.prepayId||null,checkout,ins.rows[0].id]);return json(res,201,{ok:true,checkout_url:checkout,merchant_trade_no:trade,amount_usdt:amount});}catch(e){await pool.query("UPDATE binance_payments SET status='CLOSED' WHERE id=$1",[ins.rows[0].id]);console.error("Binance create order:",e.message);return json(res,502,{error:"BINANCE_CREATE_FAILED",message:"تعذر إنشاء طلب Binance Pay.",diagnostic:e.message});}
 }
 if(req.method==="GET"&&url.pathname==="/api/binance/status"){if(!user)return json(res,401,{error:"UNAUTHORIZED"});const q=await pool.query("SELECT id,merchant_trade_no,amount_usdt,status,checkout_url,created_at,paid_at FROM binance_payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",[user.id]);return json(res,200,{payments:q.rows});}
 if(req.method==="GET"&&url.pathname==="/api/payment-methods"){
  const q=await pool.query("SELECT value FROM settings WHERE key='payment_methods'");
  let methods={};try{methods=JSON.parse(q.rows[0]?.value||"{}");}catch{}
  if(!methods.jeeb)methods.jeeb="محفظة جيب\nرقم المحفظة: 776531367\nاسم المستفيد: عبدالملك عارف محمد احمد\nحوّل المبلغ ثم أدخل رقم العملية في طلب الشحن.";
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
 if(req.method==="POST"&&url.pathname==="/api/binance/webhook"){try{return await handleBinanceWebhook(req,res);}catch(e){console.error("Binance webhook error:",e.message);if(!res.headersSent)return json(res,500,{returnCode:"FAIL",returnMessage:"SERVER_ERROR"});return;}}
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
