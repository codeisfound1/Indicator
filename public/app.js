const socket = io();
 
socket.on('connect', () => {
  console.log('✅ Connected to server:', socket.id);
});
 
socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error);
  alert('Connection error. Please refresh the page.');
});
 
socket.on('disconnect', () => {
  console.log('⚠️ Disconnected from server');
});
 
// Game State
const gameState = {
  screen: 'lobby',
  roomId: null,
  playerId: null,
  playerName: null,
  currentNumber: 1,
  selectedLevel: 'easy',
  selectedGridSize: 5,
  currentGrid: [],
  currentColors: [],
  gameStartTime: null,
  timerInterval: null,
  roomPlayers: new Map(),
  otherPlayersGrids: new Map()
};
 
// DOM Elements
const screens = {
  lobby: document.getElementById('lobbyScreen'),
  room: document.getElementById('roomScreen'),
  game: document.getElementById('gameScreen'),
  completion: document.getElementById('completionScreen')
};
 
// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupLobbyListeners();
  setupRoomListeners();
  setupGameListeners();
});
 
// ==================== LOBBY ====================
function setupLobbyListeners() {
  // Level selection
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      gameState.selectedLevel = btn.dataset.level;
      
      if (btn.dataset.level === 'custom') {
        document.getElementById('customSizeGroup').classList.remove('hidden');
      } else {
        document.getElementById('customSizeGroup').classList.add('hidden');
        const sizeMap = { easy: 5, medium: 7, hard: 10 };
        gameState.selectedGridSize = sizeMap[btn.dataset.level];
      }
    });
  });
 
  // Create Room
  document.getElementById('createRoomBtn').addEventListener('click', () => {
    const playerName = document.getElementById('createPlayerName').value.trim();
    const roomName = document.getElementById('createRoomName').value.trim();
    const customSize = parseInt(document.getElementById('customGridSize').value);
 
    if (!playerName) {
      alert('Please enter your name');
      return;
    }
 
    const size = gameState.selectedLevel === 'custom' ? customSize : gameState.selectedGridSize;
 
    socket.emit('createRoom', {
      playerName,
      roomName,
      level: gameState.selectedLevel,
      gridSize: size
    });
  });
 
  // Join Room
  document.getElementById('joinRoomBtn').addEventListener('click', () => {
    const playerName = document.getElementById('joinPlayerName').value.trim();
    const roomId = document.getElementById('roomCode').value.trim().toUpperCase();
 
    if (!playerName || !roomId) {
      alert('Please enter your name and room code');
      return;
    }
 
    socket.emit('joinRoom', {
      roomId,
      playerName
    });
  });
}
 
function setupRoomListeners() {
  document.getElementById('startGameBtn').addEventListener('click', () => {
    socket.emit('startGame');
  });
 
  document.getElementById('leaveRoomBtn').addEventListener('click', () => {
    socket.emit('leaveRoom');
    switchScreen('lobby');
  });
 
  document.getElementById('sendMessageBtn').addEventListener('click', sendChatMessage);
  document.getElementById('chatInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });
}
 
function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (message) {
    socket.emit('sendMessage', { message });
    input.value = '';
  }
}
 
function setupGameListeners() {
  document.getElementById('exitGameBtn').addEventListener('click', () => {
    socket.emit('exitGame');
    switchScreen('room');
  });
 
  document.getElementById('continueBtn').addEventListener('click', () => {
    switchScreen('room');
  });
 
  document.getElementById('gameSendMessageBtn').addEventListener('click', sendGameChatMessage);
  document.getElementById('gameChatInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendGameChatMessage();
  });
}
 
function sendGameChatMessage() {
  const input = document.getElementById('gameChatInput');
  const message = input.value.trim();
  if (message) {
    socket.emit('sendMessage', { message });
    input.value = '';
  }
}
 
// ==================== SOCKET.IO EVENTS ====================
socket.on('roomCreated', (data) => {
  try {
    gameState.roomId = data.roomId;
    gameState.playerName = data.playerName;
    console.log('Room created:', data.roomId);
    switchScreen('room');
    updateRoomDisplay();
  } catch (err) {
    console.error('roomCreated error:', err);
  }
});
 
socket.on('roomJoined', (data) => {
  try {
    gameState.roomId = data.roomId;
    gameState.playerName = data.playerName;
    console.log('Joined room:', data.roomId);
    switchScreen('room');
    updateRoomDisplay();
  } catch (err) {
    console.error('roomJoined error:', err);
  }
});
 
socket.on('roomUpdated', (data) => {
  gameState.roomPlayers.clear();
  data.players.forEach(p => gameState.roomPlayers.set(p.id, p));
  updatePlayersList();
  
  // Show start button only for room owner
  const isOwner = data.players[0]?.id === socket.id; // Owner is first player
  document.getElementById('startGameBtn').classList.toggle('hidden', !isOwner);
});
 
socket.on('gameStarted', (data) => {
  gameState.gameStartTime = data.startTime;
  switchScreen('game');
  generateAndRenderGrid();
  startTimer(data.timeLimit);
});
 
socket.on('playerProgress', (data) => {
  if (data.playerId === socket.id) {
    gameState.currentNumber = data.currentNumber;
    document.getElementById('currentNumber').textContent = data.currentNumber;
  }
 
  // Update player in leaderboard
  if (gameState.roomPlayers.has(data.playerId)) {
    const player = gameState.roomPlayers.get(data.playerId);
    player.currentNumber = data.currentNumber;
    player.bestTime = data.bestTime;
    player.completedAt = data.completedAt;
  }
 
  updateLeaderboard();
 
  if (data.completedAt && data.playerId === socket.id) {
    endGame(data.bestTime);
  }
});
 
