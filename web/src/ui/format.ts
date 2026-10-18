/** A count with its noun: "1 Edit", "3 Edits". */
export const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
