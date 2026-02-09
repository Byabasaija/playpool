import { Routes, Route } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { GamePage } from './pages/GamePage';
import { JoinPage } from './pages/JoinPage';
import { ProfilePage } from './pages/ProfilePage';
import { TestPage } from './pages/TestPage';
import { RematchPage } from './pages/RematchPage';
import { RequeuePage } from './pages/RequeuePage';
import { RulesPage } from './pages/RulesPage';
import { TermsPage } from './pages/TermsPage';

// Admin
import { AdminLoginPage } from './admin/pages/AdminLoginPage';
import { AdminProtectedRoute } from './admin/components/AdminProtectedRoute';
import { AdminDashboard } from './admin/pages/AdminDashboard';
import { AdminPlayers } from './admin/pages/AdminPlayers';
import { AdminPlayerDetail } from './admin/pages/AdminPlayerDetail';
import { AdminGames } from './admin/pages/AdminGames';
import { AdminGameDetail } from './admin/pages/AdminGameDetail';
import { AdminTransactions } from './admin/pages/AdminTransactions';
import { AdminWithdrawals } from './admin/pages/AdminWithdrawals';
import { AdminRevenue } from './admin/pages/AdminRevenue';
import { AdminAuditLog } from './admin/pages/AdminAuditLog';
import { AdminConfig } from './admin/pages/AdminConfig';

function App() {
  return (
    <div className="min-h-screen">
      <Routes>
        {/* Player-facing routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/requeue" element={<RequeuePage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/test" element={<TestPage />} />
        <Route path="/rematch" element={<RematchPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/g/:token" element={<GamePage />} />

        {/* Admin login (no layout) */}
        <Route path="/pm-admin" element={<AdminLoginPage />} />

        {/* Admin protected routes (with sidebar layout) */}
        <Route path="/pm-admin" element={<AdminProtectedRoute />}>
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="players" element={<AdminPlayers />} />
          <Route path="players/:id" element={<AdminPlayerDetail />} />
          <Route path="games" element={<AdminGames />} />
          <Route path="games/:id" element={<AdminGameDetail />} />
          <Route path="transactions" element={<AdminTransactions />} />
          <Route path="withdrawals" element={<AdminWithdrawals />} />
          <Route path="revenue" element={<AdminRevenue />} />
          <Route path="audit-log" element={<AdminAuditLog />} />
          <Route path="config" element={<AdminConfig />} />
        </Route>
      </Routes>
    </div>
  );
}

export default App;
