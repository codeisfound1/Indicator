// Game state
const gameState = {
  socket: null,
  roomId: null,
  roomName: null,
  playerName: null,
  isHost: false,
  gameStarted: false,
  currentNumber: 1,
  timeRemaining: 600,
  timerInterval: null,
  startTime: null,
  completedTime: null,
  bestTime: null,
  currentLevel: 'easy'
};

// Grid state
const gridState = {
  size: 5,
  maxNum: 25,
  numbers: [],
  colors: [],
  cellSize: 60,
  fontSize: 25,
  foundCells: new Set()
};

// Initialize Socket.io
function initSocket() {
  gameState.socket = io();

  gameState.socket.on('room_updated', handleRoomUpdated);
  gameState.socket.on('game_started', handleGameStarted);
  gameState.socket.on('cell_found', handleCellFound);
  gameState.socket.on('player_completed', handlePlayerCompleted);
  gameState.socket.on('chat_message', handleChatMessage);
  gameState.socket.on('player_disconnected', handlePlayerDisconnected);
}

// LOBBY FUNCTIONS
function showLobbyScreen() {
  document.getElementById('game-screen').classList.remove('active');
  document.getElementById('lobby-screen').classList.add('active');
}

function showGameScreen() {
  document.getElementById('lobby-screen').classList.remove('active');
  document.getElementById('game-screen').classList.add('active');
}

function createRoom() {
  const playerName = document.getElementById('create-player-name').value.trim();
  const level = document.getElementById('create-level').value;

  gameState.socket.emit('create_room', {
    playerName: playerName || undefined,
    level: level
  }, (response) => {
    if (response.success) {
      gameState.roomId = response.roomId;
      gameState.roomName = response.roomName;
      gameState.playerName = response.playerName;
      gameState.isHost = true;
      gameState.currentLevel = level;
      showGameScreen();
    }
  });
}

function refreshLobby() {
  gameState.socket.emit('get_lobby', (rooms) => {
    const roomsList = document.getElementById('rooms-list');
    roomsList.innerHTML = '';

    if (rooms.length === 0) {
      roomsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No rooms available</p>';
      return;
    }

    rooms.forEach(room => {
      const roomEl = document.createElement('div');
      roomEl.className = 'room-item';
      roomEl.innerHTML = `
        <div class="room-item-header">
          <span class="room-item-name">${escapeHtml(room.name)}</span>
          <span class="room-item-level">${room.level.toUpperCase()}</span>
        </div>
        <div class="room-item-players">
          👥 ${room.playerCount}/4 Players: ${room.players.map(p => escapeHtml(p)).join(', ')}
        </div>
      `;
      roomEl.addEventListener('click', () => joinRoom(room.id));
      roomsList.appendChild(roomEl);
    });
  });
}

function joinRoom(roomId) {
  const playerName = document.getElementById('join-player-name').value.trim();

  gameState.socket.emit('join_room', {
    roomId,
    playerName: playerName || undefined
  }, (response) => {
    if (response.success) {
      gameState.roomId = response.roomId;
      gameState.roomName = response.roomName;
      gameState.playerName = response.playerName;
      showGameScreen();
    } else {
      alert(`Error: ${response.error}`);
    }
  });
}

function leaveRoom() {
  if (gameState.socket) {
    gameState.socket.disconnect();
    gameState.socket.connect();
  }
  resetGameState();
  showLobbyScreen();
}

// GAME FUNCTIONS
function handleRoomUpdated(room) {
  document.getElementById('room-name').textContent = room.name;
  document.getElementById('room-id').textContent = `#${room.id}`;

  renderPlayersGrids(room);
}

