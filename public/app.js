// app.js - frontend logic (fixed grid sync & selection)
// Connect to socket.io and implement lobby, room, grid rendering (SVG), interactions.

const socket = io();

// DOM refs
const roomsEl = document.getElementById('rooms');
const btnNewRoom = document.getElementById('btn-new-room');
const levelSelect = document.getElementById('level-select');
const customN = document.getElementById('custom-n');
const roomPanel = document.getElementById('room-panel');
const lobbySection = document.getElementById('lobby');
const btnStart = document.getElementById('btn-start');
const btnLeave = document.getElementById('btn-leave');
const roomInfo = document.getElementById('room-info');
const playersList = document.getElementById('players-list');
const gridsContainer = document.getElementById('grids-container');
const targetNumberEl = document.getElementById('target-number');
const timerEl = document.getElementById('timer');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const bestTimesEl = document.getElementById('best-times');

let client = {
  playerId: null,
  name: null,
  roomId: null,
  gridSeed: null,
  gridMap: {}, // playerId -> shuffled array (1..N)
  levelSettings: null,
  cellSize: 60,
  fontCell: 25,
  fontTarget: 65
};

// helpers
function formatMs(ms) {
  if (ms == null) return '--:--';
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

levelSelect.addEventListener('change', () => {
  if (levelSelect.value === 'custom') customN.style.display = 'inline-block';
  else customN.style.display = 'none';
});

btnNewRoom.addEventListener('click', () => {
  const level = levelSelect.value;
  const n = level === 'custom' ? parseInt(customN.value,10) || 10 : undefined;
  const settings = { countdown: 600, cellSize: 60, fontCell: 25, fontTarget: 65, highContrast: false };
  socket.emit('create_room', { level, n, playerName: null, settings });
});

btnLeave.addEventListener('click', () => {
  location.reload();
});

btnStart.addEventListener('click', () => {
  if (!client.roomId) return;
  socket.emit('start_game', { roomId: client.roomId });
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const txt = chatInput.value.trim();
  if (!txt || !client.roomId || !client.playerId) return;
  socket.emit('send_chat', { roomId: client.roomId, playerId: client.playerId, message: txt });
  chatInput.value = '';
});

// socket handlers
socket.on('room_list_update', (list) => renderRoomList(list));

socket.on('room_update', (room) => {
  // If client not assigned playerId yet but server returned a player that matches local ephemeral assumptions,
  // attempt to capture our playerId if room includes a recently joined player.
  // Simpler flow: if client.roomId is null and we are now in a room (we created/joined), find a player with our random name if set.
  if (!client.roomId && room.players.length > 0) {
    // try to detect by matching name if we set one earlier
    // otherwise we will set client.playerId when server includes it in subsequent events; safe fallback
  }
  renderRoomInfo(room);
});

socket.on('game_start', (data) => {
  client.gridSeed = data.gridSeed;
  client.levelSettings = data.levelSettings;
  client.roomId = data.roomId;
  // clear any previous maps so deterministic new maps are built
  client.gridMap = {};
  initGameForRoom(data.roomId, data.levelSettings);
});

socket.on('game_state', (data) => updateGameState(data));

socket.on('player_finished', (data) => updatePlayerFinish(data.playerId, data.finishTime));

socket.on('best_time_update', (data) => showBestTime(data.playerId, data.bestTime));

socket.on('chat_message', (m) => appendChatMessage(m));

socket.on('player_kicked', (data) => {
  if (data.playerId === client.playerId) {
    alert('You were removed: ' + (data.reason || 'unknown'));
    location.reload();
  }
});

socket.on('invalid_selection', (d) => {
  // optional UI hint: shake or toast
  console.warn('invalid_selection', d);
});

// UI renderers
function renderRoomList(list) {
  roomsEl.innerHTML = '';
  list.forEach(r => {
    const el = document.createElement('div');
    el.className = 'room-card';
    el.innerHTML = `<div><strong>${r.level} (${r.n}x${r.n})</strong></div>
      <div>Players: ${r.players}</div>
      <div>Status: ${r.status}</div>
      <div><button data-room="${r.id}">Join</button></div>`;
    roomsEl.appendChild(el);
    el.querySelector('button').addEventListener('click', () => {
      const name = prompt('Your name (optional):');
      socket.emit('join_room', { roomId: r.id, playerName: name || null });
    });
  });
}

function renderRoomInfo(room) {
  // show panel if we are in this room (best-effort)
  const me = client.playerId && room.players.find(p => p.playerId === client.playerId);
  if (!client.roomId && room.players.some(p => p.name === client.name)) {
    // fallback: assume last joined with our name is us — not perfect but harmless
  }
  // If we are member of this room, show panel
  const inRoom = client.roomId === room.id || room.players.some(p => p.playerId === client.playerId);
  if (inRoom) {
    lobbySection.classList.add('hidden');
    roomPanel.classList.remove('hidden');
    roomInfo.innerText = `Room ${room.id} — ${room.level} ${room.n}x${room.n}`;
    const cp = room.players.find(p => p.playerId === client.playerId);
    if (cp && cp.isHost && room.status === 'lobby') btnStart.classList.remove('hidden');
    else btnStart.classList.add('hidden');
    playersList.innerHTML = '';
    room.players.forEach(p => {
      const pr = document.createElement('div');
      pr.className = 'player-row';
      pr.innerHTML = `<div>${p.name}${p.isHost ? ' (host)' : ''}${p.disconnected ? ' (disconnected)' : ''}</div><div>${p.finished ? '✓' : ''}</div>`;
      playersList.appendChild(pr);
    });
    client.roomId = room.id;
    // If client.playerId not set, try to set from players list by matching unique best attempt: if only one player is new
    if (!client.playerId) {
      // assume last player in the array is this client after join/create
      const last = room.players[room.players.length - 1];
      if (last) client.playerId = last.playerId;
    }
    bestTimesEl.innerText = room.players.map(p => `${p.name}: ${formatMs(p.bestTime)}`).join(' | ');
  }
}

function initGameForRoom(roomId, levelSettings) {
  lobbySection.classList.add('hidden');
  roomPanel.classList.remove('hidden');
  client.roomId = roomId;
  client.levelSettings = levelSettings;
  gridsContainer.innerHTML = '';
}

// update game state UI
function updateGameState(data) {
  timerEl.innerText = formatMs(data.timeLeft * 1000);
  const playersState = data.playersState;
  const pids = Object.keys(playersState);
  const count = pids.length;
  gridsContainer.className = '';
  gridsContainer.classList.add('layout-' + Math.min(count,4));
  pids.forEach(pid => {
    const state = playersState[pid];
    createOrUpdateGrid(pid, pid === client.playerId, state);
  });
  const me = playersState[client.playerId];
  if (me) targetNumberEl.innerText = me.nextNumber;
  bestTimesEl.innerText = Object.values(playersState).map(s => `${s.name || s.playerId}:${formatMs(s.bestTime)}`).join(' | ');
}

function createOrUpdateGrid(playerId, isMain, state) {
  const containerId = 'grid-' + playerId;
  let container = document.getElementById(containerId);
  const level = client.levelSettings ? client.levelSettings.level : 'easy';
  const n = client.levelSettings ? client.levelSettings.n : levelToN(level);
  const cols = n, rows = n;

  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'grid-wrapper';
    gridsContainer.appendChild(container);
  }

  // compute available area (simple heuristic)
  const availableWidth = Math.max(200, Math.min(window.innerWidth - 320, 800));
  const availableHeight = Math.max(200, window.innerHeight - 220);
  const maxAllowed = isMain ? 60 : 36;
  const cellSize = Math.floor(Math.min(availableWidth / cols, availableHeight / rows, maxAllowed));
  client.cellSize = cellSize;
  const svgW = cols * cellSize;
  const svgH = rows * cellSize;

  // ensure deterministic shuffle per player: use server seed + playerId
  if (!client.gridMap[playerId]) {
    const seed = Number(client.gridSeed) || Math.floor(Math.random() * 1e9);
    client.gridMap[playerId] = shuffleArray(range(1, cols * rows), hashSeedForPlayer(seed, playerId));
  }
  const arr = client.gridMap[playerId];

  container.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'grid-title';
  title.innerText = isMain ? 'You' : (state && state.name ? state.name : playerId);
  container.appendChild(title);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.classList.add('grid');

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const num = arr[idx];
      const x = c * cellSize;
      const y = r * cellSize;
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('transform', `translate(${x},${y})`);
      g.classList.add('cell');
      g.dataset.number = num;

      const hue = Math.floor((num * 137.5) % 360);
      const sat = 60;
      const light = isMain ? 60 : 55;
      const bg = `hsl(${hue} ${sat}% ${light}%)`;
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('width', cellSize);
      rect.setAttribute('height', cellSize);
      rect.setAttribute('rx', Math.max(2, Math.floor(cellSize * 0.06)));
      rect.setAttribute('fill', bg);
      g.appendChild(rect);

      const textColor = luminanceFromHSL(hue, sat, light) > 0.6 ? '#000' : '#fff';
      const txt = document.createElementNS(svgNS, 'text');
      txt.setAttribute('x', cellSize / 2);
      txt.setAttribute('y', cellSize / 2 + Math.floor(cellSize * 0.15));
      txt.setAttribute('font-size', Math.floor(cellSize * 0.45));
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('fill', textColor);
      txt.textContent = String(num);
      g.appendChild(txt);

      svg.appendChild(g);

      if (isMain) {
        g.addEventListener('click', () => attemptSelect(Number(g.dataset.number)));
        g.addEventListener('touchstart', (ev) => { ev.preventDefault(); attemptSelect(Number(g.dataset.number)); }, { passive: false });
      }
    }
  }

  container.appendChild(svg);

  // mark selected cells using server-provided selectedNumbers array
  const doneSet = new Set((state && state.selectedNumbers) || []);
  const cells = svg.querySelectorAll('.cell');
  cells.forEach(cell => {
    const num = Number(cell.dataset.number);
    const rect = cell.querySelector('rect');
    const text = cell.querySelector('text');
    if (doneSet.has(num)) {
      if (rect) rect.setAttribute('fill', '#222');
      if (text) text.setAttribute('fill', '#fff');
    }
  });
}

