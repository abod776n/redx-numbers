const $=id=>document.getElementById(id);
let countries={},me=null;
const serviceLabels={readywa:"واتساب جاهز",closed:"أرقام مغلقة اتصال",premium:"أرقام مميزة",telegram:"أرقام تيليجرام",wa:"واتساب",tg:"تيليجرام"};
async function api(url,opts={}){const r=await fetch(url,{...opts,headers:{"Content-Type":"application/json",...(opts.headers||{})}});let d={};try{d=await r.json();}catch{}if(!r.ok)throw new Error(d.error||d.message||"حدث خطأ");return d;}
function escapeText(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
const countryFlags={مصر:"🇪🇬",السعودية:"🇸🇦",عمان:"🇴🇲",عُمان:"🇴🇲",بريطانيا:"🇬🇧",المملكةالمتحدة:"🇬🇧",اسرائيل:"🇮🇱",إسرائيل:"🇮🇱",قطر:"🇶🇦",تركيا:"🇹🇷",اليمن:"🇾🇪",الامارات:"🇦🇪",الإمارات:"🇦🇪",الكويت:"🇰🇼",العراق:"🇮🇶",الأردن:"🇯🇴",الاردن:"🇯🇴",المغرب:"🇲🇦",تونس:"🇹🇳",الجزائر:"🇩🇿",أمريكا:"🇺🇸",امريكا:"🇺🇸",روسيا:"🇷🇺",فرنسا:"🇫🇷",ألمانيا:"🇩🇪",المانيا:"🇩🇪",الهند:"🇮🇳",باكستان:"🇵🇰"};
function countryFlag(code,c){const n=String(c.name_ar||c.name||"").replace(/\\s/g,"");if(countryFlags[n])return countryFlags[n];const cc=String(c.iso||c.iso2||c.country_code||code).toUpperCase();if(/^[A-Z]{2}$/.test(cc))return String.fromCodePoint(...[...cc].map(x=>127397+x.charCodeAt(0)));return "🌍";}
let countrySort="asc";function renderCountryOptions(filter=""){const list=$("country-options");const q=filter.trim().toLowerCase();const entries=Object.entries(countries).filter(([code,c])=>(String(c.name_ar||c.name||code)+" "+code).toLowerCase().includes(q)).sort((a,b)=>countrySort==="asc"?Number(a[1].price||0)-Number(b[1].price||0):Number(b[1].price||0)-Number(a[1].price||0));if(!entries.length){list.innerHTML='<div class="country-empty">لا توجد دولة مطابقة لبحثك.</div>';return;}list.innerHTML=entries.map(([code,c])=>{const name=c.name_ar||c.name||code;const price=Number(c.price||0).toFixed(2);const qty=Number(c.qty??0);return '<button type="button" class="country-option '+(code===$("country").value?"active":"")+'" data-country="'+escapeText(code)+'"><span class="country-option-flag">'+countryFlag(code,c)+'</span><span class="country-option-info"><b>'+escapeText(name)+'</b><small>متاح: '+qty+' رقم</small></span><span class="country-option-price">$'+price+'</span></button>';}).join("");}
function selectCountry(code){const c=countries[code];if(!c)return;$("country").value=code;$("country-trigger-flag").textContent=countryFlag(code,c);$("country-trigger-name").textContent=c.name_ar||c.name||code;$("country-trigger-meta").textContent="$"+Number(c.price).toFixed(2)+" · متاح "+Number(c.qty??0)+" رقم";$("country-dropdown").hidden=true;$("country-trigger").setAttribute("aria-expanded","false");renderCountryOptions($("country-search").value);showPrice();}
async function loadCountries(){const service=$("service").value;$("country").innerHTML='<option value="">جارٍ التحميل...</option>';$("country-trigger-name").textContent="جارٍ تحميل الدول...";$("country-trigger-meta").textContent="لحظات من فضلك";$("country-options").innerHTML='<div class="country-empty">جارٍ جلب الدول والأسعار...</div>';try{const d=await api("/api/countries?service="+encodeURIComponent(service));countries=d.countries||{};$("country").innerHTML='<option value="">اختر الدولة</option>';for(const [code,c] of Object.entries(countries)){const o=document.createElement("option");o.value=code;o.textContent=(c.name_ar||c.name||code)+" — $"+Number(c.price).toFixed(2);$("country").append(o);}const count=Object.keys(countries).length;$("country-count").textContent=count+" دولة متاحة";if(count){const first=Object.keys(countries)[0];selectCountry(first);}else{$("country-trigger-name").textContent="لا توجد دول متاحة";$("country-trigger-meta").textContent="جرّب خدمة أخرى لاحقاً";$("country-info").textContent="لا توجد أرقام متاحة لهذه الخدمة حالياً.";}renderCountryOptions();}catch(e){countries={};$("country-trigger-name").textContent="تعذر تحميل الدول";$("country-trigger-meta").textContent=e.message;$("country-count").textContent="خطأ";$("country-info").textContent="تعذر تحميل الدول والخدمات.";}}
function showPrice(){const c=countries[$("country").value];$("country-info").textContent=c?"السعر النهائي: $"+Number(c.price).toFixed(2)+"  ·  الأرقام المتاحة: "+Number(c.qty??0):"اختر الدولة لعرض السعر والتوفر.";}
$("country-trigger").addEventListener("click",()=>{const open=$("country-dropdown").hidden;$("country-dropdown").hidden=!open;$("country-trigger").setAttribute("aria-expanded",String(open));if(open){$("country-search").value="";renderCountryOptions();$("country-search").focus();}});
$("country-search").addEventListener("input",e=>renderCountryOptions(e.target.value));
document.querySelectorAll("[data-country-sort]").forEach(b=>b.addEventListener("click",()=>{countrySort=b.dataset.countrySort;document.querySelectorAll("[data-country-sort]").forEach(x=>x.classList.toggle("active",x===b));renderCountryOptions($("country-search").value);}));
$("country-options").addEventListener("click",e=>{const b=e.target.closest("[data-country]");if(b)selectCountry(b.dataset.country);});
document.addEventListener("click",e=>{if(!$("country-picker-wrap").contains(e.target)){$("country-dropdown").hidden=true;$("country-trigger").setAttribute("aria-expanded","false");}});
document.querySelectorAll("[data-service]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-service]").forEach(x=>x.classList.toggle("selected",x===b));$("service").value=b.dataset.service;loadCountries();}));
async function load(){try{const d=await api("/api/me");me=d.user;$("identity").textContent=me.email||me.phone||"—";$("balance").textContent="$"+Number(me.wallet_balance).toFixed(2);
const [w,o]=await Promise.all([api("/api/wallet"),api("/api/orders")]);
$("transactions").innerHTML=w.transactions?.length?w.transactions.map(x=>'<div class="order">'+escapeText(x.description)+' — '+escapeText(x.kind)+' — $'+Number(x.amount).toFixed(2)+'</div>').join(""):"لا توجد معاملات.";
$("orders").innerHTML=o.orders?.length?o.orders.map(x=>'<div class="order"><b>'+escapeText(x.phone_number||"الرقم قيد التجهيز")+'</b> · '+(serviceLabels[x.service]||escapeText(x.service))+' · '+({waiting:"بانتظار الكود",done:"تم استلام الكود",refunded:"ملغي / مسترد",uncertain:"قيد المراجعة",processing:"قيد التنفيذ"}[x.status]||escapeText(x.status))+' · $'+Number(x.sale_price).toFixed(2)+(x.code?'<p>الكود: <b>'+escapeText(x.code)+'</b></p>':'')+(x.status==="waiting"?' <button data-code="'+x.id+'" class="action">فحص الكود</button>':'')+(["waiting","done"].includes(x.status)?' <button data-cancel="'+x.id+'" class="action cancel-order">إلغاء الطلب واسترداد الرصيد</button>':'')+'</div>').join(""):"لا توجد طلبات بعد.";
}catch(e){$("transactions").textContent=e.message;$("orders").textContent=e.message;if(e.message==="UNAUTHORIZED")location.href="/login.html";}}

