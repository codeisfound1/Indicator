const socket = io();
let localPlayerName = '';
let currentRoom = null;
let localRoomInfo = null;
let timers = {};
let ui = {};

// --- Basic UI wiring ---
document.addEventListener('DOMContentLoaded', () => {
  ui.inputName = document.getElementById('inputName');
  ui.btnSingle = document.getElementById('btnSingle');
  ui.btnLobby = document.getElementById('btnLobby');
  ui.screens = document.querySelectorAll('.screen');
  ui.screenWelcome = document.getElementById('screen-welcome');
  ui.screenSingle = document.getElementById('screen-single');
  ui.screenLobby = document.getElementById('screen-lobby');
  ui.screenRoom = document.getElementById('screen-room');
  ui.roomsList = document.getElementById('roomsList');
  ui.btnCreateRoom = document.getElementById('btnCreateRoom');
  ui.selectLevelLobby = document.getElementById('selectLevelLobby');
  ui.lobbyCustomN = document.getElementById('lobbyCustomN');
  ui.btnRefreshRooms = document.getElementById('btnRefreshRooms');
  ui.btnStartGame = document.getElementById('btnStartGame');
  ui.btnLeaveRoom = document.getElementById('btnLeaveRoom');
  ui.roomPlayers = document.getElementById('roomPlayers');
  ui.roomTitle = document.getElementById('roomTitle');
  ui.gridsArea = document.getElementById('gridsArea');
  ui.chatBox = document.getElementById('chatBox');
  ui.chatMsg = document.getElementById('chatMsg');
  ui.btnSendMsg = document.getElementById('btnSendMsg');
  ui.needNumber = document.getElementById('needNumber');
  ui.countdown = document.getElementById('countdown');
  ui.timeElapsed = document.getElementById('timeElapsed');
  ui.bestTime = document.getElementById('bestTime');

  // Buttons
  ui.btnSingle.addEventListener('click', ()=> showScreen('screen-single'));
  ui.btnLobby.addEventListener('click', ()=> { showScreen('screen-lobby'); refreshRooms(); });

  document.querySelectorAll('.mode').forEach(btn => {
    btn.addEventListener('click', () => {
      const level = btn.dataset.level;
      startSingle(level);
    });
  });

  document.getElementById('startCustom').addEventListener('click', () => {
    const n = document.getElementById('customN').value || 12;
    startSingle('custom', n);
  });

  document.querySelectorAll('.back').forEach(b => b.addEventListener('click', () => showScreen('screen-welcome')));

  ui.btnCreateRoom.addEventListener('click', createRoom);
  ui.btnRefreshRooms.addEventListener('click', refreshRooms);
  ui.btnStartGame.addEventListener('click', startRoomGame);
  ui.btnLeaveRoom.addEventListener('click', leaveRoom);
  ui.btnSendMsg.addEventListener('click', sendChat);

  refreshRooms();
});

