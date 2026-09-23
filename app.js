/**
 * ハンドボール試合分析ダッシュボード - メインアプリケーション
 * Excel(.xlsm/.xlsx)ファイルを読み込み、試合データを視覚的に表示する
 */

// ===== グローバル変数 =====
let matchData = null;
let charts = {};

// ===== 時間帯ラベル =====
const TIME_PERIODS_1ST = ['00~05', '05~10', '10~15', '15~20', '20~25', '25~30'];
const TIME_PERIODS_2ND = ['30~35', '35~40', '40~45', '45~50', '50~55', '55~60'];
const TIME_PERIODS_ALL = [...TIME_PERIODS_1ST, ...TIME_PERIODS_2ND];
const SHOOT_TYPES = ['DS', 'LS', 'WS', 'BT', 'EG', 'PT', 'UN'];
const SHOOT_LABELS = {
  DS: 'ディスタンス', LS: 'ライン', WS: 'ウイング',
  BT: 'ブレイクスルー', EG: 'エンプティ', PT: '7mスロー', UN: '未指定'
};
const RESULT_TYPES = ['Goal', 'Save', 'Out', 'Block', 'TM', 'VL'];

// ===== Chart.jsグローバル設定 =====
if (typeof Chart !== 'undefined') Chart.defaults.color = '#94a3b8';
if (typeof Chart !== 'undefined') Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
if (typeof Chart !== 'undefined') Chart.defaults.font.family = "'Inter', 'Noto Sans JP', sans-serif";

// ===== Excelパーサー =====
function parseWorkbook(wb) {
  const result = {};

  // Data Sheet
  const dataSheet = wb.Sheets['Data'];
  if (!dataSheet || !wb.Sheets['Team']) throw new Error('Data・Team シートを持つ既存形式のExcelを選択してください。');
  const dataRows = XLSX.utils.sheet_to_json(dataSheet, { header: 1, defval: null });

  // Score
  result.score = { own: dataRows[2]?.[14] || 0, opp: dataRows[2]?.[16] || 0 };

  // Team names from Team sheet
  const teamSheet = wb.Sheets['Team'];
  const teamRows = XLSX.utils.sheet_to_json(teamSheet, { header: 1, defval: null });
  result.ownName = teamRows[1]?.[5] || 'Own';
  result.oppName = teamRows[22] ? (teamRows[22][5] || teamRows[23]?.[5] || 'Opp') : 'Opp';

  // Actions
  result.actions = [];
  for (let i = 3; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row[0]) continue;
    result.actions.push({
      time: String(row[0]).replace(/～/g, '~'),
      team: row[1],
      no: row[2] != null ? Number(row[2]) : null,
      phase: row[3],
      action: row[4],
      zone: row[5],
      result: row[6],
      own_gk: row[7] != null ? Number(row[7]) : null,
      opp_gk: row[8] != null ? Number(row[8]) : null
    });
  }

  // Personal Sheet
  const personalSheet = wb.Sheets['Personal'];
  if (personalSheet) {
    const pRows = XLSX.utils.sheet_to_json(personalSheet, { header: 1, defval: null });
    result.personal = parsePersonalSheet(pRows);
  }

  // Compute stats from actions
  result.stats = computeStats(result.actions);

  return result;
}

// ===== Personal Sheet Parser =====
function parsePersonalSheet(rows) {
  const result = {};

  function parseBlock(startRow, endRow, type) {
    const players = [];
    let subtotal = null;
    for (let i = startRow; i <= endRow && i < rows.length; i++) {
      const r = rows[i];
      if (!r || r[0] == null) continue;
      if (r[0] === '小計') {
        subtotal = extractPlayerRow(r, type);
        subtotal.isSubtotal = true;
        break;
      }
      if (r[0] === 'シュート成功率' || r[0] === 'セーブ率') continue;
      if (typeof r[0] !== 'number') continue;
      const p = extractPlayerRow(r, type);
      p.no = Number(r[0]);
      p.name = r[1] || '';
      players.push(p);
    }
    return { players, subtotal };
  }

  function extractPlayerRow(r, type) {
    const p = {
      ds: { goals: r[2] || 0, shots: r[4] || 0 },
      ls: { goals: r[5] || 0, shots: r[7] || 0 },
      ws: { goals: r[8] || 0, shots: r[10] || 0 },
      bt: { goals: r[11] || 0, shots: r[13] || 0 },
      eg: { goals: r[14] || 0, shots: r[16] || 0 },
      pt: { goals: r[17] || 0, shots: r[19] || 0 },
      total: { goals: r[20] || 0, shots: r[22] || 0, rate: r[23] || 0 }
    };
    if (type === 'shoot') {
      p.out = r[24] || 0;
      p.block = r[25] || 0;
      p.tm = r[26] || 0;
      p.vl = r[27] || 0;
      p.to_total = r[28] || 0;
    } else if (type === 'save') {
      p.out = r[24] || 0;
      p.block = r[25] || 0;
    }
    return p;
  }

  const ownShoot = parseBlock(2, 18, 'shoot');
  const ownGK = parseBlock(22, 25, 'save');
  const oppShoot = parseBlock(29, 45, 'shoot');
  const oppGK = parseBlock(49, 52, 'save');

  result.own_shooters = ownShoot.players;
  result.own_shoot_subtotal = ownShoot.subtotal;
  result.own_gk = ownGK.players;
  result.own_gk_subtotal = ownGK.subtotal;
  result.opp_shooters = oppShoot.players;
  result.opp_shoot_subtotal = oppShoot.subtotal;
  result.opp_gk = oppGK.players;
  result.opp_gk_subtotal = oppGK.subtotal;

  return result;
}

