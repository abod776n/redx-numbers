const form=document.getElementById("login-form");
const note=document.getElementById("form-note");
if(form){
 form.addEventListener("submit",async e=>{
  e.preventDefault();const btn=form.querySelector('button[type="submit"]');btn.disabled=true;note.textContent="جارٍ تسجيل الدخول...";
  try{const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({identity:document.getElementById("identity").value,password:document.getElementById("password").value})});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تسجيل الدخول");const next=new URLSearchParams(location.search).get("next");location.href=next&&next.startsWith("/")&&!next.startsWith("//")?next:"/dashboard.html";}
  catch(err){note.textContent=err.message;}finally{btn.disabled=false;}
 });
 document.getElementById("toggle-password")?.addEventListener("click",()=>{const p=document.getElementById("password");p.type=p.type==="password"?"text":"password";});
 document.getElementById("forgot")?.addEventListener("click",e=>{e.preventDefault();note.textContent="استعادة كلمة المرور غير مفعّلة بعد. تواصل مع إدارة المنصة.";});
 document.getElementById("register-link")?.addEventListener("click",e=>{e.preventDefault();location.href="/register.html";});
}
