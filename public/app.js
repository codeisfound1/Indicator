// app.js - frontend logic (vanilla JS) for Grid Finder
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
const highContrastCheckbox = document.getElementById('high-contrast');
const bestTimesEl = document.getElementById('best-times');

let client = {
  playerId: null,
  name: null,
  roomId: null,
  gridSeed: null,
  gridMap: {}, // playerId -> shuffled array
  levelSettings: null,
  nextNumber: 1,
  cellSize: 60,
  fontCell: 25,
  fontTarget: 65
};

// helper: format ms to mm:ss
function formatMs(ms) {
  if (ms == null) return '--:--';
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

// auto show/hide custom input
levelSelect.addEventListener('change', () => {
  if (levelSelect.value === 'custom') customN.style.display = 'inline-block';
  else customN.style.display = 'none';
});

// create room
btnNewRoom.addEventListener('click', () => {
  const level = levelSelect.value;
  const n = level === 'custom' ? parseInt(customN.value,10) || 10 : undefined;
  const settings = {
    countdown: 600,
    cellSize: 60,
    fontCell: 25,
    fontTarget: 65,
    highContrast: false
  };
  socket.emit('create_room', { level, n, playerName: null, settings });
});

// leave
btnLeave.addEventListener('click', () => {
  // simple: reload to get back to lobby
  location.reload();
});

// start
btnStart.addEventListener('click', () => {
  if (!client.roomId) return;
  socket.emit('start_game', { roomId: client.roomId });
});

// chat
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const txt = chatInput.value.trim();
  if (!txt || !client.roomId || !client.playerId) return;
  socket.emit('send_chat', { roomId: client.roomId, playerId: client.playerId, message: txt });
  chatInput.value = '';
});

// socket handlers
socket.on('room_list_update', (list) => {
  renderRoomList(list);
});

socket.on('room_update', (room) => {
  // open room panel if this client is in it
  if (!client.roomId) {
    // join if just created/joined?
  }
  renderRoomInfo(room);
});

socket.on('game_start', (data) => {
  client.gridSeed = data.gridSeed;
  client.levelSettings = data.levelSettings;
  initGameForRoom(data.roomId, data.levelSettings);
});

socket.on('game_state', (data) => {
  updateGameState(data);
});

socket.on('player_finished', (data) => {
  // show toast or mark player finished
  updatePlayerFinish(data.playerId, data.finishTime);
});

socket.on('best_time_update', (data) => {
  showBestTime(data.playerId, data.bestTime);
});

socket.on('chat_message', (m) => {
  appendChatMessage(m);
});

socket.on('player_kicked', (data) => {
  // if this client got kicked, reload
  if (data.playerId === client.playerId) {
    alert('You were removed: ' + (data.reason || 'unknown'));
    location.reload();
  }
});

