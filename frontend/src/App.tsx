import { Routes, Route } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { GamePage } from './pages/GamePage';
import { JoinPage } from './pages/JoinPage';
import { ProfilePage } from './pages/ProfilePage';

function App() {
  return (
    <div className="min-h-screen">
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/g/:token" element={<GamePage />} />
      </Routes>
    </div>
  );
}

export default App;