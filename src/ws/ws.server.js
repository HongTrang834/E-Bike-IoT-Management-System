const WebSocket = require('ws');
const redisClient = require('../config/redis');
const mqttService = require('../services/mqtt.service');
const mqttClient = require('../config/mqtt');

let wssInstance = null;

const initWebSocket = (server) => {
    const wss = new WebSocket.Server({ server, path: '/api/user/ws' });
    wssInstance = wss;

    wss.on('connection', async (ws, req) => {
        console.log(`[WS] New connection - waiting for token verification`);

        // State để track nếu user đã auth chưa
        let isAuthenticated = false;

        // LẮNG NGHE TIN NHẮN TỪ CLIENT
        ws.on('message', async (message) => {
            try {
                const payload = JSON.parse(message);

                // XỬ LÝ TOKEN VERIFY - chỉ xử lý 1 lần
                if (payload.type === 'token' && !isAuthenticated) {
                    const token = payload.data?.value;
                    console.log(`[WS] Token verify attempt: ${token}`);

                    if (!token) {
                        console.log("[WS] Auth rejected: No token provided");
                        ws.send(JSON.stringify({ type: "token", data: { value: "NG token" } }));
                        return;
                    }

                    // Truy vấn Redis
                    const sessionKey = `user:token:${token}`;
                    const sessionData = await redisClient.hGetAll(sessionKey);

                    if (Object.keys(sessionData).length === 0) {
                        console.log(`[WS] Auth Failed: Token not found in Redis`);
                        ws.send(JSON.stringify({ type: "token", data: { value: "NG token" } }));
                        return;
                    }

                    // Check vehicle_id > 0
                    const vehicleId = sessionData.vehicle_id ? parseInt(sessionData.vehicle_id) : 0;

                    if (vehicleId <= 0) {
                        console.log(`[WS] Auth Failed: No vehicle selected for ${sessionData.email}`);
                        ws.send(JSON.stringify({ type: "token", data: { value: "NG vehicle empty" } }));
                        return;
                    }

                    // --- AUTH THÀNH CÔNG ---
                    isAuthenticated = true;
                    ws.userToken = token;
                    ws.email = sessionData.email;
                    ws.vehicle_id = vehicleId;
                    ws.isAlive = true;
                    ws.missedPings = 0;

                    // Ghi session & lastime_pong vào chính key user:token
                    const crypto = require('crypto');
                    const sessionId = crypto.randomUUID();
                    const currentTime = Date.now().toString();

                    ws.sessionId = sessionId;

                    // THÊM VÀO DANH SÁCH ACTIVE SOCKETS
                    global.activeSockets.set(sessionId, ws);

                    await redisClient.hSet(sessionKey, {
                        'session': sessionId,
                        'lastime_pong': currentTime
                    });

                    console.log(`[WS] Authorized: ${ws.email} (Vehicle: ${ws.vehicle_id}) - Session: ${sessionId}`);
                    ws.send(JSON.stringify({ type: "token", data: { value: "OK" } }));
                    // Gửi dữ liệu Snapshot ngay khi auth thành công
                    if (ws.vehicle_id) {
                        try {
                            const streamKey = `vehicle:stream:${ws.vehicle_id}`;
                            const payload = await redisClient.hGetAll(streamKey);

                            const defaultTelemetry = {
                                speed: 0, odo: 0, trip: 0, range_left: 0,
                                voltage: 0, current: 0, soc: 0, temperature: 0,
                                tilt_angle: 0, hill_asstistance: 0
                            };

                            const defaultStatus = {
                                mode: 0, locked: 0, trunk_locked: 0, horn: 0,
                                headlight: 0, rear_light: 0, turn_light: 0,
                                push_notify: 0, batt_alerts: 0, security_alerts: 0,
                                auto_lock: 0, bluetooth_unlock: 0, remote_access: 0
                            };

                            const telemetryData = payload.telemetry
                                ? JSON.parse(payload.telemetry)
                                : defaultTelemetry;

                            ws.send(JSON.stringify({
                                type: "telemetry",
                                vehicle_id: ws.vehicle_id,
                                data: telemetryData
                            }));

                            const statusData = payload.status
                                ? JSON.parse(payload.status)
                                : defaultStatus;

                            ws.send(JSON.stringify({
                                type: "status",
                                vehicle_id: ws.vehicle_id,
                                data: statusData
                            }));

                            console.log(`[WS] Snapshot sent for vehicle ${ws.vehicle_id}. (Source: ${payload.telemetry ? 'Redis' : 'Default'})`);

                        } catch (err) {
                            console.error(`[WS] Error fetching snapshot from Redis:`, err.message);
                        }
                    }
                    return;
                }

                // XỬ LÝ HEARTBEAT PONG (chỉ sau khi auth)
                //isAuthenticated &&
                if (payload.type === 'heartbeat' && payload.data?.value === 'pong') {
                    ws.isAlive = true;
                    ws.missedPings = 0;

                    // Cập nhật lastime_pong trong Redis (trực tiếp trên user:token)
                    const sessionKey = `user:token:${ws.userToken}`;
                    await redisClient.hSet(sessionKey, 'lastime_pong', Date.now().toString());

                    console.log(`[WS] Received PONG from ${ws.email}`);
                    return;
                }

                // XỬ LÝ LỆNH ĐIỀU KHIỂN (chỉ sau khi auth)
                // Format: {"type": "command", "data": {"type": "lock", "data": 0}}
                if (isAuthenticated && payload.type === 'command' && payload.data?.type && payload.data?.data !== undefined) {
                    const cmdType = payload.data.type;
                    const cmdData = payload.data.data;

                    console.log(`[WS] Received command from ${ws.email}: ${cmdType}=${cmdData}`);
                    console.log(`[WS] Sending command to MQTT for vehicle ${ws.vehicle_id}...`);

                    try {
                        // Gửi command qua MQTT với QoS 2
                        await mqttService.sendCommand(mqttClient, ws.vehicle_id, cmdType, cmdData);
                        console.log(`[WS] ✅ MQTT command sent: ${cmdType}=${cmdData} to vehicle ${ws.vehicle_id} (QoS 2)`);
                    } catch (err) {
                        console.error(`[WS] ❌ Error sending MQTT command:`, err.message);
                    }
                    return;
                }

                // Nếu chưa auth và không phải token message
                // if (!isAuthenticated) {
                //     console.log("[WS] Ignoring message: Not authenticated yet");
                //     return;
                // }

            } catch (e) {
                console.error("[WS] Message Parse Error:", e.message);
            }
        });

        ws.on('close', async () => {
            if (isAuthenticated && ws.sessionId) {
                console.log(`[WS] Client ${ws.email} closed connection`);
                // Xóa khỏi ACTIVE SOCKETS
                global.activeSockets.delete(ws.sessionId);
                // Clear session field trên user:token khi đóng kết nối
                const sessionKey = `user:token:${ws.userToken}`;
                await redisClient.hSet(sessionKey, 'session', '');
            } else {
                console.log(`[WS] Client closed connection before authentication`);
            }
        });
    });

    // CƠ CHẾ PING 
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN && ws.userToken) {
                if (ws.missedPings >= 5) {
                    console.log(`[WS] Terminating ${ws.email} due to pong timeout`);
                    // Clear session field trên user:token khi timeout
                    const sessionKey = `user:token:${ws.userToken}`;
                    redisClient.hSet(sessionKey, 'session', '');
                    return ws.terminate();
                }

                ws.isAlive = false;
                ws.missedPings++;
                ws.send(JSON.stringify({ type: "heartbeat", data: { value: "ping" } }));
                console.log(`[WS] Sent Ping to ${ws.email} (Missed: ${ws.missedPings - 1})`);
            }
        });
    }, 500000);

    // DEBUG: Lắng nghe tất cả tin nhắn thô
    wss.on('message', (message) => {
        console.log('Raw message nhận được:', message.toString());
    });

    wss.on('close', () => clearInterval(interval));

};

