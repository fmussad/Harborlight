import { lazy, Suspense, type ReactElement } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { AppProviders } from '@/providers/AppProviders'
import { Spinner } from '@/components/ui/primitives'
import { useUiStore } from '@/stores/ui'
import { ContainersPage } from '@/pages/ContainersPage'
import { ImagesPage } from '@/pages/ImagesPage'
import { NetworksPage } from '@/pages/NetworksPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { RegistryPage } from '@/pages/RegistryPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { VolumesPage } from '@/pages/VolumesPage'

// The editor and the topology graph pull in CodeMirror and React Flow, which
// are worth keeping out of the initial window paint.
const ComposePage = lazy(async () => ({
  default: (await import('@/pages/ComposePage')).ComposePage
}))

function CurrentSection(): ReactElement {
  const section = useUiStore((state) => state.section)

  switch (section) {
    case 'containers':
      return <ContainersPage />
    case 'compose':
      return <ComposePage />
    case 'images':
      return <ImagesPage />
    case 'volumes':
      return <VolumesPage />
    case 'networks':
      return <NetworksPage />
    case 'registry':
      return <RegistryPage />
    case 'settings':
      return <SettingsPage />
    case 'overview':
    default:
      return <OverviewPage />
  }
}

export function App(): ReactElement {
  return (
    <AppProviders>
      <AppShell>
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          }
        >
          <CurrentSection />
        </Suspense>
      </AppShell>
    </AppProviders>
  )
}
