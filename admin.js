const $=id=>document.getElementById(id);
async function api(url,options={}){const response=await fetch(url,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});let data={};try{data=await response.json();}catch{}if(!response.ok)throw Error(data.error||data.message||"تعذر تنفيذ العملية");return data;}
const safe=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=value=>"$"+Number(value||0).toFixed(2);
const date=value=>value?new Date(value).toLocaleString("ar",{dateStyle:"medium",timeStyle:"short"}):"—";
const statusNames={waiting:"بانتظار الكود",processing:"قيد التجهيز",uncertain:"قيد المراجعة",done:"تم استلام الكود",finished:"مكتمل",refunded:"ملغي / مسترد"};
const statusClass={done:"good",finished:"good",waiting:"warn",processing:"warn",uncertain:"warn",refunded:"bad"};
let allUsers=[],allOrders=[],allTransactions=[],orderFilter="all";
function renderUsers(){
 const query=String($("user-search")?.value||"").trim().toLowerCase();
 const rows=allUsers.filter(user=>[user.id,user.email,user.phone,user.role].join(" ").toLowerCase().includes(query));
 $("users").innerHTML=rows.length?rows.map(user=>'<div class="item"><div class="item-head"><b>عميل #'+user.id+'</b><span class="pill">'+(user.role==="admin"?"مدير":"عميل")+'</span></div><div>'+safe(user.email||user.phone||"بدون بيانات تواصل")+'</div><div> '+safe(user.phone||"لا يوجد رقم هاتف")+'</div><div>رصيد المحفظة: <b>'+money(user.wallet_balance)+'</b></div><small>تاريخ التسجيل: '+date(user.created_at)+'</small></div>').join(""):'<div class="item">لا توجد نتائج مطابقة.</div>';
}
function renderOrders(){
 const query=String($("order-search")?.value||"").trim().toLowerCase();
 const rows=allOrders.filter(order=>(orderFilter==="all"||order.status===orderFilter)&&[order.id,order.phone_number,order.email,order.phone,order.source].join(" ").toLowerCase().includes(query));
 $("orders").innerHTML=rows.length?rows.map(order=>'<div class="item"><div class="item-head"><b>طلب #'+order.id+'</b><span class="pill '+(statusClass[order.status]||"")+'">'+safe(statusNames[order.status]||order.status)+'</span></div><div class="item-head"><span class="pill">'+safe(order.source)+'</span><b>'+money(order.sale_price)+'</b></div><div>العميل: '+safe(order.email||order.phone||("عميل #"+order.user_id))+'</div><div>الرقم: <b dir="ltr">'+safe(order.phone_number||"لم يصدر بعد")+'</b></div><small>'+date(order.created_at)+'</small></div>').join(""):'<div class="item">لا توجد طلبات مطابقة لهذا البحث أو الفلتر.</div>';
}
function renderTransactions(){
 const query=String($("transaction-search")?.value||"").trim().toLowerCase();
 const rows=allTransactions.filter(tx=>[tx.id,tx.user_id,tx.email,tx.phone,tx.kind,tx.description,tx.reference].join(" ").toLowerCase().includes(query));
 const kindNames={credit:"إضافة رصيد",debit:"خصم شراء",refund:"استرداد"};
 $("transactions").innerHTML=rows.length?rows.map(tx=>'<div class="item"><div class="item-head"><b>حركة #'+tx.id+' · عميل #'+tx.user_id+'</b><span class="pill '+(tx.kind==="debit"?"bad":"good")+'">'+safe(kindNames[tx.kind]||tx.kind)+'</span></div><div>'+safe(tx.email||tx.phone||"عميل")+'</div><div>المبلغ: <b>'+money(tx.amount)+'</b></div><div>'+safe(tx.description||"—")+'</div><small>المرجع: '+safe(tx.reference||"—")+' · '+date(tx.created_at)+'</small></div>').join(""):'<div class="item">لا توجد حركات مطابقة.</div>';
}
async function loadPaymentAdmin(){
 const [methods,payments]=await Promise.all([api("/api/admin/payment-methods"),api("/api/admin/payment-requests")]);
 const methodIds={fulusak:"method-fulusak",jeeb:"method-jeeb",onecash:"method-onecash",cash:"method-cash",binance:"method-binance",shamcash:"method-shamcash"};
 const methodNames={fulusak:"فلوسك",jeeb:"جيب",onecash:"ون كاش",cash:"كاش",binance:"Binance / USDT",shamcash:"شام كاش"};
 for(const [key,id] of Object.entries(methodIds))$(id).value=methods.methods?.[key]||"";
 const labels={pending:"قيد المراجعة",approved:"مقبول",rejected:"مرفوض"};
 $("payment-review").innerHTML=payments.requests.length?payments.requests.map(item=>'<div class="item"><b>طلب شحن #'+item.id+'</b> — العميل #'+item.user_id+' ('+safe(item.email||item.phone)+')<br>الوسيلة: '+safe(methodNames[item.method]||item.method)+' · المبلغ: '+Number(item.amount_entered).toLocaleString("en-US")+' '+safe(item.currency)+' · يعادل '+money(item.amount_usd)+'<br>اسم المحوّل: '+safe(item.sender_name)+' · المرجع: '+safe(item.reference)+'<br>الحالة: <b>'+safe(labels[item.status]||item.status)+'</b> · '+date(item.created_at)+(item.proof_data?'<br><a target="_blank" rel="noopener" href="'+safe(item.proof_data)+'">عرض صورة الإيصال</a>':'<br>لا توجد صورة إيصال')+(item.status==="pending"?' <div class="row" style="margin-top:10px"><button class="btn" data-approve="'+item.id+'">قبول وشحن '+money(item.amount_usd)+'</button><button class="btn" style="background:#9b3b52" data-reject="'+item.id+'">رفض الطلب</button></div>':'')+(item.admin_note?'<br>ملاحظة: '+safe(item.admin_note):"")+'</div>').join(""):'<div class="item">لا توجد طلبات دفع.</div>';
}

