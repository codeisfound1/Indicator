# 🎯 NUMBER HUNT - Multiplayer Game

A real-time multiplayer number-finding game built with Node.js, Express, and Socket.io.

## 🎮 Features

✅ **Multiplayer** - Up to 4 players per room  
✅ **4 Difficulty Levels** - Easy (5×5), Medium (7×7), Hard (10×10), Custom (n×n)  
✅ **Real-time Sync** - Live grid updates and leaderboard  
✅ **In-game Chat** - Chat with other players  
✅ **Responsive Design** - Works on desktop, tablet, and mobile  
✅ **Countdown Timer** - 600 seconds per game  

## 📦 Project Structure

```
number-hunt/
├── package.json          # Dependencies
├── server.js             # Node.js + Socket.io backend
└── public/
    ├── index.html        # Game UI (4 screens)
    ├── app.js            # Client-side game logic
    └── style.css         # Responsive styling
```

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Server
```bash
npm start
```

Server will run on **http://localhost:3000**

### 3. Open in Browser
Open http://localhost:3000 in your browser and start playing!

## 🎯 How to Play

1. **Create or Join a Room**
   - Enter your name
   - Choose difficulty level
   - Create a new room or join existing room with code

2. **Start Game** (Room owner only)
   - Click "Start Game" button
   - All players see the same grid but can play independently

3. **Find Numbers in Sequence**
   - Click numbers from 1 to the end
   - Each correct click increases your number
   - Chat with other players

4. **Win Conditions**
   - Complete all numbers before time runs out
   - See final leaderboard with all players' times

## 🔧 Port Configuration

By default, server runs on **port 3000**. To change:

```bash
PORT=3001 npm start
```

Or edit `server.js` line ~240:
```javascript
const PORT = process.env.PORT || 3000;
```

## ❌ Troubleshooting

### Port Already in Use
```bash
# macOS/Linux
lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs kill -9

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Server Won't Start
1. Check Node.js version: `node --version` (need v14+)
2. Check npm version: `npm --version` (need v6+)
3. Clear npm cache: `npm cache clean --force`
4. Reinstall: `rm -rf node_modules && npm install`

### Connection Issues
1. Check browser console (F12) for errors
2. Ensure server is running: `npm start`
3. Try refreshing the page
4. Check firewall settings

### Grid Not Appearing
1. Open browser console (F12)
2. Check for JavaScript errors
3. Ensure SVG rendering is supported

## 🎮 Game Screens

### Lobby Screen
- Create new room or join existing
- Choose difficulty level
- Set custom grid size

### Room Screen
- View connected players
- Chat before game starts
- Room owner starts the game

### Game Screen
- Interactive grid with numbered cells
- Real-time leaderboard
- In-game chat
- Countdown timer

### Completion Screen
- Final leaderboard with rankings
- Your completion time
- Best time among all players

## 📱 Responsive Design

- **Desktop (1024px+)** - Full layout with side-by-side content
- **Tablet (768px-1023px)** - Stacked layout
- **Mobile (< 768px)** - Single column, optimized touch targets

Grid cells automatically scale to fit screen size.

## 🔐 Security Notes

- No persistent data storage (games reset on server restart)
- Room data cleared when all players leave
- No authentication system (for demo purposes)

## 🛠️ Development

### Run with Auto-reload
```bash
npm run dev
```

### Debug Logging
```bash
DEBUG=* npm start
```

### View Console Logs
- Server logs appear in terminal
- Client logs appear in browser console (F12)

## 📊 Game Statistics

- **Max players per room**: 4
- **Default game duration**: 600 seconds
- **Grid sizes**:
  - Easy: 5×5 = 25 cells
  - Medium: 7×7 = 49 cells
  - Hard: 10×10 = 100 cells
  - Custom: n×n (n ≥ 5)

## 🤝 Socket.io Events

### Client → Server
- `createRoom` - Create new game room
- `joinRoom` - Join existing room
- `startGame` - Start the game
- `selectNumber` - Click grid cell
- `sendMessage` - Send chat message
- `leaveRoom` - Leave room

### Server → Client
- `roomCreated` - Room creation confirmed
- `roomJoined` - Join confirmed
- `roomUpdated` - Player list updated
- `gameStarted` - Game started with grid
- `playerProgress` - Player found number
- `newMessage` - Chat message received

## 📝 Notes

- Games are not persistent - closing browser loses data
- Room codes are temporary (only while room exists)
- All players in a room use the same grid but track independently

## 🎓 Learning Resources

- [Socket.io Documentation](https://socket.io/docs/)
- [Express.js Guide](https://expressjs.com/)
- [MDN SVG Guide](https://developer.mozilla.org/en-US/docs/Web/SVG)

## 📞 Support

If you encounter issues:
1. Check terminal for server errors
2. Check browser console (F12) for client errors
3. Ensure port 3000 is available
4. Try clearing browser cache and refreshing

Enjoy the game! 🎮✨
