/** 折页之间的留白构成转译通道；与 build/logo.svg 共用轮廓。 */
export function BrandMark({ className = '' }: { className?: string }) {
  return <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <path d="M10 13C18 11 25 14 29 19V53C24 47 17 45 10 47V13Z" fill="currentColor" />
    <path d="M35 11C41 15 48 16 54 14V48C46 51 40 48 35 43V11Z" fill="currentColor" />
    <path d="M17 23L23 26M41 36L47 39" stroke="hsl(var(--card))" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
}
