let deliveries=JSON.parse(localStorage.getItem("rotapro_deliveries")||"[]");
const LARGE_ADDRESS_THRESHOLD=10;
let map=null,markers=[],routeLine=null,userMarker=null,currentPosition=null,manualNext=null,selectedDelivery=null,selectedGroup=[],showDone=false,sortMode="route",watchId=null,followUser=true,lastGpsRouteUpdate=0,routeRequestId=0;
let lastCompletedCoord=JSON.parse(localStorage.getItem("rotapro_last_completed_coord")||"null");
let routeCache=JSON.parse(localStorage.getItem("rotapro_route_cache")||"{}");
const OSRM="https://router.project-osrm.org";

// Migração das versões anteriores: Sequence passa a ser o identificador principal.
deliveries.forEach(d=>{
 if(d.sequence===undefined||d.sequence===null||d.sequence==="")d.sequence=cleanSequence(d.originalSequence);
 if(d.originalSequence===undefined)d.originalSequence=d.sequence||"";
 if(d.originalStop===undefined)d.originalStop="";
 if(d.destinationAddress===undefined||d.destinationAddress===null||d.destinationAddress==="") d.destinationAddress=d.address||"";
 if(d.bairro===undefined)d.bairro="";
 if(d.city===undefined)d.city="";
 if(d.zip===undefined)d.zip="";
});