// ===== アクションデータから統計を計算 =====
function computeStats(actions) {
  const stats = {
    own: { total: {}, first: {}, second: {}, byTime: {}, byShoot: {}, byZone: {}, byPosition: {} },
    opp: { total: {}, first: {}, second: {}, byTime: {}, byShoot: {}, byZone: {}, byPosition: {} }
  };

  // Initialize time periods
  TIME_PERIODS_ALL.forEach(t => {
    stats.own.byTime[t] = { attacks: 0, goals: 0, shots: 0, to: 0 };
    stats.opp.byTime[t] = { attacks: 0, goals: 0, shots: 0, to: 0 };
  });

  // Initialize shoot types
  SHOOT_TYPES.forEach(s => {
    stats.own.byShoot[s] = { goals: 0, shots: 0 };
    stats.opp.byShoot[s] = { goals: 0, shots: 0 };
  });

  // Initialize zones
  ['L', 'C', 'R'].forEach(z => {
    stats.own.byZone[z] = { goals: 0, shots: 0, to: 0 };
    stats.opp.byZone[z] = { goals: 0, shots: 0, to: 0 };
  });

  // Initialize 7 positions (LW, LB, CB, PV, PT, RB, RW)
  const POSITIONS = ['LW', 'LB', 'CB', 'PV', 'PT', 'RB', 'RW'];
  POSITIONS.forEach(p => {
    stats.own.byPosition[p] = { goals: 0, shots: 0, to: 0 };
    stats.opp.byPosition[p] = { goals: 0, shots: 0, to: 0 };
  });

  // Init totals
  ['total', 'first', 'second'].forEach(period => {
    ['own', 'opp'].forEach(team => {
      stats[team][period] = {
        attacks: 0, goals: 0, shots: 0, turnovers: 0,
        saves_made: 0, on_target_against: 0,
        set_attacks: 0, set_goals: 0, fb_attacks: 0, fb_goals: 0
      };
    });
  });

  const isFirstHalf = (t) => TIME_PERIODS_1ST.includes(t);

  actions.forEach(a => {
    if (a.action === 'Event') return;
    const team = a.team === 'Own' ? 'own' : 'opp';
    const otherTeam = team === 'own' ? 'opp' : 'own';
    const period = (a.half ? a.half === 1 : isFirstHalf(a.time)) ? 'first' : 'second';
    const isShotAction = SHOOT_TYPES.includes(a.action);
    const isTO = a.action === 'TO';

    // Count attacks
    stats[team].total.attacks++;
    stats[team][period].attacks++;
    if (stats[team].byTime[a.time]) stats[team].byTime[a.time].attacks++;

    // Phase
    if (a.phase === 'SetOF') {
      stats[team].total.set_attacks++;
      stats[team][period].set_attacks++;
    } else if (a.phase === 'FB+Q') {
      stats[team].total.fb_attacks++;
      stats[team][period].fb_attacks++;
    }

    if (isShotAction) {
      // Shots
      stats[team].total.shots++;
      stats[team][period].shots++;
      if (stats[team].byTime[a.time]) stats[team].byTime[a.time].shots++;
      if (stats[team].byShoot[a.action]) stats[team].byShoot[a.action].shots++;
      if (stats[team].byZone[zoneColumn(a.zone)]) stats[team].byZone[zoneColumn(a.zone)].shots++;

      // Position mapping
      const pos = a.position || mapToPosition(a.action, a.zone);
      if (pos && stats[team].byPosition[pos]) stats[team].byPosition[pos].shots++;

      if (a.result === 'Goal') {
        stats[team].total.goals++;
        stats[team][period].goals++;
        if (stats[team].byTime[a.time]) stats[team].byTime[a.time].goals++;
        if (stats[team].byShoot[a.action]) stats[team].byShoot[a.action].goals++;
        if (stats[team].byZone[zoneColumn(a.zone)]) stats[team].byZone[zoneColumn(a.zone)].goals++;
        if (pos && stats[team].byPosition[pos]) stats[team].byPosition[pos].goals++;

        if (a.phase === 'SetOF') stats[team][period].set_goals++;
        else if (a.phase === 'FB+Q') stats[team][period].fb_goals++;
        if (a.phase === 'SetOF') stats[team].total.set_goals++;
        else if (a.phase === 'FB+Q') stats[team].total.fb_goals++;
      }

      // Save by other team's GK (on target shots excluding goals = saves)
      if (a.result === 'Save') {
        stats[otherTeam].total.saves_made++;
        stats[otherTeam][period].saves_made++;
      }

      // On target (Goal + Save)
      if (a.result === 'Goal' || a.result === 'Save') {
        stats[otherTeam].total.on_target_against++;
        stats[otherTeam][period].on_target_against++;
      }
    }

    if (isTO) {
      stats[team].total.turnovers++;
      stats[team][period].turnovers++;
      if (stats[team].byTime[a.time]) stats[team].byTime[a.time].to++;
      if (stats[team].byZone[zoneColumn(a.zone)]) stats[team].byZone[zoneColumn(a.zone)].to++;
    }
  });

  return stats;
}

