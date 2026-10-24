import * as React from "react";

import { Button } from "./button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog.js";

/** 二次确认弹窗（删除对话、撤销改动等不可逆操作）。 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "确定",
  tone = "destructive",
  onConfirm,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: "destructive" | "default";
  onConfirm(): void | Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => { if (open) setError(""); }, [open]);
  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-100" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription className="text-ui-sm">{description}</DialogDescription>}
        </DialogHeader>
        {error && <div className="rounded-lg bg-destructive/10 px-2.5 py-1.5 text-ui-xs text-destructive">{error}</div>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant={tone === "destructive" ? "destructive" : "default"} disabled={busy}
            onClick={() => void confirm()} autoFocus>
            {busy ? "处理中…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ConfirmDialog };
