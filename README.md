# Illustrated 2.5D Motion

A reusable Codex skill for illustrated 2.5D motion videos: layered artwork,
independent object animation, clear staging, narration timing and consistent
visual direction across topics and brands.

The style is the reusable core. Your project supplies its subject, references,
brand, palette, typography, narration and optional ending. No weather subject,
character, publisher logo, voice provider or Follow animation is required.

## Install

Clone the complete repository as a skill folder:

```bash
git clone --branch main https://github.com/smmtaheri/illustrated-2-5d-motion.git \
  "${CODEX_HOME:-$HOME/.codex}/skills/illustrated-2-5d-motion"
cd "${CODEX_HOME:-$HOME/.codex}/skills/illustrated-2-5d-motion"
```

For the local native renderer, install Python 3, Node.js/npm, FFmpeg and ffprobe,
then install the pinned Node dependency:

```bash
npm ci
```

Optional narration assembly and extended audio/image analysis use `numpy` and
`Pillow` in the active Python environment; basic compilation and rendering do
not require them. Install `numpy==2.3.5 Pillow==13.0.0` only for those helpers.

The readable engine source includes reusable primitives and dependency assets.
Optional speech or image services require their own available tools and
configuration; this repository does not include credentials or promise a
particular provider.

## Use

Invoke the skill in Codex:

```text
Use $illustrated-2-5d-motion to plan a 30-second video about how a pressure valve
works. Use English narration, a muted blue/cream illustrated palette, layered
cutaway views and my supplied brand assets. Prepare the storyboard and narration
copy first; wait for my recorded voice before rendering.
```

Start with [SKILL.md](SKILL.md), then use the
[art-direction guide](references/art-direction.md) when planning a new film.
See [the recipe reference](references/recipe-format.md) for a minimal local
example, supported layer fields, validation and narration handoff.

The native renderer uses Python, Node/Canvas and FFmpeg, with portrait 9:16 as its
current baseline. It is a code-assisted creative workflow, not a one-command
model that automatically turns any prompt into a finished film. New subjects can
need new artwork and mechanism animation. Other aspect ratios or renderers need
their own adaptation and verification.

## Keep projects separate

Store raw voice, project inputs, recipes, working renders and delivered videos in
a separate project workspace, or the ignored `projects/` directory. Keep versioned
inputs and outputs locally. The skill repository contains reusable instructions,
engine resources and helpers; it excludes production episodes, reference reels,
private narration and generated deliverables.

Visual, motion, audio and technical review are separate. A valid encode does not
prove style fidelity or listening acceptance. Preserve what the user approves and
improve one concrete aspect at a time; no automatic numeric quality threshold
blocks ordinary production.

Before committing changes, run `python3 scripts/verify_repository.py --history`
to check paths, shared-library hashes and historical files. It rejects production
media and archives, including files that were force-added despite `.gitignore`.

For a bounded technical installation check, run `python3 scripts/smoke_test.py`
after `npm ci`. It uses temporary external projects and short local probes,
checks palette pixels, frame determinism, Persian text, narration handoff and
audio muxing, then removes all fixtures. The audio fixture is a synthetic signal,
not a voice-quality or listening test.
