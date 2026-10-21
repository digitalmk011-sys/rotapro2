let deliveries=JSON.parse(localStorage.getItem("rotapro_deliveries")||"[]");
const LARGE_ADDRESS_THRESHOLD=10;
let map=null,markers=[],routeLine=null,userMarker=null,currentPosition=null,manualNext=null,autoNext=null,selectedDelivery=null,selectedGroup=[],showDone=false,sortMode="route",watchId=null,followUser=true,lastGpsRouteUpdate=0,routeRequestId=0;
// Escolha manual protegida contra recarregamentos do PWA.
const MANUAL_CHOICE_KEY="rotapro_manual_destination_v313";
function persistManualChoice(){
 try{
  const d=manualNext!==null?deliveries[manualNext]:null;
  if(d&&!d.done)localStorage.setItem(MANUAL_CHOICE_KEY,JSON.stringify({index:manualNext,sequence:cleanSequence(d.sequence),code:String(d.code||""),address:String(d.destinationAddress||d.address||"")}));
  else localStorage.removeItem(MANUAL_CHOICE_KEY);
 }catch(e){}
}
// A escolha automatica tambem fica fixa ate a entrega ser concluida.
const AUTO_CHOICE_KEY="rotapro_auto_destination_v314";
function persistAutoChoice(){
 try{
  const d=autoNext!==null?deliveries[autoNext]:null;
  if(d&&!d.done)localStorage.setItem(AUTO_CHOICE_KEY,JSON.stringify({index:autoNext,sequence:cleanSequence(d.sequence),code:String(d.code||""),address:String(d.destinationAddress||d.address||"")}));
  else localStorage.removeItem(AUTO_CHOICE_KEY);
 }catch(e){}
}
function restoreAutoDestination(){
 try{
  const raw=localStorage.getItem(AUTO_CHOICE_KEY);if(!raw)return;
  const saved=JSON.parse(raw);
  const matches=d=>d&&!d.done&&cleanSequence(d.sequence)===saved.sequence&&String(d.code||"")===saved.code&&String(d.destinationAddress||d.address||"")===saved.address;
  const i=Number.isInteger(saved.index)&&matches(deliveries[saved.index])?saved.index:deliveries.findIndex(matches);
  if(i>=0){const planned=deliveries.filter(d=>!d.done&&Number(d.routeOrder)>0).sort((a,b)=>Number(a.routeOrder)-Number(b.routeOrder));autoNext=planned.length?deliveries.indexOf(planned[0]):i;}else localStorage.removeItem(AUTO_CHOICE_KEY);
 }catch(e){try{localStorage.removeItem(AUTO_CHOICE_KEY)}catch(_){}}
}
function firstPlannedPending(){
 // Com uma rota otimizada ativa, a próxima parada vem SEMPRE da ordem calculada.
 const planned=deliveries.map((d,i)=>({d,i})).filter(x=>!x.d.done&&Number(x.d.routeOrder)>0)
   .sort((a,b)=>Number(a.d.routeOrder)-Number(b.d.routeOrder)||a.i-b.i);
 return planned.length?planned[0].d:null;
}
function lockAutomaticDestination(){
 if(autoNext!==null&&deliveries[autoNext]&&!deliveries[autoNext].done)return deliveries[autoNext];
 autoNext=null;
 const hasPlannedRoute=deliveries.some(d=>!d.done&&Number(d.routeOrder)>0);
 const d=hasPlannedRoute?firstPlannedPending():(nearestPendingDelivery()||deliveries.find(x=>!x.done));
 if(d){autoNext=deliveries.indexOf(d);persistAutoChoice();}
 else persistAutoChoice();
 return d||null;
}
function releaseCompletedAutoDestination(){
 if(autoNext!==null&&(!deliveries[autoNext]||deliveries[autoNext].done)){autoNext=null;persistAutoChoice();}
}
function chooseManualDestination(i){
 if(!deliveries[i]||deliveries[i].done)return;
 manualNext=i;selectedDelivery=i;
 persistManualChoice();
 updateNextBox();
}
function restoreManualDestination(){
 try{
  const raw=localStorage.getItem(MANUAL_CHOICE_KEY);
  if(!raw)return;
  const saved=JSON.parse(raw);
  const matches=(d)=>d&&!d.done&&cleanSequence(d.sequence)===saved.sequence&&String(d.code||"")===saved.code&&String(d.destinationAddress||d.address||"")===saved.address;
  const i=Number.isInteger(saved.index)&&matches(deliveries[saved.index])?saved.index:deliveries.findIndex(matches);
  if(i>=0){manualNext=i;selectedDelivery=i;}else localStorage.removeItem(MANUAL_CHOICE_KEY);
 }catch(e){try{localStorage.removeItem(MANUAL_CHOICE_KEY)}catch(_) {}}
}
let lastCompletedCoord=JSON.parse(localStorage.getItem("rotapro_last_completed_coord")||"null");
let routeCache=JSON.parse(localStorage.getItem("rotapro_route_cache")||"{}");
const OSRM="https://router.project-osrm.org";
const TILE_CACHE="rotapro-map-v4";

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

