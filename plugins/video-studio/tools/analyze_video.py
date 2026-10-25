#!/usr/bin/env python3
"""analyze_video.py -- 参考视频分析（结构化数据 + 关键帧；判断交给模型）。

工具链：yt-dlp（URL 下载/字幕）+ PySceneDetect（场景切分）+ ffmpeg（关键帧/切片）
+ faster-whisper（本地转写，可选装）。输出单个 JSON brief 到 stdout。

档位：
  transcript_only  只拿文稿+元数据（YouTube 拉现成字幕；本地走 faster-whisper）——长视频首选
  standard         元数据 + 场景切分 + 关键帧（场景边界+中点）+ 节奏分档
  deep             长镜头（>6s）加 1/4、3/4 深采

长视频（>10 分钟）自动进概览层：场景表按窗口聚合（不返回全量明细）、关键帧
低频铺盖（1 帧/分钟，封顶 30）；配合 --from/--to 对感兴趣的区间做二次深查
（区间先 ffmpeg 精切再全流程分析）。

依赖：pip install scenedetect[opencv]；URL：yt-dlp；本地转写：faster-whisper。ffmpeg 在 PATH。
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

LONG_VIDEO_SECONDS = 600  # >10 分钟进概览层
OVERVIEW_WINDOW = 45      # 概览聚合窗口（秒）
OVERVIEW_KF_CAP = 30      # 概览层关键帧上限（≈1 帧/分钟）


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


def aggregate_windows(scenes: list[dict], duration: float, win: float = OVERVIEW_WINDOW) -> list[dict]:
    """场景明细 → 节奏地图（长片概览层）：每窗口镜头数/平均镜头长，不返回全量明细。"""
    windows = []
    t = 0.0
    while t < duration - 0.5:
        end = min(t + win, duration)
        seg = [s for s in scenes if s["start"] < end and s["end"] > t]
        avg = round(sum(s["duration"] for s in seg) / len(seg), 2) if seg else round(end - t, 2)
        windows.append({"start": round(t, 2), "end": round(end, 2), "scenes": len(seg), "avg_scene_len": avg})
        t = end
    return windows


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


def extract_keyframes(video: str, scenes: list[dict], kf_dir: Path, max_kf: int,
                      depth: str = "standard", duration: float | None = None) -> list[dict]:
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
        dur = duration or (scenes[-1]["end"] if scenes else 0)
        n = min(max_kf, 15)
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


def overview_keyframes(video: str, duration: float, kf_dir: Path) -> list[dict]:
    """概览层关键帧：1 帧/分钟，封顶 30——铺盖全片，不追求细节。"""
    n = min(OVERVIEW_KF_CAP, max(4, int(duration // 60) + 1))
    kf_dir.mkdir(parents=True, exist_ok=True)
    out = []
    for i in range(1, n + 1):
        t = round(duration * i / (n + 1), 2)
        f = kf_dir / f"ov_{i:02d}.jpg"
        r = run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", video,
                 "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "6", str(f)])
        if r.returncode == 0 and f.exists():
            out.append({"file": f"{kf_dir.name}/{f.name}", "t": t})
    return out


# ---------------- 文稿通道（长视频的信息主通道） ----------------

def parse_vtt(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    segs, cur = [], {}
    for block in re.split(r"\n\n+", text):
        lines = [l for l in block.splitlines() if l.strip()]
        for line in lines:
            m = re.match(r"(\d+):(\d+):(\d+)\.(\d+) --> ", line)
            if m:
                cur = {"t": round(int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) + int(m[4]) / 1000, 2)}
                continue
            if cur and "<" not in line and not line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")):
                txt = line.strip()
                if txt and (not segs or segs[-1]["text"] != txt):  # 去滚动字幕重复
                    cur["text"] = txt
                    segs.append(dict(cur))
    return segs


def fetch_transcript(video: str, is_url: bool, out_dir: Path) -> dict:
    """YouTube 拉现成字幕（yt-dlp，免下载视频）；本地走 faster-whisper（可选依赖）。"""
    if is_url:
        r = run(["yt-dlp", "--write-auto-sub", "--write-subs", "--sub-langs",
                 "zh-Hans,zh,en,ja", "--skip-download", "--no-playlist",
                 "-o", str(out_dir / "ref.%(ext)s"), video], timeout=900)
        vtts = sorted(out_dir.glob("ref*.vtt"))
        if not vtts:
            return {"available": False, "hint": "该视频无可拉取字幕——本地转写需下载后走 faster-whisper（pip install faster-whisper）"}
        return {"available": True, "source": "youtube-subs", "segments": parse_vtt(vtts[-1])}
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return {"available": False,
                "hint": "本地转写需要 faster-whisper：pip install faster-whisper（首次运行会下载模型）"}
    model = WhisperModel("small", device="cpu", compute_type="int8")
    segs_iter, _ = model.transcribe(video, vad_filter=True)
    segs = [{"t": round(s.start, 2), "text": s.text.strip()} for s in segs_iter if s.text.strip()]
    return {"available": True, "source": "faster-whisper:small", "segments": segs}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, help="本地视频路径或 http(s) URL")
    ap.add_argument("--out-dir", required=True, help="工程 analysis 输出目录")
    ap.add_argument("--max-keyframes", type=int, default=20)
    ap.add_argument("--depth", choices=["transcript_only", "basic", "standard", "deep"], default="standard")
    ap.add_argument("--from", dest="t_from", type=float, help="区间深查起点（秒，配合 --to；先精切再全流程分析）")
    ap.add_argument("--to", dest="t_to", type=float, help="区间深查终点（秒）")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    is_url = bool(re.match(r"^https?://", args.video))

    video = args.video
    downloaded = False
    if is_url and args.depth != "transcript_only":
        if not shutil.which("yt-dlp"):
            print(json.dumps({"error": "URL 解析需要 yt-dlp：python -m pip install yt-dlp（或改传本地文件）"}))
            return 1
        r = run(["yt-dlp", "-f", "bv*[height<=720]+ba/b[height<=720]", "--merge-output-format", "mp4",
                 "-o", str(out_dir / "ref.%(ext)s"), "--no-playlist", args.video], timeout=1800)
        got = [g for g in sorted(out_dir.glob("ref.*")) if g.suffix != ".part"]
        if r.returncode != 0 or not got:
            print(json.dumps({"error": f"yt-dlp 下载失败：{(r.stderr or r.stdout)[-400:]}"}))
            return 1
        video, downloaded = str(got[0]), True
    elif not is_url and not Path(video).exists():
        print(json.dumps({"error": f"本地文件不存在：{video}"}))
        return 1

    meta = ffprobe_meta(video)
    brief: dict = {"source": args.video, "file": str(Path(video).name if downloaded else video),
                   "downloaded": downloaded, "duration": meta["duration"],
                   "resolution": f'{meta["width"]}x{meta["height"]}', "fps": meta["fps"]}

    # ---- 区间深查：ffmpeg 精切出临时片段，之后当普通短片走全流程 ----
    if args.t_from is not None and args.t_to is not None:
        a, b = max(0, args.t_from), min(meta["duration"], args.t_to)
        cut = out_dir / "range.mp4"
        r = run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{a:.2f}", "-i", video,
                 "-t", f"{b - a:.2f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                 "-c:a", "aac", str(cut)], timeout=1200)
        if r.returncode != 0:
            print(json.dumps({"error": f"区间精切失败：{r.stderr[-300:]}"}))
            return 1
        video, downloaded = str(cut), True
        brief["range"] = {"from": a, "to": b}
        brief["file"] = "analysis/range.mp4"

    # ---- transcript_only：文稿通道，长视频首选 ----
    if args.depth == "transcript_only":
        tr = fetch_transcript(video, is_url, out_dir)
        brief["depth"] = "transcript_only"
        brief["transcript"] = tr
        if not tr.get("available"):
            brief["hint"] = tr.get("hint", "")
        (out_dir / "video-brief.json").write_text(json.dumps(brief, ensure_ascii=False, indent=1), encoding="utf-8")
        print(json.dumps(brief, ensure_ascii=False))
        return 0

    scenes = detect_scenes(video)
    long_video = meta["duration"] > LONG_VIDEO_SECONDS

    # ---- 长片概览层：场景聚合为节奏地图 + 低频关键帧；明细不进上下文 ----
    if long_video:
        windows = aggregate_windows(scenes, meta["duration"])
        keyframes = overview_keyframes(video, meta["duration"], out_dir / "keyframes")
        brief.update({"depth": "overview", "level": "概览层（长片）：节奏地图 + 低频关键帧；"
                      "对感兴趣的区间用 --from/--to 二次深查",
                      "window_seconds": OVERVIEW_WINDOW,
                      "scene_windows": windows, "keyframes": keyframes})
    else:
        keyframes = extract_keyframes(video, scenes, out_dir / "keyframes",
                                      max(4, min(24, args.max_keyframes)), args.depth,
                                      meta["duration"])
        brief.update({"depth": args.depth, "scene_count": len(scenes),
                      "avg_scene_len": round(sum(s["duration"] for s in scenes) / len(scenes), 2) if scenes else meta["duration"],
                      "pacing": pacing_label(scenes), "scenes": scenes, "keyframes": keyframes,
                      "note": "关键帧在 analysis/keyframes/，可再读单帧细看；风格/钩子/结构判断由模型完成。"})

    (out_dir / "video-brief.json").write_text(json.dumps(brief, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(brief, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
