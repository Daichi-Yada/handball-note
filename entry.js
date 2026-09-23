/* Local-first recording controller. Actual match data never leaves this browser. */
'use strict';
const C = ScoreCore;
const $ = id => document.getElementById(id);
const STORAGE_KEY = 'handball-note-v1';
const labels = {Goal:'ゴール',Save:'GKセーブ',Out:'枠外',Block:'ブロック',TM:'ミス',VL:'反則',Yellow:'警告',Suspension:'2分退場',Red:'失格',Timeout:'タイムアウト'};
let library = [], currentId, selectedTeam = 'Own', editingId = null, history = [], view = 'home';
let editContext = null;
let clockSeconds = 0, clockStarted = null, clockBase = 0, toastTimeout, lastResultAt = 0, storageBlocked = false;
const current = () => library.find(m => m.id === currentId);
const elapsed = () => Math.min(1800, clockStarted == null ? clockSeconds : clockBase + Math.floor((Date.now()-clockStarted)/1000));
function notify(message, error = false) {
  $('toast').textContent=message; $('toast').classList.toggle('error',error); $('toast').hidden=false;
  clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').hidden=true,error?7000:3200);
}
function save() {
  if(storageBlocked) return;
  try {
    current().clock={half:Number($('half').value),seconds:elapsed()};
    localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,currentId,matches:library}));
    $('saveStatus').textContent='この端末に保存済み'; $('saveStatus').classList.remove('error');
  } catch(e) { $('saveStatus').textContent='自動保存できません・JSON保存を';$('saveStatus').classList.add('error'); }
}
function snapshot() {history.push(JSON.stringify(current()));if(history.length>50)history.shift();}
function resetEditor() {
  if(editContext){
    stopClock();clockSeconds=editContext.seconds;$('half').value=editContext.half;
    setTeam(editContext.team);
    for(const id of ['playerNo','shotType','phase','zone','ownGK','oppGK'])$(id).value=editContext.fields[id];
    editContext=null;displayClock();renderPlayers();
  }
  editingId=null;$('editBadge').hidden=true;$('cancelEdit').hidden=true;
  $('resultLabel').textContent='結果を押すと、1件記録されます';
}
function setTeam(team) {
  selectedTeam=team;$('playerNo').value='';
  document.querySelectorAll('[data-team]').forEach(b=>{const on=b.dataset.team===team;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});
  renderPlayers();
}
function renderPlayers() {
  const m=current(), roster=new Map(m.rosters[selectedTeam].map(p=>[p.no,p]));
  for(const a of m.actions)if(a.team===selectedTeam && a.no!=null && !roster.has(a.no))roster.set(a.no,{no:a.no,name:''});
  const order=m.playerOrder?.[selectedTeam]||[];const players=[...order.map(no=>roster.get(no)).filter(Boolean),...[...roster.values()].filter(p=>!order.includes(p.no)).sort((a,b)=>a.no-b.no)];
  $('playerButtons').innerHTML=players.map(p=>`<button type="button" draggable="true" data-player="${p.no}" class="${$('playerNo').value===String(p.no)?'selected':''}" aria-pressed="${$('playerNo').value===String(p.no)}" title="${C.esc(p.name || '背番号 '+p.no)}">${p.no}${p.name?`<small>${C.esc(p.name)}</small>`:''}</button>`).join('');
  if(!roster.size)$('playerButtons').innerHTML='<span class="field-hint">一度入力した番号はここに並びます。選手設定でまとめて登録もできます。</span>';
  renderLineup();syncChoiceButtons();
}
function renderLineup(){
  const list=current().lineup?.[selectedTeam]||[],roster=new Map(current().rosters[selectedTeam].map(p=>[p.no,p]));
  $('lineupPlayers').innerHTML=list.map((no,i)=>{const p=roster.get(no)||{no,name:''};return `<button type="button" draggable="true" data-lineup-player="${no}" data-lineup-index="${i}" title="${C.esc(p.name||'背番号 '+no)}">${no}${p.name?`<small>${C.esc(p.name)}</small>`:''}<span class="lineup-remove" data-remove-lineup="${no}" aria-label="コート上から外す">×</span></button>`;}).join('')||'<span class="lineup-empty">選手をここへドラッグして登録</span>';
}
let dragPlayer=null,touchLongPress=null,touchStartPoint=null,touchIsDragging=false,suppressPlayerClickUntil=0;
function persistRosterOrder(no,targetNo){
  const order=current().playerOrder[selectedTeam]||current().rosters[selectedTeam].map(p=>p.no);const next=order.filter(n=>n!==no);const at=next.indexOf(targetNo);next.splice(at<0?next.length:at,0,no);current().playerOrder[selectedTeam]=next;save();renderPlayers();
}
function addToLineup(no,targetIndex=null){
  const lineup=current().lineup[selectedTeam];if(lineup.includes(no))return;
  if(lineup.length>=7){notify('コート上には7人まで登録できます。',true);return;}
  lineup.splice(targetIndex==null?lineup.length:Math.max(0,Math.min(targetIndex,lineup.length)),0,no);save();renderLineup();
}
function removeFromLineup(no){current().lineup[selectedTeam]=current().lineup[selectedTeam].filter(n=>n!==no);save();renderLineup();}
function reorderLineup(no,targetNo){const list=current().lineup[selectedTeam],next=list.filter(n=>n!==no),at=next.indexOf(targetNo);next.splice(at<0?next.length:at,0,no);current().lineup[selectedTeam]=next;save();renderLineup();}
function completePlayerDrop(target){
  if(!dragPlayer||!target)return;
  const targetLineup=target.closest('[data-lineup-player]');
  if(dragPlayer.source==='roster'){
    if(target.closest('#courtLineup')||target.closest('#lineupPlayers'))addToLineup(dragPlayer.no,targetLineup?Number(targetLineup.dataset.lineupIndex)+1:null);
    else if(target.closest('#playerButtons')){const targetPlayer=target.closest('[data-player]');if(targetPlayer&&Number(targetPlayer.dataset.player)!==dragPlayer.no)persistRosterOrder(dragPlayer.no,Number(targetPlayer.dataset.player));}
  }else{
    if(targetLineup&&Number(targetLineup.dataset.lineupPlayer)!==dragPlayer.no)reorderLineup(dragPlayer.no,Number(targetLineup.dataset.lineupPlayer));
    else if(target.closest('#playerButtons'))removeFromLineup(dragPlayer.no);
  }
  dragPlayer=null;
}
// One visible button per option; hidden inputs keep the existing record format.
function syncChoiceButtons() {
  document.querySelectorAll('[data-choice-for]').forEach(button=>{
    const selected=$(button.dataset.choiceFor).value===button.dataset.choiceValue;
    button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
  });
  const penalty=$('shotType')?.value==='PT';
  if($('penaltyPanel')){$('penaltyPanel').hidden=!penalty;$('normalResults').hidden=penalty;$('detailFields').hidden=penalty;$('playerSelectionTitle').textContent=penalty?'7mスローを打つ選手を選択':'番号ボタンで選択。未指定でも記録できます。';$('playerButtons').classList.toggle('penalty-player-select',penalty);}
}
function renderKeeperButtons() {
  for(const [field,team,name] of [['ownGK','Own',current().ownName],['oppGK','Opp',current().oppName]]) {
    $(field+'Label').textContent=`${name}：守っているGK`;
    const players=new Map(current().rosters[team].map(p=>[p.no,p]));
    const key=team==='Own'?'own_gk':'opp_gk';
    for(const a of current().actions)if(a[key]!=null&&!players.has(a[key]))players.set(a[key],{no:a[key],name:''});
    const button=(value,label)=>`<button type="button" data-choice-for="${field}" data-choice-value="${value}" aria-pressed="false">${label}</button>`;
    $(field+'Buttons').innerHTML=button('','未指定')+[...players.values()].sort((a,b)=>a.no-b.no).map(p=>button(p.no,`<strong>${p.no}</strong>${p.name?`<small>${C.esc(p.name)}</small>`:''}`)).join('');
  }
  syncChoiceButtons();
}
function renderPicker() {
  $('matchPicker').innerHTML=library.map(m=>`<option value="${C.esc(m.id)}">${C.esc(m.date)} ${C.esc(m.ownName)} − ${C.esc(m.oppName)}${m.title?' / '+C.esc(m.title):''}</option>`).join('');$('matchPicker').value=currentId;
}
function renderHome(){
  $('homeMatches').innerHTML=library.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(m=>`<button class="match-card" data-open-match="${C.esc(m.id)}"><strong>${C.esc(m.ownName)} <span>−</span> ${C.esc(m.oppName)}</strong><small>${C.esc(m.title||'試合')} ・ ${C.esc(m.date||'日付未設定')} ・ ${C.analysis(m).score.own}−${C.analysis(m).score.opp}</small></button>`).join('')||'<p class="home-hint">「新しい試合を始める」か試合データを読み込んでください。</p>';
}
function renderLog() {
  const rows=C.running(current().actions),filter=$('logFilter').value;
  $('recordCount').textContent=rows.length+'件';$('undoBtn').disabled=!history.length;
  const filtered=rows.filter(a=>filter==='all'||filter==='goals'&&a.result==='Goal'||a.team===filter).reverse();
  if(!rows.length){$('runningLog').innerHTML='<div class="empty-log"><strong>最初のプレーを記録しよう</strong><span>チーム・背番号を選んで「ゴール」。<br>ここに得点経過が並びます。</span></div>';return;}
  if(!filtered.length){$('runningLog').innerHTML='<div class="empty-log">該当する記録はありません。</div>';return;}
  $('runningLog').innerHTML=`<table><thead><tr><th scope="col">時刻</th><th scope="col">選手</th><th scope="col">得点</th><th scope="col">結果</th><th scope="col">操作</th></tr></thead><tbody>${filtered.map(a=>{
    const m=current(),name=a.team==='Own'?m.ownName:m.oppName;
    const p=m.rosters[a.team].find(p=>p.no===a.no);
    return `<tr class="${a.result==='Goal'?'goal-row':''} ${a.id===editingId?'editing':''}"><td>${a.half===1?'前':'後'} ${a.seconds==null?C.esc(a.time):C.clockText(a.seconds)}${a.seconds==null?'<small>時間帯</small>':''}</td><td class="${a.team==='Own'?'own':'opp'}-text">${C.esc(name)}<small>${a.no==null?'番号未指定':'#'+a.no} ${C.esc(p?.name||'')}</small></td><td><strong>${a.score.own} − ${a.score.opp}</strong></td><td>${labels[a.result]}<small>${C.SHOTS.includes(a.action)?C.esc(SHOOT_LABELS[a.action]):''}${a.zone?'・'+C.esc(C.ZONE_LABELS[a.zone]||a.zone):''}</small></td><td><div class="row-buttons"><button data-edit="${C.esc(a.id)}" aria-label="${C.esc(name)}の${labels[a.result]}を修正">修正</button><button data-delete="${C.esc(a.id)}" aria-label="${C.esc(name)}の${labels[a.result]}を削除">削除</button></div></td></tr>`;
  }).join('')}</tbody></table>`;
}
function refresh() {
  const m=current();matchData=C.analysis(m);matchData.stats=computeStats(matchData.actions);
  $('liveOwnName').textContent=m.ownName;$('liveOppName').textContent=m.oppName;
  $('liveOwnScore').textContent=matchData.score.own;$('liveOppScore').textContent=matchData.score.opp;
  for(const key of ['own','opp']){const s=matchData.stats[key];$('live'+(key==='own'?'Own':'Opp')+'Half').textContent=`前半 ${s.first.goals} / 後半 ${s.second.goals}`;}
  document.querySelector('[data-team="Own"]').textContent=m.ownName;document.querySelector('[data-team="Opp"]').textContent=m.oppName;
  renderPicker();renderPlayers();renderKeeperButtons();renderLog();if(view==='analysis')renderDashboard();
}
function showView(next) {
  view=next;$('homePanel').hidden=next!=='home';$('matchToolbar').hidden=next==='home';$('mainTabs').hidden=next==='home';$('entryPanel').hidden=next!=='entry';$('settingsPanel').hidden=next!=='settings';
  $('dashboard').classList.toggle('active',next==='analysis');$('analysisNotice').hidden=next!=='analysis';
  document.querySelectorAll('[data-view]').forEach(b=>{const active=b.dataset.view===next;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if(next==='analysis'){renderDashboard();if(typeof Chart==='undefined')notify('グラフを読み込めませんでした。記録・集計は引き続き利用できます。',true);}
  if(next==='settings') fillSettings();
  if(next==='home') renderHome();
}
function fillSettings() {
  fillRosterPresets();
  const m=current();$('settingOwn').value=m.ownName;$('settingOpp').value=m.oppName;$('settingDate').value=m.date;$('settingTitle').value=m.title;
  for(const team of ['Own','Opp'])$('roster'+team).value=m.rosters[team].map(p=>`${p.no}${p.name?' '+p.name:''}`).join('\n');
}
function displayClock() {$('clock').value=C.clockText(elapsed());$('livePeriod').textContent=$('half').value==='1'?'前半':'後半';$('clockToggle').textContent=clockStarted==null?'▶ 計時':'Ⅱ 停止';$('clockToggle').classList.toggle('running',clockStarted!=null);syncChoiceButtons();}
function stopClock(){clockSeconds=elapsed();clockStarted=null;displayClock();}
function readClock(){clockSeconds=C.timeToSeconds($('clock').value);clockBase=clockSeconds;if(clockStarted!=null)clockStarted=Date.now();}
function loadCurrent() {
  stopClock();resetEditor();history=[];selectedTeam='Own';
  const m=current();$('half').value=m.clock?.half===2?'2':'1';clockSeconds=Number.isInteger(m.clock?.seconds)?Math.max(0,Math.min(1800,m.clock.seconds)):0;displayClock();
  ['ownGK','oppGK','playerNo'].forEach(id=>$(id).value='');
  $('shotType').value='UN';$('phase').value='';$('zone').value='';setTeam('Own');refresh();if(view==='settings')fillSettings();save();
}
function record(result) {
  try {
    if(Date.now()-lastResultAt<400)return;
    if(clockStarted==null)readClock();
    const previous=editingId?current().actions.find(a=>a.id===editingId):null;
    const keepUnknown=previous && previous.seconds==null && $('clock').dataset.unchanged==='true' && Number($('half').value)===previous.half;
    const a=C.normalizeAction({id:editingId||C.id(),half:Number($('half').value),seconds:keepUnknown?null:elapsed(),time:previous?.time,team:selectedTeam,no:$('playerNo').value,action:$('shotType').value,phase:$('phase').value,zone:$('zone').value,result,own_gk:$('ownGK').value,opp_gk:$('oppGK').value});
    snapshot();lastResultAt=Date.now();
    if(editingId)current().actions=current().actions.map(row=>row.id===editingId?a:row);else current().actions.push(a);
    const edited=!!editingId;resetEditor();$('clock').dataset.unchanged='false';
    if(!edited){if($('autoSwitch').checked && !C.EVENTS.includes(result))setTeam(selectedTeam==='Own'?'Opp':'Own');else $('playerNo').value='';
      if(!$('keepDetails').checked){$('shotType').value='UN';$('phase').value='';$('zone').value='';}}
    if(a.action==='PT'){$('shotType').value='UN';$('phase').value='';$('zone').value='';$('playerNo').value='';syncChoiceButtons();}
    save();refresh();notify(`${a.team==='Own'?current().ownName:current().oppName} ${a.no==null?'':'#'+a.no+' '}${labels[result]}${edited?'を修正しました':'を記録しました'}`);
  } catch(e){notify(e.message,true);}
}
function edit(id){
  const a=current().actions.find(a=>a.id===id);if(!a)return;
  if(!editContext)editContext={seconds:elapsed(),half:$('half').value,team:selectedTeam,fields:Object.fromEntries(['playerNo','shotType','phase','zone','ownGK','oppGK'].map(id=>[id,$(id).value]))};
  stopClock();editingId=id;$('half').value=String(a.half);clockSeconds=a.seconds??(Number(a.time.slice(0,2))%30)*60;displayClock();$('clock').dataset.unchanged='true';
  setTeam(a.team);$('playerNo').value=a.no??'';$('shotType').value=C.SHOTS.includes(a.action)?a.action:'UN';$('phase').value=a.phase||'';$('zone').value=a.zone||'';$('ownGK').value=a.own_gk??'';$('oppGK').value=a.opp_gk??'';
  $('editBadge').hidden=false;$('cancelEdit').hidden=false;$('resultLabel').textContent=`修正後の結果を押して保存（現在：${labels[a.result]}）`;
  renderPlayers();renderLog();$('entryPanel').scrollIntoView({behavior:'smooth',block:'start'});notify('内容を直し、結果ボタンで保存してください。');
}
function download(name, content, type) {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportJSON(){save();download(`handball-${current().date||'match'}.json`,JSON.stringify({version:1,...current()},null,2),'application/json');notify('JSONを保存しました。別の端末でも読み込めます。');}
function csvExport(){
  const cell=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const lines=[['前後半','時刻','チーム','背番号','結果','自チーム得点','相手得点','シュート','場面','場所','自GK','相手GK'],...C.running(current().actions).map(a=>[a.half===1?'前半':'後半',a.seconds==null?a.time:C.clockText(a.seconds),a.team==='Own'?current().ownName:current().oppName,a.no,labels[a.result],a.score.own,a.score.opp,a.action,a.phase,C.ZONE_LABELS[a.zone]||a.zone,a.own_gk,a.opp_gk])];
  download(`handball-${current().date||'match'}.csv`,'\uFEFF'+lines.map(r=>r.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
}
async function importFile(file){
  if(!file)return;
  try {
    if(file.size>15*1024*1024)throw new Error('ファイルは15MB以下にしてください。');
    let parsed;
    if(/\.json$/i.test(file.name))parsed=JSON.parse(await file.text());
    else if(/\.(xlsx|xlsm|xls)$/i.test(file.name)){if(typeof XLSX==='undefined')throw new Error('Excel読込を利用できません。接続を確認してください。');parsed=parseWorkbook(XLSX.read(await file.arrayBuffer(),{type:'array'}));}
    else throw new Error('JSON または Excel ファイルを選択してください。');
    const m=C.normalize(parsed);m.id=C.id();stopClock();save();library.push(m);currentId=m.id;loadCurrent();showView('entry');
    const score=C.analysis(m).score, mismatch=parsed.score&&(score.own!==Number(parsed.score.own)||score.opp!==Number(parsed.score.opp));
    notify(mismatch?'読み込みました。元の得点と記録の合計が異なるため、記録から得点を再計算しました。':'新しい試合として読み込みました。元の試合も残っています。',!!mismatch);
  }catch(e){notify('読み込みできませんでした：'+e.message,true);}finally{$('fileInput').value='';}
}
function parseRoster(value){
  const seen=new Set();return value.split('\n').filter(l=>l.trim()).map(line=>{
    const m=line.trim().match(/^(\d{1,2})(?:[\s,、]+(.*))?$/);if(!m)throw new Error('選手は1行に「背番号 名前」で入力してください。');
    const no=C.number(m[1]);if(seen.has(no))throw new Error(`背番号 ${no} が重複しています。`);seen.add(no);return {no,name:(m[2]||'').trim().slice(0,60)};
  });
}

function fillRosterPresets() {
  try{const teams=RosterStore.load();for(const side of ['Own','Opp'])$('preset'+side).innerHTML='<option value="">大学を選択</option>'+teams.map(t=>`<option value="${C.esc(t.id)}">${C.esc(t.name)}（${t.players.length}人）</option>`).join('');}
  catch(e){notify('大学別名簿を読み込めませんでした：'+e.message,true);}
}
function applyRoster(side){
  try{const team=RosterStore.load().find(t=>t.id===$('preset'+side).value);if(!team)throw new Error('大学を選択してください。');$('setting'+side).value=team.name;$('roster'+side).value=team.players.map(p=>`${p.no} ${p.name}`).join('\n');notify('名簿を反映しました。「設定を保存」で確定してください。');}
  catch(e){notify(e.message,true);}
}

function init(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw){const state=JSON.parse(raw);if(state.version!==1||!Array.isArray(state.matches)||!state.matches.length)throw new Error('形式不明');library=state.matches.map(m=>({...C.normalize(m),clock:m.clock}));currentId=state.currentId;}
  }catch(e){storageBlocked=true;$('saveStatus').textContent='保存データを読めません・JSON保存を';$('saveStatus').classList.add('error');notify('以前の保存データを読み込めませんでした。上書きを止めています。作業中の記録はJSON保存してください。',true);}
  if(!library.length)library=[C.blank()];if(!library.some(m=>m.id===currentId))currentId=library[0].id;
  setupTabs();loadCurrent();showView('home');
  for(const side of ['Own','Opp'])$('load'+side+'Roster').onclick=()=>applyRoster(side);
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));
  document.querySelectorAll('[data-team]').forEach(b=>b.onclick=()=>setTeam(b.dataset.team));
  document.querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>record(b.dataset.result));
  $('playerButtons').onclick=e=>{const b=e.target.closest('[data-player]');if(b&&Date.now()>suppressPlayerClickUntil){$('playerNo').value=b.dataset.player;renderPlayers();}};
  $('lineupPlayers').onclick=e=>{const b=e.target.closest('[data-remove-lineup]');if(b){e.stopPropagation();removeFromLineup(Number(b.dataset.removeLineup));}};
  $('clearLineup').onclick=()=>{current().lineup[selectedTeam]=[];save();renderLineup();};
  document.addEventListener('dragstart',e=>{const p=e.target.closest('[data-player],[data-lineup-player]');if(!p)return;dragPlayer=p.dataset.player!=null?{no:Number(p.dataset.player),source:'roster'}:{no:Number(p.dataset.lineupPlayer),source:'lineup'};e.dataTransfer?.setData('text/plain',String(dragPlayer.no));if(e.dataTransfer)e.dataTransfer.effectAllowed='move';p.classList.add('dragging');});
  document.addEventListener('dragend',e=>{e.target.closest('[data-player],[data-lineup-player]')?.classList.remove('dragging');});
  document.addEventListener('dragover',e=>{if(dragPlayer&&e.target.closest('#playerButtons,#courtLineup,#lineupPlayers'))e.preventDefault();});
  document.addEventListener('drop',e=>{if(!dragPlayer)return;e.preventDefault();completePlayerDrop(e.target);document.querySelectorAll('.dragging').forEach(n=>n.classList.remove('dragging'));});
  document.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;const p=e.target.closest('[data-player],[data-lineup-player]');if(!p)return;touchStartPoint=[e.clientX,e.clientY];dragPlayer=p.dataset.player!=null?{no:Number(p.dataset.player),source:'roster'}:{no:Number(p.dataset.lineupPlayer),source:'lineup'};touchLongPress=setTimeout(()=>{touchIsDragging=true;p.classList.add('dragging');},420);});
  document.addEventListener('pointermove',e=>{if(!touchStartPoint)return;if(!touchIsDragging&&Math.hypot(e.clientX-touchStartPoint[0],e.clientY-touchStartPoint[1])>12){clearTimeout(touchLongPress);touchLongPress=null;dragPlayer=null;touchStartPoint=null;return;}if(touchIsDragging){e.preventDefault();document.querySelectorAll('.drag-over').forEach(n=>n.classList.remove('drag-over'));document.elementFromPoint(e.clientX,e.clientY)?.closest('#playerButtons,#courtLineup,[data-lineup-player]')?.classList.add('drag-over');}} ,{passive:false});
  document.addEventListener('pointerup',e=>{if(!touchStartPoint)return;clearTimeout(touchLongPress);if(touchIsDragging){suppressPlayerClickUntil=Date.now()+500;const target=document.elementFromPoint(e.clientX,e.clientY);completePlayerDrop(target);document.querySelectorAll('.dragging,.drag-over').forEach(n=>n.classList.remove('dragging','drag-over'));}else dragPlayer=null;touchStartPoint=null;touchIsDragging=false;touchLongPress=null;});
  document.addEventListener('pointercancel',()=>{clearTimeout(touchLongPress);dragPlayer=null;touchStartPoint=null;touchIsDragging=false;touchLongPress=null;document.querySelectorAll('.dragging,.drag-over').forEach(n=>n.classList.remove('dragging','drag-over'));});
  document.addEventListener('contextmenu',e=>{if(e.target.closest('[data-player],[data-lineup-player]'))e.preventDefault();});
  $('playerNo').oninput=renderPlayers;
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-choice-for]');if(!button)return;
    const input=$(button.dataset.choiceFor);if(input.value===button.dataset.choiceValue)return;
    input.value=button.dataset.choiceValue;input.dispatchEvent(new Event('change',{bubbles:true}));syncChoiceButtons();
  });
  for(const id of ['ownGK','oppGK'])$(id).oninput=syncChoiceButtons;
  $('runningLog').onclick=e=>{const editBtn=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(editBtn)edit(editBtn.dataset.edit);if(del){snapshot();current().actions=current().actions.filter(a=>a.id!==del.dataset.delete);if(editingId===del.dataset.delete)resetEditor();save();refresh();notify('削除しました。「ひとつ戻す」で取り消せます。');}};
  $('cancelEdit').onclick=()=>{resetEditor();renderLog();};
  $('undoBtn').onclick=()=>{if(!history.length)return;const restored=JSON.parse(history.pop());library[library.findIndex(m=>m.id===currentId)]=restored;resetEditor();save();refresh();if(view==='settings')fillSettings();notify('ひとつ前の状態に戻しました。');};
  $('logFilter').onchange=renderLog;
  $('clockToggle').onclick=()=>{try{if(clockStarted==null){readClock();if(clockSeconds===1800)throw new Error('ハーフ終了です。時刻を変更するか、後半に切り替えてください。');clockBase=clockSeconds;clockStarted=Date.now();$('clock').dataset.unchanged='false';}else stopClock();displayClock();save();}catch(e){notify(e.message,true);}};
  $('clock').onfocus=()=>{if(clockStarted!=null){stopClock();save();}};
  $('clock').oninput=()=>{$('clock').dataset.unchanged='false';};
  $('clock').onchange=()=>{try{readClock();displayClock();save();}catch(e){notify(e.message,true);}};
  $('half').onchange=()=>{stopClock();clockSeconds=0;$('clock').dataset.unchanged='false';displayClock();save();};
  const createMatch=()=>{stopClock();save();const m=C.blank();m.ownName=current().ownName;m.rosters.Own=current().rosters.Own.map(p=>({...p}));library.push(m);currentId=m.id;loadCurrent();showView('settings');$('settingOwn').focus();notify('新しい試合を作成しました。');};
  $('newMatch').onclick=createMatch;$('homeNewMatch').onclick=createMatch;
  $('matchPicker').onchange=()=>{const next=$('matchPicker').value;stopClock();save();currentId=next;loadCurrent();};
  $('settingsForm').onsubmit=e=>{e.preventDefault();try{const own=$('settingOwn').value.trim(),opp=$('settingOpp').value.trim();if(!own||!opp)throw new Error('チーム名を入力してください。');const rosters={Own:parseRoster($('rosterOwn').value),Opp:parseRoster($('rosterOpp').value)};snapshot();Object.assign(current(),{ownName:own,oppName:opp,date:$('settingDate').value,title:$('settingTitle').value.trim(),rosters});for(const team of ['Own','Opp']){const valid=new Set(rosters[team].map(p=>p.no));current().playerOrder[team]=[...new Set(current().playerOrder[team].filter(n=>valid.has(n))),...rosters[team].map(p=>p.no).filter(n=>!current().playerOrder[team].includes(n))];current().lineup[team]=current().lineup[team].filter(n=>valid.has(n));}save();refresh();showView('entry');notify('設定を保存しました。');}catch(e){notify(e.message,true)}};
  $('homeImport').onclick=()=>$('fileInput').click();
  $('homeMatches').onclick=e=>{const b=e.target.closest('[data-open-match]');if(b){stopClock();save();currentId=b.dataset.openMatch;loadCurrent();showView('entry');}};
  $('penaltyCancel').onclick=()=>{$('shotType').value='UN';syncChoiceButtons();};
  $('exportBtn').onclick=exportJSON;$('csvBtn').onclick=csvExport;$('importBtn').onclick=()=>$('fileInput').click();$('fileInput').onchange=e=>importFile(e.target.files[0]);
  document.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault();});document.addEventListener('drop',e=>{if(!e.dataTransfer?.files?.length)return;e.preventDefault();importFile(e.dataTransfer.files[0]);});
  $('demoBtn').onclick=()=>{
    stopClock();save();const m=C.blank();m.ownName='ブルーチーム';m.oppName='レッドチーム';m.title='入力練習用サンプル';m.rosters={Own:[{no:7,name:'選手 A'},{no:14,name:'選手 B'}],Opp:[{no:5,name:'選手 C'},{no:8,name:'選手 D'}]};
    m.actions=[['Own',7,'Goal',23,'WS','L'],['Opp',5,'Save',65,'DS','C'],['Own',14,'Goal',102,'BT','C'],['Opp',8,'Goal',188,'PT','C'],['Own',7,'TM',215,'TO','L']].map(([team,no,result,seconds,action,zone])=>C.normalizeAction({team,no,result,seconds,action,zone,half:1,phase:'SetOF',own_gk:1,opp_gk:12}));
    library.push(m);currentId=m.id;loadCurrent();showView('entry');notify('練習用の架空データです。自由に記録・修正を試せます。');
  };
  document.addEventListener('keydown',e=>{
    if(e.repeat||e.isComposing||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable)return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('undoBtn').click();return;}
    if(view!=='entry'||e.ctrlKey||e.metaKey||e.altKey)return;
    const key=e.key.toLowerCase(),map={g:'Goal',s:'Save',o:'Out',b:'Block',m:'TM',v:'VL'};
    if(key==='a'){e.preventDefault();setTeam('Own');}else if(key==='l'){e.preventDefault();setTeam('Opp');}else if(map[key]){e.preventDefault();record(map[key]);}
  });
  setInterval(()=>{if(clockStarted!=null){displayClock();if(elapsed()===1800){stopClock();save();notify('30分になりました。計時を停止しました。');}}},250);
  setInterval(()=>{if(clockStarted!=null)save();},5000);
  window.addEventListener('pagehide',save);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});
  // Detect another tab's writes instead of silently overwriting an active scorer.
  window.addEventListener('storage',e=>{if(e.key===RosterStore.KEY && view==='settings')fillRosterPresets();if(e.key===STORAGE_KEY){storageBlocked=true;$('saveStatus').textContent='別タブで更新・JSON保存を';$('saveStatus').classList.add('error');notify('別のタブで試合が更新されました。このタブの自動保存を止めました。必要な記録をJSON保存してから再読込してください。',true);}});
}
document.addEventListener('DOMContentLoaded',init);
