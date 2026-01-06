const db = require('../config/db');
const redisClient = require('../config/redis');
const bcrypt = require('bcrypt');

const signup = async (userData) => {
  const { email, user_name, password } = userData;

  // 1. Check account exist
  const userExist = await db.query('SELECT email FROM accounts WHERE email = $1', [email]);
  if (userExist.rows.length > 0) {
    const error = new Error("Account already exists");
    error.statusCode = 409;
    throw error;
  }

  // 2. hash password    
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // 3. Save to DB
  const query = 'INSERT INTO accounts (email, user_name, password) VALUES ($1, $2, $3) RETURNING email, user_name';
  const result = await db.query(query, [email, user_name, hashedPassword]);
  
  return result.rows[0];
};

const login = async (user_name, password) => {
  const result = await db.query('SELECT * FROM accounts WHERE user_name = $1', [user_name]);
  
  if (result.rows.length === 0) {
    const error = new Error("Missing or invalid token"); 
    error.statusCode = 401;
    throw error;
  }

  const user = result.rows[0];

  // so sanh mat khau 
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    const error = new Error("Missing or invalid token");
    error.statusCode = 401;
    throw error;
  }

  const accessToken = `access_v1_${Date.now()}`;
  const refreshToken = `refresh_v1_${Date.now()}`;
  const expiresIn = 3600; // 1 giờ

  // Lưu vào Redis
  await redisClient.setEx(`session:${accessToken}`, expiresIn, user.user_name);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn
  };
};
module.exports = { signup, login };