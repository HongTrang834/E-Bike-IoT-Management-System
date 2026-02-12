const redisClient = require('../config/redis');

const authenticate = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).send("Missing or invalid token");

    const sessionData = await redisClient.hGetAll(`user:token:${token}`);
    if (Object.keys(sessionData).length === 0) {
        return res.status(401).send("Missing or invalid token");
    }

    req.user = sessionData;
    req.token = token;
    next();
};

module.exports = authenticate;