#!/usr/bin/env python3
"""analyze_video.py -- 参考视频分析（结构化数据 + 关键帧；判断交给模型）。

工具链与上游一致：yt-dlp（URL 下载）+ PySceneDetect（场景切分）+ ffmpeg（关键帧）。
本脚本是工具编排（自有实现），输出单个 JSON brief 到 stdout。

用法：
  python analyze_video.py --video <本地文件或 URL> --out-dir <工程 analysis 目录> [--max-keyframes 12]

依赖：pip install scenedetect[opencv] yt-dlp（URL 下载时）；ffmpeg 在 PATH。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def ffprobe_meta(video: str) -> dict:
    r = run(["ffprobe", "-v", "error", "-show_entries",
             "stream=width,height,avg_frame_rate:format=duration", "-of", "json", video])
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe 失败：{r.stderr[-400:]}")
    j = json.loads(r.stdout)
    st = (j.get("streams") or [{}])[0]
    fps = 30.0
    fr = str(st.get("avg_frame_rate") or "30/1")
    a, _, b = fr.partition("/")
    try:
        if float(b):
            fps = float(a) / float(b)
    except ValueError:
        pass
    return {"duration": float(j.get("format", {}).get("duration") or 0),
            "width": int(st.get("width") or 0), "height": int(st.get("height") or 0),
            "fps": round(fps, 2)}


def detect_scenes(video: str) -> list[dict]:
    """PySceneDetect ContentDetector（默认阈值 27，最短镜头 1s）。"""
    try:
        from scenedetect import ContentDetector, SceneManager, open_video
    except ImportError as e:
        raise RuntimeError("缺少 PySceneDetect：python -m pip install scenedetect[opencv]") from e
    video = open_video(video)
    sm = SceneManager()
    sm.add_detector(ContentDetector(min_scene_len=round(video.frame_rate)))  # ≈1s
    sm.detect_scenes(video, show_progress=False)
    scenes = []
    for i, (start, end) in enumerate(sm.get_scene_list()):
        scenes.append({"index": i, "start": round(start.seconds, 2),
                       "end": round(end.seconds, 2),
                       "duration": round(end.seconds - start.seconds, 2)})
    return scenes


def pacing_label(scenes: list[dict]) -> str:
    if len(scenes) <= 1:
        return "连续无切（运镜/动画类）"
    avg = sum(s["duration"] for s in scenes) / len(scenes)
    if avg < 1.5:
        return "rapid_fire（快切，<1.5s/镜头）"
    if avg < 3:
        return "dynamic_social（动态社交节奏）"
    if avg < 6:
        return "steady_educational（稳定讲解节奏）"
    return "slow_contemplative（慢叙事长镜头）"


def extract_keyframes(video: str, scenes: list[dict], kf_dir: Path, max_kf: int, depth: str = "standard") -> list[dict]:
    stamps: list[float] = []
    for s in scenes:
        stamps.append(round(s["start"] + 0.1, 2))
        if s["duration"] > 3.0:  # 长镜头才取中点，短切本身已是信息
            stamps.append(round(s["start"] + s["duration"] / 2, 2))
        if depth == "deep" and s["duration"] > 6.0:  # 深度档：长镜头加 1/4、3/4 点
            stamps.append(round(s["start"] + s["duration"] * 0.25, 2))
            stamps.append(round(s["start"] + s["duration"] * 0.75, 2))
    stamps = sorted(set(stamps))
    # 无切/极少切视频（连续运镜动画类）：回退均匀采样，保证覆盖全片
    if len(stamps) < min(6, max_kf):
        n = min(max_kf, 15)
        dur = scenes[-1]["end"] if scenes else 0
        stamps = sorted({round(dur * i / (n + 1), 2) for i in range(1, n + 1)})
    step = max(1, len(stamps) // max_kf + (1 if len(stamps) % max_kf else 0))
    picked = stamps[::step][:max_kf]
    kf_dir.mkdir(parents=True, exist_ok=True)
    out = []
    for i, t in enumerate(picked):
        f = kf_dir / f"kf_{i:02d}.jpg"
        r = run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", video,
                 "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "5", str(f)])
        if r.returncode != 0 or not f.exists():
            continue
        sc = next((s for s in scenes if s["start"] <= t < s["end"]), None)
        out.append({"file": f"{kf_dir.name}/{f.name}", "t": t, "scene": sc["index"] + 1 if sc else None})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, help="本地视频路径或 http(s) URL")
    ap.add_argument("--out-dir", required=True, help="工程 analysis 输出目录")
    ap.add_argument("--max-keyframes", type=int, default=20)
    ap.add_argument("--depth", choices=["basic", "standard", "deep"], default="standard")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    video = args.video
    downloaded = False
    if re.match(r"^https?://", video):
        if not shutil.which("yt-dlp"):
            print(json.dumps({"error": "URL 解析需要 yt-dlp：python -m pip install yt-dlp（或改传本地文件）"}))
            return 1
        r = run(["yt-dlp", "-f", "bv*[height<=720]+ba/b[height<=720]", "--merge-output-format", "mp4",
                 "-o", str(out_dir / "ref.%(ext)s"), "--no-playlist", video], timeout=1800)
        got = sorted(out_dir.glob("ref.*"))
        got = [g for g in got if g.suffix != ".part"]
        if r.returncode != 0 or not got:
            print(json.dumps({"error": f"yt-dlp 下载失败：{(r.stderr or r.stdout)[-400:]}"}))
            return 1
        video, downloaded = str(got[0]), True

    if not Path(video).exists():
        print(json.dumps({"error": f"本地文件不存在：{video}"}))
        return 1

    meta = ffprobe_meta(video)
    scenes = detect_scenes(video)
    keyframes = extract_keyframes(video, scenes, out_dir / "keyframes", max(4, min(24, args.max_keyframes)), args.depth)
    brief = {
        "source": args.video, "file": str(Path(video).relative_to(out_dir.parent) if downloaded else video),
        "downloaded": downloaded,
        "depth": args["depth"] if isinstance(args, dict) else args.depth,
        "duration": meta["duration"], "resolution": f'{meta["width"]}x{meta["height"]}', "fps": meta["fps"],
        "scene_count": len(scenes),
        "avg_scene_len": round(sum(s["duration"] for s in scenes) / len(scenes), 2) if scenes else meta["duration"],
        "pacing": pacing_label(scenes),
        "scenes": scenes, "keyframes": keyframes,
        "note": "关键帧在 analysis/keyframes/，可再读单帧细看；风格/钩子/结构判断由模型完成。",
    }
    (out_dir / "video-brief.json").write_text(json.dumps(brief, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(brief, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