function showScreen(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function startSingle(level, customN){
  localPlayerName = ui.inputName.value || ('Player' + Math.floor(Math.random()*1000));
  // create a temporary local-only room simulation
  const cfg = { level, customN };
  buildSingleGrid(cfg, localPlayerName);
  showScreen('screen-room');
  document.getElementById('roomTitle').innerText = `Single - ${level}${customN?(' '+customN+'x'+customN):''}`;
  ui.btnStartGame.style.display = 'none';
}

function buildSingleGrid(cfg, playerName){
  const config = (cfg.level==='custom') ? { rows: Math.max(10, parseInt(cfg.customN||12)), cols: Math.max(10, parseInt(cfg.customN||12)) } : ({ easy:{rows:5,cols:5}, medium:{rows:7,cols:7}, hard:{rows:10,cols:10} })[cfg.level] || {rows:5,cols:5};
  const rows = config.rows, cols = config.cols;
  const numbers = shuffleArray([...Array(rows*cols)].map((_,i)=>i+1));
  const colors = numbers.map(()=>randomColor());
  renderGrids([{ id: 'local', name: playerName, numbers, colors, rows, cols, currentNumber:1, bestTime: null }]);
  setupCountdown(600);
}

function shuffleArray(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

function randomColor(){
  const presets = ['#FF6B6B','#4ECDC4','#45B7D1','#FFA07A','#98D8C8','#F7DC6F','#BB8FCE','#85C1E2','#F8B88B','#ABEBC6','#FAD7A0','#D7BDE2','#A3E4D7','#F9E79F','#D5F4E6'];
  return presets[Math.floor(Math.random()*presets.length)];
}

// --- Lobby & Room functions ---
function refreshRooms(){
  socket.emit('getAvailableRooms');
}
socket.on('availableRooms', list => {
  ui.roomsList.innerHTML = '';
  if(!list || list.length===0){ ui.roomsList.innerHTML = '<div class="room-card">Không có phòng</div>'; return; }
  list.forEach(r => {
    const el = document.createElement('div');
    el.className = 'room-card';
    el.innerHTML = `<div>${r.roomId} (${r.level}) - ${r.playerCount}/4</div><div><button class="btn join">Tham gia</button></div>`;
    el.querySelector('.join').addEventListener('click', ()=> joinRoom(r.roomId));
    ui.roomsList.appendChild(el);
  });
});

function createRoom(){
  const level = ui.selectLevelLobby.value;
  const customN = ui.lobbyCustomN.value;
  const playerName = ui.inputName.value || undefined;
  socket.emit('createRoom', { level, customN, playerName });
}

socket.on('roomCreated', data => {
  joinRoom(data.roomId, true);
});

function joinRoom(roomId, justCreated){
  const playerName = ui.inputName.value || undefined;
  socket.emit('joinRoom', { roomId, playerName }, (res) => {
    // callback handled via events
  });
  currentRoom = roomId;
  ui.roomTitle.innerText = 'Phòng: ' + roomId;
  showScreen('screen-room');
}

socket.on('roomJoined', data => {
  currentRoom = data.roomId;
  document.getElementById('roomTitle').innerText = 'Phòng: ' + data.roomId;
});

socket.on('updatePlayers', players => {
  ui.roomPlayers.innerHTML = '';
  if(!players) return;
  players.forEach(p => {
    const d = document.createElement('div');
    d.innerText = `${p.name} ${p.isHost? '(Host)':''} - need:${p.currentNumber || 1}`;
    ui.roomPlayers.appendChild(d);
  });
});

socket.on('updateLobbies', list => {
  // optional: refresh lobby list if open
  if(document.getElementById('screen-lobby').classList.contains('active')) refreshRooms();
});

// --- Game start & rendering
function startRoomGame(){
  socket.emit('startGame', {});
}

socket.on('gameStarted', data => {
  // request server to send prepared grid via updatePlayers or separate event
  // server currently includes grids when room created/joined; we'll ask for full state via custom event pattern if needed
  ui.countdown.innerText = data.timeLimit || 600;
  setupCountdown(data.timeLimit || 600);
});

socket.on('numberSelected', data => {
  // update UI players states
  // data.players is included from server
  if(data && data.players){
    // update local display of player need
    ui.roomPlayers.innerHTML = '';
    data.players.forEach(p => {
      const d = document.createElement('div');
      d.innerText = `${p.name} - need:${p.currentNumber || 1} ${p.completed? ' (done)':''}`;
      ui.roomPlayers.appendChild(d);
    });
  }
});

socket.on('playerCompleted', data => {
  appendChat(`${data.playerName || data.name || 'Player'} completed in ${data.timeSpent}s`);
  if(data.bestTime) ui.bestTime.innerText = data.bestTime;
});

socket.on('chatMessage', m => {
  appendChat(`${m.from}: ${m.message}`);
});

socket.on('wrongNumber', d => {
  appendChat(`Sai số (chọn ${d.selected}) - cần ${d.expected}`);
});

socket.on('playerDisconnected', d => {
  appendChat(`${d.name || 'Player'} đã rời`);
});

// --- Room leave
function leaveRoom(){
  socket.emit('leaveRoom');
  currentRoom = null;
  showScreen('screen-welcome');
}

// --- Chat
function sendChat(){
  const msg = ui.chatMsg.value;
  if(!msg) return;
  socket.emit('sendMessage', { message: msg });
  ui.chatMsg.value = '';
}

function appendChat(text){
  const el = document.createElement('div');
  el.innerText = text;
  ui.chatBox.appendChild(el);
  ui.chatBox.scrollTop = ui.chatBox.scrollHeight;
}

// --- Rendering grids for each player (multigrid)
function renderGrids(playersArr){
  ui.gridsArea.innerHTML = '';
  const pCount = playersArr.length;
  // decide layout: if 4 players and fixed 2x2
  let layoutCols = 1;
  if(pCount === 1) layoutCols = 1;
  else if(pCount === 2) layoutCols = 2;
  else if(pCount === 3) layoutCols = 2;
  else if(pCount === 4) layoutCols = 2;

  playersArr.forEach((p, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'grid-wrap';
    wrap.style.flex = `1 1 calc(${100/layoutCols}% - 12px)`;
    const title = document.createElement('div');
    title.innerText = p.name;
    wrap.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'grid-canvas';
    const rows = p.rows; const cols = p.cols;
    // compute optimal cell size based on container width
    const containerWidth = Math.max(220, Math.min(720, window.innerWidth - 360));
    let cellSize = 60; // default
    // scale cell to fit: available width per grid
    const approxGridWidth = (containerWidth / layoutCols) - 40;
    const maxCellW = Math.floor((approxGridWidth - (cols-1)*4) / cols);
    cellSize = Math.max(28, Math.min(80, maxCellW));
    grid.style.gridTemplateColumns = `repeat(${cols}, ${cellSize}px)`;
    grid.style.gridAutoRows = `${cellSize}px`;

    p.numbers.forEach((num, i) => {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.style.background = p.colors[i] || randomColor();
      const numEl = document.createElement('div');
      numEl.className = 'num';
      numEl.innerText = num;
      numEl.style.fontSize = (Math.max(12, Math.min(65, Math.floor(cellSize*0.6)))) + 'px';
      cell.appendChild(numEl);
      cell.addEventListener('click', () => handleCellClick(p.id, num, cell));
      grid.appendChild(cell);
    });

    wrap.appendChild(grid);
    ui.gridsArea.appendChild(wrap);

    // show big need number for local player only
    if(p.id === 'local' || p.id === socket.id){
      ui.needNumber.innerText = p.currentNumber || 1;
    }
  });
}

// clicking cell in single mode or local grid
function handleCellClick(playerId, num, cellEl){
  // if single local
  if(playerId === 'local'){
    const expected = parseInt(ui.needNumber.innerText);
    if(num === expected){
      // mark selection
      cellEl.style.filter = 'brightness(0.7)';
      const next = expected + 1;
      ui.needNumber.innerText = next;
      if(next > document.querySelectorAll('.grid-cell').length){
        appendChat(`Hoàn thành!`);
      }
    } else {
      appendChat(`Sai: chọn ${num}, cần ${expected}`);
    }
    return;
  }

  // multiplayer: emit selectNumber to server
  socket.emit('selectNumber', { roomId: currentRoom, selected: num });
}

// countdown timer
function setupCountdown(seconds){
  clearInterval(timers.countdown);
  let remain = seconds || 600;
  ui.countdown.innerText = remain;
  timers.countdown = setInterval(() => {
    remain--;
    ui.countdown.innerText = remain;
    if(remain<=0){
      clearInterval(timers.countdown);
      appendChat('Hết giờ!');
    }
  }, 1000);
}

// window resize re-render grids for responsiveness
window.addEventListener('resize', () => {
  // if single mode, rebuild (simple approach)
});
