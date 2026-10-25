#!/usr/bin/env python3
"""soundtrack.example.py -- 长片配乐生成示例（video-audio）。

从 cues.json（章节表 + 音效挂点）一次生成整条母带。
用法：把本文件与 cues.json 一起复制到工程 audio/ 下，改插件路径后：
  python audio/soundtrack.py
产出 public/audio/soundtrack.wav（-14 LUFS / TP ≤ -1.1 dBTP，自带首尾淡入淡出）
与 audio/qc.png 频谱图。**必须看 qc.png 和返回的 warnings 才算完成。**
"""
import json
import os
import sys

PLUGIN_LIB = r"<插件目录>\lib\audio"  # 改成实际路径，如 E:\amobileCreater\plugins\video-studio\lib\audio
sys.path.insert(0, PLUGIN_LIB)
import mgaudio as mg  # noqa: E402
from mgaudio import recipes, sfx  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
C = json.load(open(os.path.join(HERE, 'cues.json'), encoding='utf-8'))
DURATION = C['outro'] + 2.0  # 尾声后再留 2 秒收尾

# 1) 配方按风格选（映射表见 SKILL.md）；duration 传全片长，整条生成不拼接
m = recipes.pop(duration=DURATION, drop=C['drop'], outro=C['outro'])
m.form  # 节拍网格已锚定 bar0 = drop

# 2) 能量曲线：按章节表做增益自动化（e∈[0,1] 映射到 -14..-4 dB；具体口味渲一版听 QC 再调）
energy = [(c['t'], -14 + 10 * c['energy']) for c in C['chapters']]
m.group('music').automate('gain', energy)

# 3) 音效按 cue 挂点（sync 点 = 视觉事件时刻）
for s in C['sfx']:
    snd = eval('sfx.' + s['sound'])  # cues.json 里的 sound 写成可直接调用的 sfx 表达式
    m.sfx(snd, at=s['at'], gain=s.get('gain', -6))

# 4) 导出 + QC
wav = os.path.join(HERE, '..', 'public', 'audio', 'soundtrack.wav')
res = m.export(wav, spectrogram=os.path.join(HERE, 'qc.png'))
print('warnings:', res.get('warnings') if isinstance(res, dict) else res)
print('母带完成：', wav)