socket.on('gridUpdated', (data) => {
  gameState.currentGrid = data.grid;
  gameState.currentColors = data.colors;
  generateAndRenderGrid();
});
 
socket.on('newMessage', (data) => {
  addChatMessage(data.playerName, data.message);
});
 
socket.on('error', (data) => {
  alert('Error: ' + data.message);
});
 
// ==================== GAME MECHANICS ====================
function generateAndRenderGrid() {
  const size = Math.sqrt(gameState.currentGrid.length);
  const svg = document.getElementById('mainGrid');
  svg.innerHTML = '';
 
  // Calculate responsive grid size
  const containerWidth = svg.parentElement.offsetWidth;
  const containerHeight = svg.parentElement.offsetHeight;
  const cellSize = Math.min(containerWidth / size - 4, containerHeight / size - 4);
  const gridSize = cellSize * size + (size - 1) * 4;
 
  svg.setAttribute('viewBox', `0 0 ${gridSize} ${gridSize}`);
  svg.setAttribute('width', containerWidth);
  svg.setAttribute('height', containerHeight);
 
  gameState.currentGrid.forEach((number, index) => {
    const row = Math.floor(index / size);
    const col = index % size;
    const x = col * (cellSize + 4);
    const y = row * (cellSize + 4);
 
    // Cell rectangle
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', cellSize);
    rect.setAttribute('height', cellSize);
    rect.setAttribute('fill', gameState.currentColors[index]);
    rect.setAttribute('stroke', '#333');
    rect.setAttribute('stroke-width', '2');
    rect.setAttribute('rx', '8');
    rect.setAttribute('class', 'grid-cell');
    rect.setAttribute('data-index', index);
    rect.setAttribute('data-number', number);
 
    if (number < gameState.currentNumber) {
      rect.setAttribute('opacity', '0.3');
    }
 
    rect.addEventListener('click', () => {
      if (number === gameState.currentNumber) {
        socket.emit('selectNumber', { number });
      }
    });
 
    // Number text
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x + cellSize / 2);
    text.setAttribute('y', y + cellSize / 2);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-size', Math.max(20, cellSize * 0.4));
    text.setAttribute('font-weight', 'bold');
    text.setAttribute('fill', 'white');
    text.setAttribute('pointer-events', 'none');
    text.textContent = number;
 
    svg.appendChild(rect);
    svg.appendChild(text);
  });
}
 
function updateLeaderboard() {
  const leaderboard = document.getElementById('leaderboard');
  const players = Array.from(gameState.roomPlayers.values())
    .sort((a, b) => (b.bestTime || Infinity) - (a.bestTime || Infinity));
 
  leaderboard.innerHTML = players.map((p, idx) => `
    <div class="leaderboard-entry">
      <span class="rank">#${idx + 1}</span>
      <span class="name">${p.name}</span>
      <span class="progress">${p.currentNumber} / ${gameState.currentGrid.length}</span>
      <span class="time">${p.bestTime ? formatTime(p.bestTime) : '--:--'}</span>
    </div>
  `).join('');
}
 
function updatePlayersList() {
  const list = document.getElementById('playersList');
  const count = gameState.roomPlayers.size;
  document.getElementById('playerCount').textContent = count;
 
  list.innerHTML = Array.from(gameState.roomPlayers.values()).map(p => `
    <div class="player-item">
      <span class="player-name">${p.name}</span>
      <span class="player-status">${p.bestTime ? `Completed: ${formatTime(p.bestTime)}` : 'Waiting...'}</span>
    </div>
  `).join('');
}
 
function updateRoomDisplay() {
  document.getElementById('roomName').textContent = 'Room ' + gameState.roomId;
  document.getElementById('roomCode').textContent = gameState.roomId;
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
 
function updateTimerDisplay(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  document.getElementById('timer').textContent = 
    `${mins}:${secs.toString().padStart(2, '0')}`;
}
 
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
 
function endGame(bestTime) {
  clearInterval(gameState.timerInterval);
  
  document.getElementById('completionTitle').textContent = 
    gameState.currentNumber > gameState.currentGrid.length ? 'Congratulations! 🎉' : 'Time\'s Up! ⏰';
  
  document.getElementById('yourTime').textContent = formatTime(bestTime);
  document.getElementById('bestTime').textContent = formatTime(bestTime);
 
  // Show final leaderboard
  const leaderboard = Array.from(gameState.roomPlayers.values())
    .sort((a, b) => (a.bestTime || Infinity) - (b.bestTime || Infinity))
    .map((p, idx) => `
      <div class="leaderboard-entry">
        <span class="rank">#${idx + 1}</span>
        <span class="name">${p.name}</span>
        <span class="time">${p.bestTime ? formatTime(p.bestTime) : '--:--'}</span>
      </div>
    `).join('');
 
  document.getElementById('finalLeaderboard').innerHTML = leaderboard;
  switchScreen('completion');
}
 
function addChatMessage(playerName, message) {
  const container = gameState.screen === 'game' 
    ? document.getElementById('gameChatMessages')
    : document.getElementById('chatMessages');
 
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `<strong>${playerName}:</strong> ${message}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}
 
function switchScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[screenName].classList.add('active');
  gameState.screen = screenName;
}
