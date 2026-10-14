const pool = require('../config/db');
const Disbursement = require('../models/disbursement.model');
const logAudit = require('../services/auditLog');

async function create(req, res, next) {
  try {
    const { student_id, amount, disbursement_date } = req.body;
    if (!student_id || amount === undefined) {
      return res.status(400).json({
        message: 'student_id and amount are required'
      });
    }

    if (Number(amount) <= 0 || Number.isNaN(Number(amount))) {
      return res.status(400).json({
        message: 'Amount must be greater than zero'
      });
    }

    const student = await pool.query(
      `SELECT id, full_name
       FROM students
       WHERE id = $1`,
      [student_id]
    );
    if (student.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const unresolved = await pool.query(
      `SELECT id, status, probability
       FROM duplicate_flags
       WHERE (student_id = $1 OR matched_student_id = $1)
       AND status IN ('pending', 'confirmed_duplicate')
       LIMIT 1`,
      [student_id]
    );
    if (unresolved.rows.length > 0) {
      return res.status(409).json({
        message: 'Disbursement blocked because this student has a duplicate issue',
        duplicate_flag: unresolved.rows[0],
      });
    }

    const disbursement = await Disbursement.create({
      student_id,
      amount: Number(amount),
      disbursement_date,
      created_by: req.user.id || req.user.sub,
    });
    await logAudit(req.user.id || req.user.sub, 'CREATE_DISBURSEMENT', 'disbursements', disbursement.id);
    res.status(201).json({ message: 'Disbursement created successfully', disbursement });
  } catch (error) {
    next(error);
  }
}

async function list(req, res, next) {
  try {
    res.json(await Disbursement.getAll());
  } catch (error) {
    next(error);
  }
}

module.exports = { create, list };
