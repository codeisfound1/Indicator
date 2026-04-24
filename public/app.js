// /public/app.js
const socket = io();
const DEFAULT_COUNTDOWN = 600; // seconds

// UI refs
const lobby = document.getElementById('lobby');
const game = document.getElementById('game');
const playerNameInput = document.getElementById('playerName');
const levelSelect = document.getElementById('levelSelect');
const customN = document.getElementById('customN');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomIdInput = document.getElementById('roomIdInput');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const playerDisplay = document.getElementById('playerDisplay');
const multigridWrap = document.getElementById('multigridWrap');
const currentTargetEl = document.getElementById('currentTarget');
const timerDisplay = document.getElementById('timerDisplay');
const startBtn = document.getElementById('startBtn');
const leaveBtn = document.getElementById('leaveBtn');
const cellSizeRange = document.getElementById('cellSize');
const cellFontRange = document.getElementById('cellFontSize');
const statusLog = document.getElementById('statusLog');

let client = {
  name: 'Player',
  roomId: null,
  level: 'easy',
  customN: 10,
  gridSpec: null,
  gridState: {},
  timer: DEFAULT_COUNTDOWN,
  timerHandle: null,
  target: 1,
  finished: false,
  bestTime: null
};

// --- Logging for debugging ---
socket.onAny((ev, payload) => {
  console.debug('[socket]', ev, payload);
});
socket.on('connect', () => console.debug('socket connected', socket.id));
socket.on('connect_error', e => console.error('socket connect_error', e));

// --- UI interactions ---
levelSelect.addEventListener('change', () => {
  customN.style.display = levelSelect.value === 'custom' ? 'inline-block' : 'none';
});

createRoomBtn.addEventListener('click', () => {
  client.name = playerNameInput.value || 'Player';
  const levelKey = levelSelect.value;
  const n = parseInt(customN.value || '10', 10);
  socket.emit('createRoom', { name: client.name, level: { key: levelKey, n } });
});

joinRoomBtn.addEventListener('click', () => {
  client.name = playerNameInput.value || 'Player';
  const roomId = roomIdInput.value.trim();
  if (!roomId) return alert('Enter room id');
  socket.emit('joinRoom', { roomId, name: client.name });
});

// --- socket handlers ---
socket.on('err', msg => {
  console.error('server err:', msg);
  alert(msg);
});

socket.on('roomCreated', payload => {
  console.debug('roomCreated payload', payload);
  const { roomId, name, level } = payload;
  enterGame(roomId, name || client.name, level);
});

socket.on('joinedRoom', payload => {
  console.debug('joinedRoom payload', payload);
  // payload may contain level as object or string
  const { roomId, name, level } = payload;
  enterGame(roomId, name || client.name, level);
});

socket.on('roomUpdate', room => {
  // display player names and room info
  try {
    statusLog.innerHTML = '<b>Players in room:</b><br>' + Object.values(room.players).map(p => (p.name || 'Player')).join(', ');
  } catch (e) {
    console.warn('roomUpdate payload malformed', room);
    statusLog.textContent = JSON.stringify(room);
  }
});

socket.on('gameStarted', ({ gameState }) => {
  console.debug('gameStarted', gameState);
  startGameLocally(gameState);
});

socket.on('peerStatus', ({ playerId, status }) => {
  const el = document.createElement('div');
  el.innerHTML = `<small>${playerId} target:${status.target} time:${status.timer}s</small>`;
  statusLog.prepend(el);
});

socket.on('playerComplete', ({ playerId, name, timeSec, best }) => {
  const el = document.createElement('div');
  el.className = 'statusOk';
  el.textContent = `${name} finished ${timeSec}s (best ${best}s)`;
  statusLog.prepend(el);
});

// --- enter game / UI switch ---
function enterGame(roomId, playerName, level) {
  client.roomId = roomId;
  client.name = playerName || client.name;
  // normalize level: could be string or object {key,n}
  if (level && typeof level === 'object') client.level = level;
  else if (typeof level === 'string') client.level = { key: level, n: (level === 'easy'?5: level==='medium'?7:10) };
  lobby.style.display = 'none';
  game.style.display = 'block';
  roomIdDisplay.textContent = client.roomId || '';
  playerDisplay.textContent = client.name || 'Player';
  // ensure UI placeholders exist
  currentTargetEl.textContent = '—';
  timerDisplay.textContent = DEFAULT_COUNTDOWN;
  multigridWrap.innerHTML = ''; // clear previous
  // build placeholder own grid (will be populated when game starts)
  // keep controls available
}

// --- Start / Leave ---
startBtn.addEventListener('click', () => {
  if (!client.roomId) {
    startGameLocally();
  } else {
    const gameState = { level: getLevelSpec(), countdown: DEFAULT_COUNTDOWN };
    socket.emit('startGame', { roomId: client.roomId, gameState });
    // local start will be triggered by gameStarted event from server too
  }
});

leaveBtn.addEventListener('click', () => {
  if (!client.roomId) return resetClient();
  socket.emit('leaveRoom', { roomId: client.roomId });
  resetClient();
});

// --- Game logic ---
function startGameLocally(gameState) {
  const spec = gameState?.level || getLevelSpec();
  client.gridSpec = spec;
  client.timer = gameState?.countdown ?? DEFAULT_COUNTDOWN;
  client.target = 1;
  client.finished = false;
  client.gridState = makeGridState(spec);
  currentTargetEl.textContent = client.target;
  buildPlayerGrid(client.name);
  startTimer();
  broadcastStatus();
}

