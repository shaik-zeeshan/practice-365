import {
  HeadContent,
  Link,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

import { GlobalTimer } from '@/components/timer/GlobalTimer'
import { TimekeeperPopover } from '@/components/timer/TimekeeperPopover'
import { TimeEntryModal } from '@/components/timer/TimeEntryModal'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Practice365',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {/*
          TanStack Query is provided via the router context (see src/router.tsx),
          wired with setupRouterSsrQueryIntegration. The QueryClient is created in
          src/integrations/tanstack-query/root-provider.tsx and is available in
          loaders/components through Route context + useQueryClient().
        */}
        <TooltipProvider>
          <div className="flex min-h-screen flex-col">
            <header className="flex h-14 items-center justify-between border-b px-4">
              <div className="flex items-center gap-6">
                <Link to="/" className="text-lg font-semibold tracking-tight">
                  Practice365
                </Link>
                <nav className="flex items-center gap-1">
                  {(
                    [
                      { to: '/dashboard', label: 'Dashboard' },
                      { to: '/time', label: 'Time' },
                      { to: '/clients', label: 'Clients' },
                      { to: '/matters', label: 'Matters' },
                      { to: '/bills', label: 'Bills' },
                      { to: '/settings', label: 'Settings' },
                    ] as const
                  ).map(({ to, label }) => (
                    <Link
                      key={to}
                      to={to}
                      className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      activeProps={{
                        className: 'bg-muted text-foreground',
                      }}
                    >
                      {label}
                    </Link>
                  ))}
                </nav>
              </div>
              <div className="flex items-center gap-2">
                {/* GlobalTimer mounts here */}
                <GlobalTimer />
                <TimekeeperPopover />
              </div>
            </header>
            <main className="flex-1">{children}</main>
          </div>
          {/* Globally-available time-entry modal (controlled by the timer store). */}
          <TimeEntryModal />
          <Toaster />
        </TooltipProvider>
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
