# -*- coding: utf-8 -*-
# 重建 mockup 对话流：思考（默认折叠可展开+计秒）穿插 + 行动按类型规范
import io, sys, re
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
p = 'docs/mockup/index.html'
s = io.open(p, encoding='utf-8').read()

start = s.find('<!-- 项目启动时的整体计划（已批准，物化为任务流） -->')
end_anchor = '<!-- 状态条：AI 正在干什么，且提示随时可插话 -->'
end = s.find(end_anchor)
assert start != -1 and end != -1, (start, end)

def act(verb, obj, st, st_cls, expand=False, detail=None, open_=False):
    cls = ('expand ' if expand else '') + ('open' if open_ else '')
    cls = cls.strip()
    h = '<div class="act%s"><span class="a-arrow"></span><span class="a-verb">%s</span><span class="a-obj">%s</span><span class="a-st %s">%s</span></div>' % (
        (' ' + cls) if cls else '', verb, obj, st_cls, st)
    if detail:
        h += '\n<div class="a-detail">%s</div>' % detail
    return h

def think(summ, body, time):
    return ('<div class="think">\n    <div class="think-head"><span class="th-arrow">▶</span>思考'
            '<span class="th-sum">%s</span><span class="th-time">%s</span></div>\n'
            '    <div class="think-body">%s</div>\n  </div>') % (summ, time, body)

DA = '<span class="d-add">'; DD = '<span class="d-del">'; DIM = '<span class="d-dim">'; E = '</span>'

spec_diff = '@@ §2.4 搜索 @@\n' + DA + '+ ### 2.4 搜索' + E + '\n' + DA + '+ - 商品页顶部搜索框（对话插入 15:01）' + E + '\n' + DA + '+ - 按名称实时过滤，无结果展示空态' + E
edit_products = ('// 商品卡片加购按钮接购物车 Provider（SPEC §2.3）\n'
  + DA + '+ IconButton(' + E + '\n' + DA + '+   icon: const Icon(Icons.add_shopping_cart),' + E + '\n'
  + DA + '+   onPressed: () => ref.read(' + E + '\n' + DA + '+     cartProvider.notifier).add(p),' + E + '\n' + DA + '+ ),' + E + '\n'
  + DIM + '▌ ← 光标位置，实时写入中（中间「开发直播」同步高亮此段）' + E)
analyze_out = 'Analyzing fresh_mall...\n' + DA + 'No issues found! (ran in 3.1s)' + E
git_detail = (DIM + 'a3f8c21 (HEAD -> main) feat: 商品列表页（瀑布流）' + E + '\n'
  + DIM + ' 3 files changed, 210 insertions(+)' + E + '\n' + DA + '→ 决策点已存档，可随时回退到此处' + E)
step_fail = (DD + '✗ 验证码框接受了非数字输入 —— 缺 inputFormatters' + E + '\n'
  + DIM + '判定：违反登录安全规范 §2.3' + E + '\n' + DA + '→ 已生成缺陷卡 #ISS-003 · 登录页任务自动排回流水线' + E)
edit_login = ('@@ 验证码：6 位 → 4 位 + 数字过滤 @@\n'
  + DD + '- maxLength: 6,' + E + '\n' + DA + '+ maxLength: 4,' + E + '\n'
  + DA + '+ inputFormatters: [FilteringTextInputFormatter.digitsOnly],' + E + '\n'
  + '@@ 登录按钮布局 @@\n' + DD + '- margin: const EdgeInsets.only(top: 96),' + E + '\n'
  + DA + '+ margin: const EdgeInsets.only(top: 48),' + E + '\n'
  + DIM + '应用后自动：flutter analyze → 登录用例回归（断言同步为 4 位）' + E)

plan_svg = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M4.5 6h7M4.5 8.5h7M4.5 11h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'

flow_parts = []
flow_parts.append('<div class="chat-body">')
flow_parts.append('                <!-- 项目启动时的整体计划（已批准，物化为任务流） -->')
flow_parts.append('<div class="turn"><div class="turn-head">计划 · 全项目 v1<span class="t-time">14:50 · 已批准</span></div>')
flow_parts.append(think('SPEC 已锁定，先出整体计划等批准…',
 'SPEC 已锁定为 v3。按工作准则开工前先出整体计划并获批准 —— 计划既是承诺，也是左侧任务流的来源。\n先基础设施再 Go 后端，让 Flutter 端从一开始就对真接口开发。', '2.1s'))
