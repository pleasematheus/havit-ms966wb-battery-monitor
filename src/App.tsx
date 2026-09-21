import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"
import { useCallback, useEffect, useMemo, useState } from "react"

import defaultIcon from "../assets/icon.svg"
import galacticIcon from "../src-tauri/icons/alternate/galactic.svg"
import minimalistIcon from "../src-tauri/icons/alternate/minimalist.svg"
import monochromeIcon from "../src-tauri/icons/alternate/monochrome.svg"
import mythicIcon from "../src-tauri/icons/alternate/mythic.svg"

type BatteryStatus = "available" | "sleeping" | "notFound" | "busy" | "error"
type ManualIcon = "Default" | "Galactic" | "Monochrome" | "Minimalist" | "Mythic"
type ExecutableIcon = ManualIcon | "Warning" | "Critical"

export interface BatterySnapshot {
  percentage: number | null
  lastKnownPercentage: number | null
  status: BatteryStatus
  message: string
  updatedAt: number
  lastSuccessAt: number | null
}

interface ExecutableIconResult {
  icon: ExecutableIcon
  changed: boolean
}

interface IconOption {
  value: ManualIcon
  label: string
  image: string
}

const automaticIconStorageKey = "hmbm.syncExecutableIcon"
const manualIconStorageKey = "hmbm.manualExecutableIcon"

const iconOptions: IconOption[] = [
  { value: "Default", label: "Original", image: defaultIcon },
  { value: "Galactic", label: "Galáctico", image: galacticIcon },
  { value: "Monochrome", label: "Mono", image: monochromeIcon },
  { value: "Minimalist", label: "Minimal", image: minimalistIcon },
  { value: "Mythic", label: "Mítico", image: mythicIcon },
]

const executableIconLabels: Record<ExecutableIcon, string> = {
  Default: "Original verde",
  Warning: "Amarelo · carga baixa",
  Critical: "Vermelho · carga crítica",
  Galactic: "Galáctico",
  Monochrome: "Monocromático",
  Minimalist: "Minimalista",
  Mythic: "Mítico",
}

const initialSnapshot: BatterySnapshot = {
  percentage: null,
  lastKnownPercentage: null,
  status: "sleeping",
  message: "Consultando o receptor USB…",
  updatedAt: Date.now(),
  lastSuccessAt: null,
}

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
}

function savedManualIcon(): ManualIcon {
  const saved = window.localStorage.getItem(manualIconStorageKey)
  return iconOptions.some((option) => option.value === saved) ? (saved as ManualIcon) : "Default"
}

function relativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp)
  if (elapsed < 10_000) return "Agora"
  if (elapsed < 60_000) return `Há ${Math.floor(elapsed / 1000)} s`
  return `Há ${Math.floor(elapsed / 60_000)} min`
}

function iconErrorMessage(error: unknown): string {
  const message = String(error)
  if (message.includes("cannot write")) return "Sem permissão para alterar o executável"
  if (message.includes("already changing")) return "Outra troca de ícone está em andamento"
  return "Não foi possível trocar o ícone"
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
  )
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
  )
}

