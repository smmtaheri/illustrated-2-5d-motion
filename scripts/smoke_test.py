#!/usr/bin/env python3
"""Exercise the portable engine with temporary, non-production fixtures."""
from __future__ import annotations

from array import array
import copy
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import wave


ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "engine/scripts"


def run(args: list[str], expected: int = 0) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=90)
    if result.returncode != expected:
        raise RuntimeError(f"Command returned {result.returncode}: {args[0]}\n{result.stdout}\n{result.stderr}")
    return result


def main() -> int:
    source = (ROOT / "references/recipe-format.md").read_text()
    recipe = json.loads(re.search(r"```json\n(.*?)\n```", source, re.S)[1])
    recipe["width"] = 360
    checks = []
    with tempfile.TemporaryDirectory(prefix="illustrated-motion-smoke-") as temp:
        folder = Path(temp)  # Deliberately outside the installed skill directory.

        def compile_case(name: str, value: dict) -> Path:
            case = folder / name
            case.mkdir()
            spec = case / "recipe.json"
            spec.write_text(json.dumps(value, ensure_ascii=False))
            project = case / "compiled"
            run([sys.executable, str(ENGINE / "compile_scenario.py"), "--recipe", str(spec), "--out", str(project)])
            return project

        palette = copy.deepcopy(recipe)
        layers = palette["shots"][0]["layers"]
        layers[-1]["fill"] = "#1BB559"
        layers[-1]["material"].update(tone="slate", grain=0, lip=0)
        second = copy.deepcopy(layers[-1])
        second.update(id="second-color", x=390, y=380, fill="#9746BD")
        layers.append(second)
        project = compile_case("external-palette", palette)
        javascript = r'''
const root=process.argv[1],plan=process.argv[2];
const path=require('node:path'),crypto=require('node:crypto');
process.env.NODE_PATH=path.join(root,'node_modules');require('node:module').Module._initPaths();
(async()=>{
 const p=await require(path.join(root,'engine/scripts/scene_runtime.cjs')).createProject(plan);
 const hash=c=>crypto.createHash('sha256').update(c.toBuffer('image/png')).digest('hex');
 const sample=(x,y)=>Array.from(p.canvas.getContext('2d').getImageData(Math.round(x*p.width/540),Math.round(y*p.height/960),1,1).data);
 const first=hash(p.renderFrame(0)),green=sample(150,490),purple=sample(390,380);
 p.renderFrame(29);const repeated=hash(p.renderFrame(0));
 console.log(JSON.stringify({same:first===repeated,green,purple}));
})().catch(e=>{console.error(e);process.exit(1);});'''
        pixels = json.loads(run(["node", "-e", javascript, str(ROOT), str(project / "plan.json")]).stdout)
        assert pixels["same"], "Frame evaluation depends on render order"
        green, purple = pixels["green"], pixels["purple"]
        assert green[1] > green[0] + 40 and green[1] > green[2] + 20, pixels
        assert purple[0] > purple[1] + 20 and purple[2] > purple[1] + 40, pixels
        output = folder / "external-probe"
        run(["node", str(ENGINE / "render_project.cjs"), "--plan", str(project / "plan.json"),
             "--out", str(output), "--probe", "--seconds", "2", "--picture-only"])
        probe = json.loads(run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                               "stream=nb_frames,width,height", "-of", "json", str(output / "picture.mp4")]).stdout)
        assert probe["streams"][0]["nb_frames"] == "60", probe
        checks.extend(["external-project-dependencies", "declared-palette-pixels", "frame-order-independence", "two-second-encode"])

        persian = copy.deepcopy(recipe)
        persian["language"] = {"overall": "fa"}
        persian["typography"] = {"regular": "NotoSansArabic-Regular.ttf", "bold": "NotoSansArabic-Bold.ttf", "licenses": ["LICENSE-Noto.txt"]}
        persian["audio"] = {"voice_delivery": "user"}
        persian["shots"][0]["voice"] = "این قِطعِه حَرَکَت می‌کُنَد."
        persian["shots"][0]["title"] = {"lines": [["حَرَکَتِ قِطعِه"]]}
        pending = compile_case("pending-recording", persian)
        handoff = json.loads((pending / "voice-handoff.json").read_text())
        assert handoff["beats"][0]["text"] == persian["shots"][0]["voice"]
        graph = (pending / "scenes.json").read_text()
        assert "حَرَکَتِ" not in graph, "Spoken diacritics leaked into display copy"
        rejected = run(["node", str(ENGINE / "render_project.cjs"), "--plan", str(pending / "plan.json"),
                        "--out", str(folder / "blocked"), "--probe", "--seconds", "2"], expected=1)
        assert "pending" in rejected.stderr and not (folder / "blocked").exists()
        run(["node", str(ENGINE / "render_project.cjs"), "--plan", str(pending / "plan.json"),
             "--out", str(folder / "persian-picture"), "--probe", "--seconds", "1", "--picture-only"])
        checks.extend(["persian-custom-font-render", "voice-handoff-preserves-spoken-text", "pending-audio-blocked-before-encode"])

        narrated = copy.deepcopy(persian)
        narrated["audio"] = {"mode": "narrated"}
        ready = compile_case("narrated-fonts", narrated)
        script = json.loads((ready / "voice-script.json").read_text())
        assert isinstance(script["beats"], list) and script["beats"][0]["text"] == narrated["shots"][0]["voice"]
        # Local synthetic signal checks muxing only. It is not recorded speech.
        rate = 16000
        samples = array("h", (round(1200 * math.sin(2 * math.pi * 440 * i / rate)) for i in range(3 * rate)))
        if sys.byteorder != "little":
            samples.byteswap()
        with wave.open(str(ready / "narration.wav"), "wb") as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(rate); audio.writeframes(samples.tobytes())
        run(["node", str(ENGINE / "render_project.cjs"), "--plan", str(ready / "plan.json"),
             "--out", str(folder / "audio-probe"), "--probe", "--seconds", "1"])
        assert (folder / "audio-probe/final.mp4").is_file()
        checks.extend(["custom-font-narration-beat-list", "supplied-audio-mux"])
    print(json.dumps({"status": "pass", "checks": checks,
                      "scope": "Temporary technical fixtures only. No production film, voice provider, external audio service or perceptual/listening claim."}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
