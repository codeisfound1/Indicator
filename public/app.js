/* ═══════════════════════════════════════════════════════════
   NumGrid — Client App
   Socket.IO + SVG Grid Generator + Responsive UI
   ═══════════════════════════════════════════════════════════ */

const socket = io();

// ── State ───────────────────────────────────────────────────
let myId        = null;
let myName      = null;
let currentRoom = null;   // { roomId, roomName, hostId, ... }
let roomState   = null;   // latest room_state from server
let targetDelay = null;   // timeout for showing next target after 10s delay

// ── DOM refs ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const screens = {
  lobby: $('lobby-screen'),
  game:  $('game-screen')
};

// ── Screen switch ────────────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle('active', k === name);
  });
}

// ── Toast ────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, dur = 2800) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

// ── Modal ─────────────────────────────────────────────────────
function modal(title, body) {
  $('modal-title').textContent = title;
  $('modal-body').textContent  = body;
  $('modal-overlay').classList.add('open');
}
$('modal-ok').onclick = () => $('modal-overlay').classList.remove('open');

// ═══════════════════════════════════════════════════════════
//  SVG GRID GENERATOR
// ═══════════════════════════════════════════════════════════

// Pastel HSL palette — unique per cell, not duplicated
function randomHSL(used) {
  let h, s, l, key;
  let tries = 0;
  do {
    h = Math.floor(Math.random() * 360);
    s = 55 + Math.floor(Math.random() * 25);
    l = 32 + Math.floor(Math.random() * 18);
    key = `${Math.round(h/15)}`;
    tries++;
  } while (used.has(key) && tries < 80);
  used.add(key);
  return `hsl(${h},${s}%,${l}%)`;
}

// Compute optimal cell size for the available container width
function computeCellSize(gridSize, containerWidth) {
  const maxFromContainer = Math.floor((containerWidth - 20) / gridSize) - 4;
  // Device-aware clamping
  const isMobile = window.innerWidth <= 640;
  const isTablet = window.innerWidth <= 1024;
  const maxCellSize = isMobile ? 42 : isTablet ? 50 : 58;
  const minCellSize = isMobile ? 22 : 26;
  return Math.max(minCellSize, Math.min(maxCellSize, maxFromContainer));
}

