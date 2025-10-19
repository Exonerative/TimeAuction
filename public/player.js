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
  const winnerBanner = document.getElementById('winnerBanner');
  const wbTitle = document.getElementById('wbTitle');
  const wbSub = document.getElementById('wbSub');
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
  function showBanner(title, sub, ms=2600){
    if (!winnerBanner) return;
    try{
      wbTitle.textContent = String(title||'');
      wbSub.textContent = String(sub||'');
      winnerBanner.classList.add('show');
      setTimeout(()=> winnerBanner.classList.remove('show'), Math.max(800, ms));
    }catch(e){}
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
    if (!nextReadyCountdownPlayer || !nextReadyCountdownCfg){ if (nextReadyCountdownPlayer) nextReadyCountdownPlayer.style.display='none'; stopNextReadyCountdown(); return; }
    const remain = Math.max(0, (nextReadyCountdownCfg.startTs + nextReadyCountdownCfg.durationMs) - serverNow());
    nextReadyCountdownPlayer.textContent = 'Auto-start in ' + Math.ceil(remain/1000) + 's';
    nextReadyCountdownPlayer.style.display = 'inline-block';
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

  socket.on('lobby_update', (l)=>{
    if (!joined) return;
    const me=(l.lobby||[]).find(p=>p.id===myId);
    if (me){
      tokenCount.textContent='🏆 '+me.tokens;
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
    if (exhausted){ disabledUI=false; try{ phaseCopy.textContent='Bank exhausted — press & hold to arm the next round (you can’t play).'; }catch(e){} }
    setPhaseUI('arming'); roundActive=false; releasedOut=false; disabledUI=false; updateHoldVisual(); stopTimer(); cancelHeartbeat(); notify('Round starting','Press & hold now — all players must hold.');
  });

  // Countdown 3,2,1,0 with unified activationTs
  let cdTimer = null;
  socket.on('countdown_started', (d)=>{
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

  socket.on('round_started', (d)=>{
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

  socket.on('round_result', (d)=>{ setPhaseUI('idle'); roundActive=false; inHold=false; releasedOut=false; disabledUI=false; updateHoldVisual(); if (d.winner){ roundResult.textContent = 'Round '+d.round+': '+d.winner+' held '+fmt(d.winnerMs)+' · now at '+d.winnerTokens; if (winnerBanner){ wbTitle.textContent = d.winner + ' wins Round ' + d.round; wbSub.textContent = 'Held ' + fmt(d.winnerMs) + ' · 🏆 ' + d.winnerTokens; winnerBanner.classList.add('show'); setTimeout(()=> winnerBanner.classList.remove('show'), 2600); } } stopTimer(); cancelHeartbeat(); updateNextReadyUI(); });

  socket.on('game_over', (d)=>{
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
  socket.on('bonus_round_armed', (d)=>{
    showBanner('BONUS ROUND', 'Winner gets 🏆 ×'+(d.value||2), 3200);
    holdArea.classList.add('bonus');
  });
  socket.on('final_round_armed', (d)=>{
    showBanner('FINAL ROUND', 'Winner gets 🏆 '+(d.tokens||1), 3400);
  });

  socket.on('game_started', (d)=>{
    const txt = (d && d.rulesText) ? String(d.rulesText).replace(/\n/g, ' \u2022 ') : 'Game started';
    showBanner('Game Started', txt, 4000);
    exhausted = false; disabledUI = false; updateNextReadyUI();
  });
