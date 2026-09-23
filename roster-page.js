'use strict';
const $=id=>document.getElementById(id),C=ScoreCore;
let teams=[],selectedId=null,dirty=false,blocked=false,toastTimer;
function notify(message,error=false){$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?7000:3200);}
function persist(next){if(blocked)throw new Error('別のタブの変更を保護するため保存を停止しています。再読込してください。');teams=RosterStore.save(next);$('rosterStatus').textContent='この端末に保存済み';}
function confirmDiscard(){return !dirty||confirm('未保存の変更を破棄して移動しますか？');}
function renderList(){
  $('universityCount').textContent=teams.length+'校';const query=$('universitySearch').value.trim().toLowerCase();
  const found=teams.filter(t=>t.name.toLowerCase().includes(query));
  $('universityList').innerHTML=found.map(t=>`<button data-university="${C.esc(t.id)}" class="${t.id===selectedId?'selected':''}"><strong>${C.esc(t.name)}</strong><span>${t.players.length}人</span></button>`).join('')||'<p class="field-hint">大学が見つかりません。「大学を追加」で登録できます。</p>';
}
function select(id){selectedId=id;dirty=false;const team=teams.find(t=>t.id===id);$('universityName').value=team?.name||'';$('universityMembers').value=team?.players.map(p=>`${p.no}${p.name?' '+p.name:''}`).join('\n')||'';$('directoryEditorTitle').textContent=team?'名簿を編集':'大学を追加';$('memberCount').textContent=team?team.players.length+'人':'';$('deleteUniversity').disabled=!team;renderList();}
function parseMembers(value){const seen=new Set();return value.split('\n').filter(l=>l.trim()).map(line=>{const m=line.trim().match(/^(\d{1,2})(?:[\s,、]+(.*))?$/);if(!m)throw new Error('1行に「背番号 名前」で入力してください。');const no=C.number(m[1]);if(seen.has(no))throw new Error(`背番号 ${no} が重複しています。`);seen.add(no);return {no,name:(m[2]||'').trim().slice(0,60)};});}
function download(name,content){const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
try{teams=RosterStore.load();}catch(e){blocked=true;$('rosterStatus').textContent='保存データを読めません';notify(e.message,true);}
select(teams[0]?.id||null);
$('universityList').onclick=e=>{const b=e.target.closest('[data-university]');if(b&&confirmDiscard())select(b.dataset.university);};
$('universitySearch').oninput=renderList;
$('addUniversity').onclick=()=>{if(confirmDiscard()){select(null);$('universityName').focus();}};
$('directoryForm').oninput=()=>{dirty=true;$('rosterStatus').textContent='編集内容は未保存';};
$('directoryForm').onsubmit=e=>{e.preventDefault();try{
  const name=$('universityName').value.trim();if(!name)throw new Error('大学名を入力してください。');if(teams.some(t=>t.name===name&&t.id!==selectedId))throw new Error('同じ大学名が登録されています。既存の名簿を選んで編集してください。');
  const team={id:selectedId||C.id(),name,players:parseMembers($('universityMembers').value)};
  const next=selectedId?teams.map(t=>t.id===selectedId?team:t):[...teams,team];persist(next);select(team.id);notify('名簿を保存しました。試合・選手設定から呼び出せます。');
}catch(e){notify(e.message,true);}};
$('cancelDirectoryEdit').onclick=()=>{if(confirmDiscard())select(selectedId);};
$('deleteUniversity').onclick=()=>{const team=teams.find(t=>t.id===selectedId);if(!team||!confirm(`「${team.name}」の名簿を削除しますか？過去の試合の名簿は残ります。`))return;try{persist(teams.filter(t=>t.id!==selectedId));select(teams[0]?.id||null);notify('名簿を削除しました。');}catch(e){notify(e.message,true);}};
$('directoryExport').onclick=()=>{download('handball-universities.json',JSON.stringify({format:'handball-universities',version:1,teams},null,2));notify(dirty?'保存済みの名簿を書き出しました。編集中の変更は含みません。':'全名簿を書き出しました。');};
$('directoryImport').onclick=()=>$('directoryFile').click();
$('directoryFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(!confirmDiscard())return;if(file.size>5*1024*1024)throw new Error('ファイルは5MB以下にしてください。');const raw=JSON.parse(await file.text());if(raw.format!=='handball-universities'||raw.version!==1)throw new Error('名簿ページで書き出したJSONを選択してください。');const added=RosterStore.validate(raw.teams),names=new Set(teams.map(t=>t.name));for(const team of added){team.id=C.id();let suffix=1,base=team.name;while(names.has(team.name))team.name=`${base}（読込${suffix++}）`;names.add(team.name);}persist([...teams,...added]);select(added[0]?.id||teams[0]?.id||null);notify(`${added.length}校の名簿を追加しました。既存の名簿は残っています。`);}catch(e){notify(e.message,true);}finally{e.target.value='';}};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('storage',e=>{if(e.key===RosterStore.KEY){if(dirty){blocked=true;$('rosterStatus').textContent='別タブで更新・再読込が必要';notify('別のタブで名簿が更新されました。編集中の内容をコピーしてから再読込してください。',true);}else{try{teams=RosterStore.load();select(teams.some(t=>t.id===selectedId)?selectedId:teams[0]?.id||null);}catch(err){notify(err.message,true);}}}});
