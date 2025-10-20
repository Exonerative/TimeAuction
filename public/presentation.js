(function(){
  const socket = io({ query: { role: 'presentation' } });
  socket.on('server_now', (d)=>{
    try{
      const offset = (d && typeof d.now === 'number' ? d.now : Date.now()) - Date.now();
      window.__getServerNow = ()=> Date.now() + offset;
    }catch(e){}
  });
  const serverNow = ()=> (window.__getServerNow ? window.__getServerNow() : Date.now());

  const phaseLabel = document.getElementById('phaseLabel');
  const roundInfo = document.getElementById('roundInfo');
  const timerLabel = document.getElementById('timerLabel');
  const timerValue = document.getElementById('timerValue');
  const timerSub = document.getElementById('timerSub');
  const timerCard = document.querySelector('.timer-card');
  const statusBanner = document.getElementById('statusBanner');
  const audioToggle = document.getElementById('audioToggle');
  const nextReadySummary = document.getElementById('nextReadySummary');
  const nextReadyCountdown = document.getElementById('nextReadyCountdown');
  const scoreboardList = document.getElementById('scoreboardList');
  const scoreboardEmpty = document.getElementById('scoreboardEmpty');
  const historyList = document.getElementById('historyList');
  const historyEmpty = document.getElementById('historyEmpty');
  const winnerSpotlight = document.getElementById('winnerSpotlight');
  const spotlightTitle = document.getElementById('spotlightTitle');
  const spotlightWinnerName = document.getElementById('spotlightWinnerName');
  const spotlightTokens = document.getElementById('spotlightTokens');
  const spotlightHold = document.getElementById('spotlightHold');
  const spotlightRound = document.getElementById('spotlightRound');
  const spotlightFooter = document.getElementById('spotlightFooter');
  const confettiContainer = winnerSpotlight ? winnerSpotlight.querySelector('.spotlight-confetti') : null;

  const MAX_HISTORY = 4;
  const MAX_SCOREBOARD_ROWS = 5;
  let latestState = { scoreboard: [], history: [], scoreboardVisible: true, lastWinnerName: '', lastWinnerTokens: null, lastWinnerMs: null, lastWinnerRound: null };
  let timerInterval = null;
  let statusHoldUntil = 0;
  let currentTimerPhaseClass = '';
  let phaseTransitionTimeout = null;
  let lastPhaseForAudio = '';
  let winnerSpotlightTimer = null;
  let audioManager = null;
  let statusTone = 'default';
  let lastNoHoldRound = null;

  function pad(value){ return String(value).padStart(2, '0'); }
  function formatClock(ms){
    if (!Number.isFinite(ms)) return '00:00';
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${pad(minutes)}:${pad(secs)}`;
  }
  function formatMs(ms){
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const seconds = (ms / 1000).toFixed(1);
    return `${seconds.replace(/\.0$/, '')}s`;
  }
  function computeDefaultStatus(){
    if (!latestState.started) return 'Waiting for host…';
    const round = latestState.currentRound || 0;
    if (latestState.phase === 'arming'){
      return `Arming players for round ${Math.max(round, 1)}`;
    }
    if (latestState.phase === 'countdown'){
      return `Round ${Math.max(round, 1)} countdown in progress`;
    }
    if (latestState.phase === 'active'){
      return `Round ${round || '?'} in progress`;
    }
    if (latestState.phase === 'idle' && latestState.started){
      if (latestState.currentRound >= (latestState.totalRounds || 0) && latestState.totalRounds){
        return 'Game complete — awaiting new match';
      }
      return 'Between rounds';
    }
    return 'Standing by…';
  }
  function setStatusTone(tone){
    statusTone = tone || 'default';
    if (!statusBanner) return;
    statusBanner.classList.toggle('danger', statusTone === 'danger');
  }
  function showStatus(text, ttlMs){
    if (!statusBanner) return;
    setStatusTone(statusTone);
    if (!text){
      setStatusTone('default');
      statusHoldUntil = 0;
      statusBanner.textContent = computeDefaultStatus();
      statusBanner.classList.remove('hidden');
      statusBanner.classList.remove('flash');
      return;
    }
    statusBanner.textContent = text;
    statusBanner.classList.remove('hidden');
    statusBanner.classList.remove('flash');
    void statusBanner.offsetWidth; // restart animation
    statusBanner.classList.add('flash');
    setTimeout(()=> statusBanner.classList.remove('flash'), 1600);
    if (timerInterval == null) startTimer();
    if (!ttlMs || ttlMs <= 0){
      statusHoldUntil = 0;
      return;
    }
    statusHoldUntil = Date.now() + ttlMs;
    setTimeout(()=>{
      if (!statusHoldUntil || Date.now() >= statusHoldUntil){
        statusHoldUntil = 0;
        maybeResetStatus();
      }
    }, ttlMs + 50);
  }
  function maybeResetStatus(){
    if (!statusBanner) return;
    if (statusHoldUntil && Date.now() < statusHoldUntil) return;
    setStatusTone('default');
    const text = computeDefaultStatus();
    statusBanner.textContent = text;
    statusBanner.classList.toggle('hidden', !text);
    statusBanner.classList.remove('flash');
  }

  function applyTimerPhaseClass(phase){
    if (!timerCard) return;
    const next = phase ? `phase-${phase}` : 'phase-idle';
    if (currentTimerPhaseClass === next) return;
    if (currentTimerPhaseClass){
      timerCard.classList.remove(currentTimerPhaseClass);
    }
    timerCard.classList.add(next);
    timerCard.classList.add('phase-transition');
    if (phaseTransitionTimeout){
      clearTimeout(phaseTransitionTimeout);
    }
    phaseTransitionTimeout = setTimeout(()=> timerCard.classList.remove('phase-transition'), 680);
    currentTimerPhaseClass = next;
    if (audioManager && typeof audioManager.play === 'function'){
      if (lastPhaseForAudio !== next){
        if (phase === 'countdown') audioManager.play('countdown');
        else if (phase === 'active') audioManager.play('active');
      }
    }
    lastPhaseForAudio = next;
  }

  function startTimer(){
    if (timerInterval) return;
    timerInterval = setInterval(updateTimers, 200);
  }
  function stopTimer(){
    if (!timerInterval) return;
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function updateTimers(){
    const now = serverNow();
    let mainLabel = 'Timer';
    let mainValue = '00:00';
    let sub = '—';
    const state = latestState || {};
    const phase = state.phase || 'idle';
    applyTimerPhaseClass(state.started ? phase : 'idle');
    if (!state.started){
      mainLabel = 'Awaiting start';
      mainValue = '00:00';
      sub = 'Waiting for host';
    } else if (phase === 'countdown' && state.countdown){
      const end = (state.countdown.startTs||0) + (state.countdown.durationMs||0);
      const remaining = Math.max(0, end - now);
      mainLabel = 'Round countdown';
      mainValue = formatClock(remaining);
      sub = `Round ${Math.max(state.currentRound || 1, 1)} begins soon`;
    } else if (phase === 'active' && state.roundTimer){
      const elapsed = Math.max(0, now - (state.roundTimer.startTs||0));
      mainLabel = 'Round in progress';
      mainValue = formatClock(elapsed);
      sub = `Round ${state.currentRound || '?'} active`;
    } else if (phase === 'arming'){
      mainLabel = 'Arming phase';
      mainValue = '00:00';
      sub = `Preparing round ${Math.max(state.currentRound || 1, 1)}`;
    } else if (state.started){
      mainLabel = 'Between rounds';
      mainValue = '00:00';
      const nextRound = Math.min((state.currentRound || 0) + 1, state.totalRounds || (state.currentRound || 0) + 1);
      sub = `Ready for round ${nextRound}`;
    }
    if (timerLabel) timerLabel.textContent = mainLabel;
    if (timerValue) timerValue.textContent = mainValue;
    if (timerSub) timerSub.textContent = sub;

    const next = state.nextRound || {};
    if (next && next.countdown){
      const end = (next.countdown.startTs||0) + (next.countdown.durationMs||0);
      const remaining = Math.max(0, end - now);
      if (nextReadyCountdown){
        nextReadyCountdown.style.display = 'inline-flex';
        nextReadyCountdown.textContent = `${Math.ceil(remaining/1000)}s`;
        nextReadyCountdown.classList.add('pulsing');
      }
    } else if (nextReadyCountdown){
      nextReadyCountdown.style.display = 'none';
      nextReadyCountdown.classList.remove('pulsing');
    }

    if (!statusHoldUntil || Date.now() >= statusHoldUntil){
      maybeResetStatus();
    }
  }

  function renderPhase(){
    const phase = latestState.phase || 'idle';
    const labelMap = { idle:'Idle', arming:'Arming', countdown:'Countdown', active:'Active' };
    if (phaseLabel){
      const text = !latestState.started ? 'Idle' : (labelMap[phase] || phase);
      phaseLabel.textContent = text;
    }
    if (roundInfo){
      const current = latestState.currentRound || 0;
      const total = latestState.totalRounds || 0;
      roundInfo.textContent = total ? `Round ${current} / ${total}` : `Round ${current}`;
    }
  }

  function renderNextReady(){
    if (!nextReadySummary) return;
    const next = latestState.nextRound || {};
    if (!latestState.started){
      nextReadySummary.textContent = 'Waiting for host…';
      if (nextReadyCountdown) nextReadyCountdown.style.display = 'none';
      return;
    }
    if (!next.active){
      nextReadySummary.textContent = 'Next round queue inactive';
      return;
    }
    const ready = next.readyCount || 0;
    const required = next.requiredCount != null ? next.requiredCount : ready;
    const eligible = next.eligibleCount != null ? next.eligibleCount : 0;
    nextReadySummary.textContent = `Ready ${ready}/${required} · Eligible ${eligible}`;
  }

  function renderScoreboard(){
    if (!scoreboardList || !scoreboardEmpty) return;
    scoreboardList.innerHTML = '';
    const visible = latestState.scoreboardVisible !== false;
    const rows = Array.isArray(latestState.scoreboard) ? latestState.scoreboard : [];
    if (!visible){
      scoreboardEmpty.textContent = 'Scoreboard hidden';
      scoreboardEmpty.style.display = 'block';
      scoreboardList.style.display = 'none';
      return;
    }
    if (!rows.length){
      scoreboardEmpty.textContent = 'No standings yet';
      scoreboardEmpty.style.display = 'block';
      scoreboardList.style.display = 'none';
      return;
    }
    scoreboardEmpty.style.display = 'none';
    scoreboardList.style.display = rows.length ? 'grid' : 'none';
    const lastWinner = (latestState.lastWinnerName || '').toLowerCase();
    rows.slice(0, MAX_SCOREBOARD_ROWS).forEach((row, index)=>{
      const li = document.createElement('li');
      li.className = 'scoreboard-row';
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = row.rank != null ? `#${row.rank}` : '#';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = row.name || 'Player';
      const tokens = document.createElement('span');
      tokens.className = 'tokens';
      tokens.textContent = `${row.tokens != null ? row.tokens : 0} 🪙`;
      const accessibleParts = [];
      accessibleParts.push(`Rank ${row.rank != null ? row.rank : '?'}`);
      accessibleParts.push(row.name || 'Player');
      accessibleParts.push(`${row.tokens != null ? row.tokens : 0} tokens`);
      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(tokens);
      if (index === 0){
        li.classList.add('leader');
        accessibleParts.push('Current leader');
      }
      if (lastWinner && row.name && row.name.toLowerCase() === lastWinner){
        li.classList.add('recent-winner');
        accessibleParts.push('Most recent round winner');
        const badge = document.createElement('span');
        badge.className = 'badge badge-winner';
        badge.textContent = 'Winner';
        li.appendChild(badge);
      }
      li.setAttribute('aria-label', accessibleParts.join(', '));
      const sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = accessibleParts.join(', ');
      li.appendChild(sr);
      scoreboardList.appendChild(li);
      li.classList.add('enter');
      setTimeout(()=> li.classList.remove('enter'), 1700);
    });
  }

  function renderHistory(){
    if (!historyList || !historyEmpty) return;
    historyList.innerHTML = '';
    const items = Array.isArray(latestState.history) ? latestState.history.slice(0, MAX_HISTORY) : [];
    if (!items.length){
      historyEmpty.style.display = 'block';
      historyList.style.display = 'none';
      return;
    }
    historyEmpty.style.display = 'none';
    historyList.style.display = 'flex';
    items.forEach((entry)=>{
      const li = document.createElement('li');
      li.className = 'history-item';
      const isNoHold = entry && entry.reason === 'no-hold';
      if (isNoHold) li.classList.add('no-hold');
      const details = document.createElement('div');
      details.className = 'details';
      const round = document.createElement('span');
      round.className = 'round';
      round.textContent = `Round ${entry.round || '?'}`;
      const winner = document.createElement('span');
      winner.className = 'winner';
      if (isNoHold){
        winner.textContent = 'Nobody held';
      } else {
        winner.textContent = entry.winnerName ? entry.winnerName : 'No winner';
      }
      const meta = document.createElement('span');
      meta.className = 'meta';
      const tokens = entry.winnerTokens != null ? `${entry.winnerTokens} 🪙` : '—';
      const hold = formatMs(entry.winnerMs);
      const metaParts = [];
      if (isNoHold){
        metaParts.push('No holds recorded');
      } else {
        if (tokens !== '—') metaParts.push(tokens);
        if (hold !== '—') metaParts.push(`hold ${hold}`);
      }
      meta.textContent = metaParts.join(' · ');
      details.appendChild(round);
      details.appendChild(winner);
      details.appendChild(meta);
      li.appendChild(details);
      historyList.appendChild(li);
      li.classList.add('enter');
      setTimeout(()=> li.classList.remove('enter'), 1800);
    });
  }

  function applyState(patch){
    if (!patch) return;
    latestState = Object.assign({}, latestState, patch);
    if (patch.scoreboard !== undefined) latestState.scoreboard = Array.isArray(patch.scoreboard) ? patch.scoreboard : [];
    if (patch.history !== undefined) latestState.history = Array.isArray(patch.history) ? patch.history : [];
    renderPhase();
    renderNextReady();
    renderScoreboard();
    renderHistory();
    updateTimers();
  }

  socket.on('presentation_state', (payload)=>{
    applyState(payload);
    maybeResetStatus();
    startTimer();
  });

  socket.on('scoreboard_update', ({ rows }={})=>{
    latestState.scoreboardVisible = true;
    latestState.scoreboard = Array.isArray(rows) ? rows : [];
    renderScoreboard();
  });

  socket.on('round_no_hold', (info={})=>{ handleRoundNoHold(info); });

  socket.on('round_result', (info={})=>{ handleRoundResult(info); });

  socket.on('bonus_round_armed', (info={})=>{
    const mult = info.value != null ? `×${info.value}` : '';
    setStatusTone('default');
    showStatus(`Bonus round armed ${mult}!`, 6000);
    if (audioManager) audioManager.play('bonus');
  });

  socket.on('final_round_armed', (info={})=>{
    const tokens = info.tokens != null ? `${info.tokens} 🪙` : '';
    setStatusTone('default');
    showStatus(`Final round ready ${tokens}`, 7000);
    if (audioManager) audioManager.play('final');
  });

  socket.on('game_over', (info={})=>{
    setStatusTone('default');
    if (info.champion && info.champion.name){
      showStatus(`Game over! Champion: ${info.champion.name}`, 8000);
    } else {
      showStatus('Game over! Final results posted.', 8000);
    }
    if (Array.isArray(info.final)){
      latestState.scoreboard = info.final.map(row => ({
        name: row.name,
        tokens: row.tokens,
        rank: row.rank,
      }));
      latestState.scoreboardVisible = true;
      renderScoreboard();
    }
  });

  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden){
      stopTimer();
    } else {
      updateTimers();
      startTimer();
    }
  });

  function hideWinnerSpotlight(){
    if (!winnerSpotlight) return;
    if (winnerSpotlightTimer){
      clearTimeout(winnerSpotlightTimer);
      winnerSpotlightTimer = null;
    }
    winnerSpotlight.classList.remove('active');
    winnerSpotlight.setAttribute('aria-hidden', 'true');
  }

  function populateConfetti(){
    if (!confettiContainer) return;
    confettiContainer.innerHTML = '';
    for (let i = 0; i < 26; i += 1){
      const piece = document.createElement('span');
      piece.style.setProperty('--x', `${Math.random() * 100}%`);
      piece.style.animationDelay = `${Math.random() * 0.4}s`;
      piece.style.background = i % 2 === 0 ? 'linear-gradient(180deg,#38d5ff,#f6a55d)' : 'linear-gradient(180deg,#f6a55d,#ffd87b)';
      confettiContainer.appendChild(piece);
    }
  }

  function handleRoundNoHold(info={}){
    const roundNumber = (typeof info.round === 'number' && Number.isFinite(info.round)) ? info.round : null;
    const shouldChime = lastNoHoldRound !== roundNumber;
    lastNoHoldRound = roundNumber;
    setStatusTone('danger');
    const label = roundNumber != null ? roundNumber : '?';
    showStatus(`Round ${label}: Nobody held!`, 7000);
    showWinnerSpotlight({
      reason: 'no-hold',
      round: roundNumber,
      noHoldLabel: info.noHoldLabel,
    });
    if (shouldChime && audioManager) audioManager.play('alert');
    return shouldChime;
  }

  function handleRoundResult(info={}){
    const reason = typeof info.reason === 'string' ? info.reason : '';
    const entry = {
      round: info.round,
      winnerName: info.winner,
      winnerTokens: info.winnerTokens,
      winnerMs: info.winnerMs,
      ts: serverNow(),
      reason,
    };
    const history = Array.isArray(latestState.history) ? latestState.history.slice() : [];
    history.unshift(entry);
    latestState.history = history.slice(0, MAX_HISTORY);
    latestState.lastWinnerName = info.winner || '';
    latestState.lastWinnerTokens = info.winnerTokens;
    latestState.lastWinnerMs = info.winnerMs;
    latestState.lastWinnerRound = info.round;
    renderHistory();
    renderScoreboard();
    if (reason === 'no-hold'){
      handleRoundNoHold(info);
      return;
    }
    const roundLabel = (typeof info.round === 'number' && Number.isFinite(info.round)) ? info.round : '?';
    if (info.winner){
      setStatusTone('default');
      showStatus(`Round ${roundLabel} winner: ${info.winner}`, 6000);
      showWinnerSpotlight(info);
      if (audioManager) audioManager.play('winner');
      lastNoHoldRound = null;
    } else {
      setStatusTone('default');
      showStatus(`Round ${roundLabel} completed`, 4000);
      hideWinnerSpotlight();
      lastNoHoldRound = null;
    }
  }

  function showWinnerSpotlight(info){
    if (!winnerSpotlight) return;
    const payload = info || {};
    const variant = (payload.reason === 'no-hold' || payload.variant === 'no-hold') ? 'no-hold' : 'winner';
    if (winnerSpotlightTimer){
      clearTimeout(winnerSpotlightTimer);
      winnerSpotlightTimer = null;
    }
    winnerSpotlight.classList.toggle('no-hold', variant === 'no-hold');
    if (spotlightTitle){
      spotlightTitle.textContent = variant === 'no-hold' ? 'No winner this round' : 'Champion of the round';
    }
    if (spotlightWinnerName){
      if (variant === 'no-hold'){
        spotlightWinnerName.textContent = payload.noHoldLabel || 'Nobody held';
      } else {
        spotlightWinnerName.textContent = payload.winner || '—';
      }
    }
    if (spotlightTokens){
      spotlightTokens.innerHTML = '';
      if (variant === 'no-hold'){
        const strong = document.createElement('strong');
        strong.textContent = 'No tokens';
        spotlightTokens.appendChild(strong);
        spotlightTokens.appendChild(document.createTextNode(' awarded'));
      } else {
        const tokens = payload.winnerTokens != null ? payload.winnerTokens : 0;
        const strong = document.createElement('strong');
        strong.textContent = tokens;
        spotlightTokens.appendChild(strong);
        spotlightTokens.appendChild(document.createTextNode(' 🪙'));
      }
    }
    if (spotlightHold){
      spotlightHold.innerHTML = '';
      if (variant === 'no-hold'){
        const strong = document.createElement('strong');
        strong.textContent = 'Hold missed';
        spotlightHold.appendChild(strong);
        spotlightHold.appendChild(document.createTextNode(' — round reset'));
      } else {
        const holdText = formatMs(payload.winnerMs);
        const safeHold = holdText !== '—' ? holdText : '0s';
        const strong = document.createElement('strong');
        strong.textContent = safeHold;
        spotlightHold.appendChild(strong);
        spotlightHold.appendChild(document.createTextNode(' hold'));
      }
    }
    if (spotlightRound){
      const round = payload.round != null ? payload.round : '?';
      spotlightRound.textContent = `Round ${round}`;
    }
    if (spotlightFooter){
      spotlightFooter.textContent = variant === 'no-hold'
        ? 'Regroup and get ready for the next countdown'
        : 'Prepare for the next challenge';
    }
    if (variant === 'winner'){
      populateConfetti();
    } else if (confettiContainer){
      confettiContainer.innerHTML = '';
    }
    winnerSpotlight.classList.add('active');
    winnerSpotlight.setAttribute('aria-hidden', 'false');
    winnerSpotlightTimer = setTimeout(()=> hideWinnerSpotlight(), 6200);
  }

  function createAudioManager(toggleButton){
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass){
      if (toggleButton){
        toggleButton.disabled = true;
        toggleButton.textContent = 'Audio unavailable';
      }
      return { play(){}, setMuted(){}, isMuted(){ return true; } };
    }
    const ctx = new AudioContextClass();
    let muted = true;
    let unlocked = false;
    const updateToggle = ()=>{
      if (!toggleButton) return;
      toggleButton.setAttribute('aria-pressed', String(!muted));
      toggleButton.textContent = muted ? 'Enable Audio' : 'Audio Enabled';
    };
    const unlock = ()=>{
      if (unlocked) return;
      ctx.resume().catch(()=>{});
      unlocked = true;
    };
    const requestUnlock = ()=>{
      unlock();
      document.removeEventListener('pointerdown', requestUnlock);
      document.removeEventListener('keydown', requestUnlock);
    };
    document.addEventListener('pointerdown', requestUnlock, { once: true });
    document.addEventListener('keydown', requestUnlock, { once: true });
    if (toggleButton){
      toggleButton.addEventListener('click', ()=>{
        muted = !muted;
        if (!muted) unlock();
        updateToggle();
      });
      updateToggle();
    }
    function scheduleTone(freqs, duration, opts={}){
      if (muted) return;
      unlock();
      const start = ctx.currentTime + 0.03;
      const gain = ctx.createGain();
      const maxGain = opts.gain != null ? opts.gain : 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(maxGain, start + 0.08);
      gain.gain.exponentialRampToValueAtTime(maxGain * 0.35, start + duration * 0.75);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      gain.connect(ctx.destination);
      freqs.forEach((freq, idx)=>{
        const osc = ctx.createOscillator();
        osc.type = opts.type || 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        if (opts.detune){
          osc.detune.setValueAtTime(opts.detune * idx, start);
        }
        osc.connect(gain);
        osc.start(start);
        osc.stop(start + duration);
      });
    }
    return {
      play(name){
        if (muted) return;
        switch(name){
          case 'winner':
            scheduleTone([392,523,659], 1.4, { type: 'sawtooth', gain: 0.16, detune: 6 });
            scheduleTone([784], 0.9, { type: 'triangle', gain: 0.12 });
            break;
          case 'bonus':
            scheduleTone([440,660], 0.9, { type: 'triangle', gain: 0.12 });
            break;
          case 'final':
            scheduleTone([523,698,880], 1.6, { type: 'square', gain: 0.12, detune: 5 });
            break;
          case 'countdown':
            scheduleTone([330], 0.45, { type: 'sine', gain: 0.1 });
            break;
          case 'active':
            scheduleTone([520,780], 0.6, { type: 'sawtooth', gain: 0.11 });
            break;
          case 'alert':
            scheduleTone([240, 360, 520], 1.1, { type: 'square', gain: 0.18, detune: 8 });
            scheduleTone([180], 1.3, { type: 'sawtooth', gain: 0.12 });
            break;
          default:
            break;
        }
      },
      setMuted(next){
        muted = !!next;
        if (!muted) unlock();
        updateToggle();
      },
      isMuted(){
        return muted;
      },
    };
  }

  if (typeof window !== 'undefined'){
    Object.defineProperty(window, '__TA_PRESENTATION_DEBUG', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: {
        handleRoundNoHold,
        handleRoundResult,
        showWinnerSpotlight,
        hideWinnerSpotlight,
        showStatus,
        setStatusTone,
        get audioManager(){
          return audioManager;
        },
      },
    });
  }

  audioManager = createAudioManager(audioToggle);
})();