function getLevelSpec() {
  // client.level may be object or string
  const lv = client.level || levelSelect.value || 'easy';
  let key = typeof lv === 'object' ? lv.key : lv;
  if (key === 'easy') return { key:'easy', n:5, max:25 };
  if (key === 'medium') return { key:'medium', n:7, max:49 };
  if (key === 'hard') return { key:'hard', n:10, max:100 };
  const n = parseInt((typeof lv === 'object' ? lv.n : customN.value) || '10', 10);
  return { key:'custom', n: Math.max(10,n), max: Math.max(100, n*n) };
}

function makeGridState(spec) {
  const total = spec.n * spec.n;
  const maxNum = spec.max;
  const pool = Array.from({length: maxNum}, (_,i)=>i+1).slice(0, total);
  for (let i=pool.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [pool[i],pool[j]]=[pool[j],pool[i]];
  }
  const cells = [];
  for (let i=0;i<total;i++){
    cells.push({ num: pool[i], color: randomColorDistinct(i) });
  }
  return { spec, cells, width: spec.n };
}

function randomColorDistinct(seed){
  const h = Math.floor((seed*97) % 360);
  const s = 60 + (seed % 10);
  const l = 45 + (seed % 7);
  return `hsl(${h} ${s}% ${l}%)`;
}

function buildPlayerGrid(playerLabel){
  multigridWrap.innerHTML = '';
  const pg = document.createElement('div');
  pg.className = 'playerGrid';
  const title = document.createElement('div');
  title.className = 'gridTitle';
  title.textContent = playerLabel;
  pg.appendChild(title);
  const wrap = document.createElement('div');
  wrap.className = 'gridCanvas';
  const n = client.gridSpec.spec.n;
  // compute responsive cell size
  const viewportAvailable = Math.min(window.innerWidth - 80, 1100);
  const preferred = parseInt(cellSizeRange.value,10);
  const gap = 6;
  const maxCell = Math.max(30, Math.floor((viewportAvailable - (n-1)*gap)/n));
  const cellSize = Math.min(preferred, maxCell);
  wrap.style.gridTemplateColumns = `repeat(${n}, ${cellSize}px)`;
  wrap.style.gridAutoRows = `${cellSize}px`;
  wrap.style.gap = `${gap}px`;
  wrap.style.width = (n*cellSize + (n-1)*gap) + 'px';
  const fontSize = parseInt(cellFontRange.value,10);

  client.gridSpec.cells.forEach((c, idx) => {
    const cell = document.createElement('div');
    cell.className = 'gridCell';
    cell.style.background = c.color;
    cell.style.fontSize = fontSize + 'px';
    cell.textContent = c.num;
    cell.dataset.num = c.num;
    cell.style.color = '#fff';
    cell.addEventListener('click', () => onCellClick(cell, c));
    wrap.appendChild(cell);
  });

  pg.appendChild(wrap);
  multigridWrap.appendChild(pg);
  // target big font adapt
  currentTargetEl.style.fontSize = Math.max(40, Math.floor((cellSize*1.0))) + 'px';
}

cellSizeRange.addEventListener('input', () => { if (client.gridSpec) buildPlayerGrid(client.name); });
cellFontRange.addEventListener('input', () => { if (client.gridSpec) buildPlayerGrid(client.name); });

function onCellClick(cellEl, cellData){
  if (client.finished) return;
  if (parseInt(cellEl.dataset.num,10) !== client.target) {
    cellEl.style.transform = 'scale(.97)';
    setTimeout(()=> cellEl.style.transform='scale(1)',120);
    return;
  }
  cellEl.style.outline = '3px solid rgba(0,0,0,0.08)';
  cellEl.style.opacity = '0.6';
  client.target++;
  currentTargetEl.textContent = client.target <= client.gridSpec.cells.length ? client.target : '—';
  broadcastStatus();
  if (client.target > client.gridSpec.cells.length){
    client.finished = true;
    const elapsed = DEFAULT_COUNTDOWN - client.timer;
    stopTimer();
    statusLog.innerHTML = `Finished in ${elapsed}s`;
    if (client.roomId) socket.emit('complete', { roomId: client.roomId, timeSec: elapsed });
  }
}

// --- Timer ---
function startTimer(){
  stopTimer();
  timerDisplay.textContent = client.timer;
  client.timerHandle = setInterval(()=>{
    client.timer--;
    timerDisplay.textContent = client.timer;
    broadcastStatus();
    if (client.timer <= 0){
      stopTimer();
      statusLog.innerHTML = 'Time up!';
      client.finished = true;
    }
  }, 1000);
}
function stopTimer(){ if (client.timerHandle) clearInterval(client.timerHandle); client.timerHandle = null; }

function broadcastStatus(){
  if (!client.roomId) return;
  socket.emit('statusUpdate', { roomId: client.roomId, status: { target: client.target, timer: client.timer } });
}

function resetClient(){
  stopTimer();
  client = {
    name: 'Player',
    roomId: null,
    level: 'easy',
    customN: 10,
    gridSpec: null,
    gridState: {},
    timer: DEFAULT_COUNTDOWN,
    timerHandle: null,
    target: 1,
    finished: false,
    bestTime: null
  };
  multigridWrap.innerHTML = '';
  lobby.style.display = 'block';
  game.style.display = 'none';
}

// --- responsive autoscale ---
window.addEventListener('resize', autoscaleGrid);
function autoscaleGrid(){
  if (!client.gridSpec) return;
  const n = client.gridSpec.spec.n;
  const available = Math.min(window.innerWidth - 60, 1000);
  const maxCell = Math.floor((available - (n-1)*6)/n);
  const desired = Math.min(parseInt(cellSizeRange.value,10), maxCell);
  cellSizeRange.value = Math.max(30, desired);
  buildPlayerGrid(client.name);
}
autoscaleGrid();
