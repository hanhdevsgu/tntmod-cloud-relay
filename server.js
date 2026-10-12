const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8765;

// Create HTTP server for Cloud platforms (Render health check)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('TNT Auto-Logistics Team Relay Server is ONLINE 24/7!\nActive rooms: ' + rooms.size);
});

// WebSocket Server attached to HTTP server
const wss = new WebSocket.Server({ server });

// Map: roomId -> Set<WebSocket>
const rooms = new Map();
// Map: ws -> { room: string, player: string }
const clientInfo = new Map();
// Map: roomId -> Map<key, BlockData>
const persistentRoomState = new Map();

function broadcastUserList(room) {
    const clients = rooms.get(room);
    if (!clients) return;
    const userList = [];
    for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN && clientInfo.has(ws)) {
            const name = clientInfo.get(ws).player;
            if (name && !userList.includes(name)) {
                userList.push(name);
            }
        }
    }
    const payload = JSON.stringify({
        action: 'user_list',
        room: room,
        users: userList
    });
    for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
        }
    }
}

wss.on('connection', (ws) => {
    let currentRoom = 'default';
    let playerName = 'player';

    ws.on('message', (data) => {
        try {
            const line = data.toString('utf8').trim();
            if (!line) return;
            const msg = JSON.parse(line);

            if (msg.action === 'join') {
                currentRoom = msg.room || 'default';
                playerName = msg.player || 'player';
                clientInfo.set(ws, { room: currentRoom, player: playerName });

                if (!rooms.has(currentRoom)) {
                    rooms.set(currentRoom, new Set());
                }
                rooms.get(currentRoom).add(ws);

                // Gửi toàn bộ danh sách khối đã đánh dấu của phòng này cho người mới vào
                if (persistentRoomState.has(currentRoom)) {
                    const blockMap = persistentRoomState.get(currentRoom);
                    for (const [key, block] of blockMap.entries()) {
                        const syncMsg = {
                            action: 'update',
                            room: currentRoom,
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

                // Phát sóng danh sách người chơi trong phòng cho toàn bộ client
                broadcastUserList(currentRoom);

            } else if (msg.action === 'query_users') {
                broadcastUserList(msg.room || currentRoom);

            } else if (msg.action === 'update') {
                const room = msg.room || currentRoom || 'default';
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
                const room = msg.room || currentRoom || 'default';
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
        clientInfo.delete(ws);
        if (currentRoom && rooms.has(currentRoom)) {
            rooms.get(currentRoom).delete(ws);
            broadcastUserList(currentRoom);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Cloud Relay Server listening on port ${PORT}`);
});
