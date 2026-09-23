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
 const record=result=>{w.eval('lastResultAt=0');click(`[data-result="${result}"]`);};
 return {w,dom,errors,click,set,record,close:()=>dom.window.close(),json:code=>JSON.parse(w.eval(`JSON.stringify(${code})`))};
}
test('record, change half, edit, delete, undo, analysis and storage reload',()=>{
 const a=app();try{
 assert.equal(a.w.document.querySelector('#liveOwnName').textContent,'同志社');assert.match(a.w.document.querySelector('#playerButtons').textContent,/矢田莉奈/);
 a.set('clock','00:23');a.click('[data-player="14"]');a.record('Goal');assert.equal(a.json('current().actions')[0].no,14);
 a.set('half','2');a.w.document.querySelector('#half').dispatchEvent(new a.w.Event('change'));a.set('clock','01:10');a.click('[data-team="Opp"]');a.set('playerNo','8');a.record('Goal');
 assert.equal(a.w.document.querySelector('#liveOwnScore').textContent,'1');assert.equal(a.w.document.querySelector('#liveOppScore').textContent,'1');
 a.click('[data-edit]');a.record('Out');assert.equal(a.w.document.querySelector('#liveOppScore').textContent,'0');
 a.click('#undoBtn');assert.equal(a.w.document.querySelector('#liveOppScore').textContent,'1');a.click('[data-delete]');assert.equal(a.json('current().actions').length,1);a.click('#undoBtn');assert.equal(a.json('current().actions').length,2);
 a.click('[data-view="analysis"]');assert.equal(a.w.document.querySelector('#ownScore').textContent,'1');assert.match(a.w.document.querySelector('#ownPlayerTable').textContent,/矢田莉奈/);assert.deepEqual(a.errors,[]);
 const b=app('index.html',{'handball-note-v1':a.w.localStorage.getItem('handball-note-v1')});try{assert.equal(b.json('current().actions').length,2);assert.equal(b.w.document.querySelector('#liveOppScore').textContent,'1');}finally{b.close();}
 }finally{a.close();}
});
test('new match inherits own roster, preserves older match, switching restores both',()=>{
 const a=app();try{a.record('Goal');const id=a.json('currentId');a.click('#newMatch');assert.equal(a.json('current().actions').length,0);assert.equal(a.json('current().rosters.Own').length,9);assert.equal(a.json('library').length,2);a.set('matchPicker',id);a.w.document.querySelector('#matchPicker').dispatchEvent(new a.w.Event('change'));assert.equal(a.json('current().actions').length,1);}finally{a.close();}
});
test('unknown phase not counted as fast break; discipline is excluded from attacks',()=>{
 const a=app();try{a.record('Goal');a.record('Suspension');const s=a.json('matchData.stats.own.total');assert.equal(s.attacks,1);assert.equal(s.shots,1);assert.equal(s.fb_attacks,0);assert.equal(s.fb_goals,0);}finally{a.close();}
});
test('university CRUD, persistence, import validation and match roster loading',()=>{
 const a=app('rosters.html');try{
 assert.match(a.w.document.querySelector('#universityList').textContent,/同志社/);assert.match(a.w.document.querySelector('#universityList').textContent,/龍谷/);
 a.click('#addUniversity');a.set('universityName','テスト大学');a.set('universityMembers','3 選手一\n7\t選手二');a.w.document.querySelector('#directoryForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));
 const teams=a.json('teams');assert.equal(teams.length,3);const newTeam=teams.find(t=>t.name==='テスト大学');assert.equal(newTeam.players[1].name,'選手二');
 const storage=a.w.localStorage.getItem('handball-universities-v1');
 const b=app('index.html',{'handball-universities-v1':storage});try{
 b.click('[data-view="settings"]');b.set('presetOpp',newTeam.id);b.click('#loadOppRoster');b.w.document.querySelector('#settingsForm').dispatchEvent(new b.w.Event('submit',{cancelable:true}));assert.equal(b.json('current().oppName'),'テスト大学');assert.equal(b.json('current().rosters.Opp')[1].name,'選手二');
 b.click('[data-team="Opp"]');assert.match(b.w.document.querySelector('#playerButtons').textContent,/選手二/);
 }finally{b.close();}
 a.set('universityMembers','3 A\n3 B');a.w.document.querySelector('#directoryForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));assert.equal(a.json('teams').at(-1).players.length,2);assert.match(a.w.document.querySelector('#toast').textContent,/重複/);
 a.click('#deleteUniversity');assert.equal(a.json('teams').length,2);assert.deepEqual(a.errors,[]);
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
 const a=app();try{a.click('[data-team="Opp"]');a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'g',bubbles:true}));assert.equal(a.json('current().actions').length,1);a.w.document.querySelector('#clock').focus();a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'g',bubbles:true}));assert.equal(a.json('current().actions').length,1);}finally{a.close();}
});
test('legacy time-only edits remain approximate until explicitly changed',()=>{
 const a=app();try{a.w.eval("current().actions=[C.normalizeAction({team:'Own',no:14,time:'05~10',action:'DS',result:'Goal'})];refresh()");a.click('[data-edit]');a.record('Out');assert.equal(a.json('current().actions')[0].seconds,null);a.click('[data-edit]');a.set('clock','07:30');a.w.document.querySelector('#clock').dispatchEvent(new a.w.Event('input'));a.record('Goal');assert.equal(a.json('current().actions')[0].seconds,450);}finally{a.close();}
});
