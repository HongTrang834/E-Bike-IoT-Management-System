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


const login = async (user_name, password, ipAddress = '') => { // Sau này phát triển thêm sẽ thay ipAdd vào đây,  hiện tại là rỗng 
  // 1. Lấy thông tin account và vehicle_id đang chọn (active) từ DB
  // Lưu ý: Query này join với bảng user_vehicle_mapping để lấy xe đang được chọn
  const query = `
    SELECT a.*, uv.vehicle_id 
    FROM accounts a
    LEFT JOIN user_vehicle_mapping uv ON a.email = uv.email 
    WHERE a.user_name = $1 
    LIMIT 1`;
  
  const result = await db.query(query, [user_name]);
  
  if (result.rows.length === 0) {
    const error = new Error("Missing or invalid token"); 
    error.statusCode = 401;
    throw error;
  }

  const user = result.rows[0];

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    const error = new Error("Missing or invalid token");
    error.statusCode = 401;
    throw error;
  }

  // 2. Tạo Token 
  const accessToken = `access_v1_${Date.now()}`;
  const refreshToken = `refresh_v1_${Date.now()}`;
  const expiresIn = 3600; 

  // 3. Lưu vào Redis theo cấu trúc Hash Set 
  const sessionData = {
    'email': user.email,
    'vehicle_id': user.vehicle_id || '', 
    'session': 'init',
    'lasttime_pong': Date.now().toString(),
    'token': accessToken,
    'lasttime_token': Date.now().toString(),
    'last_ip': ipAddress
  };

  // Sử dụng accessToken làm key để sau này WebSocket dễ tra cứu
  await redisClient.hSet(`user:token:${accessToken}`, sessionData);
  await redisClient.expire(`user:token:${accessToken}`, expiresIn); 

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn
  };
};
module.exports = { signup, login };