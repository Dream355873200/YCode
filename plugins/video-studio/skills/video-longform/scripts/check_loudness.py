#!/usr/bin/env python3
"""check_loudness.py -- 长片逐章响度检查（video-longform 验收工具）。

用法：
  python check_loudness.py out/film.mp4 0:00 0:30 3:00 3:15 6:00 9:00 11:30
  python check_loudness.py out/film.mp4 --plan storyboard-chapters.tsv

  直接跟一组时间点（HH:MM:SS / MM:SS / 秒），相邻两点构成一章；
  或 --plan 读两列 TSV（起,止），行 = 章。

输出每章 Integrated LUFS，并判定章节间响度差是否 < 2 LUFS（超过即"拼接感"）。
依赖：系统 ffmpeg（ Loudness 用 ebur128 滤镜测量，无需 python 依赖）。
"""
import json
import re
import subprocess
import sys


def to_sec(t: str) -> float:
    t = t.strip()
    if ':' in t:
        parts = [float(x) for x in t.split(':')]
        sec = 0.0
        for x in parts:
            sec = sec * 60 + x
        return sec
    return float(t)


def chapter_lufs(video: str, start: float, end: float) -> float | None:
    dur = max(0.5, end - start)
    r = subprocess.run(
        ['ffmpeg', '-hide_banner', '-nostats',
         '-ss', f'{start:.2f}', '-t', f'{dur:.2f}', '-i', video,
         '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
        capture_output=True, text=True)
    m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', r.stderr, re.S)
    if not m:
        return None
    try:
        return float(json.loads(m.group(0))['input_i'])
    except (KeyError, ValueError):
        return None


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    video = sys.argv[1]
    chapters: list[tuple[float, float]] = []
    if sys.argv[2] == '--plan':
        for line in open(sys.argv[3], encoding='utf-8'):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            a, b = line.split(',')[:2]
            chapters.append((to_sec(a), to_sec(b)))
    else:
        ts = [to_sec(x) for x in sys.argv[2:]]
        chapters = list(zip(ts, ts[1:]))
    if not chapters:
        print('没有章节'); return 1

    print(f'{"章节":>6} {"区间":>16} {"Integrated LUFS":>16}')
    vals = []
    for i, (a, b) in enumerate(chapters):
        v = chapter_lufs(video, a, b)
        vals.append(v)
        print(f'{i + 1:>6} {a:>7.1f}-{b:<7.1f} {v if v is not None else "测量失败":>16}')

    good = [v for v in vals if v is not None]
    if len(good) < 2:
        print('\n可用测量不足 2 章，无法判定'); return 1
    spread = max(good) - min(good)
    verdict = 'PASS（章节间响度一致）' if spread < 2 else f'FAIL（章节间差 {spread:.1f} LUFS ≥ 2，有拼接感——回 video-audio 重出整条配乐）'
    print(f'\n章节间最大响度差：{spread:.1f} LUFS → {verdict}')
    return 0 if spread < 2 else 2


if __name__ == '__main__':
    sys.exit(main())
