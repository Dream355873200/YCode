// QueuePanel — 消息队列面板（composer 上方）：busy 期间入队的消息在这里
// 等待消费，每条可立即发送 / 撤回编辑 / 删除。消费后经 queue_run 帧转为
// 时间线里的普通用户气泡（开新轮）。
// 视觉对齐 ZCode 队列面板：rounded-t-2xl 只圆上角 + -mb-7 pb-7 负边距，
// 让面板背景延伸到 composer 卡背后，与输入卡连成一个整体（磨砂贴合）。
import { ArrowUpFromLineIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useConversation, useSession } from './store';
import { Button } from '../components/ui/button';

export function QueuePanel({ sid }: { sid: string }) {
  const items = useSession(sid).queue;
  const sendNow = useConversation((s) => s.sendNow);
  const editQueued = useConversation((s) => s.editQueued);
  const removeQueued = useConversation((s) => s.removeQueued);
  if (items.length === 0) return null;

  return (
    <div className="relative z-0 -mb-7 w-full overflow-hidden rounded-t-2xl border border-border bg-surface p-1 pb-7 backdrop-blur-md">
      {items.map((item) => (
        <div key={item.id}
          className="group flex items-center gap-2 rounded-xl px-1.5 py-1 pr-1.5 transition-colors hover:bg-hover/30">
          <span className="min-w-0 flex-1 truncate text-ui-base text-foreground" title={item.text}>
            {item.text}
          </span>
          {/* 按钮常显（ZCode 同款）：立即发送 = 带文字的 secondary 钮 */}
          <Button type="button" variant="secondary" size="sm"
            className="shrink-0 gap-1"
            onClick={() => void sendNow(sid, item.id)}>
            <ArrowUpFromLineIcon className="size-3.5" />
            立即发送
          </Button>
          <Button type="button" variant="ghost" size="icon-md" aria-label="撤回编辑"
            title="取回输入框修改"
            className="shrink-0 text-foreground-subtle hover:bg-hover hover:text-foreground"
            onClick={() => void editQueued(sid, item.id)}>
            <PencilIcon className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-md" aria-label="删除"
            title="不再发送"
            className="shrink-0 text-foreground-subtle hover:bg-hover hover:text-destructive"
            onClick={() => void removeQueued(sid, item.id)}>
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
