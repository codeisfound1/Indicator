import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6,
  allowEIO3: true
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game state
const rooms = new Map();
const players = new Map();

// Helper: Generate room ID
function generateShortId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Helper: Generate player name
function generatePlayerName() {
  const adjectives = ['Swift', 'Bright', 'Quick', 'Keen', 'Sharp', 'Smart', 'Bold', 'Wise'];
  const nouns = ['Hunter', 'Finder', 'Scout', 'Seeker', 'Champ', 'Wolf', 'Eagle'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return adj + noun;
}

// Helper: Generate random grid
function generateGrid(size) {
  const total = size * size;
  const numbers = Array.from({ length: total }, (_, i) => i + 1);
  // Fisher-Yates shuffle
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers;
}

// Helper: Generate random colors
function generateColors(count) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    const hue = (i * 360 / count) % 360;
    colors.push(`hsl(${hue}, 75%, 55%)`);
  }
  return colors.sort(() => Math.random() - 0.5);
}

// Socket.io connection
io.on('connection', (socket) => {
  console.log('🟢 Player connected:', socket.id);
  
  socket.emit('connected', { 
    playerId: socket.id,
    timestamp: Date.now()
  });

  // Keep-alive ping
  const pingInterval = setInterval(() => {
    socket.emit('ping', { timestamp: Date.now() });
  }, 20000);

  socket.on('createRoom', (data) => {
    try {
      const roomId = generateShortId();
      const roomName = data.roomName || `Room-${roomId}`;
      const playerName = data.playerName || generatePlayerName();
      const levelMap = { easy: 5, medium: 7, hard: 10 };
      const gridSize = data.level === 'custom' ? (data.gridSize || 10) : levelMap[data.level] || 5;

      const room = {
        id: roomId,
        name: roomName,
        owner: socket.id,
        level: data.level || 'easy',
        gridSize: gridSize,
        maxPlayers: 4,
        players: new Map(),
        grid: generateGrid(gridSize * gridSize),
        colors: generateColors(gridSize * gridSize),
        startTime: null,
        status: 'waiting'
      };

      const playerData = {
        id: socket.id,
        name: playerName,
        currentNumber: 1,
        completedAt: null,
        bestTime: null
      };

      room.players.set(socket.id, playerData);
      rooms.set(roomId, room);
      players.set(socket.id, { roomId, ...playerData });

      socket.join(roomId);
      socket.emit('roomCreated', {
        roomId,
        roomName,
        playerName,
        level: room.level,
        gridSize
      });

      console.log(`✅ Room created: ${roomId}`);
    } catch (err) {
      console.error('❌ createRoom error:', err);
      socket.emit('error', { message: 'Failed to create room' });
    }
  });

  socket.on('joinRoom', (data) => {
    try {
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
        level: room.level,
        gridSize: room.gridSize
      });

      // Notify others
      io.to(room.id).emit('roomUpdated', getRoomState(room));
      console.log(`✅ Player joined room ${room.id}`);
    } catch (err) {
      console.error('❌ joinRoom error:', err);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  socket.on('startGame', () => {
    try {
      const player = players.get(socket.id);
      if (!player) return;

      const room = rooms.get(player.roomId);
      if (!room || room.owner !== socket.id) {
        socket.emit('error', { message: 'Only room owner can start game' });
        return;
      }

      room.status = 'playing';
      room.startTime = Date.now();

      io.to(room.id).emit('gameStarted', {
        startTime: room.startTime,
        timeLimit: 600,
        grid: room.grid,
        colors: room.colors,
        gridSize: room.gridSize
      });

      console.log(`🎮 Game started in room ${room.id}`);
    } catch (err) {
      console.error('❌ startGame error:', err);
    }
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
          playerName: roomPlayer.name,
          currentNumber: roomPlayer.currentNumber,
          bestTime: roomPlayer.bestTime,
          completedAt: roomPlayer.completedAt
        });
      }
    } catch (err) {
      console.error('❌ selectNumber error:', err);
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
          message: String(data.message).substring(0, 200),
          timestamp: Date.now()
        });
      }
    } catch (err) {
      console.error('❌ sendMessage error:', err);
    }
  });

  socket.on('leaveRoom', () => {
    try {
      const player = players.get(socket.id);
      if (player) {
        const room = rooms.get(player.roomId);
        if (room) {
          room.players.delete(socket.id);
          socket.leave(room.id);
          
          if (room.players.size === 0) {
            rooms.delete(player.roomId);
            console.log(`🗑️  Room deleted: ${player.roomId}`);
          } else {
            io.to(room.id).emit('roomUpdated', getRoomState(room));
          }
        }
        players.delete(socket.id);
      }
    } catch (err) {
      console.error('❌ leaveRoom error:', err);
    }
  });

  socket.on('disconnect', () => {
    try {
      clearInterval(pingInterval);
      const player = players.get(socket.id);
      if (player) {
        const room = rooms.get(player.roomId);
        if (room) {
          room.players.delete(socket.id);
          if (room.players.size === 0) {
            rooms.delete(player.roomId);
          } else {
            io.to(player.roomId).emit('roomUpdated', getRoomState(room));
          }
        }
        players.delete(socket.id);
      }
      console.log('🔴 Player disconnected:', socket.id);
    } catch (err) {
      console.error('❌ disconnect error:', err);
    }
  });

  socket.on('pong', (data) => {
    // Keep-alive response
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

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Game server running on http://localhost:${PORT}\n`);
});

httpServer.on('error', (err) => {
  console.error('❌ Server error:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message);
});
