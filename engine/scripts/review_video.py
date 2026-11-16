#!/usr/bin/env python3
"""Probe/decode a reel and produce timestamped visual review aids.

Require ffmpeg and ffprobe on PATH. Use Pillow for JPEG contact sheets when
available; always create a standalone local HTML contact sheet. Treat output
as technical evidence, never as proof of motion quality or style similarity.
"""

import argparse
from fractions import Fraction
import html
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys


def run(args):
    return subprocess.run(args, capture_output=True, text=True, check=False)


def positive(value):
    value = float(value)
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError("must be a finite positive number")
    return value


def planned_frame_indices(plan, fps, duration, step, limit):
    project = plan["project"]
    if fps <= 0 or abs(project["fps"]-fps) > 1e-6 or abs(project["duration_seconds"]-duration) > 1/fps:
        raise ValueError("The plan and complete encoded video clocks differ.")
    last = round(duration*fps)-1
    required = {0, last}
    for shot in plan["shots"]:
        first, end = (round(shot[key]*fps) for key in ("start", "end"))
        required.update((first-1, first, (first+end-1)//2))
        transition = shot.get("transition", "cut")
        if isinstance(transition, dict):
            span = round(transition.get("duration_seconds", 0)*fps)
            if span > 0:
                required.update((first+span//2, first+span))
    for event in plan.get("events", []):
        frame = round(event["time"]*fps)
        required.update((frame-1, frame, frame+2))
    required = {f for f in required if 0 <= f <= last}
    if len(required) > limit:
        raise ValueError(f"Use --max-frames at least {len(required)} for the planned boundaries.")
    extras = set(range(0, last, max(1, round(step*fps)))) - required
    spare = limit-len(required)
    if spare == 0:
        return sorted(required)
    if len(extras) > spare:
        ordered = sorted(extras)
        extras = {ordered[(i*len(ordered))//spare] for i in range(spare)}
    return sorted(required | extras)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--step", type=positive, default=1.0)
    source_interval = parser.add_mutually_exclusive_group()
    source_interval.add_argument("--range", dest="time_range", help="START:END seconds")
    source_interval.add_argument("--plan", type=Path, help="Sample exact cuts, transitions and events in the complete reel")
    parser.add_argument("--max-frames", type=int, default=90)
    parser.add_argument("--thumb-width", type=int, choices=(180, 270, 360, 540), default=180)
    parser.add_argument("--expected-width", type=int)
    parser.add_argument("--expected-height", type=int)
    parser.add_argument("--expected-fps", type=positive)
    parser.add_argument("--expected-duration", type=positive)
    parser.add_argument("--require-audio", action="store_true")
    args = parser.parse_args()
    if args.max_frames < 2:
        parser.error("--max-frames must be at least 2")
    if not args.video.is_file():
        parser.error("video does not exist")
    if not all(shutil.which(name) for name in ("ffmpeg", "ffprobe")):
        parser.error("ffmpeg and ffprobe are required on PATH")

    source = args.video.resolve()
    probe = run(["ffprobe", "-v", "error", "-show_format", "-show_streams",
                 "-of", "json", str(source)])
    if probe.returncode:
        parser.error("ffprobe failed: " + probe.stderr[-500:])
    data = json.loads(probe.stdout)
    streams = data.get("streams", [])
    videos = [s for s in streams if s.get("codec_type") == "video"]
    audios = [s for s in streams if s.get("codec_type") == "audio"]
    if not videos:
        parser.error("no video stream found")
    video = videos[0]
    rate = video.get("avg_frame_rate", "0/1")
    fps = float(Fraction(rate)) if rate != "0/0" else 0.0
    duration = float(video.get("duration") or data["format"]["duration"])
    start, end = 0.0, duration
    if args.time_range:
        try:
            start, end = map(float, args.time_range.split(":"))
        except ValueError:
            parser.error("--range must be START:END")
        if not (math.isfinite(start) and math.isfinite(end) and
                0 <= start < end <= duration + 0.05):
            parser.error("range must lie within video duration")
        end = min(end, duration)
    step = max(args.step, (end - start) / (args.max_frames - 1))

    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=True)
    # A new subdirectory prevents old extracted frames contaminating a rerun.
    import tempfile
    frames_dir = Path(tempfile.mkdtemp(prefix="frames-", dir=args.out))
    if args.plan:
        try:
            plan = json.loads(args.plan.read_text())
            wanted = planned_frame_indices(plan, fps, duration, step, args.max_frames)
        except (OSError, ValueError, KeyError, TypeError) as error:
            parser.error(str(error))
        expression = "select=" + "+".join(f"eq(n\\,{frame})" for frame in wanted)
    else:
        expression = f"select=isnan(prev_selected_t)+gte(t-prev_selected_t\\,{step:.9f})"
    extracted = run([
        "ffmpeg", "-nostdin", "-hide_banner", "-ss", str(start), "-i", str(source),
        "-t", str(end - start), "-vf", expression + f",scale={args.thumb_width}:-2,showinfo",
        "-frames:v", str(args.max_frames), "-fps_mode", "vfr", "-q:v", "3",
        str(frames_dir / "%04d.jpg"),
    ])
    frames = sorted(frames_dir.glob("*.jpg"))
    times = [start + float(t) for t in re.findall(
        r"\bn:\s*\d+\s+pts:.*?pts_time:([0-9.eE+-]+)", extracted.stderr)]
    times = times[:len(frames)]
    if len(times) != len(frames) or args.plan and len(frames) != len(wanted):
        parser.error("could not determine extracted frame timestamps")

    decode = run([
        "ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(source),
        "-map", "0:v:0", "-map", "0:a?", "-f", "null", "-",
    ])
    black = run([
        "ffmpeg", "-nostdin", "-hide_banner", "-i", str(source), "-an",
        "-vf", "blackdetect=d=0.12:pix_th=0.05:pic_th=0.98", "-f", "null", "-",
    ])
    intervals = [dict(zip(("start", "end", "duration"), map(float, m))) for m in
                 re.findall(r"black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)", black.stderr)]
    audio_levels = None
    if audios:
        measured = run([
            "ffmpeg", "-nostdin", "-hide_banner", "-i", str(source),
            "-map", "0:a:0", "-af", "volumedetect", "-vn", "-f", "null", "-",
        ])
        values = dict(re.findall(r"(mean_volume|max_volume):\s*([-\w.]+) dB", measured.stderr))
        audio_levels = {"analysis_succeeded": measured.returncode == 0, **values}

    errors = []
    for label, actual, expected in (
        ("width", video.get("width"), args.expected_width),
        ("height", video.get("height"), args.expected_height),
    ):
        if expected is not None and actual != expected:
            errors.append(f"{label}: expected {expected}, got {actual}")
    if args.expected_fps and abs(fps - args.expected_fps) > 0.01:
        errors.append(f"fps: expected {args.expected_fps}, got {fps}")
    tolerance = max(0.06, 1 / fps + 0.03) if fps else 0.1
    if args.expected_duration and abs(duration - args.expected_duration) > tolerance:
        errors.append(f"duration: expected {args.expected_duration}, got {duration}")
    if args.require_audio and not audios:
        errors.append("requested audio stream is missing")
    if decode.returncode:
        errors.append("full decode failed: " + decode.stderr[-400:])
    if extracted.returncode or not frames:
        errors.append("frame extraction failed: " + extracted.stderr[-400:])
    if audio_levels and audio_levels.get("max_volume") == "-inf":
        if args.require_audio:
            errors.append("requested audio appears entirely silent")

    items = []
    for frame, time in zip(frames, times):
        relative = frame.relative_to(args.out).as_posix()
        items.append(f'<figure><img src="{html.escape(relative)}"><figcaption>{time:.3f} s</figcaption></figure>')
    page = ('<!doctype html><meta charset="utf-8"><title>Video review</title>'
            '<style>body{background:#142033;color:#fff;font:14px sans-serif}'
            'main{display:grid;grid-template-columns:repeat(auto-fit,var(--tile));gap:12px}'
            'figure{margin:0}img{width:var(--tile);height:auto}figcaption{padding:5px}</style>'
            f'<body style="--tile:{args.thumb_width}px">'
            f'<h1>{html.escape(source.name)}</h1><p>Temporal samples; inspect actual motion separately.</p><main>'
            + ''.join(items) + '</main>')
    (args.out / "contact-sheet.html").write_text(page, encoding="utf-8")
    jpeg_sheet = None
    if frames:
        try:
            from PIL import Image, ImageDraw, ImageFont
            with Image.open(frames[0]) as first:
                cell_w, cell_h = first.size
            cols = min(6, len(frames))
            rows = math.ceil(len(frames) / cols)
            sheet = Image.new("RGB", (cols * (cell_w + 10), rows * (cell_h + 28)), "#142033")
            draw = ImageDraw.Draw(sheet)
            font = ImageFont.load_default()
            for i, (frame, time) in enumerate(zip(frames, times)):
                x, y = (i % cols) * (cell_w + 10), (i // cols) * (cell_h + 28)
                with Image.open(frame) as im:
                    sheet.paste(im, (x, y))
                draw.text((x + 4, y + cell_h + 5), f"{time:.3f} s", fill="white", font=font)
            jpeg_sheet = args.out / "contact-sheet.jpg"
            sheet.save(jpeg_sheet, quality=90)
        except ImportError:
            pass

    result = {
        "input": str(source), "technical_pass": not errors, "errors": errors,
        "video": {key: video.get(key) for key in ("codec_name", "width", "height", "pix_fmt")},
        "fps": fps, "duration_seconds": duration, "audio_streams": len(audios),
        "audio_levels_dbfs": audio_levels, "audio_listened_to": False,
        "possible_black_intervals": intervals,
        "black_analysis_succeeded": black.returncode == 0,
        "frame_times_seconds": times, "sampling_step_seconds": step, "thumb_width": args.thumb_width,
        "contact_sheet": str(jpeg_sheet) if jpeg_sheet else str(args.out / "contact-sheet.html"),
        "visual_style_verified": False,
        "note": "Inspect motion, meaning, attachments, sound and reference fidelity manually.",
    }
    (args.out / "qc.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"technical_pass": not errors, "errors": errors,
                      "frames": len(frames), "report": str(args.out / "qc.json")}, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
