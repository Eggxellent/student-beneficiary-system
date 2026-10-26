import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'field_officer' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadUsers = useCallback(async () => {
    try { setUsers((await api.get('/users')).data); }
    catch (err) { setError(err.response?.data?.message || 'Could not load user accounts.'); }
  }, []);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function createUser(event) {
    event.preventDefault(); setError(''); setNotice('');
    try {
      await api.post('/users', form);
      setForm({ full_name: '', email: '', password: '', role: 'field_officer' });
      setNotice('Account created.'); await loadUsers();
    } catch (err) { setError(err.response?.data?.message || 'Could not create account.'); }
  }

  async function changeRole(user, role) {
    setError(''); setNotice('');
    try { await api.patch(`/users/${user.id}/role`, { role }); setNotice(`Updated ${user.full_name}'s role.`); await loadUsers(); }
    catch (err) { setError(err.response?.data?.message || 'Could not update role.'); }
  }

  return <div className="mx-auto max-w-6xl p-5 sm:p-8">
    <h1 className="text-2xl font-bold">User management</h1>
    {error && <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    <form onSubmit={createUser} className="mt-5 grid gap-3 rounded border bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-xs font-medium">Name<input required minLength={2} value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} className="mt-1 h-10 w-full border px-2 text-sm" /></label>
      <label className="text-xs font-medium">Email<input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="mt-1 h-10 w-full border px-2 text-sm" /></label>
      <label className="text-xs font-medium">Temporary password<input required minLength={8} type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="mt-1 h-10 w-full border px-2 text-sm" /></label>
      <label className="text-xs font-medium">Role<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="mt-1 h-10 w-full border px-2 text-sm"><option value="field_officer">Field Officer</option><option value="admin">Admin</option></select></label>
      <button className="self-end rounded bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white">Create account</button>
    </form>
    <div className="mt-5 overflow-x-auto rounded border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Created</th></tr></thead><tbody className="divide-y">{users.map(user => <tr key={user.id}><td className="px-4 py-3 font-medium">{user.full_name}</td><td className="px-4 py-3">{user.email}</td><td className="px-4 py-3"><select aria-label={`Role for ${user.full_name}`} value={user.role} onChange={e => changeRole(user, e.target.value)} className="border px-2 py-1"><option value="field_officer">Field Officer</option><option value="admin">Admin</option></select></td><td className="px-4 py-3 text-xs">{new Date(user.created_at).toLocaleDateString()}</td></tr>)}</tbody></table>{users.length === 0 && <p className="p-5 text-sm text-slate-500">No accounts found.</p>}</div>
  </div>;
}
