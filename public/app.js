// Client-side app
const socket = io();

// UI refs
const roomsList = document.getElementById('roomsList');
const createRoomBtn = document.getElementById('createRoomBtn');
const createLevel = document.getElementById('createLevel');
const customN = document.getElementById('customN');
const playerNameInput = document.getElementById('playerName');

const lobbySection = document.getElementById('lobby');
const roomSection = document.getElementById('room');
const roomTitle = document.getElementById('roomTitle');
const leaveBtn = document.getElementById('leaveBtn');
const startBtn = document.getElementById('startBtn');
const playersList = document.getElementById('playersList');
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const roomLevelSelect = document.getElementById('roomLevelSelect');

const gridContainer = document.getElementById('gridContainer');
const targetDisplay = document.getElementById('targetDisplay');
const timeLeft = document.getElementById('timeLeft');
const bestTime = document.getElementById('bestTime');
const cellSizeControl = document.getElementById('cellSize');
const fontSizeControl = document.getElementById('fontSize');
const statusLine = document.getElementById('statusLine');
const finishTimes = document.getElementById('finishTimes');

let currentRoom = null;
let playerSocketId = null;
let gameState = null;
let countdownInterval = null;
let gameStartAt = null;
let gameEndAt = null;
let expectedSequence = 1;
let gridConfig = null; // {n, numbers, cellSize, font}
let playerBestTimes = {};

