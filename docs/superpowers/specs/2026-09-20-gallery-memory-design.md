# The gallery's memory: the big pictures, the labels, the walls

2026-09-20. What a room costs in video memory and RAM, and five changes that bring it down without a picture looking worse. Agreed with Uli on 2026-09-20 (all five; item 4 twice corrected: one atlas per **looking direction**, item 3 only in **large rooms**).

## What a room costs today

Numbers for the 74-frame room, RGBA textures with mipmaps (× 1.33):

| what | each | room |
|---|---|---|
| a 90 or 60 cm print, 1200 px | 8 MB | 100–220 MB (a half-year) |
| a grid's 40, 512 px | 1.4 MB | |
| a 2000 px near sheet | 21 MB, allocated and freed per print | up to 9 at once, measured |
| a label card, 1280 × 453 | 3.1 MB on the GPU **and its canvas kept in RAM** | 229 MB GPU + ~207 MB RAM |

The labels are the largest thing in a room; the near sheets churn; the walls are the second bill, and a room walked through holds every one of them whether it is behind the visitor or before them.

## Order

4 → 1 + 5 → 3 → 2. From the self-contained to the one that needs a build tool and a decision about file sizes. Each item lands on `vr-view`, is checked on the bench (`tests/gallery.html`, a line per item) and in the headset, then goes to `main`.

## 4. One label atlas per looking direction

**Atlasing alone saves nothing** — the docs assessed that on 2026-09-19 and it stands: four cards on one canvas cost what four canvases cost. What saves is **one byte a pixel instead of four**: the ink is grey on paper (`#141311` on `#fdfcfa`, a tint of 2/255 that no panel shows), so the atlas is a one-channel texture (`RedFormat`, `UnsignedByteType`) and the material reads the red channel as grey.

