const socket = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
  reconnectProbability: 1
});

// Game State
const gameState = {
  screen: 'lobby',
  roomId: null,
  playerId: null,
  playerName: null,
  isOwner: false,
  selectedLevel: 'easy',
  selectedGridSize: 5,
  currentNumber: 1,
  gameGrid: [],
  gameColors: [],
  gameStartTime: null,
  timerInterval: null,
  roomPlayers: [],
  totalGridSize: 25,
  connected: false
};

// Socket Connection Events
socket.on('connect', () => {
  console.log('✅ Connected to server:', socket.id);
  gameState.connected = true;
  gameState.playerId = socket.id;
  document.body.style.opacity = '1';
});

socket.on('connected', (data) => {
  console.log('✅ Connection confirmed:', data.playerId);
  gameState.playerId = data.playerId;
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error);
  gameState.connected = false;
});

socket.on('disconnect', (reason) => {
  console.log('⚠️ Disconnected - Reason:', reason);
  gameState.connected = false;
  document.body.style.opacity = '0.6';
  
  if (reason === 'io server disconnect') {
    socket.connect();
  }
});

socket.on('ping', (data) => {
  socket.emit('pong', { timestamp: Date.now() });
});

// Socket Events - Room
socket.on('roomCreated', (data) => {
  gameState.roomId = data.roomId;
  gameState.playerName = data.playerName;
  gameState.isOwner = true;
  switchScreen('room');
  updateRoomDisplay();
  console.log('✅ Room created:', data.roomId);
});

socket.on('roomJoined', (data) => {
  gameState.roomId = data.roomId;
  gameState.playerName = data.playerName;
  gameState.isOwner = false;
  switchScreen('room');
  updateRoomDisplay();
  console.log('✅ Joined room:', data.roomId);
});

socket.on('roomUpdated', (data) => {
  gameState.roomPlayers = data.players || [];
  updatePlayersList();
  updateLeaderboard();
});

// Socket Events - Game
socket.on('gameStarted', (data) => {
  gameState.gameStartTime = data.startTime;
  gameState.gameGrid = data.grid;
  gameState.gameColors = data.colors;
  gameState.totalGridSize = data.gridSize * data.gridSize;
  gameState.currentNumber = 1;
  switchScreen('game');
  renderGrid();
  startTimer(data.timeLimit);
  console.log('🎮 Game started');
});

socket.on('playerProgress', (data) => {
  if (data.playerId === socket.id) {
    gameState.currentNumber = data.currentNumber;
    document.getElementById('currentNumber').textContent = data.currentNumber;
    
    if (data.currentNumber > gameState.totalGridSize) {
      endGame(data.bestTime);
    }
  }

  const playerIdx = gameState.roomPlayers.findIndex(p => p.id === data.playerId);
  if (playerIdx !== -1) {
    gameState.roomPlayers[playerIdx].currentNumber = data.currentNumber;
    gameState.roomPlayers[playerIdx].bestTime = data.bestTime;
    gameState.roomPlayers[playerIdx].completedAt = data.completedAt;
  }

  updateLeaderboard();
});

socket.on('newMessage', (data) => {
  addChatMessage(data.playerName, data.message);
});

socket.on('error', (data) => {
  alert('Error: ' + data.message);
  console.error('Server error:', data);
});

// ===================== LOBBY =====================
document.addEventListener('DOMContentLoaded', () => {
  setupLobbyListeners();
  setupRoomListeners();
  setupGameListeners();
});

function setupLobbyListeners() {
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      gameState.selectedLevel = btn.dataset.level;
      
      const sizeMap = { easy: 5, medium: 7, hard: 10 };
      if (btn.dataset.level === 'custom') {
        document.getElementById('customSizeGroup').classList.remove('hidden');
      } else {
        document.getElementById('customSizeGroup').classList.add('hidden');
        gameState.selectedGridSize = sizeMap[btn.dataset.level];
      }
    });
  });

  document.getElementById('createBtn').addEventListener('click', () => {
    if (!gameState.connected) {
      alert('Not connected to server. Please wait...');
      return;
    }

    const name = document.getElementById('createName').value.trim();
    const roomName = document.getElementById('createRoomName').value.trim();
    const customSize = parseInt(document.getElementById('customSize').value) || 10;

    if (!name) {
      alert('Please enter your name');
      return;
    }

    const size = gameState.selectedLevel === 'custom' ? customSize : gameState.selectedGridSize;

    socket.emit('createRoom', {
      playerName: name,
      roomName: roomName,
      level: gameState.selectedLevel,
      gridSize: size
    });
  });

  document.getElementById('joinBtn').addEventListener('click', () => {
    if (!gameState.connected) {
      alert('Not connected to server. Please wait...');
      return;
    }

    const name = document.getElementById('joinName').value.trim();
    const code = document.getElementById('roomCode').value.trim().toUpperCase();

    if (!name || !code) {
      alert('Please enter name and room code');
      return;
    }

    socket.emit('joinRoom', {
      roomId: code,
      playerName: name
    });
  });
}

function setupRoomListeners() {
  document.getElementById('leaveBtn').addEventListener('click', () => {
    socket.emit('leaveRoom');
    switchScreen('lobby');
  });

  document.getElementById('startBtn').addEventListener('click', () => {
    socket.emit('startGame');
  });

  document.getElementById('sendBtn').addEventListener('click', sendRoomMessage);
  document.getElementById('chatInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendRoomMessage();
  });
}

