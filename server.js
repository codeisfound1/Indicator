import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
 
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});
 
app.use(express.static('public'));
 
// Game state
const rooms = new Map();
const players = new Map();
 
// Helper functions
function generateShortId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}
 
function generatePlayerName() {
  const adjectives = ['Swift', 'Bright', 'Quick', 'Keen', 'Sharp', 'Smart'];
  const nouns = ['Hunter', 'Finder', 'Scout', 'Seeker', 'Champ'];
  return adjectives[Math.floor(Math.random() * adjectives.length)] + 
         nouns[Math.floor(Math.random() * nouns.length)];
}
 
function generateGrid(size) {
  const numbers = Array.from({ length: size * size }, (_, i) => i + 1);
  // Fisher-Yates shuffle
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers;
}
 
function generateColors(count) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    const hue = (i * 360 / count) % 360;
    colors.push(`hsl(${hue}, 70%, 60%)`);
  }
  return colors.sort(() => Math.random() - 0.5); // Shuffle colors
}
 
// Socket.io events
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
 
  socket.on('createRoom', (data) => {
    const roomId = generateShortId();
    const roomName = data.roomName || `Room-${roomId}`;
    const playerName = data.playerName || generatePlayerName();
 
    const room = {
      id: roomId,
      name: roomName,
      owner: socket.id,
      level: data.level || 'easy', // easy, medium, hard, custom
      gridSize: data.gridSize || 5,
      maxPlayers: 4,
      players: new Map(),
      grid: generateGrid(25),
      colors: generateColors(25),
      startTime: null,
      status: 'waiting' // waiting, playing, finished
    };
 
    rooms.set(roomId, room);
    
    const playerData = {
      id: socket.id,
      name: playerName,
      currentNumber: 1,
      completedAt: null,
      bestTime: null
    };
 
    room.players.set(socket.id, playerData);
    players.set(socket.id, { roomId, ...playerData });
 
    socket.join(roomId);
    socket.emit('roomCreated', {
      roomId,
      roomName,
      playerName,
      level: room.level
    });
 
    io.to(roomId).emit('roomUpdated', getRoomState(room));
  });
 
  socket.on('joinRoom', (data) => {
    const room = rooms.get(data.roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
 
    if (room.players.size >= room.maxPlayers) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }
 
    const playerName = data.playerName || generatePlayerName();
    const playerData = {
      id: socket.id,
      name: playerName,
      currentNumber: 1,
      completedAt: null,
      bestTime: null
    };
 
    room.players.set(socket.id, playerData);
    players.set(socket.id, { roomId: room.id, ...playerData });
 
    socket.join(room.id);
    socket.emit('roomJoined', {
      roomId: room.id,
      roomName: room.name,
      playerName,
      level: room.level
    });
 
    io.to(room.id).emit('roomUpdated', getRoomState(room));
  });
 
  socket.on('startGame', () => {
    const player = players.get(socket.id);
    if (!player) return;
 
    const room = rooms.get(player.roomId);
    if (!room || room.owner !== socket.id) return;
 
    room.status = 'playing';
    room.startTime = Date.now();
 
    io.to(room.id).emit('gameStarted', {
      startTime: room.startTime,
      timeLimit: 600
    });
  });
 
  socket.on('selectNumber', (data) => {
    try {
      const player = players.get(socket.id);
      if (!player) return;
 
      const room = rooms.get(player.roomId);
      if (!room || room.status !== 'playing') return;
 
      const roomPlayer = room.players.get(socket.id);
      if (!roomPlayer) return;
 
      if (data && data.number === roomPlayer.currentNumber) {
        roomPlayer.currentNumber++;
 
        const totalNumbers = room.gridSize * room.gridSize;
        if (roomPlayer.currentNumber > totalNumbers) {
          roomPlayer.completedAt = Date.now();
          roomPlayer.bestTime = (roomPlayer.completedAt - room.startTime) / 1000;
        }
 
        io.to(room.id).emit('playerProgress', {
          playerId: socket.id,
          currentNumber: roomPlayer.currentNumber,
          completedAt: roomPlayer.completedAt,
          bestTime: roomPlayer.bestTime
        });
      }
    } catch (err) {
      console.error('selectNumber error:', err);
    }
  });
 
  socket.on('sendMessage', (data) => {
    try {
      const player = players.get(socket.id);
      if (!player) return;
 
      const room = rooms.get(player.roomId);
      if (!room) return;
 
      if (data && data.message) {
        io.to(room.id).emit('newMessage', {
          playerId: socket.id,
          playerName: player.name,
          message: data.message,
          timestamp: Date.now()
        });
      }
    } catch (err) {
      console.error('sendMessage error:', err);
    }
  });
 
  socket.on('changeLevel', (data) => {
    const player = players.get(socket.id);
    if (!player) return;
 
    const room = rooms.get(player.roomId);
    if (!room) return;
 
    // Generate new grid for this player
    const gridSizeMap = { easy: 5, medium: 7, hard: 10 };
    const size = gridSizeMap[data.level] || 5;
    const count = size * size;
 
    const playerGrid = {
      grid: generateGrid(count),
      colors: generateColors(count),
      size: size
    };
 
    io.to(socket.id).emit('gridUpdated', playerGrid);
  });
 
  socket.on('disconnect', () => {
    try {
      const player = players.get(socket.id);
      if (player) {
        const room = rooms.get(player.roomId);
        if (room) {
          room.players.delete(socket.id);
          if (room.players.size === 0) {
            rooms.delete(player.roomId);
            console.log('Room deleted:', player.roomId);
          } else {
            io.to(player.roomId).emit('roomUpdated', getRoomState(room));
          }
        }
        players.delete(socket.id);
      }
      console.log('Player disconnected:', socket.id);
    } catch (err) {
      console.error('disconnect error:', err);
    }
  });
});
 
function getRoomState(room) {
  return {
    roomId: room.id,
    roomName: room.name,
    level: room.level,
    gridSize: room.gridSize,
    status: room.status,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      currentNumber: p.currentNumber,
      bestTime: p.bestTime,
      completedAt: p.completedAt
    }))
  };
}
 
httpServer.listen(3000, '0.0.0.0', () => {
  console.log('✅ Game server running on http://localhost:3000');
});
 
// Error handling
httpServer.on('error', (err) => {
  console.error('❌ Server error:', err);
});
 
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});
 
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});
