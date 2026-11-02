import { useCallback } from "react";
import { useStore } from "../store/AppStore";
import { useToast } from "../ui/Toast";

const undoSeconds = () => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--undo-window"));
  return Number.isFinite(v) ? v : 10;
};

/** 收工：切换为“已下班”，并给出 10 秒撤销窗口 */
export function useOffwork() {
  const { actions } = useStore();
  const toast = useToast();
  return useCallback(() => {
    const snap = actions.offwork();
    toast({
      message: "已收工，今天辛苦了。",
      action: { label: "撤销", onClick: () => actions.restore(snap) },
      seconds: undoSeconds(),
      countdown: true,
    });
  }, [actions, toast]);
}
