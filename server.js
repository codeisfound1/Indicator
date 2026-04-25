const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

// Game state management
const rooms = new Map();
const players = new Map();

// Utility functions
function generateRoomName() {
  const adjectives = ['Swift', 'Bright', 'Quick', 'Smart', 'Cool', 'Epic'];
  const nouns = ['Tiger', 'Eagle', 'Phoenix', 'Dragon', 'Wolf', 'Knight'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}${noun}${Math.floor(Math.random() * 100)}`;
}

function generatePlayerName() {
  const names = ['Nova', 'Blaze', 'Shadow', 'Storm', 'Cyber', 'Alpha', 'Nexus', 'Vortex'];
  return `${names[Math.floor(Math.random() * names.length)]}${Math.floor(Math.random() * 1000)}`;
}

function generateGrid(level) {
  let size;
  let maxNum;

  switch(level) {
    case 'easy': 
      size = 5;
      maxNum = 25;
      break;
    case 'medium':
      size = 7;
      maxNum = 49;
      break;
    case 'hard':
      size = 10;
      maxNum = 100;
      break;
    case 'extreme':
      size = 12;
      maxNum = 144;
      break;
    default:
      size = 5;
      maxNum = 25;
  }

  // Create array from 1 to maxNum
  const numbers = Array.from({length: maxNum}, (_, i) => i + 1);
  
  // Fisher-Yates shuffle
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }

  // Generate random colors for each cell
  const colors = [];
  for (let i = 0; i < maxNum; i++) {
    colors.push(generateRandomColor());
  }

  return {
    size,
    maxNum,
    numbers: numbers.slice(0, maxNum),
    colors,
    timeLimit: 600
  };
}

function generateRandomColor() {
  const hue = Math.floor(Math.random() * 360);
  const saturation = Math.floor(Math.random() * 30) + 60;
  const lightness = Math.floor(Math.random() * 20) + 45;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Socket.io events
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Create room
  socket.on('create_room', (data, callback) => {
    const roomId = uuidv4().slice(0, 8);
    const roomName = generateRoomName();
    const playerName = data.playerName || generatePlayerName();

    const room = {
      id: roomId,
      name: roomName,
      host: socket.id,
      level: data.level || 'easy',
      players: {},
      gameStarted: false,
      createdAt: Date.now()
    };

    room.players[socket.id] = {
      id: socket.id,
      name: playerName,
      grid: generateGrid(room.level),
      currentNumber: 1,
      completedTime: null,
      bestTime: null,
      startTime: null,
      chatHistory: []
    };

    rooms.set(roomId, room);
    players.set(socket.id, {
      roomId,
      playerName,
      socketId: socket.id
    });

    socket.join(roomId);
    socket.roomId = roomId;

    callback({
      success: true,
      roomId,
      roomName,
      playerName
    });

    io.to(roomId).emit('room_updated', getPublicRoomData(room));
  });

  // Join room
  socket.on('join_room', (data, callback) => {
    const room = rooms.get(data.roomId);

    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }

    if (Object.keys(room.players).length >= 4) {
      callback({ success: false, error: 'Room is full' });
      return;
    }

    const playerName = data.playerName || generatePlayerName();

    room.players[socket.id] = {
      id: socket.id,
      name: playerName,
      grid: generateGrid(room.level),
      currentNumber: 1,
      completedTime: null,
      bestTime: null,
      startTime: null,
      chatHistory: []
    };

    players.set(socket.id, {
      roomId: data.roomId,
      playerName,
      socketId: socket.id
    });

    socket.join(data.roomId);
    socket.roomId = data.roomId;

    callback({
      success: true,
      roomId: data.roomId,
      roomName: room.name,
      playerName
    });

    io.to(data.roomId).emit('room_updated', getPublicRoomData(room));
  });

  // Get available rooms
  socket.on('get_lobby', (callback) => {
    const availableRooms = Array.from(rooms.values())
      .filter(room => !room.gameStarted && Object.keys(room.players).length < 4)
      .map(room => ({
        id: room.id,
        name: room.name,
        level: room.level,
        playerCount: Object.keys(room.players).length,
        players: Object.values(room.players).map(p => p.name)
      }))
      .slice(0, 20);

    callback(availableRooms);
  });

  // Change level (player can customize their own grid)
  socket.on('change_level', (data) => {
    const room = rooms.get(socket.roomId);
    if (room && room.players[socket.id]) {
      room.players[socket.id].grid = generateGrid(data.level);
      room.players[socket.id].currentNumber = 1;
      room.players[socket.id].completedTime = null;
      room.players[socket.id].startTime = null;
      
      io.to(socket.roomId).emit('room_updated', getPublicRoomData(room));
    }
  });

  // Start game
  socket.on('start_game', () => {
    const room = rooms.get(socket.roomId);
    if (room && room.host === socket.id) {
      room.gameStarted = true;
      
      // Set start time for all players
      Object.values(room.players).forEach(player => {
        player.startTime = Date.now();
      });

      io.to(socket.roomId).emit('game_started', {
        timeLimit: 600
      });
    }
  });

  // Cell clicked
  socket.on('cell_clicked', (data) => {
    const room = rooms.get(socket.roomId);
    if (!room || !room.players[socket.id]) return;

    const player = room.players[socket.id];
    const grid = player.grid;

    // Check if clicked number matches current number to find
    if (grid.numbers[data.cellIndex] === player.currentNumber) {
      player.currentNumber++;

      // Check if game completed
      if (player.currentNumber > grid.maxNum) {
        const completedTime = Math.floor((Date.now() - player.startTime) / 1000);
        player.completedTime = completedTime;
        player.bestTime = player.bestTime ? Math.min(player.bestTime, completedTime) : completedTime;

        io.to(socket.roomId).emit('player_completed', {
          playerId: socket.id,
          playerName: player.name,
          time: completedTime
        });

        io.to(socket.roomId).emit('room_updated', getPublicRoomData(room));
      } else {
        io.to(socket.roomId).emit('cell_found', {
          playerId: socket.id,
          cellIndex: data.cellIndex,
          nextNumber: player.currentNumber
        });
      }
    }
  });

  // Chat message
  socket.on('send_chat', (data) => {
    const room = rooms.get(socket.roomId);
    if (room && room.players[socket.id]) {
      const message = {
        playerName: room.players[socket.id].name,
        text: data.text,
        timestamp: new Date().getTime()
      };

      room.players[socket.id].chatHistory.push(message);
      io.to(socket.roomId).emit('chat_message', message);
    }
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      const room = rooms.get(player.roomId);
      if (room) {
        delete room.players[socket.id];
        
        if (Object.keys(room.players).length === 0) {
          rooms.delete(player.roomId);
        } else {
          io.to(player.roomId).emit('room_updated', getPublicRoomData(room));
          io.to(player.roomId).emit('player_disconnected', {
            playerName: room.players[socket.id]?.name || 'Unknown'
          });
        }
      }
      players.delete(socket.id);
    }
    console.log(`Player disconnected: ${socket.id}`);
  });
});

function getPublicRoomData(room) {
  return {
    id: room.id,
    name: room.name,
    level: room.level,
    gameStarted: room.gameStarted,
    players: Object.values(room.players).map(p => ({
      id: p.id,
      name: p.name,
      gridSize: p.grid.size,
      currentNumber: p.currentNumber,
      totalNumbers: p.grid.maxNum,
      completedTime: p.completedTime,
      bestTime: p.bestTime,
      grid: {
        size: p.grid.size,
        numbers: p.grid.numbers,
        colors: p.grid.colors
      }
    }))
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