function setupGameListeners() {
  document.getElementById('exitGameBtn').addEventListener('click', () => {
    clearInterval(gameState.timerInterval);
    socket.emit('leaveRoom');
    switchScreen('room');
  });

  document.getElementById('continueBtn').addEventListener('click', () => {
    switchScreen('room');
  });

  document.getElementById('gameSendBtn').addEventListener('click', sendGameMessage);
  document.getElementById('gameChatInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendGameMessage();
  });
}

function sendRoomMessage() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (msg) {
    socket.emit('sendMessage', { message: msg });
    input.value = '';
  }
}

function sendGameMessage() {
  const input = document.getElementById('gameChatInput');
  const msg = input.value.trim();
  if (msg) {
    socket.emit('sendMessage', { message: msg });
    input.value = '';
  }
}

// ===================== GAME LOGIC =====================
function renderGrid() {
  const svg = document.getElementById('gameGrid');
  svg.innerHTML = '';
  
  const size = Math.sqrt(gameState.gameGrid.length);
  const container = svg.parentElement;
  const w = container.offsetWidth;
  const h = container.offsetHeight;
  const cellSize = Math.min(w / size, h / size) - 4;
  const gridSize = cellSize * size + (size - 1) * 4;

  svg.setAttribute('viewBox', `0 0 ${gridSize} ${gridSize}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);

  gameState.gameGrid.forEach((num, idx) => {
    const row = Math.floor(idx / size);
    const col = idx % size;
    const x = col * (cellSize + 4);
    const y = row * (cellSize + 4);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', cellSize);
    rect.setAttribute('height', cellSize);
    rect.setAttribute('fill', gameState.gameColors[idx]);
    rect.setAttribute('stroke', '#333');
    rect.setAttribute('stroke-width', '2');
    rect.setAttribute('rx', '8');
    rect.setAttribute('data-number', num);
    rect.setAttribute('style', 'cursor: pointer; transition: opacity 0.2s;');

    if (num < gameState.currentNumber) {
      rect.setAttribute('opacity', '0.3');
    }

    rect.addEventListener('click', () => {
      if (num === gameState.currentNumber && gameState.connected) {
        socket.emit('selectNumber', { number: num });
      }
    });

    rect.addEventListener('mouseover', () => {
      rect.setAttribute('opacity', parseFloat(rect.getAttribute('opacity') || 1) + 0.1);
    });

    rect.addEventListener('mouseout', () => {
      if (num < gameState.currentNumber) {
        rect.setAttribute('opacity', '0.3');
      } else {
        rect.setAttribute('opacity', '1');
      }
    });

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x + cellSize / 2);
    text.setAttribute('y', y + cellSize / 2);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-size', Math.max(20, cellSize * 0.35));
    text.setAttribute('font-weight', 'bold');
    text.setAttribute('fill', 'white');
    text.setAttribute('pointer-events', 'none');
    text.textContent = num;

    svg.appendChild(rect);
    svg.appendChild(text);
  });
}

function updateLeaderboard() {
  const lb = document.getElementById('leaderboard');
  const players = gameState.roomPlayers.slice().sort((a, b) => 
    (b.bestTime || Infinity) - (a.bestTime || Infinity)
  );

  lb.innerHTML = players.map((p, i) => `
    <div class="lb-entry">
      <span class="rank">#${i + 1}</span>
      <span class="name">${p.name}</span>
      <span class="progress">${p.currentNumber}/${gameState.totalGridSize}</span>
      <span class="time">${p.bestTime ? formatTime(p.bestTime) : '--'}</span>
    </div>
  `).join('');
}

function updatePlayersList() {
  const list = document.getElementById('playersList');
  document.getElementById('playerCount').textContent = gameState.roomPlayers.length;
  document.getElementById('startBtn').classList.toggle('hidden', !gameState.isOwner);

  list.innerHTML = gameState.roomPlayers.map(p => `
    <div class="player-item">
      <span class="player-name">${p.name}</span>
      <span class="player-status">${p.bestTime ? '✅ ' + formatTime(p.bestTime) : 'Waiting...'}</span>
    </div>
  `).join('');
}

function updateRoomDisplay() {
  document.getElementById('roomTitle').textContent = gameState.roomId;
  document.getElementById('roomCodeDisplay').textContent = gameState.roomId;
}

function startTimer(duration) {
  let remaining = duration;
  updateTimerDisplay(remaining);

  gameState.timerInterval = setInterval(() => {
    remaining--;
    updateTimerDisplay(remaining);

    if (remaining <= 0) {
      clearInterval(gameState.timerInterval);
      endGame(duration);
    }
  }, 1000);
}

function updateTimerDisplay(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  document.getElementById('timer').textContent = `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function endGame(bestTime) {
  clearInterval(gameState.timerInterval);
  
  const isWin = gameState.currentNumber > gameState.totalGridSize;
  document.getElementById('completionTitle').textContent = isWin ? '🎉 Congratulations!' : '⏰ Time\'s Up!';
  document.getElementById('yourTime').textContent = formatTime(bestTime);
  document.getElementById('bestTime').textContent = formatTime(bestTime);

  const final = gameState.roomPlayers
    .filter(p => p.bestTime)
    .sort((a, b) => a.bestTime - b.bestTime)
    .map((p, i) => `
      <div class="lb-entry">
        <span class="rank">#${i + 1}</span>
        <span class="name">${p.name}</span>
        <span class="time">${formatTime(p.bestTime)}</span>
      </div>
    `).join('');

  document.getElementById('finalLeaderboard').innerHTML = final;
  switchScreen('completion');
}

function addChatMessage(name, msg) {
  const container = gameState.screen === 'game' 
    ? document.getElementById('gameChatMessages')
    : document.getElementById('chatMessages');

  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `<strong>${name}:</strong> ${msg}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function switchScreen(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screen + 'Screen').classList.add('active');
  gameState.screen = screen;
}