function renderPlayersGrids(room) {
  const container = document.getElementById('players-grids-container');
  container.innerHTML = '';

  room.players.forEach(player => {
    const wrapper = document.createElement('div');
    wrapper.className = 'player-grid-wrapper';

    if (player.completedTime !== null) {
      wrapper.classList.add('completed');
    }

    const header = document.createElement('div');
    header.className = 'player-grid-header';
    header.innerHTML = `
      <span class="player-name">${escapeHtml(player.name)}</span>
      <div class="player-stats">
        <div class="player-stat">
          <span class="stat-label">Progress</span>
          <span class="stat-value">${player.currentNumber}/${player.totalNumbers}</span>
        </div>
        ${player.completedTime !== null ? `
          <div class="player-stat">
            <span class="stat-label">Time</span>
            <span class="stat-value">${formatTime(player.completedTime)}</span>
          </div>
        ` : ''}
        ${player.bestTime !== null ? `
          <div class="player-stat">
            <span class="stat-label">Best</span>
            <span class="stat-value">${formatTime(player.bestTime)}</span>
          </div>
        ` : ''}
      </div>
    `;

    wrapper.appendChild(header);

    const svg = createGridSVG(player.grid, player.id);
    wrapper.appendChild(svg);

    container.appendChild(wrapper);

    // Add click handlers
    setupGridClickHandlers(svg, player.grid, player.id);
  });
}