flow_parts.append('<div class="plan-card"><div class="pc-head">' + plan_svg + ' 开发计划 · 全项目 v1 · 18 张任务卡</div><div class="pc-body">'
 '<div class="plan-group">技术栈（可在此调整）</div>'
 '<div class="stack-row"><span class="st-chip">Flutter 3.41</span><span class="st-chip">状态管理 Riverpod ✎</span><span class="st-chip">路由 go_router ✎</span><span class="st-chip">图片 cached_network_image</span><span class="st-chip">Go Gin+GORM ✎</span><span class="st-chip">SQLite(dev)</span></div>'
 '<div class="plan-group">基础设施</div>'
 '<div class="plan-item done"><span class="pi-box">✓</span>项目脚手架 · 主题 · API 客户端<span class="pi-files">lib/core/ · lib/theme/</span></div>'
 '<div class="plan-item done"><span class="pi-box">✓</span>Go 后端 · API 契约 + 用户/商品接口<span class="pi-files">server/ · openapi.yaml</span></div>'
 '<div class="plan-group">账号</div>'
 '<div class="plan-item done"><span class="pi-box">✓</span>登录页（手机号+验证码）<span class="pi-files">login_screen.dart · auth_service.dart</span></div>'
 '<div class="plan-group">商品</div>'
 '<div class="plan-item run"><span class="pi-box"></span>商品列表页（瀑布流）<span class="pi-files">products_screen.dart（新建）</span></div>'
 '<div class="plan-group">购物车</div>'
 '<div class="plan-item"><span class="pi-box"></span>购物车页 + 本地持久化<span class="pi-files">cart/ · shared_preferences</span></div>'
 '<div class="plan-group">验收标准</div>'
 '<div class="plan-item"><span class="pi-box" style="border-style:dashed"></span>flutter analyze 零 error · go vet 通过 · 主流程探索测试 100%</div>'
 '</div><div class="pc-act"><span style="font-size:10.5px;color:var(--faint)">14:52 批准 · 已物化为左侧任务流</span></div></div></div>')

flow_parts.append('<div class="msg user"><div class="bubble">问一下：购物车为什么选本地持久化而不是跟服务端同步？</div></div>')
flow_parts.append('<div class="turn"><div class="turn-head">回答<span class="t-time">14:58</span></div>')
flow_parts.append(think('这是提问不是指令，只回答不动代码…',
 '这句话没有祈使语气，是"为什么"类提问。按约定只回答设计权衡，不触发任何工具。\n本地持久化的理由：SPEC 排除了订单模块所以服务端没有购物车接口；用户在之前对话里明确要求"游客可浏览加购"。', '1.3s'))
flow_parts.append('<div class="turn-sum">因为 SPEC 本期排除了「订单/支付」，服务端没有购物车接口可同步；本地持久化让游客也能加购（你之前要求的）。等做订单模块时我可以迁移成服务端购物车 + 本地缓存。' + DIM + '（未修改任何代码）' + E + '</div></div>')

flow_parts.append('<div class="msg user"><div class="bubble">中途加个需求：商品页顶部加搜索框，按名称过滤就行</div></div>')
flow_parts.append('<div class="turn"><div class="turn-head">执行 · 插入搜索功能<span class="t-time">15:01</span></div>')
flow_parts.append(think('范围变更：升版 SPEC，拆卡插入不打断当前任务…',
 '搜索不在 SPEC v3 范围内，属于范围变更：先升版 SPEC 到 v4。\n拆卡：搜索框 UI 和名称过滤分两张卡 —— UI 不依赖后端，过滤是纯本地逻辑（商品量小，本地过滤够用）。\n插入位置：排在「商品列表页」之后 —— 搜索框要挂在商品页顶部，必须等宿主页面完成。', '3.4s'))
flow_parts.append(act('Edit', 'SPEC.md', '+8 −0', 'ok', expand=True, detail=spec_diff))
flow_parts.append(act('Task', '创建 2 张任务卡 → 插入「商品列表页」之后', '✓', 'ok'))
flow_parts.append('<div class="turn-sum">已加入 SPEC §2.4，2 张任务卡（黄色）排在商品列表之后。当前任务未被打断，商品列表页继续生成。</div></div>')

flow_parts.append('<div class="turn run-turn"><div class="turn-head">执行 · 商品列表页<span class="t-time">15:02 · 进行中</span></div>')
flow_parts.append(think('按 skill 分层生成：model → service → UI…',
 '加载了 skill generate-product-list.md，规范要求分层生成：model → service → UI，每步是下一步的输入，保证字段和接口签名一致。\n瀑布流选 flutter_staggered_grid_view；图片懒加载选 cached_network_image（自带磁盘缓存）。\n生成完必须跑 flutter analyze，有 error 读日志修复，最多 5 轮。', '4.2s'))
flow_parts.append(act('Read', '.yume/commands/generate-product-list.md', '✓', 'ok'))
flow_parts.append(act('Write', 'lib/features/products/product_model.dart', '+86', 'ok'))
flow_parts.append(act('Write', 'lib/features/products/product_service.dart', '+124', 'ok'))
flow_parts.append(act('Edit', 'lib/features/products/products_screen.dart', '编辑中…', 'run', expand=True, open_=True, detail=edit_products))
flow_parts.append(act('Bash', 'flutter analyze --no-pub', 'No issues', 'ok', expand=True, detail=analyze_out))
flow_parts.append(act('Hot', '热重载推送 → 中间预览已更新（#7）', '0.8s', 'ok'))
flow_parts.append(act('Git', '自动保存决策点 · feat: 商品列表页（瀑布流）', 'a3f8c21', 'ok', expand=True, detail=git_detail))
flow_parts.append('</div>')

