import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"
import { BatteryCharging, Clock3, Palette, Power, RefreshCw, Usb } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import defaultIcon from "../assets/icon.svg"
import criticalIcon from "../src-tauri/icons/alternate/critical.svg"
import galacticIcon from "../src-tauri/icons/alternate/galactic.svg"
import minimalistIcon from "../src-tauri/icons/alternate/minimalist.svg"
import monochromeIcon from "../src-tauri/icons/alternate/monochrome.svg"
import mythicIcon from "../src-tauri/icons/alternate/mythic.svg"
import warningIcon from "../src-tauri/icons/alternate/warning.svg"

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
  { value: "Monochrome", label: "Monocromático", image: monochromeIcon },
  { value: "Minimalist", label: "Minimalista", image: minimalistIcon },
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

const executableIconImages: Record<ExecutableIcon, string> = {
  Default: defaultIcon,
  Warning: warningIcon,
  Critical: criticalIcon,
  Galactic: galacticIcon,
  Monochrome: monochromeIcon,
  Minimalist: minimalistIcon,
  Mythic: mythicIcon,
}

const initialSnapshot: BatterySnapshot = {
  percentage: null,
  lastKnownPercentage: null,
  status: "sleeping",
  message: "Consultando o receptor USB…",
  updatedAt: Date.now(),
  lastSuccessAt: null,
}

