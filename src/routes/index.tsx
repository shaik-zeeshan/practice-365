import { createFileRoute, redirect } from '@tanstack/react-router'

// The app's landing route. There is no standalone home screen in the
// prototype — entering the firm lands you on the dashboard (STACK.md §3).
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' })
  },
})
