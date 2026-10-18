import { useEditor } from '../../state/store';
import { ColorChoice } from './ColorChoice';

/**
 * Paint a Wall (spec §10.4): a swatch or a color, or back to the scanned look. Each choice is a
 * finish Edit; the shader keeps the room's real light and shadow on the wall.
 */
export function WallPaint({ wallId }: { wallId: string }) {
  const finish = useEditor((s) => s.roomState!.surfaces.walls[wallId]);
  return (
    <section className="color-control">
      <h3>Paint</h3>
      <ColorChoice
        value={finish?.kind === 'paint' ? finish.color : null}
        resetLabel="Reset to scanned"
        onChoose={(color) => useEditor.getState().applyEdit({
          type: 'finish',
          target: { kind: 'wall', wallId },
          finish: color ? { kind: 'paint', color } : { kind: 'none' },
        })}
      />
    </section>
  );
}
