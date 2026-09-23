const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../score-core.js');
const fs=require('node:fs');
const action=(overrides={})=>C.normalizeAction({team:'Own',no:7,half:1,seconds:30,action:'DS',result:'Goal',phase:'SetOF',zone:'C',...overrides});
test('chronological running score, edits and removal',()=>{
 const a=action({seconds:60}), b=action({team:'Opp',seconds:30}), c=action({half:2,seconds:0});
 assert.deepEqual(C.running([a,c,b]).map(r=>r.score),[{own:0,opp:1},{own:1,opp:1},{own:2,opp:1}]);
 assert.deepEqual(C.running([a,b]).at(-1).score,{own:1,opp:1});
 assert.deepEqual(C.running([{...a,result:'Out'},b]).at(-1).score,{own:0,opp:1});
});
test('half end remains in its own half and bucket',()=>{
 assert.equal(action({seconds:1800}).time,'25~30');assert.equal(action({half:2,seconds:0}).time,'30~35');
 assert.equal(action({half:2,seconds:1800}).time,'55~60');
 assert.equal(C.timeToSeconds('30:00'),1800);assert.throws(()=>C.timeToSeconds('30:01'));assert.throws(()=>C.timeToSeconds('01:65'));
});
test('unclassified goals count as shots without invented details, events do not',()=>{
 const m=C.blank();m.actions=[action({action:'UN',phase:null,zone:null}),action({result:'Suspension'}),action({team:'Opp',result:'Save',own_gk:1}),action({result:'TM'})];
 const d=C.analysis(m);assert.deepEqual(d.score,{own:1,opp:0});assert.equal(d.personal.own_shooters[0].total.shots,1);assert.equal(d.personal.own_shooters[0].un.goals,1);assert.equal(d.personal.own_shooters[0].to_total,1);assert.equal(d.personal.own_gk[0].total.rate,1);
});
test('roundtrip and legacy file preserve names and avoid invented exact time',{skip:!fs.existsSync('match_data.json')},()=>{
 const original=JSON.parse(fs.readFileSync('match_data.json','utf8'));const m=C.normalize(original),d=C.analysis(m);
 assert.deepEqual(d.score,original.score);assert.equal(m.rosters.Own.find(p=>p.no===14).name,'矢田莉奈');assert.equal(m.actions[0].seconds,null);
 const r=C.normalize(JSON.parse(JSON.stringify(m)));assert.deepEqual(r,m);
 const a=d.personal.own_shooters.find(p=>p.no===14).total,b=original.personal.own_shooters.find(p=>p.no===14).total;assert.equal(a.goals,b.goals);assert.equal(a.shots,b.shots);assert.ok(Math.abs(a.rate-b.rate)<0.0001);
});
test('malformed imports and duplicate identifiers are handled',()=>{
 assert.throws(()=>C.normalize({}));assert.throws(()=>action({team:'invalid'}));assert.throws(()=>action({no:100}));assert.throws(()=>action({no:-1}));assert.throws(()=>action({result:'other'}));assert.throws(()=>action({seconds:-1}));
 const a=action();const m=C.normalize({actions:[a,a]});assert.notEqual(m.actions[0].id,m.actions[1].id);assert.equal(C.esc('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
});
