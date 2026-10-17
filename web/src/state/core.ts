// The editor's one import point for the shared core logic of #5. Each line points at a stub
// with the same signature until the real module merges; switching is a one-line change here.
export { replay } from './coreStub';     // → export { replay } from '@shared/replay';
export { checkFit } from './coreStub';   // → export { checkFit } from '@shared/fit';