// utility renderers
function renderRoomList(list) {
  roomsEl.innerHTML = '';
  list.forEach(r => {
    const el = document.createElement('div');
    el.className = 'room-card';
    el.innerHTML = `<div><strong>${r.level}</strong></div>
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
  // if we are inside this room, show panel
  const inRoom = room.players.some(p => p.isHost || true); // show always when updated
  // if client is not in a room but this update corresponds to a room they created/joined, we need to detect
  // For simplicity, open panel if this client is player in the room
  const clientPlayer = room.players.find(p => p.playerId === client.playerId);
  if (clientPlayer) {
    lobbySection.classList.add('hidden');
    roomPanel.classList.remove('hidden');
    roomInfo.innerText = `Room ${room.id} — ${room.level}`;
    // show start only to host
    if (clientPlayer.isHost && room.status === 'lobby') btnStart.classList.remove('hidden');
    else btnStart.classList.add('hidden');
    // render players
    playersList.innerHTML = '';
    room.players.forEach(p => {
      const pr = document.createElement('div');
      pr.className = 'player-row';
      pr.innerHTML = `<div>${p.name}${p.isHost ? ' (host)' : ''}${p.disconnected ? ' (disconnected)' : ''}</div><div>${p.finished ? '✓' : ''}</div>`;
      playersList.appendChild(pr);
    });
    // store client ids
    client.roomId = room.id;
    client.playerId = client.playerId || (clientPlayer ? clientPlayer.playerId : client.playerId);
    // show best times summary
    bestTimesEl.innerText = room.players.map(p => `${p.name}: ${formatMs(p.bestTime)}`).join(' | ');
  } else {
    // Not our room update: update rooms panel only
  }
}

// When joined/created room server sends room_update; but client may not know own playerId.
// To capture it, we listen to room_update and if socket id matches unknown, we assign first new player entry:
socket.on('room_update', (room) => {
  // if we don't have client.playerId and this socket just joined, try to detect by name prompt fallback
  if (!client.playerId && room.players.length > 0) {
    // If server included our name, match by socket's ephemeral id is not possible on client side.
    // We'll assign client.playerId by finding a player with no bestTime and not host maybe.
    // Simpler: if client has no roomId and we just created or joined, the server will immediately emit room_update, assume the newest player is us.
    const unknown = room.players[room.players.length - 1];
    if (!client.roomId) {
      client.roomId = room.id;
      client.playerId = unknown.playerId;
    }
  }
  renderRoomInfo(room);
});

// Initialize game UI
function initGameForRoom(roomId, levelSettings) {
  // show room panel
  lobbySection.classList.add('hidden');
  roomPanel.classList.remove('hidden');
  client.roomId = roomId;
  client.levelSettings = levelSettings;
  // determine layout based on players count later from game_state
  gridsContainer.innerHTML = '';
  // create our grid and others as thumbnails
  createOrUpdateGrid(client.playerId, true);
}

// Update game state
function updateGameState(data) {
  // update timer
  const timeLeft = data.timeLeft;
  timerEl.innerText = formatMs(timeLeft * 1000);
  // update players state and grids
  const playersState = data.playersState;
  const pids = Object.keys(playersState);
  // layout class
  const count = pids.length;
  gridsContainer.className = '';
  gridsContainer.classList.add('layout-' + Math.min(count,4));
  // render each player's grid
  pids.forEach(pid => {
    const state = playersState[pid];
    // ensure grid exists
    createOrUpdateGrid(pid, pid === client.playerId, state);
  });
  // update HUD target for local player
  const me = playersState[client.playerId];
  if (me) {
    targetNumberEl.innerText = me.nextNumber;
  }
  // update best times area
  bestTimesEl.innerText = Object.values(playersState).map(s => `${s.name || s.playerId}:${formatMs(s.bestTime)}`).join(' | ');
}

// Create or update grid for a player
function createOrUpdateGrid(playerId, isMain, state) {
  // determine container id
  let container = document.getElementById('grid-' + playerId);
  const level = client.levelSettings ? client.levelSettings.level : 'easy';
  const n = client.levelSettings ? (client.levelSettings.n || (levelToN(level))) : levelToN(level);

  if (!container) {
    container = document.createElement('div');
    container.id = 'grid-' + playerId;
    container.className = 'grid-wrapper';
    gridsContainer.appendChild(container);
  }
  // compute cell size responsive
  const { cols, rows } = { cols: n, rows: n };
  const availableWidth = Math.max(200, Math.min(window.innerWidth - 320, 700));
  const availableHeight = Math.max(200, window.innerHeight - 220);
  const maxAllowed = isMain ? 60 : 36;
  const cellSize = Math.floor(Math.min(availableWidth / cols, availableHeight / rows, maxAllowed));
  client.cellSize = cellSize;
  const svgSizeW = cols * cellSize;
  const svgSizeH = rows * cellSize;

  // generate or reuse shuffled map per player
  if (!client.gridMap[playerId]) {
    client.gridMap[playerId] = shuffleArray(range(1, cols * rows), hashSeedForPlayer(client.gridSeed || Math.random()*1e9, playerId));
  }
  const arr = client.gridMap[playerId];

  // build SVG
  container.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'grid-title';
  title.innerText = isMain ? 'You' : (state && state.name ? state.name : playerId);
  container.appendChild(title);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', svgSizeW);
  svg.setAttribute('height', svgSizeH);
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

      // background color via HSL palette for deterministic but different per cell
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

      // choose text color by luminance (simplified)
      const textColor = luminanceFromHSL(hue, sat, light) > 0.6 ? '#000' : '#fff';
      const txt = document.createElementNS(svgNS, 'text');
      txt.setAttribute('x', cellSize / 2);
      txt.setAttribute('y', cellSize / 2 + (client.fontCell || 0) / 3);
      txt.setAttribute('font-size', Math.floor(cellSize * 0.45));
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('fill', textColor);
      txt.textContent = String(num);
      g.appendChild(txt);

      // overlay for selected state
      const overlay = document.createElementNS(svgNS, 'rect');
      overlay.setAttribute('width', cellSize);
      overlay.setAttribute('height', cellSize);
      overlay.setAttribute('fill', 'rgba(0,0,0,0)');
      overlay.classList.add('cell-overlay');
      g.appendChild(overlay);

      // click/touch handler only for local player's main grid
      if (isMain) {
        g.addEventListener('click', () => {
          attemptSelect(Number(g.dataset.number));
        });
        g.addEventListener('touchstart', (ev) => {
          ev.preventDefault();
          attemptSelect(Number(g.dataset.number));
        }, { passive: false });
      }

      svg.appendChild(g);
    }
  }

  container.appendChild(svg);

  // mark selected cells based on state.selectedCount (server authoritative)
  if (state && state.selectedCount) {
    // mark first selectedCount numbers
    const selectedSet = new Set(state.selectedCount ? (Array.from({length: state.selectedCount}).map((_,i)=>i+1)) : []);
    // instead use state.nextNumber to know which numbers completed:
    const doneCount = (state.nextNumber || 1) - 1;
    // mark numbers 1..doneCount visually
    const cells = svg.querySelectorAll('.cell');
    cells.forEach(cell => {
      const num = Number(cell.dataset.number);
      if (num <= doneCount) {
        cell.querySelector('rect').setAttribute('fill', '#222');
        cell.querySelector('text').setAttribute('fill', '#fff');
      }
    });
  }
}

// Attempt to select a number locally -> send to server
function attemptSelect(num) {
  if (!client.roomId || !client.playerId) return;
  socket.emit('cell_selected', { roomId: client.roomId, playerId: client.playerId, cellNumber: num });
}

// append chat message
function appendChatMessage(m) {
  const d = new Date(m.ts || Date.now());
  const el = document.createElement('div');
  el.textContent = `[${d.toLocaleTimeString()}] ${m.name}: ${m.message}`;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// utility helpers
function range(a, b) {
  const res = [];
  for (let i = a; i <= b; i++) res.push(i);
  return res;
}

function shuffleArray(arr, seed) {
  // deterministic seeded shuffle (Fisher-Yates with xorshift32)
  const a = arr.slice();
  let rnd = seed || Math.floor(Math.random()*1e9);
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
  // combine numeric seed and playerId to derive per-player seed
  let s = Math.floor(seed || 0);
  for (let i = 0; i < playerId.length; i++) {
    s = (s * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  return s || 1;
}

function luminanceFromHSL(h, s, l) {
  // approximate luminance from HSL's lightness
  return l / 100;
}

function levelToN(level) {
  if (level === 'easy') return 5;
  if (level === 'medium') return 7;
  if (level === 'hard') return 10;
  return 10;
}

function updatePlayerFinish(playerId, finishMs) {
  // mark UI
  const el = document.getElementById('grid-' + playerId);
  if (el) {
    el.classList.add('finished');
    const label = el.querySelector('.grid-title');
    if (label) label.innerText += ` ✓ ${formatMs(finishMs)}`;
  }
}

function showBestTime(playerId, bestMs) {
  // update bestTimes area
  const prev = bestTimesEl.innerText || '';
  bestTimesEl.innerText = prev + ` | ${playerId}:${formatMs(bestMs)}`;
}

// initial UI
document.addEventListener('DOMContentLoaded', () => {
  // nothing extra
});
