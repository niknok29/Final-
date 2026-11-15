import { DashboardPage } from './pages/DashboardPage.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { DashboardProvider } from './state/DashboardContext.jsx'
import { useDashboard } from './state/dashboardStore.js'

function AppContent() {
  const { user } = useDashboard()
  return user?.token ? <DashboardPage /> : <LoginPage />
}

export default function App() {
  return (
    <DashboardProvider>
      <AppContent />
    </DashboardProvider>
  )
}
