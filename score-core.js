/* Shared model: browser + Node tests. No network or DOM access. */
(function (root) {
  'use strict';
  const SHOTS = ['DS', 'LS', 'WS', 'BT', 'EG', 'PT', 'UN'];
  const ZONES = ['L','C','R','TL','TC','TR','ML','MC','MR','BL','BC','BR','Loop'];
  const ZONE_LABELS = {L:'左',C:'中央',R:'右',TL:'左上',TC:'中上',TR:'右上',ML:'左中',MC:'中央',MR:'右中',BL:'左下',BC:'中下',BR:'右下',Loop:'ループ'};
  const POSITIONS = ['LW','LB','CB','RB','RW'];
  const POSITION_LABELS = {LW:'LW',LB:'L',CB:'C',RB:'R',RW:'RW'};
  const PLAYER_POSITIONS = ['LW','LB','CB','RB','RW','PV','GK'];
  const MISTAKES = ['オーバー','ダブドリ','チャージ','ライン','パッシブ','パスカット','パスミス','キャッチミス'];
  const PT_REASONS = {Line:'ライン内',Yellow:'警告',Suspension:'退場',Red:'失格'};
  const RESULTS = ['Goal', 'Save', 'Out', 'Block', 'TM', 'VL', 'Yellow', 'Suspension', 'Red', 'Timeout'];
  const EVENTS = RESULTS.slice(6);
  const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text = (v, fallback = '') => String(v ?? fallback).slice(0, 120);
  const number = v => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error('背番号・GK番号は 0〜99 で入力してください。');
    return n;
  };
  function timeToSeconds(v) {
    if (!/^\d{1,2}:[0-5]\d$/.test(v)) throw new Error('時刻は 分:秒（例 03:24）で入力してください。');
    const [m, s] = v.split(':').map(Number);
    if (m > 30 || (m === 30 && s)) throw new Error('時刻は各ハーフの 00:00〜30:00 で入力してください。');
    return m * 60 + s;
  }
  const clockText = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  function bucket(half, seconds) {
    const start = (half === 2 ? 30 : 0) + Math.min(25, Math.floor(seconds / 300) * 5);
    return `${String(start).padStart(2,'0')}~${String(start + 5).padStart(2,'0')}`;
  }
  function normalizeAction(a) {
    if (!a || !['Own','Opp'].includes(a.team) || !RESULTS.includes(a.result)) throw new Error('記録のチームまたは結果が正しくありません。');
    let half, seconds, time;
    if (a.seconds != null) {
      half = Number(a.half); seconds = Number(a.seconds);
      if (![1,2].includes(half) || !Number.isInteger(seconds) || seconds < 0 || seconds > 1800) throw new Error('記録の時刻が正しくありません。');
      time = bucket(half, seconds);
    } else {
      time = String(a.time).replace(/～/g, '~');
      if (!/^(00~05|05~10|10~15|15~20|20~25|25~30|30~35|35~40|40~45|45~50|50~55|55~60)$/.test(time)) throw new Error('時間帯が正しくありません。');
      half = Number(time.slice(0,2)) < 30 ? 1 : 2;
      seconds = null;
    }
    const turnover = ['TM','VL'].includes(a.result), event = EVENTS.includes(a.result);
    if (!turnover && !event && a.action && !SHOTS.includes(a.action)) throw new Error('シュート種別が正しくありません。');
    return {id: text(a.id || id()), half, seconds, time, team:a.team, no:number(a.no),
      phase: ['SetOF','FB+Q'].includes(a.phase) ? a.phase : null,
      action: event ? 'Event' : turnover ? 'TO' : a.action || 'UN',
      zone: ZONES.includes(a.zone) ? a.zone : null, result:a.result,
      position: POSITIONS.includes(a.position) ? a.position : null,
      playerPosition: PLAYER_POSITIONS.includes(a.playerPosition) ? a.playerPosition : null,
      mistake: turnover && MISTAKES.includes(a.mistake) ? a.mistake : null,
      ptReason: a.action==='PT' && Object.hasOwn(PT_REASONS,a.ptReason) ? a.ptReason : null,
      defenderNo: a.action==='PT' ? number(a.defenderNo) : null,
      penaltyShotId: a.penaltyShotId ? text(a.penaltyShotId) : null,
      own_gk:number(a.own_gk), opp_gk:number(a.opp_gk)};
  }
  function blank() {
    const own=(root.DEFAULT_TEAM?.players || []).map(p=>({...p}));
    return {id:id(), ownName:root.DEFAULT_TEAM?.name || '自チーム', oppName:'相手チーム', date:new Date().toLocaleDateString('sv-SE'), title:'', rosters:{Own:own,Opp:[]}, playerOrder:{Own:own.map(p=>p.no),Opp:[]}, practice:{Own:false,Opp:false}, actions:[]};
  }
  function normalize(data) {
    if (!data || !Array.isArray(data.actions) || data.actions.length > 20000) throw new Error('対応する試合JSONではありません。');
    const m = {...blank(), id:text(data.id || id()), ownName:text(data.ownName || data.team_own?.name || '自チーム'), oppName:text(data.oppName || data.team_opp?.name || '相手チーム'), date:text(data.date || ''),title:text(data.title || '')};
    for (const team of ['Own','Opp']) {
      m.practice[team]=data.practice?.[team]===true;
      const prefix = team.toLowerCase();
      const players = data.rosters?.[team] || [...(data.personal?.[`${prefix}_shooters`] || []), ...(data.personal?.[`${prefix}_gk`] || [])];
      if (!Array.isArray(players)) throw new Error('選手リストが正しくありません。');
      const unique = new Map();
      for (const p of players) {const n = number(p.no); if (n != null) unique.set(n,{no:n,name:text(p.name)});}
      m.rosters[team] = [...unique.values()].sort((a,b) => a.no-b.no);
      const valid=new Set(m.rosters[team].map(p=>p.no));
      const order=Array.isArray(data.playerOrder?.[team])?data.playerOrder[team].map(number).filter(n=>n!=null&&valid.has(n)):[];
      m.playerOrder[team]=[...new Set(order),...m.rosters[team].map(p=>p.no).filter(n=>!order.includes(n))];
    }
    if(data.placeholder===true)m.placeholder=true;
    if(data.keepers)m.keepers={Own:number(data.keepers.Own),Opp:number(data.keepers.Opp)};
    const used = new Set();
    m.actions = data.actions.map(a => { const row=normalizeAction(a); if(used.has(row.id)) row.id=id(); used.add(row.id); return row; });
    return m;
  }
  function ordered(actions) {
    return actions.map((a,i)=>({a,i})).sort((x,y)=> {
      const at = a => (a.half-1)*1800 + (a.seconds ?? ((Number(a.time.slice(0,2)) % 30)*60));
      return at(x.a)-at(y.a) || x.i-y.i;
    }).map(x=>x.a);
  }
  function running(actions) {
    let own=0,opp=0;
    return ordered(actions).map(a=>{if(a.result==='Goal') a.team==='Own'?own++:opp++;return {...a,score:{own,opp}};});
  }
  function playerStats(m) {
    const output={};
    const fresh = (no, name) => ({no,name,...Object.fromEntries(SHOTS.map(t=>[t.toLowerCase(),{goals:0,shots:0}])),total:{goals:0,shots:0,rate:0},out:0,block:0,tm:0,vl:0,to_total:0});
    for(const team of ['Own','Opp']) {
      const shooters=new Map(), keepers=new Map(), roster=m.rosters[team];
      const get=(map,no)=>{if(!map.has(no))map.set(no,fresh(no,roster.find(p=>p.no===no)?.name||''));return map.get(no);};
      for(const a of m.actions) {
        if(a.team===team && a.no!=null && a.action!=='Event') {
          const p=get(shooters,a.no);
          if(SHOTS.includes(a.action)) {p[a.action.toLowerCase()].shots++;p.total.shots++;if(a.result==='Goal'){p[a.action.toLowerCase()].goals++;p.total.goals++;}}
          if(a.result==='Out') p.out++; if(a.result==='Block') p.block++;
          if(a.action==='TO'){p.to_total++;p[a.result.toLowerCase()]++;}
        }
        const gk=team==='Own'?a.own_gk:a.opp_gk;
        if(a.team!==team && gk!=null && SHOTS.includes(a.action)) {
          const p=get(keepers,gk);
          if(['Goal','Save'].includes(a.result)){p[a.action.toLowerCase()].shots++;p.total.shots++;if(a.result==='Save'){p[a.action.toLowerCase()].goals++;p.total.goals++;}}
          if(a.result==='Out') p.out++; if(a.result==='Block') p.block++;
        }
      }
      for(const [key,map] of [['shooters',shooters],['gk',keepers]]) {
        const list=[...map.values()].sort((a,b)=>a.no-b.no), total=fresh(null,'小計');
        list.forEach(p=>{p.total.rate=p.total.shots?p.total.goals/p.total.shots:0;for(const t of SHOTS){for(const k of ['goals','shots'])total[t.toLowerCase()][k]+=p[t.toLowerCase()][k];}for(const k of ['goals','shots'])total.total[k]+=p.total[k];for(const k of ['out','block','tm','vl','to_total'])total[k]+=p[k];});
        total.total.rate=total.total.shots?total.total.goals/total.total.shots:0;
        output[`${team.toLowerCase()}_${key}`]=list;
        output[`${team.toLowerCase()}_${key==='shooters'?'shoot':key}_subtotal`]=total;
      }
    }
    return output;
  }
  function analysis(m) {
    const actions=ordered(m.actions), last=running(actions).at(-1);
    return {...m, actions, score:last?.score||{own:0,opp:0}, personal:playerStats(m)};
  }
  const zoneColumn=zone=>({L:'L',C:'C',R:'R',TL:'L',ML:'L',BL:'L',TC:'C',MC:'C',BC:'C',TR:'R',MR:'R',BR:'R'})[zone]||null;
  const api={PLAYER_POSITIONS,MISTAKES,PT_REASONS,SHOTS,ZONES,ZONE_LABELS,POSITIONS,POSITION_LABELS,zoneColumn,RESULTS,EVENTS,id,esc,number,timeToSeconds,clockText,bucket,normalizeAction,blank,normalize,ordered,running,playerStats,analysis};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  root.ScoreCore=api;
})(globalThis);
