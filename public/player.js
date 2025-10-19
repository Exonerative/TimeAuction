(function(){
  const socket = io({ query: { role: 'player' } });
  // Sync to server clock for accurate countdowns
  socket.on('server_now', (d)=>{
    try{
      const offset = (d && typeof d.now==='number' ? d.now : Date.now()) - Date.now();
      window.__getServerNow = ()=> Date.now() + offset;
    }catch(e){}
  });


  const serverNow = ()=> (window.__getServerNow ? window.__getServerNow() : Date.now());

  const joinCard = document.getElementById('joinCard');
  const gameCard = document.getElementById('gameCard');
  const joinBtn = document.getElementById('join');
  const reconnectBtn = document.getElementById('reconnect');
  const nameInput = document.getElementById('name');
  const pinInput = document.getElementById('pin');
  const myPinEl = document.getElementById('myPin');
  const savedSessionEl = document.getElementById('savedSession');
  const statusMsg = document.getElementById('statusMsg');

  const playerName = document.getElementById('playerName');
  const tokenCount = document.getElementById('tokenCount');
  const roundResult = document.getElementById('roundResult');
  const holdArea = document.getElementById('holdArea');
  const holdText = document.getElementById('holdText');
  const holdSub = document.getElementById('holdSub');
  const exhaustedMsg = document.getElementById('exhaustedMsg');

  const cdOverlay = document.getElementById('countdownOverlay');
  const cdDigit = document.getElementById('countdownDigit');

  const publicScoreCard = document.getElementById('publicScoreCard');
  const publicScoreTable = document.getElementById('publicScoreTable');

  const phaseBadge = document.getElementById('phaseBadge');
  const phaseCopy  = document.getElementById('phaseCopy');
  const roundTimerEl = document.getElementById('roundTimer');
  const roundRecapPanel = document.getElementById('roundRecapPanel');
  const rrTitle = document.getElementById('rrTitle');
  const rrSubtitle = document.getElementById('rrSubtitle');
  const rrWinner = document.getElementById('rrWinner');
  const rrWinnerTokens = document.getElementById('rrWinnerTokens');
  const rrHold = document.getElementById('rrHold');
  const rrBonus = document.getElementById('rrBonus');
  const rrLeader = document.getElementById('rrLeader');
  const rrLeaderGap = document.getElementById('rrLeaderGap');
  const rrRoundsLeft = document.getElementById('rrRoundsLeft');
  const rrCountdown = document.getElementById('rrCountdown');
  const rrDismiss = document.getElementById('rrDismiss');
  const nextReadyPanel = document.getElementById('nextReadyPanel');
  const nextReadyStatus = document.getElementById('nextReadyStatus');
  const toggleReadyBtn = document.getElementById('toggleReadyBtn');

  const STORAGE_KEY = 'ta_player_session_v1';
  const BROADCAST_FALLBACK_KEY = '__ta_player_signal';
  const TAB_ID = Math.random().toString(36).slice(2);
  let sessionInfo = loadSession();
  let shouldAutoResume = !!(sessionInfo && !document.hidden);
  let resumeInFlight = false;
  let pendingResumeReason = null;

  if (roundRecapPanel){ roundRecapPanel.setAttribute('aria-hidden','true'); }
  if (rrDismiss){ rrDismiss.addEventListener('click', ()=>{ hideRoundRecap(true); }); }

  function loadSession(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.pin || !parsed.sessionToken) return null;
      return parsed;
    }catch(e){ return null; }
  }
  function saveSession(info){
    try{
      if (!info){ localStorage.removeItem(STORAGE_KEY); }
      else { localStorage.setItem(STORAGE_KEY, JSON.stringify(info)); }
    }catch(e){}
  }
  function clearStoredSession(){
    sessionInfo = null;
    shouldAutoResume = false;
    resumeInFlight = false;
    pendingResumeReason = null;
    saveSession(null);
    updateSavedSessionUI();
  }
  function updateSavedSessionUI(){
    if (!savedSessionEl) return;
    if (sessionInfo && sessionInfo.pin){
      savedSessionEl.style.display = 'block';
      savedSessionEl.textContent = `Saved PIN ${sessionInfo.pin}${sessionInfo.name ? ` · ${sessionInfo.name}` : ''}`;
      if (pinInput){ pinInput.value = sessionInfo.pin; }
      if (nameInput && !nameInput.value && sessionInfo.name){ nameInput.value = sessionInfo.name; }
      if (reconnectBtn){ reconnectBtn.disabled = false; }
    } else {
      savedSessionEl.style.display = 'none';
      if (reconnectBtn){ reconnectBtn.disabled = false; }
    }
  }
  function setStatus(text){
    if (!statusMsg) return;
    if (!text){ statusMsg.style.display='none'; statusMsg.textContent=''; }
    else { statusMsg.style.display='block'; statusMsg.textContent = text; }
  }

  let bc = null;
  try{ if ('BroadcastChannel' in window){ bc = new BroadcastChannel('ta-player-session'); } }catch(e){ bc=null; }
  function handleSignal(data){
    if (!data || data.tabId === TAB_ID) return;
    if (data.type === 'claim'){
      if (sessionInfo && shouldAutoResume){
        pauseSession();
        setStatus('Paused — another tab is now active.');
      }
    }
  }
  if (bc){ bc.onmessage = (event)=>{ handleSignal(event.data); }; }
  else {
    window.addEventListener('storage', (ev)=>{
      if (ev.key !== BROADCAST_FALLBACK_KEY || !ev.newValue) return;
      try{ const data = JSON.parse(ev.newValue); handleSignal(data); }catch(e){}
    });
  }
  function sendSignal(payload){
    const data = Object.assign({ tabId: TAB_ID, ts: Date.now() }, payload||{});
    if (bc){ bc.postMessage(data); }
    else {
      try{
        localStorage.setItem(BROADCAST_FALLBACK_KEY, JSON.stringify(data));
        // Ensure subsequent writes still fire storage events
        localStorage.removeItem(BROADCAST_FALLBACK_KEY);
      }catch(e){}
    }
  }
  function broadcastClaim(reason){
    if (!sessionInfo) return;
    sendSignal({ type:'claim', reason: reason || 'claim' });
  }
  function pauseSession(){
    shouldAutoResume = false;
    pendingResumeReason = null;
    resumeInFlight = false;
    if (socket.connected){ socket.emit('player_pause'); }
    if (!socket.disconnected){ socket.disconnect(); }
  }
  function attemptResume(reason){
    if (!shouldAutoResume) return;
    if (!sessionInfo || !sessionInfo.pin || !sessionInfo.sessionToken) return;
    if (!socket.connected){
      pendingResumeReason = reason || pendingResumeReason || 'auto';
      if (socket.disconnected){ try{ socket.connect(); }catch(e){} }
      return;
    }
    pendingResumeReason = null;
    if (resumeInFlight) return;
    resumeInFlight = true;
    setStatus('Resuming your spot…');
    socket.emit('player_resume', { pin: sessionInfo.pin, sessionToken: sessionInfo.sessionToken }, (res)=>{
      resumeInFlight = false;
      if (!res || !res.ok){
        if (res && res.code === 'session_mismatch'){ setStatus('Session expired — please join again.'); clearStoredSession(); }
        else { setStatus(res?.error || 'Resume failed.'); }
        return;
      }
      setStatus('');
      if (res.sessionToken){
        sessionInfo = { pin: res.pin, name: res.name, sessionToken: res.sessionToken };
        saveSession(sessionInfo);
        updateSavedSessionUI();
      }
    });
  }

  updateSavedSessionUI();
  if (sessionInfo && !document.hidden){
    setStatus('Resuming your saved spot…');
    broadcastClaim('startup');
    attemptResume('startup');
  }
  const nextReadyCountdownPlayer = document.getElementById('nextReadyCountdownPlayer');
  function showBanner(title, sub){
    try{
      if (roundResult){
        const t = String(title||'').trim();
        const s = String(sub||'').trim();
        roundResult.textContent = s ? `${t} — ${s}` : t;
      }
    }catch(e){}
  }

  function captureLobbySnapshot(data){
    const base = data || {};
    latestLobbySnapshot = {
      lobby: Array.isArray(base.lobby) ? base.lobby.map(p=>Object.assign({}, p)) : [],
      started: !!base.started,
      currentRound: base.currentRound,
      totalRounds: base.totalRounds,
      roundActive: !!base.roundActive,
      phase: base.phase,
      receivedAt: Date.now(),
    };
  }

  function ensureLobbySnapshot(){
    if (!latestLobbySnapshot){ latestLobbySnapshot = { lobby: [] }; }
    if (!Array.isArray(latestLobbySnapshot.lobby)){ latestLobbySnapshot.lobby = []; }
    return latestLobbySnapshot;
  }

  function clearRoundRecapTimer(){ if (roundRecapTimer){ clearTimeout(roundRecapTimer); roundRecapTimer = null; } }

  function hideRoundRecap(immediate=false){
    if (!roundRecapPanel) return;
    clearRoundRecapTimer();
    roundRecapPanel.classList.remove('show');
    roundRecapPanel.setAttribute('aria-hidden','true');
    if (rrCountdown){ rrCountdown.style.display='none'; rrCountdown.textContent=''; }
    if (immediate){ void roundRecapPanel.offsetHeight; }
  }

  function updateRecapCountdown(){
    if (!rrCountdown) return;
    const panelVisible = !!(roundRecapPanel && roundRecapPanel.classList.contains('show'));
    if (!panelVisible || !nextReadyCountdownCfg){
      if (panelVisible && nextReadyState && nextReadyState.active){
        rrCountdown.style.display = 'inline-flex';
        rrCountdown.textContent = 'Waiting for players…';
      } else {
        rrCountdown.style.display = 'none';
        rrCountdown.textContent = '';
      }
      return;
    }
    const remain = Math.max(0, (nextReadyCountdownCfg.startTs + nextReadyCountdownCfg.durationMs) - serverNow());
    if (remain <= 0){
      rrCountdown.style.display = 'none';
      rrCountdown.textContent = '';
      return;
    }
    rrCountdown.style.display = 'inline-flex';
    rrCountdown.textContent = 'Next round in ' + Math.ceil(remain/1000) + 's';
  }

  function showRoundRecap(d){
    if (!roundRecapPanel) return;
    const payload = d || {};
    const snapshot = ensureLobbySnapshot();
    if (typeof payload.totalRounds === 'number'){ snapshot.totalRounds = payload.totalRounds; }
    if (typeof payload.round === 'number'){ snapshot.currentRound = payload.round; }
    if (payload.winnerId && Array.isArray(snapshot.lobby)){
      const entry = snapshot.lobby.find(p=>p.id === payload.winnerId);
      if (entry){ entry.tokens = payload.winnerTokens; }
      else if (payload.winner){ snapshot.lobby.push({ id: payload.winnerId, name: payload.winner, tokens: payload.winnerTokens }); }
    }
    const totalRounds = Number.isFinite(payload.totalRounds) ? payload.totalRounds : snapshot.totalRounds;
    const roundsLeft = Number.isFinite(payload.roundsLeft) ? payload.roundsLeft : (Number.isFinite(totalRounds) && Number.isFinite(payload.round) ? Math.max(0, totalRounds - payload.round) : null);
    if (rrTitle){ rrTitle.textContent = payload.round ? `Round ${payload.round} recap` : 'Round recap'; }
    if (rrSubtitle){
      const parts = [];
      if (Number.isFinite(payload.round) && Number.isFinite(totalRounds)){ parts.push(`Round ${payload.round} of ${totalRounds}`); }
      else if (Number.isFinite(payload.round)){ parts.push(`Round ${payload.round}`); }
      if (payload.finalRound){ parts.push('Match complete'); }
      else if (Number.isFinite(roundsLeft)){ parts.push(roundsLeft === 1 ? '1 round remaining' : `${roundsLeft} rounds remaining`); }
      rrSubtitle.textContent = parts.length ? parts.join(' · ') : 'Round summary';
    }
    if (rrWinner){ rrWinner.textContent = payload.winner ? String(payload.winner) : 'No winner'; }
    if (rrWinnerTokens){ rrWinnerTokens.textContent = payload.winner ? `🏆 ${payload.winnerTokens || 0} total` : 'No tokens awarded'; }
    if (rrHold){ rrHold.textContent = payload.winner ? fmt(payload.winnerMs || 0) : '—'; }
    if (rrBonus){
      if (payload.finalRound){ rrBonus.textContent = 'Final round stakes'; }
      else if (payload.bonusValue){ rrBonus.textContent = 'Bonus ×' + payload.bonusValue; }
      else { rrBonus.textContent = 'Standard round'; }
    }
    const lobby = Array.isArray(snapshot.lobby) ? snapshot.lobby : [];
    const meEntry = lobby.find(p=>p.id === myId) || null;
    if (meEntry && !Number.isFinite(myTokenCount)){ myTokenCount = meEntry.tokens || 0; }
    const leaderTokens = Number.isFinite(payload.leaderTokens) ? payload.leaderTokens : null;
    let leaderLabel = payload.leaderName || (leaderTokens != null ? 'Leader' : '—');
    let leaderCopy = 'Awaiting scores…';
    if (leaderTokens != null){
      const topPlayers = lobby.filter(p => (p.tokens||0) === leaderTokens);
      if (!leaderLabel && topPlayers.length){ leaderLabel = topPlayers[0].name || 'Leader'; }
      const myTokensNow = Number.isFinite(myTokenCount) ? myTokenCount : (meEntry ? meEntry.tokens : null);
      if (myTokensNow == null){
        leaderCopy = `🏆 ${leaderTokens}`;
      } else if (myTokensNow === leaderTokens){
        if (topPlayers.length > 1){
          leaderLabel = `${topPlayers.length}-way tie`;
          leaderCopy = 'Tied for the lead';
        } else {
          leaderLabel = 'You';
          leaderCopy = 'You’re the leader';
        }
      } else if (myTokensNow < leaderTokens){
        const diff = leaderTokens - myTokensNow;
        const target = payload.leaderName || (topPlayers[0]?.name || 'leader');
        leaderLabel = target;
        leaderCopy = `🏆 ${leaderTokens} · ${diff} ahead of you`;
      } else {
        leaderLabel = 'You';
        leaderCopy = 'You’re the leader';
      }
    }
    if (rrLeader){ rrLeader.textContent = leaderLabel || '—'; }
    if (rrLeaderGap){ rrLeaderGap.textContent = leaderCopy; }
    if (rrRoundsLeft){
      if (payload.finalRound){ rrRoundsLeft.textContent = '0'; }
      else if (Number.isFinite(roundsLeft)){ rrRoundsLeft.textContent = String(roundsLeft); }
      else { rrRoundsLeft.textContent = '—'; }
    }
    roundRecapPanel.setAttribute('aria-hidden','false');
    roundRecapPanel.classList.add('show');
    updateRecapCountdown();
    clearRoundRecapTimer();
    roundRecapTimer = setTimeout(()=> hideRoundRecap(), 6500);
  }


  const finalModal = document.getElementById('finalModal');
  const finalChampion = document.getElementById('finalChampion');
  const finalTableInner = document.getElementById('finalTableInner');
  const closeFinal = document.getElementById('closeFinal');

  let joined=false, inHold=false, exhausted=false, roundActive=false, releasedOut=false, disabledUI=false, phase='idle', myId=null;
  let activeStart=0, activationTs=0, timerInt=null;
  let nextReadyState = { active:false, readyIds:[] };
  let nextReadyTimer = null;
  let nextReadyCountdownCfg = null;
  let latestLobbySnapshot = null;
  let myTokenCount = 0;
  let roundRecapTimer = null;

  // Heartbeat ramp config + loop
  let hbCfg = { enabled:true, intervalSec:30, multiplier:0.9, minMs:750, maxMs:2000 };
  let hbTimer=null, hbNext=0, hbIntervalMs=0;
  function cancelHeartbeat(){ if(hbTimer){ clearTimeout(hbTimer); hbTimer=null; } }
  function scheduleHeartbeat(startTs){
    cancelHeartbeat(); if(!hbCfg || !hbCfg.enabled) return;
    const now = ()=> (window.__getServerNow?window.__getServerNow():Date.now());
    hbNext = startTs; hbIntervalMs = Math.max(100, (hbCfg.intervalSec||30)*1000);
    const doBeat=()=>{ const hold=document.getElementById('holdArea'); if(hold){ hold.classList.add('hb-beat'); setTimeout(()=>hold.classList.remove('hb-beat'),180); } hbIntervalMs = Math.max(hbCfg.minMs||100, Math.min(hbCfg.maxMs||2000, Math.floor(hbIntervalMs*(hbCfg.multiplier||1)))); hbNext += hbIntervalMs; const delay = Math.max(0, hbNext - now()); hbTimer=setTimeout(doBeat, delay); };
    const delay = Math.max(0, startTs - now()); hbTimer=setTimeout(doBeat, delay);
  }
  socket.on('hb_ramp_changed', cfg=>{ hbCfg = Object.assign(hbCfg, cfg||{}); });


  function vibrate(ms){ if (navigator.vibrate) navigator.vibrate(ms); }
  function askNotifyPermission(){ try{ if ('Notification' in window && Notification.permission==='default'){ Notification.requestPermission(); } }catch(e){} }
  function notify(title, body){ try{ if ('Notification' in window && Notification.permission==='granted'){ const n=new Notification(title,{ body }); setTimeout(()=>n.close&&n.close(), 4000); } }catch(e){} }

  function stopNextReadyCountdown(){ if (nextReadyTimer){ clearInterval(nextReadyTimer); nextReadyTimer = null; } updateRecapCountdown(); }
  function drawNextReadyCountdown(){
    if (!nextReadyCountdownPlayer || !nextReadyCountdownCfg){ if (nextReadyCountdownPlayer) nextReadyCountdownPlayer.style.display='none'; stopNextReadyCountdown(); return; }
    const remain = Math.max(0, (nextReadyCountdownCfg.startTs + nextReadyCountdownCfg.durationMs) - serverNow());
    nextReadyCountdownPlayer.textContent = 'Auto-start in ' + Math.ceil(remain/1000) + 's';
    nextReadyCountdownPlayer.style.display = 'inline-block';
    updateRecapCountdown();
    if (remain <= 0){ stopNextReadyCountdown(); }
  }
  function updateNextReadyUI(){
    if (!nextReadyPanel || !toggleReadyBtn) return;
    const active = !!(nextReadyState && nextReadyState.active && joined && phase === 'idle' && !roundActive);
    if (!active){
      nextReadyCountdownCfg = null;
      nextReadyPanel.style.display = 'none';
      if (nextReadyCountdownPlayer){ nextReadyCountdownPlayer.style.display = 'none'; nextReadyCountdownPlayer.textContent=''; }
      stopNextReadyCountdown();
      updateRecapCountdown();
      return;
    }
    nextReadyPanel.style.display = 'block';
    const readyCount = nextReadyState.readyCount || 0;
    const requiredCount = nextReadyState.requiredCount || 0;
    const eligible = nextReadyState.eligibleCount || requiredCount;
    if (nextReadyStatus){
      const suffix = eligible > requiredCount ? ` (eligible ${eligible})` : '';
      nextReadyStatus.textContent = `Ready ${readyCount} / ${requiredCount}${suffix}`;
    }
    const readyIds = new Set(nextReadyState.readyIds || []);
    const isReady = readyIds.has(myId);
    toggleReadyBtn.textContent = isReady ? 'Cancel ready' : 'I\'m ready';
    toggleReadyBtn.classList.toggle('ready', isReady);
    toggleReadyBtn.classList.toggle('primary', !isReady);
    toggleReadyBtn.disabled = (!isReady && exhausted) || !joined || disabledUI;
    if (nextReadyState.countdown){
      nextReadyCountdownCfg = nextReadyState.countdown;
      drawNextReadyCountdown();
      if (!nextReadyTimer) nextReadyTimer = setInterval(drawNextReadyCountdown, 200);
    } else {
      nextReadyCountdownCfg = null;
      if (nextReadyCountdownPlayer){ nextReadyCountdownPlayer.style.display='none'; nextReadyCountdownPlayer.textContent=''; }
      stopNextReadyCountdown();
    }
    updateRecapCountdown();
  }

  function setHoldClasses({ idle=false, pressed=false, disabled=false }){ const el = holdArea; el.classList.toggle('idle', !!idle); el.classList.toggle('pressed', !!pressed); el.classList.toggle('disabled', !!disabled); el.setAttribute('aria-pressed', pressed ? 'true' : 'false'); }

  function setPhaseUI(tag){
    phase = tag;
    const cls = ['ph-idle','ph-arming','ph-countdown','ph-active','ph-ended','ph-exhausted'];
    phaseBadge.classList.remove(...cls);
    switch(tag){
      case 'arming':
        phaseBadge.textContent = 'Arming'; phaseBadge.classList.add('ph-arming');
        phaseCopy.textContent  = 'Press & hold now — all players must hold to start';
        break;
      case 'countdown':
        phaseBadge.textContent = 'Countdown'; phaseBadge.classList.add('ph-countdown');
        phaseCopy.textContent  = 'Release = out (this round)';
        break;
      case 'active':
        phaseBadge.textContent = 'Active'; phaseBadge.classList.add('ph-active');
        phaseCopy.textContent  = 'Bank draining — keep holding';
        break;
      case 'ended':
        phaseBadge.textContent = 'Game over'; phaseBadge.classList.add('ph-ended');
        phaseCopy.textContent  = 'See final results below';
        break;
      case 'exhausted':
        phaseBadge.textContent = 'Exhausted'; phaseBadge.classList.add('ph-exhausted');
        phaseCopy.textContent  = 'You’re spectating until next match';
        break;
      default:
        phaseBadge.textContent = 'Idle'; phaseBadge.classList.add('ph-idle');
        phaseCopy.textContent  = 'Waiting for host…';
    }
    updateNextReadyUI();
  }

  function updateHoldVisual(){
    if (disabledUI){ setHoldClasses({ disabled:true }); holdText.textContent = exhausted ? 'Exhausted' : 'Out this round'; holdSub.textContent = exhausted ? 'Bank exhausted — you can’t participate for the rest of the game.' : 'Wait for next round'; return; }
    if (inHold){ setHoldClasses({ pressed:true }); holdText.textContent='Holding…'; holdSub.textContent = (phase==='arming')? 'Keep holding to start' : 'Keep holding'; }
    else { setHoldClasses({ idle:true }); holdText.textContent = (phase==='arming') ? 'Hold to ready' : 'Press & Hold'; holdSub.textContent = (phase==='arming') ? 'All players must hold' : 'Release = out (this round)'; }
  }

  function startTimer(){
    if (timerInt) return;
    timerInt = setInterval(()=>{
      if (phase==='active'){
        const ms = Math.max(0, serverNow() - activeStart);
        roundTimerEl.textContent = fmt(ms);
      } else {
        roundTimerEl.textContent = '00:00.000';
      }
    }, 50);
  }
  function stopTimer(){ if (!timerInt) return; clearInterval(timerInt); timerInt=null; roundTimerEl.textContent = '00:00.000'; }

  function startHold(){ if (!joined || disabledUI) return; if (exhausted && phase==='active') return; if (phase==='idle') return; if (phase==='countdown' || phase==='active'){ if (releasedOut) return; } inHold = true; socket.emit('hold_press'); updateHoldVisual(); }
  function endHold(){ if (!inHold) return; inHold=false; socket.emit('hold_release'); if (phase==='countdown' || phase==='active'){ releasedOut=true; disabledUI=true; } updateHoldVisual(); }

  // events
  joinBtn.onclick = ()=>{
    const name = nameInput.value.trim().slice(0,24) || 'Player';
    clearStoredSession();
    shouldAutoResume = true;
    setStatus('Joining…');
    socket.emit('player_join', { name });
  };
  reconnectBtn.onclick = ()=>{
    const typedPin = pinInput.value.trim();
    if (sessionInfo && sessionInfo.pin && (!typedPin || typedPin === sessionInfo.pin)){
      shouldAutoResume = true;
      setStatus('Resuming your saved spot…');
      broadcastClaim('manual-resume');
      attemptResume('manual-button');
      return;
    }
    if (!typedPin){ alert('Enter your PIN'); return; }
    setStatus('Reconnecting…');
    socket.emit('player_reconnect', { pin: typedPin });
  };
  if (toggleReadyBtn){
    toggleReadyBtn.onclick = ()=>{
      if (!nextReadyState || !nextReadyState.active) return;
      const readyIds = new Set(nextReadyState.readyIds || []);
      const isReady = readyIds.has(myId);
      if (isReady){ socket.emit('player_unready_next'); }
      else if (!exhausted){ socket.emit('player_ready_next'); }
    };
  }
  document.addEventListener('contextmenu', e=>e.preventDefault());
  holdArea.addEventListener('touchstart', e=>{ e.preventDefault(); startHold(); }, {passive:false});
  holdArea.addEventListener('touchend',   e=>{ e.preventDefault(); endHold(); }, {passive:false});
  holdArea.addEventListener('touchcancel',e=>{ e.preventDefault(); endHold(); }, {passive:false});
  holdArea.addEventListener('mousedown',  e=>{ e.preventDefault(); startHold(); });
  window.addEventListener('mouseup',      e=>{ endHold(); });
  holdArea.addEventListener('mouseleave', e=>{ endHold(); });

  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden){
      if (sessionInfo){ setStatus('Paused while in background.'); }
      pauseSession();
    } else {
      if (sessionInfo){
        shouldAutoResume = true;
        setStatus('');
        broadcastClaim('visible');
        attemptResume('visible');
      } else {
        shouldAutoResume = false;
        setStatus('');
        if (socket.disconnected){ try{ socket.connect(); }catch(e){} }
      }
    }
  });
  window.addEventListener('beforeunload', ()=>{
    if (socket.connected){ socket.emit('player_pause'); }
  });

  socket.on('connect', ()=>{
    if (sessionInfo && shouldAutoResume){
      attemptResume(pendingResumeReason || 'connect');
    } else {
      setStatus('');
    }
  });
  socket.on('connect_error', ()=>{
    if (sessionInfo){ setStatus('Network issue — retrying…'); }
  });
  socket.on('disconnect', (reason)=>{
    resumeInFlight = false;
    pendingResumeReason = null;
    joined = false;
    if (reason === 'io client disconnect'){ return; }
    if (sessionInfo){
      shouldAutoResume = true;
      setStatus('Connection lost. Waiting to resume…');
      attemptResume('disconnect');
    } else {
      setStatus('Connection lost.');
      if (!document.hidden && socket.disconnected){ try{ socket.connect(); }catch(e){} }
    }
  });

  socket.on('joined', (d)=>{
    joined=true; myId=d.id; playerName.textContent=d.name; tokenCount.textContent='🏆 '+d.tokens;
    myTokenCount = d.tokens || 0;
    myPinEl.textContent = d.pin || '';
    if (pinInput){ pinInput.value = d.pin || ''; }
    if (d.sessionToken){
      sessionInfo = { pin: d.pin, name: d.name, sessionToken: d.sessionToken };
      saveSession(sessionInfo);
      updateSavedSessionUI();
      broadcastClaim('joined');
    }
    shouldAutoResume = true;
    resumeInFlight = false;
    pendingResumeReason = null;
    setStatus('');
    joinCard.style.display='none'; gameCard.style.display='block';
    askNotifyPermission();
    setPhaseUI('idle'); updateHoldVisual(); stopTimer(); cancelHeartbeat();
    updateNextReadyUI();
  });
  socket.on('reconnect_result', (r)=>{
    if (!r.ok){ setStatus(r.error || 'Reconnect failed.'); alert(r.error || 'Reconnect failed'); return; }
    setStatus('Reconnected with your PIN.');
    alert('Reconnected as '+(r.name||'Player'));
  });

  socket.on('lobby_update', (l={})=>{
    captureLobbySnapshot(l || {});
    if (!joined) return;
    const snapshot = ensureLobbySnapshot();
    const me=(snapshot.lobby||[]).find(p=>p.id===myId);
    if (me){
      tokenCount.textContent='🏆 '+me.tokens;
      myTokenCount = me.tokens || 0;
      if (sessionInfo && me.name && sessionInfo.name !== me.name){
        sessionInfo = { pin: sessionInfo.pin, name: me.name, sessionToken: sessionInfo.sessionToken };
        saveSession(sessionInfo);
        updateSavedSessionUI();
      }
    }
  });

  socket.on('next_round_ready_state', (d={})=>{
    nextReadyState = Object.assign({ active:false, readyIds:[] }, d || {});
    updateNextReadyUI();
  });

  socket.on('arming_started', ()=>{
    hideRoundRecap(true);
    nextReadyCountdownCfg = null; stopNextReadyCountdown(); if (nextReadyCountdownPlayer) nextReadyCountdownPlayer.style.display='none'; if (nextReadyPanel) nextReadyPanel.style.display='none';
    if (exhausted){ disabledUI=false; try{ phaseCopy.textContent='Bank exhausted — press & hold to arm the next round (you can’t play).'; }catch(e){} }
    setPhaseUI('arming'); roundActive=false; releasedOut=false; disabledUI=false; updateHoldVisual(); stopTimer(); cancelHeartbeat(); notify('Round starting','Press & hold now — all players must hold.');
  });

  // Countdown 3,2,1,0 with unified activationTs
  let cdTimer = null;
  socket.on('countdown_started', (d)=>{
    hideRoundRecap(true);
    setPhaseUI('countdown'); if (exhausted){ disabledUI=false; try{ phaseCopy.textContent='Countdown — you’re exhausted and won’t play this round.';}catch(e){} } updateHoldVisual();
    activationTs = (d.startTs||serverNow()) + (d.durationMs||0);
    function draw(){
      const remain = Math.max(0, activationTs - serverNow());
      const raw = Math.floor((remain + 999) / 1000); // 3,2,1,0
      const seg = Math.min(5, Math.max(0, raw));     // cap
      cdDigit.textContent = String(seg);
      if (remain <= 0){ clearInterval(cdTimer); cdTimer=null; /* overlay hides on Active */ }
    }
    cdOverlay.style.display='flex';
    if (cdTimer) clearInterval(cdTimer);
    draw(); cdTimer=setInterval(draw, 100);
    stopTimer(); cancelHeartbeat();
    updateNextReadyUI();
  });

  socket.on('bonus_round_armed', (d)=>{
    showBanner('BONUS ROUND', 'Winner gets 🏆 ×'+(d.value||2));
    holdArea.classList.add('bonus');
  });
  socket.on('final_round_armed', (d)=>{
    showBanner('FINAL ROUND', 'Winner gets 🏆 '+(d.tokens||1));
  });

  socket.on('game_started', (d)=>{
    const txt = (d && d.rulesText) ? String(d.rulesText).replace(/\n/g, ' \u2022 ') : 'Game started';
    showBanner('Game Started', txt);
    exhausted = false; disabledUI = false; updateNextReadyUI();
  });

  socket.on('round_started', (d)=>{
    hideRoundRecap(true);
    const ts = activationTs || (d.startTs + (d.durationMs||0)) || serverNow();
    const delay = Math.max(0, ts - serverNow());
    setTimeout(()=>{
      setPhaseUI('active'); roundActive=true; releasedOut=false;
      if (exhausted){ disabledUI=true; }
      updateHoldVisual(); roundResult.textContent=''; holdArea.classList.toggle('bonus', !!d.bonusActive);
      activeStart = ts; // exact activation epoch
      startTimer();
      cdOverlay.style.display='none'; scheduleHeartbeat(ts);
    }, delay);
  });

  socket.on('round_result', (d={})=>{
    const payload = d || {};
    setPhaseUI('idle');
    roundActive=false; inHold=false; releasedOut=false; disabledUI=false;
    updateHoldVisual();
    stopTimer();
    cancelHeartbeat();
    holdArea.classList.remove('bonus');

    const snapshot = ensureLobbySnapshot();
    if (typeof payload.totalRounds === 'number'){ snapshot.totalRounds = payload.totalRounds; }
    if (typeof payload.round === 'number'){ snapshot.currentRound = payload.round; }
    if (payload.winnerId && Array.isArray(snapshot.lobby)){
      const entry = snapshot.lobby.find(p=>p.id === payload.winnerId);
      if (entry){ entry.tokens = payload.winnerTokens; }
      else if (payload.winner){ snapshot.lobby.push({ id: payload.winnerId, name: payload.winner, tokens: payload.winnerTokens }); }
    }
    if (payload.winnerId === myId){
      myTokenCount = payload.winnerTokens || 0;
      tokenCount.textContent = '🏆 ' + myTokenCount;
    } else if (Array.isArray(snapshot.lobby)){
      const meEntry = snapshot.lobby.find(p=>p.id === myId);
      if (meEntry && Number.isFinite(meEntry.tokens)){ myTokenCount = meEntry.tokens; }
    }

    const roundLabel = Number.isFinite(payload.round) ? `Round ${payload.round}` : 'Round';
    if (payload.winner){
      roundResult.textContent = `${roundLabel}: ${payload.winner} held ${fmt(payload.winnerMs || 0)} · 🏆 ${payload.winnerTokens || 0}`;
    } else {
      roundResult.textContent = `${roundLabel}: No winner`;
    }

    showRoundRecap(payload);
    updateNextReadyUI();
  });

  socket.on('game_over', (d)=>{
    hideRoundRecap(true);
    nextReadyCountdownCfg = null; stopNextReadyCountdown(); if (nextReadyPanel) nextReadyPanel.style.display='none'; if (nextReadyCountdownPlayer) nextReadyCountdownPlayer.style.display='none';
    setPhaseUI('ended');
    // Winner banner
    if (d.champion){ finalChampion.textContent = 'Champion: '+d.champion.name+' ('+d.champion.tokens+')'; }
    else { finalChampion.textContent = 'Champion: —'; }
    // Build final table for players — includes Bank Remaining (formatted) visible ONLY here
    const rows = (d.final||[]).map(r=>{
      const bankFmt = fmt(r.bankRemainingMs||0);
      const lastWin = (r.lastVictoryRound==null) ? 'no victories yet' : ('#'+r.lastVictoryRound);
      const exhausted = (r.exhausted || (r.bankRemainingMs||0)===0);
      return '<tr>'+
        '<td class="mono">#'+r.rank+'</td>'+
        '<td>'+escapeHtml(String(r.name||''))+'</td>'+
        '<td>'+(r.tokens||0)+'</td>'+
        '<td>'+(r.roundsActive||0)+'</td>'+
        '<td class="mono">'+bankFmt+(exhausted?' <span class="muted">(exhausted)</span>':'')+'</td>'+
        '<td>'+lastWin+'</td>'+
      '</tr>';
    }).join('');
    finalTableInner.innerHTML =
      '<table>'+
        '<thead><tr><th>#</th><th>Player</th><th></th><th>Rounds Active</th><th>Bank Remaining</th><th>Last Win</th></tr></thead>'+
        '<tbody>'+rows+'</tbody>'+
      '</table>';
    finalModal.style.display = 'flex';
  });
  closeFinal.onclick = ()=>{ finalModal.style.display='none'; };

  socket.on('exhausted', ()=>{ setPhaseUI('exhausted'); exhausted=true; inHold=false; disabledUI=true; updateHoldVisual(); vibrate(80); exhaustedMsg.style.display='block'; setTimeout(()=>exhaustedMsg.style.display='none', 2500); updateNextReadyUI(); });

  // Public scoreboard (sorted, includes rank #; no bank shown during play)
  socket.on('scoreboard_update', (d)=>{
    publicScoreCard.style.display = 'block';
    const rows = (d.rows||[]).map(r=>
      '<tr>'+
        '<td class="mono rank">#'+r.rank+'</td>'+
        '<td>'+escapeHtml(String(r.name||''))+'</td>'+
        '<td class="mono">'+r.tokens+'</td>'+
        '<td>'+(r.roundsSinceWin==null ? 'no victories yet' : r.roundsSinceWin)+'</td>'+
      '</tr>'
    ).join('');
    publicScoreTable.innerHTML =
      '<table>'+
        '<thead><tr><th class="rank">#</th><th>Player</th><th>🏆</th><th>Rounds since Win</th></tr></thead>'+
        '<tbody>'+rows+'</tbody>'+
      '</table>';
  });

  function fmt(ms){ const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000), x=ms%1000; return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+String(x).padStart(3,'0'); }
  function escapeHtml(s){ return s.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch])); }

  // Initialize UI
  setPhaseUI('idle'); stopTimer(); cancelHeartbeat();
})();
