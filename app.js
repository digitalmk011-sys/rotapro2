let deliveries=JSON.parse(localStorage.getItem("rotapro_deliveries")||"[]");

function save(){localStorage.setItem("rotapro_deliveries",JSON.stringify(deliveries));render()}
function val(id){return document.getElementById(id).value.trim()}
function addDelivery(){
 const client=val("client"),address=val("address"),phone=val("phone");
 if(!client||!address){alert("Informe cliente e endereço.");return}
 deliveries.push({client,address,phone,obs:"",done:false});
 ["client","address","phone"].forEach(id=>document.getElementById(id).value=""); save()
}
function render(){
 const list=document.getElementById("list"); list.innerHTML="";
 deliveries.forEach((d,i)=>{
  const e=document.createElement("div"); e.className="item"+(d.done?" done":"");
  e.innerHTML=`<div class="num">${i+1}. ${esc(d.client)}</div>
  <div class="meta">📍 ${esc(d.address)}</div>
  ${d.code?`<div class="meta">📦 ${esc(d.code)}</div>`:""}
  ${d.phone?`<div class="meta">☎️ ${esc(d.phone)}</div>`:""}
  ${d.obs?`<div class="meta">📝 ${esc(d.obs)}</div>`:""}
  <div class="actions"><button onclick="toggle(${i})">${d.done?"↩️ Reabrir":"✅ Entregue"}</button>
  <button onclick="navigate(${i})">🧭 Navegar</button><button onclick="removeOne(${i})">🗑️</button></div>`;
  list.appendChild(e)
 });
 if(!deliveries.length)list.innerHTML='<div class="empty">Nenhuma entrega cadastrada.</div>';
 const total=deliveries.length,done=deliveries.filter(x=>x.done).length;
 document.getElementById("total").textContent=total; document.getElementById("done").textContent=done;
 document.getElementById("remaining").textContent=total-done;
 document.getElementById("bar").style.width=(total?done/total*100:0)+"%"
}
function toggle(i){deliveries[i].done=!deliveries[i].done;save()}
function removeOne(i){if(confirm("Remover esta entrega?")){deliveries.splice(i,1);save()}}
function navigate(i){
 const d=deliveries[i];
 let destination=d.lat&&d.lon?`${d.lat},${d.lon}`:d.address;
 open("https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(destination),"_blank")
}
function optimize(){deliveries.sort((a,b)=>Number(a.done)-Number(b.done));save();alert("Entregas pendentes foram agrupadas. A otimização viária será adicionada na próxima etapa.")}
function clearAll(){if(confirm("Apagar todas as entregas?")){deliveries=[];save()}}
function exportCSV(){
 const rows=[["Cliente","Endereço","Telefone","Observação","Código","Latitude","Longitude","Status"],
 ...deliveries.map(d=>[d.client,d.address,d.phone,d.obs,d.code||"",d.lat||"",d.lon||"",d.done?"Entregue":"Pendente"])];
 download("rotapro-entregas.csv","\ufeff"+rows.map(r=>r.map(x=>`"${String(x??"").replaceAll('"','""')}"`).join(";")).join("\n"),"text/csv")
}
function importFile(ev){
 const f=ev.target.files[0]; if(!f)return;
 if(f.name.toLowerCase().endsWith(".csv")){
  const r=new FileReader(); r.onload=()=>importCSV(r.result); r.readAsText(f,"UTF-8")
 } else {
  if(typeof XLSX==="undefined"){alert("A biblioteca Excel não carregou. Verifique a internet e tente novamente.");return}
  const r=new FileReader();
  r.onload=e=>{try{
   const wb=XLSX.read(new Uint8Array(e.target.result),{type:"array"});
   const ws=wb.Sheets[wb.SheetNames[0]];
   const rows=XLSX.utils.sheet_to_json(ws,{defval:""});
   importObjects(rows)
  }catch(err){alert("Erro ao ler Excel: "+err.message)}};
  r.readAsArrayBuffer(f)
 }
 ev.target.value=""
}
function norm(x){return String(x??"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")}
function findKey(keys,names){
 const ns=names.map(norm); return keys.find(k=>ns.includes(norm(k))) || null
}
function importObjects(rows){
 if(!rows.length){alert("Planilha vazia.");return}
 const keys=Object.keys(rows[0]);
 // Compatível com Excel de entregas como:
 // AT ID | Sequence | Stop | SPX TN | Destination Address | Bairro | City | Zipcode/Postal code | Latitude | Longitude
 const clientKey=findKey(keys,["Cliente","Nome","Customer","Recipient","Destinatario","Destinatário"]);
 const addressKey=findKey(keys,["Destination Address","Endereço","Endereco","Address"]);
 const codeKey=findKey(keys,["SPX TN","Tracking","Tracking Number","Código","Codigo","Pedido","Package"]);
 const neighborhoodKey=findKey(keys,["Bairro","Neighborhood"]);
 const cityKey=findKey(keys,["City","Cidade"]);
 const zipKey=findKey(keys,["Zipcode/Postal code","CEP","Zipcode","Postal code"]);
 const latKey=findKey(keys,["Latitude","Lat"]);
 const lonKey=findKey(keys,["Longitude","Long","Lon"]);
 const seqKey=findKey(keys,["Sequence","Sequencia","Sequência","Stop"]);
 if(!addressKey){alert("Não encontrei a coluna Destination Address (endereço).");return}
 let n=0;
 rows.forEach((r,idx)=>{
  const rawAddress=String(r[addressKey]??"").trim(); if(!rawAddress)return;
  const bairro=neighborhoodKey?String(r[neighborhoodKey]??"").trim():"";
  const city=cityKey?String(r[cityKey]??"").trim():"";
  const zip=zipKey?String(r[zipKey]??"").trim():"";
  const full=[rawAddress,bairro,city,zip].filter(Boolean).join(", ");
  const client=clientKey?String(r[clientKey]??"").trim():"";
  const code=codeKey?String(r[codeKey]??"").trim():"";
  const lat=latKey?String(r[latKey]??"").trim():"";
  const lon=lonKey?String(r[lonKey]??"").trim():"";
  const seq=seqKey?String(r[seqKey]??"").trim():"";
  deliveries.push({client:client||("Entrega "+(idx+1)),address:full,phone:"",obs:seq?`Sequência: ${seq}`:"",code,lat,lon,done:false});
  n++
 });
 save();
 alert(n+" entregas importadas com sucesso.\nO RotaPro reconheceu as colunas Destination Address, Bairro, City, CEP, Latitude, Longitude e SPX TN.")
}
function importCSV(text){
 const lines=text.replace(/^\ufeff/,"").split(/\r?\n/).filter(Boolean);
 const rows=lines.map(x=>x.split(";").map(v=>v.replace(/^"|"$/g,"").replaceAll('""','"')));
 if(rows.length<2){alert("CSV vazio.");return}
 const h=rows[0].map(norm);
 const ci=h.findIndex(x=>["cliente","nome","customer"].includes(x));
 const ai=h.findIndex(x=>["endereco","destination address","address"].includes(x));
 if(ai<0){alert("CSV precisa ter Endereço ou Destination Address.");return}
 rows.slice(1).forEach((r,i)=>{if(r[ai])deliveries.push({client:ci>=0&&r[ci]?r[ci]:"Entrega "+(i+1),address:r[ai],phone:"",obs:"",done:false})});
 save();alert((rows.length-1)+" entregas importadas.")
}
function downloadTemplate(){
 if(typeof XLSX==="undefined"){alert("Aguarde a biblioteca Excel carregar.");return}
 const ws=XLSX.utils.aoa_to_sheet([
  ["AT ID","Sequence","Stop","SPX TN","Destination Address","Bairro","City","Zipcode/Postal code","Latitude","Longitude"],
  ["AT20260919A130T",1,1,"BR000000000000","Rua Exemplo, 100","Centro","Santa Fé","86770-000",-23.03849,-51.8018]
 ]);
 const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Sheet1"); XLSX.writeFile(wb,"modelo-rotapro-entregas.xlsx")
}
function download(name,data,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click()}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js");
render();