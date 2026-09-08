const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const Auth = require('../models/auth.model');

const registerSchema = z.object({
  full_name: z.string().trim().min(2).max(255),
  email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(72),
  role: z.string().trim().min(1).max(50).optional(),
});

async function register(req, res) {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid registration data', details: result.error.flatten() });
  }

  const { full_name, email, password, role = 'field_officer' } = result.data;
  const existingUser = await Auth.findByEmail(email);
  if (existingUser) {
    return res.status(409).json({ error: 'Email is already registered' });
  }

  const password_hash = await bcrypt.hash(password, 12);
  const user = await Auth.createUser({ full_name, email, password_hash, role });

  res.status(201).json({
    message: 'User registered successfully',
    user,
  });
}

async function login(req, res) {
  const result = z.object({
    email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
    password: z.string().min(1),
  }).safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = await Auth.findByEmail(result.data.email);
  if (!user || !(await bcrypt.compare(result.data.password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    message: 'Login successful',
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
    },
  });
}

module.exports = { register, login };