- **Grouping.** Every hung piece has a yaw; walls and the middle rows' faces alike face one of four ways (the cabin's face with the north wall). All cards of one direction go on one atlas, so a room has at most four, each sized to its content (not a power of two — WebGL2 mips any size), columns of 1280 px as square as the count allows, never wider than the GPU's largest texture.
- **Drawing** stays as it is: one card at a time on one scratch 1280 × 453 canvas, two a frame after the hang, the same fonts, sizes and squeeze. Its red channel is read back (`getImageData`), sent through a 256-entry sRGB→linear table (a one-channel texture has no sRGB decode on the GPU) and copied, rows turned over, into the direction's byte array at the card's cell. When the last card of a direction is in, the array goes up as one texture through the same upload queue as the photographs (it exceeds a frame's pixel budget and so goes alone, as a 2000 does).
- **The material.** One `MeshLambertMaterial` per direction: `map` and `emissiveMap` the atlas, a 1 × 1 one-channel paper pixel until the atlas lands (map for map, no program rebuild), and a two-line shader patch (`onBeforeCompile`) that reads `.rrra` from the map and `.rrr` from the emissive map, keyed by `customProgramCacheKey` so it is one program.
- **Geometry.** Each card gets its own small box geometry (24 vertices) whose front face's UVs point at its cell and whose five other faces point at bare paper inside the cell's margin. Doubling a card scales the mesh; the UVs never move. The cards stay one mesh each, so pressing, doubling, the sticker under a card, the labels switch and the welded shadows (`followCard`) are untouched.
- **Freeing.** A room's atlases and the four materials go with the room (`disposeRoom`, once each, not per card). The per-card canvases are no more: the scratch canvas is the only one.
- **Expected**: 229 MB → about 60 MB on the GPU in the 74-frame room, 207 MB → about 55 MB in RAM, 74 textures and uploads → 4.
- **Check**: after a ride, the room's labels share at most four maps, each one-channel, together no larger than the cards' own pixels plus a fifth; a doubled card still moves its shadow (the existing line).

## 1 + 5. A pool of 2000 px textures, and a bitmap LRU

three.js allocates a texture's storage once (`texStorage2D`) and writes a same-sized later image with `texSubImage2D` (checked in r180, `uploadTexture`: `allocateMemory` only on the first upload or a new GL texture). So refilling a texture object with another 2000 × 2000 bitmap costs a copy, not an allocation.

- **The pool**: three `Texture` objects, made once, each holding at most one print's picture (`slot.n`). A print inside `DETAIL.warm` asks for a slot: a free one, else the slot of the print farthest from the visitor if that print is past `DETAIL.back` (not shown); otherwise it waits and asks next frame. The near sheet's material takes the slot's texture only once the slot holds its own photograph, so the sheet never shows another print's picture.
- **The LRU**: the last four decoded 2000 bitmaps by photo number. A slot refilled from the LRU skips fetch and decode; a bitmap leaving a slot goes into the LRU, the oldest out is `close()`d. Leaving the floor (`dropAllNear`) empties both.
- **Progressive JPEGs** for the 2000 set, re-saved by the ingest script (ImageMagick `-interlace Plane`): the file shows something sooner where a browser paints it as it arrives; `createImageBitmap` on a whole blob does not decode faster for it. Written down as such — the LRU is the gain, the interlace is a small kindness to the site.
- **Check**: walking three prints in a row and back never holds more than three near textures on the GPU and decodes each file once.

## 3. Drop the 1200s behind you — in large rooms

A room is **large** when its wall textures' bill — 8 MB a 90 or 60, 1.4 MB a grid's 40, counted at the hang — exceeds `WALL_BUDGET` (128 MB; one token). Below it a room holds every print, as today. Above it:

- A print farther than 4 m from the head **and** behind it (the print's direction against the look, dot < −0.3) gives its 1200 back (`freeTexture`) and its material falls to the photograph's 200 px thumbnail (`img/thumb/`, 160 KB, 74 of them 12 MB, fetched with the room through the same queue). Coming within 4 m or into view asks the 1200 again — from the browser's cache, decoded in its turn, up in a frame. A turn of the head shows a soft picture for a fraction of a second, never a blank.
- The lift still waits for every 1200 before the doors open.
- With item 2 in place the bill is four times smaller and the budget trips only in the largest rooms — the constant is in bytes so it needs no retuning.
- **Check**: a large room on the bench, the body turned round: prints behind at over 4 m carry a 200 px map, the ones before the head their 1200s; turned back, the 1200s return.

## 2. KTX2 / Basis compressed textures

The largest change: a build step and two vendor files.

- **Files**: `img/ktx2/<name>.ktx2` (1200) and `img/2000/ktx2/<name>.ktx2`, UASTC with Zstd, mipmapped, written by `basisu` from the JPEGs in `scripts/ingest.sh` for any photo lacking one. Transcoded on the device to ASTC 4 × 4 (Quest) or BC7 (the bench): one byte a pixel. A 1200 falls from 8 MB to 2 MB, a 2000 from 21 MB to 5 MB. A grid's 40 takes the file without its top mip level (600 px) instead of a 512 shrink.
- **In the page**: three's `KTX2Loader` and the Basis transcoder (JS + WASM) into `res/vendor/`, transcoding in the loader's workers; the resulting texture goes through the upload queue like a bitmap. The JPEG path stays as the fallback where a `.ktx2` is missing.
- **The catch, to decide before the build runs over 857 files**: UASTC files are two to four times a JPEG (about 1 GB more in a repository just slimmed to 337 MB, and larger downloads on the headset); ETC1S is JPEG-sized but softer on the 2000s read from close. Ten photographs are encoded both ways first and shown on the bench with their sizes; Uli chooses.
- **Check**: a print's map is a compressed texture on the GPU; the fallback still hangs a room without `.ktx2` files.

## Not in scope

Welding the cards into one mesh per direction (draw calls, not memory); a 1024 px card; any change to what a card says or where it hangs.
