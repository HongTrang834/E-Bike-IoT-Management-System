const redis = require('redis');
require('dotenv').config();
const redisClient = redis.createClient({
    url:`redis://${process.env.REDIS_HOST || '127.0.0.1'}:6379`
});

redisClient.on(`error`, (err)=> console.log(`Redis Client Error`, err));

(async () => {
    await redisClient.connect();
    console.log('Connected to Redis');
})();

module.exports = redisClient;