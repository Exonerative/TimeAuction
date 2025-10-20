
// Time-Bank Auction — v4.11.3
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const NO_HOLD_TIMEOUT_MS = 10000;

// Broadcast server time to clients for countdown sync
setInterval(()=>{ try{ io.emit('server_now', { now: Date.now() }); }catch(e){} }, 1000);


const PORT = process.env.PORT || 3000;

// --------------------------- Helpers ---------------------------
function now(){ return Date.now(); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function getLANAddress(){
  try{
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)){
      for (const info of (ifaces[name]||[])){
        if (info && info.family === 'IPv4' && !info.internal) return info.address;
      }
    }
  }catch(e){}
  return 'localhost';
}
function msToHMS(ms){
  const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000), x=ms%1000;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(x).padStart(3,'0')}`;
}
function randomPin(len=4){ let s=''; for(let i=0;i<len;i++) s += Math.floor(Math.random()*10); return s; }
function genSessionCode(){ return 'TB-' + Math.random().toString(16).slice(2,6).toUpperCase(); }
function createPlayerSessionToken(){ return 'ps-' + Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,6); }


// Bonus scheduling helper (P212)
function isBonusRound(settings, roundNumber){
  if (!settings?.bonus || !settings.bonus.enabled) return {active:false, value:1};
  const freq = String(settings.bonus.frequency||'off');
  let active = false;
  if (freq === 'every-3') active = (roundNumber % 3 === 0);
  else if (freq === 'every-5') active = (roundNumber % 5 === 0);
  else if (freq === 'manual' && settings.bonus.manualFlag){ active = true; settings.bonus.manualFlag = false; }
  const val = Math.max(2, Math.min(5, Number(settings.bonus.value||2)));
  return {active, value: active ? val : 1};
}

function roundTokenValue(roundNum){
  let val = 1;
  const br = isBonusRound(state.settings, roundNum);
  if (br && br.active) val = br.value;
  const fb = state.settings.finalBoost || {};
  if (fb.enabled && roundNum === state.settings.totalRounds){
    val = fb.overrideBonus ? Math.max(1, Math.floor(fb.multiplier||1))
                           : Math.max(1, Math.floor(val * (fb.multiplier||1)));
  }
  return Math.max(1, Math.floor(val||1));
}

// --------------------------- Game State ---------------------------
const state = {
  settings: { totalRounds: 19, timeBankMinutes: 10 , bonus: { enabled:false, value:2, frequency:'off', manualFlag:false }, finalBoost: { enabled:false, multiplier:2, overrideBonus:true }, hbRamp: { enabled:false, intervalSec:30, multiplier:0.9, minMs:500, maxMs:750 }, streak: { enabled:false, cap:3 }, comeback: { enabled:false, threshold:3 }, nextRound: { quorum: { type: 'all', value: 1 } }},
  started: false,
  currentRound: 0,
  roundActive: false,
  roundStartTs: 0,
  phase: 'idle', // idle | arming | countdown | active
  countdownStartTs: 0,
  countdownMs: 5000,
  players: {}, // { [id]: {...} }
  pinIndex: new Map(), // pin -> socketId
  roundHolds: {},
  requiredPressSet: new Set(),
  readyHoldersAll: new Set(),
  readyForNextSet: new Set(),
  lockedParticipants: new Set(),
  outThisRound: new Set(),
  participantsThisRound: new Set(),
  sessionCode: '',
  history: [],
  ui: { showHostScoreboard:true, showPublicScoreboard:true, theme:'default', spotlight:true },
  hostSocketId: null,
  activeTicker: null,
  lastActiveHolds: null, // recap of last round
  currentRoundBonus: null,
  nextRound: { requirement: 0, countdownMs: 3000, countdownStartTs: 0, countdownTimer: null },
  noHoldTimer: null,
};

const presentationSockets = new Set();

function clearNoHoldTimer(){
  if (state.noHoldTimer){
    clearTimeout(state.noHoldTimer);
    state.noHoldTimer = null;
  }
}
function startNoHoldTimer(){
  clearNoHoldTimer();
  const someoneHolding = Object.values(state.players).some(p => p && p.inRoundHold && state.lockedParticipants.has(p.id) && !state.outThisRound.has(p.id));
  if (someoneHolding) return;
  state.noHoldTimer = setTimeout(()=>{
    state.noHoldTimer = null;
    if (!state.roundActive || state.phase !== 'active') return;
    if (anyPlayerHeldThisRound()) return;
    try{ io.emit('round_no_hold', { round: state.currentRound }); }catch(e){}
    endRound('no-hold');
  }, NO_HOLD_TIMEOUT_MS);
}

function resetRoundSets(){
  state.roundHolds = {};
  state.requiredPressSet = new Set();
  state.readyHoldersAll = new Set();
  state.lockedParticipants = new Set();
  state.outThisRound = new Set();
  state.participantsThisRound = new Set();
}
function clearInRoundFlags(){
  clearNoHoldTimer();
  Object.values(state.players).forEach(p => {
    p.inRoundHold = false; p.holdStartTs = null;
    if (p.autoExhaustTimeout){ clearTimeout(p.autoExhaustTimeout); p.autoExhaustTimeout = null; }
  });
}
function anyPlayerHeldThisRound(){ return Object.values(state.roundHolds).some(ms => (ms||0) > 0); }

function eligiblePlayersForNextRound(){
  const liveIds = new Set(io?.sockets?.sockets ? io.sockets.sockets.keys() : []);
  return Object.values(state.players).filter(p => p.joined && !p.exhausted && liveIds.has(p.id));
}
function computeNextRoundRequirement(totalEligible){
  if (totalEligible <= 0) return 0;
  const quorum = state.settings?.nextRound?.quorum;
  if (!quorum || quorum.type === 'all') return totalEligible;
  if (quorum.type === 'count'){
    const val = Math.floor(Number(quorum.value));
    if (!Number.isFinite(val)) return totalEligible;
    return clamp(val, 0, totalEligible);
  }
  if (quorum.type === 'percent'){
    const pct = Number(quorum.value);
    if (!Number.isFinite(pct)) return totalEligible;
    return clamp(Math.ceil(totalEligible * clamp(pct, 0, 1)), 0, totalEligible);
  }
  return totalEligible;
}
function isBetweenRounds(){
  return state.started && state.phase === 'idle' && state.currentRound < state.settings.totalRounds;
}
function cancelNextRoundCountdown(){
  let cleared = false;
  if (state.nextRound.countdownTimer){
    clearTimeout(state.nextRound.countdownTimer);
    state.nextRound.countdownTimer = null;
    cleared = true;
  }
  if (state.nextRound.countdownStartTs){
    state.nextRound.countdownStartTs = 0;
    cleared = true;
  }
  return cleared;
}
function maybeScheduleNextRoundCountdown(){
  if (!isBetweenRounds()) return false;
  if (state.nextRound.requirement <= 0) return false;
  if (state.readyForNextSet.size < state.nextRound.requirement) return false;
  if (state.nextRound.countdownTimer) return true;
  state.nextRound.countdownStartTs = now();
  state.nextRound.countdownTimer = setTimeout(()=>{
    state.nextRound.countdownTimer = null;
    state.nextRound.countdownStartTs = 0;
    emitNextRoundReadyState();
    advanceToNextRound('auto');
  }, state.nextRound.countdownMs);
  return true;
}
function emitNextRoundReadyState(){
  const active = isBetweenRounds();
  const readyIds = Array.from(state.readyForNextSet);
  const payload = {
    active,
    phase: state.phase,
    currentRound: state.currentRound,
    totalRounds: state.settings.totalRounds,
    readyCount: active ? readyIds.length : 0,
    requiredCount: active ? (state.nextRound.requirement || 0) : 0,
    eligibleCount: active ? eligiblePlayersForNextRound().length : 0,
    readyIds: active ? readyIds : [],
    countdown: (active && state.nextRound.countdownStartTs) ? { startTs: state.nextRound.countdownStartTs, durationMs: state.nextRound.countdownMs } : null,
  };
  io.emit('next_round_ready_state', payload);
  emitPresentationState();
}
function updateNextRoundReadyState({ emit=true }={}){
  if (!isBetweenRounds()){
    cancelNextRoundCountdown();
    state.readyForNextSet = new Set();
    state.nextRound.requirement = 0;
    if (emit) emitNextRoundReadyState();
    return;
  }
  const eligibleIds = eligiblePlayersForNextRound().map(p=>p.id);
  const eligibleSet = new Set(eligibleIds);
  state.readyForNextSet = new Set(Array.from(state.readyForNextSet).filter(id => eligibleSet.has(id)));
  state.nextRound.requirement = computeNextRoundRequirement(eligibleIds.length);
  if (state.readyForNextSet.size < state.nextRound.requirement){
    cancelNextRoundCountdown();
  }
  maybeScheduleNextRoundCountdown();
  if (emit) emitNextRoundReadyState();
}
function computeEliminations(){
  const players = Object.values(state.players).filter(p=>p.joined);
  if (!players.length) return [];
  const minTokens = Math.min(...players.map(p=>p.tokens));
  return players.filter(p => p.tokens === minTokens).map(p => ({ id: p.id, name: p.name, tokens: p.tokens }));
}
function roundsSinceWinFor(p){ if (p.lastVictoryRound == null) return null; return Math.max(0, state.currentRound - p.lastVictoryRound); }

// Ranking comparator
function scoreboardSort(a, b){
  if (b.tokens !== a.tokens) return b.tokens - a.tokens;
  if ((b.bankRemainingMs||0) !== (a.bankRemainingMs||0)) return (b.bankRemainingMs||0) - (a.bankRemainingMs||0);
  if ((b.roundsActive||0) !== (a.roundsActive||0)) return (b.roundsActive||0) - (a.roundsActive||0);
  const aRSW = a.roundsSinceWin == null ? Number.POSITIVE_INFINITY : a.roundsSinceWin;
  const bRSW = b.roundsSinceWin == null ? Number.POSITIVE_INFINITY : b.roundsSinceWin;
  if (aRSW !== bRSW) return aRSW - bRSW;
  return (a.name||'').localeCompare(b.name||'');
}
function addRanks(rows){
  rows.sort(scoreboardSort);
  let last = null, lastRank = 0;
  rows.forEach((r, i)=>{
    const key = [r.tokens, r.bankRemainingMs||0, r.roundsActive||0, r.roundsSinceWin==null?Infinity:r.roundsSinceWin, r.name||''].join('|');
    if (key !== last){ lastRank = i + 1; last = key; }
    r.rank = lastRank;
  });
  return rows;
}

function buildHostScoreboard(){
  const rows = Object.values(state.players).filter(p=>p.joined).map(p=>({
    id: p.id,
    name: p.name,
    tokens: p.tokens,
    roundsActive: p.roundsActive||0,
    roundsSinceWin: roundsSinceWinFor(p),
    bankRemainingMs: p.timeRemainingMs||0,
    bankRemainingFmt: msToHMS(p.timeRemainingMs||0),
    exhausted: !!p.exhausted,
    status: p.exhausted ? 'Exhausted' : 'OK',
    pin: p.pin,
  }));
  addRanks(rows);
  return rows;
}
function buildPublicScoreboard(){
  const rows = Object.values(state.players).filter(p=>p.joined).map(p=>({
    id: p.id,
    name: p.name,
    tokens: p.tokens,
    roundsActive: p.roundsActive||0,
    roundsSinceWin: roundsSinceWinFor(p),
    bankRemainingMs: p.timeRemainingMs||0,
  }));
  addRanks(rows);
  return rows.map(({name,tokens,roundsSinceWin,rank})=>({ name, tokens, roundsSinceWin, rank }));
}

function computeSoleChampion(){
  const rows = Object.values(state.players).filter(p=>p.joined).map(p=>({
    id: p.id,
    name: p.name,
    tokens: p.tokens,
    roundsActive: p.roundsActive||0,
    roundsSinceWin: roundsSinceWinFor(p),
    bankRemainingMs: p.timeRemainingMs||0,
  }));
  if (!rows.length) return null;
  addRanks(rows);
  return rows[0];
}

function buildPresentationHistory(){
  return state.history.slice(-8).reverse().map(h => ({
    round: h.round,
    winnerName: h.winnerName,
    winnerTokens: h.winnerTokens,
    winnerMs: h.winnerMs,
    ts: h.ts,
    reason: h.reason,
  }));
}

function buildPresentationNextRound(){
  const active = isBetweenRounds();
  const eligibleCount = active ? eligiblePlayersForNextRound().length : 0;
  const countdown = (active && state.nextRound.countdownStartTs)
    ? { startTs: state.nextRound.countdownStartTs, durationMs: state.nextRound.countdownMs }
    : null;
  return {
    active,
    readyCount: active ? state.readyForNextSet.size : 0,
    requiredCount: active ? (state.nextRound.requirement || 0) : 0,
    eligibleCount,
    countdown,
  };
}

function buildPresentationState(){
  const scoreboardVisible = !!state.ui.showPublicScoreboard;
  const countdown = (state.phase === 'countdown' && state.countdownStartTs)
    ? { startTs: state.countdownStartTs, durationMs: state.countdownMs }
    : null;
  const roundTimer = state.roundActive ? { startTs: state.roundStartTs } : null;
  return {
    started: state.started,
    phase: state.phase,
    currentRound: state.currentRound,
    totalRounds: state.settings.totalRounds,
    countdown,
    roundTimer,
    nextRound: buildPresentationNextRound(),
    scoreboardVisible,
    scoreboard: scoreboardVisible ? buildPublicScoreboard() : [],
    history: buildPresentationHistory(),
  };
}

function emitPresentationState(){
  if (!presentationSockets.size) return;
  const payload = buildPresentationState();
  for (const id of presentationSockets){
    io.to(id).emit('presentation_state', payload);
  }
}

function broadcastPublicScoreboard(){
  if (state.ui.showPublicScoreboard){
    io.emit('scoreboard_update', { rows: buildPublicScoreboard() });
  }
  emitPresentationState();
}

// --------------------------- Host & Lobby ---------------------------
function broadcastLobby(){
  const lobbyPublic = Object.values(state.players).filter(p=>p.joined).map(p => ({ id:p.id, name:p.name, tokens:p.tokens, exhausted:p.exhausted }));
  io.emit('lobby_update', {
    lobby: lobbyPublic,
    started: state.started,
    currentRound: state.currentRound,
    totalRounds: state.settings.totalRounds,
    roundActive: state.roundActive,
    phase: state.phase,
    timeBankMinutes: state.settings.timeBankMinutes,
  });
}
function emitHostStatus(){
  emitPresentationState();
  if (!state.hostSocketId) return;
  const lobbyHost = Object.values(state.players).filter(p=>p.joined).map(p => ({ id:p.id, name:p.name, tokens:p.tokens, exhausted:p.exhausted, pin:p.pin }));
  const histMini = state.history.slice(-6);
  const payload = {
    started: state.started, settings: state.settings, currentRound: state.currentRound,
    roundActive: state.roundActive, phase: state.phase, roundElapsedMs: state.roundActive ? (now() - state.roundStartTs) : 0,
    countdown: { startTs: state.countdownStartTs, durationMs: state.countdownMs, lockedCount: state.lockedParticipants.size },
    arming: (state.phase==='arming') ? { readyCount: state.readyHoldersAll.size, requiredCount: state.requiredPressSet.size } : null,
    session: { code: state.sessionCode, counts: {connected:Object.keys(state.players).length, joined:lobbyHost.length} },
    history: histMini, ui: state.ui, lobby: lobbyHost,
  };
  // attach preview values
  payload.preview = { finalRoundTokens: roundTokenValue(state.settings.totalRounds) };

  const nextRoundActive = isBetweenRounds();
  const eligibleNext = eligiblePlayersForNextRound();
  payload.nextRound = {
    active: nextRoundActive,
    eligibleCount: eligibleNext.length,
    readyCount: nextRoundActive ? state.readyForNextSet.size : 0,
    requiredCount: nextRoundActive ? (state.nextRound.requirement || 0) : 0,
    readyList: nextRoundActive ? Array.from(state.readyForNextSet).map(id=>({ id, name: state.players[id]?.name || 'Player' })) : [],
    countdown: (nextRoundActive && state.nextRound.countdownStartTs) ? { startTs: state.nextRound.countdownStartTs, durationMs: state.nextRound.countdownMs } : null,
    canForce: state.started && state.phase === 'idle' && state.currentRound < state.settings.totalRounds,
  };

  if (state.phase === 'active'){
    const rows = Array.from(state.participantsThisRound).map(id=>{
      const p = state.players[id]; if (!p) return null;
      const base = state.roundHolds[id] || 0;
      const extra = (p.inRoundHold && p.holdStartTs) ? (now() - p.holdStartTs) : 0;
      const msHeldThisRound = base + extra;
      const status = p.exhausted ? 'exhausted' : (p.inRoundHold ? 'holding' : 'locked');
      return { id, name: p.name, msHeldThisRound, status };
    }).filter(Boolean);
    payload.activeHolds = rows;
  } else if (state.lastActiveHolds) {
    payload.activeHoldsRecap = state.lastActiveHolds;
  }
  if (state.ui.showHostScoreboard){ payload.scoreboardHost = buildHostScoreboard(); }
  io.to(state.hostSocketId).emit('host_status', payload);
}
function startActiveTicker(){
  if (state.activeTicker) return;
  state.activeTicker = setInterval(()=>{ emitHostStatus(); }, 200);
}
function stopActiveTicker(){
  if (!state.activeTicker) return;
  clearInterval(state.activeTicker); state.activeTicker = null;
}

// --------------------------- Round Flow ---------------------------
function beginArming(){
  state.phase = 'arming'; state.roundActive = false; state.countdownStartTs = 0;
  state.currentRoundBonus = null;
  state.readyHoldersAll = new Set(); state.lockedParticipants = new Set(); state.outThisRound = new Set();
  state.requiredPressSet = new Set(Object.values(state.players).filter(p=>p.joined).map(p=>p.id));
  state.readyForNextSet = new Set();
  state.nextRound.requirement = 0;
  cancelNextRoundCountdown();
  emitNextRoundReadyState();
  io.emit('arming_started', { requiredCount: state.requiredPressSet.size, names: Object.values(state.players).filter(p=>p.joined).map(p=>({id:p.id,name:p.name,exhausted:p.exhausted})) });
  emitHostStatus(); broadcastPublicScoreboard();
}
let allHoldDebounce = null;
function checkAllHoldGate(){
  if (state.phase !== 'arming') return;
  const allHolding = state.readyHoldersAll.size === state.requiredPressSet.size && state.requiredPressSet.size > 0;
  if (!allHolding){ if (allHoldDebounce){ clearTimeout(allHoldDebounce); allHoldDebounce=null; } return; }
  if (allHoldDebounce) return;
  allHoldDebounce = setTimeout(()=>{ allHoldDebounce=null; if (state.phase==='arming' && state.readyHoldersAll.size === state.requiredPressSet.size){ beginCountdown(); } }, 150);
}
function beginCountdown(){
  state.phase = 'countdown'; state.countdownStartTs = now();
  state.lockedParticipants = new Set(Array.from(state.requiredPressSet).filter(id=>{ const p=state.players[id]; return p && !p.exhausted; }));
  io.emit('countdown_started', { startTs: state.countdownStartTs, durationMs: state.countdownMs, participants: Array.from(state.lockedParticipants).map(id=>({ id, name: state.players[id]?.name || 'Player' })), totalLocked: state.lockedParticipants.size });
  // Heads-up banners
  const _br = isBonusRound(state.settings, state.currentRound);
  if (_br && _br.active){ io.emit('bonus_round_armed', { round: state.currentRound, value: _br.value }); }
  if (state.currentRound === state.settings.totalRounds){ io.emit('final_round_armed', { round: state.currentRound, tokens: roundTokenValue(state.currentRound) }); }
  emitHostStatus(); setTimeout(()=>{ if (state.phase==='countdown') beginActive(); }, state.countdownMs);
}
function scheduleExhaustTimeout(p){
  if (p.autoExhaustTimeout){ clearTimeout(p.autoExhaustTimeout); p.autoExhaustTimeout=null; }
  if (p.timeRemainingMs > 0){
    p.autoExhaustTimeout = setTimeout(()=>{
      const ts = now();
      if (state.phase==='active' && p.inRoundHold && p.holdStartTs){
        let delta = clamp(ts - p.holdStartTs, 0, p.timeRemainingMs);
        p.timeRemainingMs -= delta; state.roundHolds[p.id] = (state.roundHolds[p.id]||0) + delta;
        p.inRoundHold = false; p.holdStartTs = null;
      }
      p.exhausted = true; io.to(p.id).emit('exhausted');
      if (p.autoExhaustTimeout){ clearTimeout(p.autoExhaustTimeout); p.autoExhaustTimeout=null; }
      emitHostStatus();
      setTimeout(()=>{ if (state.roundActive && !Object.values(state.players).some(x=>x.inRoundHold) && anyPlayerHeldThisRound()){ endRound('auto-empty'); } }, 400);
    }, p.timeRemainingMs);
  }
}
function beginActive(){
  state.phase = 'active'; state.roundActive = true; state.roundStartTs = now();
  state.participantsThisRound = new Set(state.lockedParticipants);
  state.lockedParticipants.forEach(id=>{
    const p = state.players[id];
    if (!p || state.outThisRound.has(id) || p.exhausted) return;
    if (p.inRoundHold){
      p.holdStartTs = state.roundStartTs;
      p.roundsActive = (p.roundsActive||0) + 1;
      scheduleExhaustTimeout(p);
    }
  });
  const _bonusRS = isBonusRound(state.settings, state.currentRound);
  state.currentRoundBonus = { active: !!_bonusRS?.active, value: _bonusRS?.value || 1 };
  io.emit('round_started', { round: state.currentRound, startTs: state.roundStartTs, elapsedMs: 0, bonusActive: !!_bonusRS.active, bonusValue: _bonusRS.value });
  startNoHoldTimer();
  startActiveTicker();
  emitHostStatus(); broadcastPublicScoreboard();
}
function advanceToNextRound(trigger='host'){
  if (!state.started) return false;
  if (state.phase !== 'idle') return false;
  if (state.currentRound >= state.settings.totalRounds) return false;
  state.lastActiveHolds = null; // clear previous recap
  state.currentRound += 1;
  state.roundHolds = {};
  clearInRoundFlags();
  beginArming();
  if (trigger === 'host' && state.hostSocketId){
    io.to(state.hostSocketId).emit('host_action_ack', { ok:true, action:'start_round', detail:`Round ${state.currentRound} starting`, round: state.currentRound, ts: now() });
  }
  return true;
}
function endRound(reason='ended'){
  const ts = now();
  clearNoHoldTimer();
  if (state.roundActive){
    Object.values(state.players).forEach(p=>{
      if (p.inRoundHold && p.holdStartTs){
        let delta = clamp(ts - p.holdStartTs, 0, p.timeRemainingMs);
        p.timeRemainingMs -= delta; state.roundHolds[p.id] = (state.roundHolds[p.id] || 0) + delta;
        p.inRoundHold = false; p.holdStartTs = null;
        if (p.autoExhaustTimeout){ clearTimeout(p.autoExhaustTimeout); p.autoExhaustTimeout = null; }
        if (p.timeRemainingMs === 0 && !p.exhausted){ p.exhausted = true; io.to(p.id).emit('exhausted'); }
      }
    });
  }
  let winnerId = null, winnerMs = 0;
  for (const [pid, held] of Object.entries(state.roundHolds)){ if ((held||0) > winnerMs){ winnerMs = held; winnerId = pid; } }
  let resultPayload;
  let historyEntry;
  if (winnerId && state.players[winnerId]){
    const w = state.players[winnerId];
    w.tokens += roundTokenValue(state.currentRound);
    w.lastVictoryRound = state.currentRound;
    resultPayload = { round: state.currentRound, winner: w.name, winnerMs, winnerTokens: w.tokens, finalRound: (state.currentRound === state.settings.totalRounds) };
    historyEntry = { round: state.currentRound, winnerId, winnerName: w.name, winnerMs, winnerTokens: w.tokens, ts: now(), reason };
  } else {
    resultPayload = { round: state.currentRound, winner: null, winnerMs: 0, winnerTokens: 0, finalRound: (state.currentRound === state.settings.totalRounds) };
    historyEntry = { round: state.currentRound, winnerId: null, winnerName: null, winnerMs: 0, winnerTokens: 0, ts: now(), reason };
  }

  const totalRounds = state.settings.totalRounds;
  const roundsLeft = Math.max(0, totalRounds - state.currentRound);
  const bonusMeta = state.currentRoundBonus || { active:false, value:1 };
  const scoreboard = buildHostScoreboard();
  const leaderRow = scoreboard.length ? scoreboard[0] : null;

  resultPayload.totalRounds = totalRounds;
  resultPayload.roundsLeft = roundsLeft;
  resultPayload.leaderName = leaderRow ? leaderRow.name : null;
  resultPayload.leaderTokens = leaderRow ? leaderRow.tokens : null;
  if (bonusMeta.active){ resultPayload.bonusValue = bonusMeta.value; }
  resultPayload.reason = reason;

  io.emit('round_result', resultPayload);
  state.history.push(historyEntry);
  if (state.history.length > 500) state.history.splice(0, state.history.length - 500);

  state.currentRoundBonus = null;

  // Build recap snapshot before clearing
  const recapRows = Array.from(state.participantsThisRound || []).map(id=>{
    const p = state.players[id]; if (!p) return null;
    const msHeldThisRound = (state.roundHolds[id] || 0);
    const status = p.exhausted ? 'exhausted' : 'locked';
    return { id, name: p.name, msHeldThisRound, status };
  }).filter(Boolean).sort((a,b)=> (b.msHeldThisRound||0) - (a.msHeldThisRound||0));
  state.lastActiveHolds = { round: state.currentRound, rows: recapRows };

  state.roundActive = false; state.phase = 'idle'; state.countdownStartTs = 0;
  stopActiveTicker();
  clearInRoundFlags(); resetRoundSets();
  cancelNextRoundCountdown();
  state.readyForNextSet = new Set();
  state.nextRound.requirement = 0;
  updateNextRoundReadyState();
  emitHostStatus(); broadcastLobby(); broadcastPublicScoreboard();

  if (state.currentRound >= state.settings.totalRounds){
    const eliminated = computeEliminations();
    const champion = computeSoleChampion();
    const finalRows = buildHostScoreboard(); // already sorted & ranked
    const final = finalRows.map(r => ({
      rank: r.rank, name: r.name, tokens: r.tokens, roundsActive: r.roundsActive,
      bankRemainingMs: r.bankRemainingMs, exhausted: !!(state.players[r.id]?.exhausted),
      lastVictoryRound: state.players[r.id]?.lastVictoryRound ?? null
    }));
    io.emit('game_over', { eliminated, champion, final });
  }
}
function startGame(totalRounds, timeBankMinutes){
  const timeBankMs = Math.max(0, Math.round(Number(timeBankMinutes) * 60 * 1000));
  Object.values(state.players).forEach(p => {
    p.tokens = 0; p.timeRemainingMs = timeBankMs; p.exhausted = (timeBankMs===0);
    p.inRoundHold = false; p.holdStartTs = null; if (p.autoExhaustTimeout){ clearTimeout(p.autoExhaustTimeout); p.autoExhaustTimeout=null; }
    p.roundsActive = 0; p.lastVictoryRound = null;
  });
  state.settings.totalRounds = Math.max(1, Math.floor(Number(totalRounds)) || 1);
  state.settings.timeBankMinutes = Number(timeBankMinutes) || 10;
  state.started = true; state.currentRound = 0; state.roundActive = false; state.phase = 'idle';
  state.sessionCode = genSessionCode(); state.history = []; resetRoundSets(); state.lastActiveHolds = null;
  state.currentRoundBonus = null;
  cancelNextRoundCountdown();
  state.readyForNextSet = new Set();
  state.nextRound.requirement = 0;
  updateNextRoundReadyState();
  emitHostStatus(); broadcastLobby(); broadcastPublicScoreboard();
}
function newMatch(){ startGame(state.settings.totalRounds, state.settings.timeBankMinutes); }
function stopGame(){
  state.started = false; state.currentRound = 0; state.roundActive = false; state.phase = 'idle'; state.countdownStartTs = 0;
  stopActiveTicker();
  clearInRoundFlags(); resetRoundSets(); state.lastActiveHolds = null;
  state.currentRoundBonus = null;
  cancelNextRoundCountdown();
  state.readyForNextSet = new Set();
  state.nextRound.requirement = 0;
  updateNextRoundReadyState();
  emitHostStatus(); broadcastLobby(); broadcastPublicScoreboard();
}

// --------------------------- Routes ---------------------------
app.use('/public', express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res){ res.setHeader('Cache-Control','no-store'); }
}));

app.get('/', (req,res)=> res.redirect('/host'));

app.get('/history.csv', (req,res)=>{
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="history-${state.sessionCode||'session'}.csv"`);
  const rows = [ ['sessionCode','round','winnerName','winnerMs','winnerMs_fmt','winnerTokens','reason','timestamp'] ];
  for (const h of state.history){ rows.push([state.sessionCode, h.round, h.winnerName||'', String(h.winnerMs), msToHMS(h.winnerMs), String(h.winnerTokens), h.reason || '', new Date(h.ts).toISOString()]); }
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  res.send(csv);
});
app.get('/scoreboard.csv', (req,res)=>{
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="scoreboard-${state.sessionCode||'session'}.csv"`);
  const rows = [ ['rank','sessionCode','name','tokens','roundsActive','roundsSinceWin','bankRemainingMs','bankRemainingFmt','status','exhausted','pin'] ];
  for (const r of buildHostScoreboard()){
    rows.push([ String(r.rank), state.sessionCode, r.name, String(r.tokens), String(r.roundsActive), r.roundsSinceWin==null?'no victories yet':String(r.roundsSinceWin), String(r.bankRemainingMs), r.bankRemainingFmt, r.status, String(r.exhausted), r.pin ]);
  }
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  res.send(csv);
});

app.get('/host', async (req,res)=>{
  const ip = getLANAddress();
  const joinUrl = `http://${ip}:${PORT}/player`; const qr = await QRCode.toDataURL(joinUrl);
  const hostHtml = fs.readFileSync(path.join(__dirname, 'public', 'host.html'), 'utf8').replace(/__JOIN_URL__/g, joinUrl).replace(/__QR_DATA__/g, qr);
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.send(hostHtml);
});
app.get('/presentation', async (req,res)=>{
  const ip = getLANAddress();
  const joinUrl = `http://${ip}:${PORT}/player`; const qr = await QRCode.toDataURL(joinUrl);
  const html = fs.readFileSync(path.join(__dirname, 'public', 'presentation.html'), 'utf8')
    .replace(/__JOIN_URL__/g, joinUrl)
    .replace(/__QR_DATA__/g, qr);
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.send(html);
});
app.get('/player', (req,res)=>{
  const html = fs.readFileSync(path.join(__dirname, 'public', 'player.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.send(html);
});

// --------------------------- Rebind & PIN ---------------------------
function assignPinUnique(){
  for (let tries=0; tries<12; tries++){
    const len = tries>=10 ? 5 : 4;
    const p = randomPin(len);
    if (!state.pinIndex.has(p)) return p;
  }
  let p; do { p = randomPin(5); } while(state.pinIndex.has(p));
  return p;
}
function rebindPlayerSocket(oldId, newSocket){
  const p = state.players[oldId]; if (!p) return null;
  delete state.players[oldId];
  const newId = newSocket.id;
  p.id = newId;
  state.players[newId] = p;
  if (p.pin){ state.pinIndex.set(p.pin, newId); }
  ['requiredPressSet','readyHoldersAll','lockedParticipants','outThisRound','participantsThisRound'].forEach(key=>{
    const set = state[key];
    if (set.has(oldId)){ set.delete(oldId); set.add(newId); }
  });
  const oldSock = io.sockets.sockets.get(oldId);
  if (oldSock) oldSock.disconnect(true);
  return p;
}

function refreshPlayerSessionToken(player){
  if (!player) return null;
  player.sessionToken = createPlayerSessionToken();
  return player.sessionToken;
}

// --------------------------- Sockets ---------------------------
io.on('connection', (socket) => {
  const role = socket.handshake.query.role;

  if (role === 'presentation'){
    presentationSockets.add(socket.id);
    try{ socket.emit('presentation_state', buildPresentationState()); }catch(e){}
    socket.on('disconnect', ()=>{ presentationSockets.delete(socket.id); });
    return;
  }

  if (role === 'host'){
    state.hostSocketId = socket.id;
    emitHostStatus();

    socket.on('host_rename_player', ({ playerId, name })=>{
      if (socket.id !== state.hostSocketId) return;
      const p = state.players[playerId]; if (!p) return;
      const safe = String(name||'Player').slice(0,24).replace(/[<>]/g,'');
      p.name = safe; broadcastLobby(); emitHostStatus(); broadcastPublicScoreboard();
    });
    socket.on('host_kick_player', ({ playerId })=>{
      if (socket.id !== state.hostSocketId) return;
      const s = io.sockets.sockets.get(playerId);
      if (s){ s.disconnect(true); } else {
        const p = state.players[playerId]; if (!p) return;
        if (p.inRoundHold){ p.inRoundHold=false; p.holdStartTs=null; }
        ['readyHoldersAll','requiredPressSet','lockedParticipants','outThisRound','participantsThisRound','readyForNextSet'].forEach(key=>state[key].delete(playerId));
        if (p.pin){ state.pinIndex.delete(p.pin); }
        delete state.players[playerId];
        updateNextRoundReadyState();
        emitHostStatus(); broadcastLobby(); broadcastPublicScoreboard();
      }
  const kickedName = (state.players[playerId]?.name || 'Player');
  io.to(socket.id).emit('host_action_ack', { ok:true, action:'kick_player', detail:`Kicked: ${kickedName}`, playerId, playerName: kickedName, ts: now() });
});
    socket.on('host_clean_ghosts', ()=>{
      if (socket.id !== state.hostSocketId) return;
      const live = new Set(io.sockets.sockets.keys());
      for (const id of Object.keys(state.players)){
        if (!live.has(id)){
          const p = state.players[id];
          if (p){
            ['readyHoldersAll','requiredPressSet','lockedParticipants','outThisRound','participantsThisRound','readyForNextSet'].forEach(key=>state[key].delete(id));
            if (p.pin) state.pinIndex.delete(p.pin);
            delete state.players[id];
          }
        }
      }
      updateNextRoundReadyState();
      emitHostStatus(); broadcastLobby(); broadcastPublicScoreboard();
  io.to(socket.id).emit('host_action_ack', { ok:true, action:'clean_ghosts', detail:'Ghosts cleared', ts: now() });
});

    socket.on('host_set_scoreboard_opts', ({ hostVisible, publicVisible })=>{
      state.ui.showHostScoreboard = !!hostVisible;
      state.ui.showPublicScoreboard = !!publicVisible;
      emitHostStatus(); broadcastPublicScoreboard();
    });
    // P212: Host-set Bonus Rounds
    socket.on('host_set_bonus', (cfg, ack)=>{
      const before = {...state.settings.bonus};
      const next = {
        enabled: (cfg?.enabled!==undefined) ? !!cfg.enabled : !!state.settings.bonus.enabled,
        value: Math.max(2, Math.min(5, Number(cfg?.value ?? state.settings.bonus.value ?? 2))),
        frequency: String(cfg?.frequency ?? state.settings.bonus.frequency ?? 'off'),
        manualFlag: !!cfg?.manualFlag || false
      };
      state.settings.bonus = next;
      emitHostStatus();
      io.emit('bonus_changed', state.settings.bonus);
      if (typeof ack === 'function') ack({ ok:true, before, after: next });
    });


    socket.on('host_start_game', ({ totalRounds, timeBankMinutes }, ack) => {
      startGame(totalRounds, timeBankMinutes);
      const rules = {
        totalRounds: state.settings.totalRounds,
        countdownSeconds: Math.round((state.countdownMs||5000)/1000),
        bonus: state.settings.bonus || {enabled:false},
        timeBankMinutes: state.settings.timeBankMinutes,
        finalRoundTokens: roundTokenValue(state.settings.totalRounds),
        autoEnd: true
      };
      const bonusEnabled = !!(rules.bonus && rules.bonus.enabled);
      let bonusText = '';
      if (bonusEnabled){
        const f = String(rules.bonus.frequency||'off');
        if (f==='every-3') bonusText = 'every 3 ×'+(rules.bonus.value||2);
        else if (f==='every-5') bonusText = 'every 5 ×'+(rules.bonus.value||2);
        else if (f==='manual') bonusText = 'manual ×'+(rules.bonus.value||2);
      }
      const lines = [
        `Rounds ${rules.totalRounds}, Countdown ${rules.countdownSeconds}s`,
        bonusEnabled ? `Bonus ${bonusText}` : null,
        `Final round is worth 🏆 ${rules.finalRoundTokens} tokens`,
        `The round ends when no one is holding`
      ].filter(Boolean);
      const rulesText = lines.join('\n');
      io.emit('game_started', { ts: now(), rules, rulesText });
      io.to(socket.id).emit('host_action_ack', { ok:true, action:'start_game', detail:'Game started', ts: now() });
      if (typeof ack==='function') ack({ok:true});
    });
    socket.on('host_stop_game', () => { stopGame(); io.to(socket.id).emit('host_action_ack', { ok:true, action:'stop_game', detail:'Game stopped', ts: now() }); });
    socket.on('host_new_match', () => { newMatch(); io.to(socket.id).emit('host_action_ack', { ok:true, action:'new_match', detail:'New match', ts: now() }); });
    socket.on('host_start_round', () => {
      if (!advanceToNextRound('host') && socket.id === state.hostSocketId){
        io.to(socket.id).emit('host_action_ack', { ok:false, action:'start_round', detail:'Unable to start round', ts: now() });
      }
    });
    socket.on('host_end_round', () => { if (state.phase!=='idle') { endRound('host'); io.to(socket.id).emit('host_action_ack', { ok:true, action:'end_round', detail:`Round ${state.currentRound} ended`, round: state.currentRound, ts: now() }); } });
    socket.on('disconnect', ()=>{ if (state.hostSocketId === socket.id) state.hostSocketId = null; });
    // v4.17 host settings handlers (acks + broadcast)
    socket.on('host_set_hb_ramp', (cfg, ack)=>{
      state.settings.hbRamp = {
        enabled: (cfg && 'enabled' in cfg) ? !!cfg.enabled : (state.settings.hbRamp && state.settings.hbRamp.enabled) || false,
        intervalSec: Math.max(5, Math.min(120, Number((cfg && cfg.intervalSec)!=null ? cfg.intervalSec : (state.settings.hbRamp && state.settings.hbRamp.intervalSec) || 30))),
        multiplier: Math.max(0.5, Math.min(0.99, Number((cfg && cfg.multiplier)!=null ? cfg.multiplier : (state.settings.hbRamp && state.settings.hbRamp.multiplier) || 0.9))),
        minMs: Math.max(100, Number((cfg && cfg.minMs)!=null ? cfg.minMs : (state.settings.hbRamp && state.settings.hbRamp.minMs) || 500)),
        maxMs: Math.max(100, Number((cfg && cfg.maxMs)!=null ? cfg.maxMs : (state.settings.hbRamp && state.settings.hbRamp.maxMs) || 750)),
      };
      emitHostStatus(); io.emit('hb_ramp_changed', state.settings.hbRamp);
      if (typeof ack==='function') ack({ ok:true });
      io.to(socket.id).emit('host_action_ack', { ok:true, action:'apply_hb_ramp', detail:'Heartbeat ramp applied', ts: now() });
    });
    socket.on('host_set_final_boost', (cfg, ack)=>{
      state.settings.finalBoost = {
        enabled: !!(cfg && cfg.enabled),
        multiplier: Math.max(1, Number((cfg && cfg.multiplier)!=null ? cfg.multiplier : (state.settings.finalBoost && state.settings.finalBoost.multiplier) || 2)),
        overrideBonus: !!(cfg && cfg.overrideBonus),
      };
      emitHostStatus(); io.emit('final_boost_changed', state.settings.finalBoost);
      if (typeof ack==='function') ack({ ok:true });
      io.to(socket.id).emit('host_action_ack', { ok:true, action:'apply_final_boost', detail:'Final boost applied', ts: now() });
    });
    socket.on('host_set_streak', (cfg, ack)=>{
      state.settings.streak = { enabled: !!(cfg && cfg.enabled), cap: Math.max(1, Number((cfg && cfg.cap)!=null ? cfg.cap : (state.settings.streak && state.settings.streak.cap) || 3)) };
      emitHostStatus(); io.emit('streak_changed', state.settings.streak);
      if (typeof ack==='function') ack({ ok:true });
      io.to(socket.id).emit('host_action_ack', { ok:true, action:'apply_streak', detail:'Streak settings applied', ts: now() });
    });
    socket.on('host_set_comeback', (cfg, ack)=>{
      state.settings.comeback = { enabled: !!(cfg && cfg.enabled), threshold: Math.max(1, Number((cfg && cfg.threshold)!=null ? cfg.threshold : (state.settings.comeback && state.settings.comeback.threshold) || 3)) };
      emitHostStatus(); io.emit('comeback_changed', state.settings.comeback);
      if (typeof ack==='function') ack({ ok:true });
      io.to(socket.id).emit('host_action_ack', { ok:true, action:'apply_comeback', detail:'Comeback settings applied', ts: now() });
    });
    socket.on('host_set_theme', (cfg={}, ack)=>{
      state.ui.theme = String(cfg.theme || 'default');
      emitHostStatus(); io.emit('theme_changed', { theme: state.ui.theme });
      if (typeof ack==='function') ack({ ok:true });
      io.to(socket.id).emit('host_action_ack', { ok:true, action:'apply_theme', detail:'Theme: '+state.ui.theme, ts: now() });
    });
    socket.on('host_set_spotlight', (cfg={}, ack)=>{
      state.ui.spotlight = !!cfg.enabled;
      emitHostStatus(); io.emit('spotlight_changed', { enabled: state.ui.spotlight });
      if (typeof ack==='function') ack({ ok:true });
      io.to(socket.id).emit('host_action_ack', { ok:true, action:'apply_spotlight', detail:'Spotlight ' + (state.ui.spotlight?'on':'off'), ts: now() });
    });

    return;
  }

  // Player connection
  state.players[socket.id] = {
    id: socket.id,
    name: 'Player',
    joined: false,
    tokens: 0,
    timeRemainingMs: 0,
    exhausted: false,
    inRoundHold: false,
    holdStartTs: null,
    autoExhaustTimeout: null,
    roundsActive: 0,
    lastVictoryRound: null,
    pin: null,
    sessionToken: null,
  };

  const releaseHold = (player)=>{
    const p = player; if (!p || !p.inRoundHold) return;
    const ts = now();

    if (state.phase==='active'){
      let delta = clamp(ts - (p.holdStartTs || ts), 0, p.timeRemainingMs);
      p.timeRemainingMs -= delta; state.roundHolds[p.id] = (state.roundHolds[p.id]||0) + delta;
      if (p.timeRemainingMs === 0 && !p.exhausted){ p.exhausted = true; io.to(p.id).emit('exhausted'); }
    }

    p.inRoundHold = false; p.holdStartTs = null; if (p.autoExhaustTimeout){ clearTimeout(p.autoExhaustTimeout); p.autoExhaustTimeout = null; }

    if (state.phase==='arming'){ state.readyHoldersAll.delete(p.id); checkAllHoldGate(); emitHostStatus(); }
    else if (state.phase==='countdown' || state.phase==='active'){
      if (state.lockedParticipants.has(p.id)) state.outThisRound.add(p.id);
      emitHostStatus();
      setTimeout(()=>{ if (state.roundActive && !Object.values(state.players).some(x=>x.inRoundHold) && anyPlayerHeldThisRound()){ endRound('auto-empty'); } }, 400);
    }
  };

  socket.on('player_join', ({ name })=>{
    const safe = String(name || 'Player').slice(0,24).replace(/[<>]/g,'');
    const p = state.players[socket.id]; if (!p) return;
    p.name = safe; p.joined = true;
    if (!p.pin){ p.pin = assignPinUnique(); state.pinIndex.set(p.pin, p.id); }
    refreshPlayerSessionToken(p);
    socket.emit('joined', { id: p.id, name: p.name, tokens: p.tokens, pin: p.pin, sessionToken: p.sessionToken, timeBankMinutes: state.settings.timeBankMinutes });
    if (state.phase==='arming'){ /* will join next round */ }
    broadcastLobby();
    updateNextRoundReadyState();
    emitHostStatus(); broadcastPublicScoreboard();
  });

  socket.on('player_reconnect', ({ pin })=>{
    const targetId = state.pinIndex.get(String(pin));
    if (!targetId){ socket.emit('reconnect_result', { ok:false, error:'PIN not found' }); return; }
    if (targetId === socket.id){
      const p = state.players[targetId];
      socket.emit('reconnect_result', { ok:true, name:p.name, tokens:p.tokens, pin:p.pin });
      return;
    }
    const p = state.players[targetId];
    if (!p){ socket.emit('reconnect_result', { ok:false, error:'Player not found' }); return; }
    const moved = rebindPlayerSocket(targetId, socket);
    if (!moved){ socket.emit('reconnect_result', { ok:false, error:'Rebind failed' }); return; }
    moved.joined = true;
    refreshPlayerSessionToken(moved);
    socket.emit('joined', { id: moved.id, name: moved.name, tokens: moved.tokens, pin: moved.pin, sessionToken: moved.sessionToken, timeBankMinutes: state.settings.timeBankMinutes });
    socket.emit('reconnect_result', { ok:true, name:moved.name, tokens:moved.tokens, pin:moved.pin });
    broadcastLobby();
    updateNextRoundReadyState();
    emitHostStatus(); broadcastPublicScoreboard();
  });

  socket.on('player_resume', ({ pin, sessionToken }, ack)=>{
    const targetId = state.pinIndex.get(String(pin));
    if (!targetId){ if (typeof ack==='function') ack({ ok:false, error:'PIN not found' }); return; }
    const p = state.players[targetId];
    if (!p){ if (typeof ack==='function') ack({ ok:false, error:'Player not found' }); return; }
    if (String(p.sessionToken||'') !== String(sessionToken||'')){
      if (typeof ack==='function') ack({ ok:false, error:'Session mismatch', code:'session_mismatch' });
      return;
    }
    const moved = (targetId === socket.id) ? p : rebindPlayerSocket(targetId, socket);
    if (!moved){ if (typeof ack==='function') ack({ ok:false, error:'Resume failed' }); return; }
    moved.joined = true;
    refreshPlayerSessionToken(moved);
    socket.emit('joined', { id: moved.id, name: moved.name, tokens: moved.tokens, pin: moved.pin, sessionToken: moved.sessionToken, timeBankMinutes: state.settings.timeBankMinutes });
    broadcastLobby();
    updateNextRoundReadyState();
    emitHostStatus(); broadcastPublicScoreboard();
    if (typeof ack==='function') ack({ ok:true, id: moved.id, name: moved.name, tokens: moved.tokens, pin: moved.pin, sessionToken: moved.sessionToken, timeBankMinutes: state.settings.timeBankMinutes });
  });

  socket.on('player_ready_next', ()=>{
    const p = state.players[socket.id]; if (!p || !p.joined) return;
    if (!isBetweenRounds()) return;
    if (p.exhausted) return;
    if (!state.readyForNextSet.has(p.id)) state.readyForNextSet.add(p.id);
    updateNextRoundReadyState();
    emitHostStatus();
  });

  socket.on('player_unready_next', ()=>{
    const p = state.players[socket.id]; if (!p || !p.joined) return;
    if (!state.readyForNextSet.has(p.id)) return;
    state.readyForNextSet.delete(p.id);
    updateNextRoundReadyState();
    emitHostStatus();
  });

  socket.on('hold_press', ()=>{
    const p = state.players[socket.id]; if (!p || !p.joined) return;

    if (state.phase==='countdown' || state.phase==='active'){
      const isLocked = state.lockedParticipants.has(p.id);
      if (!isLocked || state.outThisRound.has(p.id) || p.exhausted) return;
    }

    if (p.inRoundHold) return;
    if (state.phase === 'active'){ clearNoHoldTimer(); }
    p.inRoundHold = true;

    if (state.phase==='active'){ p.holdStartTs = now(); scheduleExhaustTimeout(p); }
    else { p.holdStartTs = now(); if (p.autoExhaustTimeout){ clearTimeout(p.autoExhaustTimeout); p.autoExhaustTimeout=null; } }

    if (state.phase==='arming' && state.requiredPressSet.has(p.id)){
      state.readyHoldersAll.add(p.id); checkAllHoldGate(); emitHostStatus();
    }
  });

  socket.on('hold_release', ()=>{
    const p = state.players[socket.id]; if (!p) return;
    releaseHold(p);
  });

  socket.on('player_pause', ()=>{
    const p = state.players[socket.id]; if (!p) return;
    releaseHold(p);
  });

  socket.on('disconnect', ()=>{
    const p = state.players[socket.id]; if (!p) return;
    if (p.autoExhaustTimeout){ clearTimeout(p.autoExhaustTimeout); }

    if (p.inRoundHold){
      const ts = now();
      if (state.phase==='active'){
        let delta = clamp(ts - (p.holdStartTs || ts), 0, p.timeRemainingMs);
        p.timeRemainingMs -= delta; state.roundHolds[p.id] = (state.roundHolds[p.id]||0) + delta;
        if (p.timeRemainingMs === 0 && !p.exhausted){ p.exhausted = true; io.to(p.id).emit('exhausted'); }
      }
      p.inRoundHold=false; p.holdStartTs=null;
      if ((state.phase==='countdown' || state.phase==='active') && state.lockedParticipants.has(p.id)) state.outThisRound.add(p.id);
    }

    ['readyHoldersAll','requiredPressSet','lockedParticipants','participantsThisRound','readyForNextSet'].forEach(key=>state[key].delete(p.id));
    // keep player record to allow PIN reconnect

    updateNextRoundReadyState();
    emitHostStatus(); broadcastLobby(); broadcastPublicScoreboard();
  });
});

server.listen(PORT, ()=>{ console.log(`Time-Bank Auction running on http://localhost:${PORT}`); });