// Build/rebuild the SVG grid for a player panel
function buildGrid(panel, playerData, isMe, showHint) {
  const { grid, gridSize, current, completed } = playerData;
  const wrapEl = panel.querySelector('.grid-wrapper');
  if (!wrapEl) return;

  const containerWidth = panel.offsetWidth || 300;
  const cellSize = computeCellSize(gridSize, containerWidth);
  const gap      = Math.max(2, Math.round(cellSize * 0.07));
  const svgW     = gridSize * cellSize + (gridSize - 1) * gap;
  const svgH     = svgW;

  // Generate stable random colors keyed by grid index (seed by position)
  // We store colors on first build to avoid re-randomizing
  if (!panel._colors || panel._colors.length !== grid.length) {
    const used = new Set();
    panel._colors = grid.map(() => randomHSL(used));
  }
  const colors = panel._colors;

  const ns  = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.setAttribute('width',  svgW);
  svg.setAttribute('height', svgH);
  svg.style.cursor = isMe && !completed ? 'pointer' : 'default';
  svg.style.maxWidth = '100%';

  const fontSize = Math.max(9, Math.floor(cellSize * 0.38));

  grid.forEach((num, idx) => {
    const col  = idx % gridSize;
    const row  = Math.floor(idx / gridSize);
    const x    = col * (cellSize + gap);
    const y    = row * (cellSize + gap);
    const done = num < current;
    const isNext = num === current;
    // Only show hint after 10s delay
    const showHintForThis = showHint && isNext;

    const g = document.createElementNS(ns, 'g');

    // Cell rect
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width',  cellSize);
    rect.setAttribute('height', cellSize);
    rect.setAttribute('rx', Math.max(3, cellSize * 0.12));
    rect.setAttribute('fill', done ? '#1c2538' : colors[idx]);
    rect.setAttribute('stroke', showHintForThis ? '#fff' : 'rgba(0,0,0,.25)');
    rect.setAttribute('stroke-width', showHintForThis ? '2.5' : '1');
    if (showHintForThis && isMe && !completed) {
      rect.style.filter = 'drop-shadow(0 0 6px rgba(255,255,255,.7))';
    }
    g.appendChild(rect);

    // Number text
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', x + cellSize / 2);
    text.setAttribute('y', y + cellSize / 2);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('font-family', "'Orbitron', monospace");
    text.setAttribute('font-size', fontSize);
    text.setAttribute('font-weight', '700');
    text.setAttribute('fill', done ? '#3a4a60' : '#fff');
    text.setAttribute('pointer-events', 'none');
    text.setAttribute('user-select', 'none');
    text.textContent = num;
    g.appendChild(text);

    // Checkmark for done cells
    if (done) {
      const ck = document.createElementNS(ns, 'text');
      ck.setAttribute('x', x + cellSize - 5);
      ck.setAttribute('y', y + 5);
      ck.setAttribute('font-size', Math.max(6, fontSize * .55));
      ck.setAttribute('fill', '#22c55e');
      ck.setAttribute('text-anchor', 'end');
      ck.setAttribute('dominant-baseline', 'hanging');
      ck.setAttribute('pointer-events', 'none');
      ck.textContent = '✓';
      g.appendChild(ck);
    }

    // Click handler (only for own grid, not completed)
    if (isMe && !completed) {
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => {
        socket.emit('cell_click', { number: num });
        if (num === current) {
          // Visual flash feedback
          rect.style.transition = 'fill .15s';
          rect.setAttribute('fill', '#00e5ff');
          setTimeout(() => rect.setAttribute('fill', colors[idx]), 150);
        } else {
          // Wrong cell shake
          g.style.animation = 'none';
          rect.setAttribute('stroke', '#ef4444');
          rect.setAttribute('stroke-width', '3');
          setTimeout(() => {
            rect.setAttribute('stroke', isNext ? '#fff' : 'rgba(0,0,0,.25)');
            rect.setAttribute('stroke-width', isNext ? '2.5' : '1');
          }, 400);
        }
      });
    }

    svg.appendChild(g);
  });

  wrapEl.innerHTML = '';
  wrapEl.appendChild(svg);
}

// ═══════════════════════════════════════════════════════════
//  RENDER ROOM STATE
// ═══════════════════════════════════════════════════════════
function renderRoom(state) {
  roomState = state;
  const area = $('players-area');

  // Update header
  $('gh-room-name').textContent = state.roomName;
  $('restart-btn').style.display = state.hostId === myId ? 'inline-flex' : 'none';

  // Find my player data for target display
  const me = state.players.find(p => p.id === myId);
  if (me) {
    $('target-display').textContent = me.completed ? '✓' : me.current;
  }

  // Build/update player panels
  const existingIds = new Set([...area.querySelectorAll('.player-panel')].map(el => el.dataset.pid));
  const incomingIds = new Set(state.players.map(p => p.id));

  // Remove panels for players who left
  existingIds.forEach(pid => {
    if (!incomingIds.has(pid)) {
      const el = area.querySelector(`[data-pid="${pid}"]`);
      if (el) el.remove();
    }
  });

  state.players.forEach(p => {
    const isMe = p.id === myId;
    let panel  = area.querySelector(`[data-pid="${p.id}"]`);

    if (!panel) {
      panel = createPlayerPanel(p, isMe);
      area.appendChild(panel);
    }

    updatePlayerPanel(panel, p, isMe, state.hostId);
    // Only show hint after 10s delay, and only for own grid
    const showHint = isMe && targetDelay === false; // false = after 10s completed
    buildGrid(panel, p, isMe, showHint);
  });
}

