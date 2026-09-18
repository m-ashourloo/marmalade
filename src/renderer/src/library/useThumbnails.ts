import { useEffect, useState } from 'react'
import type { DocumentRow } from '@shared/types'

export interface Thumbnail {
  url: string
  /** The page's real width/height, so the card can take the document's shape. */
  aspect: number
}

/**
 * Object URLs for each document's cached page render. They are revoked whenever
 * the set changes and on unmount — a long-lived Electron session that leaked one
 * per library refresh would hold every thumbnail it had ever shown.
 */
export function useThumbnails(docs: DocumentRow[]): Record<number, Thumbnail> {
  const [urls, setUrls] = useState<Record<number, Thumbnail>>({})
  const key = docs.map((d) => d.id).join(',')

  useEffect(() => {
    let cancelled = false
    const made: string[] = []

    void (async () => {
      const entries: [number, Thumbnail][] = []
      for (const doc of docs) {
        try {
          const thumb = await window.api.doc.getThumbnail(doc.id)
          if (!thumb) continue
          const url = URL.createObjectURL(new Blob([thumb.image], { type: 'image/webp' }))
          made.push(url)
          entries.push([doc.id, { url, aspect: thumb.width / thumb.height }])
        } catch {
          // A document with no readable thumbnail simply shows its fallback.
        }
      }
      if (cancelled) {
        for (const u of made) URL.revokeObjectURL(u)
        return
      }
      setUrls(Object.fromEntries(entries))
    })()

    return () => {
      cancelled = true
      for (const u of made) URL.revokeObjectURL(u)
    }
    // Keyed on the id list: refreshing the library with the same documents must
    // not churn every object URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return urls
}
