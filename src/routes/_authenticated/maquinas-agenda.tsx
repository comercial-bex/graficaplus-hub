import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maquinas } from "@/lib/mock-data";

export const Route = createFileRoute("/_authenticated/maquinas-agenda")({
  head: () => ({ meta: [{ title: "Agenda de máquinas — BEX PRINT OS" }] }),
  component: AgendaPage,
});

const dias = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const bloqueios = [
  { maq: 0, dia: 0, span: 2, label: "OS-1042 banner", cor: "bg-blue-500/80" },
  { maq: 0, dia: 3, span: 1, label: "OS-1045 adesivo", cor: "bg-violet-500/80" },
  { maq: 1, dia: 1, span: 3, label: "OS-1040 corte CNC", cor: "bg-amber-500/80" },
  { maq: 2, dia: 0, span: 4, label: "OS-1043 3D batch", cor: "bg-emerald-500/80" },
  { maq: 2, dia: 4, span: 1, label: "OS-1047 peça", cor: "bg-emerald-500/80" },
  { maq: 3, dia: 2, span: 2, label: "OS-1041 recorte", cor: "bg-rose-500/80" },
];

function AgendaPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agenda de máquinas</h1>
        <p className="text-muted-foreground">Ocupação semanal por equipamento</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Semana atual</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <div className="grid grid-cols-[200px_repeat(6,1fr)] gap-1 mb-2">
                <div className="text-xs text-muted-foreground font-medium">Máquina</div>
                {dias.map((d) => (
                  <div key={d} className="text-xs text-muted-foreground font-medium text-center">{d}</div>
                ))}
              </div>
              {maquinas.map((m, mi) => (
                <div key={m.id} className="grid grid-cols-[200px_repeat(6,1fr)] gap-1 mb-1">
                  <div className="text-sm py-2 truncate">{m.nome}</div>
                  {dias.map((_, di) => {
                    const blk = bloqueios.find((b) => b.maq === mi && b.dia === di);
                    if (blk) {
                      return (
                        <div
                          key={di}
                          className={`${blk.cor} text-white text-xs rounded px-2 py-2 truncate`}
                          style={{ gridColumn: `span ${blk.span}` }}
                        >
                          {blk.label}
                        </div>
                      );
                    }
                    if (bloqueios.some((b) => b.maq === mi && di > b.dia && di < b.dia + b.span)) {
                      return null;
                    }
                    return <div key={di} className="bg-muted/30 rounded h-9" />;
                  })}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
