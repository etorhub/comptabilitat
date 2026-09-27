/**
 * Download schemas.
 *
 * There are none of their own: each download reads the filters of the page it
 * hangs off (`transactionFiltersSchema`, `reportFiltersSchema`), with the
 * same keys, so what you download is what you are looking at. There used to
 * be copies here, and they drifted: they read `search`, `to` and `category`
 * while the links sent `cerca`, `fins` and `categoria`.
 */

/** Row ceiling per download, like the Python's `MAX_ROWS`. */
export const MAX_ROWS = 20_000;