function save(){localStorage.setItem("rotapro_deliveries",JSON.stringify(deliveries));render();if(document.getElementById("mapModal")?.classList.contains("open"))drawMap()}
function val(id){return document.getElementById(id)?.value.trim()||""}
function cleanSequence(v){let s=String(v??"").trim();if(!s||s==='-'||s.toLowerCase()==='nan'||s.toLowerCase()==='null')return "";return s}
function sequenceNumber(d){let n=Number(cleanSequence(d.sequence));return Number.isFinite(n)&&n>0?n:null}
function sequenceLabel(d,i){return cleanSequence(d.sequence)||"Sem Seq."}
function missingSequenceCount(){return deliveries.filter(d=>!cleanSequence(d.sequence)).length}
function duplicateSequences(){let mapSeq=new Map();deliveries.forEach((d,i)=>{let s=cleanSequence(d.sequence);if(s){if(!mapSeq.has(s))mapSeq.set(s,[]);mapSeq.get(s).push(i)}});return new Set([...mapSeq.values()].filter(a=>a.length>1).flat())}
function sequenceIssue(i){let d=deliveries[i];return !cleanSequence(d.sequence)||duplicateSequences().has(i)}
function addDelivery(){let client=val("client"),address=val("address"),phone=val("phone");if(!client||!address){alert("Informe cliente e endereço.");return}deliveries.push({client,address,destinationAddress:address,bairro:"",city:"",zip:"",phone,obs:"",code:"",lat:"",lon:"",sequence:"",originalSequence:"",originalStop:"",done:false,routeOrder:""});["client","address","phone"].forEach(id=>document.getElementById(id).value="");save();toast("Entrega adicionada — defina a Sequence");openSequenceEditor()}
function coords(d){let lat=parseFloat(String(d.lat).replace(",",".")),lon=parseFloat(String(d.lon).replace(",","."));return Number.isFinite(lat)&&Number.isFinite(lon)?[lat,lon]:null}
function pending(){return deliveries.filter(d=>!d.done)}
function orderedDeliveries(){let arr=deliveries.map((d,i)=>({...d,_i:i}));if(sortMode==="route")arr.sort((a,b)=>{if(a.done!==b.done)return a.done?1:-1;let ar=Number(a.routeOrder)||999999,br=Number(b.routeOrder)||999999;return ar-br||((sequenceNumber(a)||999999)-(sequenceNumber(b)||999999))||a._i-b._i});else arr.sort((a,b)=>{let ar=sequenceNumber(a)||999999,br=sequenceNumber(b)||999999;return ar-br||a._i-b._i});return arr}
function render(){
 const list=document.getElementById("list");list.innerHTML="";const arr=orderedDeliveries();const dup=duplicateSequences();
 arr.forEach(d=>{let i=d._i,e=document.createElement("div");e.className="item"+(d.done?" done":"")+(manualNext===i?" next":"")+(sequenceIssue(i)?" seqIssue":"");
 let routeNo=d.routeOrder?`<span class="routeBadge">Rota ${d.routeOrder}</span>`:"";
 let seq=cleanSequence(d.sequence);let seqBadge=seq?`<span class="sequenceBadge">SEQ ${esc(seq)}</span>`:`<span class="missingBadge">⚠ Sem Sequence</span>`;
 let warning=dup.has(i)?`<span class="duplicateBadge">⚠ Sequence duplicada</span>`:"";
 e.innerHTML=`<div class="itemHead"><div class="routeNum ${seq?'':'missing'}">${seq?esc(seq):'?'}</div><div style="flex:1"><div class="num">${esc(d.code||d.client)}</div><div class="meta">📍 ${esc(d.address)}</div><div class="badges">${seqBadge}${routeNo}${warning}</div></div></div><div class="actions"><button class="sequenceEdit" onclick="editSequence(${i})">✏️ Sequence</button><button onclick="toggle(${i})">${d.done?"↩️ Reabrir":"✅ Entregue"}</button><button onclick="selectNext(${i})">👉 Próxima</button><button onclick="navigate(${i})">🧭 Navegar</button></div>`;list.appendChild(e)});
 if(!arr.length)list.innerHTML='<div class="empty">Nenhuma entrega cadastrada.</div>';
 let total=deliveries.length,done=deliveries.filter(x=>x.done).length,missing=missingSequenceCount(),dups=dup.size;
 document.getElementById("total").textContent=total;document.getElementById("done").textContent=done;document.getElementById("remaining").textContent=total-done;document.getElementById("bar").style.width=(total?done/total*100:0)+"%";
 document.getElementById("missingSeq").textContent=missing;document.getElementById("duplicateSeq").textContent=dups;
 const homeAdded=document.getElementById("homeAddedText");if(homeAdded)homeAdded.textContent=`Adicionados (${missing})`;
 const pct=total?Math.round(done/total*100):0;const hp=document.getElementById("homeProgressText");if(hp)hp.textContent=pct+"%";
 const alertBox=document.getElementById("sequenceAlert");if(missing||dups){alertBox.classList.add("show");alertBox.innerHTML=`⚠️ <b>${missing+dups} problema(s) de identificação.</b> ${missing?missing+" sem Sequence. ":""}${dups?dups+" com Sequence duplicada.":""} <button onclick="openSequenceEditor()">Corrigir agora</button>`}else{alertBox.classList.remove("show");alertBox.innerHTML=""}
 const bigAddresses=addressGroups();
 const addressAlert=document.getElementById("addressAlertBanner");
 if(addressAlert){
   if(bigAddresses.length){const max=bigAddresses[0].indexes.length;addressAlert.classList.add("show");addressAlert.innerHTML=`⚠️ <div><b>${bigAddresses.length} endereço(s) com muitas entregas</b><small>Maior concentração: ${max} entregas no mesmo endereço. Confira o condomínio/prédio antes de confirmar.</small></div><button onclick="openAddressAlerts()">Ver alertas</button>`}
   else{addressAlert.classList.remove("show");addressAlert.innerHTML=""}
 }
 updateNextBox()
}
function nextDelivery(){
 if(manualNext!==null&&!deliveries[manualNext]?.done)return deliveries[manualNext];
 return deliveries.find(x=>!x.done&&Number(x.routeOrder)===1)||deliveries.find(x=>!x.done&&cleanSequence(x.sequence))||deliveries.find(x=>!x.done);
}
function updateNextBox(){let d=nextDelivery(),box=document.getElementById("nextBox");if(!d){box.textContent="Todas as entregas foram concluídas.";document.getElementById("nextNavigate").disabled=true;document.getElementById("nextDone").disabled=true;return}box.innerHTML=`<div>📦 <b>SEQ ${esc(cleanSequence(d.sequence)||"?")}</b> — ${esc(d.code||d.client)}</div><div class="address">📍 ${esc(d.destinationAddress||d.address||"Endereço não informado")}</div>`;document.getElementById("nextNavigate").disabled=false;document.getElementById("nextDone").disabled=false;document.getElementById("mapSubtitle").textContent=`Próxima: SEQ ${cleanSequence(d.sequence)||"?"} • ${d.destinationAddress||d.address||"Endereço"}`}
function toggle(i){if(!deliveries[i])return;deliveries[i].done=!deliveries[i].done;if(deliveries[i].done){const c=coords(deliveries[i]);if(c){lastCompletedCoord=c;try{localStorage.setItem("rotapro_last_completed_coord",JSON.stringify(c))}catch(e){}}if(manualNext===i||selectedDelivery===i){manualNext=null;selectedDelivery=null;}}if(deliveries.length&&deliveries.every(d=>d.done)){deliveries=[];manualNext=null;selectedDelivery=null;selectedGroup=[];routeCache={};lastCompletedCoord=null;try{localStorage.removeItem("rotapro_deliveries");localStorage.removeItem("rotapro_route_cache");localStorage.removeItem("rotapro_last_completed_coord")}catch(e){}save();if(document.getElementById("mapModal").classList.contains("open")){showDeliveryDetails(null);drawMap(false)}toast("🎉 Rota concluída! Lista limpa automaticamente. Pronto para a próxima rota.");return}save();if(document.getElementById("mapModal").classList.contains("open")){showDeliveryDetails(null);drawMap(false)}toast(deliveries[i].done?`SEQ ${cleanSequence(deliveries[i].sequence)||"?"} confirmada — removida do mapa`:`SEQ ${cleanSequence(deliveries[i].sequence)||"?"} reaberta`)}
function selectNext(i){if(deliveries[i].done){alert("Esta entrega já está concluída.");return}manualNext=i;selectedDelivery=i;render();openMap();setTimeout(()=>{showDeliveryDetails(i);let d=deliveries[i],c=coords(d);if(c)map.setView(c,16);},100);toast(`SEQ ${cleanSequence(deliveries[i].sequence)||"?"} definida como próxima`)}
function navigate(i){let d=deliveries[i],dest=coords(d)?coords(d).join(","):d.address;window.open("https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(dest),"_blank")}
function openMap(){document.getElementById("mapModal").classList.add("open");document.getElementById("mapModal").setAttribute("aria-hidden","false");startLocationWatch();setTimeout(()=>{if(!map)initMap();else{map.invalidateSize();drawMap()}},80)}
function closeMap(){document.getElementById("mapModal").classList.remove("open");document.getElementById("mapModal").setAttribute("aria-hidden","true");stopLocationWatch()}
function initMap(){if(!window.L)return;map=L.map("map",{zoomControl:true,rotate:true,touchRotate:true,dragRotate:true,shiftKeyRotate:true,rotateClockwise:true,rotateControl:{position:"topright",behavior:"reset",closeOnZeroBearing:false}}).setView([-23.04,-51.81],13);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(map);drawMap()}
function clearMapLayers(){routeRequestId++;markers.forEach(m=>map.removeLayer(m));markers=[];if(routeLine){map.removeLayer(routeLine);routeLine=null}if(userMarker){map.removeLayer(userMarker);userMarker=null}}
function updateUserMarker(){if(!map||!currentPosition)return;if(userMarker)map.removeLayer(userMarker);let icon=L.divIcon({className:"",html:`<div class="user-location"><span></span></div>`,iconSize:[34,34],iconAnchor:[17,17]});userMarker=L.marker(currentPosition,{icon,zIndexOffset:1000}).addTo(map).bindPopup("📍 Minha posição em tempo real");if(followUser)map.setView(currentPosition,Math.max(map.getZoom(),15),{animate:true});document.getElementById("gpsStatus").textContent="GPS ativo • posição atualizada"}
function startLocationWatch(){if(!navigator.geolocation){document.getElementById("gpsStatus").textContent="GPS não disponível";return}if(watchId!==null)return;watchId=navigator.geolocation.watchPosition(p=>{currentPosition=[p.coords.latitude,p.coords.longitude];updateUserMarker();if(map&&document.getElementById("mapModal").classList.contains("open")&&Date.now()-lastGpsRouteUpdate>10000){lastGpsRouteUpdate=Date.now();drawMap(false)}},()=>{document.getElementById("gpsStatus").textContent="GPS indisponível";toast("Não foi possível acompanhar sua posição. Autorize o GPS.")},{enableHighAccuracy:true,maximumAge:2000,timeout:15000})}
function stopLocationWatch(){if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null}}
function addressKey(d){return String(d?.destinationAddress||d?.address||"").trim().replace(/\s+/g," ").toLowerCase()}
function groupIndexesByAddress(i){const key=addressKey(deliveries[i]);if(!key)return [i];return deliveries.map((d,idx)=>addressKey(d)===key?idx:-1).filter(idx=>idx>=0)}
function addressGroups(){
 const groups=new Map();
 deliveries.forEach((d,i)=>{const key=addressKey(d);if(!key)return;if(!groups.has(key))groups.set(key,{address:d.destinationAddress||d.address||"Endereço não informado",indexes:[]});groups.get(key).indexes.push(i)});
 return [...groups.values()].filter(g=>g.indexes.length>=LARGE_ADDRESS_THRESHOLD).sort((a,b)=>b.indexes.length-a.indexes.length);
}
function largeAddressFor(i){const key=addressKey(deliveries[i]);return addressGroups().find(g=>g.indexes.some(idx=>idx===i))||null}
function openAddressAlerts(){
 const groups=addressGroups();
 const modal=document.getElementById("addressAlertModal");
 const box=document.getElementById("addressAlertList");
 if(!modal||!box)return;
 box.innerHTML=groups.length?groups.map(g=>{
   const pendingCount=g.indexes.filter(i=>!deliveries[i].done).length;
   const seqs=g.indexes.map(i=>cleanSequence(deliveries[i].sequence)||"?").join(" • ");
   const level=g.indexes.length>=50?"alertMax":g.indexes.length>=30?"alertHigh":"alertMed";
   return `<div class="addressAlertItem ${level}"><div class="addressAlertTop"><span class="addressAlertCount">${g.indexes.length}</span><div><b>${esc(g.address)}</b><small>${pendingCount} pendentes • ${g.indexes.length-pendingCount} concluídas</small></div></div><div class="addressAlertSeq"><b>SEQUENCES:</b> ${esc(seqs)}</div></div>`;
 }).join(""):'<div class="empty">Nenhum endereço com concentração de entregas.</div>';
 modal.classList.add("open");modal.setAttribute("aria-hidden","false");
}
function closeAddressAlerts(){const modal=document.getElementById("addressAlertModal");if(modal){modal.classList.remove("open");modal.setAttribute("aria-hidden","true")}}
function showDeliveryDetails(i){
 selectedDelivery=i;
 if(i===null||!deliveries[i]||deliveries[i].done){
   selectedGroup=[];
   document.getElementById("deliveryDetails").classList.remove("show");
   document.getElementById("deliveryDetails").innerHTML="";
   document.getElementById("mapModal").classList.remove("detail-open");
   if(map)drawMap(false);
   return;
 }
 const group=groupIndexesByAddress(i);
 selectedGroup=group.length?group:[i];
 const d=deliveries[i];
 const dest=d.destinationAddress||d.address||"Endereço não informado";
 const seqs=selectedGroup.map(idx=>cleanSequence(deliveries[idx].sequence)||"?").join(" - ");
 const largeGroup=largeAddressFor(i);
 const largeAlert=largeGroup?`<button class="largeAddressWarning" onclick="openAddressAlerts()">⚠️ ${largeGroup.indexes.length} ENTREGAS NESTE ENDEREÇO <span>VER ALERTA</span></button>`:"";
 document.getElementById("deliveryDetails").innerHTML=`
 <div class="compactDetail">
   <button class="detailClose" onclick="showDeliveryDetails(null)">×</button>
   <div class="compactInfo">
     <span class="compactLabel">SEQUENCE</span>
     <b class="compactSeq">${esc(seqs)}</b>
   </div>
   <div class="compactInfo addressCompact">
     <span class="compactLabel">DESTINATION ADDRESS</span>
     <div class="compactAddress">📍 ${esc(dest)}</div>
   </div>
   ${largeAlert}
   <button class="success confirmBig compactConfirm" onclick="confirmAddressGroup()">✅ CONFIRMAR ENTREGA</button>
 </div>`;
 document.getElementById("deliveryDetails").classList.add("show");
 document.getElementById("mapModal").classList.add("detail-open");
}
function confirmAddressGroup(){
 const group=(selectedGroup||[]).filter(i=>deliveries[i]&&!deliveries[i].done);
 if(!group.length)return;
 group.forEach(i=>deliveries[i].done=true);
 const seqs=group.map(i=>cleanSequence(deliveries[i].sequence)||"?").join(" - ");
 manualNext=null;selectedDelivery=null;selectedGroup=[];
 const finished=deliveries.length>0 && deliveries.every(d=>d.done);
 if(finished){
   deliveries=[];
   manualNext=null;selectedDelivery=null;selectedGroup=[];
   try{localStorage.removeItem("rotapro_deliveries");localStorage.removeItem("rotapro_route_cache");localStorage.removeItem("rotapro_last_completed_coord")}catch(e){}
   routeCache={};lastCompletedCoord=null;
   save();
   if(document.getElementById("mapModal").classList.contains("open")){showDeliveryDetails(null);drawMap(false)}
   closeAddressAlerts();
   toast("🎉 Rota concluída! Lista limpa automaticamente. Pronto para a próxima rota.");
   return;
 }
 save();
 if(document.getElementById("mapModal").classList.contains("open")){showDeliveryDetails(null);drawMap(false)}
 toast(`Entrega confirmada • SEQUENCE ${seqs}`);
}
function copyAddress(i){let a=deliveries[i]?.destinationAddress||deliveries[i]?.address||"";if(!a)return; if(navigator.clipboard){navigator.clipboard.writeText(a).then(()=>toast("Endereço copiado"),()=>toast("Não foi possível copiar o endereço"));}else{let ta=document.createElement("textarea");ta.value=a;document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();toast("Endereço copiado")}}
function getBairro(address){let p=String(address||"").split(",");return p.length>=3?p[p.length-3]||"-":"-"}
function getCidade(address){let p=String(address||"").split(",");return p.length>=2?p[p.length-2]||"-":"-"}
function drawMap(fit=true){
 if(!map)return;
 clearMapLayers();
 let points=[];
 const groups=new Map();
 deliveries.forEach((d,i)=>{
   let c=coords(d);if(!c||(!showDone&&d.done))return;
   const key=addressKey(d)||`__${i}`;
   if(!groups.has(key))groups.set(key,{indexes:[],coord:c});
   groups.get(key).indexes.push(i);
 });
 const activeNext=nextDelivery();
 groups.forEach(g=>{
   const pendingIdx=g.indexes.filter(i=>!deliveries[i].done);
   const activeIdx=pendingIdx.length?pendingIdx:g.indexes;
   if(!showDone&&pendingIdx.length===0)return;
   const first=activeIdx[0]; const c=g.coord; points.push(c);
   const isSelected=g.indexes.includes(selectedDelivery);
   const isManualNext=g.indexes.includes(manualNext);
   const isAutoNext=activeNext&&g.indexes.includes(deliveries.indexOf(activeNext));
   const allDone=pendingIdx.length===0;
   const cls=allDone?"done":((isManualNext||isAutoNext||isSelected)?"selected":"pending");
   const labels=activeIdx.map(i=>cleanSequence(deliveries[i].sequence)||"?");
   const label=labels.length>1?labels[0]+"+":labels[0];
   let icon=L.divIcon({className:"",html:`<div class="map-marker ${cls}">${allDone?"✓":esc(label)}</div>`,iconSize:[40,40],iconAnchor:[20,20]});
   let m=L.marker(c,{icon}).addTo(map);
   m.on("click",()=>{if(allDone)return;manualNext=first;selectedDelivery=first;showDeliveryDetails(first);drawMap(false);map.setView(c,Math.max(map.getZoom(),15),{animate:true});toast(`SEQ ${cleanSequence(deliveries[first].sequence)||"?"} selecionada como próxima`)});
   markers.push(m);
 });
 if(currentPosition)updateUserMarker();
 if(points.length&&fit&&!currentPosition){let bounds=L.latLngBounds(points);map.fitBounds(bounds.pad(.12))}
 // Mostra somente o trecho atual: sua posição -> próxima entrega.
 let next=nextDelivery();
 if(next&&coords(next)){
   const destination=coords(next);
   const start=currentPosition||lastCompletedCoord;
   if(start)drawRoadRoute([start,destination],{destinationIndex:deliveries.indexOf(next)});
 }
 document.getElementById("mapPending").textContent=pending().length;
 document.getElementById("mapDone").textContent=deliveries.filter(d=>d.done).length;
}
function routeCacheKey(destinationIndex,to){
 const d=deliveries[destinationIndex];
 const seq=cleanSequence(d?.sequence)||String(destinationIndex);
 const ref=lastCompletedCoord?lastCompletedCoord.join(","):"start";
 return `${seq}|${ref}|${to.join(",")}`;
}
function saveRouteCache(key,geom,from,to){
 routeCache[key]={geom,savedAt:Date.now(),from,to};
 const keys=Object.keys(routeCache);
 if(keys.length>30)keys.sort((a,b)=>(routeCache[a].savedAt||0)-(routeCache[b].savedAt||0)).slice(0,keys.length-30).forEach(k=>delete routeCache[k]);
 try{localStorage.setItem("rotapro_route_cache",JSON.stringify(routeCache))}catch(e){}
}
function cachedRouteFor(destinationIndex,to){
 const key=routeCacheKey(destinationIndex,to);
 return routeCache[key]?.geom||null;
}
async function drawRoadRoute(line,meta={}){
 const requestId=routeRequestId;
 try{
   if(!line||line.length<2)return;
   const path=line.map(c=>`${c[1]},${c[0]}`).join(";");
   const r=await fetch(`${OSRM}/route/v1/driving/${path}?overview=full&geometries=geojson&steps=false`);
   if(!r.ok)throw new Error("route");
   const j=await r.json();
   const geom=j.routes?.[0]?.geometry?.coordinates||[];
   const all=geom.map(x=>[x[1],x[0]]);
   if(all.length&&map&&requestId===routeRequestId){
     routeLine=L.polyline(all,{color:"#0866ff",weight:6,opacity:.88}).addTo(map);
     if(meta.destinationIndex>=0)saveRouteCache(routeCacheKey(meta.destinationIndex,line[line.length-1]),all,line[0],line[line.length-1]);
   }
 }catch(e){
   if(requestId!==routeRequestId||!map)return;
   const cached=meta.destinationIndex>=0?cachedRouteFor(meta.destinationIndex,line[line.length-1]):null;
   const fallback=cached||line.map(c=>[c[0],c[1]]);
   if(fallback.length>1)routeLine=L.polyline(fallback,{color:cached?"#0b8f4d":"#0866ff",weight:cached?6:5,dashArray:cached?null:"9 8",opacity:.9}).addTo(map);
   if(cached)toast("Internet indisponível — usando o trecho salvo como referência");
 }
}
async function optimizeRoute(){
 const left=pending().filter(d=>coords(d));
 if(!left.length){alert("Não há entregas pendentes com latitude/longitude.");return}
 toast("Calculando a rota mais eficiente pelas ruas...");
 const start=currentPosition||coords(left[0]);
 try{
   const points=currentPosition?[currentPosition,...left.map(coords)]:left.map(coords);
   const path=points.map(c=>`${c[1]},${c[0]}`).join(";");
   const r=await fetch(`${OSRM}/trip/v1/driving/${path}?source=first&roundtrip=false&overview=false&steps=false`);
   if(!r.ok)throw new Error("trip");
   const j=await r.json();
   const ordered=(j.waypoints||[]).filter(w=>w.waypoint_index!==undefined).sort((a,b)=>a.waypoint_index-b.waypoint_index);
   let order=1;
   ordered.forEach(w=>{
     if(currentPosition&&w.waypoint_index===0)return;
     const inputIndex=w.waypoint_index-(currentPosition?1:0);
     const d=left[inputIndex];
     if(d)d.routeOrder=order++;
   });
   if(order===1)throw new Error("empty");
   manualNext=null;selectedDelivery=null;sortMode="route";
   document.getElementById("routeTab").classList.add("active");document.getElementById("originalTab").classList.remove("active");
   save();openMap();toast("Rota otimizada pelas ruas e salva — próxima entrega destacada em vermelho");
 }catch(e){
   // Fallback seguro: mantém a otimização local caso o serviço de roteamento esteja indisponível.
   let pool=left.slice(),order=1,from=start;
   while(pool.length){let best=0,bestDist=Infinity;for(let i=0;i<pool.length;i++){let dist=haversine(from,coords(pool[i]));if(dist<bestDist){bestDist=dist;best=i}}let d=pool.splice(best,1)[0];d.routeOrder=order++;from=coords(d)}
   manualNext=null;selectedDelivery=null;sortMode="route";document.getElementById("routeTab").classList.add("active");document.getElementById("originalTab").classList.remove("active");save();openMap();toast("Rota otimizada localmente — o serviço de ruas está indisponível");
 }
}
function restoreOriginal(){deliveries.forEach(d=>d.routeOrder="");manualNext=null;sortMode="original";document.getElementById("originalTab").classList.add("active");document.getElementById("routeTab").classList.remove("active");save();toast("Ordem original restaurada")}
function haversine(a,b){const R=6371,toRad=x=>x*Math.PI/180,dLat=toRad(b[0]-a[0]),dLon=toRad(b[1]-a[1]);const x=Math.sin(dLat/2)**2+Math.cos(toRad(a[0]))*Math.cos(toRad(b[0]))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function locate(){startLocationWatch();if(currentPosition&&map){followUser=true;updateUserMarker();toast("Acompanhamento GPS ativado");return}if(!navigator.geolocation){alert("Seu navegador não oferece localização.");return}navigator.geolocation.getCurrentPosition(p=>{currentPosition=[p.coords.latitude,p.coords.longitude];followUser=true;updateUserMarker();drawMap(false);toast("Sua posição foi atualizada")},()=>alert("Não foi possível obter sua localização. Autorize o GPS no navegador."),{enableHighAccuracy:true,timeout:10000})}
function toggleMapFollow(){followUser=!followUser;if(followUser){if(currentPosition)updateUserMarker();toast("Acompanhamento da posição ativado")}else{toast("Acompanhamento da posição pausado")};updateFollowButton()}

function updateFollowButton(){const b=document.getElementById("followMapBtn");if(!b)return;b.textContent=followUser?"🧭 Seguir posição":"⏸ Pausar posição";b.classList.toggle("followActive",followUser)}

function importFile(ev){const f=ev.target.files[0];if(!f)return;if(/\.csv$/i.test(f.name)){let r=new FileReader();r.onload=()=>importCSV(r.result);r.readAsText(f,"UTF-8");ev.target.value="";return}if(typeof XLSX==="undefined"){alert("Biblioteca Excel não carregou.");return}let r=new FileReader();r.onload=e=>{try{let wb=XLSX.read(new Uint8Array(e.target.result),{type:"array"}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:""});importExcel(rows)}catch(err){alert("Erro no Excel: "+err.message)}};r.readAsArrayBuffer(f);ev.target.value=""}
function norm(s){return String(s??"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ")}
function key(keys,names){let n=names.map(norm);return keys.find(k=>n.includes(norm(k)))||null}
function importExcel(rows){if(!rows.length){alert("Planilha vazia.");return}let keys=Object.keys(rows[0]),ak=key(keys,["Destination Address","Endereço","Endereco","Address"]),ck=key(keys,["SPX TN","Tracking","Tracking Number","Código","Codigo"]),bk=key(keys,["Bairro"]),city=key(keys,["City","Cidade"]),zip=key(keys,["Zipcode/Postal code","CEP","Zipcode"]),lat=key(keys,["Latitude","Lat"]),lon=key(keys,["Longitude","Long","Lon"]),seq=key(keys,["Sequence","Sequencia","Sequência"]),stop=key(keys,["Stop"]);if(!ak){alert("Não encontrei Destination Address.");return}let n=0;rows.forEach((r,i)=>{let raw=String(r[ak]??"").trim();if(!raw)return;let s=cleanSequence(seq?r[seq]:"");let parts=[raw,bk?r[bk]:"",city?r[city]:"",zip?r[zip]:""].map(x=>String(x??"").trim()).filter(Boolean);deliveries.push({client:ck?String(r[ck]||""):"Entrega "+(i+1),address:[...new Set(parts)].join(", "),destinationAddress:raw,bairro:bk?String(r[bk]||"").trim():"",city:city?String(r[city]||"").trim():"",zip:zip?String(r[zip]||"").trim():"",phone:"",obs:s?`Sequence: ${s}`:"",code:ck?String(r[ck]||""):"",lat:lat?String(r[lat]||""):"",lon:lon?String(r[lon]||""):"",sequence:s,originalSequence:s,originalStop:stop?String(r[stop]||""):"",done:false,routeOrder:""});n++});sortMode="original";save();toast(n+" entregas importadas — confira a Sequence");if(missingSequenceCount())openSequenceEditor()}
function importCSV(){alert("Para este modelo de entrega, prefira o Excel .xlsx.")}
function downloadTemplate(){if(!XLSX)return;let ws=XLSX.utils.aoa_to_sheet([["AT ID","Sequence","SPX TN","Destination Address","Bairro","City","Zipcode/Postal code","Latitude","Longitude"],["AT20260919A130T",1,"BR000000000000","Rua Exemplo, 100","Centro","Santa Fé","86770-000",-23.03849,-51.8018]]),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Sheet1");XLSX.writeFile(wb,"modelo-rotapro.xlsx")}
function exportCSV(){let rows=[["Rota","Sequence","SPX TN","Endereço","Latitude","Longitude","Status"],...deliveries.map(d=>[d.routeOrder||"",cleanSequence(d.sequence)||"",d.code||"",d.address,d.lat||"",d.lon||"",d.done?"Entregue":"Pendente"])];download("rotapro-rota.csv","\ufeff"+rows.map(r=>r.map(x=>`"${String(x??"").replaceAll('"','""')}"`).join(";")).join("\n"),"text/csv")}
function download(n,d,t){let a=document.createElement("a");a.href=URL.createObjectURL(new Blob([d],{type:t}));a.download=n;a.click()}
function clearAll(){if(confirm("Apagar todas as entregas?")){deliveries=[];manualNext=null;selectedDelivery=null;save();toast("Entregas apagadas")}}

// Editor de Sequence: permite corrigir manualmente e preencher automaticamente os números faltantes.
function openSequenceEditor(){renderSequenceEditor();document.getElementById("sequenceModal").classList.add("open");document.getElementById("sequenceModal").setAttribute("aria-hidden","false")}
function closeSequenceEditor(){document.getElementById("sequenceModal").classList.remove("open");document.getElementById("sequenceModal").setAttribute("aria-hidden","true")}
function editSequence(i){openSequenceEditor();setTimeout(()=>{let el=document.querySelector(`#seqInput_${i}`);if(el){el.focus();el.select()}},60)}
function renderSequenceEditor(){const box=document.getElementById("sequenceEditorList");box.innerHTML="";deliveries.forEach((d,i)=>{let issue=sequenceIssue(i),s=cleanSequence(d.sequence);let row=document.createElement("div");row.className="seqRow"+(issue?" issue":"");row.innerHTML=`<div class="seqInfo"><b>${esc(d.code||d.client)}</b><small>${esc(d.address)}</small>${issue?`<span>${!s?"⚠ Sem Sequence":"⚠ Sequence duplicada"}</span>`:""}</div><input id="seqInput_${i}" class="seqInput" inputmode="numeric" value="${esc(s)}" placeholder="Sequence"><button onclick="focusSequence(${i})">✏️</button>`;box.appendChild(row)});updateSequenceEditorStats()}
function focusSequence(i){let el=document.getElementById(`seqInput_${i}`);if(el){el.focus();el.select()}}
function collectSequenceInputs(){let used=new Map(),changes=[];for(let i=0;i<deliveries.length;i++){let el=document.getElementById(`seqInput_${i}`);let s=cleanSequence(el?el.value:deliveries[i].sequence);if(s&&!/^\d+$/.test(s)){alert(`Sequence inválida na entrega ${i+1}. Use somente números.`);return null}if(s){if(used.has(s)){alert(`A Sequence ${s} está repetida. Cada entrega deve ter uma Sequence diferente.`);return null}used.set(s,i)}changes.push(s)}return changes}
function saveSequences(){let values=collectSequenceInputs();if(!values)return;values.forEach((s,i)=>{deliveries[i].sequence=s});save();closeSequenceEditor();toast(missingSequenceCount()?"Ainda existem entregas sem Sequence":"Sequences corrigidas e salvas");if(missingSequenceCount())setTimeout(openSequenceEditor,250)}
function fillMissingSequences(){let used=new Set(deliveries.map(d=>Number(cleanSequence(d.sequence))).filter(n=>Number.isInteger(n)&&n>0));let next=1;deliveries.forEach((d,i)=>{if(!cleanSequence(d.sequence)){while(used.has(next))next++;let el=document.getElementById(`seqInput_${i}`);if(el)el.value=next;used.add(next);next++}});updateSequenceEditorStats();toast("Números sugeridos para as entregas sem Sequence — confira antes de salvar")}
function updateSequenceEditorStats(){let inputs=[...document.querySelectorAll(".seqInput")];let missing=inputs.filter(x=>!cleanSequence(x.value)).length;document.getElementById("editorMissing").textContent=missing;document.getElementById("editorTotal").textContent=inputs.length}

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
let toastTimer;function toast(t){let x=document.getElementById("toast");x.textContent=t;x.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>x.classList.remove("show"),2600)}

document.getElementById("homeImportBtn")?.addEventListener("click",()=>document.getElementById("file").click());
document.getElementById("homeSequenceBtn")?.addEventListener("click",openSequenceEditor);
document.getElementById("homeListBtn")?.addEventListener("click",()=>document.getElementById("list")?.scrollIntoView({behavior:"smooth",block:"start"}));
document.getElementById("homeManualBtn")?.addEventListener("click",()=>document.getElementById("importSection")?.scrollIntoView({behavior:"smooth",block:"center"}));
document.getElementById("homeClearBtn")?.addEventListener("click",clearAll);
document.getElementById("file").addEventListener("change",importFile);document.getElementById("optBtn").addEventListener("click",optimizeRoute);document.getElementById("navOptimize").addEventListener("click",optimizeRoute);document.getElementById("clearRouteBtn").addEventListener("click",restoreOriginal);document.getElementById("locateBtn").addEventListener("click",locate);document.getElementById("followMapBtn")?.addEventListener("click",toggleMapFollow);document.getElementById("mapOptimizeBtn")?.addEventListener("click",optimizeRoute);document.getElementById("openMapBtn").addEventListener("click",openMap);document.getElementById("navMap").addEventListener("click",openMap);document.getElementById("closeMap").addEventListener("click",closeMap);document.getElementById("centerMap").addEventListener("click",()=>{followUser=true;if(currentPosition)map.setView(currentPosition,16,{animate:true});else{let d=nextDelivery(),c=d&&coords(d);if(c)map.setView(c,16)}});document.getElementById("showDone").addEventListener("change",e=>{showDone=e.target.checked;drawMap()});document.getElementById("routeTab").addEventListener("click",()=>{sortMode="route";document.getElementById("routeTab").classList.add("active");document.getElementById("originalTab").classList.remove("active");render()});document.getElementById("originalTab").addEventListener("click",()=>{sortMode="original";document.getElementById("originalTab").classList.add("active");document.getElementById("routeTab").classList.remove("active");render()});document.getElementById("nextNavigate").addEventListener("click",()=>{let d=nextDelivery();if(d)navigate(deliveries.indexOf(d))});document.getElementById("nextDone").addEventListener("click",()=>{let d=nextDelivery();if(d)toggle(deliveries.indexOf(d))});document.getElementById("sequenceBtn").addEventListener("click",openSequenceEditor);document.getElementById("closeSequenceModal").addEventListener("click",closeSequenceEditor);document.getElementById("fillSequencesBtn").addEventListener("click",fillMissingSequences);document.getElementById("saveSequencesBtn").addEventListener("click",saveSequences);document.getElementById("sequenceModal").addEventListener("click",e=>{if(e.target.id==="sequenceModal")closeSequenceEditor()});document.getElementById("closeAddressAlertModal")?.addEventListener("click",closeAddressAlerts);document.getElementById("addressAlertModal")?.addEventListener("click",e=>{if(e.target.id==="addressAlertModal")closeAddressAlerts()});if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js?v=14");updateFollowButton();render();

// RotaPro 2.4 - instalação PWA
let deferredInstallPrompt=null;
function setupInstallApp(){
 const btn=document.getElementById('installBtn');
 if(!btn)return;
 const standalone=window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true;
 if(standalone){btn.hidden=true;return;}
 window.addEventListener('beforeinstallprompt',e=>{
   e.preventDefault(); deferredInstallPrompt=e; btn.hidden=false;
 });
 btn.addEventListener('click',async()=>{
   if(deferredInstallPrompt){
     deferredInstallPrompt.prompt();
     try{await deferredInstallPrompt.userChoice}catch(e){}
     deferredInstallPrompt=null; btn.hidden=true;
   }else{
     alert('No celular, use o menu do navegador e escolha “Adicionar à tela inicial” ou “Instalar aplicativo”.');
   }
 });
 window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;btn.hidden=true;toast('RotaPro instalado na tela inicial.');});
}
setupInstallApp();
