import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";

type BatteryStatus = "available" | "sleeping" | "notFound" | "busy" | "error";

export interface BatterySnapshot {
  percentage: number | null;
  lastKnownPercentage: number | null;
  status: BatteryStatus;
  message: string;
  updatedAt: number;
  lastSuccessAt: number | null;
}

const initialSnapshot: BatterySnapshot = {
  percentage: null,
  lastKnownPercentage: null,
  status: "sleeping",
  message: "Consultando o receptor USB…",
  updatedAt: Date.now(),
  lastSuccessAt: null,
};

const statusPresentation: Record<BatteryStatus, { label: string; classes: string }> = {
  available: {
    label: "Conectado",
    classes: "border-emerald-400/20 bg-emerald-400/8 text-emerald-300",
  },
  sleeping: {
    label: "Dormindo",
    classes: "border-amber-300/20 bg-amber-300/8 text-amber-200",
  },
  notFound: {
    label: "Ausente",
    classes: "border-red-300/20 bg-red-300/8 text-red-300",
  },
  busy: {
    label: "Ocupado",
    classes: "border-amber-300/20 bg-amber-300/8 text-amber-200",
  },
  error: {
    label: "Erro",
    classes: "border-red-300/20 bg-red-300/8 text-red-300",
  },
};

function relativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 10_000) return "Agora";
  if (elapsed < 60_000) return `Há ${Math.floor(elapsed / 1000)} s`;
  return `Há ${Math.floor(elapsed / 60_000)} min`;
}

function BatteryLogo() {
  return (
    <div className="grid size-12 place-items-center rounded-2xl border border-emerald-300/20 bg-gradient-to-br from-emerald-900/70 to-slate-900 shadow-[inset_0_1px_rgba(255,255,255,0.06)]">
      <svg
        viewBox="0 0 32 32"
        className="size-6 fill-none stroke-emerald-300 stroke-2 [stroke-linejoin:round]"
        aria-hidden="true"
      >
        <path d="M10 3h12a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V9a6 6 0 0 1 6-6Z" />
        <path d="M14 0h4v6h-4z" />
        <path className="fill-emerald-300 stroke-none" d="m17.4 8-6.2 10h4.4l-1 6 6.2-10h-4.4z" />
      </svg>
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-[17px] fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round] ${spinning ? "animate-spin" : ""}`}
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6" />
    </svg>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [, setClock] = useState(0);

  const shownLevel = snapshot.percentage ?? snapshot.lastKnownPercentage;
  const level = shownLevel ?? 0;
  const presentation = statusPresentation[snapshot.status];
  const runningInTauri = isTauri();

  const fillClass = useMemo(() => {
    if (level <= 20) return "from-red-600 to-red-300 shadow-red-400/25";
    if (level <= 40) return "from-amber-600 to-amber-300 shadow-amber-400/25";
    return "from-emerald-600 to-emerald-300 shadow-emerald-400/25";
  }, [level]);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    setRefreshing(true);
    try {
      setSnapshot(await invoke<BatterySnapshot>("refresh_battery"));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    if (runningInTauri) {
      void listen<BatterySnapshot>("battery-updated", ({ payload }) => {
        if (!disposed) setSnapshot(payload);
      }).then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });

      void invoke<BatterySnapshot>("get_cached_battery").then((cached) => {
        if (!disposed) setSnapshot(cached);
      });
    }
    void refresh();

    const timer = window.setInterval(() => setClock((value) => value + 1), 5_000);
    return () => {
      disposed = true;
      unlisten?.();
      window.clearInterval(timer);
    };
  }, [refresh, runningInTauri]);

  return (
    <main className="flex min-h-screen min-w-[360px] flex-col gap-[18px] overflow-hidden bg-[radial-gradient(circle_at_15%_0%,rgba(48,213,145,0.12),transparent_34%),radial-gradient(circle_at_100%_75%,rgba(51,138,255,0.10),transparent_42%)] p-[26px] text-slate-100">
      <header className="grid grid-cols-[48px_1fr_auto] items-center gap-[13px]">
        <BatteryLogo />
        <div>
          <p className="mb-0.5 text-[10px] font-bold tracking-[0.16em] text-slate-500">
            HAVIT MS966WB
          </p>
          <h1 className="text-[23px] font-bold tracking-[-0.03em]">Battery Monitor</h1>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1.5 text-[10px] font-bold tracking-[0.04em] uppercase ${presentation.classes}`}
        >
          {presentation.label}
        </span>
      </header>

      <section
        className="flex min-h-[218px] flex-col items-center justify-center rounded-3xl border border-white/7 bg-slate-900/75 shadow-[0_18px_55px_rgba(0,0,0,0.22)] backdrop-blur-xl"
        aria-live="polite"
      >
        <div className="relative h-[76px] w-44 rounded-[18px] border-[3px] border-slate-700 p-[7px]" aria-hidden="true">
          <div className="absolute top-[23px] -right-3 h-[25px] w-[9px] rounded-r-md bg-slate-700" />
          <div className="relative size-full overflow-hidden rounded-[10px] bg-slate-950/60">
            <div
              className={`h-full rounded-[9px] bg-gradient-to-r shadow-[0_0_28px] transition-[width] duration-500 ease-out ${fillClass} ${snapshot.percentage === null ? "opacity-50 saturate-[0.35]" : ""}`}
              style={{ width: `${Math.min(100, Math.max(0, level))}%` }}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/12 to-transparent to-45%" />
          </div>
        </div>

        <div className="mt-3 flex items-start">
          <span className="text-5xl leading-none font-bold tracking-[-0.06em]">
            {shownLevel ?? "--"}
          </span>
          <span className="mt-1 ml-1 text-xl font-semibold text-slate-500">%</span>
        </div>
        <p className="mx-6 mt-2 text-center text-xs leading-relaxed text-slate-400">
          {snapshot.message}
        </p>
      </section>

      <section className="rounded-[18px] border border-white/7 bg-slate-900/75 px-[17px] shadow-[0_18px_55px_rgba(0,0,0,0.18)] backdrop-blur-xl">
        <Detail label="Conexão" value="Receptor USB 2.4 GHz" />
        <Detail label="Última tentativa" value={relativeTime(snapshot.updatedAt)} />
        <Detail label="Atualização automática" value="60 segundos" last />
      </section>

      <button
        type="button"
        disabled={refreshing}
        onClick={() => void refresh()}
        className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[14px] border border-emerald-300/25 bg-emerald-500/10 text-[13px] font-semibold text-emerald-200 transition hover:-translate-y-px hover:border-emerald-300/40 hover:bg-emerald-500/15 disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshIcon spinning={refreshing} />
        <span>Atualizar agora</span>
      </button>

      <p className="-mt-1 text-center text-[10px] text-slate-600">
        Fechar a janela mantém o monitor na bandeja do Windows.
      </p>
    </main>
  );
}

function Detail({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-[13px] text-xs ${last ? "" : "border-b border-white/6"}`}>
      <span className="text-slate-500">{label}</span>
      <strong className="font-semibold text-slate-300">{value}</strong>
    </div>
  );
}
