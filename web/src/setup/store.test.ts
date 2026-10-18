import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setup } from '@shared/test-room';
import type { RoomSetup, ScanManifest } from '@shared/types';
import { savePatchImage, saveSetup } from '../api';
import { useSetup } from './store';

// Saving is the HTTP boundary: the tests stand in for the server.
vi.mock('../api');

const manifest: ScanManifest = {
  version: 1, id: setup.scanId, name: 'Test room', mesh: 'room.glb', meshTransform: { position: [0, 0, 0], rotationY: 0 },
};

/** The store straight after a Bake that isn't saved yet: the desk has a Patch, and its two images are staged. */
function baked() {
  const bakedSetup: RoomSetup = {
    ...setup,
    originals: setup.originals.map((o) => (o.id === 'og_desk'
      ? { ...o, floorColor: '#7c7c7c', patch: { floor: 'patches/og_desk.floor.png', walls: { wl_east: 'patches/og_desk.wl_east.png' } } }
      : o)),
  };
  const images = new Map([
    ['og_desk.floor.png', new Blob(['floor'], { type: 'image/png' })],
    ['og_desk.wl_east.png', new Blob(['wall'], { type: 'image/png' })],
  ]);
  useSetup.setState({ status: 'ready', message: undefined, manifest, setup: bakedSetup, saved: { manifest, setup }, patchImages: images });
  return { bakedSetup, images };
}

beforeEach(() => vi.resetAllMocks());

describe('save', () => {
  it('save uploads every staged Patch image before it writes setup.json, then empties patchImages', async () => {
    const { bakedSetup, images } = baked();
    // Each image's PUT takes a moment, so setup.json must wait for them, not just be sent after them.
    const written: string[] = [];
    vi.mocked(savePatchImage).mockImplementation(async (_scanId, name) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      written.push(name);
      return `patches/${name}`;
    });
    vi.mocked(saveSetup).mockImplementation(async (s) => {
      written.push('setup.json');
      return s;
    });

    await useSetup.getState().save();

    expect(vi.mocked(savePatchImage).mock.calls).toEqual([...images].map(([name, png]) => [manifest.id, name, png]));
    expect(written).toEqual(['og_desk.floor.png', 'og_desk.wl_east.png', 'setup.json']);
    expect(saveSetup).toHaveBeenCalledWith(bakedSetup);
    const state = useSetup.getState();
    expect(state.patchImages.size).toBe(0);
    expect(state.status).toBe('ready');
    expect(state.message).toBeUndefined();
    expect(state.saved.setup).toBe(bakedSetup);
  });

  it('save keeps the staged images when a PUT fails, and says Not saved', async () => {
    const { images } = baked();

    // An image's PUT fails, so setup.json isn't written.
    vi.mocked(savePatchImage)
      .mockRejectedValueOnce(new Error('PUT og_desk.floor.png: 500 disk full'))
      .mockResolvedValue('patches/og_desk.wl_east.png');
    await useSetup.getState().save();

    expect(saveSetup).not.toHaveBeenCalled();
    let state = useSetup.getState();
    expect(state.message).toBe('Not saved: PUT og_desk.floor.png: 500 disk full');
    expect(state.patchImages).toBe(images);
    expect(state.patchImages.size).toBe(2);
    expect(state.saved.setup).toBe(setup);

    // The images land, but setup.json's PUT fails: they're still kept for the next Save.
    vi.mocked(savePatchImage).mockImplementation(async (_scanId, name) => `patches/${name}`);
    vi.mocked(saveSetup).mockRejectedValue(new Error('PUT /api/scans/test-room/setup: 500 disk full'));
    await useSetup.getState().save();

    state = useSetup.getState();
    expect(state.status).toBe('ready');
    expect(state.message).toBe('Not saved: PUT /api/scans/test-room/setup: 500 disk full');
    expect(state.patchImages).toBe(images);
    expect(state.patchImages.size).toBe(2);
    expect(state.saved.setup).toBe(setup);
  });
});
