/** Default folder names searched for project-context documents. */
export const DEFAULT_ROOTS: readonly string[] = ['specs', 'docs', 'insights'];

/** Maximum number of documents a listing returns. */
export const MAX_LISTED_DOCS = 500;

/** Per-document token cap applied to the text that is counted and injected. */
export const DOC_TOKEN_CAP = 4000;

/** Cap on the sum of per-document token counts in one prompt section. */
export const SECTION_TOKEN_CAP = 12000;

/** Maximum number of paths in one attachment list. */
export const MAX_ATTACHED_PATHS = 200;

/** Maximum length of one attachable path. */
export const MAX_PATH_LENGTH = 500;
