import {
  HeadContent,
  Link,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { Menu } from 'lucide-react'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { GlobalTimer } from '@/components/timer/GlobalTimer'
import { TimekeeperPopover } from '@/components/timer/TimekeeperPopover'
import { TimeEntryModal } from '@/components/timer/TimeEntryModal'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

// The primary nav, shared by the desktop bar and the mobile menu so the two
// can never drift out of sync.
const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/time', label: 'Time' },
  { to: '/clients', label: 'Clients' },
  { to: '/matters', label: 'Matters' },
  { to: '/bills', label: 'Bills' },
  { to: '/settings', label: 'Settings' },
] as const

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

/**
 * Mobile navigation — a hamburger button (hidden at md+) that opens a dropdown
 * of the same nav links the desktop bar shows. The dropdown auto-closes on
 * selection, so tapping a link navigates and dismisses the menu.
 */
function MobileNav() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {navItems.map(({ to, label }) => (
          <DropdownMenuItem key={to} asChild>
            <Link
              to={to}
              className="cursor-pointer"
              activeProps={{
                className: 'bg-accent text-accent-foreground',
              }}
            >
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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
            <header className="flex h-14 items-center justify-between gap-2 border-b px-4">
              <div className="flex min-w-0 items-center gap-2 md:gap-6">
                {/* Hamburger menu — mobile only; the inline nav takes over at md. */}
                <MobileNav />
                <Link
                  to="/"
                  className="truncate text-lg font-semibold tracking-tight"
                >
                  Practice365
                </Link>
                <nav className="hidden items-center gap-1 md:flex">
                  {navItems.map(({ to, label }) => (
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
