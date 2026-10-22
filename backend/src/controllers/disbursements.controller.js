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

    const client = await pool.connect();
    let disbursement;
    try {
      await client.query('BEGIN');
      const student = await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [student_id]);
      if (student.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Student not found' });
      }
      const unresolved = await client.query(
        `SELECT id, status, probability
         FROM duplicate_flags
         WHERE (student_id = $1 OR matched_student_id = $1)
           AND status IN ('pending', 'needs_verification', 'confirmed_duplicate')
         ORDER BY created_at DESC
         LIMIT 1`,
        [student_id]
      );
      if (unresolved.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: 'Disbursement is paused while an authorized reviewer resolves a potential duplicate case',
          duplicate_flag: unresolved.rows[0],
        });
      }
      disbursement = await Disbursement.create({
        student_id,
        amount: Number(amount),
        disbursement_date,
        created_by: req.user.id || req.user.sub,
      }, client);
      await logAudit(req.user.id || req.user.sub, 'CREATE_DISBURSEMENT', 'disbursements', disbursement.id, null, client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
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
