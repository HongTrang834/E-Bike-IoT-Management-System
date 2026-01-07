const mqtt = require('mqtt');

const client = mqtt.connect(`mqtt://${process.env.MQTT_HOST || 'localhost'}:1883`);

client.on('connect', () => {
    console.log('Connected to MQTT Broker');
    // Đăng ký lắng nghe tất cả các xe
    client.subscribe('bike/+/telemetry');
    client.subscribe('bike/+/status');
    client.subscribe('bike/+/location');
    client.subscribe('bike/+/event', { qos: 2 });
});

module.exports = client;