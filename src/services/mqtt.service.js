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
                await redisClient.hSet(redisKey, { lat: lat.toString(), 
                lon: lon.toString(), 
                heading: heading.toString() });
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
    await redisClient.hSet(redisStreamKey, {
        "vehicle_id": vehicleId,
        [dataType]: JSON.stringify(decodedData)
    });

    // PUSH DATA TO WEBSOCKET 
    if (global.activeSockets && global.activeSockets.size > 0) {
        const messagePayload = JSON.stringify({
            type: dataType, // telemetry, status, hoặc location
            data: decodedData
        });

        // Lặp qua các socket đang active để tìm user sở hữu xe này
        for (let [email, ws] of global.activeSockets) {
            // Lấy vehicle_id mà user này quản lý từ Redis
            const userVehicleId = await redisClient.hGet(`user:token:${email}`, 'vehicle_id');
            
            if (userVehicleId === vehicleId) {
                ws.send(messagePayload); // Gửi Text frame (Opcode 0x1/81)
                console.log(`[WS Push] Sent ${dataType} to ${email}`);
            }
        }
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

    const buffer = Buffer.alloc(4);
    buffer.writeInt16LE(type, 0);    // H - 2 bytes
    buffer.writeInt16LE(data, 2);   // H - 2 bytes
    mqttClient.publish(topic, buffer, { qos: 2 });

    const redisKey = `vehicle:stream:${vehicleId}`;
    await redisClient.hSet(redisKey, {
        "vehicle_id": vehicleId,
        "cmd": JSON.stringify({ type, data: data})   
    });
    console.log(`[Command] Sent Binary to ${vehicleId}: Type ${type}, Data ${data}`);
};

module.exports = { handleMqttMessage, sendCommand };