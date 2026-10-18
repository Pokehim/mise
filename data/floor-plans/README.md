# Dorm floor plans

One typical first-year double per school, read off the plan its university publishes, for demo rooms with no Capture (ADR-0010). `npx tsx scripts/plan-rooms.ts` turns each `<school>/room.json` into a Scan (`data/scans/<id>/`) and a "Move-in layout" Design (`data/designs/ds_<school>.json`).

Each folder holds:

- **`plan.*`**: the university's own plan image, as downloaded (none for MIT, whose plans are visible only on the campus network).
- **`room.json`**: the room read off it. It uses meters, with x east and z south (down the plan), from the room's center. `polygon` traces the interior wall faces, in order. Each opening sits on edge `wall` (from `polygon[wall]` to the next corner), `offsetM` from that corner. Each piece of furniture has its center, its size `[width, height, depth]`, and the way its front faces. `derivedFrom` and `confidence` say how each room was measured.

The plan images belong to their universities. They are kept here as references for the transcriptions, so don't publish them, for example on the public demo (#42).

| School | Hall, room | Plan | How it was measured | Confidence |
|---|---|---|---|---|
| Stanford | Wilbur Hall double | [rde.stanford.edu](https://rde.stanford.edu/studenthousing/wilbur-hall) ([image](https://rde.stanford.edu/sites/default/files/housing_heading_image_images/wilbur_2bed_0_1000x680.jpg)) | Scaled from the 80″ twin XL bed | medium |
| UC Berkeley | Blackwell Hall double | [housing.berkeley.edu](https://housing.berkeley.edu/blackwell-residence-hall/) ([image](https://housing.berkeley.edu/wp-content/uploads/BH-Double-Bed-Typical.jpg)) | Scaled from the bed; the 34″ door agrees | medium |
| Carnegie Mellon | Donner House traditional double | [cmu.edu PDF](https://www.cmu.edu/housing/our-communities/residences/floor-plans/donner-house/donner_traditional-double_floor-plan.pdf) | Printed 13′-3⅛″ × 15′-11 1/16″ | high |
| University of Washington | Lander Hall double with private bath | [hfs.uw.edu](https://hfs.uw.edu/live-on-campus/undergraduate-housing/lander-hall) ([image](https://hfs.uw.edu/media/auga1540/lander-double.jpg)) | Scaled from the bed; the 36″ door, wardrobes and desks agree | medium |
| MIT | New Vassar double | none public | Official text only (about 180 sq ft, furniture list); the layout is illustrative | low |
| UIUC (for Harvard*) | Wassaja Hall double, type 2A | [housing.illinois.edu PDF](https://www.housing.illinois.edu/sites/default/files/2023-01/wassaja-doubles.pdf) | Printed 10′-6″ × 15′-2″; furniture from the official render | high (room), medium (furniture) |
| UCLA | Dykstra Hall classic triple | none in 2D; the official [3D tour](https://my.matterport.com/show/?m=iJ5yFEstcUU)'s top-down view | The tour's measuring tool, and the [FAQ](https://ask.housing.ucla.edu/app/answers/detail/a_id/539)'s 12′5″ × 10′6″ | low |
| Columbia (for Princeton*) | Carman Hall double 507A | [housing.columbia.edu floor sheet](https://www.housing.columbia.edu/sites/www.housing.columbia.edu/files/content/img/Buildings/Floor%20Plans/Carman/CAR_FL_05.jpg); `plan.png` is turned to put north up, and `plan-2` is the original | Scaled from the printed 215 sq ft; furniture estimated from photos | medium-low |
| Michigan | Wolverine Village double | [housing.umich.edu PDF](https://housing.umich.edu/wp-content/uploads/2025/12/CCRD-Room-Floor-Plans-Double.pdf) | Scaled from the official furniture sizes | medium |
| Georgia Tech | Peterson Hall double (N303) | [housing.gatech.edu PDF](https://housing.gatech.edu/wp-content/uploads/2026/04/PTR-3.pdf) | Scaled from the official 85.5″ bed frame | medium |

\* Harvard says "Floor plans and room dimensions are not provided to students" ([firstyear.college.harvard.edu](https://firstyear.college.harvard.edu/residential-life/moving-campus)). Princeton's plans and Cornell's need a campus login.

No school states a ceiling height, so every room is 2.6 m. Finishes come from official room photos and housing pages: the floor (carpet, vinyl plank or vinyl tile), the walls and the ceiling.
