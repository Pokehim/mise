"""The floor's grain direction in a floor view from ortho.py (#77): its angle from +x in degrees, mod 180."""
import sys

import cv2
import numpy as np
from PIL import Image


def grain_deg(path, center=None, radius=None):
    im = np.array(Image.open(path)).astype(np.float32)
    g = cv2.cvtColor(im[..., :3], cv2.COLOR_RGB2GRAY)
    ok = cv2.erode((im[..., 3] > 250).astype(np.uint8), np.ones((15, 15))) > 0
    if center is not None:  # ignore the chair and its shadow
        yy, xx = np.mgrid[:g.shape[0], :g.shape[1]]
        ok &= np.hypot(xx - center[0], yy - center[1]) > radius
    gx, gy = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    # Image rows run +z, so the gradient angle in the floor plane is atan2(gz, gx); the grain is across it.
    jxx, jzz, jxz = (gx * gx)[ok].sum(), (gy * gy)[ok].sum(), (gx * gy)[ok].sum()
    grad = 0.5 * np.degrees(np.arctan2(2 * jxz, jxx - jzz))
    coherence = np.hypot(jxx - jzz, 2 * jxz) / (jxx + jzz)
    return float(np.mod(grad + 90, 180)), float(coherence)


if __name__ == '__main__':
    print(grain_deg(sys.argv[1]))