export function App() {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [refreshing, setRefreshing] = useState(false)
  const [automaticIcon, setAutomaticIcon] = useState(
    () => window.localStorage.getItem(automaticIconStorageKey) === "true",
  )
  const [manualIcon, setManualIcon] = useState<ManualIcon>(savedManualIcon)
  const [iconBusy, setIconBusy] = useState(false)
  const [iconStatus, setIconStatus] = useState("Ícone original")
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [autostartBusy, setAutostartBusy] = useState(false)
  const [autostartStatus, setAutostartStatus] = useState("Consultando o Windows…")
  const [, setClock] = useState(0)

  const shownLevel = snapshot.percentage ?? snapshot.lastKnownPercentage
  const level = shownLevel ?? 0
  const presentation = statusPresentation[snapshot.status]
  const runningInTauri = isTauri()

  const fillClass = useMemo(() => {
    if (level <= 20) return "from-red-600 to-red-300 shadow-red-400/25"
    if (level <= 40) return "from-amber-600 to-amber-300 shadow-amber-400/25"
    return "from-emerald-600 to-emerald-300 shadow-emerald-400/25"
  }, [level])

  const refresh = useCallback(async () => {
    if (!isTauri()) return
    setRefreshing(true)
    try {
      setSnapshot(await invoke<BatterySnapshot>("refresh_battery"))
    } finally {
      setRefreshing(false)
    }
  }, [])

  const toggleAutostart = useCallback(async () => {
    if (!runningInTauri || autostartBusy) return
    setAutostartBusy(true)
    try {
      if (autostartEnabled) await disableAutostart()
      else await enableAutostart()
      const enabled = await isAutostartEnabled()
      setAutostartEnabled(enabled)
      setAutostartStatus(enabled ? "Inicia oculto na bandeja" : "Início manual")
    } catch {
      setAutostartStatus("Não foi possível alterar esta opção")
    } finally {
      setAutostartBusy(false)
    }
  }, [autostartBusy, autostartEnabled, runningInTauri])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    if (runningInTauri) {
      void listen<BatterySnapshot>("battery-updated", ({ payload }) => {
        if (!disposed) setSnapshot(payload)
      }).then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })

      void invoke<BatterySnapshot>("get_cached_battery").then((cached) => {
        if (!disposed) setSnapshot(cached)
      })

      void isAutostartEnabled()
        .then((enabled) => {
          if (disposed) return
          setAutostartEnabled(enabled)
          setAutostartStatus(enabled ? "Inicia oculto na bandeja" : "Início manual")
        })
        .catch(() => {
          if (!disposed) setAutostartStatus("Estado indisponível")
        })
    }
    void refresh()

    const timer = window.setInterval(() => setClock((value) => value + 1), 5_000)
    return () => {
      disposed = true
      unlisten?.()
      window.clearInterval(timer)
    }
  }, [refresh, runningInTauri])

  useEffect(() => {
    window.localStorage.setItem(automaticIconStorageKey, String(automaticIcon))
    window.localStorage.setItem(manualIconStorageKey, manualIcon)
    if (!runningInTauri) return

    if (automaticIcon && shownLevel === null) {
      setIconStatus("Aguardando uma leitura da bateria")
      return
    }

    let disposed = false
    setIconBusy(true)
    void invoke<ExecutableIconResult>("set_executable_icon_preference", {
      automatic: automaticIcon,
      level: shownLevel,
      variant: manualIcon,
    })
      .then((result) => {
        if (!disposed) setIconStatus(executableIconLabels[result.icon])
      })
      .catch((error: unknown) => {
        if (!disposed) setIconStatus(iconErrorMessage(error))
      })
      .finally(() => {
        if (!disposed) setIconBusy(false)
      })

    return () => {
      disposed = true
    }
  }, [automaticIcon, manualIcon, runningInTauri, shownLevel])

  return (
    <main className="flex min-h-screen min-w-[360px] flex-col gap-3 overflow-hidden bg-[radial-gradient(circle_at_15%_0%,rgba(48,213,145,0.12),transparent_34%),radial-gradient(circle_at_100%_75%,rgba(51,138,255,0.10),transparent_42%)] p-[22px] text-slate-100">
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
        className="flex min-h-[205px] flex-col items-center justify-center rounded-3xl border border-white/7 bg-slate-900/75 shadow-[0_18px_55px_rgba(0,0,0,0.22)] backdrop-blur-xl"
        aria-live="polite"
      >
        <div
          className="relative h-[72px] w-40 rounded-[18px] border-[3px] border-slate-700 p-[7px]"
          aria-hidden="true"
        >
          <div className="absolute top-[21px] -right-3 h-[25px] w-[9px] rounded-r-md bg-slate-700" />
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
        <SettingRow
          label="Iniciar com o Windows"
          description={autostartBusy ? "Atualizando…" : autostartStatus}
          enabled={autostartEnabled}
          busy={autostartBusy}
          onToggle={() => void toggleAutostart()}
        />
      </section>

      <IconSettings
        automatic={automaticIcon}
        selected={manualIcon}
        busy={iconBusy}
        status={iconStatus}
        onAutomaticChange={() => setAutomaticIcon((enabled) => !enabled)}
        onSelect={setManualIcon}
      />

      <button
        type="button"
        disabled={refreshing}
        onClick={() => void refresh()}
        className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[14px] border border-emerald-300/25 bg-emerald-500/10 text-[13px] font-semibold text-emerald-200 transition hover:-translate-y-px hover:border-emerald-300/40 hover:bg-emerald-500/15 disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshIcon spinning={refreshing} />
        <span>Atualizar agora</span>
      </button>

      <p className="text-center text-[10px] text-slate-600">
        Fechar a janela mantém o monitor na bandeja do Windows.
      </p>
    </main>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/6 py-[11px] text-xs">
      <span className="text-slate-500">{label}</span>
      <strong className="font-semibold text-slate-300">{value}</strong>
    </div>
  )
}

