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


const login = async (user_name, password, ipAddress = '') => {

  const query = `
    SELECT email, user_name, password, vehicle_id 
    FROM "accounts" 
    WHERE user_name = $1 
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

  const accessToken = `access_v1_${Date.now()}`;
  const refreshToken = `refresh_v1_${Date.now()}`;
  const expiresIn = 3600;

  const sessionData = {
    'email': user.email,
    'user_name': user.user_name,
    'vehicle_id': user.vehicle_id ? user.vehicle_id.toString() : '',
    'token': accessToken,
    'refresh_token': refreshToken,
    'lasttime_token': Date.now().toString(),
    'last_ip': ipAddress
  };

  await redisClient.hSet(`user:token:${accessToken}`, sessionData);
  await redisClient.expire(`user:token:${accessToken}`, expiresIn);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn
  };
};

// xử lí add vehicle 
const addVehicle = async (token, vehicleData) => {
  const { vehicle_id, vehicle_name } = vehicleData;

  const sessionKey = `user:token:${token}`;
  const sessionData = await redisClient.hGetAll(sessionKey);
  if (Object.keys(sessionData).length === 0) {
    const error = new Error("Missing or invalid token");
    error.statusCode = 401;
    throw error;
  }
  const email = sessionData.email;

  // 2. Kiểm tra xem xe có tồn tại trong db vehicles không
  const vehicleCheck = await db.query(
    'SELECT vehicle_id FROM vehicles WHERE vehicle_id = $1',
    [vehicle_id]
  );
  if (vehicleCheck.rows.length === 0) {
    const error = new Error("Vehicle not found");
    error.statusCode = 404;
    throw error;
  }

  // 3. Kiểm tra xem xe này đã được người khác add chưa
  const ownershipCheck = await db.query(
    'SELECT * FROM user_vehicle_mapping WHERE vehicle_id = $1',
    [vehicle_id]
  );
  if (ownershipCheck.rows.length > 0) {
    const error = new Error("Vehicle ID already exists");
    error.statusCode = 409;
    throw error;
  }

  // 4. insert into user_vehicle_mapping
  await db.query(
    'INSERT INTO user_vehicle_mapping (email, vehicle_id, vehicle_name) VALUES ($1, $2, $3)',
    [email, vehicle_id, vehicle_name]
  );

  // 5. Tự động set xe này làm xe mặc định (Active)
  await db.query('UPDATE accounts SET vehicle_id = $1 WHERE email = $2', [vehicle_id, email]);

  // Cập nhật lại vehicle_id trong Redis session
  await redisClient.hSet(sessionKey, 'vehicle_id', vehicle_id.toString());
  console.log(`[Add Vehicle] User ${email} added vehicle ${vehicle_id}`);
  return;

};


// xử lí chọn xe 
const selectVehicle = async (token, vehicleId) => {
  // 1. Lấy session từ Redis
  const sessionKey = `user:token:${token}`;
  const sessionData = await redisClient.hGetAll(sessionKey);

  if (Object.keys(sessionData).length === 0) {
    throw { statusCode: 401, message: "Missing or invalid token" };
  }
  const email = sessionData.email;

  // 2. Kiểm tra xe này có thuộc về user không
  const mappingCheck = await db.query(
    'SELECT * FROM user_vehicle_mapping WHERE email = $1 AND vehicle_id = $2',
    [email, vehicleId]
  );

  if (mappingCheck.rows.length === 0) {
    throw { statusCode: 403, message: "Access denied" };
  }

  // 3. Cập nhật vào DB accounts
  await db.query('UPDATE accounts SET vehicle_id = $1 WHERE email = $2', [vehicleId, email]);

  // 4. Cập nhật vào Redis Session để WS nhận diện ngay
  await redisClient.hSet(sessionKey, 'vehicle_id', vehicleId.toString());

  return;
};

// xử lí lấy thông tin process của user 
const getUserInfo = async (token) => {

  const sessionKey = `user:token:${token}`;
  const sessionData = await redisClient.hGetAll(sessionKey);

  if (Object.keys(sessionData).length === 0) {
    throw { statusCode: 401, message: "Missing or invalid token" };
  }

  const email = sessionData.email;

  const userQuery = `
    SELECT 
      email,
      phone_number AS phone_num,
      user_name,
      gender,
      region,
      setting_darkmode AS dark_mode,
      setting_sound AS sound,
      setting_language AS lang
    FROM accounts
    WHERE email = $1
  `;
  const userResult = await db.query(userQuery, [email]);

  if (userResult.rows.length === 0) {
    throw { statusCode: 404, message: "User not found" };
  }

  const userInfo = userResult.rows[0];

  const bikeQuery = `
    SELECT vehicle_name AS name, vehicle_id
    FROM user_vehicle_mapping
    WHERE email = $1
  `;
  const bikeResult = await db.query(bikeQuery, [email]);

  return {
    email: userInfo.email,
    phone_num: userInfo.phone_num,
    user_name: userInfo.user_name,
    gender: userInfo.gender,
    region: userInfo.region,
    setting: {
      dark_mode: userInfo.dark_mode,
      sound: userInfo.sound,
      lang: userInfo.lang
    },
    bike_list: bikeResult.rows
  };
};

// xử lí lấy lịch sử vị trí
const getLocationHistory = async (token, startTimeStr, stopTimeStr) => {
  // 1. Kiểm tra token
  const sessionKey = `user:token:${token}`;
  const sessionData = await redisClient.hGetAll(sessionKey);

  if (Object.keys(sessionData).length === 0) {
    throw { statusCode: 401, message: "Missing or invalid token" };
  }

  // 2. Chuẩn hóa thời gian
  const startTime = new Date(startTimeStr);
  const stopTime = new Date(stopTimeStr);
  if (isNaN(startTime.getTime()) || isNaN(stopTime.getTime())) {
    throw { statusCode: 400, message: "start_time and stop_time must be valid ISO 8601" };
  }

  // 3. Lấy vehicle_id đang chọn từ accounts
  const accountResult = await db.query('SELECT vehicle_id FROM accounts WHERE email = $1', [sessionData.email]);
  if (accountResult.rows.length === 0 || !accountResult.rows[0].vehicle_id) {
    throw { statusCode: 404, message: "Vehicle not found" };
  }
  const vehicleIdRaw = accountResult.rows[0].vehicle_id;
  const vehicleId = Number(vehicleIdRaw);
  if (!Number.isFinite(vehicleId)) {
    throw { statusCode: 404, message: "Vehicle not found" };
  }

  // 4. Query dữ liệu location trong khoảng thời gian
  const locationQuery = `
    SELECT lat, lon
    FROM location_log
    WHERE vehicle_id = $1
      AND "time" BETWEEN $2 AND $3
    ORDER BY "time" ASC
  `;

  const locationResult = await db.query(locationQuery, [vehicleId, startTime.toISOString(), stopTime.toISOString()]);

  // 5. Trả về mảng JSON (có thể rỗng nếu không có dữ liệu)
  return locationResult.rows;
};

// xử lí lấy lịch sử event
const getEventHistory = async (token, sinceTimeStr) => {
  // 1. Kiểm tra token
  const sessionKey = `user:token:${token}`;
  const sessionData = await redisClient.hGetAll(sessionKey);

  if (Object.keys(sessionData).length === 0) {
    throw { statusCode: 401, message: "Missing or invalid token" };
  }

  // 2. Chuẩn hóa thời gian
  const sinceTime = new Date(sinceTimeStr);
  if (isNaN(sinceTime.getTime())) {
    throw { statusCode: 400, message: "since must be valid ISO 8601" };
  }

  // 3. Lấy vehicle_id đang chọn từ accounts
  const accountResult = await db.query('SELECT vehicle_id FROM accounts WHERE email = $1', [sessionData.email]);
  if (accountResult.rows.length === 0 || !accountResult.rows[0].vehicle_id) {
    throw { statusCode: 404, message: "Vehicle not found" };
  }
  const vehicleIdRaw = accountResult.rows[0].vehicle_id;
  const vehicleId = Number(vehicleIdRaw);
  if (!Number.isFinite(vehicleId)) {
    throw { statusCode: 404, message: "Vehicle not found" };
  }

  // 4. Query dữ liệu event từ thời điểm since, limit 20
  const eventQuery = `
    SELECT "time", name, type, value
    FROM event_log
    WHERE vehicle_id = $1
      AND "time" >= $2
    ORDER BY "time" DESC
    LIMIT 20
  `;

  const eventResult = await db.query(eventQuery, [vehicleId, sinceTime.toISOString()]);

  // 5. Decode name và type 
  const nameMapping = {
    0: 'one',
    1: 'theft',
    2: 'crash',
    3: 'overtemp',
    11: 'low_soc',
    12: 'dtc',
    21: 'lock_on',
    22: 'lock_off',
    23: 'horn',
    24: 'vehicle_packed',
    25: 'vehicle_stand',
    26: 'vehicle_reverse'
  };

  const typeMapping = {
    0: 'Information',
    1: 'Warning',
    2: 'Error'
  };

  const decodedEvents = eventResult.rows.map(row => ({
    time: row.time,
    name: nameMapping[row.name] || row.name,
    type: typeMapping[row.type] || row.type,
    value: row.value ? row.value.trim() : row.value
  }));

  return decodedEvents;
};

// xử lí lấy thông tin chi tiết xe
const getVehicleInfo = async (token) => {
  const sessionKey = `user:token:${token}`;
  const sessionData = await redisClient.hGetAll(sessionKey);

  if (Object.keys(sessionData).length === 0) {
    throw { statusCode: 401, message: "Missing or invalid token" };
  }

  const accountResult = await db.query('SELECT vehicle_id FROM accounts WHERE email = $1', [sessionData.email]);
  if (accountResult.rows.length === 0 || !accountResult.rows[0].vehicle_id) {
    throw { statusCode: 404, message: "Vehicle not found" };
  }

  const vehicleId = accountResult.rows[0].vehicle_id;

  const vehicleQuery = `
    SELECT 
      model,
      color,
      model AS bike_name,
      battery_voltage,
      battery_capacity,
      max_range
    FROM vehicles
    WHERE vehicle_id = $1
    LIMIT 1
  `;

  const vehicleResult = await db.query(vehicleQuery, [vehicleId]);

  if (vehicleResult.rows.length === 0) {
    throw { statusCode: 404, message: "Vehicle not found" };
  }

  return vehicleResult.rows[0];
};

// xử lí xóa xe khỏi danh sách user
const deleteVehicle = async (token, vehicleId) => {

  const sessionKey = `user:token:${token}`;
  const sessionData = await redisClient.hGetAll(sessionKey);
  if (Object.keys(sessionData).length === 0) {
    throw { statusCode: 401, message: "Missing or invalid token" };
  }
  const email = sessionData.email;

  const mappingCheck = await db.query(
    'SELECT vehicle_name FROM user_vehicle_mapping WHERE email = $1 AND vehicle_id = $2',
    [email, vehicleId]
  );
  if (mappingCheck.rows.length === 0) {
    throw { statusCode: 404, message: "Vehicle not found" };
  }

  await db.query(
    'DELETE FROM user_vehicle_mapping WHERE email = $1 AND vehicle_id = $2',
    [email, vehicleId]
  );

  const accountResult = await db.query('SELECT vehicle_id FROM accounts WHERE email = $1', [email]);
  if (accountResult.rows.length === 0) {
    throw { statusCode: 404, message: "Vehicle not found" };
  }

  const currentVehicleId = accountResult.rows[0].vehicle_id;

  if (currentVehicleId && currentVehicleId.toString() === vehicleId.toString()) {

    const nextResult = await db.query(
      'SELECT vehicle_id FROM user_vehicle_mapping WHERE email = $1 ORDER BY vehicle_id ASC LIMIT 1',
      [email]
    );

    const nextVehicleId = nextResult.rows.length > 0 ? nextResult.rows[0].vehicle_id : null;

    await db.query('UPDATE accounts SET vehicle_id = $1 WHERE email = $2', [nextVehicleId, email]);

    await redisClient.hSet(sessionKey, 'vehicle_id', nextVehicleId ? nextVehicleId.toString() : '');
  }

  return;
};

// xử lí quên mật khẩu
const forgotPassword = async (email) => {

  const accountCheck = await db.query('SELECT email FROM accounts WHERE email = $1', [email]);
  if (accountCheck.rows.length === 0) {
    throw { statusCode: 404, message: "Account do not exist" };
  }

  const verifyCode = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');

  await db.query('UPDATE accounts SET verify_code = $1 WHERE email = $2', [verifyCode, email]);

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Password Reset Code',
    html: `<h3>Your password reset code is:</h3><p><strong>${verifyCode}</strong></p><p>This code will expire in 15 minutes.</p>`
  };

  await transporter.sendMail(mailOptions);

  return;
};

// xử lí xác nhận verify code và đổi mật khẩu
const verifyCode = async (email, newPassword, verifyCode) => {
  const accountCheck = await db.query(
    'SELECT email, verify_code FROM accounts WHERE email = $1',
    [email]
  );

  if (accountCheck.rows.length === 0) {
    throw { statusCode: 404, message: "Account do not exist" };
  }

  // 2. So sánh verify_code
  const storedCode = accountCheck.rows[0].verify_code;
  if (storedCode !== verifyCode) {
    throw { statusCode: 404, message: "Verify code not true" };
  }

  // 3. Hash mật khẩu mới
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  // 4. Cập nhật password và clear verify_code
  await db.query(
    'UPDATE accounts SET password = $1, verify_code = NULL WHERE email = $2',
    [hashedPassword, email]
  );

  console.log(`[Verify Code] Password changed for ${email}`);
  return;
};

// xử lí đổi mật khẩu (cho user đã đăng nhập)
const changePassword = async (token, newPassword) => {
  // 1. Kiểm tra token
  const sessionKey = `user:token:${token}`;
  const sessionData = await redisClient.hGetAll(sessionKey);

  if (Object.keys(sessionData).length === 0) {
    throw { statusCode: 401, message: "Missing or invalid token" };
  }

  const email = sessionData.email;

  // 2. Hash mật khẩu mới
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  // 3. Cập nhật password vào DB
  await db.query(
    'UPDATE accounts SET password = $1 WHERE email = $2',
    [hashedPassword, email]
  );

  console.log(`[Change Password] Password updated for ${email}`);
  return;
};

// xử lí đăng xuất
const logout = async (token) => {
  // 1. Kiểm tra token
  const sessionKey = `user:token:${token}`;
  const sessionData = await redisClient.hGetAll(sessionKey);

  if (Object.keys(sessionData).length === 0) {
    throw { statusCode: 401, message: "Missing or invalid token" };
  }

  // 2. Xóa session khỏi Redis
  await redisClient.del(sessionKey);

  console.log(`[Logout] User logged out: ${sessionData.email}`);
  return;
};

// xử lí cập nhật cài đặt tài khoản
const updateAccountSetting = async (token, settingData) => {
  // 1. Kiểm tra token
  const sessionKey = `user:token:${token}`;
  const sessionData = await redisClient.hGetAll(sessionKey);

  if (Object.keys(sessionData).length === 0) {
    throw { statusCode: 401, message: "Missing or invalid token" };
  }

  const email = sessionData.email;
  const { phone_num, user_name, gender, region, setting } = settingData;

  // 2. Validate setting object
  if (!setting.hasOwnProperty('dark_mode') || !setting.hasOwnProperty('sound') || !setting.lang) {
    throw { statusCode: 400, message: "Setting object must contain dark_mode, sound, and lang" };
  }

  // 3. Cập nhật tất cả thông tin vào accounts table
  const updateQuery = `
    UPDATE accounts
    SET 
      phone_number = $1,
      user_name = $2,
      gender = $3,
      region = $4,
      setting_darkmode = $5,
      setting_sound = $6,
      setting_language = $7
    WHERE email = $8
  `;

  await db.query(updateQuery, [
    phone_num,
    user_name,
    gender,
    region,
    setting.dark_mode,
    setting.sound,
    setting.lang,
    email
  ]);

  console.log(`[Account Setting] Settings updated for ${email}`);
  return;
};

module.exports = { signup, login, addVehicle, selectVehicle, getUserInfo, getLocationHistory, getEventHistory, getVehicleInfo, deleteVehicle, forgotPassword, verifyCode, changePassword, logout, updateAccountSetting };