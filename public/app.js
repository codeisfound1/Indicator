// public/app.js
// Frontend vanilla JS connecting to Socket.IO, rendering SVG grids, responsive sizing, multiplayer layouts.
// Note: code is commented and intentionally straightforward.

const socket = io();

// Defaults consistent with server
const DEFAULTS = { cellSize: 60, fontCell: 25, fontTarget: 65, countdown: 600 };

// UI elements
const roomsListEl = document.getElementById('rooms-list');
const btnNewRoom = document.getElementById('btn-new-room');
const btnRefresh = document.getElementById('btn-refresh-rooms');
const selectLevel = document.getElementById('select-level');
const inputN = document.getElementById('input-n');
const gridPanel = document.getElementById('grid-panel');
const playersList = document.getElementById('players-list');
const roomNameEl = document.getElementById('room-name');
const timerEl = document.getElementById('timer');
const targetNumberEl = document.getElementById('target-number');
const btnStart = document.getElementById('btn-start');
const chkReady = document.getElementById('chk-ready');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

const settingCell = document.getElementById('setting-cellSize');
const settingFontCell = document.getElementById('setting-fontCell');
const settingFontTarget = document.getElementById('setting-fontTarget');
const settingCountdown = document.getElementById('setting-countdown');

let myName = null;
let myRoom = null;
let myId = null;
let roomState = null;
let seeds = {}; // playerId -> seed
let grids = {}; // playerId -> {n, arr}

// Helpers
function q(sel) { return document.querySelector(sel); }
function clearChildren(el){ while(el.firstChild) el.removeChild(el.firstChild); }

