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

For requested TTS copy, return one ready-to-paste block in the project's known
format, with pronunciation marks and limited delivery tags when that setup uses
them. Follow a supplied successful example rather than defaulting to untagged
copy and requiring another prompt. Keep stage directions, timestamps and SFX out
of the spoken-copy block; delivery tags are intentional voice controls, not
screen labels. Preserve that exact tagged input and its checksum with the voice
revision. A tag-free semantic transcript may be derived for alignment, but must
not silently replace the submitted input. A successful example establishes this
project preference, not a provider/model ID or universal tag support.

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

## Background music and mixing

Keep the project's music identity in its style sheet: primary track and version,
related alternatives and when they fit, intended timbre/energy, and any quiet
intervals. An established default can be reused without choosing a new track
for every episode. Another brand may choose a different family or no music.
Prefer unobtrusive instrumental material under speech unless the brief requests
otherwise. Keep music separate from narration, ambience and event SFX.

For each selected track, record its asset ID/version, source, checksum and usage
rights in the project's existing asset records. Keep project music outside this
skill's tracked resources; do not copy a private or unlicensed track into the
public skill. If no track is selected, record music as pending or intentionally
absent rather than substituting an arbitrary bundled sound.

The compiler supports a distinct `audio.music` object. Declare the track as a
WAV in recipe `assets`, then select its ID with `sound`:

```json
"audio": {
  "mode": "narrated",
  "music": {
    "sound": "my-music-v001",
    "gain_db": -19,
    "fade_in_seconds": 0.35,
    "fade_out_seconds": 0.55,
    "ducking": {
      "reduction_db": 7,
      "threshold_dbfs": -40,
      "attack_seconds": 0.04,
      "release_seconds": 0.28,
      "foreground_reduction_db": 3
    },
    "quiet_intervals": []
  }
}
```

These are starting settings, not a universal mix. `audio.bed` remains a separate
constant-gain ambience bus. The selected music loops over the exact project
clock and fades within it. Quiet intervals are ordered absolute `[start, end]`
pairs for deliberate silence; the helper adds short ramps around them. Do not
use one asset as both music and ambience, add a second music cue, or layer music
onto a preserved reference master. Omit `music` when it is not selected.

At mix time, `music_bus.py` decodes the actually bound narration locally with
FFmpeg. A 20 ms RMS envelope identifies active signal above `threshold_dbfs`,
joins short gaps, and lowers **only music** by `reduction_db`; foreground event
clocks can reduce music by `foreground_reduction_db` as well. Narration, SFX and
ambience retain their own levels and timing before the existing final loudness
normalization. This is deterministic level-based ducking, not speech recognition
or a perceptual clarity test. Supply an isolated voice track: background noise
or pre-mixed music above the threshold will also trigger attenuation.

The helper derives a cue-relative `gain_keys` envelope on the absolute film
clock before preview cropping, so probes and the full mix share the same timing.
Its gain values replace `gain_db`. `final.audio.json` records the actual source
hashes, intervals, settings and gain keys under `music_bus`; no listening is
claimed. Existing projects without `audio.music` keep their previous mix path.
Projects with a guarded post-compile adapter can import the same helper into the
disposable compiled project; do not patch archival source runtimes per episode.

The optional `engine/scripts/synthesize_music.py --out /path/to/new-loop.wav`
creates a deterministic original soft mallet/pad loop locally, without a model
or third-party samples. It is one candidate instrument family, not a mandatory
style or pre-approved brand track. Use only during authorized audio production;
keep the resulting media and its provenance in the project rather than tracking
it in the public skill. `python3 scripts/test_music_bus.py` exercises a bounded
signal/mux regression without a voice service, media upload or listening claim.

Mix locally with the existing FFmpeg route. Choose levels for the actual sources
rather than treating a fixed gain as a universal speech/music balance. Keep
loop boundaries unobtrusive, use quiet intervals when the hook depends on sound,
and finish music with the necessary speech/brand events without lengthening the
film for a musical resolution. Avoid adding a second music cue for a track
already represented by `audio.bed`, and preserve an intentionally supplied full
reference mix instead of layering another bed onto it.

For authorized production, check dialogue clarity, audible level jumps or loop
seams, topic/series fit and the ending by listening to the actual mix; also check
the project's loudness/peak targets. Record track/version, gain plan and remaining
unreviewed criteria in the existing delivery notes. Technical loudness checks do
not establish musical suitability. Do not render, audition, download music or
call a generation service merely to complete a skill-only edit.

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
