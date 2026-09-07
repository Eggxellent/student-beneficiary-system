import { useEffect, useState } from 'react';
import axios from 'axios';

function App() {
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios
      .get('/api/beneficiaries')
      .then((res) => setBeneficiaries(res.data))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="app">
      <h1>Student Beneficiaries</h1>
      {error && <p className="error">{error}</p>}
      <ul>
        {beneficiaries.map((b) => (
          <li key={b.id}>
            {b.name} — {b.school} ({b.grade_level})
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;
