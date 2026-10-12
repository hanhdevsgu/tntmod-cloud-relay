const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8765;

// Create HTTP server for Cloud platforms (Render/Glitch/Railway/Render health check)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('TNT Auto-Logistics Team Relay Server is ONLINE 24/7!\nActive rooms: ' + rooms.size);
});

// WebSocket Server attached to HTTP server
const wss = new WebSocket.Server({ server });

// Map: roomId -> Set<WebSocket>
const rooms = new Map();
// Map: roomId -> Map<key, BlockData>
const persistentRoomState = new Map();

function broadcastRoster(roomId) {
    const clients = rooms.get(roomId);
    if (!clients) return;
    const playerList = [];
    for (const client of clients) {
        if (client.playerName && client.playerName !== 'unknown' && client.readyState === WebSocket.OPEN) {
            if (!playerList.includes(client.playerName)) {
                playerList.push(client.playerName);
            }
        }
    }
    const rosterMsg = JSON.stringify({
        action: 'room_roster',
        room: roomId,
        players: playerList
    });
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(rosterMsg);
        }
    }
}

wss.on('connection', (ws) => {
    ws.currentRoom = 'default';
    ws.playerName = 'unknown';

    ws.on('message', (data) => {
        try {
            const line = data.toString('utf8').trim();
            if (!line) return;
            const msg = JSON.parse(line);

            if (msg.action === 'join') {
                const targetRoom = msg.room || 'default';
                if (ws.currentRoom && ws.currentRoom !== targetRoom && rooms.has(ws.currentRoom)) {
                    rooms.get(ws.currentRoom).delete(ws);
                    broadcastRoster(ws.currentRoom);
                }

                ws.currentRoom = targetRoom;
                if (msg.player && msg.player.trim() && msg.player !== 'player') {
                    ws.playerName = msg.player.trim();
                } else if (!ws.playerName || ws.playerName === 'unknown') {
                    ws.playerName = msg.player || 'player';
                }

                if (!rooms.has(ws.currentRoom)) {
                    rooms.set(ws.currentRoom, new Set());
                }
                rooms.get(ws.currentRoom).add(ws);

                // Broadcast danh sách người chơi online trong phòng
                broadcastRoster(ws.currentRoom);

                // Gửi toàn bộ danh sách khối đã đánh dấu của phòng này cho người mới vào
                if (persistentRoomState.has(ws.currentRoom)) {
                    const blockMap = persistentRoomState.get(ws.currentRoom);
                    for (const [key, block] of blockMap.entries()) {
                        const syncMsg = {
                            action: 'update',
                            room: ws.currentRoom,
                            dim: block.dim,
                            x: block.x,
                            y: block.y,
                            z: block.z,
                            type: block.type,
                            count: block.count
                        };
                        ws.send(JSON.stringify(syncMsg));
                    }
                }
            } else if (msg.action === 'get_status') {
                broadcastRoster(ws.currentRoom || 'default');
            } else if (msg.action === 'update') {
                const room = msg.room || ws.currentRoom || 'default';
                if (!persistentRoomState.has(room)) {
                    persistentRoomState.set(room, new Map());
                }
                const blockMap = persistentRoomState.get(room);
                const blockKey = `${msg.dim}:${msg.x},${msg.y},${msg.z}`;

                if (msg.type === 'REMOVE') {
                    blockMap.delete(blockKey);
                } else {
                    blockMap.set(blockKey, {
                        dim: msg.dim,
                        x: msg.x,
                        y: msg.y,
                        z: msg.z,
                        type: msg.type,
                        count: msg.count || 0
                    });
                }

                // Chuyển tiếp tới tất cả người chơi khác trong cùng phòng
                const clients = rooms.get(room);
                if (clients) {
                    const payload = JSON.stringify(msg);
                    for (const client of clients) {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(payload);
                        }
                    }
                }
            } else if (msg.action === 'clear_all') {
                const room = msg.room || ws.currentRoom || 'default';
                if (persistentRoomState.has(room)) {
                    persistentRoomState.get(room).clear();
                }
                const clients = rooms.get(room);
                if (clients) {
                    const payload = JSON.stringify({ action: 'clear_all', room: room });
                    for (const client of clients) {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(payload);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error handling message:', e.message);
        }
    });

    ws.on('close', () => {
        if (ws.currentRoom && rooms.has(ws.currentRoom)) {
            rooms.get(ws.currentRoom).delete(ws);
            broadcastRoster(ws.currentRoom);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Cloud Relay Server listening on port ${PORT}`);
});
