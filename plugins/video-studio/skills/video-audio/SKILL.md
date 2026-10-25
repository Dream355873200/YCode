---
name: video-audio
description: 视频配乐与音效（mgaudio 合成器，numpy/numba 合成 + CC0 采样，确定性、自动母带到 -14 LUFS）：成片渲染前做声音、用户要「配乐/音效/卡点声音」、或渲染出的片子没有音轨时使用。含风格→配方映射、cue 表写法、manifest 接线与验收。
---

# 视频音频（mgaudio）

合成器位置：`<插件目录>/lib/audio/`（mg-styles-15 项目 MIT 授权收编；采样 CC0 VCSL）。
48 kHz 立体声、纯 numpy/numba 合成（带限振荡器/TPT 滤波/Karplus-Strong/FM）+ pedalboard 母链，
10 秒混音 3–8 秒渲完，**完全确定性（seed 固定则结果一致）**。产物自动母带：-14 LUFS、
真峰值 ≤ -1.1 dBTP、首尾自带淡入淡出——**不要再在 Remotion 端二次淡入淡出或压音量**。

## 什么时候用（参考工具，非强制）

- 用户想要配乐/音效/卡点声音，或点名「紧张感/科技感声音」等氛围时；
- 无声成片完全合理——是否加声音按用户需求和题材定，不主动强制。
- 长片（3 分钟以上）配乐同样走本技能：`duration=全片长` 一次生成，
  `energy` 曲线按章节表标——模板见 `templates/`（cues.example.json +
  soundtrack.example.py，改插件路径即用）。

## 一次性环境

`python -m pip install -r <插件目录>/lib/audio/requirements.txt`
（numpy/scipy/soundfile/numba/pedalboard/pyloudnorm；numba 首次导入 JIT 编译稍慢属正常。）

## 工作流

1. **从 manifest 出 cue 表**（秒，建议写到 audio/cues.json 供画面声音同源对齐）：`drop` = 高潮场景的中点；`outro` = 末场景的起点；
   各场景的 `from/duration` 换算成秒就是 sfx 挂点（场景切换 = transition whoosh、
   元素入场 = pop/tick、图表完成 = ding、标题 = impact/text_hit）。**把时间写成一个
   `audio/cues.json`**，画面和声音读同一份——这是对齐的根本。
2. **写 `audio/soundtrack.py`**：
   ```python
   import sys, json, os
   sys.path.insert(0, r"<插件目录>\lib\audio")   # 用插件绝对路径
   import mgaudio as mg
   from mgaudio import recipes, sfx, drums
   C = json.load(open(os.path.join(os.path.dirname(__file__), 'cues.json'), encoding='utf-8'))
   m = recipes.pop(drop=C['drop'], outro=C['outro'])       # 配方见下表，hits=C['hits'] 可拟合 bpm
   m.sfx(sfx.impact('punch', size=0.8), at=C['hero'], gain=-3)
   m.sfx(sfx.whoosh(0.7), at=C['transition'], gain=-6)
   m.export(os.path.join(os.path.dirname(__file__), '..', 'public', 'audio', 'soundtrack.wav'),
            spectrogram=os.path.join(os.path.dirname(__file__), 'qc.png'))
   ```
   **常用配方参数**：`bpm=None`（默认或按 hits 拟合）、`key/mode/prog`（和弦进行，
   罗马数字或 'Am F C G'）、`energy=[(t,0..1),…]` 强度曲线、`final` 段落时间。
   通读 `lib/audio/README.md`（配方表、sfx 家族表、Mix API 全在这）再动手。
3. **跑 `python audio/soundtrack.py`**，然后**看 `audio/qc.png` 频谱 + 读返回的 warnings**——
   这一步等价于 inspect_frames，不看不算完成。
4. **接线 manifest**（母带是成品，别二次处理）：
   ```json
   "audio": { "music": { "src": "audio/soundtrack.wav", "volume": 1, "fadeIn": 0, "fadeOut": 0, "duck": 1, "loop": false } }
   ```
   有配音（scenes[].voiceover）时 `duck` 改 0.35 让音乐自动闪避人声。
5. **渲染验收**：`ffprobe -show_streams` 确认成片含音轨、时长与画面一致；durationInFrames
   与 wav 时长不匹配时以 manifest 时长为准重渲 wav（`duration=` 参数）。

## 风格 → 配方映射（必须按风格选）

| 我们的风格 | 配方 | 备注 |
|---|---|---|
| flat-vector、soft-3d | `recipes.pop` | EDM-pop，supersaw drop |
| line-art | `recipes.ambient` | `flavor='piano'`，72 bpm |
| isometric-city、sticker-explainer | `recipes.explainer` | marimba 科技底，112 bpm |
| cel-boil | `recipes.lofi` | jazz pizzicato 气质，`keys='rhodes'` |
| collage | `recipes.lofi` | `flavor='boombap'`, `vinyl=True` |
| liquid、shape-morph | `recipes.future_bass` | `gap=True` 预 drop 静默 |
| bauhaus | `recipes.techno` | 极简 click，一动作一击 |
| synthwave | `recipes.synthwave` | gated 军鼓+锯齿贝斯 |
| aurora-glass | `recipes.ambient` | `flavor='glass'` |
| pixel-mg | `recipes.chiptune` | 150 bpm |

