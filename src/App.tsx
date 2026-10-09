import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"
import { BatteryCharging, BellRing, Clock3, Palette, Power, RefreshCw, Usb } from "lucide-react"
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
import { Slider } from "@/components/ui/slider"
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
  charging: boolean | null
  status: BatteryStatus
  message: string
  updatedAt: number
  lastSuccessAt: number | null
}

interface ExecutableIconResult {
  icon: ExecutableIcon
  changed: boolean
}

interface NotificationPreferences {
  lowEnabled: boolean
  highEnabled: boolean
  chargingStartedEnabled: boolean
  chargingStoppedEnabled: boolean
}

interface BatteryAlertSettings extends NotificationPreferences {
  lowThreshold: number
  highThreshold: number
}

interface IconOption {
  value: ManualIcon
  label: string
  image: string
}

const automaticIconStorageKey = "hmbm.syncExecutableIcon"
const manualIconStorageKey = "hmbm.manualExecutableIcon"
const defaultLowNotificationThreshold = 20
const defaultHighNotificationThreshold = 80
const minNotificationThreshold = 5
const maxNotificationThreshold = 100
const notificationThresholdStep = 5
const defaultNotificationPreferences: NotificationPreferences = {
  lowEnabled: true,
  highEnabled: true,
  chargingStartedEnabled: true,
  chargingStoppedEnabled: true,
}

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
  charging: null,
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

const powerPresentation = {
  charging: {
    label: "Carregando",
    badge: "border-sky-500/25 bg-sky-500/10 text-sky-400",
    dot: "bg-sky-400",
  },
  battery: {
    label: "Na bateria",
    badge: "border-foreground/15 bg-foreground/5 text-muted-foreground",
    dot: "bg-muted-foreground",
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
  const [notificationThresholds, setNotificationThresholds] = useState([
    defaultLowNotificationThreshold,
    defaultHighNotificationThreshold,
  ])
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [notificationReady, setNotificationReady] = useState(false)
  const [notificationPreferences, setNotificationPreferences] = useState(
    defaultNotificationPreferences,
  )
  const [notificationStatus, setNotificationStatus] = useState("Consultando as notificações…")
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
    if (!runningInTauri) return
    setRefreshing(true)
    try {
      setSnapshot(await invoke<BatterySnapshot>("refresh_battery"))
    } finally {
      setRefreshing(false)
    }
  }, [runningInTauri])

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

  const applyNotificationSettings = useCallback((settings: BatteryAlertSettings) => {
    setNotificationThresholds([settings.lowThreshold, settings.highThreshold])
    setNotificationPreferences({
      lowEnabled: settings.lowEnabled,
      highEnabled: settings.highEnabled,
      chargingStartedEnabled: settings.chargingStartedEnabled,
      chargingStoppedEnabled: settings.chargingStoppedEnabled,
    })
    setNotificationReady(true)
  }, [])

  const updateNotificationThresholds = useCallback(
    async ([lowThreshold, highThreshold]: number[]) => {
      if (!runningInTauri || notificationBusy || !notificationReady) return
      setNotificationBusy(true)
      try {
        const settings = await invoke<BatteryAlertSettings>("set_battery_alert_thresholds", {
          lowThreshold,
          highThreshold,
        })
        applyNotificationSettings(settings)
        setNotificationStatus("Limites salvos")
      } catch {
        setNotificationStatus("Não foi possível salvar os limites")
        try {
          const settings = await invoke<BatteryAlertSettings>("get_battery_alert_settings")
          applyNotificationSettings(settings)
        } catch {
          setNotificationReady(false)
          setNotificationStatus(
            "Configurações indisponíveis. Reabra o monitor para tentar novamente.",
          )
        }
      } finally {
        setNotificationBusy(false)
      }
    },
    [applyNotificationSettings, notificationBusy, notificationReady, runningInTauri],
  )

  const updateNotificationPreference = useCallback(
    async (key: keyof NotificationPreferences, enabled: boolean) => {
      if (!runningInTauri || notificationBusy || !notificationReady) return
      setNotificationBusy(true)
      try {
        const settings = await invoke<BatteryAlertSettings>(
          "set_battery_notification_preferences",
          {
            notifications: { ...notificationPreferences, [key]: enabled },
          },
        )
        applyNotificationSettings(settings)
        setNotificationStatus("Preferências salvas")
      } catch {
        setNotificationStatus("Não foi possível salvar. Tente novamente.")
      } finally {
        setNotificationBusy(false)
      }
    },
    [
      applyNotificationSettings,
      notificationBusy,
      notificationPreferences,
      notificationReady,
      runningInTauri,
    ],
  )

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

      void invoke<BatteryAlertSettings>("get_battery_alert_settings")
        .then((settings) => {
          if (disposed) return
          applyNotificationSettings(settings)
          setNotificationStatus("Preferências salvas neste computador")
        })
        .catch(() => {
          if (!disposed)
            setNotificationStatus(
              "Configurações indisponíveis. Reabra o monitor para tentar novamente.",
            )
        })
    }
    void refresh()

    const timer = window.setInterval(() => setClock((value) => value + 1), 5_000)
    return () => {
      disposed = true
      unlisten?.()
      window.clearInterval(timer)
    }
  }, [applyNotificationSettings, refresh, runningInTauri])

  useEffect(() => {
    if (!runningInTauri) {
      setAutostartStatus("Disponível apenas no app desktop")
      setNotificationStatus("Disponível apenas no app desktop")
      setIconStatus("Disponível apenas no app desktop")
    }
  }, [runningInTauri])

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
    <main className="app-scroll flex h-screen min-w-90 flex-col gap-3 overflow-y-auto bg-background p-5 text-foreground">
      <header className="flex items-center gap-3 px-0.5 py-0.5">
        <AppLogo icon={activeIcon} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight">Havit Battery</h1>
          <p className="truncate text-xs text-muted-foreground">MS966WB · Receptor 2.4 GHz</p>
        </div>
      </header>

      <BatteryCard
        snapshot={snapshot}
        level={shownLevel}
        meterClass={meterClass}
        refreshing={refreshing}
        canRefresh={runningInTauri}
        onRefresh={() => void refresh()}
      />

      <Card size="sm" className="shrink-0 gap-0 py-0 shadow-none">
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
            busy={autostartBusy || !runningInTauri}
            onToggle={() => void toggleAutostart()}
          />
        </CardContent>
      </Card>

      <NotificationSettings
        thresholds={notificationThresholds}
        preferences={notificationPreferences}
        status={notificationBusy ? "Salvando…" : notificationStatus}
        busy={notificationBusy || !notificationReady || !runningInTauri}
        onChange={setNotificationThresholds}
        onCommit={(thresholds) => void updateNotificationThresholds(thresholds)}
        onToggle={(key, enabled) => void updateNotificationPreference(key, enabled)}
      />

      <IconSettings
        automatic={automaticIcon}
        selected={manualIcon}
        busy={iconBusy}
        status={iconStatus}
        available={runningInTauri}
        onAutomaticChange={setAutomaticIcon}
        onSelect={setManualIcon}
      />

      <Button
        type="button"
        size="lg"
        disabled={refreshing || !runningInTauri}
        onClick={() => void refresh()}
        className="h-10 w-full shrink-0"
      >
        <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        {refreshing
          ? "Atualizando…"
          : runningInTauri
            ? "Atualizar agora"
            : "Disponível apenas no app desktop"}
      </Button>

      <p className="text-center text-xs text-muted-foreground/65">
        Fechar a janela mantém o monitor na bandeja.
      </p>
    </main>
  )
}