function Toggle({
  enabled,
  disabled = false,
  label,
  onToggle,
}: {
  enabled: boolean
  disabled?: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full border transition disabled:cursor-wait disabled:opacity-50 ${
        enabled ? "border-emerald-300/35 bg-emerald-500/30" : "border-slate-600 bg-slate-800"
      }`}
    >
      <span
        className={`absolute top-[3px] left-[3px] size-4 rounded-full bg-slate-100 shadow-sm transition-transform ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  )
}

function SettingRow({
  label,
  description,
  enabled,
  busy,
  onToggle,
}: {
  label: string
  description: string
  enabled: boolean
  busy: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex min-h-[54px] items-center justify-between gap-3 py-2 text-xs">
      <div className="min-w-0">
        <span className="block text-slate-400">{label}</span>
        <span className="mt-0.5 block truncate text-[10px] text-slate-600" title={description}>
          {description}
        </span>
      </div>
      <Toggle enabled={enabled} disabled={busy} label={label} onToggle={onToggle} />
    </div>
  )
}

function IconSettings({
  automatic,
  selected,
  busy,
  status,
  onAutomaticChange,
  onSelect,
}: {
  automatic: boolean
  selected: ManualIcon
  busy: boolean
  status: string
  onAutomaticChange: () => void
  onSelect: (icon: ManualIcon) => void
}) {
  const visibleStatus = busy ? "Aplicando ícone…" : `${status}`

  return (
    <section className="rounded-[18px] border border-white/7 bg-slate-900/75 p-[14px] shadow-[0_18px_55px_rgba(0,0,0,0.18)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold text-slate-300">Ícone do aplicativo</h2>
          <p className="mt-0.5 text-[10px] text-slate-600">Acompanhar a faixa da bateria</p>
        </div>
        <Toggle
          enabled={automatic}
          disabled={busy}
          label="Sincronizar o ícone com a bateria"
          onToggle={onAutomaticChange}
        />
      </div>

      <div className={`mt-3 grid grid-cols-5 gap-1.5 ${automatic ? "opacity-40" : ""}`}>
        {iconOptions.map((option) => {
          const active = selected === option.value
          return (
            <button
              key={option.value}
              type="button"
              disabled={automatic || busy}
              onClick={() => onSelect(option.value)}
              className={`group flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-xl border p-1.5 transition disabled:cursor-not-allowed ${
                active
                  ? "border-emerald-300/35 bg-emerald-400/8"
                  : "border-transparent hover:border-white/10 hover:bg-white/3"
              }`}
            >
              <img src={option.image} alt="" className="size-9 rounded-[9px]" />
              <span className="max-w-full truncate text-[9px] text-slate-500 group-hover:text-slate-300">
                {option.label}
              </span>
            </button>
          )
        })}
      </div>

      <p className="mt-2 truncate text-center text-[10px] text-slate-600" title={visibleStatus}>
        {visibleStatus}
      </p>
    </section>
  )
}
