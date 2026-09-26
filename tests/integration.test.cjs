const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('jsdom');
function app(page='index.html',stored={}){
 const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync(page,'utf8'),{url:'https://example.test/handball-note/'+page,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
 const w=dom.window;w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;
 Object.entries(stored).forEach(([key,value])=>w.localStorage.setItem(key,value));
 w.HTMLCanvasElement.prototype.getContext=function(){return new Proxy({canvas:this,measureText:v=>({width:String(v).length*7})},{get:(o,k)=>k in o?o[k]:(()=>{}),set:(o,k,v)=>(o[k]=v,true)});};
 class Chart {static defaults={font:{}};constructor(canvas,config){this.config=config;}destroy(){}}
 w.Chart=Chart;
 const scripts=page==='index.html'?['team-defaults.js','score-core.js','roster-store.js','app.js','entry.js']:['team-defaults.js','score-core.js','roster-store.js','roster-page.js'];
 scripts.forEach(f=>new vm.Script(fs.readFileSync(f,'utf8'),{filename:f}).runInContext(dom.getInternalVMContext()));
 if(page==='index.html'){w.document.dispatchEvent(new w.Event('DOMContentLoaded'));w.eval("document.removeEventListener('DOMContentLoaded',init)");}
 const click=selector=>{const e=w.document.querySelector(selector);assert.ok(e,selector);e.click();};
 const set=(id,value)=>{w.document.getElementById(id).value=value;};
 const record=result=>{w.eval('lastResultAt=0');click(`[data-result="${result}"]`);click('#confirmRecord');};
 return {w,dom,errors,click,set,record,close:()=>dom.window.close(),json:code=>JSON.parse(w.eval(`JSON.stringify(${code})`))};
}
test('record, change half, edit, delete, undo, analysis and storage reload',()=>{
 const a=app();try{
 assert.equal(a.w.document.querySelector('#liveOwnName').textContent,'同志社');assert.match(a.w.document.querySelector('#playerButtons').textContent,/矢田莉菜/);
 a.set('clock','00:23');a.click('[data-player="14"]');a.record('Goal');assert.equal(a.json('current().actions')[0].no,14);
 a.set('half','2');a.w.document.querySelector('#half').dispatchEvent(new a.w.Event('change'));a.set('clock','01:10');a.click('[data-team="Opp"]');a.set('playerNo','8');a.record('Goal');
 assert.equal(a.w.document.querySelector('#liveOwnScore').textContent,'1');assert.equal(a.w.document.querySelector('#liveOppScore').textContent,'1');
 a.click('[data-edit]');a.record('Out');assert.equal(a.w.document.querySelector('#liveOppScore').textContent,'0');
 a.click('#undoBtn');assert.equal(a.w.document.querySelector('#liveOppScore').textContent,'1');a.click('[data-delete]');assert.equal(a.json('current().actions').length,1);a.click('#undoBtn');assert.equal(a.json('current().actions').length,2);
 a.click('[data-view="analysis"]');assert.equal(a.w.document.querySelector('#ownScore').textContent,'1');assert.match(a.w.document.querySelector('#ownPlayerTable').textContent,/矢田莉菜/);assert.deepEqual(a.errors,[]);
 const b=app('index.html',{'handball-note-v1':a.w.localStorage.getItem('handball-note-v1')});try{assert.equal(b.json('current().actions').length,2);assert.equal(b.w.document.querySelector('#liveOppScore').textContent,'1');}finally{b.close();}
 }finally{a.close();}
});
test('new match inherits own roster, preserves older match, switching restores both',()=>{
 const a=app();try{a.record('Goal');const id=a.json('currentId');a.click('#newMatch');assert.equal(a.json('current().actions').length,0);assert.equal(a.json('current().rosters.Own').length,a.json('DEFAULT_TEAM.players').length);assert.equal(a.json('library').length,2);a.set('matchPicker',id);a.w.document.querySelector('#matchPicker').dispatchEvent(new a.w.Event('change'));assert.equal(a.json('current().actions').length,1);}finally{a.close();}
});
test('unknown phase not counted as fast break; discipline is excluded from attacks',()=>{
 const a=app();try{a.record('Goal');a.record('Suspension');const s=a.json('matchData.stats.own.total');assert.equal(s.attacks,1);assert.equal(s.shots,1);assert.equal(s.fb_attacks,0);assert.equal(s.fb_goals,0);}finally{a.close();}
});
test('university CRUD, persistence, import validation and match roster loading',()=>{
 const a=app('rosters.html');try{const initialTeamCount=a.json('teams').length;
 assert.match(a.w.document.querySelector('#universityList').textContent,/同志社/);assert.match(a.w.document.querySelector('#universityList').textContent,/龍谷/);
 a.click('#addUniversity');a.set('universityName','テスト大学');a.set('universityMembers','3 選手一\n7\t選手二');a.w.document.querySelector('#directoryForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));
 const teams=a.json('teams');assert.equal(teams.length,initialTeamCount+1);const newTeam=teams.find(t=>t.name==='テスト大学');assert.equal(newTeam.players[1].name,'選手二');
 const storage=a.w.localStorage.getItem('handball-universities-v1');
 const b=app('index.html',{'handball-universities-v1':storage});try{
 b.click('[data-view="settings"]');b.set('presetOpp',newTeam.id);b.click('#loadOppRoster');b.w.document.querySelector('#settingsForm').dispatchEvent(new b.w.Event('submit',{cancelable:true}));assert.equal(b.json('current().oppName'),'テスト大学');assert.equal(b.json('current().rosters.Opp')[1].name,'選手二');
 b.click('[data-team="Opp"]');assert.match(b.w.document.querySelector('#playerButtons').textContent,/選手二/);
 }finally{b.close();}
 a.set('universityMembers','3 A\n3 B');a.w.document.querySelector('#directoryForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));assert.equal(a.json('teams').at(-1).players.length,2);assert.match(a.w.document.querySelector('#toast').textContent,/重複/);
 a.click('#deleteUniversity');assert.equal(a.json('teams').length,initialTeamCount);assert.deepEqual(a.errors,[]);
 }finally{a.close();}
});
test('markup in team/player names renders as text; invalid local state is protected',()=>{
 const a=app();try{
 a.click('[data-view="settings"]');a.set('settingOwn','<img src=x onerror=alert(1)>');a.set('rosterOwn','1 <svg onload=alert(1)>');a.w.document.querySelector('#settingsForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));a.set('playerNo','1');a.record('Goal');a.click('[data-view="analysis"]');assert.equal(a.w.document.querySelectorAll('img,svg').length,0);assert.match(a.w.document.querySelector('#matchTitle').textContent,/<img/);
 }finally{a.close();}
 const b=app('index.html',{'handball-note-v1':'broken'});try{b.record('Goal');assert.equal(b.w.localStorage.getItem('handball-note-v1'),'broken');assert.equal(b.json('storageBlocked'),true);}finally{b.close();}
});
test('editing an older event restores the live clock and player selection',()=>{
 const a=app();try{a.set('clock','02:00');a.record('Goal');a.set('clock','12:34');a.w.document.querySelector('#clock').dispatchEvent(new a.w.Event('change'));a.click('[data-team="Opp"]');a.set('playerNo','8');a.click('[data-edit]');a.record('Out');assert.equal(a.w.document.querySelector('#clock').value,'12:34');assert.equal(a.json('selectedTeam'),'Opp');assert.equal(a.w.document.querySelector('#playerNo').value,'8');}finally{a.close();}
});
test('keyboard shortcut works after team button selection and ignores text entry',()=>{
 const a=app();try{a.click('[data-view="entry"]');a.click('[data-team="Opp"]');a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'g',bubbles:true}));assert.equal(a.json('current().actions').length,0);a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(a.json('current().actions').length,1);a.w.document.querySelector('#clock').focus();a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'g',bubbles:true}));assert.equal(a.json('current().actions').length,1);}finally{a.close();}
});
test('legacy time-only edits remain approximate until explicitly changed',()=>{
 const a=app();try{a.w.eval("current().actions=[C.normalizeAction({team:'Own',no:14,time:'05~10',action:'DS',result:'Goal'})];refresh()");a.click('[data-edit]');a.record('Out');assert.equal(a.json('current().actions')[0].seconds,null);a.click('[data-edit]');a.set('clock','07:30');a.w.document.querySelector('#clock').dispatchEvent(new a.w.Event('input'));a.record('Goal');assert.equal(a.json('current().actions')[0].seconds,450);}finally{a.close();}
});
test('direct choice buttons record details, keep selections when requested, and edit correctly',()=>{
 const a=app();try{
 const choose=(field,value)=>a.click(`[data-choice-for="${field}"][data-choice-value="${value}"]`);
 assert.equal(a.w.document.querySelectorAll('#entryPanel select').length,0);
 choose('half','2');a.set('clock','01:20');a.w.document.querySelector('#clock').dispatchEvent(new a.w.Event('change'));choose('half','2');assert.equal(a.w.document.querySelector('#clock').value,'01:20');
 choose('shotType','WS');choose('phase','FB+Q');choose('zone','TL');a.click('#keepDetails');a.record('Goal');
 const first=a.json('current().actions')[0];assert.equal(first.half,2);assert.equal(first.action,'WS');assert.equal(first.phase,'FB+Q');assert.equal(first.zone,'TL');
 assert.equal(a.w.document.querySelector('[data-choice-for="shotType"][data-choice-value="WS"]').getAttribute('aria-pressed'),'true');
 a.click('#keepDetails');a.record('Out');assert.equal(a.w.document.querySelector('[data-choice-for="shotType"][data-choice-value="UN"]').getAttribute('aria-pressed'),'true');
 a.click('[data-edit]');assert.equal(a.w.document.querySelector('[data-choice-for="zone"][data-choice-value="TL"]').getAttribute('aria-pressed'),'true');choose('zone','BR');a.record('Save');assert.equal(a.json('current().actions')[1].zone,'BR');
 choose('logFilter','goals');assert.equal(a.w.document.querySelectorAll('#runningLog tbody tr').length,1);assert.deepEqual(a.errors,[]);
 }finally{a.close();}
});
test('keeper roster selection persists between plays and assigns saves to the defending team',()=>{
 const a=app();try{
 a.click('[data-choice-for="ownGK"][data-choice-value="1"]');a.click('[data-team="Opp"]');a.set('playerNo','8');a.record('Save');
 assert.equal(a.json('current().actions')[0].own_gk,1);assert.equal(a.json('matchData.personal.own_gk')[0].total.goals,1);assert.equal(a.json('matchData.personal.own_gk')[0].name,'田邉倖');
 assert.equal(a.w.document.querySelector('[data-choice-for="ownGK"][data-choice-value="1"]').getAttribute('aria-pressed'),'true');
 a.record('Goal');assert.equal(a.json('current().actions')[1].own_gk,1);assert.equal(a.json('matchData.personal.own_gk')[0].total.rate,0.5);
 a.click('[data-choice-for="ownGK"][data-choice-value=""]');a.record('Save');assert.equal(a.json('current().actions')[2].own_gk,null);assert.equal(a.json('matchData.personal.own_gk')[0].total.shots,2);assert.deepEqual(a.errors,[]);
 }finally{a.close();}
});