let activeOrderId=null;
function showNumberModal(){const m=$("number-modal");m.classList.add("open");m.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";}
function hideNumberModal(){const m=$("number-modal");m.classList.remove("open");m.setAttribute("aria-hidden","true");document.body.style.overflow="";}
function setModalState(title,sub,phone,code,note,help){$("number-modal-title").textContent=title;$("number-modal-sub").textContent=sub;$("modal-phone").textContent=phone||"قيد التجهيز";$("modal-code").textContent=code||"بانتظار الكود";$("modal-code-note").textContent=note||"";$("modal-help").textContent=help||"";}
async function checkActiveCode(){if(!activeOrderId)return;const btn=$("modal-check-code");btn.disabled=true;btn.textContent="جارٍ فحص الرسائل...";try{const isHeroOrder=String(activeOrderId).startsWith("hero:");const orderId=isHeroOrder?String(activeOrderId).slice(5):activeOrderId;const d=await api((isHeroOrder?"/api/herosms/orders/":"/api/orders/")+orderId+"/code");if(d.status==="ok"&&d.code){$("modal-code").textContent=d.code;$("modal-code-note").textContent="وصل رمز التفعيل بنجاح. انسخه وأدخله في التطبيق.";$("number-modal-icon").textContent="✓";$("number-modal-icon").style.background="linear-gradient(145deg,#35d6a0,#168c82)";}else if(d.status==="refunded"){setModalState("تم إلغاء الطلب","انتهى الطلب وتمت إعادة المبلغ إلى محفظتك.",$("modal-phone").textContent,"—","لا يوجد رمز لهذا الطلب.","يمكنك اختيار رقم آخر.");}else if(d.status==="uncertain"){setModalState("الطلب قيد المراجعة","لم يؤكد المزود نتيجة الطلب حتى الآن.",$("modal-phone").textContent,"قيد المراجعة","لا تكرر الشراء حتى لا يتم خصم المبلغ مرتين.","سيتم تحديث حالة الطلب بعد المراجعة.");}else{$("modal-code").textContent="بانتظار وصول الرسالة";$("modal-code-note").textContent="لم يصل رمز التفعيل بعد. يمكنك الفحص مرة أخرى بعد قليل.";}await load();if(isHeroOrder)window.dispatchEvent(new Event("hero-orders-refresh"));}catch(e){$("modal-code-note").textContent="تعذر فحص الرمز: "+e.message;}finally{btn.disabled=false;btn.textContent="فحص وصول الكود ↻";}}
$("buy").addEventListener("click",async()=>{const c=countries[$("country").value];if(!c)return;const b=$("buy");b.disabled=true;b.textContent="جارٍ حجز الرقم...";activeOrderId=null;setModalState("جارٍ حجز رقمك","نرسل طلبك إلى المزود الآن. لا تغلق النافذة.","جارٍ إصدار الرقم","جارٍ الاتصال...","يتم التحقق من توفر الرقم.","يرجى الانتظار وعدم الضغط على شراء مرة أخرى.");showNumberModal();try{const d=await api("/api/orders",{method:"POST",body:JSON.stringify({service:$("service").value,country_code:$("country").value})});if(d.status==="ok"){activeOrderId=d.order_id;setModalState("تم حجز الرقم بنجاح","رقمك جاهز. رمز التفعيل سيظهر في المربع أدناه.",d.number,"بانتظار وصول الرسالة","اضغط فحص وصول الكود للتحقق من الرسائل.","احتفظ بالرقم حتى تنتهي من تفعيل حسابك.");$("number-modal-icon").textContent="✓";$("number-modal-icon").style.background="linear-gradient(145deg,#35d6a0,#168c82)";await checkActiveCode();}else{activeOrderId=d.order_id||null;setModalState("الطلب قيد المراجعة","لم تصلنا نتيجة نهائية من المزود بعد.","قيد التجهيز","قيد المراجعة","لا تكرر الشراء حتى لا يتم خصم المبلغ مرتين.","يمكنك إغلاق النافذة والعودة إلى طلباتك لاحقاً.");$("modal-check-code").disabled=true;}await load();}catch(e){setModalState("تعذر إكمال الطلب","لم يتم تأكيد حجز الرقم.", "—","—",e.message,"راجع رصيد محفظتك وطلباتك قبل إعادة المحاولة.");}finally{b.disabled=false;b.innerHTML='شراء الرقم الآن <span>←</span>';}}); 
$("modal-check-code").addEventListener("click",checkActiveCode);
$("number-modal-close").addEventListener("click",hideNumberModal);$("modal-close-bottom").addEventListener("click",hideNumberModal);
$("number-modal").addEventListener("click",e=>{if(e.target.hasAttribute("data-modal-close"))hideNumberModal();});
$("copy-number").addEventListener("click",async()=>{const v=$("modal-phone").textContent;if(!v||v==="قيد التجهيز"||v==="—")return;try{await navigator.clipboard.writeText(v);$("copy-number").textContent="تم النسخ ✓";}catch{$("copy-number").textContent="تعذر النسخ";}});

$("orders").addEventListener("click",async e=>{
 const target=e.target.closest("[data-code],[data-cancel]");if(!target)return;
 const provider=target.dataset.provider==="hero"?"herosms":"orders";
 const cancelId=target.dataset.cancel;
 if(cancelId){
  if(!confirm("هل تريد إلغاء هذا الطلب؟ لن يُعاد المبلغ إلا بعد تأكيد المزود للإلغاء."))return;
  target.disabled=true;target.textContent="جارٍ الإلغاء...";
  try{const d=await api("/api/"+provider+"/"+cancelId+"/cancel",{method:"POST",body:"{}"});$("message").textContent=d.message||"تم إلغاء الطلب.";await load();await loadCustomerExtras();}
  catch(x){$("message").textContent=x.message;target.disabled=false;target.textContent="إلغاء الطلب واسترداد الرصيد";}
  return;
 }
 const id=target.dataset.code;
 try{const d=await api("/api/"+provider+"/"+id+"/code");$("message").textContent=d.status==="ok"?"رمز التحقق: "+d.code:"الحالة: "+d.status;await load();await loadCustomerExtras();}
 catch(x){$("message").textContent=x.message;}
});
$("revoke-sessions").addEventListener("click",async()=>{if(!confirm("سيتم تسجيل الخروج من جميع الأجهزة الأخرى. هل تريد المتابعة؟"))return;const button=$("revoke-sessions");button.disabled=true;try{const result=await api("/api/sessions/revoke-others",{method:"POST",body:"{}"});$("security-note").textContent="تم إنهاء "+result.revoked+" جلسة أخرى.";}catch(e){$("security-note").textContent=e.message;}finally{button.disabled=false;}});
$("logout").onclick=async()=>{await api("/api/logout",{method:"POST"});location.href="/login.html";};

async function loadCustomerExtras(){
 try{
  const ref=await api("/api/referrals");
  $("referral-code").textContent=ref.code||"—";
  $("referral-count").textContent=String(ref.invited||0);
  $("copy-referral").onclick=async function(){try{await navigator.clipboard.writeText(location.origin+ref.link);this.textContent="تم النسخ ✓";}catch(e){this.textContent="تعذر النسخ";}};
  const tickets=await api("/api/support/tickets");
  const payments=await api("/api/payment-requests");
  const wallet=await api("/api/wallet");
  const main=await api("/api/orders");
  const hero=await api("/api/herosms/orders");
  const all=[...(main.orders||[]).map(function(x){return {...x,provider:"main"};}),...(hero.orders||[]).map(function(x){return {...x,provider:"hero"};})];
  const spent=(wallet.transactions||[]).filter(function(x){return x.kind==="debit";}).reduce(function(a,x){return a+Number(x.amount||0);},0);
  $("customer-orders-count").textContent=String(all.length);
  $("customer-spent-total").textContent="$"+spent.toFixed(2);
  $("customer-active-count").textContent=String(all.filter(function(x){return ["waiting","processing","uncertain"].includes(x.status);}).length);
  $("customer-tier").textContent=spent>=100?"VIP":spent>=50?"ذهبي":spent>=20?"فضي":"عضو جديد";
  $("customer-tier-note").textContent="مستوى تعريفي حسب إجمالي مشترياتك.";
  const orderBox=$("orders");orderBox.replaceChildren();
  const labels={waiting:"بانتظار الكود",done:"وصل الكود",finished:"مكتمل",refunded:"مسترد",uncertain:"قيد المراجعة",processing:"قيد التنفيذ"};
  all.sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);}).forEach(function(order){
   const item=document.createElement("div");item.className="order";
   const title=document.createElement("b");title.textContent=order.phone_number||"الرقم قيد التجهيز";
   const source=document.createElement("small");source.textContent=" · "+(order.provider==="hero"?"السيرفر الثاني":"السيرفر الأول")+" · "+(serviceLabels[order.service]||order.service)+" · "+(labels[order.status]||order.status)+" · $"+Number(order.sale_price||0).toFixed(2);
   item.append(title,source);
   if(order.code){const code=document.createElement("p");code.textContent="رمز التفعيل: "+order.code;item.append(code);}
   if(order.status==="waiting"){const check=document.createElement("button");check.className="action";check.textContent="فحص الكود";check.dataset.code=order.id;check.dataset.provider=order.provider;item.append(check);}
   if(["waiting","done"].includes(order.status)){const cancel=document.createElement("button");cancel.className="action cancel-order";cancel.textContent="إلغاء الطلب واسترداد الرصيد";cancel.dataset.cancel=order.id;cancel.dataset.provider=order.provider;item.append(cancel);}
   orderBox.append(item);
  });
  const notices=[];
  all.slice(0,5).forEach(function(x){notices.push({time:x.created_at,text:"طلب رقم "+(x.phone_number||("#"+x.id))+" — "+({waiting:"بانتظار الكود",done:"وصل الكود",finished:"مكتمل",refunded:"تم الاسترداد",uncertain:"قيد المراجعة",processing:"قيد التنفيذ"}[x.status]||x.status)});});
  (payments.requests||[]).slice(0,4).forEach(function(x){notices.push({time:x.created_at,text:"طلب شحن "+Number(x.amount_usd||0).toFixed(2)+" USD — "+({pending:"قيد المراجعة",approved:"تمت الموافقة",rejected:"مرفوض"}[x.status]||x.status)});});
  notices.sort(function(a,b){return new Date(b.time)-new Date(a.time);});
  const notificationBox=$("customer-notifications");notificationBox.replaceChildren();
  if(!notices.length)notificationBox.textContent="لا توجد تنبيهات جديدة حالياً.";
  notices.slice(0,7).forEach(function(n){const item=document.createElement("div");item.className="support-ticket";const text=document.createElement("span");text.textContent=n.text;const time=document.createElement("small");time.textContent=new Date(n.time).toLocaleString("ar");item.append(text,time);notificationBox.append(item);});
  const ticketBox=$("support-tickets");ticketBox.replaceChildren();
  if(!(tickets.tickets||[]).length)ticketBox.textContent="لم ترسل أي تذكرة دعم حتى الآن.";
  (tickets.tickets||[]).forEach(function(ticket){const item=document.createElement("div");item.className="support-ticket";const title=document.createElement("b");title.textContent="#"+ticket.id+" · "+ticket.subject;const state=document.createElement("small");state.textContent="الحالة: "+({open:"مفتوحة",answered:"تم الرد",closed:"مغلقة"}[ticket.status]||ticket.status);const msg=document.createElement("small");msg.textContent=ticket.message;item.append(title,state,msg);if(ticket.admin_reply){const reply=document.createElement("small");reply.textContent="رد الإدارة: "+ticket.admin_reply;item.append(reply);}ticketBox.append(item);});
 }catch(e){if(e.message==="UNAUTHORIZED")location.href="/login.html";else $("support-tickets").textContent="تعذر تحميل البيانات: "+e.message;}
}
$("support-form").addEventListener("submit",async function(e){
 e.preventDefault();const b=this.querySelector("button");b.disabled=true;
 try{const d=await api("/api/support/tickets",{method:"POST",body:JSON.stringify({subject:$("support-subject").value.trim(),message:$("support-message").value.trim()})});$("support-note").textContent="تم إرسال تذكرتك رقم #"+d.ticket.id;$("support-subject").value="";$("support-message").value="";await loadCustomerExtras();}
 catch(x){$("support-note").textContent=x.message;}finally{b.disabled=false;}
});

load();loadCountries();
loadCustomerExtras();

