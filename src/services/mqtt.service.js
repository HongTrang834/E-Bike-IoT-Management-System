const redisClient = require('../config/redis');
const db = require('../config/db');

/**
 * Xử lý giải mã dữ liệu Binary MQTT từ xe gửi lên
 */
const handleMqttMessage = async (topic, message) => {
    try {
        const topicParts = topic.split('/');
        const vehicleId = topicParts[1];
        const dataType = topicParts[2];
        const buffer = Buffer.from(message);
        let decodedData = {};

        // 1. Giải mã Telemetry (23 bytes tổng cộng)
        if (dataType === "telemetry") {
            decodedData = {
                speed: buffer.readUInt16LE(0),          // H - 2 bytes
                odo: buffer.readUInt32LE(2),            // L - 4 bytes
                trip: buffer.readUInt32LE(6),           // L - 4 bytes
                range_left: buffer.readUInt16LE(10),    // H - 2 bytes
                voltage: buffer.readUInt16LE(12),       // H - 2 bytes
                current: buffer.readInt16LE(14),        // h - 2 bytes
                soc: buffer.readUInt16LE(16),           // H - 2 bytes
                temperature: buffer.readInt16LE(18),    // h - 2 bytes
                tilt_angle: buffer.readInt16LE(20),     // h - 2 bytes
                hill_assistance: buffer.readUInt8(22)   // B - 1 byte
            };
            console.log(`[Telemetry] Decoded for ${vehicleId}:`, decodedData);
        }

        // 2. Giải mã Status (15 bytes tổng cộng)
        else if (dataType === "status") {
            console.log(`[STEP 2] Server nhận được STATUS phản hồi từ xe ${vehicleId}!`);
            decodedData = {
                mode: buffer.readUInt16LE(0),           // 2 bytes LE
                locked: buffer.readUInt8(2) === 1,
                trunk_locked: buffer.readUInt8(3) === 1,
                horn: buffer.readUInt8(4) === 1,
                answareback: buffer.readUInt8(5) === 1,
                headlight: buffer.readUInt8(6) === 1,
                rear_light: buffer.readUInt8(7) === 1,
                turn_light: buffer.readUInt8(8),
                push_notify: buffer.readUInt8(9) === 1,
                batt_alerts: buffer.readUInt8(10) === 1,
                security_alerts: buffer.readUInt8(11) === 1,
                auto_lock: buffer.readUInt8(12) === 1,
                bluetooth_unlock: buffer.readUInt8(13) === 1,
                remote_access: buffer.readUInt8(14) === 1
            };
            console.log(`[Status] Decoded for ${vehicleId}:`, decodedData);
        }

        // 3. Giải mã Location (10 bytes tổng cộng)
        else if (dataType === "location") {
            const lat = buffer.readInt32LE(0) / 10000000; // l - 4 bytes
            const lon = buffer.readInt32LE(4) / 10000000; // l - 4 bytes
            const heading = buffer.readUInt16LE(8);       // H - 2 bytes

            const redisKey = `vehicle:last_location:${vehicleId}`;
            const lastLoc = await redisClient.hGetAll(redisKey);

            // Chỉ lưu DB nếu có sự thay đổi tọa độ
            if (lat != lastLoc.lat || lon != lastLoc.lon || heading != lastLoc.heading) {
                const query = 'INSERT INTO location_log (time, vehicle_id, lat, lon, heading) VALUES (NOW(), $1, $2, $3, $4)';
                await db.query(query, [vehicleId, lat, lon, heading]);

                // Cập nhật Redis làm bộ đệm so sánh
                await redisClient.hSet(redisKey, {
                    lat: lat.toString(),
                    lon: lon.toString(),
                    heading: heading.toString()
                });
                console.log(`[Location] Updated DB for ${vehicleId}`);
            }
            return;
        }

        // 4. Giải mã Event (16 bytes tổng cộng)
        else if (dataType === "event") {

            if (buffer.length < 16) return;
            const eventId = buffer.readUInt32LE(0);    // I - 4 bytes
            const typeId = buffer.readUInt16LE(4);     // H - 2 bytes
            const value = buffer.toString('utf8', 6, 16).replace(/\0/g, '');

            // chỉ lưu khi name, value, type khác với giá trị trước đó?? 
            const query = 'INSERT INTO event_log (time, vehicle_id, name, type, value) VALUES (NOW(), $1, $2, $3, $4)';
            await db.query(query, [vehicleId, eventId, typeId, value]);
            console.log(`[Event] Logged for ${vehicleId}: ${eventId} (${typeId}) with value ${value}`);
            return;
        }

        // LƯU VÀO REDIS CHO TELEMETRY/STATUS/CMD (Stream Data)
        if (Object.keys(decodedData).length > 0) {
            const redisStreamKey = `vehicle:stream:${vehicleId}`;

            // CRITICAL FIX: For STATUS from simulation, DO NOT overwrite Redis
            // Backend commands already update Redis with correct state
            // Simulation status may have stale data that overwrites user changes
            if (dataType === 'status') {
                console.log(`[Status] Received from simulation but NOT updating Redis (backend state has priority)`);
                console.log(`[Status] Simulation data:`, decodedData);

                // Get current status from Redis to broadcast via WebSocket
                const currentData = await redisClient.hGetAll(redisStreamKey);
                if (currentData && currentData.status) {
                    try {
                        decodedData = JSON.parse(currentData.status);
                        console.log(`[Status] Using Redis state for broadcast:`, decodedData);
                    } catch (e) {
                        console.error('[Status] Error parsing Redis status:', e);
                    }
                }
            } else {
                // For telemetry and other types, save directly
                await redisClient.hSet(redisStreamKey, {
                    "vehicle_id": vehicleId,
                    [dataType]: JSON.stringify(decodedData)
                });
            }

            // PUSH DỮ LIỆU ĐẾN TẤT CẢ CLIENT WEBSOCKET KẾT NỐI VỚI XE NÀY
            if (global.activeSockets && global.activeSockets.size > 0) {
                const messageToSend = JSON.stringify({
                    type: dataType,
                    vehicle_id: vehicleId,
                    data: decodedData,
                    timestamp: Date.now()
                });

                global.activeSockets.forEach((ws) => {
                    // Gửi cho tất cả client theo dõi xe này
                    if (ws.vehicle_id === parseInt(vehicleId) && ws.readyState === 1) { // 1 = OPEN
                        ws.send(messageToSend);
                        console.log(`[WebSocket] Pushed ${dataType} to client ${ws.email} for vehicle ${vehicleId}`);
                    }
                });
            } else {
                console.log(`[WebSocket] No active clients for vehicle ${vehicleId}`);
            }
        }

    } catch (error) {
        console.error('Error handling Binary MQTT message:', error.message);
    }
};