// --- BROADCAST FUNCTION ---
// Gửi status/telemetry update tới tất cả clients đang theo dõi vehicle
const broadcastVehicleState = async (vehicleId, stateType, stateData) => {
    // Convert vehicleId to number to match ws.vehicle_id type
    const vehicleIdNum = parseInt(vehicleId);
    console.log(`[WS] Broadcast called for vehicle ${vehicleId} (converted to ${vehicleIdNum}), type=${stateType}`);

    if (!wssInstance) {
        console.log(`[WS] ERROR: WSS instance not available for broadcast`);
        return;
    }

    console.log(`[WS] Total clients connected: ${wssInstance.clients.size}`);

    const message = JSON.stringify({
        type: stateType, // 'status' hoặc 'telemetry'
        vehicle_id: vehicleIdNum,
        data: stateData
    });

    let broadcastCount = 0;
    wssInstance.clients.forEach((ws) => {
        console.log(`[WS] Checking client - vehicle_id=${ws.vehicle_id}, readyState=${ws.readyState}, isOpen=${ws.readyState === WebSocket.OPEN}`);
        if (ws.readyState === WebSocket.OPEN && ws.vehicle_id === vehicleIdNum) {
            ws.send(message);
            broadcastCount++;
            console.log(`[WS] Sent ${stateType} to client ${ws.email}`);
        }
    });

    console.log(`[WS] Broadcast complete: ${stateType} sent to ${broadcastCount} clients for vehicle ${vehicleIdNum}`);
};

const broadcastVehicleChanged = async (email, newVehicleId, vehicleName) => {
    const newVehicleIdNum = newVehicleId ? parseInt(newVehicleId) : 0;
    console.log(`[WS] Notifying user ${email} about vehicle change to ${newVehicleIdNum}`);

    if (!wssInstance) {
        console.log(`[WS] ERROR: WSS instance not available for broadcast`);
        return;
    }

    const message = JSON.stringify({
        type: 'vehicle_changed',
        vehicle_id: newVehicleIdNum,
        vehicle_name: vehicleName
    });

    let broadcastCount = 0;
    wssInstance.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN && ws.email === email) {
            // Update vehicle_id on WebSocket connection
            ws.vehicle_id = newVehicleIdNum;
            ws.send(message);
            broadcastCount++;
            console.log(`[WS] Sent vehicle_changed to ${email}: vehicle_id=${newVehicleIdNum}, vehicle_name=${vehicleName}`);
        }
    });

    console.log(`[WS] Vehicle change notification complete: sent to ${broadcastCount} clients for user ${email}`);
};

module.exports = { initWebSocket, broadcastVehicleState, broadcastVehicleChanged };