import { BrowserRouter as Router } from 'react-router-dom';
import InnerApp from './InnerApp';
import { AuthProvider } from './contexts/AuthContext';

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <InnerApp />
      </AuthProvider>
    </Router>
  );
}