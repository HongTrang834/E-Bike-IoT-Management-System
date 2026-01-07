const redisClient = require('../config/redis');
const db = require('../config/db');

const handleMqttMessage = async (topic, message) => {
    try{
    const topicParts = topic.split('/');
    const vehicleId = topicParts[1];
    const dataType = topicParts[2];
    let data;
    try{
        data = JSON.parse(message.toString());
    }catch(err){
        console.error('Invalid JSON format:', err.message);
        return;
    }

    if (!data) {    
        console.error('Empty data received');
        return;
    }
    else if(typeof data !== 'object'){
        console.error('Data is not an object');
        return;
    }

    // 1 & 2. Telemetry & Status & cmd -> save to Redis 
    if (dataType === 'telemetry' || dataType === 'status' || dataType ==='cmd') {
        const rediskey = `vehicle:stream:${vehicleId}`;
        await redisClient.hSet(rediskey, {
            "vehicle_id": vehicleId,
            [dataType]: JSON.stringify(data),
        });
    } 
    // 3. Location -> save to DB if changed
    else if (dataType === 'location') {
        const {lat, lon, heading} = data;
        if (lat == undefined || lon == undefined) {
            console.error('Invalid location data');
            return;
        }
        const redisKey = `vehicle:last_location:${vehicleId}`;

        // get old location from redis
        const lastLoc = await redisClient.hGetAll(redisKey);

            // compare and save
            if (lat != lastLoc.lat || lon != lastLoc.lon || heading != lastLoc.heading) {
                // save to DB 
                const query = 'INSERT INTO location_log (time, vehicle_id, lat, lon, heading) VALUES (NOW(), $1, $2, $3, $4)';
                await db.query(query, [vehicleId, lat, lon, heading || 0]);

                // update last location in Redis for next comparison
                await redisClient.hSet(redisKey, { lat, lon, heading: heading || 0 });
                console.log(`Updated location for ${vehicleId}`);
            }
    }
    // 4. Event -> Lưu vào DB (
    else if (dataType === 'event') {
            const name = data.name;
            const type = data.type;
            const value = data.value;
            const redisKey = `vehicle:last_event:${vehicleId}`;
            
            const lastEvent = await redisClient.hGetAll(redisKey);

            if (name != lastEvent.name || type != lastEvent.type || value != lastEvent.value) {
                const query = 'INSERT INTO event_log (time, vehicle_id, name, type, value) VALUES (NOW(), $1, $2, $3, $4)';
                await db.query(query, [vehicleId, name, type, value]);

                await redisClient.hSet(redisKey, { name, type, value });
                console.log(` New event recorded for ${vehicleId}`);
            }
        }
    
    } catch (error) {
        console.error('Error when handling MQTT message:', error.message);
    }
};

// 5. Command (Gửi từ Server tới Vehicle)
const sendCommand = async (mqttClient, vehicleId, type, value) => {
    const topic = `bike/${vehicleId}/cmd`;
    const payload = JSON.stringify({ type, data: value });
    // server publish topic to Broker 
    mqttClient.publish(topic, payload, { qos: 2 });

    //save to redis 
    const redisKey = `vehicle:stream:${vehicleId}`;
    await redisClient.hSet(redisKey, {
        "vehicle_id": vehicleId,
        "cmd": payload,
    });
    console.log(`Sent command and updated Redis for vehicle ${vehicleId}`);

};

module.exports = { handleMqttMessage, sendCommand };