function save(){releaseCompletedAutoDestination();persistManualChoice();persistAutoChoice();localStorage.setItem("rotapro_deliveries",JSON.stringify(deliveries));render();if(document.getElementById("mapModal")?.classList.contains("open"))drawMap()}
function val(id){return document.getElementById(id)?.value.trim()||""}
function cleanSequence(v){let s=String(v??"").trim();if(!s||s.toLowerCase()==='nan'||s.toLowerCase()==='null')return "";return s}
function sequenceNumber(d){let n=Number(cleanSequence(d.sequence));return Number.isFinite(n)&&n>0?n:null}
function sequenceLabel(d,i){return cleanSequence(d.sequence)||"Sem Seq."}
function missingSequenceCount(){return deliveries.filter(d=>!cleanSequence(d.sequence)).length}
function duplicateSequences(){let mapSeq=new Map();deliveries.forEach((d,i)=>{let s=cleanSequence(d.sequence);if(s){if(!mapSeq.has(s))mapSeq.set(s,[]);mapSeq.get(s).push(i)}});return new Set([...mapSeq.values()].filter(a=>a.length>1).flat())}
function sequenceIssue(i){let d=deliveries[i];return !cleanSequence(d.sequence)||duplicateSequences().has(i)}
function addDelivery(){let client=val("client"),address=val("address"),phone=val("phone"),sequence=cleanSequence(val("manualSequence"));if(!sequence){alert("Informe a Sequence da entrega.");document.getElementById("manualSequence").focus();return}if(!address){alert("Informe o endereço completo da entrega.");document.getElementById("address").focus();return}if(deliveries.some(d=>cleanSequence(d.sequence)===sequence)){alert("A Sequence "+sequence+" já está cadastrada. Informe uma Sequence diferente.");document.getElementById("manualSequence").focus();return}deliveries.push({client:client||"Entrega "+sequence,address,destinationAddress:address,bairro:"",city:"",zip:"",phone,obs:"",code:"",lat:"",lon:"",sequence,originalSequence:sequence,originalStop:"",done:false,routeOrder:""});["client","address","phone","manualSequence"].forEach(id=>document.getElementById(id).value="");save();toast("Entrega "+sequence+" adicionada com sucesso!");document.getElementById("manualSequence").focus()}
function coords(d){let lat=parseFloat(String(d.lat).replace(",",".")),lon=parseFloat(String(d.lon).replace(",","."));return Number.isFinite(lat)&&Number.isFinite(lon)?[lat,lon]:null}
function pending(){return deliveries.filter(d=>!d.done)}
function orderedDeliveries(){let arr=deliveries.map((d,i)=>({...d,_i:i}));if(sortMode==="route")arr.sort((a,b)=>{if(a.done!==b.done)return a.done?1:-1;let ar=Number(a.routeOrder)||999999,br=Number(b.routeOrder)||999999;return ar-br||(localStorage.getItem("rotapro_optimization_mode")==="stops"?a._i-b._i:((sequenceNumber(a)||999999)-(sequenceNumber(b)||999999))||a._i-b._i)});else arr.sort((a,b)=>{let ar=sequenceNumber(a)||999999,br=sequenceNumber(b)||999999;return ar-br||a._i-b._i});return arr}
function render(){updateStopCounters();
 const list=document.getElementById("list");list.innerHTML="";const arr=orderedDeliveries();const dup=duplicateSequences();
 arr.forEach(d=>{let i=d._i,e=document.createElement("div");e.className="item"+(d.done?" done":"")+((manualNext===i||(manualNext===null&&autoNext===i))?" next":"")+(sequenceIssue(i)?" seqIssue":"");
 let routeNo=d.routeOrder?`<span class="routeBadge">${d.routeOrder}ª ${localStorage.getItem("rotapro_optimization_mode")==="stops"?"PARADA":"ENTREGA"}</span>`:"";
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
function nearestPendingDelivery(){
 const pool=deliveries.map((d,i)=>({d,i,c:coords(d)})).filter(x=>!x.d.done&&x.c);
 if(!pool.length)return null;
 const from=currentPosition||lastCompletedCoord;
 if(!from)return pool.sort((a,b)=>((Number(a.d.routeOrder)||999999)-(Number(b.d.routeOrder)||999999))||((sequenceNumber(a.d)||999999)-(sequenceNumber(b.d)||999999)))[0].d;
 let best=pool[0],bestDist=haversine(from,best.c);
 for(let i=1;i<pool.length;i++){const dist=haversine(from,pool[i].c);if(dist<bestDist){best=pool[i];bestDist=dist}}
 return best.d;
}
function nextDelivery(){
 if(manualNext!==null&&!deliveries[manualNext]?.done)return deliveries[manualNext];
 return lockAutomaticDestination();
}
function updateNextBox(){let d=nextDelivery(),box=document.getElementById("nextBox");if(!d){box.textContent="Todas as entregas foram concluídas.";document.getElementById("nextNavigate").disabled=true;document.getElementById("nextDone").disabled=true;return}box.innerHTML=`<div>📦 <b>SEQ ${esc(cleanSequence(d.sequence)||"?")}</b> — ${esc(d.code||d.client)}</div><div class="address">📍 ${esc(d.destinationAddress||d.address||"Endereço não informado")}</div>`;document.getElementById("nextNavigate").disabled=false;document.getElementById("nextDone").disabled=false;document.getElementById("mapSubtitle").textContent=`Próxima: SEQ ${cleanSequence(d.sequence)||"?"} • ${d.destinationAddress||d.address||"Endereço"}`}
function toggle(i){if(!deliveries[i])return;deliveries[i].done=!deliveries[i].done;if(deliveries[i].done){const c=coords(deliveries[i]);if(c){lastCompletedCoord=c;try{localStorage.setItem("rotapro_last_completed_coord",JSON.stringify(c))}catch(e){}}if(manualNext===i||selectedDelivery===i){manualNext=null;selectedDelivery=null;persistManualChoice();autoNext=null;persistAutoChoice();}releaseCompletedAutoDestination();}if(deliveries.length&&deliveries.every(d=>d.done)){deliveries=[];manualNext=null;autoNext=null;selectedDelivery=null;selectedGroup=[];routeCache={};lastCompletedCoord=null;try{localStorage.removeItem("rotapro_deliveries");localStorage.removeItem("rotapro_route_cache");localStorage.removeItem("rotapro_last_completed_coord")}catch(e){}save();if(document.getElementById("mapModal").classList.contains("open")){showDeliveryDetails(null);drawMap(false)}toast("🎉 Rota concluída! Lista limpa automaticamente. Pronto para a próxima rota.");return}save();if(document.getElementById("mapModal").classList.contains("open")){showDeliveryDetails(null);drawMap(false)}toast(deliveries[i].done?`SEQ ${cleanSequence(deliveries[i].sequence)||"?"} confirmada — removida do mapa`:`SEQ ${cleanSequence(deliveries[i].sequence)||"?"} reaberta`)}
function selectNext(i){if(deliveries[i].done){alert("Esta entrega já está concluída.");return}chooseManualDestination(i);render();openMap();setTimeout(()=>{showDeliveryDetails(i);let d=deliveries[i],c=coords(d);if(c)map.setView(c,16);},100);toast(`SEQ ${cleanSequence(deliveries[i].sequence)||"?"} definida como próxima`)}
function navigate(i){let d=deliveries[i],dest=coords(d)?coords(d).join(","):d.address;window.open("https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(dest),"_blank")}
function openMap(){document.getElementById("mapModal").classList.add("open");document.getElementById("mapModal").setAttribute("aria-hidden","false");startLocationWatch();setTimeout(()=>{if(!map)initMap();else{map.invalidateSize();drawMap()}const d=nextDelivery();if(d&&selectedDelivery===null&&manualNext===null){const i=deliveries.indexOf(d);selectedDelivery=i;selectedGroup=groupIndexesByAddress(i);showDeliveryDetails(i);const c=coords(d);if(c&&map)map.setView(c,Math.max(map.getZoom(),15),{animate:true});}},80)}
function closeMap(){document.getElementById("mapModal").classList.remove("open");document.getElementById("mapModal").setAttribute("aria-hidden","true");stopLocationWatch()}
function initMap(){if(!window.L)return;map=L.map("map",{zoomControl:true,rotate:true,touchRotate:true,dragRotate:true,shiftKeyRotate:true,rotateClockwise:true,rotateControl:{position:"topright",behavior:"reset",closeOnZeroBearing:false}}).setView([-23.04,-51.81],13);const blankTile="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,maxNativeZoom:15,keepBuffer:6,updateWhenIdle:true,updateWhenZooming:false,attribution:"© OpenStreetMap"}).addTo(map);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,maxNativeZoom:16,keepBuffer:4,updateWhenIdle:true,updateWhenZooming:false,errorTileUrl:blankTile,attribution:""}).addTo(map);drawMap();warmOfflineMap()}
function clearMapLayers(){routeRequestId++;markers.forEach(m=>map.removeLayer(m));markers=[];if(routeLine){map.removeLayer(routeLine);routeLine=null}if(userMarker){map.removeLayer(userMarker);userMarker=null}}
function updateUserMarker(){if(!map||!currentPosition)return;if(userMarker)map.removeLayer(userMarker);let icon=L.divIcon({className:"",html:`<div class="user-location"><span></span></div>`,iconSize:[34,34],iconAnchor:[17,17]});userMarker=L.marker(currentPosition,{icon,zIndexOffset:1000}).addTo(map).bindPopup("📍 Minha posição em tempo real");if(followUser)map.setView(currentPosition,Math.max(map.getZoom(),15),{animate:true});document.getElementById("gpsStatus").textContent="GPS ativo • posição atualizada"}
function startLocationWatch(){if(!navigator.geolocation){document.getElementById("gpsStatus").textContent="GPS não disponível";return}if(watchId!==null)return;watchId=navigator.geolocation.watchPosition(p=>{currentPosition=[p.coords.latitude,p.coords.longitude];updateUserMarker();if(map&&document.getElementById("mapModal").classList.contains("open")){if(manualNext!==null && deliveries[manualNext]?.done){manualNext=null;persistManualChoice()}if(manualNext===null){const near=nextDelivery(),ni=near?deliveries.indexOf(near):-1;if(ni>=0&&ni!==selectedDelivery){selectedDelivery=ni;selectedGroup=groupIndexesByAddress(ni);showDeliveryDetails(ni)}}if(Date.now()-lastGpsRouteUpdate>10000){lastGpsRouteUpdate=Date.now();drawMap(false)}}},()=>{document.getElementById("gpsStatus").textContent="GPS indisponível";toast("Não foi possível acompanhar sua posição. Autorize o GPS no navegador.")},{enableHighAccuracy:true,maximumAge:2000,timeout:15000})}
function stopLocationWatch(){if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null}}
function addressKey(d){
 const raw=String(d?.destinationAddress||d?.address||'').trim();
 if(!raw)return '';
 const clean=x=>String(x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[ºª]/g,'').replace(/\b(rua|r\.?|avenida|av\.?|travessa|tv\.?|alameda|al\.?|praca|pc\.?|rodovia|rod\.?|estrada|est\.?)\b/g,' ').replace(/\b(numero|num\.?|n[ºo]?\.?)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
 const normalized=raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(n[ºo]?\.?|numero|num\.?)\s*(?=\d)/g,'').replace(/\s+/g,' ').trim();
 // Nome do cliente após o número não faz parte do endereço físico.
 const match=normalized.match(/^(.*?)(?:,\s*|\s+)(\d{1,6}[a-z]?)(?=\s*(?:,|;|-|\/|$|\b(?:casa|apto|apartamento|bloco|sala|loja|fundos|cliente|destinatario)\b))/);
 if(match){
   const street=clean(match[1]);const number=match[2];
   if(street.length>=3){
     const rest=normalized.slice(match[0].length);
     const unit=rest.match(/\b(apto|apartamento|bloco|sala|loja)\s*([a-z0-9-]+)/);
     return 'imovel:'+street+'|'+number+(unit?'|'+clean(unit[1])+' '+unit[2]:'');
   }
 }
 return 'texto:'+clean(normalized);
}
function stopAddressKey(d){
 // No modo por paradas: somente logradouro e numero do imovel.
 const raw=String(d?.destinationAddress||d?.address||'').trim();
 if(!raw)return '';
 const norm=raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[ºª]/g,'').replace(/\b(n(?:umero|um)?\.?|nro\.?)\s*(?=\d)/g,'')
  .replace(/\s+/g,' ').trim();
 const streetClean=x=>x.replace(/^(rua|r\.?|avenida|av\.?|travessa|tv\.?|alameda|al\.?|praca|pc\.?|estrada|rodovia|rod\.?)\s+/,'')
  .replace(/[^a-z0-9]+/g,' ').trim();
 const m=norm.match(/^(.+?)(?:,\s*|\s+)(\d{1,6}[a-z]?)(?=\s*(?:[,;\-/]|$|casa\b|apto\b|apartamento\b|bloco\b|condominio\b|residencial\b|loja\b|sala\b))/);
 if(m){const street=streetClean(m[1]);if(street.length>=3)return 'parada:'+street+'|'+m[2]}
 const k=addressKey(d);
 return k.startsWith('imovel:')?k.split('|').slice(0,2).join('|'):k;
}
function stopGroups(){const m=new Map();deliveries.forEach((d,i)=>{const k=stopAddressKey(d)||'unknown-'+i;if(!m.has(k))m.set(k,{indexes:[]});m.get(k).indexes.push(i)});return [...m.values()]}
function updateStopCounters(){const groups=stopGroups(),done=groups.filter(g=>g.indexes.every(i=>deliveries[i].done)).length;for(const [id,n] of [['mapStopsTotal',groups.length],['mapStopsPending',groups.length-done],['mapStopsDone',done],['homeStopsTotal',groups.length],['homeStopsPending',groups.length-done]]){const e=document.getElementById(id);if(e)e.textContent=n}}
// RotaPro 3.29: as paradas COM Stop formam a espinha dorsal 1,2,3...
// As SEM Stop sao distribuidas nos intervalos mais proximos, nunca em bloco proprio.
function stopPoint(g){for(const i of g.indexes){const c=coords(deliveries[i]);if(c)return c}return null}
function stopValue(g){
 const values=g.indexes.map(i=>Number(String(deliveries[i].originalStop??'').trim()))
  .filter(v=>Number.isInteger(v)&&v>0);
 return values.length?Math.min(...values):null;
}
async function locateMissingStopGroups(groups){
 // So pesquisa os enderecos sem coordenadas. Respeita intervalo minimo entre pedidos.
 const cacheKey='rotapro_stop_geocode_v329';
 let cache={};try{cache=JSON.parse(localStorage.getItem(cacheKey)||'{}')}catch(e){}
 const unique=groups.filter(g=>!stopPoint(g));
 let requests=0,found=0;
 for(const g of unique){
  const d=deliveries[g.indexes[0]];
  const address=[d.destinationAddress||d.address,d.city,d.bairro].filter(Boolean).join(', ');
  const key=stopAddressKey(d);
  let pos=cache[key];
  if(!pos&&requests<20&&navigator.onLine){
   try{
    if(requests>0)await new Promise(resolve=>setTimeout(resolve,1200));
    requests++;
    const u='https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q='+encodeURIComponent(address);
    const response=await fetch(u,{headers:{'Accept':'application/json'}});
    if(response.ok){const data=await response.json();if(data.length)pos=[Number(data[0].lat),Number(data[0].lon)]}
   }catch(e){}
   if(pos)cache[key]=pos;
  }
  if(Array.isArray(pos)&&pos.every(Number.isFinite)){
   for(const i of g.indexes){if(!coords(deliveries[i])){deliveries[i].lat=pos[0];deliveries[i].lon=pos[1]}}
   found++;
  }
 }
 try{localStorage.setItem(cacheKey,JSON.stringify(cache))}catch(e){}
 return {found,unlocated:groups.filter(g=>!stopPoint(g)).length};
}
function orderMissingStopGroups(known,missing){
 const ordered=known.slice(),withoutCoords=[];
 // Primeiro ancora cada parada extra na parada numerada mais proxima.
 // Assim nao se forma uma sequencia de entregas sem Stop em locais distantes.
 const anchored=new Map();
 for(const g of missing){
  const p=stopPoint(g);
  if(!p){withoutCoords.push(g);continue}
  if(!known.length){
   const a=anchored.get(-1)||[];a.push(g);anchored.set(-1,a);continue;
  }
  let nearest=0,dist=Infinity;
  known.forEach((k,i)=>{const q=stopPoint(k);if(!q)return;const v=haversine(p,q);if(v<dist){dist=v;nearest=i}});
  const a=anchored.get(nearest)||[];a.push(g);anchored.set(nearest,a);
 }
 if(!known.length){
  const pool=(anchored.get(-1)||[]).slice(),sorted=[];
  let from=currentPosition||lastCompletedCoord||stopPoint(pool[0]);
  while(pool.length){let best=0,bestDist=Infinity;pool.forEach((g,i)=>{const q=stopPoint(g);const v=from&&q?haversine(from,q):Infinity;if(v<bestDist){best=i;bestDist=v}});const g=pool.splice(best,1)[0];sorted.push(g);from=stopPoint(g)||from}
  return {ordered:[...sorted,...withoutCoords],withoutCoordinates:withoutCoords.length};
 }
 const result=[];
 for(let i=0;i<known.length;i++){
  result.push(known[i]);
  const pool=(anchored.get(i)||[]).slice();
  let from=stopPoint(known[i]);
  while(pool.length){
   let best=0,bestDist=Infinity;
   pool.forEach((g,j)=>{const q=stopPoint(g);const v=from&&q?haversine(from,q):Infinity;if(v<bestDist){best=j;bestDist=v}});
   const g=pool.splice(best,1)[0];result.push(g);from=stopPoint(g)||from;
  }
 }
 return {ordered:[...result,...withoutCoords],withoutCoordinates:withoutCoords.length};
}
async function optimizeByStops(){
 if(!deliveries.length){alert('Importe a planilha primeiro.');return}
 const groups=stopGroups();
 const known=groups.filter(g=>stopValue(g)!==null).sort((a,b)=>stopValue(a)-stopValue(b));
 const missing=groups.filter(g=>stopValue(g)===null);
 // Busca coordenadas apenas para paradas sem Stop, inclusive adicionadas manualmente.
 if(missing.some(g=>!stopPoint(g))){toast('Localizando endereços sem Stop para encaixar na rota...');await locateMissingStopGroups(missing)}
 const result=orderMissingStopGroups(known,missing);
 result.ordered.forEach((g,n)=>g.indexes.forEach(i=>{deliveries[i].routeOrder=n+1;deliveries[i].correctedStop=n+1}));
 localStorage.setItem('rotapro_optimization_mode','stops');sortMode='route';
 // Otimizar por Paradas e uma escolha explicita de iniciar pela primeira parada.
 manualNext=null;persistManualChoice();autoNext=null;persistAutoChoice();
 const first=firstPlannedPending();selectedDelivery=first?deliveries.indexOf(first):null;
 if(first){autoNext=selectedDelivery;persistAutoChoice()}
 document.getElementById('routeTab')?.classList.add('active');document.getElementById('originalTab')?.classList.remove('active');
 save();openMap();if(selectedDelivery!==null){selectedGroup=groupIndexesByAddress(selectedDelivery);showDeliveryDetails(selectedDelivery)}
 toast('Rota por Stop: '+known.length+' paradas numeradas, '+missing.length+' sem Stop encaixadas por proximidade.'+(result.withoutCoordinates?' '+result.withoutCoordinates+' sem localização foram para o final.':''));
}
function sameAddress(a,b){const byStops=localStorage.getItem('rotapro_optimization_mode')==='stops';const ka=byStops?stopAddressKey(a):addressKey(a),kb=byStops?stopAddressKey(b):addressKey(b);return !!(ka&&kb&&ka===kb)}
function groupIndexesByAddress(i){const base=deliveries[i];if(!base)return [];return deliveries.map((d,idx)=>sameAddress(base,d)?idx:-1).filter(idx=>idx>=0)}
function addressGroups(){
 const groups=new Map();
 deliveries.forEach((d,i)=>{const key=localStorage.getItem('rotapro_optimization_mode')==='stops'?stopAddressKey(d):addressKey(d);if(!key)return;if(!groups.has(key))groups.set(key,{address:d.destinationAddress||d.address||"Endereço não informado",indexes:[]});groups.get(key).indexes.push(i)});
 return [...groups.values()].filter(g=>g.indexes.length>=LARGE_ADDRESS_THRESHOLD).sort((a,b)=>b.indexes.length-a.indexes.length);
}
function largeAddressFor(i){const key=localStorage.getItem('rotapro_optimization_mode')==='stops'?stopAddressKey(deliveries[i]):addressKey(deliveries[i]);return addressGroups().find(g=>g.indexes.some(idx=>idx===i))||null}
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
   const mapModal=document.getElementById("mapModal");
   mapModal.classList.remove("detail-open","detail-size-small","detail-size-medium","detail-size-large");
   mapModal.style.removeProperty("--detail-panel-h");
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
   <div class="compactInfo sequenceInfoRow">
     <span class="compactLabel">SEQUENCE</span>
     <div class="sequenceScroll" aria-label="Lista de Sequence">
       <b class="compactSeq">${esc(seqs)}</b>
     </div>
   </div>
   <div class="compactInfo addressCompact">
     <span class="compactLabel">DESTINATION ADDRESS</span>
     <div class="compactAddress">📍 ${esc(dest)}</div>
   </div>
   ${largeAlert}
   <div class="detailBottomActions">
     <button class="secondary detailFollowBtn" onclick="toggleDetailFollowPosition()">🧭 SEGUIR POSIÇÃO</button>
     <button class="success confirmBig compactConfirm" onclick="confirmAddressGroup()">✅ CONFIRMAR ENTREGA</button>
   </div>
 </div>`;
 document.getElementById("deliveryDetails").classList.add("show");
 const mapModal=document.getElementById("mapModal");
 mapModal.classList.remove("detail-size-small","detail-size-medium","detail-size-large");
 // Painel adaptativo: pouco conteúdo ocupa pouco espaço; listas/endereço longos ganham espaço.
 const seqText=seqs||"";
 const seqCount=selectedGroup.length;
 const needLarge=(seqCount>=20 || dest.length>=90 || seqText.length>=150);
 const needMedium=(seqCount>=5 || dest.length>=55 || seqText.length>=70);
 const detailSize=needLarge?"large":needMedium?"medium":"small";
 mapModal.classList.add(`detail-size-${detailSize}`);
 mapModal.style.setProperty("--detail-panel-h", detailSize==="large" ? "min(52vh,430px)" : detailSize==="medium" ? "285px" : "205px");
 mapModal.classList.add("detail-open");
 const followBtn=document.querySelector(".detailFollowBtn");
 if(followBtn)followBtn.textContent=followUser?"🧭 PAUSAR POSIÇÃO":"🧭 SEGUIR POSIÇÃO";
}
function confirmAddressGroup(){
 const group=(selectedGroup||[]).filter(i=>deliveries[i]&&!deliveries[i].done);
 if(!group.length)return;
 group.forEach(i=>deliveries[i].done=true);
 const seqs=group.map(i=>cleanSequence(deliveries[i].sequence)||"?").join(" - ");
 // Só libera a escolha manual quando a própria entrega escolhida foi concluída.
 if(manualNext!==null && group.includes(manualNext)){manualNext=null;persistManualChoice();autoNext=null;persistAutoChoice();}
 releaseCompletedAutoDestination();
 if(manualNext===null){autoNext=null;persistAutoChoice();}
 if(manualNext!==null && !deliveries[manualNext]?.done)selectedDelivery=manualNext;
 else selectedDelivery=null;
 selectedGroup=[];
 const finished=deliveries.length>0 && deliveries.every(d=>d.done);
 if(finished){
   deliveries=[];
   manualNext=null;autoNext=null;selectedDelivery=null;selectedGroup=[];
   try{localStorage.removeItem("rotapro_deliveries");localStorage.removeItem("rotapro_route_cache");localStorage.removeItem("rotapro_last_completed_coord")}catch(e){}
   routeCache={};lastCompletedCoord=null;
   save();
   if(document.getElementById("mapModal").classList.contains("open")){showDeliveryDetails(null);drawMap(false)}
   closeAddressAlerts();
   toast("🎉 Rota concluída! Lista limpa automaticamente. Pronto para a próxima rota.");
   return;
 }
 save();
 if(document.getElementById("mapModal").classList.contains("open")){
   if(manualNext!==null && !deliveries[manualNext]?.done)showDeliveryDetails(manualNext);
   else {const d=nextDelivery();showDeliveryDetails(d?deliveries.indexOf(d):null);}
   drawMap(false);
 }
 toast(`Entrega confirmada • SEQUENCE ${seqs}`);
}
function copyAddress(i){let a=deliveries[i]?.destinationAddress||deliveries[i]?.address||"";if(!a)return; if(navigator.clipboard){navigator.clipboard.writeText(a).then(()=>toast("Endereço copiado"),()=>toast("Não foi possível copiar o endereço"));}else{let ta=document.createElement("textarea");ta.value=a;document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();toast("Endereço copiado")}}
function getBairro(address){let p=String(address||"").split(",");return p.length>=3?p[p.length-3]||"-":"-"}
function getCidade(address){let p=String(address||"").split(",");return p.length>=2?p[p.length-2]||"-":"-"}
function drawMap(fit=true){updateStopCounters();
 if(!map)return;
 clearMapLayers();
 let points=[];
 const groups=new Map();
 deliveries.forEach((d,i)=>{
   let c=coords(d);if(!c)return;
   const key=addressKey(d)||`__${i}`;
   if(!groups.has(key))groups.set(key,{indexes:[],coord:c});
   groups.get(key).indexes.push(i);
 });
 const activeNext=nextDelivery();
 groups.forEach(g=>{
   const pendingIdx=g.indexes.filter(i=>!deliveries[i].done);
   const doneIdx=g.indexes.filter(i=>deliveries[i].done);
   const first=pendingIdx[0]??doneIdx[0];
   const c=g.coord; points.push(c);
   const isSelected=g.indexes.includes(selectedDelivery);
   const isManualNext=g.indexes.includes(manualNext);
   const isAutoNext=activeNext&&g.indexes.includes(deliveries.indexOf(activeNext));
   const allDone=pendingIdx.length===0;

   // Entregas concluídas ficam visíveis como pequenos pontos verdes para permitir desfazer.
   if(allDone){
     if(!showDone && doneIdx.length===0)return;
     const seqs=doneIdx.map(i=>cleanSequence(deliveries[i].sequence)||"?").join(" • ");
     const label=doneIdx.length>1?`✓<span class="done-count">${doneIdx.length}</span>`:"✓";
     const icon=L.divIcon({className:"",html:`<div class="map-marker done done-small">${label}</div>`,iconSize:[30,30],iconAnchor:[15,15]});
     let m=L.marker(c,{icon,zIndexOffset:250}).addTo(map);
     m.bindTooltip(doneIdx.length>1?`Concluídas: ${esc(seqs)}`:`SEQ ${esc(seqs)}`,{direction:"top",offset:[0,-12]});
     m.on("click",()=>undoCompletedGroup(doneIdx));
     markers.push(m);
     return;
   }

   const cls=(isManualNext||isAutoNext||isSelected)?"selected":"pending";
   const labels=pendingIdx.map(i=>cleanSequence(deliveries[i].sequence)||"?");
   const label=labels.length>1?`${esc(labels[0])}<span class="seq-more">+${labels.length-1}</span>`:esc(labels[0]);
   let icon=L.divIcon({className:"",html:`<div class="map-marker ${cls}">${label}</div>`,iconSize:[44,44],iconAnchor:[22,22]});
   let m=L.marker(c,{icon,zIndexOffset:300}).addTo(map);
   m.bindTooltip(labels.length>1?`Sequences: ${esc(labels.join(" • "))}`:`SEQ ${esc(labels[0])}`,{direction:"top",offset:[0,-18]});
   m.on("click",()=>{chooseManualDestination(first);showDeliveryDetails(first);drawMap(false);map.setView(c,Math.max(map.getZoom(),15),{animate:true});toast(labels.length>1?`Endereço selecionado • ${labels.length} entregas agrupadas`:`SEQ ${cleanSequence(deliveries[first].sequence)||"?"} selecionada como próxima`)});
   markers.push(m);
 });
 if(currentPosition)updateUserMarker();
 if(points.length&&fit&&!currentPosition){let bounds=L.latLngBounds(points);map.fitBounds(bounds.pad(.12))}
 let next=nextDelivery();
 if(next&&coords(next)){
   const destination=coords(next);
   const start=currentPosition||lastCompletedCoord;
   if(start)drawRoadRoute([start,destination],{destinationIndex:deliveries.indexOf(next)});
 }
 document.getElementById("mapPending").textContent=pending().length;
 document.getElementById("mapDone").textContent=deliveries.filter(d=>d.done).length;
}
function undoCompletedGroup(indexes){
 const valid=(indexes||[]).filter(i=>deliveries[i]?.done);
 if(!valid.length)return;
 const seqs=valid.map(i=>cleanSequence(deliveries[i].sequence)||"?").join(" - ");
 if(!confirm(`Desfazer a entrega?\n\nSEQUENCE: ${seqs}\n\nAs entregas voltarão para pendentes.`))return;
 valid.forEach(i=>deliveries[i].done=false);
 chooseManualDestination(valid[0]); selectedGroup=groupIndexesByAddress(valid[0]);
 save();
 if(document.getElementById("mapModal").classList.contains("open")){showDeliveryDetails(valid[0]);drawMap(false)}
 toast(`↩️ Entrega reaberta • SEQUENCE ${seqs}`);
}
function routeCacheKey(destinationIndex,to){
 const d=deliveries[destinationIndex];
 const seq=cleanSequence(d?.sequence)||String(destinationIndex);
 return `${seq}|${to.join(",")}`;
}
function saveRouteCache(key,geom,from,to){
 routeCache[key]={geom,savedAt:Date.now(),from,to};
 const keys=Object.keys(routeCache);
 if(keys.length>120)keys.sort((a,b)=>(routeCache[a].savedAt||0)-(routeCache[b].savedAt||0)).slice(0,keys.length-120).forEach(k=>delete routeCache[k]);
 try{localStorage.setItem("rotapro_route_cache",JSON.stringify(routeCache))}catch(e){}
}
function cachedRouteFor(destinationIndex,to){
 const key=routeCacheKey(destinationIndex,to);
 return routeCache[key]?.geom||null;
}
function nearestPointOnLine(line,p){if(!line?.length||!p)return 0;let best=0,bestD=Infinity;line.forEach((c,i)=>{const d=haversine(p,c);if(d<bestD){bestD=d;best=i}});return best}
function clipRouteFromPosition(line,p){if(!p||!line?.length)return line;const idx=nearestPointOnLine(line,p);return [p,...line.slice(idx)];}
function tileUrl(z,x,y){const sub=["a","b","c"][(Math.abs(x+y))%3];return `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`;}
function tileXY(lat,lon,z){const scale=Math.pow(2,z),x=Math.floor((lon+180)/360*scale),y=Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*scale);return [x,y];}
function routeCachePoints(){const pts=[];Object.values(routeCache).forEach(r=>(r?.geom||[]).forEach(p=>pts.push(p)));return pts;}
function sampleRoutePoints(points,everyMeters){
 const out=[];if(!points?.length)return out;let last=null;
 for(const p of points){if(!last||haversine(last,p)*1000>=everyMeters){out.push(p);last=p}}
 const tail=points[points.length-1];if(tail&&(!out.length||haversine(out[out.length-1],tail)*1000>20))out.push(tail);
 return out;
}
function addTileNeighborhood(urls,lat,lon,z,r=1){
 const [x,y]=tileXY(lat,lon,z);
 for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++){const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0)urls.add(tileUrl(z,xx,yy));}
}
function buildOfflineTileSet(points,z,everyMeters,r){
 const set=new Set();sampleRoutePoints(points,everyMeters).forEach(p=>addTileNeighborhood(set,p[0],p[1],z,r));
 return [...set];
}
async function cacheTileList(cache,list,label){
 let saved=0,failed=0;
 for(let i=0;i<list.length;i+=18){
   const batch=list.slice(i,i+18);
   const results=await Promise.allSettled(batch.map(async u=>{
     try{const hit=await cache.match(u);if(hit)return true;const r=await fetch(u,{mode:"no-cors",cache:"force-cache"});if(r&&(r.ok||r.type==="opaque")){await cache.put(u,r.clone());return true}return false}catch(e){return false}
   }));
   results.forEach(r=>r.status==="fulfilled"&&r.value?saved++:failed++);
   if(i%180===0)await new Promise(requestAnimationFrame);
 }
 return {saved,failed,label};
}
async function warmOfflineMap(extraPoints=[]){
 if(!('caches' in window)||!navigator.onLine)return;
 const pts=[];
 deliveries.forEach(d=>{const c=coords(d);if(c)pts.push(c)});
 if(currentPosition)pts.push(currentPosition);
 routeCachePoints().forEach(p=>pts.push(p));
 extraPoints.forEach(p=>pts.push(p));
 if(!pts.length)return;
 try{
   const cache=await caches.open(TILE_CACHE);
   // Prioridade real para o zoom usado no trabalho. O z15 fica como cobertura-base
   // e o z16 como detalhe; z14/z13 garantem zoom-out sem deixar o mapa vazio.
   const plans=[
     {z:16,every:280,r:1,budget:4200},
     {z:15,every:560,r:2,budget:3200},
     {z:14,every:1200,r:1,budget:1200},
     {z:13,every:2600,r:1,budget:500}
   ];
   let total=0;
   for(const plan of plans){
     const list=buildOfflineTileSet(pts,plan.z,plan.every,plan.r).slice(0,plan.budget);
     const result=await cacheTileList(cache,list,`z${plan.z}`);total+=result.saved;
   }
   try{localStorage.setItem("rotapro_offline_tile_count",String(total));localStorage.setItem("rotapro_offline_tile_time",String(Date.now()))}catch(e){}
 }catch(e){}
}
async function cacheOptimizedRoadLegs(){
 if(!navigator.onLine)return false;
 const ordered=deliveries.filter(d=>!d.done&&coords(d)).sort((a,b)=>(Number(a.routeOrder)||999999)-(Number(b.routeOrder)||999999));
 const start=currentPosition||lastCompletedCoord;
 const pts=start?[start,...ordered.map(coords)]:ordered.map(coords);
 if(pts.length<2){await warmOfflineMap();return false}
 try{
   const path=pts.map(c=>`${c[1]},${c[0]}`).join(';');
   const r=await fetch(`${OSRM}/route/v1/driving/${path}?overview=false&steps=true&geometries=geojson`);
   if(!r.ok)throw new Error('cache');
   const j=await r.json(),legs=j.routes?.[0]?.legs||[];const routePts=[];
   legs.forEach((leg,idx)=>{
     const dest=ordered[idx];if(!dest)return;const geom=[];
     (leg.steps||[]).forEach(st=>(st.geometry?.coordinates||[]).forEach(c=>{const p=[c[1],c[0]];if(!geom.length||geom[geom.length-1][0]!==p[0]||geom[geom.length-1][1]!==p[1])geom.push(p)}));
     if(geom.length>1){const di=deliveries.indexOf(dest);saveRouteCache(routeCacheKey(di,coords(dest)),geom,pts[idx],coords(dest));routePts.push(...geom)}
   });
   await warmOfflineMap(routePts);
   return true;
 }catch(e){await warmOfflineMap();return false}
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
   if(cached&&cached.length>1){const clipped=clipRouteFromPosition(cached,currentPosition);routeLine=L.polyline(clipped,{color:"#0b8f4d",weight:6,opacity:.92}).addTo(map);toast("Internet indisponível — usando o trecho salvo pelas ruas");}
   else toast("Internet indisponível — trecho de rua ainda não salvo. O GPS continua funcionando.");
 }
}
// Planejamento por TEMPO de direção: matriz viária OSRM + melhorias 2-opt.
// Ponto 0 é sempre a localização inicial; o percurso é aberto (não retorna à origem).
async function fastestRoadOrder(start, left){
 const points=[start,...left.map(coords)];
 // Limite conservador para não sobrecarregar o serviço público de demonstração.
 if(points.length>75)throw new Error("Matriz grande: usar OSRM Trip");
 const path=points.map(c=>`${c[1]},${c[0]}`).join(";");
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),18000);
 let matrix;
 try{
  const r=await fetch(`${OSRM}/table/v1/driving/${path}?annotations=duration`,{signal:controller.signal});
  if(!r.ok)throw new Error("Tabela indisponível");
  const data=await r.json();if(data.code!=="Ok"||!Array.isArray(data.durations))throw new Error("Tabela inválida");
  matrix=data.durations;
 }finally{clearTimeout(timer)}
 const n=points.length;
 if(matrix.length!==n||matrix.some(row=>!Array.isArray(row)||row.length!==n))throw new Error("Matriz incompleta");
 const cost=(a,b)=>Number.isFinite(matrix[a][b])?matrix[a][b]:1e12;
 // Vizinho mais rápido por duração real nas ruas, e não distância em linha reta.
 const remaining=new Set(Array.from({length:n-1},(_,i)=>i+1));const order=[0];
 while(remaining.size){let best=null,bestCost=Infinity;for(const i of remaining){const c=cost(order[order.length-1],i);if(c<bestCost){best=i;bestCost=c}}if(best===null||bestCost>=1e12)throw new Error("Pontos inacessíveis");order.push(best);remaining.delete(best)}
 const total=arr=>arr.slice(1).reduce((sum,node,i)=>sum+cost(arr[i],node),0);
 // Ordem progressiva: não inverter blocos com 2-opt. Cada parada é a mais rápida
 // a partir da parada imediatamente anterior, mantendo um trajeto previsível.
 const bestTotal=total(order);
 return {planned:order.slice(1).map(i=>left[i-1]),seconds:bestTotal};
}
// A divisão geográfica agrupa paradas em blocos compactos. O custo considera
// distância entre blocos, desvio para o destino final e o risco de voltar atrás.
// Rota 3.21: proximidade como critério principal, com custo de retorno e barreiras.
// A matriz viária é opcional: não inclui trânsito ao vivo.
async function roadCostMatrix(start,left){
 if(left.length>73)return null;
 const points=[start,...left.map(coords)];
 const path=points.map(p=>`${p[1]},${p[0]}`).join(';');
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),14000);
 try{
  const r=await fetch(`${OSRM}/table/v1/driving/${path}?annotations=duration`,{signal:ctrl.signal});
  if(!r.ok)return null;
  const j=await r.json();
  return j.code==='Ok'&&j.durations?.length===points.length?j.durations:null;
 }catch(e){return null}finally{clearTimeout(timer)}
}
function regionalPlan(start,left,end,matrix){
 const n=left.length,points=[start,...left.map(coords)];
 const distance=(a,b)=>haversine(points[a],points[b]);
 // Road time is preferred whenever the road network can be queried.
 const cost=(a,b)=>{
   const road=matrix?.[a]?.[b];
   return Number.isFinite(road)?road/85:distance(a,b); // normalized time (minutes / 85)
 };
 // Build compact neighborhoods around fixed seed points; unlike single-link
 // clustering, a long chain of adjacent points cannot swallow a whole city.
 const assigned=new Set(),blocks=[];
 const radius=.62;
 for(let i=1;i<=n;i++){
   if(assigned.has(i))continue;
   const members=[i];assigned.add(i);
   for(let j=i+1;j<=n;j++){
     if(!assigned.has(j)&&distance(i,j)<=radius){members.push(j);assigned.add(j)}
   }
   blocks.push(members);
 }
 const visited=new Set(),result=[];let at=0,activeBlock=null;
 const remaining=()=>Array.from({length:n},(_,i)=>i+1).filter(i=>!visited.has(i));
 while(visited.size<n){
   const remain=remaining();
   // Nearby deliveries dominate; staying in a region is only a small bonus.
   // A point on the path to a further stop is therefore not skipped.
   const candidates=remain.map(i=>{
     const c=cost(at,i);
     const block=blocks.findIndex(b=>b.includes(i));
     const blockBonus=block===activeBlock?Math.min(.12,c*.08):0;
     // Prefer clearing the region before leaving; avoid isolated stops left behind.
     const closePending=remain.filter(j=>j!==i&&distance(i,j)<.35).length;
     const localBonus=Math.min(.09,closePending*.018);
     const endBias=end?Math.max(0,haversine(points[i],end)-haversine(points[at],end))*.035:0;
     return {i,block,score:c-blockBonus-localBonus+endBias,c};
   });
   candidates.sort((a,b)=>a.score-b.score||a.c-b.c);
   let next=candidates[0];
   // When two choices are almost equal, avoid a road barrier: road duration
   // is already represented by the matrix. Without it, use distance only.
   visited.add(next.i);result.push(left[next.i-1]);at=next.i;activeBlock=next.block;
 }
 return {planned:result,blocks:blocks.length,usedRoadTimes:!!matrix};
}
async function resolveRouteDestination(text){
 const value=String(text||'').trim();if(!value)return null;
 // Endereço explícito, nunca inferido da localização do usuário.
 const coordsMatch=value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/);
 if(coordsMatch){const lat=Number(coordsMatch[1]),lon=Number(coordsMatch[2]);if(Math.abs(lat)<=90&&Math.abs(lon)<=180)return [lat,lon]}
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
 try{const r=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(value),{signal:ctrl.signal});if(!r.ok)throw Error('Busca indisponível');const j=await r.json();if(!j.length)throw Error('Endereço não localizado');return [Number(j[0].lat),Number(j[0].lon)]}finally{clearTimeout(timer)}
}
async function optimizeRoute(){
 const left=pending().filter(d=>coords(d));
 if(!left.length){alert('Não há entregas pendentes com latitude/longitude.');return}
 let start=currentPosition||lastCompletedCoord;
 if(!currentPosition&&navigator.geolocation){try{const pos=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:10000,maximumAge:15000}));currentPosition=[pos.coords.latitude,pos.coords.longitude];start=currentPosition}catch(e){}}
 if(!start){alert('Ative o GPS para otimizar a partir da sua localização.');return}
 const mode=document.getElementById('routePlanMode')?.value||'free';
 const endText=mode==='free'?'':(document.getElementById('routePlanEnd')?.value||'').trim();
 let end=null;
 if(endText){toast('Localizando destino final...');try{end=await resolveRouteDestination(endText)}catch(e){alert('Não foi possível localizar o destino final. Confira o endereço e tente novamente, ou deixe o campo vazio.');return}}
 localStorage.setItem('rotapro_optimization_mode','regions');
 toast('Calculando proximidade e regiões pelas ruas...');
 const matrix=await roadCostMatrix(start,left);
 const {planned,usedRoadTimes}=regionalPlan(start,left,end,matrix);
 deliveries.forEach(d=>{if(!d.done)d.routeOrder=''});
 planned.forEach((d,i)=>{d.routeOrder=i+1});
 autoNext=null;
 if(manualNext!==null&&(!deliveries[manualNext]||deliveries[manualNext].done)){manualNext=null;persistManualChoice()}
 if(manualNext===null&&planned.length){autoNext=deliveries.indexOf(planned[0]);selectedDelivery=autoNext}
 else if(manualNext!==null)selectedDelivery=manualNext;
 persistAutoChoice();sortMode='route';
 document.getElementById('routeTab').classList.add('active');document.getElementById('originalTab').classList.remove('active');
 localStorage.setItem('rotapro_region_mode',mode);localStorage.setItem('rotapro_region_end',endText);
 save();openMap();
 if(selectedDelivery!==null){selectedGroup=groupIndexesByAddress(selectedDelivery);showDeliveryDetails(selectedDelivery);}
 toast(usedRoadTimes?'Rota por proximidade e ruas pronta!':'Rota por proximidade geográfica pronta (sem tempos viários).');
}

function restoreOriginal(){localStorage.removeItem("rotapro_optimization_mode");deliveries.forEach(d=>d.routeOrder="");if(manualNext!==null&&deliveries[manualNext]?.done)manualNext=null;sortMode="original";document.getElementById("originalTab").classList.add("active");document.getElementById("routeTab").classList.remove("active");save();toast("Ordem original restaurada")}
function haversine(a,b){const R=6371,toRad=x=>x*Math.PI/180,dLat=toRad(b[0]-a[0]),dLon=toRad(b[1]-a[1]);const x=Math.sin(dLat/2)**2+Math.cos(toRad(a[0]))*Math.cos(toRad(b[0]))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function locate(){startLocationWatch();if(currentPosition&&map){followUser=true;updateUserMarker();toast("Acompanhamento GPS ativado");return}if(!navigator.geolocation){alert("Seu navegador não oferece localização.");return}navigator.geolocation.getCurrentPosition(p=>{currentPosition=[p.coords.latitude,p.coords.longitude];followUser=true;updateUserMarker();drawMap(false);toast("Sua posição foi atualizada")},()=>alert("Não foi possível obter sua localização. Autorize o GPS no navegador."),{enableHighAccuracy:true,timeout:10000})}
function toggleMapFollow(){followUser=!followUser;if(followUser){if(currentPosition)updateUserMarker();toast("Acompanhamento da posição ativado")}else{toast("Acompanhamento da posição pausado")};updateFollowButton()}
function followSelectedPosition(){
 followUser=true;
 updateFollowButton();
 if(currentPosition&&map){map.setView(currentPosition,Math.max(map.getZoom(),16),{animate:true});updateUserMarker();toast("Seguindo sua posição");return}
 locate();
}

function toggleDetailFollowPosition(){
 followUser=!followUser;
 if(followUser){
   if(currentPosition&&map){map.setView(currentPosition,Math.max(map.getZoom(),16),{animate:true});updateUserMarker();}
   else locate();
   toast("Acompanhamento da posição ativado");
 }else{
   toast("Acompanhamento da posição pausado");
 }
 updateFollowButton();
 const b=document.querySelector(".detailFollowBtn");
 if(b){b.textContent=followUser?"🧭 PAUSAR POSIÇÃO":"🧭 SEGUIR POSIÇÃO";b.classList.toggle("followActive",followUser);}
}

function updateFollowButton(){const b=document.getElementById("followMapBtn");if(!b)return;b.textContent=followUser?"🧭 Seguir posição":"⏸ Pausar posição";b.classList.toggle("followActive",followUser)}

function importFile(ev){const f=ev.target.files[0];if(!f)return;if(/\.csv$/i.test(f.name)){let r=new FileReader();r.onload=()=>importCSV(r.result);r.readAsText(f,"UTF-8");ev.target.value="";return}if(typeof XLSX==="undefined"){alert("Biblioteca Excel não carregou.");return}let r=new FileReader();r.onload=e=>{try{let wb=XLSX.read(new Uint8Array(e.target.result),{type:"array"}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:""});importExcel(rows)}catch(err){alert("Erro no Excel: "+err.message)}};r.readAsArrayBuffer(f);ev.target.value=""}
function norm(s){return String(s??"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ")}
function key(keys,names){let n=names.map(norm);return keys.find(k=>n.includes(norm(k)))||null}
function importExcel(rows){if(!rows.length){alert("Planilha vazia.");return}let keys=Object.keys(rows[0]),ak=key(keys,["Destination Address","Endereço","Endereco","Address"]),ck=key(keys,["SPX TN","Tracking","Tracking Number","Código","Codigo"]),bk=key(keys,["Bairro"]),city=key(keys,["City","Cidade"]),zip=key(keys,["Zipcode/Postal code","CEP","Zipcode"]),lat=key(keys,["Latitude","Lat"]),lon=key(keys,["Longitude","Long","Lon"]),seq=key(keys,["Sequence","Sequencia","Sequência"]),stop=key(keys,["Stop"]);if(!ak){alert("Não encontrei Destination Address.");return}let n=0;rows.forEach((r,i)=>{let raw=String(r[ak]??"").trim();if(!raw)return;let s=cleanSequence(seq?r[seq]:"");let parts=[raw,bk?r[bk]:"",city?r[city]:"",zip?r[zip]:""].map(x=>String(x??"").trim()).filter(Boolean);deliveries.push({client:ck?String(r[ck]||""):"Entrega "+(i+1),address:[...new Set(parts)].join(", "),destinationAddress:raw,bairro:bk?String(r[bk]||"").trim():"",city:city?String(r[city]||"").trim():"",zip:zip?String(r[zip]||"").trim():"",phone:"",obs:s?`Sequence: ${s}`:"",code:ck?String(r[ck]||""):"",lat:lat?String(r[lat]||""):"",lon:lon?String(r[lon]||""):"",sequence:s,originalSequence:s,originalStop:stop?String(r[stop]||""):"",done:false,routeOrder:""});n++});sortMode="original";save();warmOfflineMap();toast(n+" entregas importadas — confira a Sequence");if(missingSequenceCount())openSequenceEditor()}
function importCSV(){alert("Para este modelo de entrega, prefira o Excel .xlsx.")}
function downloadTemplate(){if(!XLSX)return;let ws=XLSX.utils.aoa_to_sheet([["AT ID","Sequence","Stop","SPX TN","Destination Address","Bairro","City","Zipcode/Postal code","Latitude","Longitude"],["AT20260919A130T",1,1,"BR000000000000","Rua Exemplo, 100","Centro","Santa Fé","86770-000",-23.03849,-51.8018]]),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Sheet1");XLSX.writeFile(wb,"modelo-rotapro.xlsx")}
function exportCSV(){let rows=[["Rota","Sequence","SPX TN","Endereço","Latitude","Longitude","Status"],...deliveries.map(d=>[d.routeOrder||"",cleanSequence(d.sequence)||"",d.code||"",d.address,d.lat||"",d.lon||"",d.done?"Entregue":"Pendente"])];download("rotapro-rota.csv","\ufeff"+rows.map(r=>r.map(x=>`"${String(x??"").replaceAll('"','""')}"`).join(";")).join("\n"),"text/csv")}
function download(n,d,t){let a=document.createElement("a");a.href=URL.createObjectURL(new Blob([d],{type:t}));a.download=n;a.click()}
function clearAll(){if(confirm("Apagar todas as entregas?")){deliveries=[];manualNext=null;autoNext=null;selectedDelivery=null;save();toast("Entregas apagadas")}}

// Editor de Sequence: permite corrigir manualmente e preencher automaticamente os números faltantes.
function openSequenceEditor(){renderSequenceEditor();document.getElementById("sequenceModal").classList.add("open");document.getElementById("sequenceModal").setAttribute("aria-hidden","false")}
function closeSequenceEditor(){document.getElementById("sequenceModal").classList.remove("open");document.getElementById("sequenceModal").setAttribute("aria-hidden","true")}
function editSequence(i){openSequenceEditor();setTimeout(()=>{let el=document.querySelector(`#seqInput_${i}`);if(el){el.focus();el.select()}},60)}
function renderSequenceEditor(){const box=document.getElementById("sequenceEditorList");box.innerHTML="";deliveries.forEach((d,i)=>{let issue=sequenceIssue(i),s=cleanSequence(d.sequence);let row=document.createElement("div");row.className="seqRow"+(issue?" issue":"");row.innerHTML=`<div class="seqInfo"><b>${esc(d.code||d.client)}</b><small>${esc(d.address)}</small>${issue?`<span>${!s?"⚠ Sem Sequence":"⚠ Sequence duplicada"}</span>`:""}</div><input id="seqInput_${i}" class="seqInput" inputmode="text" autocapitalize="characters" value="${esc(s)}" placeholder="Sequence"><button onclick="focusSequence(${i})">✏️</button>`;box.appendChild(row)});updateSequenceEditorStats()}
function focusSequence(i){let el=document.getElementById(`seqInput_${i}`);if(el){el.focus();el.select()}}
function collectSequenceInputs(){let used=new Map(),changes=[];for(let i=0;i<deliveries.length;i++){let el=document.getElementById(`seqInput_${i}`);let s=cleanSequence(el?el.value:deliveries[i].sequence);if(s&&/[\r\n]/.test(s)){alert(`Sequence inválida na entrega ${i+1}. Não use quebra de linha.`);return null}if(s){if(used.has(s)){alert(`A Sequence ${s} está repetida. Cada entrega deve ter uma Sequence diferente.`);return null}used.set(s,i)}changes.push(s)}return changes}
function saveSequences(){let values=collectSequenceInputs();if(!values)return;values.forEach((s,i)=>{deliveries[i].sequence=s});save();closeSequenceEditor();toast(missingSequenceCount()?"Ainda existem entregas sem Sequence":"Sequences corrigidas e salvas");if(missingSequenceCount())setTimeout(openSequenceEditor,250)}
function fillMissingSequences(){let used=new Set(deliveries.map(d=>Number(cleanSequence(d.sequence))).filter(n=>Number.isInteger(n)&&n>0));let next=1,filled=0;deliveries.forEach((d,i)=>{if(!cleanSequence(d.sequence)){while(used.has(next)||used.has(`+${next}`))next++;let value=`+${next}`;let el=document.getElementById(`seqInput_${i}`);if(el)el.value=value;used.add(value);used.add(next);next++;filled++}});updateSequenceEditorStats();toast(filled?`${filled} Sequence(s) preenchidas automaticamente na ordem da lista.`:"Não há Sequence faltando.")}
function updateSequenceEditorStats(){let inputs=[...document.querySelectorAll(".seqInput")];let missing=inputs.filter(x=>!cleanSequence(x.value)).length;document.getElementById("editorMissing").textContent=missing;document.getElementById("editorTotal").textContent=inputs.length}

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
let toastTimer;function toast(t){let x=document.getElementById("toast");x.textContent=t;x.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>x.classList.remove("show"),2600)}

restoreManualDestination();
restoreAutoDestination();
document.getElementById("homeImportBtn")?.addEventListener("click",()=>document.getElementById("file").click());
document.getElementById("homeSequenceBtn")?.addEventListener("click",openSequenceEditor);
document.getElementById("homeListBtn")?.addEventListener("click",()=>document.getElementById("list")?.scrollIntoView({behavior:"smooth",block:"start"}));
document.getElementById("homeManualBtn")?.addEventListener("click",()=>document.getElementById("importSection")?.scrollIntoView({behavior:"smooth",block:"center"}));
document.getElementById("homeClearBtn")?.addEventListener("click",clearAll);
document.getElementById("file").addEventListener("change",importFile);document.getElementById("optBtn").addEventListener("click",optimizeRoute);document.getElementById("optStopsBtn")?.addEventListener("click",optimizeByStops);document.getElementById("navOptimize").addEventListener("click",optimizeRoute);document.getElementById("clearRouteBtn").addEventListener("click",restoreOriginal);document.getElementById("locateBtn").addEventListener("click",locate);document.getElementById("followMapBtn")?.addEventListener("click",toggleMapFollow);document.getElementById("mapOptimizeBtn")?.addEventListener("click",optimizeRoute);document.getElementById("openMapBtn").addEventListener("click",openMap);document.getElementById("navMap").addEventListener("click",openMap);document.getElementById("closeMap").addEventListener("click",closeMap);document.getElementById("centerMap").addEventListener("click",()=>{followUser=true;if(currentPosition)map.setView(currentPosition,16,{animate:true});else{let d=nextDelivery(),c=d&&coords(d);if(c)map.setView(c,16)}});document.getElementById("showDone").addEventListener("change",e=>{showDone=e.target.checked;drawMap()});document.getElementById("routeTab").addEventListener("click",()=>{sortMode="route";document.getElementById("routeTab").classList.add("active");document.getElementById("originalTab").classList.remove("active");render()});document.getElementById("originalTab").addEventListener("click",()=>{sortMode="original";document.getElementById("originalTab").classList.add("active");document.getElementById("routeTab").classList.remove("active");render()});document.getElementById("nextNavigate").addEventListener("click",()=>{let d=nextDelivery();if(d)navigate(deliveries.indexOf(d))});document.getElementById("nextDone").addEventListener("click",()=>{let d=nextDelivery();if(d)toggle(deliveries.indexOf(d))});document.getElementById("sequenceBtn").addEventListener("click",openSequenceEditor);document.getElementById("closeSequenceModal").addEventListener("click",closeSequenceEditor);document.getElementById("fillSequencesBtn").addEventListener("click",fillMissingSequences);document.getElementById("saveSequencesBtn").addEventListener("click",saveSequences);document.getElementById("sequenceModal").addEventListener("click",e=>{if(e.target.id==="sequenceModal")closeSequenceEditor()});document.getElementById("closeAddressAlertModal")?.addEventListener("click",closeAddressAlerts);document.getElementById("addressAlertModal")?.addEventListener("click",e=>{if(e.target.id==="addressAlertModal")closeAddressAlerts()});if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js?v=57");updateFollowButton();render();

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

// Preferências locais de planejamento, sem alterar a Sequence original.
(function(){const mode=document.getElementById('routePlanMode'),end=document.getElementById('routePlanEnd'),label=document.getElementById('routePlanEndLabel');if(!mode||!end)return;mode.value=localStorage.getItem('rotapro_region_mode')||'home';end.value=localStorage.getItem('rotapro_region_end')||'';function refresh(){const outside=mode.value==='outside',free=mode.value==='free';end.hidden=free;label.hidden=free;label.textContent=outside?'Endereço de saída / retorno':'Endereço de casa (destino final)';end.placeholder=outside?'Saída da cidade ou ponto de retorno':'Rua, número, cidade e estado';localStorage.setItem('rotapro_region_mode',mode.value)}mode.addEventListener('change',refresh);end.addEventListener('change',()=>localStorage.setItem('rotapro_region_end',end.value));document.getElementById('routePlanOptimize')?.addEventListener('click',optimizeRoute);refresh()})();
