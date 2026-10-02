import {
  BellRing,
  CalendarClock,
  CircleAlert,
  Clock,
  Crosshair,
  Cuboid,
  Factory,
  Layers,
  Printer,
  Scissors,
  Sun,
  TriangleAlert,
  Truck,
  Wifi,
  WifiOff,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Os ícones da parede, pelo nome que o domínio usa. `identidade-da-maquina.ts`
 * fala em "Printer", "Scissors"…; a tela resolve o componente aqui, num lugar só.
 * A maquete desenhava os mesmos traços do lucide (ISC) embutidos à mão.
 */
const ICONES: Record<string, LucideIcon> = {
  Printer,
  Scissors,
  Zap,
  Crosshair,
  Cuboid,
  Sun,
  Factory,
  Layers,
  TriangleAlert,
  Clock,
  CalendarClock,
  Wifi,
  WifiOff,
  Truck,
  CircleAlert,
  BellRing,
};

export type NomeDeIcone = keyof typeof ICONES;

export function Icone({ nome, px, cor }: { nome: string; px: number; cor?: string }) {
  const Componente = ICONES[nome] ?? Layers;
  return (
    <Componente
      className="ic"
      size={px}
      style={cor ? { color: cor } : undefined}
      aria-hidden="true"
    />
  );
}
