/**
 * Install snippets, one per stack.
 *
 * The snippet itself is identical everywhere — a script tag with a key. What
 * actually differs, and what actually causes failed installs, is *where it
 * goes*. A React developer looking at a bare script tag has to work out that
 * it belongs in `public/index.html` and not in a component; a Shopify merchant
 * has to know it means `theme.liquid`. Encoding that here is the difference
 * between "here is a script tag, good luck" and an install that works first
 * time.
 *
 * Everything below is generated from the site's own public key and this
 * deployment's URL, so there is nothing for the owner to fill in by hand.
 */

export type StackId =
  | 'html'
  | 'react'
  | 'nextjs'
  | 'vue'
  | 'npm'
  | 'wordpress'
  | 'shopify'
  | 'gtm'

export interface StackSnippet {
  id: StackId
  label: string
  /** Grouping in the picker. */
  family: 'Universal' | 'JavaScript' | 'Platforms'
  /** Where the code goes, in the words the stack's own docs would use. */
  where: string
  language: 'html' | 'tsx' | 'bash' | 'php'
  code: string
  /** One caveat worth knowing before pasting. Rendered under the snippet. */
  note?: string
}

export interface SnippetInput {
  publicKey: string
  /** Absolute base URL of this deployment, e.g. https://app.example.com. */
  appUrl: string
}

function scriptTag({ publicKey, appUrl }: SnippetInput): string {
  return `<script src="${appUrl}/widget.js" data-key="${publicKey}" async></script>`
}

export function buildSnippets(input: SnippetInput): StackSnippet[] {
  const tag = scriptTag(input)

  return [
    {
      id: 'html',
      label: 'HTML / PHP / Rails / Django',
      family: 'Universal',
      where: 'Paste before the closing </body> tag of your page or layout template.',
      language: 'html',
      code: `  ${tag}\n</body>`,
      note: 'Server-rendered stacks all work the same way — the widget only ever runs in the browser, so your backend never touches it.',
    },
    {
      id: 'react',
      label: 'React (CRA / Vite)',
      family: 'JavaScript',
      where: 'Paste into public/index.html (CRA) or index.html (Vite).',
      language: 'html',
      code: `  <div id="root"></div>\n  ${tag}\n</body>`,
      note: 'Placing it outside the React root means route changes and re-renders never disturb the widget. No component and no cleanup needed.',
    },
    {
      id: 'nextjs',
      label: 'Next.js',
      family: 'JavaScript',
      where: 'Add to app/layout.tsx (App Router) or pages/_app.tsx.',
      language: 'tsx',
      code: `import Script from 'next/script'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="${input.appUrl}/widget.js"
          data-key="${input.publicKey}"
          strategy="afterInteractive"
        />
      </body>
    </html>
  )
}`,
      note: '"afterInteractive" keeps the widget out of the critical path — it loads once hydration is done, not before.',
    },
    {
      id: 'vue',
      label: 'Vue / Nuxt',
      family: 'JavaScript',
      where: 'Paste into index.html (Vue) or add to nuxt.config.ts under app.head.script.',
      language: 'html',
      code: `  <div id="app"></div>\n  ${tag}\n</body>`,
      note: 'For Nuxt: { src: \'…/widget.js\', \'data-key\': \'…\', async: true } in app.head.script does the same thing.',
    },
    {
      id: 'npm',
      label: 'npm package',
      family: 'JavaScript',
      where: 'Use when you need to control the widget from code — hide it on some routes, or open it from your own button.',
      language: 'bash',
      code: `npm i @sysmatixx/chat-widget

# Mounted once, above your router:
#
#   import { ChatWidget } from '@sysmatixx/chat-widget/react'
#   <ChatWidget publicKey="${input.publicKey}" />
#
# Opened from your own button, anywhere:
#
#   import { openChat } from '@sysmatixx/chat-widget'
#   <button onClick={openChat}>Need help?</button>
#
# Vue, Svelte, Angular and vanilla JS:
#
#   import { loadChatWidget } from '@sysmatixx/chat-widget'
#   const dispose = loadChatWidget({ publicKey: '${input.publicKey}' })`,
      note: 'The package injects the same script tag. Its only job is handling SPA lifecycle correctly — StrictMode double-mounts, unmount cleanup.',
    },
    {
      id: 'wordpress',
      label: 'WordPress',
      family: 'Platforms',
      where: "Appearance → Theme File Editor → functions.php, at the end of the file.",
      language: 'php',
      code: `add_action('wp_footer', function () {
  ?>
  ${tag}
  <?php
});`,
      note: 'Using wp_footer rather than editing a template means a theme update cannot wipe the install.',
    },
    {
      id: 'shopify',
      label: 'Shopify',
      family: 'Platforms',
      where: 'Online Store → Themes → Edit code → layout/theme.liquid, before </body>.',
      language: 'html',
      code: `  ${tag}\n</body>`,
      note: 'Add your myshopify.com preview domain as a second allowed origin if you want the widget live while previewing an unpublished theme.',
    },
    {
      id: 'gtm',
      label: 'Google Tag Manager',
      family: 'Platforms',
      where: 'New Tag → Custom HTML, firing on All Pages.',
      language: 'html',
      code: tag,
      note: 'Leave "Support document.write" unchecked. The loader guards against double-injection, so a tag that fires twice is harmless.',
    },
  ]
}

/** The snippet shown first — correct for the widest range of sites. */
export const DEFAULT_STACK: StackId = 'html'
