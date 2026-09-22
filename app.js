let deliveries=JSON.parse(localStorage.getItem("rotapro_deliveries")||"[]");

function save(){localStorage.setItem("rotapro_deliveries",JSON.stringify(deliveries));render()}
function val(id){return document.getElementById(id)?.value.trim()||""}
function addDelivery(){let client=val("client"),address=val("address"),phone=val("phone");if(!client||!address){alert("Informe cliente e endereço.");return}deliveries.push({client,address,phone,obs:"",code:"",lat:"",lon:"",done:false});["client","address","phone"].forEach(id=>{let e=document.getElementById(id);if(e)e.value=""});save()}

function render(){
 const list=document.getElementById("list"); if(!list)return; list.innerHTML="";
 deliveries.forEach((d,i)=>{let e=document.createElement("div");e.className="item"+(d.done?" done":"");
 e.innerHTML=`<div class="num">${i+1}. ${esc(d.client)}</div><div class="meta">📍 ${esc(d.address)}</div>${d.code?`<div class="meta">📦 ${esc(d.code)}</div>`:""}${d.phone?`<div class="meta">☎️ ${esc(d.phone)}</div>`:""}${d.obs?`<div class="meta">📝 ${esc(d.obs)}</div>`:""}<div class="actions"><button onclick="toggle(${i})">${d.done?"↩️ Reabrir":"✅ Entregue"}</button><button onclick="navigate(${i})">🧭 Navegar</button><button onclick="removeOne(${i})">🗑️</button></div>`;list.appendChild(e)});
 if(!deliveries.length)list.innerHTML='<div class="empty">Nenhuma entrega cadastrada.</div>';
 let total=deliveries.length,done=deliveries.filter(x=>x.done).length;
 document.getElementById("total").textContent=total;document.getElementById("done").textContent=done;document.getElementById("remaining").textContent=total-done;document.getElementById("bar").style.width=(total?done/total*100:0)+"%"
}
function toggle(i){deliveries[i].done=!deliveries[i].done;save()}
function removeOne(i){if(confirm("Remover esta entrega?")){deliveries.splice(i,1);save()}}
function navigate(i){let d=deliveries[i],dest=(d.lat&&d.lon)?`${d.lat},${d.lon}`:d.address;open("https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(dest),"_blank")}
function optimize(){deliveries.sort((a,b)=>Number(a.done)-Number(b.done));save();alert("Entregas pendentes foram agrupadas.")}
function clearAll(){if(confirm("Apagar todas as entregas?")){deliveries=[];save()}}

function normalize(s){
 return String(s??"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ");
}
function keyOf(keys, aliases){
 const wanted=aliases.map(normalize);
 return keys.find(k=>wanted.includes(normalize(k)))||null;
}
function importFile(ev){
 const f=ev.target.files[0];if(!f)return;
 if(/\.(csv)$/i.test(f.name)){let r=new FileReader();r.onload=()=>importCSV(r.result);r.readAsText(f,"UTF-8");ev.target.value="";return}
 if(typeof XLSX==="undefined"){alert("A biblioteca Excel não carregou. Verifique sua internet e tente novamente.");ev.target.value="";return}
 let r=new FileReader();
 r.onload=e=>{try{
   const wb=XLSX.read(new Uint8Array(e.target.result),{type:"array"});
   const ws=wb.Sheets[wb.SheetNames[0]];
   const rows=XLSX.utils.sheet_to_json(ws,{defval:""});
   importDeliveryExcel(rows);
 }catch(err){alert("Não foi possível ler o Excel: "+err.message)}};
 r.readAsArrayBuffer(f);ev.target.value="";
}

function importDeliveryExcel(rows){
 if(!rows.length){alert("A planilha está vazia.");return}
 const keys=Object.keys(rows[0]);

 // Formato real do arquivo enviado pelo usuário:
 // AT ID | Sequence | Stop | SPX TN | Destination Address | Bairro | City | Zipcode/Postal code | Latitude | Longitude
 const addressKey=keyOf(keys,["Destination Address","Endereço","Endereco","Address"]);
 const codeKey=keyOf(keys,["SPX TN","Tracking","Tracking Number","Código","Codigo"]);
 const bairroKey=keyOf(keys,["Bairro","Neighborhood"]);
 const cityKey=keyOf(keys,["City","Cidade"]);
 const zipKey=keyOf(keys,["Zipcode/Postal code","CEP","Zipcode","Postal code"]);
 const latKey=keyOf(keys,["Latitude","Lat"]);
 const lonKey=keyOf(keys,["Longitude","Long","Lon"]);
 const seqKey=keyOf(keys,["Sequence","Sequencia","Sequência"]);
 const stopKey=keyOf(keys,["Stop"]);

 if(!addressKey){
   alert("Não encontrei 'Destination Address'.\n\nColunas encontradas:\n"+keys.join(" | "));
   return;
 }

 let imported=0;
 rows.forEach((r,i)=>{
   const raw=String(r[addressKey]??"").trim();
   if(!raw)return;
   const parts=[raw,bairroKey?r[bairroKey]:"",cityKey?r[cityKey]:"",zipKey?r[zipKey]:""].map(x=>String(x??"").trim()).filter(Boolean);
   const seq=seqKey?String(r[seqKey]??"").trim():"";
   const stop=stopKey?String(r[stopKey]??"").trim():"";
   deliveries.push({
     client:codeKey?String(r[codeKey]??"").trim():("Entrega "+(imported+1)),
     address:[...new Set(parts)].join(", "),
     phone:"",
     obs:[seq?`Seq: ${seq}`:"",stop?`Stop: ${stop}`:""].filter(Boolean).join(" | "),
     code:codeKey?String(r[codeKey]??"").trim():"",
     lat:latKey?String(r[latKey]??"").trim():"",
     lon:lonKey?String(r[lonKey]??"").trim():"",
     done:false
   });
   imported++;
 });
 save();
 alert(imported+" entregas importadas com sucesso!\n\nFormato reconhecido: Destination Address + Bairro + City + CEP + Latitude/Longitude + SPX TN.");
}

function importCSV(text){
 const lines=text.replace(/^\ufeff/,"").split(/\r?\n/).filter(Boolean);
 if(lines.length<2){alert("CSV vazio.");return}
 const rows=lines.map(x=>x.split(";").map(v=>v.replace(/^"|"$/g,"").replaceAll('""','"')));
 const h=rows[0].map(normalize);
 const ai=h.findIndex(x=>["destination address","endereco","address"].includes(x));
 const ci=h.findIndex(x=>["cliente","nome","customer"].includes(x));
 if(ai<0){alert("CSV precisa ter Destination Address ou Endereço.");return}
 rows.slice(1).forEach((r,i)=>{if(r[ai])deliveries.push({client:ci>=0&&r[ci]?r[ci]:"Entrega "+(i+1),address:r[ai],phone:"",obs:"",code:"",lat:"",lon:"",done:false})});
 save();alert((rows.length-1)+" entregas importadas.");
}
function downloadTemplate(){
 if(typeof XLSX==="undefined"){alert("Aguarde a biblioteca Excel carregar.");return}
 let ws=XLSX.utils.aoa_to_sheet([["AT ID","Sequence","Stop","SPX TN","Destination Address","Bairro","City","Zipcode/Postal code","Latitude","Longitude"],["AT20260919A130T",1,1,"BR000000000000","Rua Exemplo, 100","Centro","Santa Fé","86770-000",-23.03849,-51.8018]]);
 let wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Sheet1");XLSX.writeFile(wb,"modelo-rotapro-entregas.xlsx");
}
function exportCSV(){
 let rows=[["SPX TN","Endereço","Latitude","Longitude","Status"],...deliveries.map(d=>[d.code||"",d.address,d.lat||"",d.lon||"",d.done?"Entregue":"Pendente"])];
 download("rotapro-entregas.csv","\ufeff"+rows.map(r=>r.map(x=>`"${String(x??"").replaceAll('"','""')}"`).join(";")).join("\n"),"text/csv")
}
function download(name,data,type){let a=document.createElement("a");a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click()}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js?v=4");
render();