async function loadSupportTickets(){
 const data=await api("/api/admin/support-tickets");
 const box=$("admin-support-tickets");box.replaceChildren();
 if(!(data.tickets||[]).length){box.textContent="لا توجد تذاكر دعم حالياً.";return;}
 for(const ticket of data.tickets){
  const card=document.createElement("article");card.className="item";
  const title=document.createElement("b");title.textContent="#"+ticket.id+" · "+ticket.subject;
  const who=document.createElement("small");who.textContent="العميل: "+(ticket.email||ticket.phone||ticket.user_id)+" · "+({open:"مفتوحة",answered:"تم الرد",closed:"مغلقة"}[ticket.status]||ticket.status);
  const body=document.createElement("p");body.textContent=ticket.message;
  card.append(title,who,body);
  if(ticket.admin_reply){const reply=document.createElement("small");reply.textContent="آخر رد: "+ticket.admin_reply;card.append(reply);}
  if(ticket.status!=="closed"){
   const area=document.createElement("textarea");area.rows=2;area.placeholder="اكتب رد الإدارة هنا";area.className="search-input";
   const button=document.createElement("button");button.className="btn";button.textContent="إرسال الرد";
   button.addEventListener("click",async()=>{if(area.value.trim().length<2){$("notice").textContent="اكتب رداً قبل الإرسال.";return;}button.disabled=true;try{await api("/api/admin/support-tickets/"+ticket.id+"/reply",{method:"POST",body:JSON.stringify({reply:area.value.trim(),status:"answered"})});$("notice").textContent="تم إرسال الرد على التذكرة #"+ticket.id;await loadSupportTickets();}catch(e){$("notice").textContent=e.message;button.disabled=false;}});
   card.append(area,button);
  }
  box.append(card);
 }
}

