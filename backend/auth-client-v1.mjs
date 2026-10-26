// Same-origin authentication client for NEBULA. Import only after backend auth routes are live.
// Never place a backend secret or a password in source code or localStorage.
export const NebulaAuth = {
 async request(path,options={}){
   const res=await fetch('/api/auth/'+path,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
   const data=await res.json().catch(()=>({success:false,error:'INVALID_RESPONSE'}));
   if(!res.ok)throw Object.assign(new Error(data.error||'AUTH_FAILED'),{status:res.status});
   return data;
 },
 me(){return this.request('me',{method:'GET'});},
 login(email,password){return this.request('login',{method:'POST',body:JSON.stringify({email,password})});},
 logout(){return this.request('logout',{method:'POST',body:'{}'});},
 createUser(email,password,role='USER'){return this.request('users',{method:'POST',body:JSON.stringify({email,password,role})});}
};
