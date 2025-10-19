(function(){
  const socket = io({ query: { role: 'host' } });
  // Sync to server clock for accurate countdowns
  socket.on('server_now', (d)=>{
    try{
      const offset = (d && typeof d.now==='number' ? d.now : Date.now()) - Date.now();
      window.__getServerNow = ()=> Date.now() + offset;
    }catch(e){}
  });
  socket.on('final_boost_changed', ()=>{ /* request latest status via host_status stream */ });

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
  const historyMiniEl = document.getElementById('historyMini');
  const fStatusChip = document.getElementById('fStatusChip');
  const fPreview = document.getElementById('fPreview');
  const toastsEl = document.getElementById('toasts');
  const openPresentationBtn = document.getElementById('openPresentation');
  let cachedSessionCode = '';

  function showToast(message, type = 'error'){
    if (!toastsEl){ console.warn(message); return; }
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = message;
    toastsEl.appendChild(el);
    setTimeout(()=>{ el.remove(); }, 4000);
  }

  if (openPresentationBtn){
    openPresentationBtn.disabled = true;
    openPresentationBtn.addEventListener('click', ()=>{
      if (!cachedSessionCode){ return; }
      const popup = window.open(`/presentation?session=${encodeURIComponent(cachedSessionCode||'')}`, '_blank', 'noopener');
      if (!popup || popup.closed || typeof popup.closed === 'undefined'){
        showToast('Pop-up blocked. Allow pop-ups to open the presentation.');
      } else if (typeof popup.focus === 'function') {
        popup.focus();
      }
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
  document.getElementById('startRound').onclick = ()=> socket.emit('host_start_round');
  document.getElementById('endRound').onclick = ()=> socket.emit('host_end_round');

  let activeStart = 0; let roundActive = false; let timerInt = null;
  function fmt(ms){ const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000), x=ms%1000; return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+String(x).padStart(3,'0'); }
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

  socket.on('host_status', (s)=>{
    roundNumEl.textContent = s.currentRound; roundTotalEl.textContent = s.settings.totalRounds;
    roundActive = s.roundActive; phaseEl.textContent = s.phase;
    if (roundActive){ activeStart = serverNow() - s.roundElapsedMs; if (window.__syncClock) window.__syncClock(); ensureTimer(); } else { roundTimerEl.textContent = '00:00.000'; }

    cachedSessionCode = typeof (s.session && s.session.code) === 'string' ? s.session.code : '';
    if (openPresentationBtn){ openPresentationBtn.disabled = !cachedSessionCode; }

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

    const hrows = (s.history||[]).map(h=>'<tr><td>#'+h.round+'</td><td>'+(h.winnerName || '—')+'</td><td>'+fmt(h.winnerMs)+'</td><td>🏆 '+(h.winnerTokens||0)+'</td></tr>').join('');
    historyMiniEl.innerHTML = '<table><thead><tr><th>Round</th><th>Winner</th><th>Held</th><th>Winner 🏆</th></tr></thead><tbody>'+ (hrows || '<tr><td colspan=4 class="muted">No rounds yet</td></tr>') +'</tbody></table>';

    if (s.scoreboardHost){ renderHostScore(s.scoreboardHost); } else { hostScoreTable.innerHTML = '<div class="muted">(Toggle "Show host scoreboard" to display details)</div>'; }
    renderFinalBoostStatus(s);

    if (s.activeHolds){ renderActiveHolds(s.activeHolds); }
    else if (s.activeHoldsRecap){ renderActiveHoldsRecap(s.activeHoldsRecap); }
    else { activeHoldsEl.innerHTML = ''; }
  });
})();