async function init(){
 try{
  const me=await api("/api/me");if(me.user.role!=="admin")throw Error("هذا الحساب ليس مديراً.");
  $("notice").textContent="تم التحقق من صلاحيات المدير. بيانات المنصة محدثة.";
  const [overview,users,orders,transactions]=await Promise.all([api("/api/admin/overview"),api("/api/admin/users"),api("/api/admin/orders"),api("/api/admin/transactions")]);
  $("customers").textContent=overview.customers;
  $("orders-count").textContent=overview.orders;
  $("sales").textContent=money(overview.sales);
  $("pending-count").textContent=overview.pending;
  $("today-sales").textContent=money(overview.today_sales);
  $("wallet-total").textContent=money(overview.wallet_total);
  $("markup").value=String(overview.markup_percent??10);
  allUsers=users.users||[];allOrders=orders.orders||[];allTransactions=transactions.transactions||[];
  renderUsers();renderOrders();renderTransactions();
  try{const provider=await api("/api/provider/balance");$("provider").textContent=provider.status==="ok"?money(provider.balance):"غير متاح";}catch{$("provider").textContent="غير متاح";}
  await loadPaymentAdmin();
  await loadSupportTickets();
 }catch(error){$("notice").textContent=error.message+" — سجّل الدخول بحساب المدير.";if(["UNAUTHORIZED","ADMIN_ONLY"].includes(error.message)||error.message.includes("ليس مديراً"))setTimeout(()=>location.href="/login.html",1800);}
}
$("save-markup").onclick=async()=>{
 const button=$("save-markup");
 const raw=String($("markup").value||"").trim().replace(/[٠-٩]/g,d=>"٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g,d=>"۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(",",".").replace(/٪|%/g,"");
 const percent=Number(raw);
 if(raw===""||!Number.isFinite(percent)||percent<0||percent>400){$("notice").textContent="أدخل نسبة صحيحة من 0 إلى 400 فقط.";return;}
 button.disabled=true;button.textContent="جارٍ الحفظ...";
 try{const result=await api("/api/admin/markup",{method:"POST",body:JSON.stringify({percent})});$("markup").value=String(result.markup_percent);$("notice").textContent="تم حفظ هامش الربح: "+result.markup_percent+"%";}
 catch(error){$("notice").textContent="تعذر حفظ النسبة: "+error.message;}
 finally{button.disabled=false;button.textContent="حفظ النسبة %";}
};
$("credit").onclick=async()=>{
 const button=$("credit"),email=String($("customer-email").value||"").trim().toLowerCase(),amountRaw=String($("amount").value||"").trim(),amount=Number(amountRaw);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){$("notice").textContent="أدخل البريد الإلكتروني الصحيح للعميل.";return;}
 if(!Number.isFinite(amount)||amount<=0||amount>10000){$("notice").textContent="أدخل مبلغاً صحيحاً أكبر من صفر وبحد أقصى 10000 دولار.";return;}
 if(!confirm("تأكيد إضافة "+money(amount)+" إلى حساب "+email+"؟"))return;
 button.disabled=true;button.textContent="جارٍ الشحن...";
 try{await api("/api/admin/wallet/credit",{method:"POST",body:JSON.stringify({email,amount})});$("notice").textContent="تم شحن "+money(amount)+" للعميل "+email+" بنجاح."; $("customer-email").value="";$("amount").value="";await init();}
 catch(error){const messages={BAD_CREDIT:"البريد الإلكتروني أو المبلغ غير صحيح.",USER_NOT_FOUND:"لا يوجد عميل مسجل بهذا البريد الإلكتروني.",ADMIN_ONLY:"انتهت صلاحية جلسة الإدارة.",UNAUTHORIZED:"انتهت جلسة الدخول."};$("notice").textContent="تعذر الشحن: "+(messages[error.message]||error.message);}
 finally{button.disabled=false;button.textContent="إضافة الرصيد";}
};
$("save-methods").onclick=async()=>{
 const button=$("save-methods"),methodIds={fulusak:"method-fulusak",jeeb:"method-jeeb",onecash:"method-onecash",cash:"method-cash",binance:"method-binance"},methods={};
 for(const [key,id] of Object.entries(methodIds))methods[key]=String($(id).value||"").trim();
 if(!Object.values(methods).some(Boolean)){$("notice").textContent="أدخل بيانات وسيلة دفع واحدة على الأقل قبل الحفظ.";return;}
 button.disabled=true;button.textContent="جارٍ الحفظ...";
 try{const result=await api("/api/admin/payment-methods",{method:"POST",body:JSON.stringify({methods})});for(const [key,id] of Object.entries(methodIds))$(id).value=result.methods?.[key]||methods[key];$("notice").textContent="تم حفظ بيانات الدفع وستظهر للعملاء مباشرة.";}
 catch(error){$("notice").textContent="تعذر حفظ بيانات الدفع: "+error.message;}
 finally{button.disabled=false;button.textContent="حفظ بيانات الدفع";}
};
$("payment-review").addEventListener("click",async event=>{
 const id=event.target.dataset.approve||event.target.dataset.reject;if(!id)return;
 const approve=!!event.target.dataset.approve;
 if(!confirm(approve?"هل تحققت من وصول المبلغ فعلياً وتريد شحن رصيد العميل؟":"هل تريد رفض طلب الدفع؟"))return;
 try{await api("/api/admin/payment-requests/"+id+"/"+(approve?"approve":"reject"),{method:"POST",body:JSON.stringify({note:approve?"تم التحقق من الدفع":"لم يتم التحقق من وصول الحوالة"})});$("notice").textContent=approve?"تم قبول الدفع وإضافة الرصيد.":"تم رفض طلب الدفع دون إضافة رصيد.";await loadPaymentAdmin();await init();}
 catch(error){$("notice").textContent=error.message;}
});
$("user-search").addEventListener("input",renderUsers);
$("order-search").addEventListener("input",renderOrders);
$("transaction-search").addEventListener("input",renderTransactions);
document.querySelectorAll("[data-order-filter]").forEach(button=>button.addEventListener("click",()=>{orderFilter=button.dataset.orderFilter;document.querySelectorAll("[data-order-filter]").forEach(item=>item.classList.toggle("active",item===button));renderOrders();}));
$("refresh-support").onclick=async()=>{try{await loadSupportTickets();}catch(e){$("notice").textContent=e.message;}};
$("refresh-admin").onclick=async()=>{const button=$("refresh-admin");button.disabled=true;button.textContent="جارٍ التحديث...";try{await init();}finally{button.disabled=false;button.textContent="↻ تحديث البيانات";}};
$("logout").onclick=async()=>{try{await api("/api/logout",{method:"POST"});}finally{location.href="/login.html";}};
init();
