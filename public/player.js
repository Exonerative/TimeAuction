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
  const joinHeader = document.getElementById('joinHeader');
  const joinRulesPanel = document.getElementById('joinRulesPanel');
  const gameCard = document.getElementById('gameCard');
  const joinBtn = document.getElementById('join');
  const reconnectBtn = document.getElementById('reconnect');
  const nameInput = document.getElementById('name');
  const pinInput = document.getElementById('pin');
  const myPinEl = document.getElementById('myPin');
  const savedSessionEl = document.getElementById('savedSession');
  const resumeGroup = document.getElementById('resumeGroup');
  const nameHelper = document.getElementById('nameHelper');
  const showResumeToggle = document.getElementById('showResume');
  const statusMsg = document.getElementById('statusMsg');

  const playerName = document.getElementById('playerName');
  const tokenCountValue = document.getElementById('tokenCountValue');
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
  const roundTimerPanel = document.getElementById('roundTimerPanel');
  const roundStatusEl = document.getElementById('roundStatus');
  const roundStatusDetailEl = document.getElementById('roundStatusDetail');
  const timeBankValueEl = document.getElementById('timeBankValue');
  const timeBankDetailEl = document.getElementById('timeBankDetail');
  const roundRecapPanel = document.getElementById('roundRecapPanel');
  const roundRecapLabel = document.getElementById('roundRecapLabel');
  const roundRecapTitle = document.getElementById('roundRecapTitle');
  const roundRecapSubtitle = document.getElementById('roundRecapSubtitle');
  const roundRecapSummary = document.getElementById('roundRecapSummary');
  const roundRecapLeader = document.getElementById('roundRecapLeader');
  const roundRecapLeaderNote = document.getElementById('roundRecapLeaderNote');
  const roundRecapGap = document.getElementById('roundRecapGap');
  const roundRecapGapNote = document.getElementById('roundRecapGapNote');
  const roundRecapBonusStat = document.getElementById('roundRecapBonusStat');
  const roundRecapBonus = document.getElementById('roundRecapBonus');
  const roundRecapBonusNote = document.getElementById('roundRecapBonusNote');
  const roundRecapRoundsLeft = document.getElementById('roundRecapRoundsLeft');
  const roundRecapRoundsLeftNote = document.getElementById('roundRecapRoundsLeftNote');
  const roundRecapFooterNote = document.getElementById('roundRecapFooterNote');
  const roundRecapDismiss = document.getElementById('roundRecapDismiss');
  const roundRecapClose = document.getElementById('roundRecapClose');
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
  let resumeManuallyShown = false;

  if (showResumeToggle){
    showResumeToggle.addEventListener('click', ()=>{
      resumeManuallyShown = true;
      updateSavedSessionUI();
    });
  }

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
    resumeManuallyShown = false;
    saveSession(null);
    updateSavedSessionUI();
  }
  function updateSavedSessionUI(){
    const hasSession = !!(sessionInfo && sessionInfo.pin);
    if (savedSessionEl){
      if (hasSession){
        savedSessionEl.style.display = 'block';
        savedSessionEl.textContent = `Saved PIN ${sessionInfo.pin}${sessionInfo.name ? ` · ${sessionInfo.name}` : ''}`;
        if (pinInput){ pinInput.value = sessionInfo.pin; }
        if (nameInput && !nameInput.value && sessionInfo.name){ nameInput.value = sessionInfo.name; }
        if (reconnectBtn){ reconnectBtn.disabled = false; }
        resumeManuallyShown = true;
      } else {
        savedSessionEl.style.display = 'none';
        if (reconnectBtn){ reconnectBtn.disabled = false; }
      }
    }
    const shouldShowResume = resumeManuallyShown || hasSession;
    if (resumeGroup){ resumeGroup.style.display = shouldShowResume ? 'block' : 'none'; }
    if (showResumeToggle){ showResumeToggle.style.display = shouldShowResume ? 'none' : 'inline-block'; }
    if (nameHelper){
      nameHelper.textContent = hasSession
        ? 'Welcome back! Enter your PIN to hop back in.'
        : 'We’ll generate your PIN right after launch.';
    }
    if (shouldShowResume){
      if (hasSession && pinInput){
        try{ pinInput.focus({ preventScroll: true }); }
        catch(e){ try{ pinInput.focus(); }catch(_e){} }
        try{ pinInput.select(); }catch(e){}
      } else if (resumeManuallyShown && pinInput){
        try{ pinInput.focus({ preventScroll: true }); }
        catch(e){ try{ pinInput.focus(); }catch(_e){} }
      }
    } else if (nameInput && (!document.activeElement || document.activeElement === document.body || document.activeElement === pinInput)){
      try{ nameInput.focus({ preventScroll: true }); }
      catch(e){ try{ nameInput.focus(); }catch(_e){} }
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
  if (roundRecapDismiss){ roundRecapDismiss.addEventListener('click', ()=> hideRoundRecap(true)); }
  if (roundRecapClose){ roundRecapClose.addEventListener('click', ()=> hideRoundRecap()); }
  if (roundRecapPanel){
    roundRecapPanel.addEventListener('click', (event)=>{
      if (event.target === roundRecapPanel){ hideRoundRecap(); }
    });
  }
  document.addEventListener('keydown', (event)=>{
    if ((event.key === 'Escape' || event.key === 'Esc') && roundRecapPanel && roundRecapPanel.classList.contains('show')){
      hideRoundRecap();
    }
  });

  const finalModal = document.getElementById('finalModal');
  const finalChampion = document.getElementById('finalChampion');
  const finalTableInner = document.getElementById('finalTableInner');
  const closeFinal = document.getElementById('closeFinal');

  let joined=false, inHold=false, exhausted=false, roundActive=false, releasedOut=false, disabledUI=false, phase='idle', myId=null;
  let activeStart=0, activationTs=0, timerInt=null;
  let nextReadyState = { active:false, readyIds:[] };
  let nextReadyTimer = null;
  let nextReadyCountdownCfg = null;
  let noHoldAnnouncedRound = null;

  let latestLobby = { lobby: [], started:false, currentRound:0, totalRounds:0, roundActive:false, phase:'idle', timeBankMinutes:null };
  let startingTimeBankMinutes = null;
  const latestLobbyById = new Map();
  const latestLobbyByName = new Map();
  let myTokensKnown = 0;
  let roundRecapAutoTimer = null;
  let roundRecapCloseTimer = null;
  let roundRecapPrevFocus = null;
  let inlineAnnouncementTimer = null;
  let inlineAnnouncementText = null;
  let inlineAnnouncementPrev = '';

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

  function stopNextReadyCountdown(){ if (nextReadyTimer){ clearInterval(nextReadyTimer); nextReadyTimer = null; } }
  function drawNextReadyCountdown(){
    if (!nextReadyCountdownPlayer || !nextReadyCountdownCfg){
      if (nextReadyCountdownPlayer){ nextReadyCountdownPlayer.style.display='none'; nextReadyCountdownPlayer.textContent=''; }
      stopNextReadyCountdown();
      syncRoundRecapCountdown(null);
      return;
    }
    const remain = Math.max(0, (nextReadyCountdownCfg.startTs + nextReadyCountdownCfg.durationMs) - serverNow());
    const label = 'Auto-start in ' + Math.ceil(remain/1000) + 's';
    nextReadyCountdownPlayer.textContent = label;
    nextReadyCountdownPlayer.style.display = 'inline-block';
    syncRoundRecapCountdown(remain);
    if (remain <= 0){
      stopNextReadyCountdown();
      hideRoundRecap();
    } else if (roundRecapPanel && roundRecapPanel.classList.contains('show')){
      const buffer = Math.max(2200, remain + 1200);
      scheduleRoundRecapAutoHide(buffer);
    }
  }

  function clearRoundRecapTimers(){
    if (roundRecapAutoTimer){ clearTimeout(roundRecapAutoTimer); roundRecapAutoTimer = null; }
    if (roundRecapCloseTimer){ clearTimeout(roundRecapCloseTimer); roundRecapCloseTimer = null; }
  }
  function captureRoundRecapFocus(){
    if (!roundRecapPanel || roundRecapPanel.classList.contains('show')) return;
    const active = document.activeElement;
    if (active && active !== document.body){ roundRecapPrevFocus = active; }
  }
  function restoreRoundRecapFocus(){
    if (roundRecapPrevFocus && typeof roundRecapPrevFocus.focus === 'function'){
      try{ roundRecapPrevFocus.focus(); }catch(e){}
    }
    roundRecapPrevFocus = null;
  }
  function hideRoundRecap(immediate){
    if (!roundRecapPanel) return;
    clearRoundRecapTimers();
    if (!roundRecapPanel.classList.contains('show')){
      if (roundRecapFooterNote) roundRecapFooterNote.textContent='';
      return;
    }
    if (immediate){
      roundRecapPanel.classList.remove('show');
      roundRecapPanel.classList.remove('closing');
      roundRecapPanel.classList.remove('alert');
      if (roundRecapFooterNote) roundRecapFooterNote.textContent='';
      restoreRoundRecapFocus();
      return;
    }
    roundRecapPanel.classList.add('closing');
    roundRecapCloseTimer = setTimeout(()=>{
      roundRecapPanel.classList.remove('show');
      roundRecapPanel.classList.remove('closing');
      roundRecapPanel.classList.remove('alert');
      if (roundRecapFooterNote) roundRecapFooterNote.textContent='';
      roundRecapCloseTimer = null;
      restoreRoundRecapFocus();
    }, 320);
  }
  function scheduleRoundRecapAutoHide(ms){
    if (roundRecapAutoTimer){ clearTimeout(roundRecapAutoTimer); roundRecapAutoTimer = null; }
    if (!roundRecapPanel || !roundRecapPanel.classList.contains('show')) return;
    roundRecapAutoTimer = setTimeout(()=>{ hideRoundRecap(); }, Math.max(1200, ms||0));
  }
  function syncRoundRecapCountdown(remainMs){
    if (!roundRecapFooterNote) return;
    if (!roundRecapPanel || !roundRecapPanel.classList.contains('show')){
      roundRecapFooterNote.textContent = '';
      return;
    }
    if (remainMs == null){
      if (nextReadyCountdownCfg){
        const calc = Math.max(0, (nextReadyCountdownCfg.startTs + nextReadyCountdownCfg.durationMs) - serverNow());
        syncRoundRecapCountdown(calc);
        return;
      }
      roundRecapFooterNote.textContent = 'Tap "I\'m ready" when you\'re set.';
      return;
    }
    if (remainMs <= 0){
      roundRecapFooterNote.textContent = '';
      return;
    }
    roundRecapFooterNote.textContent = 'Auto-start in ' + Math.ceil(remainMs/1000) + 's';
  }

  function announceInline(title, sub, ms=3200){
    if (!roundResult) return;
    const message = [title, sub].filter(Boolean).join(' — ');
    const showingPrevious = inlineAnnouncementTimer && inlineAnnouncementText && roundResult.textContent === inlineAnnouncementText;
    if (!showingPrevious){ inlineAnnouncementPrev = roundResult.textContent || ''; }
    if (inlineAnnouncementTimer){ clearTimeout(inlineAnnouncementTimer); inlineAnnouncementTimer = null; }
    inlineAnnouncementText = message;
    roundResult.textContent = message;
    inlineAnnouncementTimer = setTimeout(()=>{
      if (roundResult && roundResult.textContent === inlineAnnouncementText){
        roundResult.textContent = inlineAnnouncementPrev;
      }
      inlineAnnouncementTimer = null;
      inlineAnnouncementText = null;
    }, Math.max(1500, ms||0));
  }

  function clearNoHoldVisual(){
    if (roundResult){
      roundResult.classList.remove('round-result--alert');
      if (!roundResult.classList.contains('muted')){
        roundResult.classList.add('muted');
      }
    }
    if (holdArea){ holdArea.classList.remove('no-hold'); }
  }

  function showNoHoldBanner(round, { vibrate=true }={}){
    const roundNumber = (typeof round === 'number' && Number.isFinite(round)) ? round : null;
    const message = roundNumber != null ? `Round ${roundNumber}: Nobody held!` : 'Nobody held!';
    if (roundResult){
      roundResult.textContent = message;
      roundResult.classList.add('round-result--alert');
      roundResult.classList.remove('muted');
    }
    if (holdArea){ holdArea.classList.add('no-hold'); }
    if (vibrate && typeof navigator !== 'undefined' && navigator.vibrate && noHoldAnnouncedRound !== roundNumber){
      try{ navigator.vibrate([220, 90, 220]); }catch(e){}
    }
    if (roundNumber != null){ noHoldAnnouncedRound = roundNumber; }
  }

  function numberOrNull(val){ const n = Number(val); return Number.isFinite(n) ? n : null; }
  function formatTokens(val){ const n = numberOrNull(val); if (n == null) return '—'; return n + ' token' + (n === 1 ? '' : 's'); }
  function formatTimeBankMinutes(minutes){
    const raw = Number(minutes);
    if (!Number.isFinite(raw)) return null;
    const totalSeconds = Math.max(0, Math.round(raw * 60));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (secs === 0) return mins + ' min';
    if (mins === 0) return secs + ' sec';
    return mins + ' min ' + secs + ' sec';
  }

  function describePhaseTag(tag, { started=false, active=false }={}){
    switch(tag){
      case 'arming': return 'Arming players';
      case 'countdown': return 'Countdown';
      case 'active': return 'Round in progress';
      case 'exhausted': return 'Bank exhausted';
      case 'ended': return started ? 'Round ended' : 'Match complete';
      default:
        if (active) return 'Round in progress';
        return started ? 'Between rounds' : 'Waiting to start';
    }
  }

  function updateMatchMeta(){
    const started = !!(latestLobby && latestLobby.started);
    const totalRounds = Number(latestLobby && latestLobby.totalRounds) || 0;
    const currentRound = Number(latestLobby && latestLobby.currentRound) || 0;
    const roundIsActive = !!(roundActive || (latestLobby && latestLobby.roundActive));
    const phaseTag = phase || (latestLobby && latestLobby.phase) || 'idle';

    let roundText = started ? 'Match in progress' : 'Waiting for host';
    let roundDetail = '';

    if (totalRounds > 0){
      if (!started && currentRound === 0){
        roundText = `Round 1 of ${totalRounds}`;
        roundDetail = 'Waiting to start';
      } else if (phaseTag === 'idle' && !roundIsActive){
        if (currentRound >= totalRounds){
          roundText = `Match complete · ${totalRounds} rounds`;
          roundDetail = 'Awaiting new match';
        } else {
          const nextRound = Math.min(totalRounds, Math.max(1, currentRound + (started ? 1 : 0)));
          if (currentRound <= 0){
            roundText = `Round 1 of ${totalRounds}`;
            roundDetail = 'Waiting to start';
          } else {
            roundText = `Next: Round ${nextRound} of ${totalRounds}`;
            roundDetail = `Last round: #${currentRound}`;
          }
        }
      } else {
        const displayRound = currentRound > 0 ? currentRound : Math.min(totalRounds, 1);
        roundText = `Round ${displayRound} of ${totalRounds}`;
        roundDetail = describePhaseTag(phaseTag, { started, active: roundIsActive });
      }
    } else if (started){
      roundDetail = describePhaseTag(phaseTag, { started, active: roundIsActive });
    }

    if (roundStatusEl){ roundStatusEl.textContent = roundText; }
    if (roundStatusDetailEl){
      roundStatusDetailEl.textContent = roundDetail || '';
      roundStatusDetailEl.style.display = roundDetail ? '' : 'none';
    }

    const fallbackBank = (latestLobby && typeof latestLobby.timeBankMinutes === 'number') ? Number(latestLobby.timeBankMinutes) : null;
    const bankMinutes = (startingTimeBankMinutes != null && Number.isFinite(Number(startingTimeBankMinutes))) ? Number(startingTimeBankMinutes) : fallbackBank;
    if (timeBankValueEl){
      if (bankMinutes != null && Number.isFinite(bankMinutes)){
        const formatted = formatTimeBankMinutes(bankMinutes) || (bankMinutes + ' min');
        timeBankValueEl.textContent = formatted;
        if (timeBankDetailEl){ timeBankDetailEl.style.display = 'block'; }
      } else {
        timeBankValueEl.textContent = '—';
        if (timeBankDetailEl){ timeBankDetailEl.style.display = 'none'; }
      }
    }
  }

  function rebuildLobbySnapshot(payload){
    const prev = latestLobby || { currentRound:0, totalRounds:0, phase:'idle', timeBankMinutes:null };
    latestLobbyById.clear();
    latestLobbyByName.clear();
    const list = (payload && Array.isArray(payload.lobby)) ? payload.lobby : [];
    const copy = [];
    for (const item of list){
      if (!item) continue;
      const entry = {
        id: item.id || null,
        name: item.name || '',
        tokens: numberOrNull(item.tokens) ?? 0,
        exhausted: !!item.exhausted,
      };
      copy.push(entry);
      if (entry.id){ latestLobbyById.set(entry.id, entry); }
      if (entry.name){ latestLobbyByName.set(entry.name, entry); }
    }
    latestLobby = {
      lobby: copy,
      started: !!(payload && payload.started),
      currentRound: (payload && typeof payload.currentRound === 'number') ? payload.currentRound : (prev.currentRound || 0),
      totalRounds: (payload && typeof payload.totalRounds === 'number') ? payload.totalRounds : (prev.totalRounds || 0),
      roundActive: !!(payload && payload.roundActive),
      phase: (payload && payload.phase) || prev.phase || 'idle',
      timeBankMinutes: (payload && typeof payload.timeBankMinutes === 'number') ? Number(payload.timeBankMinutes) : prev.timeBankMinutes,
    };
    if (typeof latestLobby.timeBankMinutes === 'number' && Number.isFinite(latestLobby.timeBankMinutes)){
      startingTimeBankMinutes = latestLobby.timeBankMinutes;
    }
    updateMatchMeta();
  }

  function getMyLobbyEntry(){ return myId ? (latestLobbyById.get(myId) || null) : null; }

  function applyRoundResultSnapshot(data){
    if (!data) return;
    if (typeof data.round === 'number'){ latestLobby.currentRound = data.round; }
    if (typeof data.totalRounds === 'number'){ latestLobby.totalRounds = data.totalRounds; }
    if (typeof data.roundsLeft === 'number'){ latestLobby.roundsLeft = data.roundsLeft; }
    latestLobby.roundActive = false;
    latestLobby.phase = 'idle';
    if (data.winner && typeof data.winnerTokens === 'number'){
      const winnerEntry = latestLobbyByName.get(data.winner);
      if (winnerEntry){ winnerEntry.tokens = numberOrNull(data.winnerTokens) ?? winnerEntry.tokens; }
    }
    if (data.leaderName && typeof data.leaderTokens === 'number'){
      const leaderEntry = latestLobbyByName.get(data.leaderName);
      if (leaderEntry){ leaderEntry.tokens = numberOrNull(data.leaderTokens) ?? leaderEntry.tokens; }
    }
    updateMatchMeta();
  }

  function buildRoundRecapModel(data){
    const round = (data && typeof data.round === 'number') ? data.round : (latestLobby.currentRound || 0);
    const totalRounds = (data && typeof data.totalRounds === 'number') ? data.totalRounds : (latestLobby.totalRounds || 0);
    const fallbackRoundsLeft = typeof latestLobby.roundsLeft === 'number' ? latestLobby.roundsLeft : Math.max(0, Math.max(totalRounds, round) - round);
    const roundsLeft = (data && typeof data.roundsLeft === 'number') ? data.roundsLeft : fallbackRoundsLeft;
    const finalRound = !!(data && data.finalRound);
    const winnerName = data && data.winner ? data.winner : null;
    const winnerMs = numberOrNull(data && data.winnerMs);
    const winnerTokens = numberOrNull(data && data.winnerTokens);
    const leaderName = data && data.leaderName ? data.leaderName : null;
    const leaderTokens = numberOrNull(data && data.leaderTokens);
    const bonusValue = numberOrNull(data && data.bonusValue);
    const myName = playerName ? playerName.textContent : '';
    const reason = data && typeof data.reason === 'string' ? data.reason : '';
    const isNoHold = reason === 'no-hold';

    const meEntry = getMyLobbyEntry();
    let myTokens = meEntry ? numberOrNull(meEntry.tokens) : null;
    if (winnerName && myName && winnerName === myName && winnerTokens != null){ myTokens = winnerTokens; }
    if (myTokens == null && Number.isFinite(myTokensKnown)){ myTokens = myTokensKnown; }
    if (meEntry && myTokens != null){ meEntry.tokens = myTokens; }
    if (myTokens != null){ myTokensKnown = myTokens; }

    let leaderDisplayName = leaderName || (leaderTokens != null ? 'Leader' : '—');
    if (leaderName && myName && leaderName === myName){ leaderDisplayName = 'You'; }

    let leaderValue = leaderDisplayName;
    let leaderNote = leaderTokens != null ? formatTokens(leaderTokens) : '';
    const participants = Array.isArray(latestLobby.lobby) ? latestLobby.lobby : [];
    let tieCount = 0;
    if (leaderTokens != null){
      tieCount = participants.filter(p => p && numberOrNull(p.tokens) === leaderTokens).length;
      if (tieCount === 0 && leaderName){ tieCount = 1; }
    }

    let gapValue = '—';
    let gapNote = '';
    if (leaderTokens != null && myTokens != null){
      const diff = leaderTokens - myTokens;
      if (diff === 0){
        if (tieCount > 1){
          gapValue = 'Tied for lead';
          gapNote = tieCount === 2 ? 'Sharing lead with 1 player' : `Sharing lead with ${tieCount-1} players`;
        } else {
          gapValue = 'You lead';
          gapNote = leaderName && leaderName !== myName ? `Ahead of ${leaderName}` : 'Keep the momentum';
        }
      } else if (diff > 0){
        gapValue = `${diff} behind`;
        const chase = formatTokens(diff);
        gapNote = leaderName ? `${chase} to catch ${leaderName}` : `Leader ahead by ${chase}`;
      } else {
        const ahead = Math.abs(diff);
        gapValue = `${ahead} ahead`;
        gapNote = `Up by ${formatTokens(ahead)}`;
      }
    } else if (myTokens != null){
      gapValue = formatTokens(myTokens);
      gapNote = 'Your total';
    }

    const roundLabel = round > 0 ? `Round ${round}` : 'Round recap';
    const title = `${roundLabel}${totalRounds ? ` · ${totalRounds} total` : ''}`;
    let subtitle;
    let summary;
    let fallbackText;
    if (winnerName){
      const held = winnerMs != null ? fmt(winnerMs) : '—';
      subtitle = `Winner: ${winnerName}${winnerTokens != null ? ` · 🏆 ${winnerTokens}` : ''}`;
      summary = `${winnerName} held for ${held}${bonusValue && bonusValue > 1 ? ` · Bonus ×${bonusValue}` : ''}.`;
      fallbackText = `${roundLabel}: ${winnerName} held ${held}${winnerTokens != null ? ` · 🏆 ${winnerTokens}` : ''}`;
    } else if (isNoHold){
      subtitle = 'Nobody held this round';
      summary = 'The round ended with zero holds — the pot stays put.';
      fallbackText = `${roundLabel}: Nobody held!`;
    } else {
      subtitle = 'No winner this round';
      summary = 'Everyone released or timed out before the finish.';
      fallbackText = `${roundLabel}: No winner`;
    }
    if (finalRound){
      summary += ' Match complete!';
      fallbackText += ' · Match complete';
    }

    let roundsLeftValue = roundsLeft === 0 ? (finalRound ? 'Match complete' : 'Final round') : `${roundsLeft} left`;
    if (roundsLeft < 0) roundsLeftValue = '—';
    const roundsLeftNote = totalRounds ? `${round}/${totalRounds} played` : '';

    const bonusActive = bonusValue != null && bonusValue > 1;
    const bonusDisplay = bonusActive ? `×${bonusValue}` : '—';
    const bonusNote = bonusActive ? 'Bonus round active' : 'Standard value';

    latestLobby.roundsLeft = roundsLeft;

    return {
      title,
      subtitle,
      summary,
      leaderValue,
      leaderNote,
      gapValue,
      gapNote,
      bonusActive,
      bonusDisplay,
      bonusNote,
      roundsLeftValue,
      roundsLeftNote,
      fallback: fallbackText,
      autoHideMs: 10000,
      tone: isNoHold ? 'danger' : 'default',
    };
  }

  function renderRoundRecap(model){
    if (!roundRecapPanel || !model) return;
    clearRoundRecapTimers();
    try{
      captureRoundRecapFocus();
      if (roundRecapLabel){
        const subtitleText = (model.subtitle || '').trim();
        const winnerSubtitle = /^winner\s*:/i.test(subtitleText);
        roundRecapLabel.textContent = winnerSubtitle ? 'Round Winner' : 'Round Recap';
      }
      if (roundRecapTitle) roundRecapTitle.textContent = model.title || 'Round Recap';
      if (roundRecapSubtitle) roundRecapSubtitle.textContent = model.subtitle || '';
      if (roundRecapSummary) roundRecapSummary.textContent = model.summary || '';
      if (roundRecapLeader) roundRecapLeader.textContent = model.leaderValue || '—';
      if (roundRecapLeaderNote) roundRecapLeaderNote.textContent = model.leaderNote || '';
      if (roundRecapGap) roundRecapGap.textContent = model.gapValue || '—';
      if (roundRecapGapNote) roundRecapGapNote.textContent = model.gapNote || '';
      if (roundRecapRoundsLeft) roundRecapRoundsLeft.textContent = model.roundsLeftValue || '—';
      if (roundRecapRoundsLeftNote) roundRecapRoundsLeftNote.textContent = model.roundsLeftNote || '';
      if (roundRecapBonus){ roundRecapBonus.textContent = model.bonusDisplay || '—'; }
      if (roundRecapBonusStat){
        if (model.bonusActive){
          roundRecapBonusStat.style.display = '';
          if (roundRecapBonusNote){ roundRecapBonusNote.textContent = model.bonusNote || ''; }
        } else {
          roundRecapBonusStat.style.display = 'none';
          if (roundRecapBonusNote){ roundRecapBonusNote.textContent = ''; }
        }
      }
      roundRecapPanel.classList.remove('closing');
      roundRecapPanel.classList.toggle('alert', model.tone === 'danger');
      roundRecapPanel.classList.add('show');
      syncRoundRecapCountdown(null);
      const remain = nextReadyCountdownCfg ? Math.max(0, (nextReadyCountdownCfg.startTs + nextReadyCountdownCfg.durationMs) - serverNow()) : null;
      const autoHide = remain != null && remain > 0 ? Math.min(model.autoHideMs, Math.max(2200, remain + 1200)) : model.autoHideMs;
      scheduleRoundRecapAutoHide(autoHide);
      if (roundRecapDismiss){
        requestAnimationFrame(()=>{
          if (roundRecapPanel && roundRecapPanel.classList.contains('show')){
            try{ roundRecapDismiss.focus(); }catch(e){}
          }
        });
      } else if (roundRecapClose){
        requestAnimationFrame(()=>{
          if (roundRecapPanel && roundRecapPanel.classList.contains('show')){
            try{ roundRecapClose.focus(); }catch(e){}
          }
        });
      }
    }catch(e){}
  }
  function updateNextReadyUI(){
    if (!nextReadyPanel || !toggleReadyBtn) return;
    const active = !!(nextReadyState && nextReadyState.active && joined && phase === 'idle' && !roundActive);
    if (!active){
      nextReadyCountdownCfg = null;
      nextReadyPanel.style.display = 'none';
      if (nextReadyCountdownPlayer){ nextReadyCountdownPlayer.style.display = 'none'; nextReadyCountdownPlayer.textContent=''; }
      stopNextReadyCountdown();
      syncRoundRecapCountdown(null);
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
  }

  function setHoldClasses({ idle=false, pressed=false, disabled=false }){ const el = holdArea; el.classList.toggle('idle', !!idle); el.classList.toggle('pressed', !!pressed); el.classList.toggle('disabled', !!disabled); el.setAttribute('aria-pressed', pressed ? 'true' : 'false'); }

  function setPhaseUI(tag){
    phase = tag;
    const cls = ['ph-idle','ph-arming','ph-countdown','ph-active','ph-ended','ph-exhausted'];
    const timerCls = ['is-idle','is-arming','is-countdown','is-active','is-ended','is-exhausted'];
    phaseBadge.classList.remove(...cls);
    if (roundTimerPanel){ roundTimerPanel.classList.remove(...timerCls); }
    switch(tag){
      case 'arming':
        phaseBadge.textContent = 'Arming'; phaseBadge.classList.add('ph-arming');
        phaseCopy.textContent  = 'Press & hold now — all players must hold to start';
        if (roundTimerPanel){ roundTimerPanel.classList.add('is-arming'); }
        break;
      case 'countdown':
        phaseBadge.textContent = 'Countdown'; phaseBadge.classList.add('ph-countdown');
        phaseCopy.textContent  = 'Release = out (this round)';
        if (roundTimerPanel){ roundTimerPanel.classList.add('is-countdown'); }
        break;
      case 'active':
        phaseBadge.textContent = 'Active'; phaseBadge.classList.add('ph-active');
        phaseCopy.textContent  = 'Bank draining — keep holding';
        if (roundTimerPanel){ roundTimerPanel.classList.add('is-active'); }
        break;
      case 'ended':
        phaseBadge.textContent = 'Game over'; phaseBadge.classList.add('ph-ended');
        phaseCopy.textContent  = 'See final results below';
        if (roundTimerPanel){ roundTimerPanel.classList.add('is-ended'); }
        break;
      case 'exhausted':
        phaseBadge.textContent = 'Exhausted'; phaseBadge.classList.add('ph-exhausted');
        phaseCopy.textContent  = 'You’re spectating until next match';
        if (roundTimerPanel){ roundTimerPanel.classList.add('is-exhausted'); }
        break;
      default:
        phaseBadge.textContent = 'Idle'; phaseBadge.classList.add('ph-idle');
        phaseCopy.textContent  = 'Waiting for host…';
        if (roundTimerPanel){ roundTimerPanel.classList.add('is-idle'); }
        break;
    }
    updateNextReadyUI();
    updateMatchMeta();
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
    joined=true; myId=d.id; playerName.textContent=d.name; tokenCountValue.textContent = (d.tokens != null ? d.tokens : '—');
    myTokensKnown = numberOrNull(d.tokens) ?? 0;
    myPinEl.textContent = d.pin || '';
    if (pinInput){ pinInput.value = d.pin || ''; }
    if (typeof d.timeBankMinutes === 'number' && Number.isFinite(d.timeBankMinutes)){
      startingTimeBankMinutes = Number(d.timeBankMinutes);
      latestLobby.timeBankMinutes = startingTimeBankMinutes;
    }
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
    if (joinHeader){ joinHeader.style.display='none'; joinHeader.setAttribute('aria-hidden','true'); }
    if (joinRulesPanel){ joinRulesPanel.style.display='none'; joinRulesPanel.setAttribute('aria-hidden','true'); }
    askNotifyPermission();
    setPhaseUI('idle'); updateHoldVisual(); stopTimer(); cancelHeartbeat();
    updateNextReadyUI();
    updateMatchMeta();
  });
  socket.on('reconnect_result', (r)=>{
    if (!r.ok){ setStatus(r.error || 'Reconnect failed.'); alert(r.error || 'Reconnect failed'); return; }
    setStatus('Reconnected with your PIN.');
    alert('Reconnected as '+(r.name||'Player'));
  });

  socket.on('lobby_update', (l)=>{
    rebuildLobbySnapshot(l || {});
    if (!joined) return;
    const me = getMyLobbyEntry();
    if (me){
      const tokens = numberOrNull(me.tokens) ?? 0;
      tokenCountValue.textContent = (tokens != null ? tokens : '—');
      myTokensKnown = tokens;
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
    nextReadyCountdownCfg = null; stopNextReadyCountdown(); if (nextReadyCountdownPlayer) nextReadyCountdownPlayer.style.display='none'; if (nextReadyPanel) nextReadyPanel.style.display='none';
    hideRoundRecap(true);
    clearNoHoldVisual();
    if (roundResult) roundResult.textContent='';
    if (exhausted){ disabledUI=false; try{ phaseCopy.textContent='Bank exhausted — press & hold to arm the next round (you can’t play).'; }catch(e){} }
    setPhaseUI('arming'); roundActive=false; releasedOut=false; disabledUI=false; updateHoldVisual(); stopTimer(); cancelHeartbeat(); notify('Round starting','Press & hold now — all players must hold.');
    latestLobby.phase = 'arming';
    latestLobby.roundActive = false;
    updateMatchMeta();
  });

  // Countdown 3,2,1,0 with unified activationTs
  let cdTimer = null;
  socket.on('countdown_started', (d)=>{
    hideRoundRecap(true);
    setPhaseUI('countdown'); if (exhausted){ disabledUI=false; try{ phaseCopy.textContent='Countdown — you’re exhausted and won’t play this round.';}catch(e){} } updateHoldVisual();
    activationTs = (d.startTs||serverNow()) + (d.durationMs||0);
    latestLobby.phase = 'countdown';
    latestLobby.roundActive = false;
    updateMatchMeta();
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

  socket.on('round_started', (d)=>{
    hideRoundRecap(true);
    const ts = activationTs || (d.startTs + (d.durationMs||0)) || serverNow();
    const delay = Math.max(0, ts - serverNow());
    if (typeof d.round === 'number'){ latestLobby.currentRound = d.round; }
    latestLobby.phase = 'active';
    latestLobby.roundActive = true;
    latestLobby.started = true;
    updateMatchMeta();
    setTimeout(()=>{
      setPhaseUI('active'); roundActive=true; releasedOut=false;
      if (exhausted){ disabledUI=true; }
      clearNoHoldVisual();
      updateHoldVisual(); roundResult.textContent=''; holdArea.classList.toggle('bonus', !!d.bonusActive);
      activeStart = ts; // exact activation epoch
      startTimer();
      cdOverlay.style.display='none'; scheduleHeartbeat(ts);
    }, delay);
  });

  socket.on('bonus_round_armed', (d={})=>{
    announceInline('Bonus round', 'Winner gets 🏆 ×'+(d.value||2), 3200);
    if (holdArea){ holdArea.classList.add('bonus'); }
  });

  socket.on('final_round_armed', (d={})=>{
    announceInline('Final round', 'Winner gets 🏆 '+(d.tokens||1), 3400);
  });

  socket.on('round_no_hold', (d={})=>{
    showNoHoldBanner(typeof d.round === 'number' ? d.round : null, { vibrate:true });
  });

  socket.on('game_started', (d={})=>{
    const txt = (d && d.rulesText) ? String(d.rulesText).replace(/\n/g, ' \u2022 ') : 'Game started';
    announceInline('Game started', txt, 4000);
    exhausted = false; disabledUI = false; updateNextReadyUI();
    latestLobby.started = true;
    latestLobby.roundActive = false;
    latestLobby.phase = 'idle';
    if (d && d.rules){
      if (typeof d.rules.totalRounds === 'number'){ latestLobby.totalRounds = Number(d.rules.totalRounds); }
      if (typeof d.rules.timeBankMinutes === 'number'){
        startingTimeBankMinutes = Number(d.rules.timeBankMinutes);
        latestLobby.timeBankMinutes = startingTimeBankMinutes;
      }
    }
    updateMatchMeta();
  });

  socket.on('round_result', (d={})=>{
    setPhaseUI('idle');
    roundActive=false; inHold=false; releasedOut=false; disabledUI=false;
    updateHoldVisual();
    if (holdArea){ holdArea.classList.remove('bonus'); }

    applyRoundResultSnapshot(d);
    const recapModel = buildRoundRecapModel(d);
    let fallback = recapModel && recapModel.fallback ? recapModel.fallback : 'Round recap unavailable.';
    const roundNumber = (typeof d.round === 'number' && Number.isFinite(d.round)) ? d.round : null;
    const reason = typeof d.reason === 'string' ? d.reason : '';
    const isNoHold = reason === 'no-hold';
    if (!recapModel){
      const roundLabel = (d && typeof d.round === 'number') ? `Round ${d.round}` : 'Round';
      if (d && d.winner){
        const held = (d && typeof d.winnerMs === 'number') ? fmt(d.winnerMs) : '—';
        const tokensStr = (d && d.winnerTokens!=null) ? ` · 🏆 ${d.winnerTokens}` : '';
        fallback = `${roundLabel}: ${d.winner} held ${held}${tokensStr}`;
      } else {
        fallback = `${roundLabel}: ${isNoHold ? 'Nobody held!' : 'No winner'}`;
      }
    }
    if (isNoHold){
      showNoHoldBanner(roundNumber, { vibrate: noHoldAnnouncedRound !== roundNumber });
      if (!recapModel && roundResult) roundResult.textContent = fallback;
    } else {
      clearNoHoldVisual();
      if (roundResult) roundResult.textContent = fallback;
    }

    if (recapModel){ renderRoundRecap(recapModel); } else { hideRoundRecap(true); }

    let latestTokens = numberOrNull(myTokensKnown);
    if (latestTokens == null){
      const me = getMyLobbyEntry();
      if (me){ latestTokens = numberOrNull(me.tokens); }
    }
    if (latestTokens != null){ tokenCountValue.textContent = latestTokens; }

    stopTimer(); cancelHeartbeat();
    updateNextReadyUI();
  });

  socket.on('game_over', (d)=>{
    nextReadyCountdownCfg = null; stopNextReadyCountdown(); if (nextReadyPanel) nextReadyPanel.style.display='none'; if (nextReadyCountdownPlayer) nextReadyCountdownPlayer.style.display='none';
    hideRoundRecap(true);
    clearNoHoldVisual();
    setPhaseUI('ended');
    latestLobby.roundActive = false;
    latestLobby.phase = 'ended';
    latestLobby.started = false;
    updateMatchMeta();
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
    finalModal.classList.add('show');
    requestAnimationFrame(()=>{
      closeFinal.focus({ preventScroll: true });
    });
  });
  closeFinal.onclick = ()=>{ finalModal.classList.remove('show'); };

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