function createPlayerPanel(p, isMe) {
  const div = document.createElement('div');
  div.className = 'player-panel' + (isMe ? ' is-me' : '');
  div.dataset.pid = p.id;
  div.innerHTML = `
    <div class="pp-header">
      <span class="pp-name">${escHtml(p.name)}${isMe ? ' <small style="color:var(--accent);font-size:.65rem;">(bạn)</small>' : ''}</span>
      <span class="pp-badge" style="display:none">HOST</span>
    </div>
    <div class="pp-times">
      <span>⏱ <b class="pp-ct">—</b></span>
      <span>🏆 <b class="pp-bt">—</b></span>
    </div>
    ${isMe ? `
    <div class="pp-level-ctrl">
      <select class="pp-level-sel">
        <option value="easy">Dễ 5×5</option>
        <option value="medium">TB 7×7</option>
        <option value="hard">Khó 10×10</option>
        <option value="custom">Custom</option>
      </select>
      <input type="number" class="pp-custom-n" placeholder="N≥10" min="10" max="30" style="display:none"/>
      <button class="btn btn-secondary btn-sm pp-apply-btn">✓</button>
    </div>` : ''}
    <div style="position:relative;width:100%">
      <div class="grid-wrapper"></div>
      <div class="completed-banner">🎉 HOÀN THÀNH!</div>
    </div>
  `;

  if (isMe) {
    const sel  = div.querySelector('.pp-level-sel');
    const cust = div.querySelector('.pp-custom-n');
    const appl = div.querySelector('.pp-apply-btn');
    sel.value = p.level || 'easy';
    sel.addEventListener('change', () => {
      cust.style.display = sel.value === 'custom' ? 'block' : 'none';
    });
    appl.addEventListener('click', () => {
      const n = parseInt(cust.value) || 12;
      socket.emit('change_level', { level: sel.value, customN: n });
    });
  }

  return div;
}

function updatePlayerPanel(panel, p, isMe, hostId) {
  panel.classList.toggle('is-me', isMe);
  panel.classList.toggle('completed', p.completed);

  const badge = panel.querySelector('.pp-badge');
  if (badge) badge.style.display = p.id === hostId ? 'inline' : 'none';

  const ct = panel.querySelector('.pp-ct');
  const bt = panel.querySelector('.pp-bt');
  if (ct) ct.textContent = p.completionTime != null ? fmtTime(p.completionTime) : '—';
  if (bt) bt.textContent = p.bestTime != null ? fmtTime(p.bestTime) : '—';

  if (isMe) {
    const sel = panel.querySelector('.pp-level-sel');
    if (sel && sel.value !== p.level) sel.value = p.level;
  }
}

// ═══════════════════════════════════════════════════════════
//  COUNTDOWN
// ═══════════════════════════════════════════════════════════
function updateCountdown(secs) {
  const el  = $('countdown-display');
  const m   = Math.floor(secs / 60).toString().padStart(2, '0');
  const s   = (secs % 60).toString().padStart(2, '0');
  el.textContent = `${m}:${s}`;
  el.classList.toggle('urgent', secs <= 30);
}

// ═══════════════════════════════════════════════════════════
//  LOBBY
// ═══════════════════════════════════════════════════════════
function renderLobby(rooms) {
  const list = $('rooms-list');
  if (!rooms.length) {
    list.innerHTML = '<div class="no-rooms">Chưa có phòng nào. Hãy tạo một phòng mới!</div>';
    return;
  }
  list.innerHTML = rooms.map(r => `
    <div class="room-item" data-rid="${r.id}">
      <div>
        <div class="ri-name">${escHtml(r.name)}</div>
        <div class="ri-meta">${levelLabel(r.level)}</div>
      </div>
      <div class="ri-players">${r.playerCount}/4</div>
    </div>
  `).join('');

  list.querySelectorAll('.room-item').forEach(el => {
    el.addEventListener('click', () => {
      socket.emit('join_room', { roomId: el.dataset.rid });
    });
  });
}

function levelLabel(l) {
  return { easy:'Dễ 5×5', medium:'Trung bình 7×7', hard:'Khó 10×10', custom:'Siêu khó' }[l] || l;
}

