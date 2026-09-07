import { useEffect, useState } from 'react';
import axios from 'axios';

function App() {
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [formData, setFormData] = useState({
    name: '',
    school: '',
    grade_level: '',
    scholarship_amount: '',
  });

  const fetchBeneficiaries = () => {
    axios
      .get('/api/beneficiaries')
      .then((res) => setBeneficiaries(res.data))
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    fetchBeneficiaries();
  }, []);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const resetForm = () => {
    setFormData({ name: '', school: '', grade_level: '', scholarship_amount: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const data = {
        ...formData,
        scholarship_amount: Number(formData.scholarship_amount),
    };

    const request = editingId
      ? axios.put(`/api/beneficiaries/${editingId}`, data)
      : axios.post('/api/beneficiaries', data);

    request.then(() => {
      resetForm();
      fetchBeneficiaries();
    }).catch((err) => setError(err.message));
  };

  const handleEdit = (beneficiary) => {
    setFormData({
      name: beneficiary.name,
      school: beneficiary.school || '',
      grade_level: beneficiary.grade_level || '',
      scholarship_amount: beneficiary.scholarship_amount || '',
    });
    setEditingId(beneficiary.id);
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (!window.confirm('Are you sure you want to delete this beneficiary?')) return;

    axios.delete(`/api/beneficiaries/${id}`)
      .then(() => fetchBeneficiaries())
      .catch((err) => setError(err.message));
  };

  return (
    <div className="app">
      <header>
        <h1>Student Beneficiary Management System</h1>
        <p>Manage student beneficiaries and scholarship information</p>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="card">
        <div className="section-header">
          <h2>Beneficiaries</h2>

          <button onClick={() => showForm ? resetForm() : setShowForm(true)}>
            {showForm ? 'Cancel' : 'Add Beneficiary'}
          </button>
        </div>

        {showForm && (
          <form className="beneficiary-form" onSubmit={handleSubmit}>
            <h3>{editingId ? 'Edit Beneficiary' : 'Add Beneficiary'}</h3>
            <input
              type="text"
              name="name"
              placeholder="Student Name"
              value={formData.name}
              onChange={handleChange}
              required
            />

            <input
              type="text"
              name="school"
              placeholder="School"
              value={formData.school}
              onChange={handleChange}
              required
            />

            <input
              type="text"
              name="grade_level"
              placeholder="Grade / Year"
              value={formData.grade_level}
              onChange={handleChange}
              required
            />

            <input
              type="number"
              name="scholarship_amount"
              placeholder="Scholarship Amount"
              value={formData.scholarship_amount}
              onChange={handleChange}
              min="0"
              required
            />

            <button type="submit">
              {editingId ? 'Update Beneficiary' : 'Save Beneficiary'}
            </button>
          </form>
        )}

        {beneficiaries.length === 0 ? (
          <p>No beneficiaries found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>School</th>
                <th>Grade Level</th>
                <th>Scholarship</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {beneficiaries.map((b) => (
                <tr key={b.id}>
                  <td>{b.id}</td>
                  <td>{b.name}</td>
                  <td>{b.school}</td>
                  <td>{b.grade_level}</td>
                  <td>KSh {Number(b.scholarship_amount).toLocaleString()}</td>
                  <td className="actions">
                    <button className="edit-btn" onClick={() => handleEdit(b)}>Edit</button>
                    <button className="delete-btn" onClick={() => handleDelete(b.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default App;