// ===== ダッシュボード描画 =====
function renderDashboard() {
  renderHeader();
  renderScoreboard();
  renderKPIs();
  document.querySelectorAll('#teamTabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'total'));
  renderTeamComparison('total');
  if (typeof Chart !== 'undefined') { renderTimeCharts(); renderShootTypeCharts(); }
  renderCourtDiagram();
  renderGKSection();
  renderGKHalfStats();
  renderShootingRanking();
  renderPlayerTables();
  renderTimeline();
  renderScoringFlow();
}

// ===== ヘッダー =====
function renderHeader() {
  document.getElementById('matchTitle').textContent = `${matchData.ownName}  vs  ${matchData.oppName}`;
  document.getElementById('matchDate').textContent = [matchData.date, matchData.title].filter(Boolean).join(' / ');
}

// ===== スコアボード =====
function renderScoreboard() {
  const s = matchData.stats;
  document.getElementById('ownTeamName').textContent = matchData.ownName;
  document.getElementById('oppTeamName').textContent = matchData.oppName;
  document.getElementById('ownScore').textContent = matchData.score.own;
  document.getElementById('oppScore').textContent = matchData.score.opp;

  document.getElementById('ownScoreHalves').innerHTML = `
    <span>前半: ${s.own.first.goals}</span>
    <span>後半: ${s.own.second.goals}</span>
  `;
  document.getElementById('oppScoreHalves').innerHTML = `
    <span>前半: ${s.opp.first.goals}</span>
    <span>後半: ${s.opp.second.goals}</span>
  `;
}

// ===== KPIカード =====
function renderKPIs() {
  const s = matchData.stats;
  const kpis = [
    {
      label: '攻撃成功率 (xG)',
      ownVal: pct(s.own.total.goals, s.own.total.attacks),
      oppVal: pct(s.opp.total.goals, s.opp.total.attacks),
      ownSub: `${s.own.total.goals}/${s.own.total.attacks}`,
      oppSub: `${s.opp.total.goals}/${s.opp.total.attacks}`
    },
    {
      label: 'シュート成功率 (G%)',
      ownVal: pct(s.own.total.goals, s.own.total.shots),
      oppVal: pct(s.opp.total.goals, s.opp.total.shots),
      ownSub: `${s.own.total.goals}/${s.own.total.shots}`,
      oppSub: `${s.opp.total.goals}/${s.opp.total.shots}`
    },
    {
      label: 'ターンオーバー率 (TO%)',
      ownVal: pct(s.own.total.turnovers, s.own.total.attacks),
      oppVal: pct(s.opp.total.turnovers, s.opp.total.attacks),
      ownSub: `${s.own.total.turnovers}/${s.own.total.attacks}`,
      oppSub: `${s.opp.total.turnovers}/${s.opp.total.attacks}`,
      invert: true
    },
    {
      label: 'セーブ率 (S%)',
      ownVal: pct(s.own.total.saves_made, s.own.total.on_target_against),
      oppVal: pct(s.opp.total.saves_made, s.opp.total.on_target_against),
      ownSub: `${s.own.total.saves_made}/${s.own.total.on_target_against}`,
      oppSub: `${s.opp.total.saves_made}/${s.opp.total.on_target_against}`
    }
  ];

  const grid = document.getElementById('kpiGrid');
  grid.innerHTML = '';

  kpis.forEach(kpi => {
    const ownNum = parseFloat(kpi.ownVal);
    const oppNum = parseFloat(kpi.oppVal);
    const total = ownNum + oppNum || 1;

    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.innerHTML = `
      <div class="kpi-label">${kpi.label}</div>
      <div class="kpi-values">
        <div>
          <div class="kpi-value own">${kpi.ownVal}</div>
          <div class="kpi-sub">${ScoreCore.esc(matchData.ownName)} (${kpi.ownSub})</div>
        </div>
        <div style="text-align: right;">
          <div class="kpi-value opp">${kpi.oppVal}</div>
          <div class="kpi-sub">${ScoreCore.esc(matchData.oppName)} (${kpi.oppSub})</div>
        </div>
      </div>
      <div class="kpi-bar-container">
        <div class="kpi-bar-own" style="width: ${(ownNum / total * 100).toFixed(1)}%"></div>
        <div class="kpi-bar-opp" style="width: ${(oppNum / total * 100).toFixed(1)}%"></div>
      </div>
    `;
    grid.appendChild(card);
  });
}

// ===== チーム比較パネル =====
function renderTeamComparison(period) {
  const s = matchData.stats;
  const own = s.own[period];
  const opp = s.opp[period];

  const rows = [
    { label: '攻撃回数', own: own.attacks, opp: opp.attacks },
    { label: '得点', own: own.goals, opp: opp.goals },
    { label: 'シュート数', own: own.shots, opp: opp.shots },
    { label: 'ターンオーバー', own: own.turnovers, opp: opp.turnovers },
    { label: '攻撃成功率', own: pct(own.goals, own.attacks), opp: pct(opp.goals, opp.attacks), isPct: true },
    { label: 'シュート成功率', own: pct(own.goals, own.shots), opp: pct(opp.goals, opp.shots), isPct: true },
    { label: 'TO率', own: pct(own.turnovers, own.attacks), opp: pct(opp.turnovers, opp.attacks), isPct: true },
    { label: 'セーブ率', own: pct(own.saves_made, own.on_target_against), opp: pct(opp.saves_made, opp.on_target_against), isPct: true },
    { label: 'セットOF攻撃', own: `${own.set_goals}/${own.set_attacks}`, opp: `${opp.set_goals}/${opp.set_attacks}` },
    { label: 'FB+Q攻撃', own: `${own.fb_goals}/${own.fb_attacks}`, opp: `${opp.fb_goals}/${opp.fb_attacks}` },
  ];

  const grid = document.getElementById('teamComparison');
  grid.innerHTML = `
    <div class="compare-panel own">
      <div class="compare-team-header own">🔵 ${ScoreCore.esc(matchData.ownName)}</div>
      ${rows.map(r => `
        <div class="compare-row">
          <span class="compare-label">${r.label}</span>
          <span class="compare-value">${r.own}</span>
        </div>
      `).join('')}
    </div>
    <div class="compare-panel opp">
      <div class="compare-team-header opp">🔴 ${ScoreCore.esc(matchData.oppName)}</div>
      ${rows.map(r => `
        <div class="compare-row">
          <span class="compare-label">${r.label}</span>
          <span class="compare-value">${r.opp}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ===== タブ =====
function setupTabs() {
  document.getElementById('teamTabs').addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-btn')) {
      document.querySelectorAll('#teamTabs .tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      renderTeamComparison(e.target.dataset.tab);
    }
  });
}

