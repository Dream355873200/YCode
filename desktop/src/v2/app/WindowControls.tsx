// WindowControls — 内联窗控（最小化/最大化/关闭），嵌在融合 Header 右端。
// 布局与交互对齐 ZCode DesktopWindowControls（Apache-2.0）：ghost 圆角钮、
// 关闭钮 hover 变 destructive 红；整组 no-drag 避免吞掉点击。
import { MinusIcon, XIcon } from 'lucide-react';
import { Button } from '../components/ui/button';
import { WindowMaximizeIcon } from '../components/ui/windowIcons';

export function WindowControls() {
  return (
    <div className="no-drag flex shrink-0 items-center gap-0.5">
      <Button type="button" variant="ghost" size="icon-md" aria-label="最小化"
        className="text-foreground hover:bg-hover" onClick={() => void window.amc.win.minimize()}>
        <MinusIcon />
      </Button>
      <Button type="button" variant="ghost" size="icon-md" aria-label="最大化 / 还原"
        className="text-foreground hover:bg-hover" onClick={() => void window.amc.win.maximize()}>
        <WindowMaximizeIcon />
      </Button>
      <Button type="button" variant="ghost" size="icon-md" aria-label="关闭"
        className="text-foreground hover:bg-destructive hover:text-destructive-foreground"
        onClick={() => void window.amc.win.close()}>
        <XIcon />
      </Button>
    </div>
  );
}
