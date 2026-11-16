# Executable recipe and project files

All paths below assume the skill repository is the current directory and
`npm ci` has installed the root dependency. Keep projects in ignored `projects/`
or an external workspace. Use fresh compiled and delivery directories for each
revision. Do not commit project input or output to the skill repository.

## Minimal picture test

This is a three-second silent mechanical test, not an example finished film or a
quality benchmark. Save it as `projects/check/recipe.json`:

```json
{
  "title": "Moving token",
  "fps": 30,
  "width": 1080,
  "language": {"overall": "en"},
  "audio": {"mode": "silent"},
  "shots": [
    {
      "id": "move-token",
      "frames": 90,
      "view": "close_up",
      "layout": "token-path",
      "information": "The token moves across a fixed surface.",
      "action": {
        "actor": "token",
        "channel": "position",
        "description": "The token travels from left to right.",
        "active_frames": [0, 90]
      },
      "layers": [
        {"kind": "shape", "w": 540, "h": 960, "fill": "#E9EDF0",
         "material": {"tone": "mist", "depth": 0, "grain": 0, "lip": 0}},
        {"kind": "shape", "x": 70, "y": 545, "w": 400, "h": 24,
         "radius": 8, "fill": "#486278",
         "material": {"tone": "slate", "depth": 3, "grain": 0.18}},
        {"kind": "shape", "id": "token", "rx": 46, "ry": 46,
         "x": {"keys": [[0, 150], [3, 390]], "ease": "smooth"},
         "y": 490, "fill": "#D99C58",
         "material": {"tone": "amber", "depth": 5, "grain": 0.18}}
      ]
    }
  ]
}
```

```bash
python3 engine/scripts/compile_scenario.py \
  --recipe projects/check/recipe.json --out projects/check/compiled-v001
node engine/scripts/render_project.cjs \
  --plan projects/check/compiled-v001/plan.json \
  --out "$PWD/projects/check/probe-v001" \
  --probe --start 0 --seconds 3 --picture-only
```

`picture.mp4`, `storyboard.jpg` and `render-manifest.json` are produced in the
probe directory. The manifest describes what the engine consumed and rendered;
it does not establish perceptual approval.

## Coordinate and timing rules

- The native baseline uses 540 × 960 design coordinates. Recipe `width` controls
  encoded resolution; the compiler derives a portrait 9:16 height. Width must be
  divisible by 18. Set `fps` and each shot's positive integer `frames` explicitly
  when timing matters.
- Layers are ordered back to front. `shape` supports rectangles, ellipses,
  polygons and SVG paths; `image` consumes a declared image asset; `group` and
  `instance` keep related parts together. Filled props require a `material`; a
  guide line can use only `stroke`.
- Numeric tracks use increasing `[seconds, value]` pairs on the shot's clock.
  A track with `event` uses that named global event's clock instead. Define
  shot-local event positions in integer frames; share those events with motion
  and audio cues.
- `action.actor` must name a layer or instance that actually changes. Camera,
  title and text movement do not qualify as explanatory object action.
- `view`, `layout` and `information` describe the actual shot. They are planning
  metadata and do not automatically belong on screen.
- Text can use `title` or label layers. Keep exact audience copy separate from
  narration and production notes. Explicit language channels override `overall`;
  the fallback is English, not the conversation's language.

Use custom colors and project artwork to implement the selected palette and
identity. A neutral bundled board or house material is a starting point, not
proof of matching an arbitrary supplied reference. A project-specific closing
sequence is authored like other shots; there is no mandatory publisher ending.


## Layer and asset vocabulary