function attemptSelect(num) {
  if (!client.roomId || !client.playerId) return;
  socket.emit('cell_selected', { roomId: client.roomId, playerId: client.playerId, cellNumber: num });
}

function appendChatMessage(m) {
  const d = new Date(m.ts || Date.now());
  const el = document.createElement('div');
  el.textContent = `[${d.toLocaleTimeString()}] ${m.name}: ${m.message}`;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// helpers
function range(a, b) {
  const res = [];
  for (let i = a; i <= b; i++) res.push(i);
  return res;
}

function shuffleArray(arr, seed) {
  const a = arr.slice();
  let rnd = seed >>> 0;
  if (!rnd) rnd = Math.floor(Math.random() * 1e9);
  function xorshift() {
    rnd ^= rnd << 13;
    rnd ^= rnd >>> 17;
    rnd ^= rnd << 5;
    return (rnd >>> 0) / 0xFFFFFFFF;
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(xorshift() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hashSeedForPlayer(seed, playerId) {
  let s = Number(seed) >>> 0;
  for (let i = 0; i < playerId.length; i++) {
    s = (s * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  return s || 1;
}

function luminanceFromHSL(h, s, l) {
  return l / 100;
}

function levelToN(level) {
  if (level === 'easy') return 5;
  if (level === 'medium') return 7;
  if (level === 'hard') return 10;
  return 10;
}

function updatePlayerFinish(playerId, finishMs) {
  const el = document.getElementById('grid-' + playerId);
  if (el) {
    el.classList.add('finished');
    const label = el.querySelector('.grid-title');
    if (label) label.innerText += ` ✓ ${formatMs(finishMs)}`;
  }
}

function showBestTime(playerId, bestMs) {
  const prev = bestTimesEl.innerText || '';
  bestTimesEl.innerText = prev + ` | ${playerId}:${formatMs(bestMs)}`;
}