// Generate a deterministic pseudo-random shuffle from seed (simple mulberry32)
function seedToRand(seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return function() {
    h += 0x6D2B79F5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate grid numbers 1..n^2 shuffled
function genGrid(seed, n) {
  const rand = seedToRand(seed);
  const total = n * n;
  const arr = Array.from({length: total}, (_,i)=>i+1);
  // Fisher-Yates
  for (let i = arr.length -1; i>0; i--) {
    const j = Math.floor(rand() * (i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Color helpers: HSL palette with min hue distance and readable text color
function genDistinctColors(count) {
  const colors = [];
  const step = Math.floor(360 / count);
  for (let i=0;i<count;i++){
    const h = (i * step + Math.floor(Math.random()*step)) % 360;
    colors.push(`hsl(${h} ${60}% ${70}%)`); // use space-separated modern hsl to allow % in luminance calc
  }
  return colors;
}
function textColorFor(bgHsl) {
  // convert "hsl(H S% L%)" -> get L perc
  try {
    const m = bgHsl.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/);
    const l = parseInt(m[3],10)/100;
    return l > 0.6 ? '#111' : '#fff';
  } catch(e){
    return '#111';
  }
}

// Responsive cell size calculation
function computeCellSize(containerWidth, containerHeight, n, playersCount) {
  // ensure grid fits in container with header/footer margins
  // simple: choose min of floor(containerWidth/n) and floor(containerHeight/n)
  const w = Math.floor(containerWidth / n);
  const h = Math.floor(containerHeight / n);
  return Math.max(20, Math.min(w, h));
}

// Render a player's grid panel (SVG)
function renderPlayerGrid(playerId, playerName, seed, n, isMe, state) {
  // Each player grid wrapper
  let wrapper = document.getElementById('grid-'+playerId);
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'player-grid';
    wrapper.id = 'grid-'+playerId;
    gridPanel.appendChild(wrapper);
  }
  clearChildren(wrapper);

  const header = document.createElement('div');
  header.className = 'pg-header';
  header.textContent = playerName + (isMe ? ' (You)' : '');
  wrapper.appendChild(header);

  // Determine available size for this grid
  const rect = wrapper.getBoundingClientRect();
  // fallback to main area
  const containerWidth = Math.max(200, rect.width || (gridPanel.clientWidth / Math.max(1, Object.keys(roomState.players||{}).length)));
  const containerHeight =  Math.max(200, window.innerHeight - 200);
  const playersCount = Object.keys(roomState.players || {}).length || 1;
  const baseCell = isNaN(parseInt(settingCell.value)) ? DEFAULTS.cellSize : parseInt(settingCell.value);
  // compute target cell size to ensure full grid visible
  const cell = computeCellSize(containerWidth - 20, containerHeight - 120, n, playersCount);
  const cellSize = Math.min(baseCell, cell);

  const svgW = cellSize * n;
  const svgH = cellSize * n;

  // create SVG
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.classList.add('grid-canvas');
  svg.style.display = 'block';
  svg.style.touchAction = 'manipulation';

  // prepare shuffled numbers
  const arr = genGrid(seed, n);
  // store grid arr for this player
  grids[playerId] = { n, arr };

  // generate distinct colors per cell
  const colors = genDistinctColors(arr.length);

  // render cells
  for (let i=0;i<arr.length;i++) {
    const row = Math.floor(i / n);
    const col = i % n;
    const x = col * cellSize;
    const y = row * cellSize;
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('transform', `translate(${x},${y})`);
    const color = colors[i];
    const rectEl = document.createElementNS(svgNS, 'rect');
    rectEl.setAttribute('x', 0);
    rectEl.setAttribute('y', 0);
    rectEl.setAttribute('width', cellSize);
    rectEl.setAttribute('height', cellSize);
    rectEl.setAttribute('fill', color);
    rectEl.setAttribute('rx', Math.max(2, cellSize*0.06));
    rectEl.setAttribute('data-num', arr[i]);
    rectEl.style.cursor = 'pointer';
    // text
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', cellSize/2);
    text.setAttribute('y', cellSize/2 + (parseInt(settingFontCell.value||DEFAULTS.fontCell)/3));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', (settingFontCell.value||DEFAULTS.fontCell));
    text.setAttribute('fill', textColorFor(color));
    text.textContent = arr[i];

    // overlay for selected
    const overlay = document.createElementNS(svgNS, 'rect');
    overlay.setAttribute('x', 0);
    overlay.setAttribute('y', 0);
    overlay.setAttribute('width', cellSize);
    overlay.setAttribute('height', cellSize);
    overlay.setAttribute('fill', 'rgba(0,0,0,0)');
    overlay.style.pointerEvents = 'none'; // clicks handled by rect

    // attach click handler only for my grid
    rectEl.addEventListener('click', (e) => {
      if (!myRoom || myId !== playerId) return;
      // find number
      const num = parseInt(rectEl.getAttribute('data-num'), 10);
      socket.emit('cell_selected', { roomId: myRoom.id, playerId: myId, cellNumber: num });
    });

    g.appendChild(rectEl);
    g.appendChild(text);
    g.appendChild(overlay);
    svg.appendChild(g);
  }

  wrapper.appendChild(svg);

  // mark selected numbers if known
  const pState = roomState.players[playerId];
  if (pState && pState.selected) {
    // for each selected number, find the corresponding rect and overlay
    const selectedSet = new Set(pState.selected);
    const texts = svg.querySelectorAll('text');
    texts.forEach(t => {
      const v = parseInt(t.textContent,10);
      if (selectedSet.has(v)) {
        // add strike/overlay
        const parentG = t.parentNode;
        const selRect = document.createElementNS(svgNS, 'rect');
        selRect.setAttribute('x', 0);
        selRect.setAttribute('y', 0);
        selRect.setAttribute('width', cellSize);
        selRect.setAttribute('height', cellSize);
        selRect.setAttribute('fill', 'rgba(0,0,0,0.2)');
        parentG.appendChild(selRect);
      }
    });
  }

  return wrapper;
}

// Layout player grids based on players count
function layoutGrids() {
  const ids = Object.keys(roomState.players || {});
  const count = ids.length;
  clearChildren(gridPanel);
  if (count === 0) return;
  // layout logic:
  // 1 player: big single
  // 2 players: two columns (or rows if narrow)
  // 3 players: two top, one bottom center
  // 4 players: 2x2 grid
  const width = gridPanel.clientWidth;
  const isPortrait = window.innerWidth < window.innerHeight;

  if (count === 1) {
    const pid = ids[0];
    const p = roomState.players[pid];
    const n = p.n || computeNFromSettings(roomState.settings);
    renderPlayerGrid(pid, p.name, seeds[pid], n, pid===myId, roomState);
    const el = document.getElementById('grid-'+pid);
    el.style.width = '100%';
  } else if (count === 2) {
    ids.forEach(pid => {
      const p = roomState.players[pid];
      const n = p.n || computeNFromSettings(roomState.settings);
      const el = renderPlayerGrid(pid, p.name, seeds[pid], n, pid===myId, roomState);
      el.style.width = isPortrait ? '100%' : '48%';
    });
  } else if (count === 3) {
    // two on top row, one centered bottom
    for (let i=0;i<ids.length;i++){
      const pid = ids[i];
      const p = roomState.players[pid];
      const n = p.n || computeNFromSettings(roomState.settings);
      const el = renderPlayerGrid(pid, p.name, seeds[pid], n, pid===myId, roomState);
      if (i < 2) el.style.width = '48%';
      else {
        el.style.width = '66%';
        el.style.margin = '0 auto';
      }
    }
  } else {
    // 4 players => 2x2
    ids.forEach(pid => {
      const p = roomState.players[pid];
      const n = p.n || computeNFromSettings(roomState.settings);
      const el = renderPlayerGrid(pid, p.name, seeds[pid], n, pid===myId, roomState);
      el.style.width = '48%';
    });
  }
}

// compute n from room settings
function computeNFromSettings(settings) {
  if (!settings) return 5;
  if (settings.level === 'easy') return 5;
  if (settings.level === 'medium') return 7;
  if (settings.level === 'hard') return 10;
  if (settings.level === 'extreme') return Math.max(10, parseInt(settings.n) || 10);
  return 5;
}

// Update players list UI
function updatePlayersList() {
  clearChildren(playersList);
  if (!roomState) return;
  for (const pid in roomState.players) {
    const p = roomState.players[pid];
    const li = document.createElement('li');
    li.textContent = p.name + (pid===myId?' (You)':'') + (p.ready?' ✅':'');
    playersList.appendChild(li);
  }
  // Host control: enable start if host and all ready
  btnStart.disabled = !(myId && roomState.hostId === myId && Object.values(roomState.players || {}).every(p=>p.ready));
}

// Format time
function fmtTime(sec) {
  if (sec == null) return '--:--';
  const mm = String(Math.floor(sec/60)).padStart(2,'0');
  const ss = String(sec%60).padStart(2,'0');
  return `${mm}:${ss}`;
}

// Socket event handlers
socket.on('room_list_update', (rooms) => {
  clearChildren(roomsListEl);
  rooms.forEach(r => {
    const li = document.createElement('li');
    li.textContent = `${r.name} — ${r.players} players — ${r.settings.level}`;
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => {
      // join room
      myName = prompt('Enter your name (or leave blank for random):') || undefined;
      socket.emit('join_room', { roomId: r.id, playerName: myName }, (res) => {
        if (!res || !res.ok) return alert('Could not join: '+(res && res.error));
        myRoom = { id: r.id };
        myId = res.playerId;
        seeds[myId] = res.seed;
      });
    });
    roomsListEl.appendChild(li);
  });
});

socket.on('room_update', (room) => {
  // transform into convenient map
  roomState = {
    id: room.id,
    name: room.name,
    settings: room.settings,
    players: {}
  };
  // need to keep hostId (server does not include; ask server for it? server includes? room_summary didn't include hostId—assume not)
  // We'll request room list to keep consistent
  // Build players map (server emitted players as array)
  (room.players||[]).forEach(p=>{
    roomState.players[p.id] = {
      id: p.id,
      name: p.name,
      ready: p.ready,
      finished: p.finished,
      n: computeNFromSettings(room.settings)
    };
  });

  myRoom = { id: room.id };
  roomNameEl.textContent = room.name;
  updatePlayersList();
  layoutGrids();
});

socket.on('game_start', (payload) => {
  // payload.gridSeeds maps playerId->seed
  seeds = payload.gridSeeds || {};
  // set up roomState players n
  // request server room_update will arrive; keep seeds
  // show initial target number as 1
  targetNumberEl.textContent = '1';
});

socket.on('game_state', (payload) => {
  // payload.players: array of {id, selected}
  if (!roomState) return;
  payload.players.forEach(p=>{
    if (!roomState.players[p.id]) {
      roomState.players[p.id] = { id: p.id, name: p.name || 'Player', n: computeNFromSettings(roomState.settings) };
    }
    roomState.players[p.id].selected = p.selected;
  });
  timerEl.textContent = fmtTime(payload.timeLeft);
  // update target for me
  const me = roomState.players[myId];
  if (me) {
    const next = (me.selected ? me.selected.length + 1 : 1);
    targetNumberEl.textContent = next;
  }
  layoutGrids();
});

socket.on('player_finished', (payload) => {
  const pid = payload.playerId;
  const ft = payload.finishTime;
  // update UI: show toast, update players list
  const el = document.getElementById('grid-'+pid);
  if (el) {
    const note = document.createElement('div');
    note.textContent = ft == null ? 'Time up' : `Finished: ${fmtTime(ft)}`;
    el.appendChild(note);
  }
});

socket.on('best_time_update', (payload) => {
  // simple alert / UI update
  console.log('best_time_update', payload);
});

socket.on('chat_message', (msg) => {
  const d = document.createElement('div');
  d.className = 'msg';
  d.textContent = `[${new Date(msg.ts).toLocaleTimeString()}] ${msg.playerName}: ${msg.text}`;
  chatMessages.appendChild(d);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('player_kicked', (payload) => {
  const d = document.createElement('div');
  d.className = 'msg';
  d.textContent = `System: Player ${payload.playerId} kicked: ${payload.reason}`;
  chatMessages.appendChild(d);
});

// UI interactions
btnNewRoom.addEventListener('click', () => {
  myName = prompt('Enter your name (or leave blank for random):') || undefined;
  const level = selectLevel.value;
  const n = inputN.value && parseInt(inputN.value,10);
  const settings = {
    cellSize: parseInt(settingCell.value) || DEFAULTS.cellSize,
    fontCell: parseInt(settingFontCell.value) || DEFAULTS.fontCell,
    fontTarget: parseInt(settingFontTarget.value) || DEFAULTS.fontTarget,
    countdown: parseInt(settingCountdown.value) || DEFAULTS.countdown
  };
  socket.emit('create_room', { level, n, playerName: myName, settings }, (res) => {
    if (!res || !res.ok) return alert('Could not create room');
    myRoom = { id: res.roomId };
    myId = socket.id;
    // seed will be provided by room_update + game_start when started
  });
});

btnRefresh.addEventListener('click', () => socket.emit('get_rooms'));

btnStart.addEventListener('click', () => {
  if (!myRoom) return alert('No room');
  socket.emit('start_game', { roomId: myRoom.id }, (res) => {
    if (!res || !res.ok) alert('Could not start');
  });
});

chkReady.addEventListener('change', () => {
  socket.emit('set_ready', { roomId: myRoom ? myRoom.id : null, ready: chkReady.checked });
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !myRoom) return;
  socket.emit('send_chat', { roomId: myRoom.id, message: text });
  chatInput.value = '';
});

// initial fetch
socket.emit('get_rooms');

// window resize re-layout
window.addEventListener('resize', () => { if (roomState) layoutGrids(); });