function BatteryCard({
  snapshot,
  level,
  meterClass,
  refreshing,
  canRefresh,
  onRefresh,
}: {
  snapshot: BatterySnapshot
  level: number | null
  meterClass: string
  refreshing: boolean
  canRefresh: boolean
  onRefresh: () => void
}) {
  const presentation =
    snapshot.status === "available" && snapshot.charging !== null
      ? powerPresentation[snapshot.charging ? "charging" : "battery"]
      : statusPresentation[snapshot.status]

  return (
    <Card className="shrink-0 gap-0 py-0 shadow-none">
      <CardHeader className="border-b py-3.5">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BatteryCharging className="size-4 text-muted-foreground" />
          Nível da bateria
        </CardTitle>
        <CardDescription className="text-xs">{batterySourceLabel(snapshot)}</CardDescription>
        <CardAction>
          <Badge variant="outline" className={cn("gap-1.5", presentation.badge)} aria-live="polite">
            <span className={cn("size-1.5 rounded-full", presentation.dot)} />
            {presentation.label}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 py-4">
        <div className="flex items-end justify-between gap-4" aria-live="polite">
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
        {level === null ? (
          <div
            className="flex h-2 items-center overflow-hidden rounded-full bg-muted-foreground/15"
            role="progressbar"
            aria-label="Bateria indisponível"
          >
            <span className="h-full w-1/3 animate-pulse rounded-full bg-muted-foreground/40" />
          </div>
        ) : (
          <Progress
            value={level}
            aria-label={`Bateria em ${level}%`}
            className={cn("h-2", meterClass)}
          />
        )}
        <p className="min-h-8 text-xs leading-4 text-muted-foreground">{snapshot.message}</p>
        {snapshot.status === "sleeping" && level === null && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canRefresh || refreshing}
            onClick={onRefresh}
            className="w-full"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            {canRefresh ? "Acordar e atualizar" : "Atualização no app desktop"}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function batterySourceLabel(snapshot: BatterySnapshot): string {
  if (snapshot.percentage === null && snapshot.lastKnownPercentage !== null) {
    return "Última leitura conhecida"
  }
  if (snapshot.charging === true) return "Cabo USB conectado"
  if (snapshot.charging === false) return "Funcionando pela bateria"
  return "Leitura atual do receptor"
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
        <span className="block text-xs leading-4 text-muted-foreground">{description}</span>
      </div>
      <Switch checked={enabled} disabled={busy} aria-label={label} onCheckedChange={onToggle} />
    </div>
  )
}

function NotificationSettings({
  thresholds,
  preferences,
  status,
  busy,
  onChange,
  onCommit,
  onToggle,
}: {
  thresholds: number[]
  preferences: NotificationPreferences
  status: string
  busy: boolean
  onChange: (thresholds: number[]) => void
  onCommit: (thresholds: number[]) => void
  onToggle: (key: keyof NotificationPreferences, enabled: boolean) => void
}) {
  const [lowThreshold, highThreshold] = thresholds

  return (
    <Card size="sm" className="shrink-0 gap-0 py-0 shadow-none">
      <CardHeader className="border-b py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BellRing className="size-4 text-muted-foreground" />
          Notificações
        </CardTitle>
        <CardDescription className="text-xs">Escolha quais avisos deseja receber</CardDescription>
      </CardHeader>
      <CardContent className="px-3">
        <SettingRow
          icon={BellRing}
          label="Bateria baixa"
          description={`Avisar ao descarregar até ${lowThreshold}%`}
          enabled={preferences.lowEnabled}
          busy={busy}
          onToggle={(enabled) => onToggle("lowEnabled", enabled)}
        />
        <Slider
          className="mb-3"
          value={[lowThreshold]}
          min={minNotificationThreshold}
          max={highThreshold - notificationThresholdStep}
          step={notificationThresholdStep}
          disabled={busy || !preferences.lowEnabled}
          thumbLabels={["Limite de bateria baixa"]}
          onValueChange={([value]) => onChange([value, highThreshold])}
          onValueCommit={([value]) => onCommit([value, highThreshold])}
        />
        <Separator />
        <SettingRow
          icon={BellRing}
          label="Limite de carga"
          description={`Avisar ao atingir ${highThreshold}%`}
          enabled={preferences.highEnabled}
          busy={busy}
          onToggle={(enabled) => onToggle("highEnabled", enabled)}
        />
        <Slider
          className="mb-3"
          value={[highThreshold]}
          min={lowThreshold + notificationThresholdStep}
          max={maxNotificationThreshold}
          step={notificationThresholdStep}
          disabled={busy || !preferences.highEnabled}
          thumbLabels={["Limite de carga"]}
          onValueChange={([value]) => onChange([lowThreshold, value])}
          onValueCommit={([value]) => onCommit([lowThreshold, value])}
        />
        <Separator />
        <SettingRow
          icon={BatteryCharging}
          label="Início do carregamento"
          description="Avisar quando o mouse começar a carregar"
          enabled={preferences.chargingStartedEnabled}
          busy={busy}
          onToggle={(enabled) => onToggle("chargingStartedEnabled", enabled)}
        />
        <Separator />
        <SettingRow
          icon={Power}
          label="Fim do carregamento"
          description="Avisar quando o mouse voltar a usar a bateria"
          enabled={preferences.chargingStoppedEnabled}
          busy={busy}
          onToggle={(enabled) => onToggle("chargingStoppedEnabled", enabled)}
        />
        <p className="py-2 text-xs leading-4 text-muted-foreground">
          Os limites apenas avisam; não interrompem a carga do mouse.
        </p>
        <p className="pb-3 text-xs leading-4 text-muted-foreground" role="status">
          {status}
        </p>
      </CardContent>
    </Card>
  )
}

function IconSettings({
  automatic,
  selected,
  busy,
  status,
  available,
  onAutomaticChange,
  onSelect,
}: {
  automatic: boolean
  selected: ManualIcon
  busy: boolean
  status: string
  available: boolean
  onAutomaticChange: (checked: boolean) => void
  onSelect: (icon: ManualIcon) => void
}) {
  const visibleStatus = !available
    ? "Disponível apenas no app desktop"
    : busy
      ? "Aplicando ícone…"
      : status

  return (
    <Card size="sm" className="shrink-0 gap-0 py-0 shadow-none">
      <CardHeader className="border-b py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Palette className="size-4 text-muted-foreground" />
          Ícone do aplicativo
        </CardTitle>
        <CardDescription className="text-xs">
          {available ? "Acompanhar o nível da bateria" : "Disponível apenas no app desktop"}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Automático</span>
          <Switch
            checked={automatic}
            disabled={busy || !available}
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
                    disabled={automatic || busy || !available}
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
                    <span className="max-w-full truncate text-[11px] font-normal">
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
          className="mt-2 truncate text-center text-xs text-muted-foreground"
          title={visibleStatus}
        >
          {visibleStatus}
        </p>
      </CardContent>
    </Card>
  )
}
