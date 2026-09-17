import type { SearchState } from './useSearch'

export function SearchPanel({
  search,
  onGoToHit
}: {
  search: SearchState
  onGoToHit: (index: number) => void
}): React.JSX.Element {
  const { query, setQuery, options, setOptions, hits, currentIndex, indexing } = search

  return (
    <>
      <div className="search-bar">
        <input
          type="search"
          autoFocus
          placeholder="Find in document…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey) search.prev()
              else search.next()
            }
          }}
        />
        <span className="search-count">
          {indexing && hits.length === 0
            ? 'Searching…'
            : hits.length === 0
              ? query
                ? 'No results'
                : ''
              : `${currentIndex + 1} / ${hits.length}${indexing ? '…' : ''}`}
        </span>
      </div>

      <div className="search-opts">
        <label>
          <input
            type="checkbox"
            checked={options.caseSensitive}
            onChange={(e) => setOptions({ ...options, caseSensitive: e.target.checked })}
          />
          Match case
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.wholeWord}
            onChange={(e) => setOptions({ ...options, wholeWord: e.target.checked })}
          />
          Whole word
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.matchDiacritics}
            onChange={(e) => setOptions({ ...options, matchDiacritics: e.target.checked })}
          />
          Diacritics
        </label>
      </div>

      <div className="sidebar-body">
        {hits.length === 0 && query !== '' && !indexing && (
          <div className="sidebar-empty">Nothing matched “{query}”.</div>
        )}
        {hits.map((hit, i) => (
          <div
            key={hit.id}
            className={`search-result${i === currentIndex ? ' current' : ''}`}
            onClick={() => onGoToHit(i)}
          >
            <span className="pg">Page {hit.page}</span>
            {hit.before}
            <mark>{hit.hit}</mark>
            {hit.after}
          </div>
        ))}
      </div>
    </>
  )
}