其余 59 个 Lemo 风格**按分类映射**（分类见 style.json 的 category_cn），个性差异用配方参数和 sfx 调出来：

| Lemo 分类 | 配方 | 调参与 sfx 个性 |
|---|---|---|
| 东方传统（水墨/浮世绘/皮影/纸雕灯/剪纸） | `guofeng` | `flavor='classical'`、`dizi=True`；古筝 `pluck.guzheng`、鼓 `drums.taiko/gong`、木鱼 `woodblock('muyu')`；剪纸 modern 用 `flavor='modern'` |
| 电影与时代（默片/新闻影片/构成主义蒙太奇/延时交响） | `lofi` | `flavor='chill'`, `vinyl=True`；默片配钢琴 + 胶片噪声 `static('film')`、手摇 `head_switch`；蒙太奇换 `techno` 加工业感 |
| 剪辑与纪实（新闻包装/字幕新闻/实机录屏/倒计时） | `explainer` | 新闻加 `drums.snare('tight')` 军鼓层 + `ui('notify')`；倒计时用 `techno` + tick 每秒 |
| 实证影像（显微/卫星/点云/视觉调查/产品拆解） | `ambient` | `flavor='product'`；加 `data_chirp`/`hud_scan`/`ui('hover')` 科学仪器感 |
| 信息与发布（蓝图/等距信息图/暗色发布/数据叙事/简报板） | `explainer`（暗色发布换 `darksynth`） | blueprints 加 `pen('marker')`、图纸展开 `paper('slide')`；dark-keynote 用 `darksynth` + `riser` |
| 手绘与绘画（一笔画/白板/钢笔淡彩/水彩/蜡笔） | `ambient` | `flavor='piano'`；白板加 `pen('marker', strokes=[…])` 随笔画走、蜡笔换 `lofi` `keys='rhodes'` |
| 图形与排版（装饰艺术/瑞士动态排版/一笔画之外） | `pop`（瑞士排版换 `techno` 极简） | 装饰艺术 `darksynth` + `shimmer_hit` 金光感；瑞士用 `techno` 118 bpm 克制版 |
| 印刷与版画（铜版/riso/丝印/木刻） | `lofi` | `vinyl=True`；riso 加 `bitcrush_burst` 印刷故障点缀 |
| 材质与 3D（玻璃产品/低多边形/HD-2D/白模投影） | `ambient` | `flavor='glass'`（玻璃）/ `flavor='product'`（低多边形换 `pop` 活泼版） |
| 游戏（像素 RPG/微游戏快闪/后室） | `chiptune` | 后室换 `glitch_hop` + `digital_noise` 氛围；微游戏加 `coin/jump/powerup` 密集挂点 |
| 卡通与动画（赛璐璐/中世纪卡通/橡皮管/科幻卡通） | `pop` 或 `lofi` | 卡通音效密集挂点：`boing/sproing/duang/slide_whistle/cork_pop` 随动作；赛璐璐夜城用 `synthwave` 降 bpm |

调参优先级：**配方定气质，参数定个性，sfx 定风格**——同一个 `lofi`，剪纸加 `flavor='boombap'`
就是拼贴，默片加钢琴+胶片噪声就是默片。拿不准时先按上表选配方渲一版听 qc 频谱，再微调。

## SFX 速查（全部自动响度归一，`gain` 只表达意图：-6 克制 / +2 主角击）

- 转场：`transition(dur,'whoosh_hit'|'riser_hit'|'reverse_hit')` · `whoosh(dur,kind,direction)`
- 冲击：`impact('punch'|'cinematic'|'thud'|'soft', size)` · `boom` · `reverse_cymbal` · `riser(dur)`
- UI/科普：`pop` · `blip(note)` · `click` · `ding(note)` · `ui('confirm'|'error'|'notify')` · `tick`
- 液态：`bubble/drip/gloop/splash/squelch/morph` · 纸桌：`paper/tape_rip/sticker_slap/stamp/typewriter/scissors`
- 故障/复古：`glitch` · `stutter` · `vhs_noise` · `head_switch` · `crt_on/off` · `tape_stop` · `vinyl`
- 科幻：`laser` · `hud_beep` · `lock_on` · `hud_scan` · 卡通：`boing/sproing/duang/slide_whistle/cork_pop`
- 8-bit：`coin/jump/powerup/explosion_8bit` · 文字：`text_hit('slam'|'flash'|'pop')`
- 音画同步约定：**sync 点就是视觉事件时刻**——撞击类对瞬态、whoosh 对经过峰、riser/reverse
  类对其结尾的 hit，直接传画面事件时间，不要自己算偏移。
- 调性 sfx（`ding/shimmer_hit/sparkle(key=…)`）用 `m.form.chord_at(t)` 保持调内。

## 常用进阶（都写在 lib/audio/README.md §5）

`m['lead'].mute = True` 静音某轨 · `t.automate('gain'|'lpf'|'pan', [(t,v),…])` ·
`t.duck(by='kick')` 侧链泵 · `m.tape_stop(at,dur)` / `m.stutter(at,dur)` 区域效果 ·
`m.master_kw.update(warmth=…, air=…)` 母带风味 · `m.report()` 各轨响度表。

## 边界

- 本技能只管"做出声音文件并接进工程"；流程（check → inspect → 交付）与工具仍按主规则。
- 成片不需要对外署名（CC0 采样 + MIT 代码）。