| Layer | Useful fields |
| --- | --- |
| `shape` | `w,h,left,top,radius`, or `rx,ry`, or `d`, or `points`; `fill,stroke,lineWidth`; optional `material` |
| `group` | `layers`; shared `x,y,scale,rotation,alpha`; optional clipping and compositing |
| `instance` | `object` naming reusable top-level `objects.<id>` layers; independent transform tracks |
| `image` | `asset` ID, `w,h`, optional `cover,left,top`; transform and opacity tracks |
| `label` / `pill` | `text,x,y`, font size, colors; use the renderer's shaped text |
| `arrow` / `volume` | Geometry plus independent path/shape tracks for the represented relation or region |
| Optional subject helpers | `gauge`, `thermometer`, `cloud`, `droplets` and others; inspect the helper's fields before choosing it |

An explicit solid `fill` supplies the matte base color; restrained highlights
and shadows are derived from it. `material.tone` supplies a default only when
no solid fill is given. `landscape.world.colors` accepts ordered gradient stops
such as `[[0,"#203045"],[1,"#AACCDD"]]` for a project sky override.

Matte controls include `tone` (`slate`, `sage`, `earth`, `amber`, `mist`, `ink`),
`depth`, `grain`, `lip`, `edgeWidth`, `light` and optional `tint`. SVG-path matte
shapes also declare `bounds:[x,y,w,h]` inside `material`. Choose a coherent family
for the project; adding more texture is not a quality test.

Import project artwork with `assets:[{id,path,kind}]`, resolving source paths
relative to the recipe. The illustrated profile requires an actual comparison
for imported image assets: `reference_review:{role,comparison,observation}`.
`comparison` is a local PNG/JPG side-by-side; the role comes from
`engine/assets/style/roles.json`. Compare the actual artwork instead of filling
in this record from a filename. The compiler binds its hashes to the copied
image and evidence. Audio imports use `kind:"audio"` and WAV files.

For your own image anchor, provide recipe
`style_anchor:{id,path,material_family}` with a readable local SVG/PNG/JPG/WebP.
This changes the anchor record and lineage; visual matching still requires
comparison. Exact fonts are selected by bundled filenames using
`typography:{regular,bold,licenses}`. Add a new font to the font registry and
include its license before selecting it; do not rely on a system font alias.

## Supplied narration

For copy preparation with a pending user recording, set
`audio.voice_delivery` to `"user"` and author `voice` for each shot, or
`beats.<id>.voice` for a shared multi-shot beat. Compilation writes clean copy,
directed copy and `voice-handoff.json` without generating speech. The exported
timing windows are targets; measure actual supplied audio before aligning them.

Keep the recording in the project input folder. Preserve words and natural
pauses. Align a full recording to the authored timeline and declare the resulting
WAV as the plan's narration asset. Update `audio.mode` to `"narrated"`,
`audio.narration.required` to `true`, and its `language` and `asset_id` consistently
with the project language and declared audio asset. Set
`audio.requested_silent` to `false` and clear `audio.pending_user_narration`
only after that recording is actually bound. Keep screen copy separate.
Do not ship a handoff plan still marked as pending narration.

If using separate takes, `engine/scripts/assemble_narration.py` accepts
`--plan`, `--takes` and `--out`. Its plan requires spoken `narration` on each beat;
the takes JSON maps beat IDs to `{ "file": "relative-take.wav" }`. This helper
needs NumPy in the active Python environment.
It rejects an over-budget take instead of truncating words. It does not replace
alignment of a continuous recording or listening to the final mix.

Imported SFX are WAV audio assets. Use a cue's shared visual `event` when it
should land sharply. Choose suitable levels and ambience for the project rather
than treating a technical loudness target as evidence that speech is clear.

## Full encode

After the authorized picture and real audio are ready, validate the current plan
and encode to a fresh delivery directory:

```bash
python3 engine/scripts/check_project.py projects/my-film/compiled-v001/plan.json --mode final
node engine/scripts/render_project.cjs \
  --plan projects/my-film/compiled-v001/plan.json \
  --out "$PWD/projects/my-film/delivery-v001" --final
```

The renderer writes `final.mp4` when it mixes declared audio; a silent or
picture-only project produces `picture.mp4`. Review encoded movement at 1× and
listen to the actual mix before claiming those checks. Review declarations and
technical validation are not an automatic subjective quality score.
