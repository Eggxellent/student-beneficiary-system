const studentModel = require('../models/student.model');
const pool = require('../config/db');
const logAudit = require('../services/auditLog');
const { checkDuplicate, jaroWinkler } = require('../services/duplicateCheck');

function dateValue(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().split('T')[0] : String(value).slice(0, 10);
}

async function create(req, res, next) {
  try {
    const { full_name, date_of_birth, school_code, guardian_id } = req.body;
    if (!full_name) return res.status(400).json({ message: 'Full name is required' });

    const { rows: candidates } = await pool.query(
      'SELECT * FROM students ORDER BY created_at DESC LIMIT 1000'
    );
    const duplicateResults = [];
    for (const candidate of candidates) {
      const similarity = jaroWinkler(full_name, candidate.full_name);
      if (similarity < 0.70) continue;
      const result = await checkDuplicate({
        jaro_winkler: similarity,
        dob_match: Number(dateValue(date_of_birth) === dateValue(candidate.date_of_birth)),
        school_match: Number(Boolean(school_code && school_code === candidate.school_code)),
        guardian_match: Number(Boolean(guardian_id && guardian_id === candidate.guardian_id)),
      });
      duplicateResults.push({ candidate, probability: result.probability });
    }

    const student = await studentModel.create({ full_name, date_of_birth, school_code, guardian_id });
    const flags = [];
    for (const result of duplicateResults) {
      if (result.probability >= 0.70) {
        const { rows } = await pool.query(
          `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status)
           VALUES ($1, $2, $3, 'pending') RETURNING *`,
          [student.id, result.candidate.id, result.probability]
        );
        flags.push(rows[0]);
      }
    }

    await logAudit(req.user.id || req.user.sub, 'CREATE', 'students', student.id);
    res.status(201).json({ message: 'Student registered successfully', student, duplicate_flags: flags });
  } catch (error) {
    next(error);
  }
}

async function list(req, res, next) {
  try { res.json(await studentModel.getAll()); } catch (error) { next(error); }
}

async function get(req, res, next) {
  try {
    const student = await studentModel.getById(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json(student);
  } catch (error) { next(error); }
}

module.exports = { create, list, get };
