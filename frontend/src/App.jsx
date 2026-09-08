import { useEffect, useState } from 'react';
import axios from 'axios';

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('sbms_token'));
  const [loginData, setLoginData] = useState({ email: 'admin@sbms.com', password: 'Admin123!' });
  const [loginError, setLoginError] = useState(null);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activePage, setActivePage] = useState('dashboard');
  const [formData, setFormData] = useState({ name: '', school: '', grade_level: '', scholarship_amount: '' });

  const authConfig = () => ({ headers: { Authorization: `Bearer ${token}` } });

  const handleLogout = () => {
    localStorage.removeItem('sbms_token');
    setToken(null);
    setBeneficiaries([]);
  };

  const fetchBeneficiaries = () => {
    axios.get('/api/beneficiaries', authConfig())
      .then((res) => setBeneficiaries(res.data))
      .catch((err) => {
        if (err.response?.status === 401) handleLogout();
        setError(err.response?.data?.message || err.message);
      });
  };

  useEffect(() => {
    if (token) fetchBeneficiaries();
  }, [token]);

  const handleLogin = (event) => {
    event.preventDefault();
    setLoginError(null);
    axios.post('/api/auth/login', loginData)
      .then((res) => {
        localStorage.setItem('sbms_token', res.data.token);
        setToken(res.data.token);
      })
      .catch((err) => setLoginError(err.response?.data?.message || 'Login failed'));
  };

  const resetForm = () => {
    setFormData({ name: '', school: '', grade_level: '', scholarship_amount: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const data = { ...formData, scholarship_amount: Number(formData.scholarship_amount) };
    const request = editingId
      ? axios.put(`/api/beneficiaries/${editingId}`, data, authConfig())
      : axios.post('/api/beneficiaries', data, authConfig());
    request.then(() => { resetForm(); fetchBeneficiaries(); })
      .catch((err) => setError(err.response?.data?.message || err.message));
  };

  const handleDelete = (id) => {
    if (!window.confirm('Are you sure you want to delete this beneficiary?')) return;
    axios.delete(`/api/beneficiaries/${id}`, authConfig())
      .then(() => fetchBeneficiaries())
      .catch((err) => setError(err.response?.data?.message || err.message));
  };

  if (!token) {
    return (
      <main className="login-page">
        <form className="login-card" onSubmit={handleLogin}>
          <h1>SBMS</h1>
          <p>Sign in to manage student beneficiaries.</p>
          {loginError && <p className="error">{loginError}</p>}
          <input type="email" value={loginData.email} onChange={(e) => setLoginData({ ...loginData, email: e.target.value })} placeholder="Email" required />
          <input type="password" value={loginData.password} onChange={(e) => setLoginData({ ...loginData, password: e.target.value })} placeholder="Password" required />
          <button type="submit">Sign in</button>
        </form>
      </main>
    );
  }

  const filteredBeneficiaries = beneficiaries.filter((beneficiary) => {
    const search = searchTerm.toLowerCase();
    return beneficiary.name.toLowerCase().includes(search) || beneficiary.school.toLowerCase().includes(search) || beneficiary.grade_level.toLowerCase().includes(search);
  });
  const totalScholarship = beneficiaries.reduce((total, beneficiary) => total + Number(beneficiary.scholarship_amount || 0), 0);
  const totalSchools = new Set(beneficiaries.map((beneficiary) => beneficiary.school)).size;

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>SBMS</h2>
        <p className="sidebar-subtitle">Student Management</p>
        <nav>
          <button className={activePage === 'dashboard' ? 'nav-btn active' : 'nav-btn'} onClick={() => setActivePage('dashboard')}>📊 Dashboard</button>
          <button className={activePage === 'beneficiaries' ? 'nav-btn active' : 'nav-btn'} onClick={() => setActivePage('beneficiaries')}>👨‍🎓 Beneficiaries</button>
        </nav>
        <button className="logout-btn" onClick={handleLogout}>Sign out</button>
      </aside>
      <main className="app">
        <header><h1>Student Beneficiary Management System</h1><p>Manage student beneficiaries and scholarship information</p></header>
        {error && <p className="error">{error}</p>}
        {activePage === 'dashboard' && <section className="dashboard-cards">
          <div className="stat-card"><div className="stat-icon">👨‍🎓</div><div><p>Total Beneficiaries</p><h2>{beneficiaries.length}</h2></div></div>
          <div className="stat-card"><div className="stat-icon">💰</div><div><p>Total Scholarships</p><h2>KSh {totalScholarship.toLocaleString()}</h2></div></div>
          <div className="stat-card"><div className="stat-icon">🏫</div><div><p>Schools</p><h2>{totalSchools}</h2></div></div>
        </section>}
        {activePage === 'beneficiaries' && <section className="card">
          <div className="section-header"><div><h2>Beneficiaries</h2><p>Currently registered students</p></div><div className="search-container"><input type="text" placeholder="Search beneficiaries..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />{searchTerm && <button className="clear-btn" onClick={() => setSearchTerm('')}>Clear</button>}</div><button onClick={() => (showForm ? resetForm() : setShowForm(true))}>{showForm ? 'Cancel' : 'Add Beneficiary'}</button></div>
          {showForm && <form className="beneficiary-form" onSubmit={handleSubmit}><h3>{editingId ? 'Edit Beneficiary' : 'Add Beneficiary'}</h3><input type="text" name="name" placeholder="Student Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required /><input type="text" name="school" placeholder="School" value={formData.school} onChange={(e) => setFormData({ ...formData, school: e.target.value })} required /><input type="text" name="grade_level" placeholder="Grade / Year" value={formData.grade_level} onChange={(e) => setFormData({ ...formData, grade_level: e.target.value })} required /><input type="number" name="scholarship_amount" placeholder="Scholarship Amount" value={formData.scholarship_amount} onChange={(e) => setFormData({ ...formData, scholarship_amount: e.target.value })} min="0" required /><button type="submit">{editingId ? 'Update Beneficiary' : 'Save Beneficiary'}</button></form>}
          {filteredBeneficiaries.length === 0 ? <p>{searchTerm ? 'No beneficiaries match your search.' : 'No beneficiaries found.'}</p> : <table><thead><tr><th>ID</th><th>Name</th><th>School</th><th>Grade Level</th><th>Scholarship</th><th>Actions</th></tr></thead><tbody>{filteredBeneficiaries.map((beneficiary) => <tr key={beneficiary.id}><td>{beneficiary.id}</td><td>{beneficiary.name}</td><td>{beneficiary.school}</td><td>{beneficiary.grade_level}</td><td>KSh {Number(beneficiary.scholarship_amount).toLocaleString()}</td><td className="actions"><button className="edit-btn" onClick={() => { setFormData({ name: beneficiary.name, school: beneficiary.school || '', grade_level: beneficiary.grade_level || '', scholarship_amount: beneficiary.scholarship_amount || '' }); setEditingId(beneficiary.id); setShowForm(true); }}>Edit</button><button className="delete-btn" onClick={() => handleDelete(beneficiary.id)}>Delete</button></td></tr>)}</tbody></table>}
        </section>}
      </main>
    </div>
  );
}

export default App;
