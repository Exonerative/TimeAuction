(function(){
  const socket = io({ query: { role: 'host' } });
  // Sync to server clock for accurate countdowns
  socket.on('server_now', (d)=>{
    try{
      const offset = (d && typeof d.now==='number' ? d.now : Date.now()) - Date.now();
      window.__getServerNow = ()=> Date.now() + offset;
    }catch(e){}
  });

  const serverNow = ()=> (window.__getServerNow ? window.__getServerNow() : Date.now());
  const lobbyEl = document.getElementById('lobby');
  const roundNumEl = document.getElementById('roundNum');
  const roundTotalEl = document.getElementById('roundTotal');
  const phaseEl = document.getElementById('phase');
  const roundTimerEl = document.getElementById('roundTimer');
  const armingRow = document.getElementById('armingRow');
  const readyCountEl = document.getElementById('readyCount');
  const requiredCountEl = document.getElementById('requiredCount');
  const lastResultEl = document.getElementById('lastResult');
  const hostScoreTable = document.getElementById('hostScoreTable');
  const activeHoldsEl = document.getElementById('activeHolds');
  const nextReadyBlock = document.getElementById('nextReadyBlock');
  const nextReadyCounts = document.getElementById('nextReadyCounts');
  const nextReadyNames = document.getElementById('nextReadyNames');
  const nextReadyCountdown = document.getElementById('nextReadyCountdown');
  const startRoundBtn = document.getElementById('startRound');
  const endRoundBtn = document.getElementById('endRound');
  const historyMiniEl = document.getElementById('historyMini');
  const fStatusChip = document.getElementById('fStatusChip');
  const fPreview = document.getElementById('fPreview');
  const toastsEl = document.getElementById('toasts');
  const openPresentationBtn = document.getElementById('openPresentation');

  const APPLIED_TIMEOUT = 3200;
  const appliedTimers = new WeakMap();
  const pendingButtons = new Map();

  function showToast(message, type = 'success'){
    if (!toastsEl || !message) return;
    const toast = document.createElement('div');
    toast.className = 'toast' + (type === 'error' ? ' error' : ' success');
    toast.textContent = message;
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-6px)';
    toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    toastsEl.appendChild(toast);
    requestAnimationFrame(()=>{
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(()=>{
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-6px)';
      setTimeout(()=>{ if (toast.parentNode) toast.parentNode.removeChild(toast); }, 260);
    }, 3200);
  }

  function clearAppliedState(button){
    if (!button) return;
    const timer = appliedTimers.get(button);
    if (timer) clearTimeout(timer);
    appliedTimers.delete(button);
    button.disabled = false;
    button.classList.remove('applied');
  }

  function markApplied(button){
    if (!button) return;
    clearAppliedState(button);
    button.classList.add('applied');
    button.disabled = true;
    const timer = setTimeout(()=>{
      button.classList.remove('applied');
      button.disabled = false;
      appliedTimers.delete(button);
    }, APPLIED_TIMEOUT);
    appliedTimers.set(button, timer);
  }

  function removePendingForButton(button){
    if (!button) return;
    for (const [key, value] of pendingButtons.entries()){
      if (value === button) pendingButtons.delete(key);
    }
  }

  function watchInputsFor(button, container){
    if (!button || !container) return;
    const handler = ()=>{
      removePendingForButton(button);
      clearAppliedState(button);
    };
    container.querySelectorAll('input, select, textarea').forEach(el=>{
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
  }

  function setupConfigAction({ buttonId, container, eventName, collect, ackAction, successMessage, errorMessage }){
    const button = document.getElementById(buttonId);
    if (!button) return;
    const scope = container || button.closest('.gs-row') || button.parentElement;
    watchInputsFor(button, scope);
    button.addEventListener('click', ()=>{
      if (button.disabled && appliedTimers.has(button)) return;
      const payload = typeof collect === 'function' ? collect() : undefined;
      if (ackAction) pendingButtons.set(ackAction, button);
      socket.emit(eventName, payload, (resp={})=>{
        if (resp && resp.ok === false){
          if (ackAction) pendingButtons.delete(ackAction);
          clearAppliedState(button);
          showToast(resp.error || errorMessage || 'Unable to apply changes', 'error');
          return;
        }
        if (!ackAction){
          showToast(successMessage || 'Settings applied', 'success');
          markApplied(button);
        }
      });
    });
  }
  function renderFinalBoostStatus(s){
    try{
      const fb = s.settings?.finalBoost || {enabled:false};
      if (!fStatusChip || !fPreview) return;
      if (fb.enabled){
        fStatusChip.textContent = 'Final Boost: ON ×' + (fb.multiplier||1) + (fb.overrideBonus?' (override bonus)':'');
        fStatusChip.classList.remove('muted');
      }else{
        fStatusChip.textContent = 'Final Boost: OFF';
        fStatusChip.classList.add('muted');
      }
      const preview = (s.preview && s.preview.finalRoundTokens)!=null ? s.preview.finalRoundTokens : null;
      fPreview.textContent = 'Final round award: 🏆 ' + (preview!=null ? preview : '—');
    }catch(e){}
  }


  document.getElementById('copyUrl').onclick = async ()=>{ try{ await navigator.clipboard.writeText(document.getElementById('joinUrl').textContent.trim()); }catch(e){} };
  document.getElementById('cleanGhosts').onclick = ()=> socket.emit('host_clean_ghosts');

  let presentationWindow = null;
  let presentationWindowWatch = null;
  function clearPresentationWatcher(){ if (presentationWindowWatch){ clearInterval(presentationWindowWatch); presentationWindowWatch = null; } }
  function enablePresentationButton(title){
    if (!openPresentationBtn) return;
    openPresentationBtn.disabled = false;
    openPresentationBtn.removeAttribute('aria-disabled');
    openPresentationBtn.removeAttribute('data-blocked');
    openPresentationBtn.title = title || 'Open a new presentation window';
  }
  function watchPresentationWindow(){
    if (!openPresentationBtn) return;
    clearPresentationWatcher();
    if (!presentationWindow) return;
    presentationWindowWatch = setInterval(()=>{
      if (!presentationWindow || presentationWindow.closed){
        clearPresentationWatcher();
        presentationWindow = null;
        enablePresentationButton();
      }
    }, 1000);
  }
  if (openPresentationBtn){
    openPresentationBtn.addEventListener('click', ()=>{
      if (openPresentationBtn.hasAttribute('data-blocked')) return;
      if (presentationWindow && !presentationWindow.closed){
        try{ presentationWindow.focus(); }catch(e){}
        return;
      }
      const win = window.open('/presentation', 'timebank_presentation');
      if (win){
        presentationWindow = win;
        try{ win.focus(); }catch(e){}
        enablePresentationButton('Presentation window opened in a new tab or window.');
        watchPresentationWindow();
      } else {
        openPresentationBtn.disabled = true;
        openPresentationBtn.setAttribute('aria-disabled', 'true');
        openPresentationBtn.setAttribute('data-blocked', '1');
        openPresentationBtn.title = 'Pop-up blocked. Allow pop-ups for this site, then return to retry.';
      }
    });
    window.addEventListener('focus', ()=>{
      if (openPresentationBtn.hasAttribute('data-blocked')){
        enablePresentationButton();
      }
    });
  }

  const hostScoreToggle = document.getElementById('hostScoreToggle');
  const publicScoreToggle = document.getElementById('publicScoreToggle');
  function pushScoreToggles(){ socket.emit('host_set_scoreboard_opts', { hostVisible: hostScoreToggle.checked, publicVisible: publicScoreToggle.checked }); }
  hostScoreToggle.addEventListener('change', pushScoreToggles);
  publicScoreToggle.addEventListener('change', pushScoreToggles);

  document.getElementById('startGame').onclick = ()=>{
    const totalRounds = Number(document.getElementById('totalRounds').value || 19);
    const timeBank = Number(document.getElementById('timeBank').value || 10);
    const countdown = 5;
    const bonusEnabled = false; // summary only; server is source of truth
    const summary = [
      `Start game with:`, 
      `• Rounds: ${totalRounds}`, 
      `• Countdown: ${countdown}s`, 
      `• Time bank: ${timeBank} min`
    ].join('\n');
    if (confirm(summary)){
      socket.emit('host_start_game', { totalRounds, timeBankMinutes: timeBank }, (ack)=>{});
    }
  };
  document.getElementById('stopGame').onclick = ()=> socket.emit('host_stop_game');
  document.getElementById('newMatch').onclick = ()=> socket.emit('host_new_match');
  if (startRoundBtn) startRoundBtn.onclick = ()=> socket.emit('host_start_round');
  if (endRoundBtn) endRoundBtn.onclick = ()=> socket.emit('host_end_round');

  setupConfigAction({
    buttonId: 'applyFinal',
    eventName: 'host_set_final_boost',
    ackAction: 'apply_final_boost',
    collect: ()=>({
      enabled: document.getElementById('fEnable')?.value === '1',
      multiplier: Number(document.getElementById('fMult')?.value || 2),
      overrideBonus: document.getElementById('fOver')?.value === '1'
    })
  });

  setupConfigAction({
    buttonId: 'applyBonus',
    eventName: 'host_set_bonus',
    successMessage: 'Bonus settings applied',
    collect: ()=>({
      enabled: document.getElementById('bEnable')?.value === '1',
      value: Number(document.getElementById('bMult')?.value || 2),
      frequency: document.getElementById('bFreq')?.value || 'off'
    })
  });

  setupConfigAction({
    buttonId: 'applyStreak',
    eventName: 'host_set_streak',
    ackAction: 'apply_streak',
    collect: ()=>({
      enabled: document.getElementById('sEnable')?.value === '1',
      cap: Number(document.getElementById('sCap')?.value || 3)
    })
  });

  setupConfigAction({
    buttonId: 'applyComeback',
    eventName: 'host_set_comeback',
    ackAction: 'apply_comeback',
    collect: ()=>({
      enabled: document.getElementById('cEnable')?.value === '1',
      threshold: Number(document.getElementById('cK')?.value || 3)
    })
  });

  (function(){
    const button = document.getElementById('applyTheme');
    if (!button) return;
    const scope = button.closest('.gs-row') || button.parentElement;
    watchInputsFor(button, scope);
    button.addEventListener('click', ()=>{
      if (button.disabled && appliedTimers.has(button)) return;
      const theme = document.getElementById('theme')?.value || 'default';
      const spotlight = document.getElementById('spot')?.value === '1';
      pendingButtons.set('apply_theme', button);
      pendingButtons.set('apply_spotlight', button);
      socket.emit('host_set_theme', { theme }, (resp={})=>{
        if (resp && resp.ok === false){
          pendingButtons.delete('apply_theme');
          showToast(resp.error || 'Failed to apply theme', 'error');
          clearAppliedState(button);
        }
      });
      socket.emit('host_set_spotlight', { enabled: spotlight }, (resp={})=>{
        if (resp && resp.ok === false){
          pendingButtons.delete('apply_spotlight');
          showToast(resp.error || 'Failed to apply spotlight', 'error');
          clearAppliedState(button);
        }
      });
    });
  })();

  (function(){
    const button = document.getElementById('bForce');
    if (!button) return;
    button.addEventListener('click', ()=>{
      socket.emit('host_set_bonus', { manualFlag: true }, (resp={})=>{
        if (resp && resp.ok === false){
          showToast(resp.error || 'Unable to flag next bonus round', 'error');
          return;
        }
        showToast('Next round flagged as bonus', 'success');
        markApplied(button);
      });
    });
  })();

  let activeStart = 0; let roundActive = false; let timerInt = null;
  function fmt(ms){ if (!Number.isFinite(ms)) return '—'; const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000), x=ms%1000; return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+String(x).padStart(3,'0'); }
  function tick(){ if (!roundActive){ roundTimerEl.textContent='00:00.000'; return; } roundTimerEl.textContent = fmt(serverNow() - activeStart); }
  function ensureTimer(){ if (timerInt) return; timerInt = setInterval(tick,50); }

  function renderHostScore(rows){
    const head = '<thead><tr><th>#</th><th>Player</th><th>PIN</th><th>🏆</th><th>Rounds Active</th><th>Rounds since Win</th><th>Bank Remaining</th><th>Status</th></tr></thead>';
    const body = '<tbody>'+ rows.map(r => (
      '<tr><td class="mono">'+r.rank+'</td><td>'+r.name+'</td><td>'+r.pin+'</td><td>🏆 '+r.tokens+'</td><td>'+r.roundsActive+'</td><td>'+(r.roundsSinceWin==null?'no victories yet':r.roundsSinceWin)+'</td><td class="mono">'+r.bankRemainingFmt+'</td><td>'+r.status+'</td></tr>'
    )).join('') + '</tbody>';
    hostScoreTable.innerHTML = '<table>'+head+body+'</table>';
  }

  function renderActiveHolds(rows){
    if (!rows || !rows.length){ activeHoldsEl.innerHTML=''; return; }
    const max = Math.max(1, ...rows.map(r=>r.msHeldThisRound||0));
    const body = rows.sort((a,b)=>{
      const order = {holding:0, locked:1, exhausted:2};
      const da = order[a.status] ?? 3, db = order[b.status] ?? 3;
      if (da !== db) return da - db;
      return (b.msHeldThisRound||0) - (a.msHeldThisRound||0);
    }).map(r=>{
      const pct = Math.round((r.msHeldThisRound||0) / max * 100);
      const statusTxt = r.status;
      return '<div style="margin:6px 0"><div style="display:flex;justify-content:space-between"><strong>'+r.name+'</strong><span class="mono">'+fmt(r.msHeldThisRound||0)+'</span></div><div class="bar"><div class="fill" style="width:'+pct+'%"></div></div><div class="muted" style="font-size:12px">'+statusTxt+'</div></div>';
    }).join('');
    activeHoldsEl.innerHTML = '<h4>Active • Who\'s holding</h4>'+body;
  }
  function renderActiveHoldsRecap(recap){
    if (!recap || !recap.rows || !recap.rows.length){ activeHoldsEl.innerHTML=''; return; }
    const max = Math.max(1, ...recap.rows.map(r=>r.msHeldThisRound||0));
    const body = recap.rows.map(r=>{
      const pct = Math.round((r.msHeldThisRound||0) / max * 100);
      return '<div style="margin:6px 0"><div style="display:flex;justify-content:space-between"><strong>'+r.name+'</strong><span class="mono">'+fmt(r.msHeldThisRound||0)+'</span></div><div class="bar"><div class="fill" style="width:'+pct+'%"></div></div><div class="muted" style="font-size:12px">'+(r.status||'locked')+'</div></div>';
    }).join('');
    activeHoldsEl.innerHTML = '<h4>Last round recap (Round '+recap.round+')</h4>'+body;
  }

  let nextReadyCountdownTimer = null;
  let nextReadyCountdownCfg = null;
  function stopNextReadyCountdown(){ if (nextReadyCountdownTimer){ clearInterval(nextReadyCountdownTimer); nextReadyCountdownTimer=null; } }
  function drawNextReadyCountdown(){
    if (!nextReadyCountdownCfg){ if (nextReadyCountdown) nextReadyCountdown.style.display='none'; stopNextReadyCountdown(); return; }
    const remain = Math.max(0, (nextReadyCountdownCfg.startTs + nextReadyCountdownCfg.durationMs) - serverNow());
    if (nextReadyCountdown){
      nextReadyCountdown.textContent = 'Auto-start in ' + Math.ceil(remain/1000) + 's';
      nextReadyCountdown.style.display = 'inline-block';
    }
    if (remain <= 0){ stopNextReadyCountdown(); }
  }

  socket.on('host_status', (s)=>{
    if (s && s.ui){
      if (hostScoreToggle) hostScoreToggle.checked = !!s.ui.showHostScoreboard;
      if (publicScoreToggle) publicScoreToggle.checked = !!s.ui.showPublicScoreboard;
    }
    roundNumEl.textContent = s.currentRound; roundTotalEl.textContent = s.settings.totalRounds;
    roundActive = s.roundActive; phaseEl.textContent = s.phase;
    if (roundActive){ activeStart = serverNow() - s.roundElapsedMs; if (window.__syncClock) window.__syncClock(); ensureTimer(); } else { roundTimerEl.textContent = '00:00.000'; }

    const rows = (s.lobby||[]).map(p=>'<tr data-id="'+p.id+'"><td>'+p.name+(p.exhausted? ' <span class="muted">(exh)</span>':'')+'</td><td>'+p.pin+'</td><td>🏆 '+p.tokens+'</td><td class="actions"><button class="btn" data-act="rename">✎</button><button class="btn" data-act="kick">🗑</button></td></tr>').join('');
    lobbyEl.innerHTML = '<table><thead><tr><th>Player</th><th>PIN</th><th>Tokens 🏆</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table>';
    lobbyEl.querySelectorAll('button[data-act]').forEach(btn=>{
      btn.onclick = ()=>{
        const tr = btn.closest('tr'); const id = tr.getAttribute('data-id'); const act = btn.getAttribute('data-act');
        if (act==='rename'){ const name = prompt('Rename player:'); if (name!=null) socket.emit('host_rename_player', { playerId:id, name }); }
        if (act==='kick'){ if (confirm('Kick this player?')) socket.emit('host_kick_player', { playerId:id }); }
      };
    });

    if (s.phase === 'arming' && s.arming){ armingRow.style.display='block'; readyCountEl.textContent = s.arming.readyCount || 0; requiredCountEl.textContent = s.arming.requiredCount || 0; } else { armingRow.style.display='none'; }

    if (s.nextRound && s.nextRound.active){
      if (nextReadyBlock){ nextReadyBlock.style.display='block'; }
      const ready = s.nextRound.readyCount || 0;
      const required = s.nextRound.requiredCount || 0;
      const eligible = s.nextRound.eligibleCount || required;
      if (nextReadyCounts){
        const suffix = eligible > required ? ` (eligible ${eligible})` : '';
        nextReadyCounts.textContent = `Ready ${ready} / ${required}${suffix}`;
      }
      if (nextReadyNames){
        const names = (s.nextRound.readyList||[]).map(r=>r.name||'Player').join(', ');
        nextReadyNames.textContent = names ? `Ready: ${names}` : 'Waiting for players…';
      }
      if (startRoundBtn){ startRoundBtn.disabled = !s.nextRound.canForce; }
      if (s.nextRound.countdown){
        nextReadyCountdownCfg = s.nextRound.countdown;
        drawNextReadyCountdown();
        if (!nextReadyCountdownTimer) nextReadyCountdownTimer = setInterval(drawNextReadyCountdown, 200);
      } else {
        nextReadyCountdownCfg = null;
        if (nextReadyCountdown) nextReadyCountdown.style.display='none';
        stopNextReadyCountdown();
      }
    } else {
      if (nextReadyBlock){ nextReadyBlock.style.display='none'; }
      nextReadyCountdownCfg = null;
      stopNextReadyCountdown();
      if (nextReadyCountdown) nextReadyCountdown.style.display='none';
      if (startRoundBtn){
        const canForce = !!(s.nextRound && s.nextRound.canForce);
        startRoundBtn.disabled = !canForce;
      }
    }

    const hrows = (s.history||[]).map(h=>{
      const reason = h && h.reason;
      const isNoHold = reason === 'no-hold';
      const winner = isNoHold ? 'Nobody held' : (h.winnerName || '—');
      const held = isNoHold ? '—' : fmt(h.winnerMs);
      const tokens = isNoHold ? '—' : ('🏆 ' + (h.winnerTokens||0));
      const cls = isNoHold ? ' class="no-hold"' : '';
      return `<tr${cls}><td>#${h.round}</td><td>${winner}</td><td>${held}</td><td>${tokens}</td></tr>`;
    }).join('');
    historyMiniEl.innerHTML = '<table><thead><tr><th>Round</th><th>Winner</th><th>Held</th><th>Winner 🏆</th></tr></thead><tbody>'+ (hrows || '<tr><td colspan=4 class="muted">No rounds yet</td></tr>') +'</tbody></table>';

    if (s.scoreboardHost){ renderHostScore(s.scoreboardHost); } else { hostScoreTable.innerHTML = '<div class="muted">(Toggle "Show host scoreboard" to display details)</div>'; }
    renderFinalBoostStatus(s);

    if (s.activeHolds){ renderActiveHolds(s.activeHolds); }
    else if (s.activeHoldsRecap){ renderActiveHoldsRecap(s.activeHoldsRecap); }
    else { activeHoldsEl.innerHTML = ''; }
  });

  socket.on('host_action_ack', (ack={})=>{
    const { ok=true, detail='', action='' } = ack;
    const type = ok ? 'success' : 'error';
    const message = detail || (ok ? 'Action completed' : 'Action failed');
    if (message) showToast(message, type);
    if (action && pendingButtons.has(action)){
      const btn = pendingButtons.get(action);
      pendingButtons.delete(action);
      if (ok) markApplied(btn);
      else clearAppliedState(btn);
    }
  });

  socket.on('round_result', (info={})=>{
    if (info && info.reason === 'no-hold'){
      showToast(`Round ${info.round != null ? info.round : '?'}: Nobody held!`, 'error');
    }
  });

  socket.on('final_boost_changed', ()=>{ /* request latest status via host_status stream */ });
})();
