(function(){
  const socket = io({ query: { role: 'presentation' } });

  socket.on('server_now', (payload)=>{
    try {
      const offset = (payload && typeof payload.now === 'number' ? payload.now : Date.now()) - Date.now();
      window.__getServerNow = ()=> Date.now() + offset;
    } catch (e) {}
  });

  const serverNow = ()=> (window.__getServerNow ? window.__getServerNow() : Date.now());

  const phaseLabel = document.getElementById('phaseLabel');
  const roundNumberEl = document.getElementById('roundNumber');
  const roundTotalEl = document.getElementById('roundTotal');
  const roundsLeftValue = document.getElementById('roundsLeftValue');
  const statusChip = document.getElementById('statusChip');
  const timerEl = document.getElementById('mainTimer');
  const leaderboardBody = document.getElementById('leaderboardBody');
  const historyList = document.getElementById('historyList');
  const activeWrap = document.getElementById('activeSummary');
  const activeTitle = document.getElementById('activeTitle');
  const activeCards = document.getElementById('activeCards');
  const marquee = document.getElementById('winnerMarquee');

  const escapeHtml = (str='')=> String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  let timerMode = 'idle';
  let countdownStart = 0;
  let countdownDuration = 0;
  let activeStart = 0;
  let rafHandle = null;

  function formatCountdown(ms){
    const sec = Math.max(0, ms) / 1000;
    const whole = Math.floor(sec);
    const tenths = Math.floor((sec - whole) * 10);
    return `${String(whole).padStart(2,'0')}.${tenths}`;
  }

  function formatElapsed(ms){
    const total = Math.max(0, ms);
    const m = Math.floor(total / 60000);
    const s = Math.floor((total % 60000) / 1000);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function formatMsShort(ms){
    const s = Math.floor(Math.max(0, ms) / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m ${String(sec).padStart(2,'0')}s`;
  }

  function pumpTimer(){
    rafHandle = null;
    let display = '00:00';
    if (timerMode === 'countdown'){
      const remain = Math.max(0, countdownDuration - (serverNow() - countdownStart));
      display = formatCountdown(remain);
      if (remain > 0){ rafHandle = requestAnimationFrame(pumpTimer); }
    } else if (timerMode === 'active'){
      const elapsed = Math.max(0, serverNow() - activeStart);
      display = formatElapsed(elapsed);
      rafHandle = requestAnimationFrame(pumpTimer);
    }
    timerEl.textContent = display;
  }

  function setTimerMode(mode){
    timerMode = mode;
    if (rafHandle){ cancelAnimationFrame(rafHandle); rafHandle = null; }
    pumpTimer();
  }

  function renderLeaderboard(rows){
    if (!rows || !rows.length){
      leaderboardBody.innerHTML = '<tr><td colspan="4" class="history-empty">No players yet</td></tr>';
      return;
    }
    const html = rows.map(r=>{
      const rsw = r.roundsSinceWin == null ? '—' : r.roundsSinceWin;
      return `<tr><td class="rank">${r.rank}</td><td>${escapeHtml(r.name)}</td><td class="score">🏆 ${r.tokens}</td><td>${rsw}</td></tr>`;
    }).join('');
    leaderboardBody.innerHTML = html;
  }

  function renderHistory(entries){
    if (!entries || !entries.length){
      historyList.innerHTML = '<div class="history-empty">No rounds played yet.</div>';
      return;
    }
    const html = entries.map(h=>{
      const winner = h.winnerName ? escapeHtml(h.winnerName) : '—';
      const held = formatMsShort(h.winnerMs || 0);
      return `<div class="history-entry"><strong>Round ${h.round}</strong><div class="winner">${winner}</div><div>${held}</div><div>🏆 ${h.winnerTokens || 0}</div></div>`;
    }).join('');
    historyList.innerHTML = html;
  }

  function renderActiveSummary(summary, label){
    if (!summary || !summary.rows || !summary.rows.length){
      activeWrap.hidden = true;
      activeCards.innerHTML = '';
      return;
    }
    activeTitle.textContent = label;
    const html = summary.rows.map(row=>{
      return `<div class="active-card"><div class="name">${escapeHtml(row.name)}</div><div class="meta"><span>${formatMsShort(row.heldMs || 0)}</span><span>${escapeHtml(row.status || '')}</span></div></div>`;
    }).join('');
    activeCards.innerHTML = html;
    activeWrap.hidden = false;
  }

  let marqueeTimer = null;
  let lastWinnerRound = null;
  function showWinner(result){
    if (!marquee) return;
    if (!result) return;
    const round = result.round;
    let text;
    if (result.winner){
      text = `Round ${round} Winner · ${result.winner} · 🏆 ${result.winnerTokens || 0}`;
    } else {
      text = `Round ${round} · No winner this time`;
    }
    marquee.textContent = text;
    marquee.classList.remove('show');
    // force reflow for restart animation
    void marquee.offsetWidth;
    marquee.classList.add('show');
    if (marqueeTimer){ clearTimeout(marqueeTimer); }
    marqueeTimer = setTimeout(()=> marquee.classList.remove('show'), 8000);
    lastWinnerRound = round;
  }

  socket.on('round_result', (result)=>{
    showWinner(result);
  });

  socket.on('presentation_state', (payload)=>{
    try {
      const phase = payload.phase || 'idle';
      phaseLabel.textContent = phase.toUpperCase();
      roundNumberEl.textContent = payload.currentRound || 0;
      roundTotalEl.textContent = payload.totalRounds || 0;
      roundsLeftValue.textContent = payload.roundsRemaining != null ? payload.roundsRemaining : Math.max(0, (payload.totalRounds || 0) - (payload.currentRound || 0));
      statusChip.textContent = phase === 'active' ? 'Round live' : phase === 'countdown' ? 'Countdown locked' : phase === 'arming' ? 'Arming players' : 'Waiting for host…';

      if (phase === 'countdown' && payload.countdown){
        countdownStart = payload.countdown.startTs || serverNow();
        countdownDuration = payload.countdown.durationMs || 0;
        setTimerMode('countdown');
      } else if (phase === 'active'){
        activeStart = serverNow() - (payload.roundElapsedMs || 0);
        setTimerMode('active');
      } else {
        setTimerMode('idle');
      }

      renderLeaderboard(payload.scoreboard && payload.scoreboard.rows);
      renderHistory(payload.history);

      if (payload.activeSummary){
        renderActiveSummary(payload.activeSummary, `Round ${payload.activeSummary.round}`);
      } else if (payload.recapSummary){
        renderActiveSummary(payload.recapSummary, `Round ${payload.recapSummary.round} Recap`);
      } else {
        renderActiveSummary(null);
      }

      if (payload.latestHistory && payload.latestHistory.round && payload.latestHistory.round !== lastWinnerRound){
        const latest = payload.latestHistory;
        showWinner({
          round: latest.round,
          winner: latest.winnerName,
          winnerTokens: latest.winnerTokens
        });
      }
    } catch (e) {
      console.error(e);
    }
  });
})();
