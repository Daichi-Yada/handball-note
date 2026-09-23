/* Shared university directory; match rosters are independent snapshots. */
(function(root){
  const KEY='handball-universities-v1';
  function validate(teams){
    if(!Array.isArray(teams)||teams.length>500)throw new Error('大学名簿の形式が正しくありません。');
    const ids=new Set();return teams.map(t=>{
      if(!t || typeof t.name!=='string'||!t.name.trim()||!Array.isArray(t.players)||t.players.length>100)throw new Error('大学名・選手一覧を確認してください。');
      const numbers=new Set();const players=t.players.map(p=>{const no=ScoreCore.number(p.no);if(no==null||numbers.has(no))throw new Error('背番号が未入力または重複しています。');numbers.add(no);return {no,name:String(p.name||'').slice(0,60)};}).sort((a,b)=>a.no-b.no);
      let id=String(t.id||ScoreCore.id());if(ids.has(id))id=ScoreCore.id();ids.add(id);
      return {id,name:t.name.trim().slice(0,60),players};
    });
  }
  function load(){const raw=localStorage.getItem(KEY);return validate(raw?JSON.parse(raw):(root.DEFAULT_UNIVERSITIES||[]));}
  function save(teams){const valid=validate(teams);localStorage.setItem(KEY,JSON.stringify(valid));return valid;}
  root.RosterStore={KEY,load,save,validate};
})(globalThis);
