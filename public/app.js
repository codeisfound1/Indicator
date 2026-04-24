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

levelSelect.addEventListener('change', () => {
  customN.style.display = levelSelect.value === 'custom' ? 'inline-block' : 'none';
});

createRoomBtn.addEventListener('click', () => {
  client.name = playerNameInput.value || 'Player';
  let level = levelSelect.value;
  let n = parseInt(customN.value || '10', 10);
  socket.emit('createRoom', { name: client.name, level: { key: level, n }});
});

joinRoomBtn.addEventListener('click', () => {
  client.name = playerNameInput.value || 'Player';
  const roomId = roomIdInput.value.trim();
  if (!roomId) return alert('Enter room id');
  socket.emit('joinRoom', { roomId, name: client.name });
});

socket.on('roomCreated', ({ roomId, name, level }) => {
  enterGame(roomId, name, level);
});

socket.on('joinedRoom', ({ roomId, name, level }) => {
  enterGame(roomId, name, level);
});

socket.on('err', msg => {
  alert(msg);
});

socket.on('roomUpdate', room => {
  // show players in status
  statusLog.innerHTML = '<b>Players in room:</b><br>' + Object.values(room.players).map(p => (p.name)).join(', ');
});

function enterGame(roomId, playerName, level) {
  client.roomId = roomId;
  client.name = playerName;
  client.level = level;
  lobby.style.display = 'none';
  game.style.display = 'block';
  roomIdDisplay.textContent = roomId;
  playerDisplay.textContent = playerName;
  setupMultiGrid(1); // initial single-player view; players view added when peers present
}

leaveBtn.addEventListener('click', () => {
  if (!client.roomId) return;
  socket.emit('leaveRoom', { roomId: client.roomId });
  resetClient();
});

function resetClient(){
  clearInterval(client.timerHandle);
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

startBtn.addEventListener('click', () => {
  if (!client.roomId) {
    // start local single player
    startGameLocally();
  } else {
    // broadcast start to room
    const gameState = {
      level: getLevelSpec(),
      countdown: DEFAULT_COUNTDOWN
    };
    socket.emit('startGame', { roomId: client.roomId, gameState });
  }
});

socket.on('gameStarted', ({ gameState }) => {
  startGameLocally(gameState);
});

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
  let key = levelSelect?.value || client.level?.key || client.level;
  if (client.roomId && typeof client.level === 'object') key = client.level.key;
  if (key === 'easy') return { key:'easy', n:5, max:25 };
  if (key === 'medium') return { key:'medium', n:7, max:49 };
  if (key === 'hard') return { key:'hard', n:10, max:100 };
  const n = parseInt(customN.value || client.customN || '10',10);
  return { key:'custom', n: Math.max(10,n), max: Math.max(100, n*n) };
}

function makeGridState(spec) {
  const total = spec.n * spec.n;
  const maxNum = spec.max;
  const pool = Array.from({length: maxNum}, (_,i)=>i+1).slice(0, total);
  // shuffle and assign
  for (let i=pool.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [pool[i],pool[j]]=[pool[j],pool[i]];
  }
  // unique colors for each cell but not colliding with text color area: we'll choose bright bg, white text
  const cells = [];
  for (let i=0;i<total;i++){
    cells.push({
      num: pool[i],
      color: randomColorDistinct(i)
    });
  }
  return { spec, cells, width: spec.n };
}

function randomColorDistinct(seed){
  // generate visually distinct HSL color
  const h = Math.floor((seed*97) % 360);
  const s = 65 + (seed % 10);
  const l = 45 + (seed % 7);
  return `hsl(${h} ${s}% ${l}%)`;
}

function buildPlayerGrid(playerLabel){
  multigridWrap.innerHTML = '';
  // if multiplayer, show up to 4 grids in layout; otherwise single
  const players = client.roomId ? Array.from(document.querySelectorAll('.playerGridData')) : [client];
  // For simplicity show only self grid and peers when server pushes peerStatus
  // Here we display only client's own grid for immediate play
  const pg = document.createElement('div');
  pg.className = 'playerGrid';
  pg.style.width = 'auto';
  const title = document.createElement('div');
  title.className = 'gridTitle';
  title.textContent = playerLabel;
  pg.appendChild(title);
  const wrap = document.createElement('div');
  wrap.className = 'gridCanvas';
  // responsive sizing
  const n = client.gridSpec.spec.n;
  const cellSize = parseInt(cellSizeRange.value,10);
  wrap.style.gridTemplateColumns = `repeat(${n}, ${cellSize}px)`;
  wrap.style.gridAutoRows = `${cellSize}px`;
  wrap.style.gap = '6px';
  wrap.style.width = (n*cellSize + (n-1)*6) + 'px';
  const fontSize = parseInt(cellFontRange.value,10);
  client.gridSpec.cells.forEach((c, idx) => {
    const cell = document.createElement('div');
    cell.className = 'gridCell';
    cell.style.background = c.color;
    cell.style.fontSize = fontSize + 'px';
    cell.textContent = c.num;
    cell.dataset.num = c.num;
    // text color ensure contrast (numbers are white)
    cell.style.color = '#fff';
    cell.addEventListener('click', () => onCellClick(cell, c));
    wrap.appendChild(cell);
  });
  pg.appendChild(wrap);
  multigridWrap.appendChild(pg);
  // set current target big display
  currentTargetEl.style.fontSize = Math.max(40, Math.floor((cellSize*1.5))) + 'px';
}

cellSizeRange.addEventListener('input', () => {
  if (!client.gridSpec) return;
  buildPlayerGrid(client.name);
});
cellFontRange.addEventListener('input', () => {
  if (!client.gridSpec) return;
  buildPlayerGrid(client.name);
});

function onCellClick(cellEl, cellData){
  if (client.finished) return;
  if (parseInt(cellEl.dataset.num,10) !== client.target) {
    cellEl.style.transform = 'scale(.97)';
    setTimeout(()=> cellEl.style.transform='scale(1)',120);
    return;
  }
  // valid selection
  cellEl.style.outline = '3px solid rgba(0,0,0,0.08)';
  cellEl.style.opacity = '0.6';
  client.target++;
  currentTargetEl.textContent = client.target <= client.gridSpec.cells.length ? client.target : '—';
  broadcastStatus();
  // completion check
  if (client.target > client.gridSpec.cells.length){
    client.finished = true;
    const elapsed = DEFAULT_COUNTDOWN - client.timer;
    stopTimer();
    statusLog.innerHTML = `Finished in ${elapsed}s`;
    socket.emit('complete', { roomId: client.roomId, timeSec: elapsed });
  }
}

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

socket.on('peerStatus', ({ playerId, status }) => {
  // simple display: append/replace a row
  const html = `<div><b>${playerId}</b> target:${status.target} time:${status.timer}s</div>`;
  // append but keep few lines
  statusLog.innerHTML = html + statusLog.innerHTML;
});

socket.on('playerComplete', ({ playerId, name, timeSec, best }) => {
  statusLog.innerHTML = `<div class="statusOk">${name} finished ${timeSec}s (best ${best}s)</div>` + statusLog.innerHTML;
});

// simple helper for responsive layout across devices (scale down cell size if needed)
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
