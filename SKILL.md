---
name: illustrated-2-5d-motion
description: Plan, create, and revise illustrated 2.5D motion videos with layered artwork, independent object animation, clear visual explanations, and synchronized narration. Use for storyboards, scene assets, local rendering, and style-consistent revisions across topics and brands.
---

# Illustrated 2.5D Motion

Create illustrated motion with a coherent material family, layered depth, readable
staging and purposeful action. Adapt the story and brand to the current project;
the skill does not prescribe a publisher, subject, language, character or CTA.
Paths below are relative to this skill folder.

## Start with the requested output

Respect requests limited to planning, copy, assets or skill edits. If asked to wait
for narration, prepare only the authorized material and stop before rendering.
For a production request, inspect the supplied brief, references, assets and real
audio first. Resolve duration, output format, narration/screen languages and brand
choices from the brief. Do not carry a previous project's dialogue or preferences
into another project.

Keep project inputs, working files and versioned deliverables outside the skill's
tracked resources. `projects/` is an ignored local option. Preserve supplied audio
and earlier approved outputs; record revisions rather than overwriting them.

Read [art direction](references/art-direction.md) before composing a new story.
Prepare a small project style sheet: reference roles, palette roles, exact fonts,
material/detail level, light, type emphasis, motion/transition rhythm and any brand
ending. Separate fixed identity choices from adjustable composition and
subject-specific artwork. Existing user-approved examples take precedence over
an internal score. Do not insert another publisher's logos or source footage.

## Design the visible mechanism

For each shot state the new visible fact, focal actor, independently changing
property, spatial relationship and visible consequence. Choose context, section,
close detail, comparison or result as useful; there is no universal shot count.
A crop or new heading on one static composition does not establish scene variety.
Camera motion supports object action; a zoom cannot substitute for it.

For a field or population, establish the distributed action before following an
individual sample. Match subject, environment and instruments in material,
lighting, contour and detail level. Richness comes from useful depth planes,
occlusion, secondary response and changing states, not decorative texture alone.
Use characters and instruments only when they help tell this story.

Reuse suitable geometry and motion helpers. Keep subject-specific staging in the
project; do not copy the whole engine or impose a previous landscape on a new
subject. Use code/vector assets for exact diagrams and type. Use image creation
only when bitmap illustration helps and the required tool is available. Add a
new rendering framework only for a concrete capability or demonstrated benefit.

## Build with the local engine

Install the pinned Node dependency with `npm ci` from the skill folder.
Read [the recipe format](references/recipe-format.md) for a minimal executable
recipe, supported layer primitives and narration integration. Inspect the
relevant engine helper only when adding or adapting a capability. Domain-specific
components are optional building blocks, not required scene templates.

The native route uses Python, Node/Canvas and FFmpeg. Its baseline is portrait
9:16, authored in a 540 × 960 design space; do not promise other formats without
adapting and checking the renderer. The renderer uses one evaluator for the
storyboard, stills, short probes and complete video. Evaluate state from time and
seed random fields so out-of-order rendering is deterministic.

Compile an authored recipe to a fresh project directory:

```bash
python3 engine/scripts/compile_scenario.py \
  --recipe projects/my-film/recipe.json --out projects/my-film/compiled-v001
```

Validate the generated plan with:

```bash
python3 engine/scripts/check_project.py projects/my-film/compiled-v001/plan.json --mode final
```

Test the hardest changed interval when needed. A probe is at most five seconds
and three shots, retains the original timeline, and is not a compressed film:

```bash
node engine/scripts/render_project.cjs \
  --plan projects/my-film/compiled-v001/plan.json \
  --out "$PWD/projects/my-film/qa-v001" \
  --probe --start 0 --seconds 3 --picture-only
```

Use `--final` instead of probe flags for an authorized complete encode, choosing
a new output directory. Remove `--picture-only` when real narration and its
mix are ready. The renderer writes `picture.mp4` and, when audio is mixed,
`final.mp4`. A picture-only file is not a completed narrated deliverable.

## Synchronize text, action and sound

Keep spoken copy separate from screen copy and production notes. Render only
intended audience text. Use real font files with script coverage and proper
shaping. Measure emphasis lines below the complete glyphs, including descenders
and dots, throughout their animation; compare at intended viewing size.

Bind related motion and sharp SFX to one event clock. Carry object identity,
trajectory, state, attachment and contact through continuing views. Do not infer
anchors from an approximate face or object center. Keep independent mechanism
channels separate from whole-object/camera transforms.

Use the voice source and delivery requested by this project, not a mandatory
provider. Preserve original recordings and keep provider/model/settings/date
when known; never invent missing metadata. Measure supplied speech and pauses,
then align scene changes, emphasis and cues. Do not truncate words to fit an
assumed duration. The [recipe reference](references/recipe-format.md) explains
the supplied-recording handoff.
An end card is optional and project-specific; time its arrival to the invitation
and finish after necessary speech/logo/click events, without an arbitrary tail.

## Package publication materials

For a finished-video handoff, use these publication defaults unless the current
project explicitly requests a different format:

- **Cover:** extract a representative, readable frame from the actual final
  encoded video being delivered. Keep the in-film composition and text. Do not
  substitute a storyboard still, separate illustration, collage or redesigned
  poster. Avoid half-finished transitions, motion blur and incomplete text.
  Record the source video/version and selected timestamp or frame in the
  existing delivery notes; choose again if that video changes.
- **Caption:** one short, curiosity-provoking question, optionally followed by
  one brief intriguing sentence, plus a few topic-relevant hashtags. Keep the
  answer in the film; omit explanatory paragraphs, narration summaries and an
  automatic follow CTA. Project-specific brand tags come from that project.

Before handoff, check both the cover's source frame in this delivered video and
the caption's short format. A successful encode does not complete these checks.

## Review evidence and improve gradually

Inspect encoded output at its intended size and at normal speed. Check action
and transitions in playback; compare type/materials against actual reference
frames. Listen to the actual mix before claiming pronunciation, ambience balance
or hearing acceptance. Technical reports, dense stills and LUFS are useful
checks, not substitutes for watching or listening. Unobserved criteria remain
unreviewed; record the limitation without fabricating scores or requesting a
user review repeatedly just to close a technical checklist.

Record user feedback with version and timestamp, one improvement goal and the
observed result. Preserve a visually accepted detail level; fix comprehension,
readability or rhythm before adding polish. Numeric targets apply only when
explicitly requested, not as a universal 8.5 gate. Keep artistic, motion, audio,
style and technical judgments separate. Recheck affected evidence when the
recipe, media, assets or effective code changes. Report actual token usage only
when measured; text size and elapsed time are different metrics.
