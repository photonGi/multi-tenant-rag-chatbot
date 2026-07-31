import { NextResponse, type NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/proxy'
import { embedFrameResponse } from '@/lib/widget/frame'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // The widget's own surfaces are anonymous by design — a visitor on a
  // customer's website has no session here. Running the Supabase refresh over
  // them would cost a round trip on every panel open and set cookies on a
  // third-party context that will only be partitioned away.
  if (pathname.startsWith('/embed/')) {
    return embedFrameResponse(request)
  }

  if (pathname.startsWith('/api/widget/')) {
    return NextResponse.next()
  }

  // Server-to-server calls from the n8n workflows. They carry a shared secret
  // and no cookies, so a Supabase session refresh in front of them is a round
  // trip that can only ever conclude "not signed in" — and one that would run
  // on the hot path of every meeting booking.
  if (pathname.startsWith('/api/internal/')) {
    return NextResponse.next()
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - widget.js (the embed loader — a public static asset, no session)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|widget\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
