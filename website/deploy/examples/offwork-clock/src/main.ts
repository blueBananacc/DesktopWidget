import { device } from "@shared/device";
import { loadValues } from "@shared/settings";
import manifest from "./appmeta/manifest.json";

/** The name the app draws under; the device clears elements by this id. */
const APP = manifest.id;

const WHITE = "#FFFFFFFF";
const GREEN = "#2F9E62FF";
const SUBTLE_WHITE = "#FFFFFFCC";

/** Today's off-work instant as unix seconds, from the "HH:MM" setting. */
function targetSec(offTime: string): number {
  const parts = offTime.split(":");
  const h = Number(parts[0]), m = Number(parts[1]);
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 18, Number.isFinite(m) ? m : 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

type DrawElements = NonNullable<Parameters<typeof device.DisplayDraw>[0]["elements"]>;

/** One full frame. Two states: counting down to off-work, or past it. */
async function draw(offTime: string): Promise<void> {
  const done = Date.now() / 1000 >= targetSec(offTime);
  const elements: DrawElements = [
    { id: "t", type: "text", text: `OFF AT ${offTime}`, font: "small", color: SUBTLE_WHITE, x: 36, y: 0, align: "top_mid", z_index: 1 },
    done
      ? { id: "cd", type: "text", text: "GO HOME!", font: "extra_large", color: GREEN, x: 36, y: 9, align: "center", z_index: 1 }
      : { id: "cd", type: "countdown", timestamp: String(targetSec(offTime)), direction: "time_left", show_hours: "when_non_zero", x: 36, y: 9, align: "center", z_index: 1, color: WHITE },
  ];
  await device.DisplayDraw({ application_name: APP, priority: 50, elements });
}

function main(): void {
  const report = (err: unknown) =>
    console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);

  let offTime = "18:00";
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  void loadValues()
    .then((values) => {
      const v = values?.off_time;
      if (typeof v === "string" && v.includes(":")) offTime = v;
      return draw(offTime);
    })
    .then(() => {
      // The countdown counts by itself; this only flips to GO HOME once the time passes.
      timer = setInterval(() => {
        if (Date.now() / 1000 >= targetSec(offTime)) {
          if (timer) clearInterval(timer);
          void device.DisplayClear({ application_name: APP })
            .then(() => draw(offTime))
            .catch(report);
        }
      }, 30_000);
    })
    .catch(report);

  const unbind = listen("input", (event) => {
    if (stopped || event.key !== "back" || event.action !== "short") return;
    stopped = true;
    if (timer) clearInterval(timer);
    setTimeout(unbind, 0);
  });
}

main();
