# 剪辑间使用规则

1. 项目结构：项目根一个 `edl.json` + `assets/`（素材）+ `out/`（产物）。新项目先把素材归位 assets/，用 probe_media 逐个摸底（时长/分辨率/有没有声音），不摸底不排刀。
2. 素材没分析过不得排 EDL：来源或内容不明的素材，先用视频工坊的 analyze_video 做场景切分和关键帧分析（或 probe_media + view_image 逐个看），搞清每段素材里有什么、哪几秒可用，再动手排。
3. 先定节奏网格再排刀：按片种定每分钟镜头数档位（见 edit-craft 技能），每条 cut 必带 reason——一句话说清这一刀为什么存在（情绪/信息/呼吸/音乐转折）。说不出的镜头删掉。
4. 排完先 check_edl，全绿才 render_cut。第一次渲染用 quality=draft 看小样，确认节奏再出 final。
5. 交付前必须跑 cut_review：verdict 是 revise 或 fail 时，按维度原因改 EDL 重排，不是跳过检查。
6. 渲后终审是强制关：render_cut 返回里有时长偏差/音轨缺失就是失败，修 EDL 重渲，不要把问题成片给用户。
7. 转场用小词表：cut（硬切，默认）/fade/dissolve/wipe/slide/zoom。特效转场要有动机（音乐转折、时空跳转、段落切换），默认硬切。
8. 声音三通道：narration 按时间点对齐、music 默认开 ducking（旁白出现时自动压低）、sfx 只在关键动作点。打算全片无声时先问用户。
9. edit-craft 技能是方法参考不是强制：用户对节奏、结构有明确意图时按用户的来，技能只在没头绪时给你框架。
10. 素材原声默认不进成片（时间线由 audio 节统一指挥）；需要某段素材原声时，先用 ffmpeg 把它提出来放进 assets/，再挂到 narration/sfx 通道对应时间点。
