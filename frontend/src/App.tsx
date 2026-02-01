import { Routes, Route } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { GamePage } from './pages/GamePage';
import { JoinPage } from './pages/JoinPage';
import { ProfilePage } from './pages/ProfilePage';
import { TestPage } from './pages/TestPage';
import { RematchPage } from './pages/RematchPage';
import { RequeuePage } from './pages/RequeuePage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';

function App() {
  return (
    <div className="min-h-screen">
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/requeue" element={<RequeuePage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/test" element={<TestPage />} />
        <Route path="/rematch" element={<RematchPage />} />
        <Route path="/g/:token" element={<GamePage />} />
        <Route path="/pm-admin" element={<AdminLoginPage />} />
        <Route path="/pm-admin/dashboard" element={<AdminDashboardPage />} />
      </Routes>
    </div>
  );
}

export default App;