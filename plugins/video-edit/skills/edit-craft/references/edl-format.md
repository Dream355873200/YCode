# edl.json 字段全本

剪辑决策表，项目根一个 `edl.json`。完整示例见 `templates/edl.example.json`。

## timeline

```json
{ "width": 1920, "height": 1080, "fps": 30 }
```

缺省 1920x1080@30。竖屏 1080x1920。所有素材自动规格化到这个画幅。

## cuts（时间线主体，按顺序播放）

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 建议 | 镜头标识，汇报时引用（如 c3） |
| `source` | 是 | 素材路径，相对项目根或 assets/（视频或图片） |
| `in` / `out` | 视频必填 | 入出点，秒。out > in，超过素材时长会被截断（校验会提醒） |
| `duration` | 图片必填 | 静帧在时间线上的时长，秒 |
| `speed` | 否 | 变速 0.25-4，缺省 1。影响镜头时长 = (out-in)/speed |
| `fit` | 否 | cover（默认，裁切铺满）/ contain（完整显示加黑边） |
| `animation` | 否 | 图片镜头的动画：static / ken_burns_in / ken_burns_out / pan_left / pan_right / zoom_slow。视频镜头不支持（校验提醒） |
| `transition` | 否 | `{ "type": "...", "duration": 0.4 }` 进入本镜头的转场。词表见 transitions.md；缺省硬切；duration 0-3 秒 |
| `reason` | 是（强约束） | 这一刀为什么存在，一句话。缺了校验会提醒，评分会扣分 |

镜头时长：视频 (out-in)/speed；图片 = duration。相邻镜头的转场会重叠（成片总时长 = 各镜头之和 − 各转场时长），校验结果里会给出准确总时长。

短于 0.3s 的镜头会被提醒——观众反应不过来。

## overlays（图片覆盖层，可选）

| 字段 | 说明 |
|---|---|
| `source` | 图片路径（logo、角标、花字图） |
| `from` / `to` | 出现窗口，秒 |
| `position` | top-left / top-right / bottom-left / bottom-right / center |
| `margin` | 距边距，像素，缺省画幅宽 3% |
| `opacity` | 0-1，缺省 1 |
| `scale` | 相对素材原尺寸的缩放，如 0.2；缺省原尺寸 |

## audio（三通道）

```json
{
  "music":    { "source": "bgm.mp3", "volume": 0.5, "fade_in": 1.0, "fade_out": 2.0, "ducking": true },
  "narration": [ { "source": "vo1.mp3", "at": 0.5 } ],
  "sfx":      [ { "source": "whoosh.mp3", "at": 2.0, "volume": 0.8 } ]
}
```

- `music.ducking` 默认开：旁白出现时音乐自动压低（阈值/压缩比已调好，不用管参数）
- `narration.at` 是旁白开始的时间点；长旁白切段后按段挂
- `sfx.at` 落在动作帧上（碰撞/转场中点/标题出现）
- 三个通道全空 = 无声成片，校验会提醒

注意：**素材的原声不进成片**。要某段原声（现场声、采访），先用 ffmpeg 提成独立音频放 assets/，再挂到 narration 通道对应时间点。

## subtitles（可选）

```json
{ "source": "subs.srt", "font_size": 14, "margin_v": 60, "outline": 2 }
```

SRT/ASS 均可，渲染时烧进画面。font_size 是 ASS 相对字号（1080p 下 14-18 常用）。

## 排刀心法

EDL 是决策记录，不是播放列表：review 工具会按「复读/静帧/节奏/文字依赖/声音动量/决策可见性」六维给这份决策打分，
方法见 SKILL.md 和 `pacing.md`。