// ═══════════════════════════════════════════════════════════
//  CHAT
// ═══════════════════════════════════════════════════════════
function appendChat(msg) {
  const box = $('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (msg.system ? ' system' : '');
  if (msg.system) {
    div.textContent = msg.text;
  } else {
    div.innerHTML = `<span class="cm-name">${escHtml(msg.name)}</span>${escHtml(msg.text)}`;
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// ═══════════════════════════════════════════════════════════
//  SOCKET EVENTS
// ═══════════════════════════════════════════════════════════
socket.on('connect', () => {
  const savedName = localStorage.getItem('numgrid_name') || '';
  $('player-name-input').value = savedName;
  socket.emit('register', { name: savedName });
});

socket.on('registered', ({ id, name }) => {
  myId   = id;
  myName = name;
  $('player-name-input').value = name;
  localStorage.setItem('numgrid_name', name);
});

socket.on('lobby_update', renderLobby);

socket.on('joined_room', ({ roomId, roomName }) => {
  currentRoom = { roomId, roomName };
  $('gh-room-name').textContent = roomName;
  $('chat-messages').innerHTML  = '';
  showScreen('game');
  toast(`Đã vào phòng ${roomName}`);
});

socket.on('left_room', () => {
  clearTimeout(targetDelay);
  targetDelay = null;
  currentRoom = null;
  showScreen('lobby');
  socket.emit('get_lobby');
});

socket.on('room_state', (state) => {
  const oldCurrent = roomState?.players.find(p => p.id === myId)?.current;
  renderRoom(state);
  const newCurrent = state.players.find(p => p.id === myId)?.current;
  
   // If current increased (player found correct number), start 10s delay for THIS number
  if (newCurrent > oldCurrent && oldCurrent != null) {
    clearTimeout(targetDelay);
    targetDelay = true; // During 10s delay for this number
    setTimeout(() => {
      targetDelay = false; // After 10s, show hint for this number
      // Re-render to show the hint highlight
      if (roomState) renderRoom(roomState);
    }, 10000);
  }
});

socket.on('countdown', updateCountdown);

socket.on('time_up', () => {
  toast('⏰ Hết giờ!', 4000);
});

socket.on('player_completed', ({ name, time }) => {
  toast(`🎉 ${name} hoàn thành trong ${fmtTime(time)}!`, 4000);
});

socket.on('player_left', ({ name }) => {
  toast(`${name} đã rời phòng`);
});

socket.on('new_chat', appendChat);

socket.on('error_msg', msg => {
  toast('❌ ' + msg, 3500);
});

socket.on('disconnect', () => {
  toast('⚠️ Mất kết nối — đang thử lại…', 5000);
});

// ═══════════════════════════════════════════════════════════
//  UI HANDLERS — LOBBY
// ═══════════════════════════════════════════════════════════
$('player-name-input').addEventListener('change', () => {
  const name = $('player-name-input').value.trim().substring(0, 20);
  if (name) {
    localStorage.setItem('numgrid_name', name);
    socket.emit('register', { name });
  }
});

$('random-name-btn').addEventListener('click', () => {
  const adjs  = ['Swift','Bold','Keen','Wise','Bright','Sharp','Quick','Cool','Wild','Calm'];
  const nouns = ['Fox','Bear','Wolf','Hawk','Lion','Tiger','Eagle','Shark','Lynx','Puma'];
  const name  = adjs[rand(adjs.length)] + nouns[rand(nouns.length)] + (Math.floor(Math.random()*90)+10);
  $('player-name-input').value = name;
  localStorage.setItem('numgrid_name', name);
  socket.emit('register', { name });
});

$('create-level').addEventListener('change', () => {
  $('create-custom-n').style.display = $('create-level').value === 'custom' ? 'block' : 'none';
});

$('create-room-btn').addEventListener('click', () => {
  const level   = $('create-level').value;
  const customN = parseInt($('create-custom-n').value) || 12;
  socket.emit('create_room', { level, customN });
});

$('refresh-lobby-btn').addEventListener('click', () => socket.emit('get_lobby'));

// ── GAME HANDLERS ─────────────────────────────────────────────
$('leave-room-btn').addEventListener('click', () => socket.emit('leave_room'));

$('restart-btn').addEventListener('click', () => socket.emit('restart_game'));

// Chat
$('chat-send-btn').addEventListener('click', sendChat);
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

function sendChat() {
  const text = $('chat-input').value.trim();
  if (!text) return;
  socket.emit('chat_msg', { text });
  $('chat-input').value = '';
}

// Chat toggle
$('chat-toggle').addEventListener('click', () => {
  $('chat-panel').classList.toggle('collapsed');
});

// ── Handle grid resize on orientation change / resize ──────────
window.addEventListener('resize', debounce(() => {
  if (roomState) renderRoom(roomState);
}, 250));

// ═══════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════
function fmtTime(secs) {
  if (secs == null) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m${s.toString().padStart(2,'0')}s` : `${s}s`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function rand(n) { return Math.floor(Math.random() * n); }

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
