import { customAlphabet } from 'nanoid';

/** The id prefixes of spec §5. Scan ids are slugs instead, such as "dorm-v1". */
export type IdPrefix = 'og' | 'pc' | 'ed' | 'ds' | 'wl' | 'op';

const suffix = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

/** A new id such as "ds_k3v9x0qa": the prefix, "_", then 8 lowercase alphanumerics. */
export const newId = (prefix: IdPrefix) => `${prefix}_${suffix()}`;