// helper
function fmtTime(sec){
  if (sec == null) return '--:--';
  const m = Math.floor(sec/60).toString().padStart(2,'0');
  const s = Math.floor(sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

// lobby handling
socket.on('lobbyRooms', (rooms) => {
  roomsList.innerHTML = '';
  rooms.forEach(r => {
    const div = document.createElement('div');
    div.className = 'room';
    div.innerHTML = `<div><strong>${r.name}</strong><div>${r.count} players · ${r.level}</div></div>`;
    const btn = document.createElement('button');
    btn.textContent = 'Join';
    btn.onclick = () => socket.emit('joinRoom', {roomId: r.id});
    div.appendChild(btn);
    roomsList.appendChild(div);
  });
});

createRoomBtn.onclick = () => {
  const level = createLevel.value === 'custom' ? 'custom' : createLevel.value;
  const roomName = null;
  let countdown = 600;
  socket.emit('createRoom', {roomName, level, countdown});
};

playerNameInput.onchange = () => {
  const name = playerNameInput.value.trim();
  if (name) socket.emit('setName', {name});
};

leaveBtn.onclick = () => {
  if (!currentRoom) return;
  socket.emit('leaveRoom', {roomId: currentRoom.id});
  showLobby();
};

chatInput.onkeydown = (e) => {
  if (e.key === 'Enter'){
    const txt = chatInput.value.trim();
    if (!txt || !currentRoom) return;
    socket.emit('sendChat', {roomId: currentRoom.id, text: txt});
    chatInput.value = '';
  }
};

roomLevelSelect.onchange = () => {
  if (!currentRoom) return;
  socket.emit('setLevel', {roomId: currentRoom.id, level: roomLevelSelect.value});
};

startBtn.onclick = () => {
  if (!currentRoom) return;
  socket.emit('startGame', {roomId: currentRoom.id});
};

// room updates
socket.on('roomUpdate', (room) => {
  currentRoom = room;
  showRoom();
  renderPlayers(room.players, room.bestTimes);
});

socket.on('chatMessage', (m) => {
  const div = document.createElement('div');
  const t = new Date(m.ts);
  div.innerHTML = `<strong>${escapeHtml(m.from)}</strong>: ${escapeHtml(m.text)} <span class="muted" style="font-size:11px;color:#666;margin-left:6px">${t.toLocaleTimeString()}</span>`;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on('errorMessage', (msg) => {
  alert(msg);
});

// game start
socket.on('gameStart', ({startAt, countdown, playersInfo}) => {
  // build per-player grids and start countdown
  // playersInfo: socketId -> {name, level}
  // if this client has an entry, use its level
  const myId = socket.id;
  const myInfo = playersInfo[myId] || Object.values(playersInfo)[0];
  const level = myInfo.level || (currentRoom ? currentRoom.level : 'easy');
  startLocalGame(startAt, countdown, level);
});

function startLocalGame(startAt, countdown, level){
  clearGameState();
  statusLine.textContent = 'Game starting...';
  expectedSequence = 1;
  const now = Date.now();
  const waitMs = Math.max(0, startAt - now);
  setTimeout(() => {
    setupGridForLevel(level);
    gameStartAt = startAt;
    gameEndAt = startAt + countdown*1000;
    startCountdownTimer();
    statusLine.textContent = 'Go!';
  }, waitMs);
}

// grid generator
function setupGridForLevel(level){
  let n;
  if (level === 'easy') n = 5;
  else if (level === 'medium') n = 7;
  else if (level === 'hard') n = 10;
  else {
    // custom read from input
    const v = parseInt(document.getElementById('customN').value,10);
    n = isNaN(v) || v < 10 ? 10 : v;
  }
  const cellSize = parseInt(cellSizeControl.value,10) || 60;
  const font = parseInt(fontSizeControl.value,10) || 25;
  gridConfig = {n, cellSize, font};
  const total = n*n;
  const nums = [];
  for (let i=1;i<=total;i++) nums.push(i);
  // shuffle
  for (let i = nums.length -1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  renderSVGGrid(n, nums, cellSize, font);
  targetDisplay.textContent = '1';
  targetDisplay.style.fontSize = Math.max(32, Math.min(110, cellSize*1.5)) + 'px';
  expectedSequence = 1;
}

function renderSVGGrid(n, nums, cellSize, fontSize){
  gridContainer.innerHTML = '';
  const totalW = n * cellSize;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', totalW);
  svg.setAttribute('height', n*cellSize);
  svg.classList.add('grid-svg');
  svg.style.touchAction = 'manipulation';
  // generate a random color for numbers set? requirement: each cell color different but not same as fixed text color
  const colors = [];
  for (let i=0;i<n*n;i++){
    colors.push(randomPastel());
  }
  for (let r=0;r<n;r++){
    for (let c=0;c<n;c++){
      const idx = r*n + c;
      const x = c*cellSize;
      const y = r*cellSize;
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', cellSize);
      rect.setAttribute('height', cellSize);
      rect.setAttribute('fill', colors[idx]);
      rect.setAttribute('data-num', nums[idx]);
      rect.setAttribute('rx', Math.max(4, cellSize*0.06));
      rect.style.stroke = '#e6e9ec';
      rect.style.strokeWidth = 1;
      rect.style.cursor = 'pointer';
      svg.appendChild(rect);

      const txt = document.createElementNS(svgNS, 'text');
      txt.setAttribute('x', x + cellSize/2);
      txt.setAttribute('y', y + cellSize/2 + fontSize*0.3);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', fontSize);
      txt.setAttribute('fill', '#111'); // text color fixed, ensure not identical to bg by using darker color
      txt.setAttribute('data-num', nums[idx]);
      txt.style.pointerEvents = 'none';
      txt.textContent = nums[idx];
      svg.appendChild(txt);

      // rect click handler
      rect.addEventListener('click', onCellClick);
    }
  }
  const wrap = document.createElement('div');
  wrap.className = 'grid-wrap';
  wrap.style.width = Math.min(window.innerWidth - 340, totalW) + 'px';
  wrap.appendChild(svg);
  gridContainer.appendChild(wrap);
}

function onCellClick(e){
  const num = parseInt(e.currentTarget.getAttribute('data-num'),10);
  if (num !== expectedSequence) {
    // optional feedback
    e.currentTarget.style.filter = 'brightness(0.9)';
    setTimeout(()=> e.currentTarget.style.filter = '',200);
    return;
  }
  // mark chosen
  markCellSelected(e.currentTarget);
  expectedSequence++;
  targetDisplay.textContent = expectedSequence <= gridConfig.n*gridConfig.n ? expectedSequence : 'Done';
  if (expectedSequence > gridConfig.n*gridConfig.n) {
    // finished
    const finishedAt = Date.now();
    const timeTaken = Math.round((finishedAt - gameStartAt)/1000);
    socket.emit('playerFinished', {roomId: currentRoom.id, timeTaken});
    stopCountdownTimer();
    statusLine.textContent = `Finished in ${fmtTime(timeTaken)} (reported)`;
  }
}

function markCellSelected(rect){
  rect.style.opacity = 0.5;
  rect.style.pointerEvents = 'none';
}

function startCountdownTimer(){
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    const now = Date.now();
    const secLeft = Math.max(0, Math.ceil((gameEndAt - now)/1000));
    timeLeft.textContent = fmtTime(secLeft);
    if (secLeft <= 0) {
      clearInterval(countdownInterval);
      statusLine.textContent = 'Time up!';
    }
  }, 300);
}

function stopCountdownTimer(){
  clearInterval(countdownInterval);
}

function clearGameState(){
  stopCountdownTimer();
  gameStartAt = null;
  gameEndAt = null;
  expectedSequence = 1;
  gridContainer.innerHTML = '';
  finishTimes.innerHTML = '';
  statusLine.textContent = '';
}

// render players list & best times
function renderPlayers(players, bestTimesObj){
  playersList.innerHTML = '';
  Object.values(players).forEach(p => {
    const li = document.createElement('li');
    li.textContent = p.name + (p.currentTime ? ` — ${fmtTime(p.currentTime)}` : '');
    playersList.appendChild(li);
  });
  // show best times
  bestTime.textContent = '--:--';
  if (bestTimesObj) {
    const entries = Object.entries(bestTimesObj);
    if (entries.length>0){
      const best = entries.reduce((a,b)=> a[1]<b[1]?a:b);
      bestTime.textContent = fmtTime(best[1]);
    }
  }
}

// utility
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function randomPastel(){
  const h = Math.floor(Math.random()*360);
  const s = 60 + Math.floor(Math.random()*20);
  const l = 75 + Math.floor(Math.random()*10);
  return `hsl(${h} ${s}% ${l}%)`;
}

function showRoom(){
  lobbySection.classList.add('hidden');
  roomSection.classList.remove('hidden');
  roomTitle.textContent = currentRoom.name + ` (${currentRoom.id})`;
  // host control
  if (socket.id === currentRoom.hostId) startBtn.style.display = 'inline-block';
  else startBtn.style.display = 'none';
  roomLevelSelect.value = currentRoom.level || 'easy';
}

function showLobby(){
  lobbySection.classList.remove('hidden');
  roomSection.classList.add('hidden');
  currentRoom = null;
}

// apply cell/font size controls live
cellSizeControl.oninput = fontSizeControl.oninput = () => {
  if (!gridConfig) return;
  setupGridForLevel(currentRoom ? (currentRoom.level) : 'easy');
};

// initial UI
showLobby();