// ===== 時間帯別グラフ =====
function renderTimeCharts() {
  const s = matchData.stats;
  const labels = TIME_PERIODS_ALL.map(t => t.replace('~', '-'));

  // 攻撃回数
  const ownAttacks = TIME_PERIODS_ALL.map(t => s.own.byTime[t]?.attacks || 0);
  const oppAttacks = TIME_PERIODS_ALL.map(t => s.opp.byTime[t]?.attacks || 0);

  if (charts.timeAttack) charts.timeAttack.destroy();
  charts.timeAttack = new Chart(document.getElementById('timeAttackChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: matchData.ownName,
          data: ownAttacks,
          backgroundColor: 'rgba(59, 130, 246, 0.6)',
          borderColor: '#3b82f6',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: matchData.oppName,
          data: oppAttacks,
          backgroundColor: 'rgba(239, 68, 68, 0.6)',
          borderColor: '#ef4444',
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: '時間帯別 攻撃回数', font: { size: 14, weight: '600' } },
        legend: { position: 'bottom' }
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });

  // 攻撃成功率推移
  const ownXG = TIME_PERIODS_ALL.map(t => {
    const d = s.own.byTime[t];
    return d && d.attacks > 0 ? +(d.goals / d.attacks * 100).toFixed(1) : 0;
  });
  const oppXG = TIME_PERIODS_ALL.map(t => {
    const d = s.opp.byTime[t];
    return d && d.attacks > 0 ? +(d.goals / d.attacks * 100).toFixed(1) : 0;
  });

  if (charts.timeGoal) charts.timeGoal.destroy();

  // 前後半区切り線プラグイン
  const halfDividerPlugin = {
    id: 'halfDivider',
    afterDraw(chart) {
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      // 前半最後(index 5)と後半最初(index 6)の間
      const x = (xScale.getPixelForValue(5) + xScale.getPixelForValue(6)) / 2;
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.moveTo(x, yScale.top);
      ctx.lineTo(x, yScale.bottom);
      ctx.stroke();
      // ラベル
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = 'bold 10px Inter';
      ctx.textAlign = 'center';
      ctx.fillText('前半 | 後半', x, yScale.top - 6);
      ctx.restore();
    }
  };

  charts.timeGoal = new Chart(document.getElementById('timeGoalChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: matchData.ownName,
          data: ownXG,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 5,
          pointHoverRadius: 7
        },
        {
          label: matchData.oppName,
          data: oppXG,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 5,
          pointHoverRadius: 7
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: '時間帯別 攻撃成功率 (%)', font: { size: 14, weight: '600' } },
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`
          }
        }
      },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } }
      }
    },
    plugins: [halfDividerPlugin]
  });
}

// ===== シュート種別グラフ =====
function renderShootTypeCharts() {
  const s = matchData.stats;

  function makeShootChart(canvasId, teamKey, teamName, color) {
    const labels = SHOOT_TYPES.map(t => SHOOT_LABELS[t]);
    const goals = SHOOT_TYPES.map(t => s[teamKey].byShoot[t]?.goals || 0);
    const misses = SHOOT_TYPES.map(t => {
      const d = s[teamKey].byShoot[t];
      return d ? d.shots - d.goals : 0;
    });

    if (charts[canvasId]) charts[canvasId].destroy();
    charts[canvasId] = new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'ゴール',
            data: goals,
            backgroundColor: 'rgba(16, 185, 129, 0.7)',
            borderColor: '#10b981',
            borderWidth: 1,
            borderRadius: 4
          },
          {
            label: 'ミス',
            data: misses,
            backgroundColor: 'rgba(239, 68, 68, 0.4)',
            borderColor: '#ef4444',
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: `${teamName} シュート種別`, font: { size: 14, weight: '600' } },
          legend: { position: 'bottom' }
        },
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } }
        }
      }
    });
  }

  makeShootChart('shootTypeOwnChart', 'own', matchData.ownName, '#3b82f6');
  makeShootChart('shootTypeOppChart', 'opp', matchData.oppName, '#ef4444');
}

// ===== ポジションマッピング =====
function zoneColumn(zone){return (globalThis.ScoreCore?.zoneColumn?.(zone))||zone;}
// action(シュート種別) と zone(L/C/R または3×3) から6ポジションにマッピング
function mapToPosition(action, zone) {
  zone=zoneColumn(zone);
  // LW: ウイングシュート + 左ゾーン
  if (action === 'WS' && zone === 'L') return 'LW';
  // RW: ウイングシュート + 右ゾーン
  if (action === 'WS' && zone === 'R') return 'RW';
  // PV: ラインシュート or ブレイクスルー（ゴール近くのプレー）
  if (action === 'LS' || action === 'BT') return 'PV';
  // LB: ディスタンスシュート + 左ゾーン
  if (action === 'DS' && zone === 'L') return 'LB';
  // RB: ディスタンスシュート + 右ゾーン
  if (action === 'DS' && zone === 'R') return 'RB';
  // CB: ディスタンスシュート + センターゾーン
  if (action === 'DS' && zone === 'C') return 'CB';
  // PT: 7mスローは独立ポジション
  if (action === 'PT') return 'PT';
  // EG: エンプティゴールはCBに分類
  if (action === 'EG') return 'CB';
  // WS + C (稀なケース)
  if (action === 'WS' && zone === 'C') return 'CB';
  return null;
}

// ===== コート図描画 =====
function renderCourtDiagram() {
  document.getElementById('courtOwnTitle').textContent = matchData.ownName;
  document.getElementById('courtOppTitle').textContent = matchData.oppName;

  drawCourt('courtOwn', 'own');
  drawCourt('courtOpp', 'opp');
}

function drawCourt(canvasId, teamKey) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2; // Center X
  const goalY = 50;  // Goal line Y

  // Court outline
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 2;

  // Goal line
  ctx.beginPath();
  ctx.moveTo(60, goalY);
  ctx.lineTo(w - 60, goalY);
  ctx.stroke();

  // Goal
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 3;
  const goalW = 100;
  ctx.beginPath();
  ctx.moveTo(cx - goalW / 2, goalY);
  ctx.lineTo(cx - goalW / 2, goalY - 18);
  ctx.lineTo(cx + goalW / 2, goalY - 18);
  ctx.lineTo(cx + goalW / 2, goalY);
  ctx.stroke();

  // 6m line (arc)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.ellipse(cx, goalY, 140, 90, 0, 0, Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);

  // 9m line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.ellipse(cx, goalY, 190, 140, 0, 0, Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);

  // 6 Position Data
  const s = matchData.stats;
  const positions = s[teamKey].byPosition;

  // 7ポジション配置（コート上のリアルな位置を反映）
  // 攻撃側から見た配置（上がゴール方向）
  const posLayout = [
    { key: 'LW', label: '左サイド', shortLabel: 'LW', x: 35, y: goalY + 55 },
    { key: 'LB', label: '左45', shortLabel: 'LB', x: cx - 110, y: goalY + 145 },
    { key: 'CB', label: 'センター', shortLabel: 'CB', x: cx, y: goalY + 170 },
    { key: 'PV', label: 'ポスト', shortLabel: 'PV', x: cx - 55, y: goalY + 65 },
    { key: 'PT', label: '7mスロー', shortLabel: 'PT', x: cx + 55, y: goalY + 65 },
    { key: 'RB', label: '右45', shortLabel: 'RB', x: cx + 110, y: goalY + 145 },
    { key: 'RW', label: '右サイド', shortLabel: 'RW', x: w - 35, y: goalY + 55 }
  ];

  // Draw position circles
  posLayout.forEach(pos => {
    const d = positions[pos.key];
    if (!d) return;

    const rate = d.shots > 0 ? d.goals / d.shots : 0;
    const shotCount = d.shots;

    // Circle size based on shot count (larger = more shots)
    const radius = shotCount > 0 ? Math.max(20, Math.min(45, 12 + shotCount * 3)) : 16;
    // Alpha based on success rate (brighter = higher rate)
    const alpha = shotCount > 0 ? Math.max(0.25, Math.min(0.85, rate * 0.9 + 0.15)) : 0.12;

    // Glow effect
    if (shotCount > 0) {
      ctx.shadowBlur = 15;
      ctx.shadowColor = teamKey === 'own'
        ? `rgba(59, 130, 246, ${alpha * 0.6})`
        : `rgba(239, 68, 68, ${alpha * 0.6})`;
    }

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = teamKey === 'own'
      ? `rgba(59, 130, 246, ${alpha})`
      : `rgba(239, 68, 68, ${alpha})`;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = teamKey === 'own' ? '#60a5fa' : '#f87171';
    ctx.lineWidth = shotCount > 0 ? 2 : 1;
    ctx.stroke();

    // Text: goals/shots
    ctx.fillStyle = '#f0f4ff';
    ctx.font = 'bold 14px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (shotCount > 0) {
      ctx.fillText(`${d.goals}/${d.shots}`, pos.x, pos.y - 6);
      // Success rate
      ctx.font = '11px Inter';
      ctx.fillStyle = getColorForRate(rate);
      ctx.fillText(pct(d.goals, d.shots), pos.x, pos.y + 10);
    } else {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px Inter';
      ctx.fillText('0/0', pos.x, pos.y);
    }

    // Position label below circle
    ctx.font = 'bold 10px Inter';
    ctx.fillStyle = '#94a3b8';
    ctx.textBaseline = 'top';
    ctx.fillText(pos.label, pos.x, pos.y + radius + 4);
    ctx.font = '9px JetBrains Mono';
    ctx.fillStyle = '#64748b';
    ctx.fillText(pos.shortLabel, pos.x, pos.y + radius + 18);
    ctx.textBaseline = 'alphabetic';
  });

  // Connecting lines (formation shape)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  const order = ['LW', 'LB', 'CB', 'RB', 'RW'];
  for (let i = 0; i < order.length - 1; i++) {
    const a = posLayout.find(p => p.key === order[i]);
    const b = posLayout.find(p => p.key === order[i + 1]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // PV to LB and RB
  const pvPos = posLayout.find(p => p.key === 'PV');
  const lbPos = posLayout.find(p => p.key === 'LB');
  const rbPos = posLayout.find(p => p.key === 'RB');
  ctx.beginPath();
  ctx.moveTo(lbPos.x, lbPos.y);
  ctx.lineTo(pvPos.x, pvPos.y);
  ctx.lineTo(rbPos.x, rbPos.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Summary table at the bottom
  const tableY = h - 85;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.fillRect(15, tableY - 8, w - 30, 80);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(15, tableY - 8, w - 30, 80);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 11px Inter';
  ctx.textAlign = 'center';
  ctx.fillText('ポジション別サマリー', cx, tableY + 5);

  const cols = posLayout;
  const colW = (w - 40) / cols.length;
  ctx.font = '10px JetBrains Mono';
  cols.forEach((pos, i) => {
    const d = positions[pos.key] || { goals: 0, shots: 0 };
    const colX = 20 + colW * i + colW / 2;
    const rate = d.shots > 0 ? d.goals / d.shots : 0;

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 10px Inter';
    ctx.fillText(pos.shortLabel, colX, tableY + 22);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px JetBrains Mono';
    ctx.fillText(`${d.goals}/${d.shots}`, colX, tableY + 40);

    ctx.fillStyle = d.shots > 0 ? getColorForRate(rate) : '#475569';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(d.shots > 0 ? pct(d.goals, d.shots) : '-', colX, tableY + 55);
  });
}

// ===== GK分析 =====
function renderGKSection() {
  const container = document.getElementById('gkSection');
  if (!matchData.personal) {
    container.innerHTML = '<p style="color: var(--text-muted);">GKデータなし</p>';
    return;
  }

  function makeGKCard(gkList, subtotal, className, teamName) {
    if (!gkList || gkList.length === 0) return '';

    return gkList.map(gk => {
      const types = ['ds', 'ls', 'ws', 'bt', 'eg', 'pt', 'un'];
      const typeLabels = { ds: 'DS', ls: 'LS', ws: 'WS', bt: 'BT', eg: 'EG', pt: 'PT', un: '未指定' };

      return `
        <div class="gk-card ${className}">
          <div class="gk-name">${ScoreCore.esc(teamName)} GK</div>
          <div class="gk-number">#${gk.no} ${ScoreCore.esc(gk.name)}</div>
          ${types.map(t => {
        const d = gk[t];
        const rate = d.shots > 0 ? (d.goals / d.shots * 100).toFixed(0) : '-';
        const color = d.shots > 0 ? getColorForRate(d.goals / d.shots) : '#64748b';
        return `
              <div class="gk-stat-row">
                <span class="gk-stat-label">${typeLabels[t]}</span>
                <div class="gk-stat-values">
                  <span class="gk-stat-fraction">${d.goals}/${d.shots}</span>
                  <span class="gk-stat-pct" style="color: ${color}">${rate}%</span>
                </div>
              </div>
            `;
      }).join('')}
          <div class="gk-total">
            <span class="gk-total-label">総セーブ率</span>
            <span class="gk-total-value" style="color: ${getColorForRate(gk.total.rate || 0)}">
              ${gk.total.rate != null ? (gk.total.rate * 100).toFixed(1) : '-'}%
            </span>
          </div>
          <div style="color: var(--text-muted); font-size: 0.75rem; text-align: right; margin-top: 4px;">
            ${gk.total.goals}/${gk.total.shots} (Out: ${gk.out || 0}, Block: ${gk.block || 0})
          </div>
        </div>
      `;
    }).join('');
  }

  container.innerHTML =
    makeGKCard(matchData.personal.own_gk, matchData.personal.own_gk_subtotal, 'own', matchData.ownName) +
    makeGKCard(matchData.personal.opp_gk, matchData.personal.opp_gk_subtotal, 'opp', matchData.oppName);
}

// ===== GKセーブ率 前後半内訳 =====
function renderGKHalfStats() {
  const container = document.getElementById('gkHalfStats');
  if (!container) return;
  const stats = matchData.stats;

  function makeHalfRow(label, data) {
    const saves = data.saves_made || 0;
    const onTarget = data.on_target_against || 0;
    const rate = onTarget > 0 ? (saves / onTarget * 100).toFixed(1) : '-';
    const color = onTarget > 0 ? getColorForRate(saves / onTarget) : '#64748b';
    return `<div style="display:flex; justify-content:space-between; align-items:center; padding: 4px 0; font-size: 0.85rem;">
      <span style="color: var(--text-muted);">${label}</span>
      <span style="font-weight:600; color:${color}">${saves}/${onTarget} (${rate}%)</span>
    </div>`;
  }

  container.innerHTML = `
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px;">
      <div class="chart-card" style="padding:12px;">
        <div style="font-weight:600; color:#60a5fa; margin-bottom:6px; font-size:0.85rem;">${ScoreCore.esc(matchData.ownName)} GK セーブ率 前後半</div>
        ${makeHalfRow('前半', stats.own.first)}
        ${makeHalfRow('後半', stats.own.second)}
        ${makeHalfRow('合計', stats.own.total)}
      </div>
      <div class="chart-card" style="padding:12px;">
        <div style="font-weight:600; color:#f87171; margin-bottom:6px; font-size:0.85rem;">${ScoreCore.esc(matchData.oppName)} GK セーブ率 前後半</div>
        ${makeHalfRow('前半', stats.opp.first)}
        ${makeHalfRow('後半', stats.opp.second)}
        ${makeHalfRow('合計', stats.opp.total)}
      </div>
    </div>
  `;
}

// ===== 選手別シュート成功率ランキング =====
function renderShootingRanking() {
  if (!matchData.personal) return;

  function buildRankingTable(containerId, players, teamName, teamColor) {
    const container = document.getElementById(containerId);
    if (!players || players.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);">データなし</p>';
      return;
    }

    const ranked = players
      .filter(p => p.total.shots > 0)
      .sort((a, b) => (b.total.rate || 0) - (a.total.rate || 0));

    if (ranked.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);">データなし</p>';
      return;
    }

    let html = `<div style="font-weight:600; color:${teamColor}; margin-bottom:8px; font-size:0.9rem;">${ScoreCore.esc(teamName)}</div>`;
    html += `<table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
      <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
        <th style="text-align:left; padding:4px 6px; color:var(--text-muted); font-weight:500;">No.</th>
        <th style="text-align:left; padding:4px 6px; color:var(--text-muted); font-weight:500;">名前</th>
        <th style="text-align:center; padding:4px 6px; color:var(--text-muted); font-weight:500;">G/S</th>
        <th style="text-align:right; padding:4px 6px; color:var(--text-muted); font-weight:500;">成功率</th>
      </tr></thead><tbody>`;

    ranked.forEach(p => {
      const rate = (p.total.rate || 0) * 100;
      const rateStr = rate > 0 ? rate.toFixed(1) + '%' : '-';
      const color = rate >= 60 ? '#4ade80' : rate >= 40 ? '#fbbf24' : rate > 0 ? '#f87171' : 'var(--text-muted)';
      html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
        <td style="padding:5px 6px; font-weight:600;">#${p.no}</td>
        <td style="padding:5px 6px;">${ScoreCore.esc(p.name || '')}</td>
        <td style="padding:5px 6px; text-align:center; font-family:'JetBrains Mono',monospace;">${p.total.goals}/${p.total.shots}</td>
        <td style="padding:5px 6px; text-align:right; font-weight:700; color:${color}; font-family:'JetBrains Mono',monospace;">${rateStr}</td>
      </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  buildRankingTable('rankOwnCard', matchData.personal.own_shooters, matchData.ownName, '#60a5fa');
  buildRankingTable('rankOppCard', matchData.personal.opp_shooters, matchData.oppName, '#f87171');
}

// ===== 選手個人テーブル =====
function renderPlayerTables() {
  if (!matchData.personal) return;

  buildPlayerTable('ownPlayerTable', matchData.personal.own_shooters, matchData.personal.own_shoot_subtotal, true);
  buildPlayerTable('oppPlayerTable', matchData.personal.opp_shooters, matchData.personal.opp_shoot_subtotal, true);
}

function buildPlayerTable(tableId, players, subtotal, showTO) {
  const table = document.getElementById(tableId);
  if (!players || players.length === 0) {
    table.innerHTML = '<tr><td style="padding: 20px; color: var(--text-muted);">データなし</td></tr>';
    return;
  }

  const types = ['ds', 'ls', 'ws', 'bt', 'eg', 'pt', 'un'];
  const typeLabels = { ds: 'DS', ls: 'LS', ws: 'WS', bt: 'BT', eg: 'EG', pt: 'PT', un: '未指定' };

  let html = `
    <thead>
      <tr>
        <th>No.</th>
        <th>名前</th>
        ${types.map(t => `<th class="group-header">${typeLabels[t]}</th>`).join('')}
        <th class="group-header">合計</th>
        <th>成功率</th>
        ${showTO ? '<th>OUT</th><th>BLK</th><th>TM</th><th>VL</th><th>TO計</th>' : ''}
      </tr>
    </thead>
    <tbody>
  `;

  const allRows = [...players];
  if (subtotal) allRows.push({ ...subtotal, no: '', name: '小計', isSubtotal: true });

  allRows.forEach(p => {
    const rowClass = p.isSubtotal ? 'subtotal-row' : '';
    const rate = p.total.rate;
    const rateClass = rate >= 0.6 ? 'highlight-good' : rate >= 0.4 ? 'highlight-avg' : rate > 0 ? 'highlight-bad' : '';

    html += `<tr class="${rowClass}">
      <td>${p.no || ''}</td>
      <td class="name-cell">${ScoreCore.esc(p.name || '')}</td>
      ${types.map(t => {
      const d = p[t];
      return `<td>${d.goals}/${d.shots}</td>`;
    }).join('')}
      <td><strong>${p.total.goals}/${p.total.shots}</strong></td>
      <td class="${rateClass}">${rate != null && rate > 0 ? (rate * 100).toFixed(1) + '%' : '-'}</td>
      ${showTO ? `
        <td>${p.out || 0}</td>
        <td>${p.block || 0}</td>
        <td>${p.tm || 0}</td>
        <td>${p.vl || 0}</td>
        <td>${p.to_total || 0}</td>
      ` : ''}
    </tr>`;
  });

  html += '</tbody>';
  table.innerHTML = html;
}

// ===== タイムライン =====
// ===== 用語定義データ =====
const GLOSSARY = [
  { term: 'DS', desc: 'ロング、ミドルシュート' },
  { term: 'LS', desc: 'WSとBT以外のライン際のシュート' },
  { term: 'WS', desc: 'サイドシュート' },
  { term: 'BT', desc: 'カットイン、カットアウト（フェイント）' },
  { term: 'EG', desc: 'エンプティゴール' },
  { term: 'PT', desc: '7mスロー' },
  { term: 'Out', desc: '枠外シュート（バーも含む）' },
  { term: 'TM', desc: 'パス・キャッチ・ドリブルミス等' },
  { term: 'VL', desc: '反則（ラインクロス、オーバーステップ等）' }

];

function renderTimeline() {
  const container = document.getElementById('timelineContainer');
  const filtersEl = document.getElementById('timelineFilters');

  // Filters
  const filterOptions = [
    { key: 'all', label: '全て' },
    { key: 'own', label: matchData.ownName },
    { key: 'opp', label: matchData.oppName },
    { key: 'goal', label: 'ゴール' },
    { key: 'to', label: 'TO' },
    { key: 'glossary', label: '用語の定義' }
  ];

  filtersEl.innerHTML = filterOptions.map((f, i) =>
    `<button class="timeline-filter-btn ${i === 0 ? 'active' : ''}" data-filter="${f.key}">${ScoreCore.esc(f.label)}</button>`
  ).join('');

  filtersEl.onclick = (e) => {
    if (e.target.classList.contains('timeline-filter-btn')) {
      filtersEl.querySelectorAll('.timeline-filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const filter = e.target.dataset.filter;
      if (filter === 'glossary') {
        renderGlossary();
      } else {
        renderTimelineItems(filter);
      }
    }
  };

  renderTimelineItems('all');
}

function renderGlossary() {
  const container = document.getElementById('timelineContainer');
  container.innerHTML = `
    <div class="glossary-panel">
      <h3 class="glossary-title">📖 用語の定義</h3>
      <div class="glossary-grid">
        ${GLOSSARY.map(g => `
          <div class="glossary-item">
            <span class="glossary-term">${g.term}</span>
            <span class="glossary-desc">${g.desc}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderTimelineItems(filter) {
  const container = document.getElementById('timelineContainer');
  // Keep filter buttons
  let actions = matchData.actions;

  if (filter === 'own') actions = actions.filter(a => a.team === 'Own');
  else if (filter === 'opp') actions = actions.filter(a => a.team === 'Opp');
  else if (filter === 'goal') actions = actions.filter(a => a.result === 'Goal');
  else if (filter === 'to') actions = actions.filter(a => a.action === 'TO');

  // Short action labels
  const ACTION_SHORT = {
    DS: 'ロング・ミドル', LS: 'ライン際シュート', WS: 'サイドシュート',
    BT: 'カットイン・アウト', EG: 'エンプティ', PT: '7mスロー', UN: '未指定', Event: '試合記録', TO: 'ターンオーバー'
  };
  // Short result labels
  const RESULT_SHORT = {
    Goal: 'GOAL', Save: 'SAVE', Out: '枠外', Block: 'BLOCK', TM: 'ミス', VL: '反則', Yellow: '警告', Suspension: '2分退場', Red: '失格', Timeout: 'タイムアウト'
  };

  // Running score
  let ownScore = 0, oppScore = 0;
  let lastTime = '';

  let html = `
    <div class="timeline-header">
      <span class="timeline-time">時間</span>
      <span class="timeline-team">チーム</span>
      <span class="timeline-no">背番</span>
      <span class="timeline-phase">場面</span>
      <span class="timeline-action">種類</span>
      <span class="timeline-zone">場所</span>
      <span class="timeline-result">結果</span>
      <span class="timeline-score"></span>
    </div>
  `;
  matchData.actions.forEach((a, idx) => {
    if (a.result === 'Goal' && a.team === 'Own') ownScore++;
    if (a.result === 'Goal' && a.team === 'Opp') oppScore++;

    // Check if this action is in filtered list
    if (!actions.includes(a)) return;

    // Period separator
    if (a.time !== lastTime) {
      if (lastTime !== '' && isNewHalf(lastTime, a.time)) {
        html += `<div class="period-separator">後半開始</div>`;
      }
      lastTime = a.time;
    }

    const teamClass = a.team === 'Own' ? 'own' : 'opp';
    const teamLabel = a.team === 'Own' ? matchData.ownName.slice(0, 3) : matchData.oppName.slice(0, 3);
    const resultClass = a.result ? a.result.toLowerCase() : '';

    // Action with short Japanese label
    const actionLabel = a.action && ACTION_SHORT[a.action]
      ? `${ACTION_SHORT[a.action]}（${a.action}）`
      : (a.action || '');
    // Result with short Japanese label
    const resultLabel = a.result && RESULT_SHORT[a.result]
      ? RESULT_SHORT[a.result]
      : (a.result || '');

    html += `
      <div class="timeline-item ${teamClass}">
        <span class="timeline-time">${a.time}</span>
        <span class="timeline-team ${teamClass}">${ScoreCore.esc(teamLabel)}</span>
        <span class="timeline-no">#${a.no || ''}</span>
        <span class="timeline-phase ${a.phase === 'FB+Q' ? 'fb-highlight' : ''}">${a.phase || ''}</span>
        <span class="timeline-action">${actionLabel}</span>
        <span class="timeline-zone">${[a.position ? ScoreCore.POSITION_LABELS[a.position] : '', a.zone ? ScoreCore.ZONE_LABELS[a.zone] || a.zone : ''].filter(Boolean).join('・')}</span>
        <span class="timeline-result ${resultClass}">${resultLabel}</span>
        <span class="timeline-score">${ownScore} - ${oppScore}</span>
      </div>
    `;
  });

  container.innerHTML = html;
}

function isNewHalf(prev, curr) {
  const firstHalf = TIME_PERIODS_1ST;
  return firstHalf.includes(prev) && !firstHalf.includes(curr);
}

// ===== ユーティリティ =====
function pct(a, b) {
  if (!b || b === 0) return '0.0%';
  return (a / b * 100).toFixed(1) + '%';
}

function getColorForRate(rate) {
  if (rate >= 0.7) return '#10b981';
  if (rate >= 0.5) return '#34d399';
  if (rate >= 0.3) return '#f59e0b';
  return '#ef4444';
}

// ===== 得点の流れ =====
function renderScoringFlow() {
  const canvas = document.getElementById('scoringFlowCanvas');
  const ctx = canvas.getContext('2d');

  const goals = matchData.actions.filter(a => a.result === 'Goal').map(a => ({
    half: a.half || (TIME_PERIODS_1ST.includes(a.time) ? 1 : 2),
    team: a.team === 'Own' ? 'a' : 'b', no: a.no ?? '—',
    time: a.seconds == null ? a.time : ScoreCore.clockText(a.seconds)
  }));
  const halfBreakIndex = goals.findIndex(g => g.half === 2);

  // Layout
  const pad = { left: 60, right: 60, top: 28, bottom: 14 };
  const slotW = 44;
  const radius = 13;

  // Canvas size
  const neededW = pad.left + (goals.length + 2) * slotW + pad.right;
  const containerW = canvas.parentElement.clientWidth;
  canvas.width = Math.max(neededW, containerW);
  canvas.height = 160;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const midY = h / 2;
  const aRowY = midY - 30; // Team A row (above center)
  const bRowY = midY + 30; // Team B row (below center)

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.fillRect(0, 0, w, h);

  // Center divider line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad.left - 10, midY);
  ctx.lineTo(w - pad.right + 10, midY);
  ctx.stroke();

  // Team labels on the left
  ctx.font = 'bold 13px "Noto Sans JP"';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#60a5fa';
  ctx.fillText(matchData.ownName || '自チーム', pad.left - 14, aRowY);
  ctx.fillStyle = '#f87171';
  ctx.fillText(matchData.oppName || '相手チーム', pad.left - 14, bRowY);

  // 5-minute time markers at top
  ctx.font = '9px JetBrains Mono';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  goals.forEach((g, i) => {
    const x = pad.left + (i + 0.5) * slotW;
    const mins = parseInt(g.time.split(':')[0]);
    // Show time label every 5 minutes or at first goal of each half
    if (i === 0 || i === halfBreakIndex || (i > 0 && parseInt(goals[i - 1].time.split(':')[0]) < mins && mins % 5 === 0)) {
      ctx.fillText((g.half === 2 ? '後' : '') + g.time, x, 2);
    }
  });

  let aCount = 0, bCount = 0;

  // Pre-compute positions for connecting lines
  const positions = goals.map((g, i) => {
    const x = pad.left + (i + 0.5) * slotW;
    const y = g.team === 'a' ? aRowY : bRowY;
    return { x, y, team: g.team };
  });

  // Draw connecting lines FIRST (behind circles)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.5;
  for (let i = 1; i < positions.length; i++) {
    // Don't connect across halftime
    if (i === halfBreakIndex) continue;
    ctx.beginPath();
    ctx.moveTo(positions[i - 1].x, positions[i - 1].y);
    ctx.lineTo(positions[i].x, positions[i].y);
    ctx.stroke();
  }

  // Draw half break divider
  if (halfBreakIndex > 0) {
    const divX = pad.left + halfBreakIndex * slotW - 6;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(divX, pad.top - 14);
    ctx.lineTo(divX, h - 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = 'bold 9px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('HT', divX, h - 1);
    ctx.restore();
  }

  // Draw circles and labels
  goals.forEach((g, i) => {
    const x = pad.left + (i + 0.5) * slotW;
    const isA = g.team === 'a';
    const cy = isA ? aRowY : bRowY;

    if (isA) aCount++; else bCount++;
    const count = isA ? aCount : bCount;
    const color = isA ? '#3b82f6' : '#ef4444';
    const lightColor = isA ? '#60a5fa' : '#f87171';

    // Circle background
    ctx.beginPath();
    ctx.arc(x, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fill();

    // Circle border
    ctx.beginPath();
    ctx.arc(x, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = lightColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Score number inside circle
    ctx.fillStyle = lightColor;
    ctx.font = 'bold 11px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(count, x, cy);

    // Jersey number above (A) or below (B)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '7px JetBrains Mono';
    ctx.textAlign = 'center';
    if (isA) {
      ctx.textBaseline = 'bottom';
      ctx.fillText('#' + g.no, x, cy - radius - 2);
    } else {
      ctx.textBaseline = 'top';
      ctx.fillText('#' + g.no, x, cy + radius + 2);
    }
  });

  // Final score on the right
  const lastX = pad.left + (goals.length + 0.5) * slotW + 10;
  ctx.font = 'bold 18px JetBrains Mono';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#60a5fa';
  ctx.fillText(aCount, lastX, aRowY);
  ctx.fillStyle = '#f87171';
  ctx.fillText(bCount, lastX + 2, bRowY);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.font = 'bold 14px Inter';
  ctx.fillText('-', lastX + 5, midY);

  // Direction indicator
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.font = '9px Inter';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('試合進行 →', w - 10, h - 1);
}