const statusPresentation: Record<BatteryStatus, { label: string; badge: string; dot: string }> = {
  available: {
    label: "Conectado",
    badge: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    dot: "bg-emerald-400",
  },
  sleeping: {
    label: "Dormindo",
    badge: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-400",
  },
  notFound: {
    label: "Ausente",
    badge: "border-red-500/25 bg-red-500/10 text-red-400",
    dot: "bg-red-400",
  },
  busy: {
    label: "Ocupado",
    badge: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-400",
  },
  error: {
    label: "Erro",
    badge: "border-red-500/25 bg-red-500/10 text-red-400",
    dot: "bg-red-400",
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

function AppLogo({ icon }: { icon: ExecutableIcon }) {
  return (
    <div className="size-11 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <img
        src={executableIconImages[icon]}
        alt=""
        className="size-full object-cover"
        draggable={false}
      />
    </div>
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
  const [activeIcon, setActiveIcon] = useState<ExecutableIcon>(manualIcon)
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [autostartBusy, setAutostartBusy] = useState(false)
  const [autostartStatus, setAutostartStatus] = useState("Consultando o Windows…")
  const [, setClock] = useState(0)

  const shownLevel = snapshot.percentage ?? snapshot.lastKnownPercentage
  const level = shownLevel ?? 0
  const runningInTauri = isTauri()

  const meterClass = useMemo(() => {
    if (level <= 20) return "[&_[data-slot=progress-indicator]]:bg-red-500"
    if (level <= 40) return "[&_[data-slot=progress-indicator]]:bg-amber-400"
    return "[&_[data-slot=progress-indicator]]:bg-emerald-500"
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
        if (!disposed) {
          setActiveIcon(result.icon)
          setIconStatus(executableIconLabels[result.icon])
        }
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
    <main className="flex h-screen min-w-[360px] flex-col gap-3 overflow-hidden bg-background p-5 text-foreground">
      <header className="flex items-center gap-3 px-0.5 py-0.5">
        <AppLogo icon={activeIcon} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight">Havit Battery</h1>
          <p className="truncate text-xs text-muted-foreground">MS966WB · Receptor 2.4 GHz</p>
        </div>
      </header>

      <BatteryCard snapshot={snapshot} level={shownLevel} meterClass={meterClass} />

      <Card size="sm" className="gap-0 py-0 shadow-none">
        <CardContent className="px-3">
          <Detail icon={Usb} label="Conexão" value="Receptor USB" />
          <Separator />
          <Detail icon={Clock3} label="Última tentativa" value={relativeTime(snapshot.updatedAt)} />
          <Separator />
          <SettingRow
            icon={Power}
            label="Iniciar com o Windows"
            description={autostartBusy ? "Atualizando…" : autostartStatus}
            enabled={autostartEnabled}
            busy={autostartBusy}
            onToggle={() => void toggleAutostart()}
          />
        </CardContent>
      </Card>

      <IconSettings
        automatic={automaticIcon}
        selected={manualIcon}
        busy={iconBusy}
        status={iconStatus}
        onAutomaticChange={setAutomaticIcon}
        onSelect={setManualIcon}
      />

      <Button
        type="button"
        size="lg"
        disabled={refreshing}
        onClick={() => void refresh()}
        className="h-10 w-full"
      >
        <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        {refreshing ? "Atualizando…" : "Atualizar agora"}
      </Button>

      <p className="text-center text-[11px] text-muted-foreground/65">
        Fechar a janela mantém o monitor na bandeja.
      </p>
    </main>
  )
}

function BatteryCard({
  snapshot,
  level,
  meterClass,
}: {
  snapshot: BatterySnapshot
  level: number | null
  meterClass: string
}) {
  const presentation = statusPresentation[snapshot.status]

  return (
    <Card className="gap-0 py-0 shadow-none" aria-live="polite">
      <CardHeader className="border-b py-3.5">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BatteryCharging className="size-4 text-muted-foreground" />
          Nível da bateria
        </CardTitle>
        <CardDescription className="text-xs">
          {snapshot.percentage === null && snapshot.lastKnownPercentage !== null
            ? "Última leitura conhecida"
            : "Leitura atual do receptor"}
        </CardDescription>
        <CardAction>
          <Badge variant="outline" className={cn("gap-1.5", presentation.badge)}>
            <span className={cn("size-1.5 rounded-full", presentation.dot)} />
            {presentation.label}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 py-4">
        <div className="flex items-end justify-between gap-4">
          <div className="flex items-baseline">
            <span className="text-5xl leading-none font-semibold tracking-[-0.055em] tabular-nums">
              {level ?? "—"}
            </span>
            <span className="ml-1 text-lg font-medium text-muted-foreground">%</span>
          </div>
          <span className="pb-1 text-right text-[11px] text-muted-foreground">
            {level === null ? "Indisponível" : batteryLabel(level)}
          </span>
        </div>
        <Progress
          value={level ?? 0}
          aria-label={level === null ? "Bateria indisponível" : `Bateria em ${level}%`}
          className={cn("h-2", meterClass, level === null && "opacity-40")}
        />
        <p className="min-h-8 text-xs leading-4 text-muted-foreground">{snapshot.message}</p>
      </CardContent>
    </Card>
  )
}

function batteryLabel(level: number): string {
  if (level <= 20) return "Carga crítica"
  if (level <= 40) return "Carga baixa"
  return "Carga normal"
}

type LucideIcon = typeof Usb

function Detail({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center gap-2.5 py-2 text-xs">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <strong className="ml-auto font-medium text-foreground">{value}</strong>
    </div>
  )
}

function SettingRow({
  icon: Icon,
  label,
  description,
  enabled,
  busy,
  onToggle,
}: {
  icon: LucideIcon
  label: string
  description: string
  enabled: boolean
  busy: boolean
  onToggle: (checked: boolean) => void
}) {
  return (
    <div className="flex min-h-13 items-center gap-2.5 py-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span className="block text-xs text-foreground">{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground" title={description}>
          {description}
        </span>
      </div>
      <Switch checked={enabled} disabled={busy} aria-label={label} onCheckedChange={onToggle} />
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
  onAutomaticChange: (checked: boolean) => void
  onSelect: (icon: ManualIcon) => void
}) {
  const visibleStatus = busy ? "Aplicando ícone…" : status

  return (
    <Card size="sm" className="gap-0 py-0 shadow-none">
      <CardHeader className="border-b py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Palette className="size-4 text-muted-foreground" />
          Ícone do aplicativo
        </CardTitle>
        <CardDescription className="text-xs">Acompanhar o nível da bateria</CardDescription>
        <CardAction>
          <Switch
            checked={automatic}
            disabled={busy}
            aria-label="Sincronizar o ícone com a bateria"
            onCheckedChange={onAutomaticChange}
          />
        </CardAction>
      </CardHeader>

      <CardContent className="py-3">
        <div className={cn("grid grid-cols-5 gap-1.5", automatic && "opacity-45")}>
          {iconOptions.map((option) => {
            const active = selected === option.value
            return (
              <Tooltip key={option.value}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Usar ícone ${option.label}`}
                    aria-pressed={active}
                    disabled={automatic || busy}
                    onClick={() => onSelect(option.value)}
                    className={cn(
                      "h-auto min-w-0 flex-col gap-1 rounded-lg border border-transparent px-1 py-1.5",
                      active && "border-primary/35 bg-primary/10 text-primary",
                    )}
                  >
                    <img
                      src={option.image}
                      alt=""
                      className="size-8 rounded-md"
                      draggable={false}
                    />
                    <span className="max-w-full truncate text-[9px] font-normal">
                      {option.label}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {option.label}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        <p
          className="mt-2 truncate text-center text-[11px] text-muted-foreground"
          title={visibleStatus}
        >
          {visibleStatus}
        </p>
      </CardContent>
    </Card>
  )
}
