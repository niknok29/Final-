import { CrisisMap } from '../components/CrisisMap.jsx'
import { Header } from '../components/Header.jsx'
import { RedAlertBanner } from '../components/RedAlertBanner.jsx'
import { RightStatusPanel } from '../components/RightStatusPanel.jsx'
import { SimulationDrawer } from '../components/SimulationDrawer.jsx'
import { SosFeedPanel } from '../components/SosFeedPanel.jsx'
import { StatsBar } from '../components/StatsBar.jsx'
import { ToastContainer } from '../components/ToastContainer.jsx'

export function DashboardPage() {
  return (
    <div className="dashboard-shell">
      <Header />
      <StatsBar />
      <RedAlertBanner />
      <div className="workspace-grid">
        <SosFeedPanel />
        <CrisisMap />
        <RightStatusPanel />
      </div>
      <SimulationDrawer />
      <ToastContainer />
    </div>
  )
}