function createGridSVG(grid, playerId) {
  const size = grid.size;
  const maxNum = grid.maxNum;
  const cellSize = calculateOptimalCellSize(size);
  const gridSize = cellSize * size;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${gridSize} ${gridSize}`);
  svg.setAttribute('class', 'grid-svg');
  svg.setAttribute('data-player-id', playerId);

  let cellIndex = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (cellIndex >= maxNum) break;

      const x = col * cellSize;
      const y = row * cellSize;
      const number = grid.numbers[cellIndex];
      const color = grid.colors[cellIndex];

      // Create group for cell
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'grid-cell');
      g.setAttribute('data-index', cellIndex);
      g.setAttribute('data-number', number);

      // Rectangle
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', cellSize);
      rect.setAttribute('height', cellSize);
      rect.setAttribute('fill', color);
      rect.setAttribute('class', 'grid-cell-rect');

      // Text
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x + cellSize / 2);
      text.setAttribute('y', y + cellSize / 2);
      text.setAttribute('class', 'grid-cell-text');
      text.setAttribute('font-size', calculateOptimalFontSize(size));
      text.textContent = number;

      g.appendChild(rect);
      g.appendChild(text);
      svg.appendChild(g);

      cellIndex++;
    }
    if (cellIndex >= maxNum) break;
  }

  return svg;
}

function calculateOptimalCellSize(gridSize) {
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  // Calculate available space (roughly 70% of screen for grids in multiplayer)
  const availableWidth = screenWidth * 0.45;
  const availableHeight = screenHeight * 0.55;

  // Calculate cell size based on grid size
  const cellSizeWidth = Math.floor(availableWidth / gridSize) - 2;
  const cellSizeHeight = Math.floor(availableHeight / gridSize) - 2;

  const cellSize = Math.max(Math.min(cellSizeWidth, cellSizeHeight, 80), 30);
  return Math.floor(cellSize);
}

function calculateOptimalFontSize(gridSize) {
  const cellSize = calculateOptimalCellSize(gridSize);
  return Math.max(Math.floor(cellSize * 0.4), 12);
}

function setupGridClickHandlers(svg, grid, playerId) {
  const cells = svg.querySelectorAll('.grid-cell');

  cells.forEach(cell => {
    cell.addEventListener('click', (e) => {
      const cellIndex = parseInt(cell.getAttribute('data-index'));
      const number = parseInt(cell.getAttribute('data-number'));

      // Only allow clicks on own grid
      if (playerId !== gameState.socket.id) return;

      // Only allow clicking current number
      if (number === gameState.currentNumber && gameState.gameStarted) {
        gameState.socket.emit('cell_clicked', { cellIndex });
      }
    });

    cell.addEventListener('hover', () => {
      const number = parseInt(cell.getAttribute('data-number'));
      if (number === gameState.currentNumber) {
        cell.style.opacity = '0.8';
      }
    });
  });
}

function handleCellFound(data) {
  const svg = document.querySelector(`.grid-svg[data-player-id="${data.playerId}"]`);
  if (!svg) return;

  const cell = svg.querySelector(`[data-index="${data.cellIndex}"]`);
  if (cell) {
    cell.classList.add('found');
  }

  // Update current number if it's own player
  if (data.playerId === gameState.socket.id) {
    gameState.currentNumber = data.nextNumber;
    document.getElementById('current-number').textContent = data.nextNumber;
  }
}

function handleGameStarted(data) {
  gameState.gameStarted = true;
  gameState.startTime = Date.now();
  gameState.timeRemaining = data.timeLimit;
  gameState.currentNumber = 1;

  document.getElementById('current-number').textContent = '1';

  // Start countdown timer
  startCountdown();
}

function startCountdown() {
  if (gameState.timerInterval) clearInterval(gameState.timerInterval);

  gameState.timerInterval = setInterval(() => {
    gameState.timeRemaining--;
    updateTimer();

    if (gameState.timeRemaining <= 0) {
      clearInterval(gameState.timerInterval);
      gameState.gameStarted = false;
      alert('Time\'s up!');
    }
  }, 1000);

  updateTimer();
}

function updateTimer() {
  const timerEl = document.getElementById('timer');
  timerEl.textContent = formatTime(gameState.timeRemaining);

  if (gameState.timeRemaining <= 60) {
    timerEl.classList.add('warning');
  }
  if (gameState.timeRemaining <= 10) {
    timerEl.classList.remove('warning');
    timerEl.classList.add('danger');
  }
}

function handlePlayerCompleted(data) {
  addChatMessage('System', `${escapeHtml(data.playerName)} completed in ${formatTime(data.time)}! 🎉`);
}

function handleChatMessage(message) {
  addChatMessage(message.playerName, message.text);
}

function handlePlayerDisconnected(data) {
  addChatMessage('System', `${escapeHtml(data.playerName)} left the room.`);
}

function addChatMessage(playerName, text) {
  const chatMessages = document.getElementById('chat-messages');
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-message';

  if (playerName === 'System') {
    msgEl.style.borderLeftColor = 'var(--warning-color)';
    msgEl.innerHTML = `<div class="chat-message-text" style="color: var(--warning-color);">${escapeHtml(text)}</div>`;
  } else {
    msgEl.innerHTML = `
      <div class="chat-message-player">${escapeHtml(playerName)}</div>
      <div class="chat-message-text">${escapeHtml(text)}</div>
    `;
  }

  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();

  if (text && gameState.socket) {
    gameState.socket.emit('send_chat', { text });
    input.value = '';
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function resetGameState() {
  gameState.roomId = null;
  gameState.roomName = null;
  gameState.playerName = null;
  gameState.isHost = false;
  gameState.gameStarted = false;
  gameState.currentNumber = 1;
  gameState.timeRemaining = 600;
  gameState.completedTime = null;
  gameState.bestTime = null;
  
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
  }

  gridState.foundCells.clear();
}

// EVENT LISTENERS
document.addEventListener('DOMContentLoaded', () => {
  // Initialize socket
  initSocket();

  // Lobby events
  document.getElementById('create-room-btn').addEventListener('click', createRoom);
  document.getElementById('refresh-lobby-btn').addEventListener('click', refreshLobby);
  document.getElementById('leave-room-btn').addEventListener('click', leaveRoom);

  // Chat events
  document.getElementById('send-chat-btn').addEventListener('click', sendChatMessage);
  document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  // Initial lobby load
  setTimeout(() => {
    refreshLobby();
  }, 1000);

  // Auto-refresh lobby every 3 seconds
  setInterval(() => {
    if (document.getElementById('lobby-screen').classList.contains('active')) {
      refreshLobby();
    }
  }, 3000);

  // Handle window resize
  window.addEventListener('resize', () => {
    // Recalculate and redraw grids if in game
    if (gameState.roomId && document.getElementById('game-screen').classList.contains('active')) {
      // Grid will auto-resize with SVG viewBox
    }
  });

  // Prevent leaving with unsaved game
  window.addEventListener('beforeunload', (e) => {
    if (gameState.gameStarted) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
});

// Handle player becoming host functionality
function startGame() {
  if (gameState.isHost && gameState.socket) {
    gameState.socket.emit('start_game');
  }
}

// Handle custom level selection in game
function changeLevel(newLevel) {
  if (gameState.socket && gameState.roomId) {
    gameState.socket.emit('change_level', { level: newLevel });
  }
}

// Visibility change to handle disconnection detection
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Page hidden
  } else {
    // Page visible again
    if (gameState.socket && !gameState.socket.connected) {
      gameState.socket.connect();
    }
  }
});
