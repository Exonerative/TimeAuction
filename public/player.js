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

  const nextReadyCard = document.getElementById('nextReadyCard');
  const nextReadyCountEl = document.getElementById('nextReadyCount');
  const nextReadyRequiredEl = document.getElementById('nextReadyRequired');
  const nextReadyCountdownEl = document.getElementById('nextReadyCountdown');
  const nextReadyBtn = document.getElementById('nextReadyBtn');
  const nextReadyStatusEl = document.getElementById('nextReadyStatus');

  const phaseBadge = document.getElementById('phaseBadge');
  const phaseCopy  = document.getElementById('phaseCopy');
  const roundTimerEl = document.getElementById('roundTimer');
  const winnerBanner = document.getElementById('winnerBanner');
  const wbTitle = document.getElementById('wbTitle');
  const wbSub = document.getElementById('wbSub');
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
  let readyForNext=false, nextReadyActive=false;
  let nextReadyCountdownTs=0, nextReadyTicker=null, nextReadyRound=0;
  let activeStart=0, activationTs=0, timerInt=null;

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

  function drawNextReadyCountdown(){
    if (!nextReadyCountdownEl) return;
    if (!nextReadyCountdownTs){ nextReadyCountdownEl.textContent = 'Waiting for players…'; return; }
    const remain = Math.max(0, nextReadyCountdownTs - serverNow());
    if (remain <= 0){ nextReadyCountdownEl.textContent = 'Starting…'; return; }
    nextReadyCountdownEl.textContent = 'Auto-start in ' + (remain/1000).toFixed(1) + 's';
  }
  function ensureNextReadyTicker(active){
    if (active){
      if (nextReadyTicker) return;
      nextReadyTicker = setInterval(()=>{ if (nextReadyCountdownTs){ drawNextReadyCountdown(); } }, 100);
    } else if (nextReadyTicker){
      clearInterval(nextReadyTicker); nextReadyTicker=null;
    }
  }
  function updateNextReadyButton(){
    if (!nextReadyBtn || !nextReadyStatusEl) return;
    const roundLabel = nextReadyRound ? `Round ${nextReadyRound}` : 'the next round';
    if (!joined || !nextReadyActive){
      nextReadyBtn.disabled = true;
      nextReadyBtn.textContent = 'I\'m ready for the next round';
      nextReadyStatusEl.textContent = exhausted ? 'You are exhausted.' : 'Waiting for the host…';
      return;
    }
    const canInteract = !exhausted;
    nextReadyBtn.disabled = !canInteract;
    nextReadyBtn.textContent = readyForNext ? 'Ready! Tap to cancel' : 'I\'m ready for the next round';
    if (exhausted){
      nextReadyStatusEl.textContent = 'You are exhausted and cannot join ' + roundLabel + '.';
    } else if (readyForNext){
      nextReadyStatusEl.textContent = 'You are ready for ' + roundLabel + '.';
    } else {
      nextReadyStatusEl.textContent = 'Tap when you\'re ready for ' + roundLabel + '.';
    }
  }
  function resetNextReadyState(){
    readyForNext = false;
    nextReadyActive = false;
    nextReadyCountdownTs = 0;
    nextReadyRound = 0;
    ensureNextReadyTicker(false);
    if (nextReadyCard) nextReadyCard.style.display = 'none';
    drawNextReadyCountdown();
    updateNextReadyButton();
  }

  function startHold(){ if (!joined || disabledUI) return; if (exhausted && phase==='active') return; if (phase==='idle') return; if (phase==='countdown' || phase==='active'){ if (releasedOut) return; } inHold = true; socket.emit('hold_press'); updateHoldVisual(); }
  function endHold(){ if (!inHold) return; inHold=false; socket.emit('hold_release'); if (phase==='countdown' || phase==='active'){ releasedOut=true; disabledUI=true; } updateHoldVisual(); }

  // events
  if (nextReadyBtn){
    nextReadyBtn.addEventListener('click', ()=>{
      if (!joined || !nextReadyActive || exhausted) return;
      if (readyForNext){
        readyForNext = false;
        socket.emit('player_unready_next');
      } else {
        readyForNext = true;
        socket.emit('player_ready_next');
      }
      updateNextReadyButton();
    });
  }
  joinBtn.onclick = ()=>{ const name = nameInput.value.trim().slice(0,24) || 'Player'; socket.emit('player_join', { name }); };
  reconnectBtn.onclick = ()=>{ const pin = pinInput.value.trim(); if (!pin) return alert('Enter your PIN'); socket.emit('player_reconnect', { pin }); };
  document.addEventListener('contextmenu', e=>e.preventDefault());
  holdArea.addEventListener('touchstart', e=>{ e.preventDefault(); startHold(); }, {passive:false});
  holdArea.addEventListener('touchend',   e=>{ e.preventDefault(); endHold(); }, {passive:false});
  holdArea.addEventListener('touchcancel',e=>{ e.preventDefault(); endHold(); }, {passive:false});
  holdArea.addEventListener('mousedown',  e=>{ e.preventDefault(); startHold(); });
  window.addEventListener('mouseup',      e=>{ endHold(); });
  holdArea.addEventListener('mouseleave', e=>{ endHold(); });

  socket.on('joined', (d)=>{
    joined=true; myId=d.id; playerName.textContent=d.name; tokenCount.textContent='🏆 '+d.tokens;
    myPinEl.textContent = d.pin || '';
    joinCard.style.display='none'; gameCard.style.display='block';
    askNotifyPermission();
    setPhaseUI('idle'); updateHoldVisual(); stopTimer(); cancelHeartbeat(); resetNextReadyState();
  });
  socket.on('reconnect_result', (r)=>{
    if (!r.ok){ alert(r.error || 'Reconnect failed'); return; }
    alert('Reconnected as '+(r.name||'Player'));
  });

  socket.on('lobby_update', (l)=>{ if (!joined) return; const me=(l.lobby||[]).find(p=>p.id===myId); if (me){ tokenCount.textContent='🏆 '+me.tokens; } });

  socket.on('arming_started', ()=>{ if (exhausted){ disabledUI=false; try{ phaseCopy.textContent='Bank exhausted — press & hold to arm the next round (you can’t play).'; }catch(e){} } setPhaseUI('arming'); roundActive=false; releasedOut=false; disabledUI=false; updateHoldVisual(); stopTimer(); cancelHeartbeat(); ensureNextReadyTicker(false); nextReadyCountdownTs=0; readyForNext=false; nextReadyActive=false; if (nextReadyCard) nextReadyCard.style.display='none'; notify('Round starting','Press & hold now — all players must hold.'); });

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

  socket.on('round_result', (d)=>{ setPhaseUI('idle'); roundActive=false; inHold=false; releasedOut=false; disabledUI=false; updateHoldVisual(); if (d.winner){ roundResult.textContent = 'Round '+d.round+': '+d.winner+' held '+fmt(d.winnerMs)+' · now at '+d.winnerTokens; if (winnerBanner){ wbTitle.textContent = d.winner + ' wins Round ' + d.round; wbSub.textContent = 'Held ' + fmt(d.winnerMs) + ' · 🏆 ' + d.winnerTokens; winnerBanner.classList.add('show'); setTimeout(()=> winnerBanner.classList.remove('show'), 2600); } } stopTimer(); cancelHeartbeat(); });

  socket.on('game_over', (d)=>{
    setPhaseUI('ended');
    resetNextReadyState();
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

  socket.on('exhausted', ()=>{ setPhaseUI('exhausted'); exhausted=true; inHold=false; disabledUI=true; readyForNext=false; updateHoldVisual(); updateNextReadyButton(); vibrate(80); exhaustedMsg.style.display='block'; setTimeout(()=>exhaustedMsg.style.display='none', 2500); });

  socket.on('next_round_ready_state', (d)=>{
    if (!joined) return;
    nextReadyRound = d && d.nextRound ? d.nextRound : 0;
    const active = !!(d && d.active);
    if (active){
      nextReadyActive = true;
      if (nextReadyCard) nextReadyCard.style.display = 'block';
      if (nextReadyCountEl) nextReadyCountEl.textContent = d.readyCount || 0;
      if (nextReadyRequiredEl) nextReadyRequiredEl.textContent = d.requiredCount || 0;
      nextReadyCountdownTs = d.countdownEndsAt || 0;
      drawNextReadyCountdown();
      ensureNextReadyTicker(!!nextReadyCountdownTs);
    } else {
      nextReadyActive = false;
      readyForNext = false;
      nextReadyCountdownTs = 0;
      ensureNextReadyTicker(false);
      if (nextReadyCard) nextReadyCard.style.display = 'none';
    }
    updateNextReadyButton();
  });

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
    resetNextReadyState();
    const txt = (d && d.rulesText) ? String(d.rulesText).replace(/\n/g, ' \u2022 ') : 'Game started';
    showBanner('Game Started', txt, 4000);
  });