flow_parts.append('<div class="turn run-turn"><div class="turn-head">测试 · 登录主流程<span class="t-time">14:57 · 7/9 通过 · 1 失败已回流</span></div>')
flow_parts.append(think('任务卡完成后自动触发主流程探索测试…',
 '登录页任务卡刚完成（analyze 零 error），按测试策略自动触发主流程探索。\n定位用语义树（TextField#phone/#sms）而不是视觉坐标 —— 语义树稳定，不受布局微调影响。\n每步截图留档，同时抓网络请求断言：/api/sms/send 和 /api/auth/login 都应 200。', '1.8s'))
flow_parts.append(act('Step', '启动 App · 冷启动 1.4s', '✓', 'ok'))
flow_parts.append(act('Step', '输入手机号 → GET/POST 校验', '✓', 'ok'))
flow_parts.append(act('Step', '粘贴 "abcd" 到验证码框 → 预期被过滤', '✗', 'err', expand=True, detail=step_fail))
flow_parts.append(act('Step', '提交登录 · token 入 secure storage', '✓', 'ok'))
flow_parts.append('<div class="turn-sum">7/9 通过。失败项已回流开发（左栏「问题」页签可查 #ISS-003），修复后自动重跑该用例。</div></div>')

flow_parts.append('<div class="msg user"><div class="bubble">登录按钮太靠下了，验证码改 4 位</div></div>')
flow_parts.append('<div class="turn"><div class="turn-head">执行 · 反馈修改<span class="t-time">15:04 · 待审批</span></div>')
flow_parts.append(think('触及输入校验逻辑，安全敏感操作必须批准…',
 '这是对已完成代码的修改请求，且触及输入校验逻辑 —— 安全基线相关。即使在 auto 模式，安全敏感操作也必须批准。\n影响面：login_screen.dart 两处（maxLength、inputFormatters）+ 布局一处。登录用例断言也要同步改成 4 位。', '2.6s'))
flow_parts.append(act('Read', 'lib/features/auth/login_screen.dart', '✓', 'ok'))
flow_parts.append(act('Edit', 'login_screen.dart · 3 处改动', '待批准', 'run', expand=True, open_=True, detail=edit_login))
flow_parts.append('<div class="approve-bar"><span class="ap-text">应用这次修改？<span class="ap-dim">批准后自动 analyze + 回归测试</span></span>'
 '<button class="btn small">看完整文件</button><button class="btn small">要调整</button><button class="btn primary small">✓ 批准执行</button></div></div>')

flow_parts.append('<div class="msg user"><div class="bubble">购物车阶段开始前，先把计划给我看</div></div>')
flow_parts.append('<div class="turn"><div class="turn-head">计划 · 购物车模块 v2<span class="t-time">15:06 · 待确认</span></div>')
flow_parts.append(think('新阶段先出计划，四张卡按依赖排序…',
 '购物车是新阶段的第一个模块，按流程先出计划。依赖：商品模型（已完成）。\n顺序：页骨架 → 持久化 → 左滑删/全选 → 探索测试，每张依赖前一张的产物。\n持久化选 shared_preferences：购物车结构简单（商品id+数量），不需要 sqflite 的查询能力。', '1.5s'))
flow_parts.append('<div class="plan-card pending"><div class="pc-head">' + plan_svg + ' 购物车模块 · 4 张任务卡</div><div class="pc-body">'
 '<div class="plan-item"><span class="pi-box"></span>购物车页骨架（列表 + 数量增减）<span class="pi-dep">← 商品模型</span></div>'
 '<div class="plan-item"><span class="pi-box"></span>本地持久化（游客可用）<span class="pi-dep">← 页骨架</span></div>'
 '<div class="plan-item"><span class="pi-box"></span>左滑删除 + 全选结算条<span class="pi-dep">← 持久化</span></div>'
 '<div class="plan-item"><span class="pi-box"></span>探索测试：加购→改数量→删除 全路径<span class="pi-dep">← 全部完成</span></div>'
 '</div><div class="pc-act"><button class="btn small">要调整</button><button class="btn primary small">按此执行</button></div></div></div>')
flow_parts.append('              </div>')

flow = '                '.join(['\n' + x if i > 0 else x for i, x in enumerate(flow_parts)])
# 简单起见直接用换行拼接
flow = '\n'.join(flow_parts)
s = s[:start] + flow + '\n              ' + s[end:]
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
body = s[s.find('<body>'):]
print("div diff:", len(re.findall(r'<div\b', body)) - len(re.findall(r'</div>', body)))
print("expand acts:", len(re.findall(r'act expand', body)))
print("thinks:", len(re.findall(r'class="think-head"', body)))