/**
 * Gửi lệnh điều khiển xuống xe (QoS 2) để xe gửi lại status
 */
const sendCommand = async (mqttClient, vehicleId, type, data) => {
    const topic = `bike/${vehicleId}/cmd`;

    // Mapping tên command sang field number (with aliases for frontend compatibility)
    const COMMAND_MAP = {
        'lock': 1,
        'locked': 1,  // alias
        'trunk_lock': 2,
        'trunk_locked': 2,  // alias
        'trunk_open': 2,  // alias
        'horn': 3,
        'answareback': 4,
        'answerback': 4,  // alias (correct spelling)
        'headlight': 5,
        'rear_light': 6,
        'rearlight': 6,  // alias
        'turn_light': 7,
        'turnlight': 7,  // alias
        'push_notify': 8,
        'pushnotify': 8,  // alias
        'batt_alerts': 9,
        'battalerts': 9,  // alias
        'battery_alerts': 9,  // alias
        'security_alerts': 10,
        'securityalerts': 10,  // alias
        'auto_lock': 11,
        'autolock': 11,  // alias
        'bluetooth_unlock': 12,
        'bluetoothunlock': 12,  // alias
        'remote_access': 13,
        'remoteaccess': 13  // alias
    };

    const fieldNumber = COMMAND_MAP[type];
    if (fieldNumber === undefined) {
        console.error(`[Command] Unknown command type: "${type}" - Please check frontend is sending correct field name`);
        console.error(`[Command] Available commands:`, Object.keys(COMMAND_MAP).join(', '));
        return;
    }

    const buffer = Buffer.alloc(4);
    buffer.writeUInt16LE(fieldNumber, 0);  // Field number - 2 bytes
    buffer.writeUInt16LE(data, 2);         // Data value - 2 bytes

    mqttClient.publish(topic, buffer, { qos: 2 });

    // CRITICAL FIX: Update Redis status immediately when sending command
    // This ensures simulation gets the correct state when it queries backend
    const redisKey = `vehicle:stream:${vehicleId}`;

    // Get current status from Redis
    const currentData = await redisClient.hGetAll(redisKey);

    // Start with complete default state to avoid losing fields
    let currentStatus = {
        mode: 0,
        locked: false,
        trunk_locked: false,
        horn: false,
        answareback: false,
        headlight: false,
        rear_light: false,
        turn_light: 0,
        push_notify: false,
        batt_alerts: false,
        security_alerts: false,
        auto_lock: false,
        bluetooth_unlock: false,
        remote_access: false
    };

    // Merge with existing status in Redis (if any)
    if (currentData && currentData.status) {
        try {
            const existingStatus = JSON.parse(currentData.status);
            Object.assign(currentStatus, existingStatus);
        } catch (e) {
            console.error('[Command] Error parsing current status:', e);
        }
    }

    // Map command type to status field name (with aliases)
    const COMMAND_TO_STATUS_MAP = {
        'lock': 'locked',
        'locked': 'locked',
        'trunk_lock': 'trunk_locked',
        'trunk_locked': 'trunk_locked',
        'trunk_open': 'trunk_locked',
        'horn': 'horn',
        'answareback': 'answareback',
        'answerback': 'answareback',
        'headlight': 'headlight',
        'rear_light': 'rear_light',
        'rearlight': 'rear_light',
        'turn_light': 'turn_light',
        'turnlight': 'turn_light',
        'push_notify': 'push_notify',
        'pushnotify': 'push_notify',
        'batt_alerts': 'batt_alerts',
        'battalerts': 'batt_alerts',
        'battery_alerts': 'batt_alerts',
        'security_alerts': 'security_alerts',
        'securityalerts': 'security_alerts',
        'auto_lock': 'auto_lock',
        'autolock': 'auto_lock',
        'bluetooth_unlock': 'bluetooth_unlock',
        'bluetoothunlock': 'bluetooth_unlock',
        'remote_access': 'remote_access',
        'remoteaccess': 'remote_access'
    };

    const statusFieldName = COMMAND_TO_STATUS_MAP[type];

    if (statusFieldName) {
        // Update the status field with the new value (convert 0/1 to boolean)
        currentStatus[statusFieldName] = data === 1;

        // Save COMPLETE status back to Redis (not just one field!)
        await redisClient.hSet(redisKey, {
            "vehicle_id": vehicleId,
            "status": JSON.stringify(currentStatus),
            "cmd": JSON.stringify({ type, data: data })
        });

        console.log(`[Command] Updated Redis status: ${statusFieldName}=${currentStatus[statusFieldName]}`);
    } else {
        // Fallback: just save cmd if mapping not found
        await redisClient.hSet(redisKey, {
            "vehicle_id": vehicleId,
            "cmd": JSON.stringify({ type, data: data })
        });
    }

    console.log(`[Command] Sent Binary to ${vehicleId}: ${type}(${fieldNumber})=${data} (QoS 2)`);
};

module.exports = { handleMqttMessage, sendCommand };