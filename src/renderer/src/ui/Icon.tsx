/**
 * A hand-rolled set rather than an icon dependency: twelve glyphs do not justify
 * a package, and drawing them on one grid is what keeps the toolbar coherent —
 * the Unicode glyphs this replaced rendered at a different size and weight per
 * platform font.
 *
 * Every path is drawn in a 16×16 box, stroked, never filled.
 */
const PATHS: Record<string, string> = {
  library: 'M3 3v10M3 3h4.5v10H3zM9 3h4v10H9z',
  sidebar: 'M2.5 3.5h11v9h-11zM6.5 3.5v9',
  back: 'M10 3.5 5.5 8l4.5 4.5',
  forward: 'M6 3.5 10.5 8 6 12.5',
  minus: 'M3.5 8h9',
  plus: 'M8 3.5v9M3.5 8h9',
  rotate: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5',
  contrast: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 2v12',
  import: 'M8 10.5V2.5M5 5.5 8 2.5l3 3M3 10.5v3h10v-3',
  export: 'M8 2.5v8M5 7.5 8 10.5l3-3M3 10.5v3h10v-3',
  open: 'M2.5 12.5v-9h4l1.5 2h5.5v7zM2.5 5.5h11',
  folder: 'M2.5 12.5v-9h4l1.5 2h5.5v7z',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8',
  search: 'M7.25 2.5a4.75 4.75 0 1 0 0 9.5 4.75 4.75 0 0 0 0-9.5zM10.75 10.75 13.5 13.5'
}

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 16
}: {
  name: IconName
  size?: number
}): React.JSX.Element {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