test('result selection is a draft; confirm commits once; TO requires and preserves its subtype',()=>{
 const a=app();try{
 a.click('#normalResults [data-result="Goal"]');assert.equal(a.json('current().actions').length,0);assert.equal(a.w.document.querySelector('#confirmRecord').disabled,false);
 a.click('#confirmRecord');a.click('#confirmRecord');assert.equal(a.json('current().actions').length,1);
 a.click('[data-result="TM"]');assert.equal(a.w.document.querySelector('#mistakePanel').hidden,false);assert.equal(a.w.document.querySelectorAll('#mistakeButtons button').length,8);
 a.w.eval('lastResultAt=0');a.click('#confirmRecord');assert.equal(a.json('current().actions').length,1);
 a.click('[data-choice-for="mistake"][data-choice-value="パスカット"]');a.click('#confirmRecord');assert.equal(a.json('current().actions')[1].mistake,'パスカット');
 a.click('[data-edit]');assert.equal(a.w.document.querySelector('#mistake').value,'パスカット');a.click('[data-choice-for="mistake"][data-choice-value="キャッチミス"]');a.w.eval('lastResultAt=0');a.click('#confirmRecord');assert.equal(a.json('current().actions')[1].mistake,'キャッチミス');
 const b=app('index.html',{'handball-note-v1':a.w.localStorage.getItem('handball-note-v1')});try{assert.equal(b.json('current().actions')[1].mistake,'キャッチミス');}finally{b.close();}
 assert.deepEqual(a.errors,[]);
 }finally{a.close();}
});
test('7m reason, defender, shooter and GK form one undoable play and linked discipline edits stay consistent',()=>{
 const a=app();try{
 const choose=(field,value)=>a.click(`[data-choice-for="${field}"][data-choice-value="${value}"]`);
 choose('position','CB');choose('shotType','PT');assert.equal(a.w.document.querySelector('#detailFields').hidden,false);assert.equal(a.w.document.querySelectorAll('#penaltyResults [data-result="Block"]').length,0);
 choose('ptReason','Suspension');assert.equal(a.w.document.querySelector('#penaltyDefenderStep').hidden,false);assert.equal(a.w.document.querySelector('#playerButtons').hidden,true);
 a.click('#penaltyNext');assert.equal(a.json('penaltyStep'),'defender');a.set('defenderNo','6');a.click('#penaltyNext');assert.equal(a.json('penaltyStep'),'shooter');
 a.click('[data-player="14"]');a.set('penaltyGK','12');a.w.document.querySelector('#penaltyGK').dispatchEvent(new a.w.Event('input'));choose('zone','Loop');a.click('#penaltyResults [data-result="Goal"]');assert.equal(a.json('current().actions').length,0);a.click('#confirmRecord');
 let rows=a.json('current().actions');assert.equal(rows.length,2);const shot=rows.find(r=>r.action==='PT'),discipline=rows.find(r=>r.result==='Suspension');assert.equal(shot.no,14);assert.equal(shot.zone,'Loop');assert.equal(shot.opp_gk,12);assert.equal(shot.defenderNo,6);assert.equal(discipline.no,6);assert.equal(discipline.team,'Opp');assert.equal(discipline.penaltyShotId,shot.id);assert.equal(a.json('matchData.stats.opp.total.attacks'),0);assert.match(a.w.document.querySelector('#keeperSummary').textContent,/#12/);
 a.click(`[data-edit="${discipline.id}"]`);assert.equal(a.json('editingId'),shot.id);choose('ptReason','Yellow');a.set('defenderNo','9');a.click('#penaltyNext');a.click('#penaltyResults [data-result="Save"]');a.w.eval('lastResultAt=0');a.click('#confirmRecord');
 rows=a.json('current().actions');assert.equal(rows.length,2);assert.equal(rows.filter(r=>r.result==='Yellow').length,1);assert.equal(rows.find(r=>r.result==='Yellow').no,9);assert.equal(a.json('matchData.score.own'),0);
 a.click('#undoBtn');assert.equal(a.json('matchData.score.own'),1);assert.equal(a.json('current().actions').find(r=>r.result==='Suspension').no,6);
 const b=app('index.html',{'handball-note-v1':a.w.localStorage.getItem('handball-note-v1')});try{assert.equal(b.json('current().actions').find(r=>r.action==='PT').zone,'Loop');assert.match(b.w.document.querySelector('#keeperSummary').textContent,/#12/);}finally{b.close();}
 a.click(`[data-delete="${shot.id}"]`);assert.equal(a.json('current().actions').length,0);a.click('#undoBtn');assert.equal(a.json('current().actions').length,2);assert.deepEqual(a.errors,[]);
 }finally{a.close();}
});
test('7m line reason skips defender and cancellation does not record punishment',()=>{
 const a=app();try{
 a.click('[data-choice-for="shotType"][data-choice-value="PT"]');a.click('[data-choice-for="ptReason"][data-choice-value="Red"]');a.set('defenderNo','5');a.click('#penaltyNext');a.click('#penaltyCancel');assert.equal(a.json('current().actions').length,0);
 a.click('[data-choice-for="shotType"][data-choice-value="PT"]');a.click('[data-choice-for="ptReason"][data-choice-value="Line"]');assert.equal(a.json('penaltyStep'),'shooter');a.click('[data-player="7"]');a.click('[data-choice-for="zone"][data-choice-value="BR"]');a.click('#penaltyResults [data-result="Out"]');a.click('#confirmRecord');
 assert.equal(a.json('current().actions').length,1);assert.equal(a.json('current().actions')[0].defenderNo,null);assert.equal(a.json('current().actions')[0].ptReason,'Line');assert.deepEqual(a.errors,[]);
 }finally{a.close();}
});
test('practice mode gives seven position choices per selected team and survives reload',()=>{
 const a=app();try{
 a.click('[data-view="settings"]');a.set('presetOwn','practice');a.click('#loadOwnRoster');a.w.document.querySelector('#settingsForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));
 assert.deepEqual(a.json('current().practice'),{Own:true,Opp:false});assert.deepEqual(Array.from(a.w.document.querySelectorAll('#playerButtons button'),b=>b.textContent),['LW','LB','CB','RB','RW','PV','GK']);
 a.click('[data-choice-for="playerPosition"][data-choice-value="PV"]');a.record('Goal');assert.equal(a.json('current().actions')[0].playerPosition,'PV');assert.equal(a.json('current().actions')[0].no,null);assert.match(a.w.document.querySelector('#runningLog').textContent,/PV/);assert.equal(a.json('matchData.score.own'),1);
 a.click('[data-edit]');assert.equal(a.w.document.querySelector('#playerPosition').value,'PV');a.record('Save');
 const b=app('index.html',{'handball-note-v1':a.w.localStorage.getItem('handball-note-v1')});try{assert.equal(b.json('current().practice.Own'),true);assert.equal(b.json('current().actions')[0].playerPosition,'PV');assert.equal(b.w.document.querySelectorAll('#playerButtons button').length,7);}finally{b.close();}
 a.click('[data-view="analysis"]');assert.deepEqual(a.errors,[]);
 }finally{a.close();}
});
test('clock edits restart from the entered time, keep invalid input, and respect half end',()=>{
 const a=app();try{
 let now=100000;a.w.Date.now=()=>now;a.set('clock','12:34');a.click('#clockApply');now+=3000;assert.equal(a.json('elapsed()'),757);
 a.w.document.querySelector('#clock').focus();assert.equal(a.json('clockStarted'),null);a.set('clock','05:10');a.click('#clockApply');now+=2000;assert.equal(a.json('elapsed()'),312);
 a.click('#clockToggle');a.set('clock','30:00');a.click('#clockApply');assert.equal(a.json('clockStarted'),null);
 a.set('clock','30:01');a.click('#clockApply');assert.equal(a.json('clockStarted'),null);assert.equal(a.w.document.querySelector('#clock').value,'30:01');
 a.set('clock','29:59');a.click('#clockToggle');now+=5000;assert.equal(a.json('elapsed()'),1800);assert.deepEqual(a.errors,[]);
 }finally{a.close();}
});
test('home deletion supports cancel, deletes only chosen match, and keeps the library usable',()=>{
 const a=app();try{
 const first=a.json('currentId');a.record('Goal');a.click('#newMatch');const second=a.json('currentId');a.click('[data-view="home"]');
 a.w.confirm=()=>false;a.click(`[data-delete-match="${first}"]`);assert.equal(a.json('library').length,2);
 a.w.confirm=()=>true;a.click(`[data-delete-match="${first}"]`);assert.equal(a.json('library').length,1);assert.equal(a.json('currentId'),second);
 const stored=JSON.parse(a.w.localStorage.getItem('handball-note-v1'));assert.equal(stored.matches.some(m=>m.id===first),false);
 a.click(`[data-delete-match="${second}"]`);assert.notEqual(a.json('currentId'),second);assert.equal(a.w.document.querySelectorAll('[data-open-match]').length,0);a.click('#homeNewMatch');a.w.document.querySelector('#settingsForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));a.w.eval('lastResultAt=0');a.record('Goal');assert.equal(a.json('matchData.score.own'),1);assert.deepEqual(a.errors,[]);
 }finally{a.close();}
});
test('switching practice mode does not change the identity type of historical records during editing',()=>{
 const a=app();try{
 a.w.eval('current().practice.Own=true;renderPlayers()');a.click('[data-choice-for="playerPosition"][data-choice-value="CB"]');a.record('Save');
 a.w.eval('current().practice.Own=false;refresh()');a.click('[data-edit]');assert.equal(a.w.document.querySelectorAll('#playerButtons button').length,7);a.record('Out');assert.equal(a.json('current().actions')[0].playerPosition,'CB');
 a.click('[data-player="14"]');a.record('Save');a.w.eval('current().practice.Own=true;refresh()');a.click('[data-edit]');assert.equal(a.w.document.querySelector('#playerNumberLabel').hidden,false);a.record('Out');assert.equal(a.json('current().actions')[1].no,14);assert.equal(a.json('current().actions')[1].playerPosition,null);assert.deepEqual(a.errors,[]);
 }finally{a.close();}
});
